// Notifications helper for the Xeneon Edge widget.
// Reads Windows' notification database (the same list the Notification Center shows),
// keeps only the apps you've ticked in the widget, and serves them on ws://localhost:6791.
// Read-only: it never changes or deletes anything in Windows.
'use strict';
// Runs standalone (`node index.js`) or loaded by the combined Edge helper (edge-helper/index.js).
const HOSTED = require.main !== module;


const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const { WebSocketServer } = require('ws');

const DIR = __dirname;
const CONFIG_PATH = path.join(DIR, 'config.json');
const SETTINGS_PATH = path.join(DIR, 'settings.json');
const LOG_PATH = path.join(DIR, 'helper.log');

// ---------- logging ----------
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  console.log(line);
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 1_000_000) fs.renameSync(LOG_PATH, LOG_PATH + '.old');
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch { /* ignore */ }
}

// ---------- config ----------
let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { /* defaults */ }
const PORT = config.port || 6791;
const POLL_MS = config.pollMs || 1500;
const MAX_ITEMS = config.maxItems || 30;
const DB_PATH = config.dbPath || path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Windows', 'Notifications', 'wpndatabase.db');
// Ticked on first run. After that, the widget's checklist decides.
const DEFAULT_APPS = /BlueBubbles|OutlookForWindows|MSTeams/i;

// ---------- persisted settings (app checklist + dismissed ids) ----------
let settings = { enabled: null, dismissed: [] };
try { settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) }; } catch { /* first run */ }
let enabled = new Set(settings.enabled || []);
let dismissed = new Set(settings.dismissed || []);
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ enabled: [...enabled], dismissed: [...dismissed] }, null, 2)); }
    catch (e) { log('Could not save settings:', e.message); }
  }, 300);
}

// ---------- friendly app names (from the Start menu) ----------
let startApps = new Map(); // lowercased AUMID -> name
let startAppsLoaded = false;
function loadStartApps() {
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress'],
  { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
    if (err) return log('Get-StartApps failed:', err.message);
    try {
      const list = [].concat(JSON.parse(out));
      startAppsLoaded = true;
      startApps = new Map(list.filter(a => a && a.AppID).map(a => [a.AppID.toLowerCase(), a.Name]));
      lastJson = '';
      poll();
    } catch (e) { log('Could not parse Start menu apps:', e.message); }
  });
}

function fallbackName(aumid) {
  // "23344BlueBubbles.BlueBubbles_2fva2ntdzvhtw!bluebubbles" -> "BlueBubbles", "com.squirrel.asana.Asana" -> "Asana"
  const base = aumid.split('!')[0].split('_')[0];
  const parts = base.split('.').filter(Boolean);
  return (parts[parts.length - 1] || aumid).replace(/\.exe$/i, '');
}
const appName = id => startApps.get(id.toLowerCase()) || fallbackName(id);

// ---------- toast payload parsing ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}
// Email preheaders are padded with invisible characters; drop them.
const INVISIBLE = new RegExp('[\\u034F\\u00AD\\u200B-\u200F\\u2028-\u202F\\u2060-\u206F\\uFEFF]', 'g');
const clean = s => decode(s).replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();

const imageCache = new Map();
function imageData(src) {
  if (!src) return null;
  let p = src.replace(/^file:\/\/\/?/i, '');
  try { p = decodeURIComponent(p); } catch { /* keep */ }
  if (!/^[a-z]:[\\/]/i.test(p)) return null;
  if (/PersonaPlaceholder/i.test(p)) return null; // Outlook's generic grey person
  if (imageCache.has(p)) return imageCache.get(p);
  let data = null;
  try {
    const st = fs.statSync(p);
    if (st.size < 256 * 1024) {
      const ext = path.extname(p).toLowerCase();
      const type = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      data = `data:${type};base64,${fs.readFileSync(p).toString('base64')}`;
    }
  } catch { /* missing */ }
  if (imageCache.size > 200) imageCache.clear();
  imageCache.set(p, data);
  return data;
}

// Email subjects pile up tags like "RE: [External]Re: FW:"; keep the words that matter.
function cleanSubject(t) {
  let prev;
  do {
    prev = t;
    t = t.replace(/^\s*(\[\s*ext(ernal)?\s*\]|ext(ernal)?\s*:|(re|fw|fwd|aw|wg|sv|vs)\s*(\[\d+\])?\s*:)\s*/i, '');
  } while (t !== prev);
  return t.replace(/\[\s*external\s*\]\s*/gi, '').trim();
}
// Drop "Caution: this email originated outside..." style banners so the preview starts with the message.
const BANNERS = [
  // "[External] CAUTION: This email originated (from) outside (of) the organization. Do not click links ... safe."
  /^\s*(\[\s*external\s*\]\s*)?((caution|warning|notice|attention|external( email| sender)?)\s*[:!-]\s*)?this (e-?mail|message) (originated|was sent|came|is from)\b[^.!]*?\b(outside|external)\b[^.!]*[.!]\s*((do not|don.t|please do not|please use|use caution|exercise caution)[^.!]*[.!]\s*)*/i,
  // Outlook's first-contact notice: "You don't often get email from a@b.com. Learn why this is important"
  /^\s*you don.t often get (e-?mail|messages) from \S+\s*(learn why this is important)?\s*/i,
  /^\s*some people who received this message don.t often get email from \S+\s*(learn why this is important)?\s*/i,
  /^\s*\[\s*external\s*\]\s*/i,
  /^\s*(caution|warning)\s*[:!-]\s*$/i
];
function cleanPreview(t) {
  let prev;
  do { prev = t; for (const re of BANNERS) t = t.replace(re, ''); } while (t !== prev);
  return t.trim();
}

function parseToast(xml) {
  const texts = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
  let m;
  while ((m = re.exec(xml))) {
    if (/placement\s*=\s*"attribution"/i.test(m[1])) continue;
    const t = clean(m[2]);
    if (t) texts.push(t);
  }
  const img = /<image\b[^>]*placement\s*=\s*"appLogoOverride"[^>]*>/i.exec(xml);
  const src = img && /src\s*=\s*"([^"]*)"/i.exec(img[0]);
  // Outlook sends sender / subject / preview; chat apps (Teams, BlueBubbles) send sender / message.
  const subject = texts.length >= 3 ? cleanSubject(texts[1]) : '';
  const preview = cleanPreview((texts.length >= 3 ? texts.slice(2) : texts.slice(1)).join(' · '));
  const body = [subject, preview].filter(Boolean).join(' · ');
  return { title: texts[0] || '', subject, preview, body, image: imageData(src && decode(src[1])) };
}

// ---------- database ----------
let db = null;
function openDb() {
  if (db) return db;
  db = new DatabaseSync(DB_PATH, { readOnly: true });
  log(`Opened ${DB_PATH}`);
  return db;
}
function closeDb() { try { if (db) db.close(); } catch { /* ignore */ } db = null; }

const Q_TOASTS = `
  select n.Id as id, h.PrimaryId as app, n.Payload as payload,
         cast(n.ArrivalTime / 10000 - 11644473600000 as integer) as ts
  from Notification n join NotificationHandler h on h.RecordId = n.HandlerId
  where n.Type = 'toast'
  order by n.ArrivalTime desc`;
const Q_HANDLERS = `select PrimaryId as id from NotificationHandler where HandlerType in ('app:desktop', 'app:immersive')`;

// ---------- state pushed to the widget ----------
let state = { status: 'starting', message: '', items: [], apps: [] };
let lastJson = '';
let lastLoggedId = null;
const parsedCache = new Map(); // notification id -> parsed toast

function poll() {
  let rows, handlers;
  try {
    const d = openDb();
    rows = d.prepare(Q_TOASTS).all();
    handlers = d.prepare(Q_HANDLERS).all().map(r => r.id);
  } catch (e) {
    closeDb();
    if (state.status !== 'error') log('Reading notifications failed:', e.message);
    state = { ...state, status: 'error', message: 'Cannot read Windows notifications' };
    return publish();
  }

  // first run: tick the default apps that exist on this PC
  // (waits for the Start menu names so internal sub-handlers like MSTeams.Update aren't ticked)
  if (settings.enabled == null && startAppsLoaded) {
    const all = new Set([...handlers.filter(h => startApps.has(h.toLowerCase())), ...rows.map(r => r.app)]);
    enabled = new Set([...all].filter(id => DEFAULT_APPS.test(id)));
    settings.enabled = [...enabled];
    log('First run, showing:', [...enabled].map(appName).join(', ') || '(none found)');
    saveSettings();
  }

  // app checklist: real apps (in the Start menu) + anything that has sent a toast + anything ticked
  const counts = new Map(), lastSeen = new Map();
  for (const r of rows) {
    counts.set(r.app, (counts.get(r.app) || 0) + 1);
    if (!lastSeen.has(r.app)) lastSeen.set(r.app, r.ts);
  }
  const ids = new Set([...enabled, ...counts.keys()]);
  for (const h of handlers) if (startApps.has(h.toLowerCase())) ids.add(h);
  const byName = new Map();
  for (const id of ids) {
    const name = appName(id);
    const prev = byName.get(name.toLowerCase());
    // collapse duplicates with the same display name (e.g. two Outlook registrations), keep the active one
    if (prev && (enabled.has(prev.id) || (counts.get(prev.id) || 0) >= (counts.get(id) || 0)) && !enabled.has(id)) continue;
    byName.set(name.toLowerCase(), { id, name, enabled: enabled.has(id), count: counts.get(id) || 0, last: lastSeen.get(id) || 0 });
  }
  const apps = [...byName.values()].sort((a, b) => (b.last - a.last) || a.name.localeCompare(b.name));

  // visible notifications
  const live = new Set();
  const items = [];
  for (const r of rows) {
    const id = String(r.id);
    live.add(id);
    if (!enabled.has(r.app) || dismissed.has(id) || items.length >= MAX_ITEMS) continue;
    let p = parsedCache.get(id);
    if (!p) {
      try { p = parseToast(Buffer.from(r.payload).toString('utf8')); } catch { p = { title: '', subject: '', preview: '', body: '', image: null }; }
      parsedCache.set(id, p);
    }
    if (!p.title && !p.body) continue;
    items.push({ id, app: r.app, appName: appName(r.app), ts: r.ts, title: p.title, subject: p.subject, preview: p.preview, body: p.body, image: p.image });
  }
  // forget ids Windows has already cleared
  for (const id of parsedCache.keys()) if (!live.has(id)) parsedCache.delete(id);
  let pruned = false;
  for (const id of dismissed) if (!live.has(id)) { dismissed.delete(id); pruned = true; }
  if (pruned) saveSettings();

  state = { status: 'ready', message: '', items, apps };
  publish();
}

function publish() {
  const json = JSON.stringify({ type: 'state', state });
  if (json === lastJson) return;
  const newest = state.items[0];
  if (newest && newest.id !== lastLoggedId) lastLoggedId = newest.id, log(`Notification: [${newest.appName}] ${newest.title}`);
  lastJson = json;
  for (const c of wss.clients) if (c.readyState === 1) c.send(json);
}

// ---------- websocket server ----------
const wss = new WebSocketServer({ noServer: true });

function originAllowed(origin) {
  if (config.allowAnyOrigin) return true;
  if (!origin || origin === 'null') return true;
  return !/^https?:\/\//i.test(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function onUpgrade(req, socket, head) {
  const origin = req.headers.origin;
  if (!originAllowed(origin)) {
    log(`Rejected widget connection from origin ${origin} (set "allowAnyOrigin": true in config.json if this is the widget)`);
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
}

wss.on('connection', (ws, req) => {
  log(`Widget connected (origin: ${req.headers.origin || 'none'})`);
  ws.send(lastJson || JSON.stringify({ type: 'state', state }));
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.action === 'setApp' && typeof msg.id === 'string') {
      if (msg.enabled) enabled.add(msg.id); else enabled.delete(msg.id);
      log(`${msg.enabled ? 'Showing' : 'Hiding'} ${appName(msg.id)}`);
    } else if (msg.action === 'dismiss' && msg.id != null) {
      dismissed.add(String(msg.id));
    } else if (msg.action === 'clearAll') {
      for (const it of state.items) dismissed.add(it.id);
      log(`Cleared ${state.items.length} notifications`);
    } else return;
    settings.enabled = [...enabled];
    saveSettings();
    poll();
  });
});

function startServers() {
  for (const host of ['127.0.0.1', '::1']) {
    const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('notifications-edge helper ok'); });
    srv.on('upgrade', onUpgrade);
    srv.on('error', e => {
      if (e.code === 'EADDRINUSE') { log(`Port ${PORT} on ${host} already in use - helper probably already running.${HOSTED ? '' : ' Exiting.'}`); if (!HOSTED) process.exit(0); return; }
      if (e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT') { log(`Skipping ${host}: ${e.code}`); return; }
      log('Server error:', e.message);
    });
    srv.listen(PORT, host, () => log(`Listening on ${host}:${PORT}`));
  }
}

startServers();
loadStartApps();
setInterval(loadStartApps, 10 * 60 * 1000); // pick up newly installed apps
poll();
setInterval(poll, POLL_MS);

// Leave a trace in helper.log if this process dies, so overnight stops can be diagnosed.
// (When loaded by the combined Edge helper, the host handles crashes and exit for everyone.)
if (!HOSTED) {
  process.on('uncaughtException', e => { log('Crashed:', (e && e.stack) || String(e)); process.exit(1); });
  process.on('unhandledRejection', e => log('Unhandled promise rejection:', (e && e.stack) || String(e)));
  process.on('exit', code => { try { log(`Helper exiting (code ${code})`); } catch { /* ignore */ } });
}
