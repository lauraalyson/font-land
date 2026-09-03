import { allFonts, deleteFont } from './db.js';

const sheet = document.getElementById('sheet');
const tally = document.getElementById('tally');
const sampleInput = document.getElementById('sample');
const sizeInput = document.getElementById('size');
const sizeOut = document.getElementById('sizeOut');
const filterInput = document.getElementById('filter');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');

let records = [];

init();

async function init() {
  records = await allFonts();
  for (const rec of records) {
    rec.faceName = null;
    if (rec.dataB64) {
      rec.faceName = await register(rec);
    }
    rec.coverage = rec.faceName ? coverage(rec.faceName) : null;
  }
  render();
}

/* ---------- font loading ---------- */

function toBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function register(rec) {
  const name = `tl-${rec.id.slice(0, 8)}`;
  try {
    const face = new FontFace(name, toBuffer(rec.dataB64));
    await face.load();
    document.fonts.add(face);
    return name;
  } catch (_) {
    return null;
  }
}

/* ---------- coverage ---------- */

const PROBE =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:!?&@#$%()[]{}-–—\'"/*+=<>áéîõüçñß';
const ctx = document.createElement('canvas').getContext('2d');

function widths(stack) {
  ctx.font = `64px ${stack}`;
  return Array.from(PROBE, (ch) => ctx.measureText(ch).width);
}

// A missing glyph falls back to the next family in the stack. Measuring against
// two very different fallbacks makes an accidental width match unlikely.
function coverage(name) {
  const mono = widths('monospace');
  const serif = widths('serif');
  const withMono = widths(`"${name}", monospace`);
  const withSerif = widths(`"${name}", serif`);
  let have = 0;
  for (let i = 0; i < PROBE.length; i++) {
    const missing = withMono[i] === mono[i] && withSerif[i] === serif[i];
    if (!missing) have++;
  }
  return { have, total: PROBE.length };
}

function stateOf(rec) {
  if (!rec.faceName) return { key: 'none', text: 'image only' };
  const { have, total } = rec.coverage || { have: 0, total: 1 };
  if (have === 0) return { key: 'none', text: 'image only' };
  if (have >= total - 4) return { key: 'full', text: 'full charset' };
  return { key: 'partial', text: `partial · ${have}/${total} glyphs` };
}

/* ---------- render ---------- */

function render() {
  const q = filterInput.value.trim().toLowerCase();
  const list = q
    ? records.filter(
        (r) =>
          r.family.toLowerCase().includes(q) ||
          (r.hostname || '').toLowerCase().includes(q)
      )
    : records;

  const families = new Set(records.map((r) => r.family.toLowerCase()));
  tally.textContent = records.length
    ? `${records.length} saved · ${families.size} families`
    : '';

  sheet.innerHTML = '';

  if (!records.length) {
    sheet.innerHTML = `
      <div class="empty">
        <h2>Nothing saved yet</h2>
        <p>Open a specimen page, click the extension, and pick any text on it.
        The font file comes along when the page will give it up.</p>
      </div>`;
    return;
  }

  if (!list.length) {
    sheet.innerHTML = `<div class="empty"><h2>No matches</h2><p>Nothing here for “${escape(
      filterInput.value
    )}”.</p></div>`;
    return;
  }

  for (const rec of list) sheet.appendChild(row(rec));
  applySample();
}

function row(rec) {
  const el = document.createElement('article');
  el.className = 'row';
  const state = stateOf(rec);
  const cut = `${weightName(rec.weight)}${rec.style === 'italic' ? ' Italic' : ''}`;

  el.innerHTML = `
    <div class="meta">
      <span class="family">${escape(rec.family)}</span>
      <span class="sep">/</span>
      <span class="cut">${escape(cut)}</span>
      <span class="sep">/</span>
      <a class="origin" href="${escape(rec.sourceUrl)}" target="_blank" rel="noreferrer">${escape(
        rec.hostname || 'source'
      )}</a>
      <span class="sep">/</span>
      <span class="when">${when(rec.createdAt)}</span>
      <span class="state" data-state="${state.key}">${state.text}</span>
      ${
        rec.shot && rec.faceName
          ? `<img class="thumb" src="${rec.shot}" alt="Specimen from ${escape(rec.family)}" />`
          : ''
      }
      <div class="acts">
        ${rec.dataB64 ? '<button data-act="export">Export file</button>' : ''}
        <button data-act="delete" class="danger">Delete</button>
      </div>
    </div>
    ${
      rec.faceName
        ? `<div class="specimen" style="font-family:'${rec.faceName}', serif; font-weight:${escape(
            String(rec.weight)
          )}; font-style:${escape(rec.style)}"></div>`
        : rec.shot
          ? `<div class="shot-only">
               <img src="${rec.shot}" alt="Specimen from ${escape(rec.family)}" />
               <p>No font file on this page, so this one stays a picture.</p>
             </div>`
          : `<div class="specimen pending">No font file and no image saved.</div>`
    }
  `;

  el.querySelectorAll('img').forEach((img) =>
    img.addEventListener('click', () => {
      lightboxImg.src = img.src;
      lightbox.hidden = false;
    })
  );

  el.querySelectorAll('[data-act]').forEach((btn) =>
    btn.addEventListener('click', () => act(btn.dataset.act, rec))
  );

  return el;
}

async function act(kind, rec) {
  if (kind === 'delete') {
    await deleteFont(rec.id);
    records = records.filter((r) => r.id !== rec.id);
    render();
  }
  if (kind === 'export') {
    const ext =
      { woff2: 'woff2', woff: 'woff', truetype: 'ttf', opentype: 'otf' }[rec.format] || 'bin';
    const blob = new Blob([toBuffer(rec.dataB64)], { type: 'font/' + ext });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${rec.family.replace(/\s+/g, '-')}-${rec.weight}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}

/* ---------- controls ---------- */

function applySample() {
  const text = sampleInput.value || 'Handgloves';
  const size = sizeInput.value + 'px';
  sheet.querySelectorAll('.specimen').forEach((el) => {
    if (!el.classList.contains('pending')) el.textContent = text;
    el.style.fontSize = size;
  });
}

sampleInput.addEventListener('input', applySample);
sizeInput.addEventListener('input', () => {
  sizeOut.value = sizeInput.value;
  applySample();
});
filterInput.addEventListener('input', render);
lightbox.addEventListener('click', () => {
  lightbox.hidden = true;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') lightbox.hidden = true;
});

/* ---------- helpers ---------- */

function weightName(w) {
  const map = {
    100: 'Thin',
    200: 'Extra Light',
    300: 'Light',
    400: 'Regular',
    500: 'Medium',
    600: 'Semibold',
    700: 'Bold',
    800: 'Extra Bold',
    900: 'Black'
  };
  return map[parseInt(w, 10)] || `Weight ${w}`;
}

function when(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function escape(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
