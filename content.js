/* Runs on demand, injected by the popup. Two phases:
   1. pick  — hover any text, click to lock in the typeface
   2. crop  — drag a box to keep as the specimen image                */

(() => {
  if (window.__typeLibraryLoaded) {
    window.__typeLibraryStart();
    return;
  }
  window.__typeLibraryLoaded = true;

  const FORMAT_RANK = { woff2: 0, woff: 1, opentype: 2, truetype: 3, otf: 2, ttf: 3 };
  const EXT_FORMAT = { woff2: 'woff2', woff: 'woff', otf: 'opentype', ttf: 'truetype' };

  let phase = null;
  let hovered = null;
  let picked = null;
  let dragStart = null;
  let ui = {};

  /* ---------- overlay ---------- */

  function buildUI() {
    const root = document.createElement('div');
    root.className = 'tl-root';
    root.innerHTML = `
      <div class="tl-outline" hidden></div>
      <div class="tl-tip" hidden></div>
      <div class="tl-dim" hidden></div>
      <div class="tl-box" hidden></div>
      <div class="tl-bar" hidden><span class="tl-bar-text"></span></div>
      <div class="tl-toast" hidden></div>
    `;
    document.documentElement.appendChild(root);
    ui = {
      root,
      outline: root.querySelector('.tl-outline'),
      tip: root.querySelector('.tl-tip'),
      dim: root.querySelector('.tl-dim'),
      box: root.querySelector('.tl-box'),
      bar: root.querySelector('.tl-bar'),
      barText: root.querySelector('.tl-bar-text'),
      toast: root.querySelector('.tl-toast')
    };
  }

  function say(text) {
    ui.barText.textContent = text;
    ui.bar.hidden = false;
  }

  function toast(text, tone = 'ok') {
    ui.toast.textContent = text;
    ui.toast.dataset.tone = tone;
    ui.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      ui.toast.hidden = true;
      if (!phase && ui.root && ui.root.isConnected) ui.root.remove();
    }, 2600);
  }

  /* ---------- phase 1: pick ---------- */

  function onMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === hovered || ui.root.contains(el)) return;
    hovered = el;
    const r = el.getBoundingClientRect();
    Object.assign(ui.outline.style, {
      top: r.top + 'px',
      left: r.left + 'px',
      width: r.width + 'px',
      height: r.height + 'px'
    });
    ui.outline.hidden = false;
    ui.tip.textContent = renderedFamily(el);
    ui.tip.hidden = false;
    const tipTop = r.top > 34 ? r.top - 30 : r.bottom + 8;
    Object.assign(ui.tip.style, { top: tipTop + 'px', left: Math.max(8, r.left) + 'px' });
  }

  async function onClick(e) {
    if (phase === 'crop') {
      // stop the page from following links mid-drag
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (phase !== 'pick') return;
    e.preventDefault();
    e.stopPropagation();
    const el = hovered || document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    ui.outline.hidden = true;
    ui.tip.hidden = true;
    say('Reading the font file…');
    picked = await describe(el);
    startCrop();
  }

  /* ---------- font resolution ---------- */

  function cleanName(n) {
    return (n || '').trim().replace(/^["']|["']$/g, '');
  }

  function renderedFamily(el) {
    const cs = getComputedStyle(el);
    const stack = cs.fontFamily.split(',').map(cleanName).filter(Boolean);
    const sample = (el.textContent || 'Aa').trim().slice(0, 12) || 'Aa';
    for (const family of stack) {
      if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-\w+)$/i.test(family)) continue;
      try {
        if (document.fonts.check(`${cs.fontStyle} ${cs.fontWeight} 16px "${family}"`, sample)) {
          return family;
        }
      } catch (_) {
        /* malformed family name, keep looking */
      }
    }
    return stack[0] || 'Unknown';
  }

  async function describe(el) {
    const cs = getComputedStyle(el);
    const family = renderedFamily(el);
    const weight = cs.fontWeight || '400';
    const style = cs.fontStyle || 'normal';
    const faces = await collectFaces();
    const face = bestFace(faces, family, weight, style);

    let dataB64 = null;
    let format = null;
    let fontUrl = null;
    let familyCount = faces.filter(
      (f) => f.family.toLowerCase() === family.toLowerCase()
    ).length;

    if (face) {
      fontUrl = face.url;
      format = face.format;
      dataB64 = await fetchAsBase64(face.url);
    }

    return {
      id: crypto.randomUUID(),
      family,
      weight,
      style,
      sourceUrl: location.href,
      hostname: location.hostname.replace(/^www\./, ''),
      pageTitle: document.title,
      fontUrl,
      format,
      dataB64,
      familyCount,
      shot: null,
      createdAt: Date.now()
    };
  }

  async function collectFaces() {
    const faces = [];

    const walk = (rules, base) => {
      for (const rule of rules) {
        if (rule.constructor && rule.constructor.name === 'CSSFontFaceRule') {
          push(rule.style.getPropertyValue('font-family'), rule.style.getPropertyValue('font-weight'), rule.style.getPropertyValue('font-style'), rule.style.getPropertyValue('src'), base);
        } else if (rule.cssRules) {
          try {
            walk(rule.cssRules, rule.href || base);
          } catch (_) {}
        }
      }
    };

    const push = (family, weight, style, src, base) => {
      family = cleanName(family);
      if (!family || !src) return;
      const picked = pickSource(src, base);
      if (!picked) return;
      faces.push({ family, weight: weight || '400', style: style || 'normal', ...picked });
    };

    const sheets = Array.from(document.styleSheets);
    for (const sheet of sheets) {
      let rules = null;
      try {
        rules = sheet.cssRules;
      } catch (_) {
        rules = null;
      }
      if (rules) {
        walk(rules, sheet.href || location.href);
      } else if (sheet.href) {
        try {
          const text = await (await fetch(sheet.href)).text();
          parseSheetText(text, sheet.href, push);
        } catch (_) {}
      }
    }

    // Inline <style> blocks are already covered above, but some sites inject
    // @font-face through a stylesheet we can't touch. Fall back to any link tag.
    return faces;
  }

  function parseSheetText(text, base, push) {
    const blocks = text.match(/@font-face\s*\{[^}]*\}/gi) || [];
    for (const block of blocks) {
      const grab = (prop) => {
        const m = block.match(new RegExp(prop + '\\s*:\\s*([^;}]+)', 'i'));
        return m ? m[1].trim() : '';
      };
      push(grab('font-family'), grab('font-weight'), grab('font-style'), grab('src'), base);
    }
  }

  function pickSource(src, base) {
    const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)(?:\s*format\(\s*['"]?([\w-]+)['"]?\s*\))?/gi;
    const found = [];
    let m;
    while ((m = re.exec(src))) {
      const raw = m[2].trim();
      let format = (m[3] || '').toLowerCase();
      if (!format) {
        const ext = (raw.split('?')[0].split('.').pop() || '').toLowerCase();
        format = EXT_FORMAT[ext] || '';
      }
      if (format === 'embedded-opentype' || format === 'svg') continue;
      let url = raw;
      if (!/^data:/i.test(raw)) {
        try {
          url = new URL(raw, base || location.href).href;
        } catch (_) {
          continue;
        }
      }
      found.push({ url, format: format || 'unknown', rank: FORMAT_RANK[format] ?? 9 });
    }
    if (!found.length) return null;
    found.sort((a, b) => a.rank - b.rank);
    return { url: found[0].url, format: found[0].format };
  }

  function bestFace(faces, family, weight, style) {
    const want = parseInt(weight, 10) || 400;
    const candidates = faces.filter(
      (f) => f.family.toLowerCase() === String(family).toLowerCase()
    );
    if (!candidates.length) return null;
    const score = (f) => {
      let s = 0;
      const fs = (f.style || 'normal').toLowerCase();
      const italicWanted = style !== 'normal';
      if ((fs.includes('italic') || fs.includes('oblique')) !== italicWanted) s += 1000;
      const nums = String(f.weight).match(/\d+/g);
      if (nums && nums.length >= 2) {
        const lo = +nums[0];
        const hi = +nums[1];
        s += want >= lo && want <= hi ? 0 : Math.min(Math.abs(want - lo), Math.abs(want - hi));
      } else {
        let w = nums ? +nums[0] : /bold/i.test(f.weight) ? 700 : 400;
        s += Math.abs(want - w);
      }
      return s;
    };
    return candidates.sort((a, b) => score(a) - score(b))[0];
  }

  async function fetchAsBase64(url) {
    try {
      // Fetched from the page context on purpose: some font servers check the
      // Referer header and will refuse a request made from the extension.
      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 12 * 1024 * 1024) return null;
      let binary = '';
      const bytes = new Uint8Array(buf);
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    } catch (_) {
      return null;
    }
  }

  /* ---------- phase 2: crop ---------- */

  function startCrop() {
    phase = 'crop';
    ui.dim.hidden = false;
    const got = picked.dataB64 ? 'Font file captured' : 'No font file on this page';
    say(`${picked.family} · ${got}. Drag a box for the specimen — Enter to skip, Esc to cancel.`);
  }

  function onDown(e) {
    if (phase !== 'crop') return;
    e.preventDefault();
    dragStart = { x: e.clientX, y: e.clientY };
    ui.dim.hidden = true;
    ui.box.hidden = false;
    drawBox(e.clientX, e.clientY);
  }

  function onDrag(e) {
    if (phase !== 'crop' || !dragStart) return;
    drawBox(e.clientX, e.clientY);
  }

  function drawBox(x, y) {
    const left = Math.min(dragStart.x, x);
    const top = Math.min(dragStart.y, y);
    Object.assign(ui.box.style, {
      left: left + 'px',
      top: top + 'px',
      width: Math.abs(x - dragStart.x) + 'px',
      height: Math.abs(y - dragStart.y) + 'px'
    });
  }

  async function onUp(e) {
    if (phase !== 'crop' || !dragStart) return;
    const rect = {
      x: Math.min(dragStart.x, e.clientX),
      y: Math.min(dragStart.y, e.clientY),
      width: Math.abs(e.clientX - dragStart.x),
      height: Math.abs(e.clientY - dragStart.y),
      dpr: window.devicePixelRatio || 1
    };
    dragStart = null;
    if (rect.width < 8 || rect.height < 8) {
      ui.box.hidden = true;
      ui.dim.hidden = false;
      return;
    }
    await commit(rect);
  }

  async function commit(rect) {
    // The overlay has to be off screen before the tab is captured.
    hideChrome();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    let shot = null;
    if (rect) {
      const res = await chrome.runtime.sendMessage({ type: 'CAPTURE_CROP', rect });
      shot = res && res.shot ? res.shot : null;
    }
    picked.shot = shot;
    const saved = await chrome.runtime.sendMessage({ type: 'SAVE_FONT', record: picked });

    teardown();
    buildUI();
    if (saved && saved.ok) {
      const note = picked.dataB64 ? 'saved with font file' : 'saved as image only';
      toast(`${picked.family} — ${note}`);
    } else {
      toast('Could not save. Try again.', 'bad');
    }
    picked = null;
  }

  function hideChrome() {
    ui.dim.hidden = true;
    ui.box.hidden = true;
    ui.bar.hidden = true;
    ui.outline.hidden = true;
    ui.tip.hidden = true;
  }

  /* ---------- lifecycle ---------- */

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      teardown();
      buildUI();
      toast('Cancelled', 'muted');
    } else if (e.key === 'Enter' && phase === 'crop') {
      e.preventDefault();
      commit(null);
    }
  }

  function teardown() {
    phase = null;
    hovered = null;
    dragStart = null;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('mousemove', onDrag, true);
    document.removeEventListener('mouseup', onUp, true);
    document.removeEventListener('keydown', onKey, true);
    document.documentElement.classList.remove('tl-active');
    if (ui.root && ui.root.isConnected) ui.root.remove();
  }

  function start() {
    teardown();
    buildUI();
    phase = 'pick';
    say('Click any text to save its typeface. Esc to cancel.');
    document.documentElement.classList.add('tl-active');
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('mousemove', onDrag, true);
    document.addEventListener('mouseup', onUp, true);
    document.addEventListener('keydown', onKey, true);
  }

  window.__typeLibraryStart = start;
  start();
})();
