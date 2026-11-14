// Mouse jiggler button for the Deck: the same toggle as the Stream Deck plugin of mousejiggler-cli
// (github.com/frankzotynia10/mousejiggler-cli). The jiggler itself keeps running from its own scheduled
// task (MouseJigglerCLI); this only reads and writes its files in %LOCALAPPDATA%\mousejiggler-cli:
//   pause.json   {"until": "<RFC 3339>"}: paused while now < until. A press pauses for the rest of today, or resumes.
//   config.json  { days: "Mon-Fri", windows: ["08:05-12:05", ...] }: when it's ACTIVE rather than IDLE.
// State, as the plugin shows it: ACTIVE, IDLE, PAUSED, STOPPED (task not running) or OFF (not installed).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DIR = path.join(process.env.LOCALAPPDATA || '', 'mousejiggler-cli');
const PAUSE = path.join(DIR, 'pause.json');
const CONFIG = path.join(DIR, 'config.json');
const TASK = 'MouseJigglerCLI';
const DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

function pausedUntil(now = new Date()) {
  const p = readJson(PAUSE);
  const until = p && p.until ? new Date(p.until) : null;
  return until && !isNaN(until) && now < until ? until : null;
}

function parseDays(s) {
  const days = new Set();
  s = String(s || '').trim().toLowerCase();
  if (s === 'all' || s === '*') return new Set([0, 1, 2, 3, 4, 5, 6]);
  for (const part of s.split(',').map(x => x.trim()).filter(Boolean)) {
    const [a, b] = part.split('-').map(x => DAYS[x.trim().slice(0, 3)]);
    if (a === undefined) continue;
    if (b === undefined) { days.add(a); continue; }
    for (let d = a; ; d = (d + 1) % 7) { days.add(d); if (d === b) break; }
  }
  return days;
}
const clock = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
function scheduleActive(cfg, now = new Date()) {
  if (!cfg || !parseDays(cfg.days).has(now.getDay())) return false;
  const min = now.getHours() * 60 + now.getMinutes();
  return (cfg.windows || []).some(w => { const [a, b] = w.split('-'); return min >= clock(a) && min < clock(b); });
}

// Scheduled task status, refreshed at most every 30 s (schtasks is slow to spawn).
let task = { status: null, at: 0 }, checking = false;
function refreshTask() {
  if (checking || Date.now() - task.at < 30000) return;
  checking = true;
  execFile('schtasks.exe', ['/query', '/tn', TASK, '/fo', 'csv', '/nh'], { windowsHide: true }, (err, out) => {
    checking = false;
    const status = err ? 'not installed' : (String(out).trim().split('\n').pop().split('","')[2] || '').replace(/"/g, '').trim();
    task = { status, at: Date.now() };
  });
}

function state() {
  refreshTask();
  const now = new Date();
  if (!fs.existsSync(DIR) || task.status === 'not installed') return { on: false, state: 'OFF', title: 'OFF' };
  if (task.status && task.status !== 'Running') return { on: false, state: 'STOPPED', title: 'STOPPED' };
  const until = pausedUntil(now);
  if (until) {
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const when = until.getTime() === midnight.getTime() ? 'today' : until.toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    return { on: false, state: 'PAUSED', title: 'PAUSED ' + when };
  }
  const active = scheduleActive(readJson(CONFIG), now);
  return { on: active, state: active ? 'ACTIVE' : 'IDLE', title: active ? 'ACTIVE' : 'IDLE' };
}

// RFC 3339 with the local offset, like Go writes it: 2026-11-15T00:00:00-05:00
function rfc3339(d) {
  const pad = n => String(Math.abs(n)).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off >= 0 ? '+' : '-'}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`;
}

// Press: pause for the rest of today, or resume if paused.
function toggle() {
  if (!fs.existsSync(DIR)) throw new Error('mousejiggler-cli is not installed');
  if (pausedUntil()) { try { fs.unlinkSync(PAUSE); } catch (e) { if (e.code !== 'ENOENT') throw e; } return; }
  const now = new Date();
  const tmp = PAUSE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ until: rfc3339(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)) }));
  fs.renameSync(tmp, PAUSE);
}

module.exports = { state, toggle };
