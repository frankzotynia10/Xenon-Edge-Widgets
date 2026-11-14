// Layout editor for the settings page: which widget goes where on each page of the Edge.
// The screen is a 3 x 2 grid of iCUE-sized cells (840 x 344, 10 px apart, rows 16 px apart). A widget
// takes a block of cells: S 1x1, Wide 2x1, M 1x2, L 2x2, Strip 3x1, Full 3x2. Nothing changes on the Edge
// until you press Save; then it's written to layout.json and the dashboard reloads.
'use strict';
(() => {
  const H = { 'content-type': 'application/json', 'x-edge-dashboard': '1' };
  const el = (t, a = {}, ...kids) => { const e = document.createElement(t); for (const [k, v] of Object.entries(a)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null) e.setAttribute(k, v); } for (const k of kids) if (k != null) e.append(k); return e; };
  const COLS = 3, ROWS = 2;
  const SIZES = [['S', 1, 1, 'S (840 × 344)'], ['Wide', 2, 1, 'Wide (1690 × 344)'], ['M', 1, 2, 'M (840 × 704)'], ['L', 2, 2, 'L (1690 × 704)'],
    ['Strip', 3, 1, 'Strip (2540 × 344)'], ['Full', 3, 2, 'Full (2540 × 704)']];
  const COLORS = ['#5865F2', '#23a55a', '#f0b232', '#eb459e', '#00a8fc', '#f26522', '#9b84ee', '#3ba55c', '#e67e22'];

  const toPx = (c, r, cw, rh) => ({ x: 10 + c * 850, y: 8 + r * 360, w: cw * 840 + (cw - 1) * 10, h: rh * 344 + (rh - 1) * 16 });
  // Pixel slot -> grid cells, or null if it isn't on the grid (hand-made layouts).
  function toCells(it) {
    const c = (it.x - 10) / 850, r = (it.y - 8) / 360, cw = (it.w + 10) / 850, rh = (it.h + 16) / 360;
    return [c, r, cw, rh].every(Number.isInteger) ? { c, r, cw, rh } : null;
  }
  const sizeName = (cw, rh) => (SIZES.find(s => s[1] === cw && s[2] === rh) || [`${cw}x${rh}`])[0];

  let layout, widgets = [], pi = 0, sel = null, dirty = false, root;
  const page = () => layout.pages[pi];
  const nameOf = id => (widgets.find(w => w.id === id) || {}).name || id;
  const colorOf = id => COLORS[Math.max(0, widgets.findIndex(w => w.id === id)) % COLORS.length];

  // Which cells are taken on this page (ignoring one item, e.g. the one being moved).
  function taken(skip) {
    const t = new Set();
    page().items.forEach((it, i) => { if (i === skip) return; const g = toCells(it); if (!g) return; for (let c = g.c; c < g.c + g.cw; c++) for (let r = g.r; r < g.r + g.rh; r++) t.add(c + ',' + r); });
    return t;
  }
  function fits(c, r, cw, rh, skip) {
    if (c + cw > COLS || r + rh > ROWS) return false;
    const t = taken(skip);
    for (let x = c; x < c + cw; x++) for (let y = r; y < r + rh; y++) if (t.has(x + ',' + y)) return false;
    return true;
  }
  const change = () => { dirty = true; draw(); };

  function draw() {
    root.replaceChildren();
    const pg = page();

    // pages
    const bar = el('div', { class: 'group' }, el('h3', {}, 'Pages'));
    const tabs = el('div', { class: 'lt-tabs' });
    layout.pages.forEach((p, i) => tabs.append(el('button', { class: 'lt-tab' + (i === pi ? ' on' : ''), onclick: () => { pi = i; sel = null; draw(); } }, `${i + 1}. ${p.name}`)));
    tabs.append(el('button', { class: 'small', onclick: () => { layout.pages.push({ name: `Page ${layout.pages.length + 1}`, items: [] }); pi = layout.pages.length - 1; sel = null; change(); } }, '+ Page'));
    bar.append(el('div', { class: 'pad' }, tabs));
    const nameIn = el('input', { type: 'text' }); nameIn.value = pg.name;
    nameIn.addEventListener('change', () => { pg.name = nameIn.value || 'Page'; change(); });
    bar.append(el('div', { class: 'row' }, el('label', {}, 'Name'), el('span', { class: 'ctl' }, nameIn,
      el('button', { class: 'small', title: 'Move left', onclick: () => { if (pi > 0) { [layout.pages[pi - 1], layout.pages[pi]] = [layout.pages[pi], layout.pages[pi - 1]]; pi--; change(); } } }, '◀'),
      el('button', { class: 'small', title: 'Move right', onclick: () => { if (pi < layout.pages.length - 1) { [layout.pages[pi + 1], layout.pages[pi]] = [layout.pages[pi], layout.pages[pi + 1]]; pi++; change(); } } }, '▶'),
      layout.pages.length > 1 ? el('button', { class: 'small danger', onclick: () => { if (confirm(`Delete the page "${pg.name}"?`)) { layout.pages.splice(pi, 1); pi = 0; sel = null; change(); } } }, 'Delete page') : null)));
    root.append(bar);

    // the screen
    const box = el('div', { class: 'group' }, el('h3', {}, 'Screen'), el('div', { class: 'hint pad' }, 'Click an empty spot to add a widget. Click a widget to change it, or drag it somewhere free. The first page is the one the dashboard opens on.'));
    const screen = el('div', { class: 'lt-screen' });
    const S = 0.34;   // 2560 x 720 drawn at 870 x 245
    const t = taken(-1);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const px = toPx(c, r, 1, 1);
      const cell = el('div', { class: 'lt-cell' + (t.has(c + ',' + r) ? ' used' : ''), style: `left:${px.x * S}px;top:${px.y * S}px;width:${px.w * S}px;height:${px.h * S}px` }, t.has(c + ',' + r) ? null : '+');
      cell.addEventListener('click', () => { sel = { add: true, c, r }; draw(); });
      cell.addEventListener('dragover', e => e.preventDefault());
      cell.addEventListener('drop', e => {
        e.preventDefault();
        const i = Number(e.dataTransfer.getData('text/plain')); const it = pg.items[i]; const g = toCells(it) || { cw: 1, rh: 1 };
        if (!fits(c, r, g.cw, g.rh, i)) return window.toast && window.toast("It doesn't fit there");
        Object.assign(it, toPx(c, r, g.cw, g.rh)); sel = { i }; change();
      });
      screen.append(cell);
    }
    pg.items.forEach((it, i) => {
      const g = toCells(it);
      const b = el('div', { class: 'lt-item' + (sel && sel.i === i ? ' sel' : '') + (g ? '' : ' off'), draggable: g ? 'true' : null,
        style: `left:${it.x * S}px;top:${it.y * S}px;width:${it.w * S}px;height:${it.h * S}px;--c:${colorOf(it.widget)}` },
        el('b', {}, nameOf(it.widget)), el('span', {}, g ? sizeName(g.cw, g.rh) : 'custom spot'));
      b.addEventListener('click', e => { e.stopPropagation(); sel = { i }; draw(); });
      b.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', String(i)));
      screen.append(b);
    });
    box.append(el('div', { class: 'pad' }, screen));
    root.append(box);

    // add / edit panel
    if (sel && sel.add) {
      const opts = SIZES.filter(s => fits(sel.c, sel.r, s[1], s[2], -1));
      const wSel = el('select'); widgets.forEach(w => wSel.append(el('option', { value: w.id }, w.name)));
      const sSel = el('select'); opts.forEach(s => sSel.append(el('option', { value: s[0] }, s[3])));
      root.append(el('div', { class: 'group' }, el('h3', {}, 'Add a widget here'),
        el('div', { class: 'row' }, el('label', {}, 'Widget'), el('span', { class: 'ctl' }, wSel)),
        el('div', { class: 'row' }, el('label', {}, 'Size'), el('span', { class: 'ctl' }, sSel)),
        el('div', { class: 'row' }, el('span', { class: 'spacer' }),
          el('button', { class: 'small', onclick: () => { sel = null; draw(); } }, 'Cancel'),
          el('button', { class: 'small primary', onclick: () => {
            const s = SIZES.find(x => x[0] === sSel.value);
            pg.items.push({ widget: wSel.value, ...toPx(sel.c, sel.r, s[1], s[2]) }); sel = { i: pg.items.length - 1 }; change();
          } }, 'Add'))));
    } else if (sel && pg.items[sel.i]) {
      const it = pg.items[sel.i], g = toCells(it);
      const wSel = el('select'); widgets.forEach(w => wSel.append(el('option', { value: w.id }, w.name))); wSel.value = it.widget;
      wSel.addEventListener('change', () => { it.widget = wSel.value; change(); });
      const rows = [el('div', { class: 'row' }, el('label', {}, 'Widget'), el('span', { class: 'ctl' }, wSel))];
      if (g) {
        const sSel = el('select');
        SIZES.filter(s => fits(g.c, g.r, s[1], s[2], sel.i)).forEach(s => sSel.append(el('option', { value: s[0] }, s[3])));
        sSel.value = sizeName(g.cw, g.rh);
        sSel.addEventListener('change', () => { const s = SIZES.find(x => x[0] === sSel.value); Object.assign(it, toPx(g.c, g.r, s[1], s[2])); change(); });
        rows.push(el('div', { class: 'row' }, el('label', {}, 'Size', el('div', { class: 'hint' }, 'Only sizes that fit from this spot. Move it to make room for bigger ones.')), el('span', { class: 'ctl' }, sSel)));
      } else rows.push(el('div', { class: 'row' }, el('label', {}, 'Position', el('div', { class: 'hint' }, `A custom spot from layout.json (${it.x}, ${it.y}, ${it.w} × ${it.h}).`))));
      rows.push(el('div', { class: 'row' }, el('span', { class: 'spacer' }), el('button', { class: 'small danger', onclick: () => { pg.items.splice(sel.i, 1); sel = null; change(); } }, 'Remove from this page')));
      root.append(el('div', { class: 'group' }, el('h3', {}, nameOf(it.widget)), ...rows));
    }

    // save
    root.append(el('div', { class: 'lt-save' },
      el('span', { class: 'hint' }, dirty ? 'Not saved yet.' : 'Saved.'),
      el('button', { class: 'small', disabled: dirty ? null : '', onclick: load }, 'Undo changes'),
      el('button', { class: 'small primary', disabled: dirty ? null : '', onclick: save }, 'Save and show on the Edge')));
  }

  async function save() {
    const r = await fetch('/api/layout', { method: 'POST', headers: H, body: JSON.stringify({ pages: layout.pages }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return window.toast && window.toast('Could not save: ' + (j.error || r.status));
    dirty = false; draw(); window.toast && window.toast('Saved. The Edge is reloading.');
  }

  async function load() {
    const [l, w] = await Promise.all([fetch('/layout.json', { cache: 'no-store' }).then(r => r.json()), fetch('/api/widgets').then(r => r.json())]);
    layout = l; widgets = w.map(x => ({ id: x.id, name: x.name }));
    pi = Math.min(pi, layout.pages.length - 1); sel = null; dirty = false;
    draw();
  }

  window.layoutEditor = async container => {
    root = el('div', { class: 'layout-editor' });
    container.append(root);
    await load();
  };
})();
