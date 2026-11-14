// FPS of the game in front, for the Sensor Box (in place of iCUE's FPS plugin).
// PresentMon (Intel, open source: winget install Intel.PresentMon.Console) streams every frame each app
// presents. This keeps the frames of the app in front and works out its frame rate over the last second.
// It only counts as a game while its window fills the screen (borderless or exclusive fullscreen), so
// browsers and chat apps don't get an FPS readout.
// PresentMon needs admin or membership in the "Performance Log Users" group. It only runs while something
// is asking for FPS, and stops 20 s after the last request.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const SESSION = 'EdgeDashboardFps';
const IDLE_STOP_MS = 20000;
let log = () => {}, foreground = () => ({ app: '', fullscreen: false });
let proc = null, lastAsk = 0, idleTimer = null, error = null, header = null, buf = '';
const frames = new Map();   // app.exe (lower case) -> [{ t, ms }] for the last 2 s

function findPresentMon() {
  if (process.env.PRESENTMON && fs.existsSync(process.env.PRESENTMON)) return process.env.PRESENTMON;
  const pkgs = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const d of fs.readdirSync(pkgs)) if (/^Intel\.PresentMon\.Console_/i.test(d)) {
      const exe = path.join(pkgs, d, 'presentmon.exe');
      if (fs.existsSync(exe)) return exe;
    }
  } catch { /* no winget packages */ }
  try { return execFileSync('where.exe', ['presentmon'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].trim() || null; } catch { return null; }
}

function onLine(line) {
  if (!header) { header = line.split(','); return; }
  const f = line.split(',');
  const app = (f[header.indexOf('Application')] || '').toLowerCase();
  const t = Number(f[header.indexOf('TimeInSeconds')]);
  const ms = Number(f[header.indexOf('msBetweenPresents')]);
  if (!app || !isFinite(t) || !isFinite(ms)) return;
  let list = frames.get(app);
  if (!list) frames.set(app, (list = []));
  list.push({ t, ms });
  while (list.length && list[0].t < t - 2) list.shift();
}

function start() {
  if (proc) return;
  const exe = findPresentMon();
  if (!exe) { error = 'PresentMon not installed (winget install Intel.PresentMon.Console)'; return; }
  error = null; header = null; buf = ''; frames.clear();
  proc = spawn(exe, ['--output_stdout', '--v1_metrics', '--no_console_stats', '--no_track_display', '--no_track_gpu', '--no_track_input',
    '--session_name', SESSION, '--stop_existing_session'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  log('FPS: PresentMon started');
  proc.stdout.on('data', d => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
  });
  let errText = '';
  proc.stderr.on('data', d => { errText += d.toString(); });
  proc.on('exit', code => {
    proc = null;
    if (code && !/warning/i.test(errText.split('\n')[0] || '')) error = errText.trim().split('\n')[0] || `PresentMon exited (${code})`;
    if (/access|privilege|denied/i.test(errText) && code) error = 'PresentMon needs admin or the Performance Log Users group';
    log(`FPS: PresentMon stopped (${code})${error ? ': ' + error : ''}`);
  });
}
function stop() { if (proc) { try { proc.kill(); } catch { /* gone */ } proc = null; } }

// { available, fps, app, error }
function read() {
  lastAsk = Date.now();
  start();
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (Date.now() - lastAsk >= IDLE_STOP_MS) stop(); }, IDLE_STOP_MS + 100);
  const fg = foreground();
  const app = (fg.app || '').toLowerCase() + '.exe';
  const list = frames.get(app) || [];
  const newest = Math.max(0, ...[...frames.values()].map(l => (l.length ? l[l.length - 1].t : 0)));
  const recent = list.filter(f => f.t > newest - 1);
  // Not a game, or not drawing: no FPS.
  if (!fg.fullscreen || recent.length < 2 || newest - list[list.length - 1].t > 1.5) return { available: false, fps: 0, app: fg.app, error };
  const avg = recent.reduce((s, f) => s + f.ms, 0) / recent.length;
  return { available: true, fps: Math.round(1000 / avg), app: fg.app, error };
}

function init(opts = {}) {
  if (opts.log) log = opts.log;
  if (opts.foreground) foreground = opts.foreground;
}

module.exports = { init, read, stop, findPresentMon };
process.on('exit', stop);
