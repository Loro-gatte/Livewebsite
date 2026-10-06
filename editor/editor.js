// Lyve site editor. Only loaded by server.py, never included in the exported site.
(() => {
  const STATE_KEY = "lyve-editor-on";
  const SCROLL_KEY = "lyve-editor-scroll";
  let on = false;
  try { on = sessionStorage.getItem(STATE_KEY) === "1"; } catch {}

  const api = {
    get: () => fetch("/__api/edits").then((r) => r.json()),
    save: (d) => fetch("/__api/edits", { method: "POST", body: JSON.stringify(d) }),
    upload: (file) =>
      fetch("/__api/upload", { method: "POST", headers: { "X-Filename": encodeURIComponent(file.name) }, body: file }).then((r) => r.json()),
  };

  const reload = () => {
    try { sessionStorage.setItem(SCROLL_KEY, String(scrollY)); } catch {}
    location.reload();
  };
  try {
    const y = sessionStorage.getItem(SCROLL_KEY);
    if (y) { sessionStorage.removeItem(SCROLL_KEY); addEventListener("load", () => setTimeout(() => scrollTo(0, +y), 300)); }
  } catch {}

  const css = `
  #lyve-ed,#lyve-ed *{all:revert;box-sizing:border-box;font:13px/1.4 -apple-system,system-ui,sans-serif;color:#111}
  #lyve-ed-toggle{position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px 16px;border-radius:999px;border:0;cursor:pointer;
    background:#f81342;color:#fff !important;font-weight:600 !important;box-shadow:0 6px 20px #0004}
  #lyve-ed-bar{position:fixed;left:16px;bottom:16px;z-index:2147483646;display:flex;gap:6px;align-items:center;background:#fff;
    padding:8px 10px;border-radius:12px;box-shadow:0 6px 24px #0003;max-width:calc(100vw - 150px);flex-wrap:wrap}
  #lyve-ed-bar button,#lyve-ed-pop button{padding:6px 10px;border-radius:8px;border:1px solid #ccc;background:#f6f6f6;cursor:pointer}
  #lyve-ed-bar b{margin-right:4px}
  #lyve-ed-pop{position:fixed;z-index:2147483647;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,calc(100vw - 32px));
    background:#fff;border-radius:14px;padding:18px;box-shadow:0 20px 60px #0005;max-height:85vh;overflow:auto}
  #lyve-ed-pop textarea,#lyve-ed-pop input[type=text]{width:100%;padding:8px;border:1px solid #ccc;border-radius:8px;font-family:inherit}
  #lyve-ed-pop textarea{min-height:110px}
  #lyve-ed-pop .row{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
  #lyve-ed-pop label{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0}
  #lyve-ed-pop h3{font-weight:700;font-size:15px;margin:0 0 10px}
  #lyve-ed-pop .muted{color:#666;font-size:12px}
  .lyve-ed-hover{outline:2px dashed #f81342 !important;outline-offset:2px;cursor:text !important}
  `;

  const root = document.createElement("div");
  root.id = "lyve-ed";
  root.innerHTML = `<style>${css}</style><button id="lyve-ed-toggle"></button><div id="lyve-ed-bar" hidden>
    <b>Edit mode</b><span class="muted">click text or images to change them</span>
    <button data-a="theme">Colours</button><button data-a="find">Find &amp; replace</button><button data-a="history">All edits</button></div>`;
  document.body.appendChild(root);
  const toggle = root.querySelector("#lyve-ed-toggle");
  const bar = root.querySelector("#lyve-ed-bar");

  function render() {
    toggle.textContent = on ? "Done editing" : "Edit";
    bar.hidden = !on;
    try { sessionStorage.setItem(STATE_KEY, on ? "1" : "0"); } catch {}
  }
  toggle.onclick = () => { on = !on; render(); };
  render();

  function popup(html, onOpen) {
    closePopup();
    const p = document.createElement("div");
    p.id = "lyve-ed-pop";
    p.innerHTML = html;
    root.appendChild(p);
    p.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closePopup));
    onOpen && onOpen(p);
    return p;
  }
  function closePopup() { root.querySelector("#lyve-ed-pop")?.remove(); }
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---- text ----
  function textNodeAt(x, y) {
    const r = document.caretRangeFromPoint?.(x, y);
    let n = r?.startContainer;
    if (n && n.nodeType === 3 && n.data.trim()) return n;
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (t) => (t.data.trim() ? 1 : 3) });
    return w.nextNode();
  }

  async function editText(node) {
    const current = node.data;
    const edits = await api.get();
    const existing = edits.text.find((e) => e.to === current);
    popup(`<h3>Edit text</h3>
      <textarea id="t">${esc(current)}</textarea>
      <p class="muted">${existing ? `Originally: “${esc(existing.from)}”` : "Changes every place this exact text appears."}
      Capitalisation on screen may come from the design (e.g. ALL CAPS styling).</p>
      <div class="row">${existing ? '<button id="undo">Restore original</button>' : ""}<button data-close>Cancel</button><button id="ok"><b>Save</b></button></div>`,
      (p) => {
        const ta = p.querySelector("#t"); ta.focus(); ta.select();
        p.querySelector("#ok").onclick = async () => {
          const val = ta.value;
          if (existing) existing.to = val; else edits.text.push({ from: current, to: val });
          await api.save(edits); reload();
        };
        p.querySelector("#undo")?.addEventListener("click", async () => {
          edits.text = edits.text.filter((e) => e !== existing);
          await api.save(edits); reload();
        });
      });
  }

  // ---- images / video ----
  function mediaAt(target) {
    const m = target.closest("img,video,picture");
    if (m) return m.tagName === "PICTURE" ? m.querySelector("img") : m;
    // overlays often sit above media; look underneath
    for (const el of document.elementsFromPoint(lastXY[0], lastXY[1])) if (/^(IMG|VIDEO)$/.test(el.tagName)) return el;
    return null;
  }
  function mediaSrc(el) {
    const raw = el.getAttribute("src") || el.querySelector?.("source")?.getAttribute("src") || "";
    try { return new URL(raw, location.href).pathname; } catch { return raw; }
  }
  async function editMedia(el) {
    const src = mediaSrc(el);
    const edits = await api.get();
    const existing = edits.assets.find((a) => a.to === src);
    popup(`<h3>Replace ${el.tagName === "VIDEO" ? "video" : "image"}</h3>
      <p class="muted">Current: ${esc(existing ? existing.from + " → " + existing.to : src)}</p>
      <input type="file" id="f" accept="${el.tagName === "VIDEO" ? "video/*" : "image/*"}">
      <div class="row">${existing ? '<button id="undo">Restore original</button>' : ""}<button data-close>Cancel</button><button id="ok"><b>Upload &amp; save</b></button></div>`,
      (p) => {
        p.querySelector("#ok").onclick = async () => {
          const file = p.querySelector("#f").files[0];
          if (!file) return;
          const { path } = await api.upload(file);
          if (existing) existing.to = path; else edits.assets.push({ from: src, to: path });
          await api.save(edits); reload();
        };
        p.querySelector("#undo")?.addEventListener("click", async () => {
          edits.assets = edits.assets.filter((a) => a !== existing);
          await api.save(edits); reload();
        });
      });
  }

  // ---- theme ----
  const THEME_FIELDS = [
    ["bg", "Page background", "#07080a"], ["panel", "Card background", "#111316"], ["graphite", "Raised surface", "#1a1c20"],
    ["text", "Main text", "#f4f2ec"], ["muted", "Secondary text", "#8a8d93"], ["hairline", "Lines / borders", "#ffffff14"],
    ["accent", "Accent (buttons, dots)", "#f81342"], ["accent2", "Accent gradient start", "#f86d31"], ["accent3", "Accent gradient end", "#e56964"],
    ["accent4", "Secondary accent", "#f28a5a"], ["darkPanel", "Dark dashboard panels", "#0d0f12"],
  ];
  async function editTheme() {
    const edits = await api.get();
    const t = edits.theme;
    popup(`<h3>Colours</h3>${THEME_FIELDS.map(([k, label, def]) =>
      `<label>${label}<input type="text" data-k="${k}" value="${esc(t[k] || "")}" placeholder="${def} (original)"></label>`).join("")}
      <p class="muted">Any CSS colour works (#fff, #00000020, rgb(…)). Leave blank to keep the original.</p>
      <div class="row"><button id="reset">Original dark theme</button><button data-close>Cancel</button><button id="ok"><b>Save</b></button></div>`,
      (p) => {
        p.querySelector("#ok").onclick = async () => {
          p.querySelectorAll("[data-k]").forEach((i) => { if (i.value.trim()) t[i.dataset.k] = i.value.trim(); else delete t[i.dataset.k]; });
          await api.save(edits); reload();
        };
        p.querySelector("#reset").onclick = async () => { edits.theme = {}; await api.save(edits); reload(); };
      });
  }

  // ---- find & replace (for anything not clickable, e.g. the animated numbers) ----
  async function findReplace() {
    const edits = await api.get();
    popup(`<h3>Find &amp; replace</h3>
      <label>Find<input type="text" id="a" placeholder='e.g. 92%'></label>
      <label>Replace with<input type="text" id="b"></label>
      <label><span>Match inside longer text too</span><input type="checkbox" id="any"></label>
      <p class="muted">Use this for the animated counters, links, emails and anything you can't click.</p>
      <div class="row"><button data-close>Cancel</button><button id="ok"><b>Save</b></button></div>`,
      (p) => {
        p.querySelector("#ok").onclick = async () => {
          const from = p.querySelector("#a").value, to = p.querySelector("#b").value;
          if (!from) return;
          edits.text.push(p.querySelector("#any").checked ? { from, to, anywhere: true } : { from, to });
          await api.save(edits); reload();
        };
      });
  }

  async function history() {
    const edits = await api.get();
    const rows = [
      ...edits.text.map((e, i) => ({ kind: "text", i, label: `“${e.from}” → “${e.to}”` })),
      ...edits.assets.map((e, i) => ({ kind: "assets", i, label: `${e.from} → ${e.to}` })),
    ];
    popup(`<h3>All edits (${rows.length})</h3>${rows.length ? rows.map((r, n) =>
      `<label><span>${esc(r.label)}</span><button data-n="${n}">Undo</button></label>`).join("") : '<p class="muted">No edits yet.</p>'}
      <div class="row"><button data-close>Close</button></div>`,
      (p) => p.querySelectorAll("[data-n]").forEach((b) => (b.onclick = async () => {
        const r = rows[+b.dataset.n];
        edits[r.kind].splice(r.i, 1);
        await api.save(edits); reload();
      })));
  }

  bar.addEventListener("click", (e) => {
    const a = e.target.closest("button")?.dataset.a;
    if (a === "theme") editTheme();
    if (a === "find") findReplace();
    if (a === "history") history();
  });

  // ---- click interception while editing ----
  let lastXY = [0, 0], hovered = null;
  const inEditor = (t) => root.contains(t);
  document.addEventListener("mousemove", (e) => {
    if (!on || inEditor(e.target)) return;
    hovered?.classList.remove("lyve-ed-hover");
    hovered = e.target; hovered.classList.add("lyve-ed-hover");
  }, true);
  for (const type of ["click", "mousedown", "pointerdown", "pointerup", "mouseup", "touchstart"]) {
    document.addEventListener(type, (e) => {
      if (!on || inEditor(e.target)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (type !== "click") return;
      lastXY = [e.clientX, e.clientY];
      hovered?.classList.remove("lyve-ed-hover");
      const node = textNodeAt(e.clientX, e.clientY);
      const media = mediaAt(e.target);
      // Prefer text directly under the cursor; fall back to the image/video beneath it.
      const textHit = node && node.parentElement && e.target.contains(node.parentElement);
      if (textHit || (node && !media)) editText(node);
      else if (media) editMedia(media);
    }, true);
  }
})();
