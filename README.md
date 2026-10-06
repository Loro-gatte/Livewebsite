# Lyve site: editable copy

Start the editor:

    python3 server.py

Then open http://localhost:4321 and press **Edit** (bottom-right).

- **Click any text** to change it. The change applies everywhere that exact text appears.
- **Click an image or video** to upload a replacement.
- **Colours**: page background, cards, text and borders.
- **Find & replace**: for things you can't click, like the animated numbers ("92%"), emails and links.
- **All edits**: lists every change, with undo.

All changes are saved in `edits.json`. You can also edit that file by hand.
The downloaded site in `original/` is never modified, so you can always get back to it.

Publish:

    python3 server.py --export

This writes the finished site to `dist/`. Deploy that folder to Vercel, Netlify or GitHub Pages.
