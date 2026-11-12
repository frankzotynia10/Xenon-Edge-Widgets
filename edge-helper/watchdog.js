// Keeps the combined Xeneon Edge helper (index.js in this folder) running.
// Task Scheduler runs this at login and every 5 minutes. It starts the helper fully detached
// (so it doesn't depend on whatever launched it) when the helper process is gone or none of the
// widget ports answer, and notes what it did in watchdog.log.
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HOST_DIR = path.join(ROOT, 'edge-helper');
const PID_FILE = path.join(HOST_DIR, 'edge-helper.pid');
const LOG = path.join(__dirname, 'watchdog.log');

const WIDGETS = [
  { name: 'Discord', dir: path.join(ROOT, 'discord-edge', 'helper'), port: 6789 },
  { name: 'Apple Music', dir: path.join(ROOT, 'apple-music-edge', 'helper'), port: 6790 },
  { name: 'Notifications', dir: path.join(ROOT, 'notifications-edge', 'helper'), port: 6791 },
  { name: 'System stats', dir: HOST_DIR, port: 6792, file: 'system.js' },
  { name: 'Teams', dir: path.join(ROOT, 'teams-edge', 'helper'), port: 6793 },
  { name: 'App launcher', dir: path.join(ROOT, 'launcher-edge', 'helper'), port: 6794 }
];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 500_000) fs.renameSync(LOG, LOG + '.old');
    fs.appendFileSync(LOG, line);
  } catch { /* ignore */ }
}

function portOf(w) {
  try { const c = JSON.parse(fs.readFileSync(path.join(w.dir, 'config.json'), 'utf8')); if (c.port) return c.port; } catch { /* default */ }
  return w.port;
}

function answers(port) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 3000 }, res => { res.resume(); resolve(true); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function hostAlive() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
    if (!pid) return false;
    process.kill(pid, 0); // throws if no such process
    return true;
  } catch { return false; }
}

async function check() {
  const installed = WIDGETS.filter(w => fs.existsSync(path.join(w.dir, w.file || 'index.js')));
  const results = [];
  for (const w of installed) results.push({ w, ok: await answers(portOf(w)) });
  return results;
}

function startHost(reason) {
  const child = spawn(process.execPath, [path.join(HOST_DIR, 'index.js')], {
    cwd: HOST_DIR, detached: true, stdio: 'ignore', windowsHide: true
  });
  child.unref();
  log(`Started the Edge helper (pid ${child.pid}): ${reason}`);
}

async function main() {
  let results = await check();
  if (results.every(r => r.ok)) return;
  // give a helper that is mid-start a moment, then look again
  await new Promise(r => setTimeout(r, 4000));
  results = await check();
  if (results.every(r => r.ok)) return;

  const down = results.filter(r => !r.ok).map(r => r.w.name);
  if (!hostAlive()) return startHost(`it wasn't running (${down.join(', ')} not answering)`);
  if (down.length === results.length) return startHost('it was running but no widget port answered');
  // Host is up but one widget isn't: a restart won't fix a widget that failed to start; its log will say why.
  log(`Edge helper is running but ${down.join(', ')} isn't answering - see edge-helper/edge-helper.log`);
}

main().catch(e => log('watchdog error: ' + e.message)).finally(() => setTimeout(() => process.exit(0), 500));
