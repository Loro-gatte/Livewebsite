#!/usr/bin/env python3
"""Lyve site: local editor + exporter.

  python3 server.py              # preview + edit at http://localhost:4321 (press "Edit" bottom-right)
  python3 server.py --export     # write the finished static site to ./dist (deploy that folder)

The files in ./original are never modified. Every change lives in edits.json:
  theme   CSS colour variables (empty = keep the original dark look)
  text    [{"from": original text, "to": new text}]   (also works for any raw find/replace)
  assets  [{"from": "/original/path.jpg", "to": "/uploads/new.jpg"}]
"""
import html
import json
import mimetypes
import re
import shutil
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
ORIGINAL = ROOT / "original"
UPLOADS = ROOT / "uploads"
EDITS = ROOT / "edits.json"
EDITOR_JS = ROOT / "editor" / "editor.js"
PORT = 4321
TEXT_TYPES = {".html", ".js", ".css", ".json", ".txt", ".svg"}

# Brand colours hard-coded in the original build. A theme value for a key swaps every occurrence.
ACCENTS = {
    "accent": "#f81342",      # main accent (buttons, dots, highlights)
    "accent2": "#f86d31",     # gradient start
    "accent3": "#e56964",     # gradient end
    "accent4": "#f28a5a",     # warning/secondary tag colour
    "darkPanel": "#0d0f12",   # dark dashboard panels
}


def load_edits():
    if EDITS.exists():
        data = json.loads(EDITS.read_text("utf-8"))
    else:
        data = {}
    data.setdefault("theme", {})
    data.setdefault("text", [])
    data.setdefault("assets", [])
    return data


def save_edits(data):
    EDITS.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", "utf-8")


def variants(s):
    """The ways a string can appear in the build: raw, HTML-escaped, JS/JSON-escaped, escaped twice (RSC payload)."""
    j = json.dumps(s, ensure_ascii=False)[1:-1]
    ja = json.dumps(s)[1:-1]
    out = [s, html.escape(s, quote=False), html.escape(s), j, ja, json.dumps(j, ensure_ascii=False)[1:-1], json.dumps(ja)[1:-1]]
    seen, uniq = set(), []
    for v in out:
        if v not in seen:
            seen.add(v)
            uniq.append(v)
    return uniq


def escape_like(found_variant, original, new):
    """Encode `new` the same way `original` was encoded where it was found."""
    for enc in (
        lambda x: x,
        lambda x: html.escape(x, quote=False),
        html.escape,
        lambda x: json.dumps(x, ensure_ascii=False)[1:-1],
        lambda x: json.dumps(x)[1:-1],
        lambda x: json.dumps(json.dumps(x, ensure_ascii=False)[1:-1], ensure_ascii=False)[1:-1],
        lambda x: json.dumps(json.dumps(x)[1:-1])[1:-1],
    ):
        if enc(original) == found_variant:
            return enc(new)
    return new


# A text edit only replaces whole strings (bounded by quotes or tags) so short words
# like "live" don't get replaced inside other sentences or code.
BOUND_L = r'(?:(?<=["\'`>])|(?<=\\")|(?<=-->))'
BOUND_R = r'(?=["\'`<]|\\")'


def apply_edits(content, data, is_html):
    for e in data["text"]:
        src, dst = e.get("from", ""), e.get("to", "")
        if not src or src == dst:
            continue
        loose = e.get("anywhere", False)
        for v in variants(src):
            rep = escape_like(v, src, dst)
            if loose:
                content = content.replace(v, rep)
            else:
                content = re.sub(BOUND_L + re.escape(v) + BOUND_R, lambda m, r=rep: r, content)
    for key, orig in ACCENTS.items():
        new = data["theme"].get(key)
        if new:
            content = re.sub(re.escape(orig), new, content, flags=re.IGNORECASE)
    for a in data["assets"]:
        if a.get("from") and a.get("to"):
            content = content.replace(a["from"], a["to"])
    if is_html:
        content = content.replace("</head>", theme_css(data["theme"]) + "</head>", 1)
    return content


def theme_css(theme):
    if not theme:
        return ""
    names = {
        "bg": "--color-bg", "panel": "--color-panel", "graphite": "--color-graphite",
        "text": "--color-bone", "muted": "--color-muted", "hairline": "--color-hairline",
    }
    decls = "".join(f"{v}:{theme[k]} !important;" for k, v in names.items() if theme.get(k))
    css = f":root,:host{{{decls}}}"
    if theme.get("bg"):
        css += f"html,body{{background:{theme['bg']} !important;}}"
    if theme.get("text"):
        css += f"body{{color:{theme['text']} !important;}}"
    css += theme.get("extraCss", "")
    return f'<style id="lyve-theme">{css}</style>'


def resolve(path):
    path = unquote(urlparse(path).path)
    for base in (UPLOADS if path.startswith("/uploads/") else None, ORIGINAL):
        if base is None:
            continue
        rel = path[len("/uploads/"):] if base is UPLOADS else path.lstrip("/")
        f = (base / rel).resolve()
        if base.resolve() not in f.parents and f != base.resolve():
            return None
        if f.is_dir():
            f = f / "index.html"
        if f.is_file():
            return f
        if (f.parent / (f.name + ".html")).is_file():
            return f.parent / (f.name + ".html")
    return None


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send_bytes(self, body, ctype, status=200):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        p = urlparse(self.path).path
        if p == "/__editor/editor.js":
            return self.send_bytes(EDITOR_JS.read_bytes(), "text/javascript; charset=utf-8")
        if p == "/__api/edits":
            return self.send_bytes(json.dumps(load_edits()).encode(), "application/json")
        f = resolve(self.path)
        if not f:
            f = ORIGINAL / "index.html" if "." not in p.rsplit("/", 1)[-1] else None
        if not f:
            return self.send_bytes(b"not found", "text/plain", 404)
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        if f.suffix in TEXT_TYPES and f.is_relative_to(ORIGINAL):
            body = apply_edits(f.read_text("utf-8"), load_edits(), f.suffix == ".html")
            if f.suffix == ".html":
                body = body.replace("</body>", '<script src="/__editor/editor.js"></script></body>', 1)
            return self.send_bytes(body.encode("utf-8"), ctype + "; charset=utf-8")
        if f.suffix in (".mp4", ".webm") and self.headers.get("Range"):
            return self.send_range(f, ctype)
        return self.send_bytes(f.read_bytes(), ctype)

    def send_range(self, f, ctype):
        size = f.stat().st_size
        m = re.match(r"bytes=(\d*)-(\d*)", self.headers["Range"])
        start = int(m.group(1) or 0)
        end = min(int(m.group(2) or size - 1), size - 1)
        with open(f, "rb") as fh:
            fh.seek(start)
            body = fh.read(end - start + 1)
        self.send_response(206)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        p = urlparse(self.path).path
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if p == "/__api/edits":
            save_edits(json.loads(body))
            return self.send_bytes(b'{"ok":true}', "application/json")
        if p == "/__api/upload":
            name = re.sub(r"[^A-Za-z0-9._-]", "-", unquote(self.headers.get("X-Filename", "file")))
            name = f"{int(time.time())}-{name}"
            UPLOADS.mkdir(exist_ok=True)
            (UPLOADS / name).write_bytes(body)
            return self.send_bytes(json.dumps({"path": f"/uploads/{name}"}).encode(), "application/json")
        self.send_bytes(b"not found", "text/plain", 404)


def export(out=ROOT / "dist"):
    data = load_edits()
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ORIGINAL, out, ignore=shutil.ignore_patterns(".DS_Store"))
    if UPLOADS.exists():
        shutil.copytree(UPLOADS, out / "uploads", dirs_exist_ok=True)
    for f in out.rglob("*"):
        if f.is_file() and f.suffix in TEXT_TYPES and "uploads" not in f.parts:
            f.write_text(apply_edits(f.read_text("utf-8"), data, f.suffix == ".html"), "utf-8")
    print(f"Exported to {out}")


if __name__ == "__main__":
    if "--export" in sys.argv:
        export()
    else:
        print(f"Lyve editor running at http://localhost:{PORT}  (Ctrl+C to stop)")
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
