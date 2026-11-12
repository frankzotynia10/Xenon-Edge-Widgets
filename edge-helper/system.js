// System module for the combined Edge helper, on http://localhost:6792/
//   GET /               system memory for the Sensor Box widget
//   GET /sleep/toggle   dim-wallpaper cover over the Edge on/off (also /sleep, /wake, /sleep/status)
// The cover itself is drawn by sleep.ps1 (a hidden WinForms window); it also registers the
// global hotkey (default Ctrl+Alt+Shift+F10) so a Stream Deck "Hotkey" button can toggle it.
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const { spawn } = require('child_process');

const PORT = 6792;
const LOG_PATH = path.join(__dirname, 'system.log');

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 200_000) fs.renameSync(LOG_PATH, LOG_PATH + '.old');
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch { /* ignore */ }
}

function stats() {
  const total = os.totalmem();
  const avail = os.freemem(); // on Windows this is "available" memory, matching Task Manager's In use = total - available
  const used = total - avail;
  return {
    memory: {
      usedPct: Math.round((used / total) * 1000) / 10,
      usedGB: Math.round((used / 1024 ** 3) * 10) / 10,
      totalGB: Math.round((total / 1024 ** 3) * 10) / 10
    },
    ts: Date.now()
  };
}

// ---------- Edge sleep cover ----------
const SLEEP_CONFIG = path.join(__dirname, 'sleep.json');
if (!fs.existsSync(SLEEP_CONFIG)) {
  fs.writeFileSync(SLEEP_CONFIG, JSON.stringify({
    hotkey: 'ctrl+alt+shift+f10',
    wallpaper: '',          // empty = your desktop wallpaper; or a full path to any image
    dim: 0.88,              // 0 = image at full brightness, 1 = solid black
    clock: true,            // faint clock that drifts a little each minute
    tapToWake: true,
    screenWidth: 2560, screenHeight: 720
  }, null, 2));
}
let sleepProc = null, sleeping = false, sleepStopping = false;
function startSleep() {
  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'sleep.ps1'), '-ConfigPath', SLEEP_CONFIG], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  sleepProc = proc;
  readline.createInterface({ input: proc.stdout }).on('line', line => {
    if (line === 'state sleeping') { sleeping = true; log('Edge cover on'); }
    else if (line === 'state awake') { if (sleeping) log('Edge cover off'); sleeping = false; }
    else if (line.trim()) log('sleep:', line.trim());
  });
  readline.createInterface({ input: proc.stderr }).on('line', l => { if (l.trim()) log('sleep stderr:', l.trim()); });
  proc.on('exit', code => {
    sleepProc = null; sleeping = false;
    if (sleepStopping) return;
    log(`sleep cover exited (code ${code}), restarting in 5s`);
    setTimeout(startSleep, 5000);
  });
}
function sleepCmd(cmd) { if (sleepProc && sleepProc.stdin.writable) { sleepProc.stdin.write(cmd + '\n'); return true; } return false; }
startSleep();
// pick up edits to sleep.json without restarting
let reloadTimer = null;
try { fs.watch(SLEEP_CONFIG, () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => sleepCmd('reload'), 300); }); } catch { /* ignore */ }

function originAllowed(origin) {
  // iCUE widgets load from file/qrc (origin null or absent); block ordinary web pages.
  if (!origin || origin === 'null') return true;
  return !/^https?:\/\//i.test(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

for (const host of ['127.0.0.1', '::1']) {
  const srv = http.createServer((req, res) => {
    const origin = req.headers.origin;
    if (!originAllowed(origin)) { res.writeHead(403); return res.end(); }
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store',
      'access-control-allow-origin': origin && origin !== 'null' ? origin : '*' };
    const url = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
    const sleepRoutes = { '/sleep': 'sleep', '/sleep/on': 'sleep', '/wake': 'wake', '/sleep/off': 'wake', '/sleep/toggle': 'toggle' };
    if (sleepRoutes[url]) {
      // Only the sleep routes do something, so refuse requests a browser marks as cross-site (e.g. a web page's
      // background <img>). The Stream Deck script/hotkey don't send that header. The iCUE widget's memory
      // fetch IS cross-site (widget page -> localhost), which is why this check isn't applied to "/".
      if (req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403); return res.end(); }
      const ok = sleepCmd(sleepRoutes[url]);
      res.writeHead(ok ? 200 : 503, headers);
      return res.end(JSON.stringify({ ok, command: sleepRoutes[url] }));
    }
    if (url === '/sleep/status') { res.writeHead(200, headers); return res.end(JSON.stringify({ sleeping, running: !!sleepProc })); }
    res.writeHead(200, headers);
    res.end(JSON.stringify(stats()));
  });
  srv.on('error', e => {
    if (e.code === 'EADDRINUSE') return log(`Port ${PORT} on ${host} already in use`);
    if (e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT') return;
    log('Server error:', e.message);
  });
  srv.listen(PORT, host, () => log(`Listening on ${host}:${PORT}`));
}

module.exports = { stop() { sleepStopping = true; sleepCmd('quit'); if (sleepProc) { try { sleepProc.kill(); } catch { /* ignore */ } } } };
