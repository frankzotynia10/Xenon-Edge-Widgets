// App launcher helper for the Xeneon Edge widget, on http/ws://localhost:6794.
//   ws  : widget sends {action:'config', ids:[appId...]} and {action:'launch', id}; gets {type:'state', state}
//   GET /icon/<key>.png : the app's icon (extracted once into ./icons)
// launcher.ps1 does the Windows side: Start-menu app list, icons, "is it open?", launch / bring to front.
// Only Start-menu apps can be launched (the id must be in that list).
'use strict';
const HOSTED = require.main !== module;

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const readline = require('readline');
const { spawn } = require('child_process');
const { WebSocketServer } = require(require.resolve('ws', { paths: [__dirname, path.join(__dirname, '..', '..', 'teams-edge', 'helper')] }));

const DIR = __dirname;
const PORT = 6794;
const ICON_DIR = path.join(DIR, 'icons');
const LOG_PATH = path.join(DIR, 'helper.log');

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  if (!HOSTED) console.log(line);
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 500_000) fs.renameSync(LOG_PATH, LOG_PATH + '.old');
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch { /* ignore */ }
}

const iconKey = id => crypto.createHash('sha1').update(String(id).toLowerCase()).digest('hex').slice(0, 16);
let apps = new Map();          // lower(id) -> { id, name, target }
let running = new Set();       // lower(id)
const iconState = new Map();   // key -> 'ok' | 'pending' | 'fail'

// ---------- widget server ----------
const wss = new WebSocketServer({ noServer: true });
function originAllowed(origin) {
  if (!origin || origin === 'null') return true;
  return !/^https?:\/\//i.test(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}
function stateFor(ids) {
  const out = {};
  for (const id of ids) {
    const a = apps.get(id.toLowerCase());
    if (!a) { out[id] = { missing: true }; continue; }
    const key = iconKey(a.id);
    out[id] = { name: a.name, icon: iconState.get(key) === 'ok' ? `/icon/${key}.png` : '', running: running.has(a.id.toLowerCase()) };
  }
  return { ready: apps.size > 0, apps: out };
}
function sendState(ws) { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'state', state: stateFor(ws.ids || []) })); }
function broadcast() { for (const c of wss.clients) sendState(c); }
function watchAll() {
  const ids = new Set();
  for (const c of wss.clients) for (const id of c.ids || []) ids.add(id);
  bridgeSend({ cmd: 'watch', ids: [...ids] });
}

wss.on('connection', (ws, req) => {
  ws.ids = [];
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.action === 'config' && Array.isArray(m.ids)) {
      ws.ids = m.ids.filter(x => typeof x === 'string' && x).slice(0, 32);
      for (const id of ws.ids) ensureIcon(id);
      watchAll(); sendState(ws);
    } else if (m.action === 'launch' && typeof m.id === 'string') {
      if (!apps.has(m.id.toLowerCase())) return log('Refused launch of unknown app:', m.id);
      log('Launch:', apps.get(m.id.toLowerCase()).name);
      bridgeSend({ cmd: 'launch', id: m.id });
    } else if (m.action === 'refreshApps') bridgeSend({ cmd: 'apps' });
  });
  ws.on('close', watchAll);
});

function serveIcon(req, res, key) {
  if (!/^[0-9a-f]{16}$/.test(key)) { res.writeHead(404); return res.end(); }
  fs.readFile(path.join(ICON_DIR, key + '.png'), (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=86400', 'access-control-allow-origin': '*' });
    res.end(d);
  });
}
for (const host of ['127.0.0.1', '::1']) {
  const srv = http.createServer((req, res) => {
    if (!originAllowed(req.headers.origin)) { res.writeHead(403); return res.end(); }
    const m = /^\/icon\/([0-9a-f]+)\.png$/.exec((req.url || '').split('?')[0]);
    if (m) return serveIcon(req, res, m[1]);
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end('launcher-edge helper ok');
  });
  srv.on('upgrade', (req, socket, head) => {
    if (!originAllowed(req.headers.origin)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  srv.on('error', e => {
    if (e.code === 'EADDRINUSE') { log(`Port ${PORT} on ${host} already in use`); if (!HOSTED) process.exit(0); return; }
    if (e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT') return;
    log('Server error:', e.message);
  });
  srv.listen(PORT, host, () => log(`Listening on ${host}:${PORT}`));
}

// ---------- icons ----------
function ensureIcon(id) {
  const a = apps.get(id.toLowerCase()); if (!a) return;
  const key = iconKey(a.id);
  if (iconState.has(key)) return;
  if (fs.existsSync(path.join(ICON_DIR, key + '.png'))) { iconState.set(key, 'ok'); return; }
  iconState.set(key, 'pending');
  bridgeSend({ cmd: 'icon', id: a.id, out: path.join(ICON_DIR, key + '.png') });
}

// ---------- PowerShell bridge ----------
let bridge = null, stopping = false, queue = [];
function bridgeSend(o) {
  if (bridge && bridge.stdin.writable) bridge.stdin.write(JSON.stringify(o) + '\n');
  else queue.push(o);
}
function startBridge() {
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(DIR, 'launcher.ps1')],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  bridge = p;
  readline.createInterface({ input: p.stdout }).on('line', line => {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.type === 'log') return log('bridge:', m.msg);
    if (m.type === 'apps') {
      apps = new Map((m.apps || []).map(a => [String(a.id).toLowerCase(), a]));
      log(`${apps.size} Start menu apps`);
      for (const c of wss.clients) for (const id of c.ids || []) ensureIcon(id);
      watchAll(); broadcast();
    } else if (m.type === 'icon') {
      iconState.set(iconKey(m.id), m.ok ? 'ok' : 'fail'); broadcast();
    } else if (m.type === 'running') {
      running = new Set((m.ids || []).map(x => String(x).toLowerCase())); broadcast();
    }
  });
  readline.createInterface({ input: p.stderr }).on('line', l => { if (l.trim()) log('bridge stderr:', l.trim()); });
  p.on('exit', code => {
    bridge = null;
    if (stopping) return;
    log(`Bridge exited (code ${code}), restarting in 3s`);
    setTimeout(startBridge, 3000);
  });
  p.stdin.write(JSON.stringify({ cmd: 'apps' }) + '\n');
  for (const o of queue.splice(0)) p.stdin.write(JSON.stringify(o) + '\n');
  watchAll();
}
startBridge();
// pick up newly installed apps now and then
const appTimer = setInterval(() => bridgeSend({ cmd: 'apps' }), 30 * 60_000);

if (!HOSTED) process.on('uncaughtException', e => { log('Crashed:', (e && e.stack) || String(e)); process.exit(1); });
module.exports = { stop() { stopping = true; clearInterval(appTimer); if (bridge) { try { bridge.stdin.end(); bridge.kill(); } catch { /* ignore */ } } } };
