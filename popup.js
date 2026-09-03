import { countFonts } from './db.js';

const countEl = document.getElementById('count');
const noteEl = document.getElementById('note');

countFonts()
  .then((n) => {
    countEl.textContent = n === 1 ? '1 saved' : `${n} saved`;
  })
  .catch(() => {
    countEl.textContent = '';
  });

document.getElementById('open').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('gallery.html') });
  window.close();
});

document.getElementById('pick').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || /^(chrome|edge|about|chrome-extension):/i.test(tab.url || '')) {
    show('Browser pages are off limits. Open a site first.');
    return;
  }
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    window.close();
  } catch (err) {
    show('This page blocks extensions. Try another one.');
  }
});

function show(text) {
  noteEl.textContent = text;
  noteEl.hidden = false;
}
