// Imports the Stream Deck profiles you had on the Edge (the Virtual Stream Deck, "VSD2") into deck.json.
//   node import-streamdeck.js            write deck.json (replaces it) and copy the key images to deck-icons/
//   node import-streamdeck.js --dry-run  print what it would import
// What comes over:
//   hotkeys, text, Open (command lines), volume keys, pages, folders and Back
//   Philips Hue scenes and room power, Elgato Key Light (power, brightness, warmer/cooler) and Hue Sync start/stop
//   Discord, weather and other plugin keys are left out
//   node import-streamdeck.js --upgrade-lights   only fill in light buttons that an older import left as placeholders
'use strict';
const fs = require('fs');
const path = require('path');
const { VK, keysName } = require('./deck');

const PROFILES = path.join(process.env.APPDATA || '', 'Elgato', 'StreamDeck', 'ProfilesV3');
const DECK = path.join(__dirname, 'deck.json');
const ICONS = path.join(__dirname, 'deck-icons');

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const shortId = uuid => String(uuid).toLowerCase().slice(0, 8);
const cleanTitle = t => String(t || '').replace(/\s+/g, ' ').trim();

// Stream Deck 7 (V3) hotkeys: KeyModifiers bits 1 Shift, 2 Ctrl, 4 Alt, 8 Win. Older ones use KeyCtrl/KeyOption/KeyShift/KeyCmd.
function hotkey(h) {
  if (!h) return null;
  let vk, ctrl, alt, shift, win;
  if ('VKeyCode' in h) { vk = h.VKeyCode; const m = h.KeyModifiers || 0; shift = m & 1; ctrl = m & 2; alt = m & 4; win = m & 8; }
  else { vk = h.NativeCode; ctrl = h.KeyCtrl; alt = h.KeyOption; shift = h.KeyShift; win = h.KeyCmd; }
  if (vk == null || vk < 0 || vk === 146) return null;   // 146 = Stream Deck's "no key"
  const vks = [ctrl && VK.ctrl, alt && VK.alt, shift && VK.shift, win && VK.win, vk].filter(Boolean);
  return keysName(vks);
}

const MEDIA = { 4: 'VolumeMute', 5: 'VolumeUp', 6: 'VolumeDown' };
const PENDING = [[/philipshue|philips-hue/, 'Philips Hue'], [/controlcenter/, 'Elgato Key Light'], [/huesync/, 'Hue Sync']];

// Elgato's Philips Hue, Control Center (Key Light) and Hue Sync keys. They store Hue API v2 ids and the
// Key Light's MAC address, so they map straight onto our light actions.
function convertLight(u, s, title) {
  const mac = (/\(([0-9A-F:]{17})\)/i.exec(s.deviceID || '') || [])[1];
  if (/philipshue\.scene$/.test(u) && s.scene) return { action: { type: 'hue-scene', scene: s.scene, room: s.id } };
  if (/philipshue\.power$/.test(u) && s.id) return { action: { type: 'hue-room', room: s.id, op: 'toggle' }, title: title || String(s.name || '').replace(/^.*’s |^.*'s /, '') };
  if (/controlcenter\.lights-on-off$/.test(u)) return { action: { type: 'keylight', light: mac || 'all', op: 'toggle' }, title: title || 'Key Light' };
  if (/controlcenter\.brightness-stepper$/.test(u)) {
    const up = s.step === '1';   // the key with step "1" was the brighter one on this deck
    return { action: { type: 'keylight', light: mac || 'all', op: 'brightness', step: (up ? 1 : -1) * Number((s.lights || {}).brightness || 10) }, title: up ? 'Bright +' : 'Bright −' };
  }
  if (/controlcenter\.temperature-stepper$/.test(u)) {
    const warm = /warm/i.test(title) || (!/cool/i.test(title) && s.step !== '2');
    return { action: { type: 'keylight', light: mac || 'all', op: warm ? 'warmer' : 'cooler', step: 20 }, title: warm ? 'Warmer' : 'Cooler' };
  }
  if (/huesync\.huesyncstartstop$/.test(u)) return { action: { type: 'huesync', op: 'toggle', mode: s.mode || 'games', intensity: s.intensity || 'moderate' }, title: 'Hue Sync' };
  return null;
}

function convertAction(a, notes) {
  const u = a.UUID || '';
  const s = a.Settings || {};
  const st = (a.States || [])[0] || {};
  const light = convertLight(u, s, cleanTitle(String(st.Title || '').split('|')[0]));
  if (light) { a._title = light.title; return light.action; }
  if (/system\.hotkey$/.test(u)) { const k = hotkey((s.Hotkeys || [])[0]); return k ? { type: 'keys', keys: k } : null; }
  if (/page\.next$/.test(u)) return { type: 'page', step: 1 };
  if (/page\.previous$/.test(u)) return { type: 'page', step: -1 };
  if (/profile\.openchild$/.test(u)) return { type: 'folder', page: shortId(s.ProfileUUID) };
  if (/profile\.backtoparent$/.test(u)) return { type: 'back' };
  if (/system\.open$/.test(u)) return { type: 'open', command: s.path };
  if (/system\.text$/.test(u)) return { type: 'text', text: s.pastedText || '', enter: !!s.isSendingEnter };
  if (/system\.multimedia$/.test(u)) return MEDIA[s.actionIdx] ? { type: 'keys', keys: MEDIA[s.actionIdx] } : undefined;
  for (const [re, what] of PENDING) if (re.test(u)) return { type: 'pending', what };
  notes.add(u.replace(/^com\./, ''));
  return undefined;   // left out
}

function readDeck(dir, dry) {
  const root = readJson(path.join(dir, 'manifest.json'));
  const pageIds = ((root.Pages && root.Pages.Pages) || []).map(String);
  const notes = new Set();
  const pages = [];
  const folderTitles = {};
  let hotkeys = 0, cas = 0, maxCol = 0, maxRow = 0;
  const subs = fs.existsSync(path.join(dir, 'Profiles')) ? fs.readdirSync(path.join(dir, 'Profiles')) : [];
  for (const sub of subs) {
    const subDir = path.join(dir, 'Profiles', sub);
    let m; try { m = readJson(path.join(subDir, 'manifest.json')); } catch { continue; }
    const buttons = {};
    for (const c of m.Controllers || []) {
      for (const [pos, a] of Object.entries(c.Actions || {})) {
        const action = convertAction(a, notes);
        if (action === undefined) continue;
        const st = (a.States || [])[a.State || 0] || (a.States || [])[0] || {};
        const b = { title: a._title !== undefined ? a._title : cleanTitle(String(st.Title || '').split('|')[0]), action };
        if (st.Image) {
          const src = path.join(subDir, st.Image);
          if (fs.existsSync(src)) {
            const name = path.basename(st.Image);
            if (!dry) { fs.mkdirSync(ICONS, { recursive: true }); fs.copyFileSync(src, path.join(ICONS, name)); }
            b.icon = 'sd/' + name;
          }
        }
        if (action && action.type === 'keys') { hotkeys++; if (/^Ctrl\+Alt\+Shift\+/.test(action.keys)) cas++; }
        if (action && action.type === 'folder') folderTitles[action.page] = b.title;
        const [col, row] = pos.split(',').map(Number);
        maxCol = Math.max(maxCol, col); maxRow = Math.max(maxRow, row);
        buttons[`${col},${row}`] = b;
      }
    }
    pages.push({ id: shortId(sub), uuid: sub.toLowerCase(), buttons });
  }
  // Pages in the order Stream Deck shows them, then the folders. Empty pages are dropped.
  const ordered = [];
  pageIds.forEach(id => { const p = pages.find(x => x.uuid === id); if (p && Object.keys(p.buttons).length) ordered.push(p); });
  pages.forEach(p => { if (!ordered.includes(p) && folderTitles[p.id] !== undefined) ordered.push({ ...p, folder: true }); });
  ordered.forEach((p, i) => { p.name = p.folder ? (folderTitles[p.id] || 'Folder') : `Page ${i + 1}`; delete p.uuid; });
  return { device: root.Device && root.Device.Model, pages: ordered, hotkeys, cas, notes, cols: maxCol + 1, rows: maxRow + 1 };
}

function importDecks({ dry = false } = {}) {
  const decks = [];
  for (const f of fs.readdirSync(PROFILES)) {
    if (!f.endsWith('.sdProfile')) continue;
    const dir = path.join(PROFILES, f);
    let root; try { root = readJson(path.join(dir, 'manifest.json')); } catch { continue; }
    if (!/^VSD/i.test((root.Device && root.Device.Model) || '')) continue;   // only the Virtual Stream Deck (the Edge)
    const d = readDeck(dir, dry);
    if (d.pages.length) decks.push(d);
  }
  // A deck that's nearly all Ctrl+Alt+Shift hotkeys is the WoW one (see wow-streamdeck/SETUP.txt).
  decks.sort((a, b) => (a.cas / Math.max(1, a.hotkeys)) - (b.cas / Math.max(1, b.hotkeys)));
  const profiles = decks.map((d, i) => {
    const wow = d.hotkeys > 5 && d.cas / d.hotkeys > 0.8;
    return { id: wow ? 'wow' : i === 0 ? 'default' : `deck${i + 1}`, name: wow ? 'WoW' : i === 0 ? 'Default' : `Deck ${i + 1}`, apps: wow ? ['Wow'] : [],
      grid: { cols: Math.max(3, d.cols), rows: Math.max(2, d.rows) }, pages: d.pages, _notes: d.notes };
  });
  return { grid: { cols: 5, rows: 3 }, profiles };
}

// Fills in the light buttons of an existing deck.json from the Stream Deck, leaving everything else as it is:
// "pending" buttons (from an older import) at the same page and position get the light action.
function upgradeLights(current) {
  const fresh = importDecks({ dry: true });
  let n = 0;
  for (const pr of current.profiles) for (const pg of pr.pages) for (const [pos, b] of Object.entries(pg.buttons || {})) {
    if (!b.action || b.action.type !== 'pending') continue;
    for (const fp of fresh.profiles) {
      const src = (fp.pages.find(p => p.id === pg.id) || {}).buttons;
      const nb = src && src[pos];
      if (nb && nb.action && nb.action.type !== 'pending') { b.action = nb.action; if (!b.title || nb.title !== b.title) b.title = nb.title || b.title; n++; break; }
    }
  }
  return n;
}

module.exports = { importDecks, upgradeLights };

if (require.main === module) {
  const dry = process.argv.includes('--dry-run');
  if (!fs.existsSync(PROFILES)) { console.error(`Stream Deck profiles not found: ${PROFILES}`); process.exit(1); }
  if (process.argv.includes('--upgrade-lights')) {
    const current = readJson(DECK);
    const n = upgradeLights(current);
    if (!dry) fs.writeFileSync(DECK, JSON.stringify(current, null, 2) + '\n');
    console.log(`${n} light buttons filled in${dry ? ' (dry run)' : ''}`);
    process.exit(0);
  }
  const cfg = importDecks({ dry });
  for (const p of cfg.profiles) {
    console.log(`${p.name}${p.apps.length ? ` (when ${p.apps.join(', ')} is in front)` : ''}, ${p.grid.cols}x${p.grid.rows}:`);
    for (const pg of p.pages) {
      console.log(`  ${pg.folder ? 'folder' : 'page  '} ${pg.name} [${pg.id}]: ${Object.keys(pg.buttons).length} buttons`);
      if (dry) for (const [pos, b] of Object.entries(pg.buttons)) console.log(`    ${pos.padEnd(4)} ${(b.title || '').padEnd(16)} ${JSON.stringify(b.action)}`);
    }
    if (p._notes.size) console.log(`  left out: ${[...p._notes].join(', ')}`);
    delete p._notes;
  }
  for (const p of cfg.profiles) {
    for (const pg of p.pages) for (const [pos, b] of Object.entries(pg.buttons)) if (!b.action) console.log(`Note: ${p.name} / ${pg.name} / ${pos} has no key set. Set it in the editor.`);
  }
  if (!dry) { fs.writeFileSync(DECK, JSON.stringify(cfg, null, 2) + '\n'); console.log(`Wrote ${DECK}`); }
}
