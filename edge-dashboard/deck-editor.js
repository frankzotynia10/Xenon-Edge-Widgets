// Deck editor for the settings page: profiles, pages and folders, and each button's look and action.
// Every change saves deck.json (debounced) and the Deck on the Edge reloads.
'use strict';
(() => {
  const H = { 'content-type': 'application/json', 'x-edge-dashboard': '1' };
  const el = (t, a = {}, ...kids) => { const e = document.createElement(t); for (const [k, v] of Object.entries(a)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null) e.setAttribute(k, v); } for (const k of kids) if (k != null) e.append(k); return e; };
  const TYPES = [['', 'Nothing'], ['keys', 'Hotkey'], ['text', 'Type text'], ['open', 'Open (command line)'], ['page', 'Next / previous page'],
    ['folder', 'Open folder'], ['back', 'Back (out of a folder)'],
    ['obs', 'OBS Studio'], ['shadowplay', 'NVIDIA ShadowPlay'],
    ['edge-sleep', 'Edge sleep cover (dim the Edge)'], ['jiggler', 'Mouse jiggler: pause today / resume'], ['keylight', 'Elgato Key Light'], ['hue-scene', 'Hue scene'], ['hue-room', 'Hue room on / off'], ['huesync', 'Hue Sync start / stop'],
    ['pending', 'Placeholder (does nothing)']];
  const SP_OPS = [['save-replay', 'Save replay (last minutes)'], ['replay-toggle', 'Instant replay on/off'], ['record', 'Record start/stop'], ['screenshot', 'Screenshot'],
    ['overlay', 'Open the overlay'], ['mic', 'Microphone on/off'], ['photo-mode', 'Photo mode'], ['game-filter', 'Game filter'], ['perf-overlay', 'Performance overlay']];
  const OBS_OPS = [['record', 'Record start/stop'], ['record-pause', 'Recording pause/resume'], ['stream', 'Stream start/stop'], ['replay-buffer', 'Replay buffer on/off'],
    ['save-replay', 'Save replay'], ['virtualcam', 'Virtual camera on/off'], ['scene', 'Switch to scene'], ['mute', 'Mute/unmute an audio input']];
  const KL_OPS = [['toggle', 'On / off'], ['on', 'On'], ['off', 'Off'], ['brightness', 'Brightness step'], ['warmer', 'Warmer'], ['cooler', 'Cooler']];
  const MOD_KEYS = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' };
  const CODE_NAMES = { Comma: 'Comma', Period: 'Period', Minus: 'Minus', Equal: 'Plus', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Slash: '/', Backquote: '`',
    ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Escape: 'Esc', PageUp: 'PageUp', PageDown: 'PageDown' };

  let cfg, icons = [], cat = null, pairing = false, pi = 0, pgi = 0, sel = null, root, saveTimer;
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

  // ---------- lights: what's connected, pairing ----------
  function status(ok, textOk, textBad) { return el('span', { class: 'hint', style: `color: ${ok ? 'var(--ok)' : '#ffb35c'}` }, ok ? '● ' + textOk : '○ ' + textBad); }
  function lightsBox() {
    const box = el('div', { class: 'group' }, el('h3', {}, 'Connections'));
    if (!cat) { box.append(el('div', { class: 'empty' }, 'Looking for lights…')); return box; }
    if (!cat.keylights.length) box.append(field('Elgato Key Light', status(false, '', 'None found on the network')));
    for (const k of cat.keylights) box.append(field(k.name, status(k.reachable, `Connected (${k.ip})`, `Not answering (${k.ip || 'no address'})`)));
    const h = cat.hue;
    let hueCtl;
    if (h.paired) hueCtl = status(!cat.error, `Paired (${h.ip})`, cat.error || 'Paired, but not answering');
    else if (h.found) hueCtl = el('span', { class: 'ctl' }, status(false, '', 'Found, not paired'),
      el('button', { class: 'small', onclick: pairHue, disabled: pairing ? '' : null }, pairing ? 'Waiting for the link button…' : 'Pair'));
    else hueCtl = status(false, '', 'No bridge found on the network');
    box.append(field('Philips Hue bridge', hueCtl, h.paired ? null : 'To pair: press the round link button on top of the bridge, then click Pair within 30 seconds.'));
    const hs = cat.huesync;
    box.append(field('Hue Sync app', status(hs.connected, hs.state === 'syncing' ? 'Connected, syncing' : 'Connected', 'Not reachable'),
      hs.connected ? null : 'Start Hue Sync and turn on Settings → Third-party control.'));
    // OBS: password field (never filled back in; the server keeps it)
    const o = cat.obs || {};
    const pw = el('input', { type: 'password', placeholder: o.hasPassword ? 'Saved (type to change)' : 'WebSocket password', autocomplete: 'off' });
    const saveObs = async () => {
      window.toast && window.toast('Connecting to OBS…');
      const r = await (await fetch('/api/obs/config', { method: 'POST', headers: H, body: JSON.stringify(pw.value ? { password: pw.value } : {}) })).json();   // empty box: keep the saved one, just reconnect
      cat.obs = r; draw();
      window.toast && window.toast(r.connected ? 'OBS connected' : (r.error || 'OBS not reachable (is it running?)'));
    };
    pw.addEventListener('keydown', e => { if (e.key === 'Enter') saveObs(); });
    box.append(field('OBS Studio', el('span', { class: 'ctl' },
      status(o.connected, `Connected (${(o.scenes || []).length} scenes)`, o.error || 'Not connected (is OBS running?)'), pw, el('button', { class: 'small', onclick: saveObs }, 'Save')),
      o.connected ? null : 'In OBS: Tools → WebSocket Server Settings → Enable, then Show Connect Info and copy the password here.'));
    box.append(el('div', { class: 'row' }, el('span', { class: 'spacer' }),
      el('button', { class: 'small', onclick: async () => { cat = null; draw(); cat = await (await fetch('/api/lights/discover', { method: 'POST', headers: H, body: '{}' })).json(); draw(); } }, 'Search again')));
    return box;
  }
  async function pairHue() {
    pairing = true; draw();
    window.toast && window.toast('Press the link button on the Hue bridge');
    const r = await (await fetch('/api/lights/pair-hue', { method: 'POST', headers: H, body: '{}' })).json();
    pairing = false;
    window.toast && window.toast(r.ok ? 'Hue bridge paired' : (r.error || 'The link button wasn’t pressed in time'));
    cat = await (await fetch('/api/lights/catalog')).json(); draw();
  }

  // Fields for a light action.
  function lightFields(box, a) {
    const c = cat || { keylights: [], rooms: [], scenes: [], hue: {} };
    if (a.type === 'keylight') {
      box.append(field('Light', select([['all', 'All Key Lights'], ...c.keylights.map(k => [k.id, k.name])], a.light || 'all', v => { a.light = v; changed(false); })));
      box.append(field('Does', select(KL_OPS, a.op || 'toggle', v => { a.op = v; if (v === 'brightness') a.step = a.step || 10; if (v === 'warmer' || v === 'cooler') a.step = 20; changed(); })));
      if (a.op === 'brightness') box.append(field('Step', num(a.step || 10, -50, 50, v => { a.step = v; changed(false); }), 'Percent per tap. Negative dims.'));
    }
    if (a.type === 'hue-room' || a.type === 'hue-scene') {
      if (!c.hue.paired) { box.append(field('Hue', el('span', { class: 'hint' }, 'Pair the Hue bridge first (Lights, above).'))); return; }
    }
    if (a.type === 'hue-room') {
      box.append(field('Room', select([['', 'Pick a room'], ...c.rooms.map(r => [r.id, r.name])], a.room, v => { a.room = v; changed(false); })));
      box.append(field('Does', select([['toggle', 'On / off'], ['on', 'On'], ['off', 'Off']], a.op || 'toggle', v => { a.op = v; changed(false); })));
    }
    if (a.type === 'hue-scene') {
      const s = el('select');
      s.append(el('option', { value: '' }, 'Pick a scene'));
      const groups = {};
      for (const sc of c.scenes) (groups[sc.roomName || 'Other'] = groups[sc.roomName || 'Other'] || []).push(sc);
      for (const [room, list] of Object.entries(groups)) { const og = el('optgroup', { label: room }); for (const sc of list) og.append(el('option', { value: sc.id }, sc.name)); s.append(og); }
      s.value = a.scene || '';
      s.addEventListener('change', () => { const sc = c.scenes.find(x => x.id === s.value); a.scene = s.value; a.room = sc && sc.room; changed(false); });
      box.append(field('Scene', s));
    }
    if (a.type === 'shadowplay') {
      box.append(field('Does', select(SP_OPS, a.op || 'save-replay', v => { a.op = v; changed(false); }), 'Sends the hotkey set in the NVIDIA App (Alt+F10 etc.), read when you tap.'));
    }
    if (a.type === 'obs') {
      const o = c.obs || {};
      box.append(field('Does', select(OBS_OPS, a.op || 'record', v => { a.op = v; changed(); })));
      const list = (items, cur) => [...(items || []).map(x => [x, x]), ...(cur && !(items || []).includes(cur) ? [[cur, cur + ' (not in OBS now)']] : [])];
      if (a.op === 'scene') box.append(field('Scene', o.connected || a.scene ? select([['', 'Pick a scene'], ...list(o.scenes, a.scene)], a.scene || '', v => { a.scene = v; changed(false); }) : el('span', { class: 'hint' }, 'Start OBS to pick a scene.')));
      if (a.op === 'mute') box.append(field('Input', o.connected || a.input ? select([['', 'Pick an input'], ...list(o.inputs, a.input)], a.input || '', v => { a.input = v; changed(false); }) : el('span', { class: 'hint' }, 'Start OBS to pick an input.')));
    }
    if (a.type === 'huesync') {
      box.append(field('Does', select([['toggle', 'Start / stop'], ['start', 'Start'], ['stop', 'Stop']], a.op || 'toggle', v => { a.op = v; changed(false); })));
      box.append(field('Mode', select([['games', 'Games'], ['video', 'Video'], ['music', 'Music']], a.mode || 'games', v => { a.mode = v; changed(false); })));
      box.append(field('Intensity', select([['subtle', 'Subtle'], ['moderate', 'Moderate'], ['high', 'High'], ['extreme', 'Extreme']], a.intensity || 'moderate', v => { a.intensity = v; changed(false); })));
    }
  }

  // ---------- the editor ----------
  function draw() {
    const scrollY = window.scrollY;
    root.replaceChildren();
    const pr = prof(), pg = page(), g = grid();
    root.append(lightsBox());

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
    if (pg.folder) pageBox.append(field('Go back after', el('span', { class: 'ctl' },
      num(pg.returnAfter ?? 15, 0, 600, v => { pg.returnAfter = v; changed(false); }), el('span', { class: 'hint' }, 'seconds')),
      'With no taps, the folder goes back to the page it was opened from. 0 stays put.'));
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
      lightFields(bbox, a);
      if (a.type === 'edge-sleep') bbox.append(field('Does', select([['toggle', 'Sleep / wake'], ['sleep', 'Sleep'], ['wake', 'Wake']], a.op || 'toggle', v => { a.op = v; changed(false); }), 'Needs the Edge helper running. Tap the cover to wake it.'));
      if (a.type === 'pending') bbox.append(field('For', text(a.what, v => { a.what = v; changed(false); }, { placeholder: 'Philips Hue' }), 'Shows dimmed and does nothing.'));
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
    fetch('/api/lights/catalog').then(r => r.json()).then(c => { cat = c; draw(); }).catch(() => {});
  }

  window.deckEditor = async container => {
    root = el('div', { class: 'deck-editor' });
    container.append(root);
    await load();
  };
})();
