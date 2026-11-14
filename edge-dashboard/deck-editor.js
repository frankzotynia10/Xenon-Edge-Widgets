// Deck editor for the settings page: profiles, pages and folders, and each button's look and action.
// Every change saves deck.json (debounced) and the Deck on the Edge reloads.
'use strict';
(() => {
  const H = { 'content-type': 'application/json', 'x-edge-dashboard': '1' };
  const el = (t, a = {}, ...kids) => { const e = document.createElement(t); for (const [k, v] of Object.entries(a)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null) e.setAttribute(k, v); } for (const k of kids) if (k != null) e.append(k); return e; };
  const TYPES = [['', 'Nothing'], ['keys', 'Hotkey'], ['text', 'Type text'], ['open', 'Open (command line)'], ['page', 'Next / previous page'],
    ['folder', 'Open folder'], ['back', 'Back (out of a folder)'], ['pending', 'Coming later (Hue, Key Light)']];
  const MOD_KEYS = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' };
  const CODE_NAMES = { Comma: 'Comma', Period: 'Period', Minus: 'Minus', Equal: 'Plus', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Slash: '/', Backquote: '`',
    ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Escape: 'Esc', PageUp: 'PageUp', PageDown: 'PageDown' };

  let cfg, icons = [], pi = 0, pgi = 0, sel = null, root, saveTimer;
  const prof = () => cfg.profiles[pi];
  const page = () => prof().pages[pgi];
  const grid = () => prof().grid || cfg.grid || { cols: 5, rows: 3 };
  const uid = () => Math.random().toString(36).slice(2, 10);

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const r = await fetch('/api/deck', { method: 'POST', headers: H, body: JSON.stringify(cfg) });
      window.toast && window.toast(r.ok ? 'Saved' : 'Could not save');
    }, 350);
  }
  const changed = (rerender = true) => { save(); if (rerender) draw(); };

  // ---------- pieces ----------
  function field(label, input, hint) {
    return el('div', { class: 'row' }, el('label', {}, label, hint ? el('div', { class: 'hint' }, hint) : null), el('span', { class: 'ctl' }, input));
  }
  function text(value, onChange, attrs = {}) {
    const i = el('input', { type: 'text', ...attrs }); i.value = value ?? '';
    i.addEventListener('change', () => onChange(i.value));
    return i;
  }
  function select(options, value, onChange) {
    const s = el('select');
    for (const [v, label] of options) { const o = el('option', { value: v }); o.textContent = label; s.append(o); }
    s.value = value ?? '';
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }
  function num(value, min, max, onChange) {
    const i = el('input', { type: 'number', min, max, class: 'num' }); i.value = value;
    i.addEventListener('change', () => onChange(Math.max(min, Math.min(max, Number(i.value) || min))));
    return i;
  }
  const iconUrl = rel => '/deck-icon/' + encodeURIComponent(rel);

  // Hotkey box: type a combo like Ctrl+Alt+Shift+F1, or press Record and press the keys.
  function keysInput(a) {
    const i = text(a.keys, async v => { a.keys = v; await check(); changed(false); }, { placeholder: 'Ctrl+Alt+Shift+F1' });
    const status = el('span', { class: 'hint' });
    async function check() {
      if (!i.value) { status.textContent = ''; return; }
      const r = await (await fetch('/api/deck/check-keys', { method: 'POST', headers: H, body: JSON.stringify({ keys: i.value }) })).json();
      status.textContent = r.ok ? '✓' : r.error; status.style.color = r.ok ? 'var(--ok)' : '#ff6b6b';
      if (r.ok && r.keys !== i.value) { i.value = r.keys; a.keys = r.keys; }
    }
    const rec = el('button', { class: 'small', onclick: () => {
      rec.textContent = 'Press keys…'; i.value = '';
      const onKey = e => {
        e.preventDefault(); e.stopPropagation();
        if (MOD_KEYS[e.key]) return;   // wait for the main key
        const parts = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Win'].filter(Boolean);
        let k = e.code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad(\d)$/, 'Numpad$1');
        k = CODE_NAMES[e.code] || k;
        parts.push(k);
        i.value = parts.join('+'); a.keys = i.value;
        window.removeEventListener('keydown', onKey, true); rec.textContent = 'Record';
        check(); changed(false);
      };
      window.addEventListener('keydown', onKey, true);
    } }, 'Record');
    setTimeout(check);
    return el('span', { class: 'ctl' }, i, rec, status);
  }

  function iconPicker(b) {
    const wrap = el('div', { class: 'icons' });
    const none = el('button', { class: 'ico none' + (!b.icon ? ' on' : ''), title: 'No image', onclick: () => { delete b.icon; changed(); } }, 'None');
    wrap.append(none);
    for (const rel of icons) {
      wrap.append(el('button', { class: 'ico' + (b.icon === rel ? ' on' : ''), title: rel, onclick: () => { b.icon = rel; changed(); } }, el('img', { src: iconUrl(rel), loading: 'lazy' })));
    }
    return el('details', { class: 'iconbox' }, el('summary', {}, b.icon ? 'Change image' : 'Pick an image'), wrap);
  }

  // ---------- the editor ----------
  function draw() {
    const scrollY = window.scrollY;
    root.replaceChildren();
    const pr = prof(), pg = page(), g = grid();

    // Profiles
    const profBox = el('div', { class: 'group' }, el('h3', {}, 'Profile'));
    profBox.append(field('Profile', el('span', { class: 'ctl' },
      select(cfg.profiles.map((p, i) => [String(i), p.name]), String(pi), v => { pi = Number(v); pgi = 0; sel = null; draw(); }),
      el('button', { class: 'small', onclick: () => { cfg.profiles.push({ id: 'p' + uid(), name: 'New profile', apps: [], grid: { cols: 5, rows: 3 }, pages: [{ id: uid(), name: 'Main', buttons: {} }] }); pi = cfg.profiles.length - 1; pgi = 0; sel = null; changed(); } }, 'New'),
      cfg.profiles.length > 1 ? el('button', { class: 'small danger', onclick: () => { if (confirm(`Delete the profile "${pr.name}" and all its buttons?`)) { cfg.profiles.splice(pi, 1); pi = 0; pgi = 0; sel = null; changed(); } } }, 'Delete') : null)));
    profBox.append(field('Name', text(pr.name, v => { pr.name = v || 'Profile'; changed(); })));
    profBox.append(field('Show when these apps are in front', text((pr.apps || []).join(', '), v => { pr.apps = v.split(',').map(s => s.trim().replace(/\.exe$/i, '')).filter(Boolean); changed(false); }, { placeholder: 'Wow, Discord' }),
      pi === 0 ? 'The first profile shows when no other profile matches.' : 'Process names, e.g. Wow for World of Warcraft.'));
    profBox.append(field('Grid', el('span', { class: 'ctl' },
      num(g.cols, 2, 8, v => { pr.grid = { ...g, cols: v }; changed(); }), el('span', { class: 'hint' }, 'columns ×'),
      num(g.rows, 1, 6, v => { pr.grid = { ...g, rows: v }; changed(); }), el('span', { class: 'hint' }, 'rows'))));
    root.append(profBox);

    // Pages
    const pageBox = el('div', { class: 'group' }, el('h3', {}, 'Page'));
    pageBox.append(field('Page', el('span', { class: 'ctl' },
      select(pr.pages.map((p, i) => [String(i), (p.folder ? '📁 ' : '') + p.name]), String(pgi), v => { pgi = Number(v); sel = null; draw(); }),
      el('button', { class: 'small', onclick: () => { pr.pages.push({ id: uid(), name: `Page ${pr.pages.filter(p => !p.folder).length + 1}`, buttons: {} }); pgi = pr.pages.length - 1; sel = null; changed(); } }, 'New page'),
      el('button', { class: 'small', onclick: () => { pr.pages.push({ id: uid(), name: 'Folder', folder: true, buttons: { '0,0': { title: '', action: { type: 'back' } } } }); pgi = pr.pages.length - 1; sel = null; changed(); } }, 'New folder'),
      pr.pages.length > 1 ? el('button', { class: 'small danger', onclick: () => { if (confirm(`Delete "${pg.name}" and its buttons?`)) { pr.pages.splice(pgi, 1); pgi = 0; sel = null; changed(); } } }, 'Delete') : null)));
    pageBox.append(field('Name', text(pg.name, v => { pg.name = v || 'Page'; changed(); })));
    pageBox.append(field('Folder', (() => { const c = el('input', { type: 'checkbox' }); c.checked = !!pg.folder; c.addEventListener('change', () => { pg.folder = c.checked || undefined; changed(); }); return el('label', { class: 'switch' }, c, el('span')); })(),
      'A folder only opens from a button. Pages are swiped through.'));
    root.append(pageBox);

    // Buttons grid
    const gbox = el('div', { class: 'group' }, el('h3', {}, 'Buttons'), el('div', { class: 'hint pad' }, 'Click a button to edit it. Drag one onto another to swap them.'));
    const gridEl = el('div', { class: 'deckgrid', style: `grid-template-columns: repeat(${g.cols}, 92px)` });
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
      const pos = `${c},${r}`, b = pg.buttons[pos];
      const a = (b && b.action) || {};
      const cell = el('div', { class: 'dkey' + (b ? '' : ' blank') + (sel === pos ? ' sel' : '') + (a.type === 'pending' ? ' pend' : ''), draggable: b ? 'true' : null,
        onclick: () => { if (!b) pg.buttons[pos] = { title: '', action: null }; sel = pos; draw(); } });
      if (b && b.icon) cell.append(el('img', { src: iconUrl(b.icon) }));
      else if (b && a.type === 'text') cell.append(el('div', { class: 'tx' }, a.text));
      else if (!b) cell.append(el('div', { class: 'plus' }, '+'));
      if (b) cell.append(el('div', { class: 'lb' }, b.title || (a.type === 'keys' ? a.keys.replace('Ctrl+Alt+Shift+', 'CAS+') : a.type === 'folder' ? '📁' : a.type === 'back' ? '←' : a.type === 'page' ? (a.step < 0 ? '‹ page' : 'page ›') : '')));
      cell.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', pos));
      cell.addEventListener('dragover', e => e.preventDefault());
      cell.addEventListener('drop', e => {
        e.preventDefault();
        const from = e.dataTransfer.getData('text/plain'); if (!from || from === pos) return;
        const x = pg.buttons[from], y = pg.buttons[pos];
        if (y) pg.buttons[from] = y; else delete pg.buttons[from];
        pg.buttons[pos] = x; sel = pos; changed();
      });
      gridEl.append(cell);
    }
    gbox.append(el('div', { class: 'pad' }, gridEl));
    root.append(gbox);

    // Selected button
    const b = sel && pg.buttons[sel];
    if (b) {
      const a = b.action || {};
      const bbox = el('div', { class: 'group' }, el('h3', {}, `Button ${sel.replace(',', ' / ')}`));
      bbox.append(field('Title', text(b.title, v => { b.title = v; changed(); }, { placeholder: 'Shown on the button' })));
      bbox.append(field('Image', iconPicker(b)));
      bbox.append(field('Action', select(TYPES, a.type || '', v => { b.action = v ? { type: v, ...(v === 'page' ? { step: 1 } : {}), ...(v === 'folder' ? { page: (pr.pages.find(p => p.folder) || {}).id } : {}) } : null; changed(); })));
      if (a.type === 'keys') bbox.append(field('Keys', keysInput(a), 'Sent to the app in front. Ctrl+Alt+Shift combos stay clear of normal binds.'));
      if (a.type === 'text') {
        bbox.append(field('Text', text(a.text, v => { a.text = v; changed(); }, { placeholder: 'Typed as-is, emoji too' })));
        const c = el('input', { type: 'checkbox' }); c.checked = !!a.enter; c.addEventListener('change', () => { a.enter = c.checked; changed(false); });
        bbox.append(field('Press Enter after', el('label', { class: 'switch' }, c, el('span'))));
      }
      if (a.type === 'open') bbox.append(field('Command line', text(a.command, v => { a.command = v; changed(false); }, { placeholder: 'powershell.exe -NoExit -Command "ssh me@server"', class: 'wide' }), 'Started like Run (Win+R).'));
      if (a.type === 'page') bbox.append(field('Direction', select([['1', 'Next page'], ['-1', 'Previous page']], String(a.step || 1), v => { a.step = Number(v); changed(); })));
      if (a.type === 'folder') {
        const folders = pr.pages.filter(p => p.folder);
        bbox.append(field('Folder', folders.length ? select(folders.map(p => [p.id, p.name]), a.page, v => { a.page = v; changed(false); }) : el('span', { class: 'hint' }, 'Make a folder first (Page → New folder).')));
      }
      if (a.type === 'pending') bbox.append(field('For', text(a.what, v => { a.what = v; changed(false); }, { placeholder: 'Philips Hue' }), 'Shows dimmed until this kind of button is supported.'));
      bbox.append(el('div', { class: 'row' }, el('span', { class: 'spacer' }),
        el('button', { class: 'small danger', onclick: () => { delete pg.buttons[sel]; sel = null; changed(); } }, 'Remove button')));
      root.append(bbox);
    }

    // Tools
    root.append(el('div', { class: 'group' }, el('h3', {}, 'Import'),
      el('div', { class: 'row' }, el('label', {}, 'Import from Stream Deck', el('div', { class: 'hint' }, 'Replaces this deck with the Virtual Stream Deck profiles from the Edge, with their images.')),
        el('span', { class: 'ctl' }, el('button', { class: 'small', onclick: importSD }, 'Import')))));
    window.scrollTo(0, scrollY);
  }

  async function importSD() {
    if (!confirm('Replace the whole deck with your Stream Deck profiles?')) return;
    const r = await fetch('/api/deck/import-streamdeck', { method: 'POST', headers: H, body: '{}' });
    const j = await r.json();
    if (!r.ok) return window.toast && window.toast('Import failed: ' + (j.error || r.status));
    await load(); window.toast && window.toast('Imported ' + j.profiles.join(', '));
  }

  async function load() {
    const [d, list] = await Promise.all([fetch('/api/deck').then(r => r.json()), fetch('/api/deck/icons').then(r => r.json())]);
    cfg = d.config; icons = list;
    pi = Math.min(pi, cfg.profiles.length - 1); pgi = Math.min(pgi, prof().pages.length - 1);
    draw();
  }

  window.deckEditor = async container => {
    root = el('div', { class: 'deck-editor' });
    container.append(root);
    await load();
  };
})();
