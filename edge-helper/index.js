// Combined helper for the Xeneon Edge widgets.
// Loads the Discord, Apple Music and Notifications helpers into one Node process. Each one keeps its
// own folder, config, port (6789 / 6790 / 6791) and helper.log, so the widgets don't change.
// Apple Music's PowerShell bridges stay separate child processes (a slow library browse there must
// not freeze now-playing or the visualizer).
//
// Run: node index.js   (watchdog.js in this folder starts it at login and keeps it running)
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOG = path.join(__dirname, 'edge-helper.log');
const PID_FILE = path.join(__dirname, 'edge-helper.pid');

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  console.log(line);
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 1_000_000) fs.renameSync(LOG, LOG + '.old');
    fs.appendFileSync(LOG, line + '\n');
  } catch { /* ignore */ }
}

const MODULES = [
  { name: 'Discord', file: path.join(ROOT, 'discord-edge', 'helper', 'index.js') },
  { name: 'Apple Music', file: path.join(ROOT, 'apple-music-edge', 'helper', 'index.js') },
  { name: 'Notifications', file: path.join(ROOT, 'notifications-edge', 'helper', 'index.js') },
  { name: 'System stats', file: path.join(__dirname, 'system.js') },  // Sensor Box memory + Edge sleep cover, port 6792
  { name: 'Teams', file: path.join(ROOT, 'teams-edge', 'helper', 'index.js') },
  { name: 'App launcher', file: path.join(ROOT, 'launcher-edge', 'helper', 'index.js') }
];
const loaded = [];

// ---------- crash handling for everyone ----------
// One widget's bug shouldn't take the others down: log it and keep going. If errors keep coming,
// exit so the watchdog restarts everything cleanly.
const recentErrors = [];
function onError(kind, e) {
  const text = (e && e.stack) || String(e);
  const who = MODULES.find(m => text.includes(path.dirname(m.file)));
  log(`${kind}${who ? ' in ' + who.name : ''}: ${text}`);
  const now = Date.now();
  recentErrors.push(now);
  while (recentErrors.length && now - recentErrors[0] > 60_000) recentErrors.shift();
  if (recentErrors.length > 5) { log('Too many errors in a minute; exiting so the watchdog restarts the helper.'); process.exit(1); }
}
process.on('uncaughtException', e => onError('Uncaught error', e));
process.on('unhandledRejection', e => onError('Unhandled promise rejection', e));

function stopAll() {
  for (const m of loaded) { try { if (m.exports && typeof m.exports.stop === 'function') m.exports.stop(); } catch { /* ignore */ } }
}
process.on('exit', code => {
  stopAll();
  try { if (fs.readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
  log(`Edge helper exiting (code ${code})`);
});
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// ---------- start ----------
log(`Edge helper starting (pid ${process.pid}, node ${process.version})`);
try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch { /* ignore */ }

for (const m of MODULES) {
  if (!fs.existsSync(m.file)) { log(`${m.name}: not installed (${m.file}), skipping`); continue; }
  try {
    const exportsObj = require(m.file);
    loaded.push({ name: m.name, exports: exportsObj });
    log(`${m.name}: loaded`);
  } catch (e) {
    log(`${m.name}: failed to start - ${(e && e.message) || e}. The other widgets keep running.`);
  }
}
if (!loaded.length) { log('Nothing loaded; exiting.'); process.exit(1); }
