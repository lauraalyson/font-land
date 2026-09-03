import { saveFont } from './db.js';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CAPTURE_CROP') {
    cropVisible(msg.rect, sender.tab && sender.tab.windowId)
      .then((shot) => sendResponse({ shot }))
      .catch(() => sendResponse({ shot: null }));
    return true;
  }

  if (msg.type === 'SAVE_FONT') {
    saveFont(msg.record)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});

async function cropVisible(rect, windowId) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId ?? null, {
    format: 'png'
  });
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  const dpr = rect.dpr || 1;
  const sx = Math.round(rect.x * dpr);
  const sy = Math.round(rect.y * dpr);
  const sw = Math.min(Math.round(rect.width * dpr), bitmap.width - sx);
  const sh = Math.min(Math.round(rect.height * dpr), bitmap.height - sy);
  if (sw <= 0 || sh <= 0) return null;

  // Cap the stored image so a full-width grab on a retina screen stays small.
  const scale = Math.min(1, 1400 / sw);
  const canvas = new OffscreenCanvas(Math.round(sw * scale), Math.round(sh * scale));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const out = await canvas.convertToBlob({ type: 'image/png' });
  return blobToDataUrl(out);
}

async function blobToDataUrl(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}
