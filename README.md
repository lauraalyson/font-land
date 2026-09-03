# Type Library

Save a typeface from any page: the live font file when the page will give it up, a cropped specimen image, and the source URL.

## Install

1. Unzip this folder somewhere permanent — Chrome loads it from disk, so moving or deleting it uninstalls the extension.
2. Go to `chrome://extensions`, turn on **Developer mode** (top right).
3. **Load unpacked** → select this folder.
4. Pin it to the toolbar.

## Use

- Click the toolbar icon → **Pick a font on this page**.
- Hover any text; the tooltip shows which family is actually rendering (not just the first name in the CSS stack).
- Click to lock it in. The extension then pulls the `@font-face` source for that exact weight and style.
- Drag a box to keep a specimen image. `Enter` skips the image, `Esc` cancels the whole thing.
- **Open library** to see everything.

In the library, the sample text field retypes every font at once, and the size slider scales them together.

## What the status dot means

- **full charset** — the whole file came through; type anything.
- **partial** — the page served a subset. It will render the characters that page used and fall back for the rest.
- **image only** — no downloadable font file (a system font, an Adobe Fonts specimen, or a page that renders type as images). The screenshot is the record.

## Notes

Fonts are fetched from the page's own context so servers that check the `Referer` header still hand them over. Everything is stored locally in IndexedDB; nothing leaves your machine.

Web fonts on a foundry site are licensed for display on that site. This is a reference shelf for your own work, not a distribution tool.
