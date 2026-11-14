// The Deck widget's back end: the button config (deck.json), running a pressed button's action,
// and which profile to show for the app in front (e.g. the WoW profile while WoW has focus).
// Keys are sent by deck-keys.ps1, a PowerShell helper that stays running.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const lights = require('./lights');

const DECK = process.env.DECK_FILE || path.join(__dirname, 'deck.json');
const EXAMPLE = path.join(__dirname, 'deck.example.json');
const ICON_DIRS = { sd: path.join(__dirname, 'deck-icons'), wow: path.resolve(__dirname, '..', 'wow-streamdeck', 'png') };

// ---------- key names ----------
const VK = { ctrl: 0x11, control: 0x11, alt: 0x12, shift: 0x10, win: 0x5B,
  enter: 0x0D, return: 0x0D, esc: 0x1B, escape: 0x1B, tab: 0x09, space: 0x20, backspace: 0x08, delete: 0x2E, del: 0x2E, insert: 0x2D, ins: 0x2D,
  home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22, left: 0x25, up: 0x26, right: 0x27, down: 0x28,
  capslock: 0x14, numlock: 0x90, scrolllock: 0x91, printscreen: 0x2C, pause: 0x13, menu: 0x5D,
  volumemute: 0xAD, volumedown: 0xAE, volumeup: 0xAF, medianext: 0xB0, mediaprevious: 0xB1, mediaprev: 0xB1, mediastop: 0xB2, mediaplaypause: 0xB3,
  ';': 0xBA, '=': 0xBB, plus: 0xBB, ',': 0xBC, comma: 0xBC, '-': 0xBD, minus: 0xBD, '.': 0xBE, period: 0xBE, '/': 0xBF, '`': 0xC0, '[': 0xDB, '\\': 0xDC, ']': 0xDD, "'": 0xDE,
  numpadmultiply: 0x6A, numpadadd: 0x6B, numpadsubtract: 0x6D, numpaddecimal: 0x6E, numpaddivide: 0x6F };
for (let i = 0; i < 26; i++) VK[String.fromCharCode(97 + i)] = 0x41 + i;
for (let i = 0; i < 10; i++) { VK[String(i)] = 0x30 + i; VK['numpad' + i] = 0x60 + i; }
for (let i = 1; i <= 24; i++) VK['f' + i] = 0x6F + i;
const MODS = [0x11, 0x12, 0x10, 0x5B];

// Display names for the editor and the Stream Deck import, e.g. 0x70 -> "F1".
const NAMES = {};
for (const [k, v] of Object.entries(VK)) if (!(v in NAMES)) NAMES[v] = k.length === 1 ? k.toUpperCase() : k.replace(/^./, c => c.toUpperCase()).replace(/^F(\d+)$/, 'F$1');
Object.assign(NAMES, { 0x11: 'Ctrl', 0x12: 'Alt', 0x10: 'Shift', 0x5B: 'Win', 0x70: 'F1', 0xAD: 'VolumeMute', 0xAE: 'VolumeDown', 0xAF: 'VolumeUp',
  0xB0: 'MediaNext', 0xB1: 'MediaPrevious', 0xB3: 'MediaPlayPause', 0x21: 'PageUp', 0x22: 'PageDown', 0xBC: 'Comma', 0xBE: 'Period', 0xBB: 'Plus', 0xBD: 'Minus' });
for (let i = 1; i <= 24; i++) NAMES[0x6F + i] = 'F' + i;

// "Ctrl+Alt+Shift+F1" -> [0x11, 0x12, 0x10, 0x70], modifiers first.
function parseKeys(s) {
  const parts = String(s || '').split('+').map(p => p.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) throw new Error('no keys');
  const vks = parts.map(p => { if (!(p in VK)) throw new Error(`unknown key "${p}"`); return VK[p]; });
  return [...vks.filter(v => MODS.includes(v)), ...vks.filter(v => !MODS.includes(v))];
}
const keysName = vks => vks.map(v => NAMES[v] || `0x${v.toString(16)}`).join('+');

// ---------- config ----------
function load() {
  for (const f of [DECK, EXAMPLE]) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* next */ } }
  return { grid: { cols: 5, rows: 4 }, profiles: [{ id: 'default', name: 'Default', apps: [], pages: [{ id: 'main', name: 'Main', buttons: {} }] }] };
}
function save(cfg) {
  if (!cfg || !Array.isArray(cfg.profiles) || !cfg.profiles.length) throw new Error('needs at least one profile');
  fs.writeFileSync(DECK, JSON.stringify(cfg, null, 2) + '\n');
}
function findButton(cfg, profile, page, pos) {
  const pr = cfg.profiles.find(p => p.id === profile);
  const pg = pr && pr.pages.find(p => p.id === page);
  return pg && pg.buttons && pg.buttons[pos];
}

// ---------- the key sender ----------
let helper = null, pending = [], log = () => {};
const state = { fg: '', fullscreen: false, profile: null };
const listeners = new Set();
// Windows UI that shouldn't switch the deck away from the app you were in: Alt+Tab, Task View, the taskbar, Start.
const SHELL_CLASSES = /^(ForegroundStaging|MultitaskingViewFrame|XamlExplorerHostIslandWindow|TaskSwitcherWnd|Shell_TrayWnd|Shell_SecondaryTrayWnd|Windows\.UI\.Core\.CoreWindow|NotifyIconOverflowWindow|TopLevelWindowForOverflowXamlIsland)$/;

function profileFor(fg) {
  const cfg = load();
  const name = String(fg || '').toLowerCase();
  const hit = cfg.profiles.find(p => (p.apps || []).some(a => a.toLowerCase().replace(/\.exe$/, '') === name));
  return (hit || cfg.profiles[0]).id;
}

function startHelper() {
  if (helper) return helper;
  const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'deck-keys.ps1')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  helper = p;
  let buf = '';
  p.stdout.on('data', d => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line.startsWith('fg ')) {
        const [, proc, full, cls = ''] = /^fg (\S+) ([01]) ?(.*)$/.exec(line) || [];
        if (!proc || SHELL_CLASSES.test(cls)) continue;
        state.fg = proc; state.fullscreen = full === '1';
        const prof = profileFor(proc);
        if (prof !== state.profile) { state.profile = prof; for (const fn of listeners) fn({ profile: prof, fg: proc }); }
      } else if (line === 'ok' || line.startsWith('err')) {
        const cb = pending.shift();
        if (cb) cb(line === 'ok' ? null : new Error(line.slice(4)));
      }
    }
  });
  p.stderr.on('data', d => log('Deck keys: ' + d.toString().trim()));
  p.on('exit', code => {
    log(`Deck key sender stopped (${code}), restarting`);
    helper = null;
    for (const cb of pending.splice(0)) cb(new Error('key sender stopped'));
    setTimeout(startHelper, 2000);
  });
  return p;
}
function command(line) {
  return new Promise((resolve, reject) => {
    const h = startHelper();
    pending.push(err => (err ? reject(err) : resolve()));
    h.stdin.write(line + '\n');
  });
}

// Runs a configured button. Only actions saved in deck.json can run, never keys sent by the caller.
async function press(profile, page, pos) {
  const b = findButton(load(), profile, page, pos);
  if (!b || !b.action) throw new Error('no such button');
  const a = b.action;
  if (lights.isLight(a.type)) return lights.run(a);
  switch (a.type) {
    case 'keys': return command('K ' + parseKeys(a.keys).join(','));
    case 'text':
      await command('T ' + Buffer.from(String(a.text || ''), 'utf8').toString('base64'));
      if (a.enter) await command('K ' + VK.enter);
      return;
    case 'open':
      // Same as Stream Deck's Open: a command line, started detached in its own window.
      // /s with the whole line in quotes: cmd strips just those outer quotes and keeps the ones inside.
      spawn('cmd.exe', ['/d', '/s', '/c', `"start "" ${a.command}"`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
      return;
    case 'edge-sleep':
      // The Edge helper's sleep cover, called directly: no global hotkey, so nothing clashes with game binds.
      return new Promise((resolve, reject) => {
        const op = ['sleep', 'wake'].includes(a.op) ? (a.op === 'sleep' ? '/sleep' : '/wake') : '/sleep/toggle';
        require('http').get({ host: '127.0.0.1', port: 6792, path: op, timeout: 2000 }, r => { r.resume(); r.statusCode < 400 ? resolve() : reject(new Error(`helper said ${r.statusCode}`)); })
          .on('timeout', function () { this.destroy(new Error('Edge helper not answering')); })
          .on('error', e => reject(new Error('Edge helper not running: ' + e.message)));
      });
    default: throw new Error(`"${a.type}" isn't something the server runs`);
  }
}

function icon(rel) {
  const m = /^(\w+)\/(.+)$/.exec(String(rel || ''));
  const base = m && ICON_DIRS[m[1]];
  if (!base) return null;
  const p = path.normalize(path.join(base, m[2]));
  return p.startsWith(base + path.sep) ? p : null;
}
function iconList() {
  const out = [];
  for (const [prefix, dir] of Object.entries(ICON_DIRS)) {
    try { for (const f of fs.readdirSync(dir)) if (/\.(png|svg|jpg)$/i.test(f)) out.push(`${prefix}/${f}`); } catch { /* missing */ }
  }
  return out;
}

function init(opts = {}) {
  if (opts.log) log = opts.log;
  startHelper();
  lights.init({ log });
}
const onChange = fn => listeners.add(fn);
const current = () => ({ profile: state.profile || profileFor(state.fg), fg: state.fg });
const foreground = () => ({ app: state.fg, fullscreen: state.fullscreen });

module.exports = { init, load, save, press, parseKeys, keysName, icon, iconList, onChange, current, foreground, VK, ICON_DIRS, lights };
