// Claude Code status for the Xeneon Edge, on http://127.0.0.1:6795.
//   POST /event   from Claude Code's hooks (claude-edge/hook.js): a session started, got a prompt,
//                 needs you, finished or ended. Needs the header x-claude-edge: 1 and no browser Origin.
//   GET  /events  server-sent events for the widget: { sessions: [...] } whenever something changes.
// Nothing is saved to disk; a restart forgets the sessions until they send their next event.
'use strict';
const HOSTED = require.main !== module;

const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = 6795;
const LOG_PATH = path.join(__dirname, 'helper.log');
const FORGET_AFTER = 12 * 3600e3;   // a session we haven't heard from in 12 hours is gone

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  if (!HOSTED) console.log(line);
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 300_000) fs.renameSync(LOG_PATH, LOG_PATH + '.old');
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch { /* ignore */ }
}

// id -> { id, project, branch, state: 'idle'|'working'|'waiting'|'done', since, seen, task, message, transcript }
const sessions = new Map();

// "C:\dev\app\.claude\worktrees\fix-login" -> "app · fix-login"
function projectName(cwd) {
  const parts = String(cwd || '').split(/[\\/]+/).filter(Boolean);
  const wt = parts.lastIndexOf('worktrees');
  if (wt > 1 && parts[wt - 1] === '.claude' && parts[wt + 1]) return `${parts[wt - 2]} · ${parts[wt + 1]}`;
  return parts[parts.length - 1] || 'Claude';
}
const oneLine = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

function onEvent(e) {
  const id = typeof e.session_id === 'string' && e.session_id.slice(0, 80);
  const ev = e.hook_event_name;
  if (!id || typeof ev !== 'string') return false;
  const now = Date.now();
  if (ev === 'SessionEnd') { sessions.delete(id); return true; }
  let s = sessions.get(id);
  if (!s) { s = { id, state: 'idle', since: now, task: '', message: '' }; sessions.set(id, s); }
  s.seen = now;
  if (e.cwd) s.project = projectName(e.cwd);
  if (typeof e.transcript_path === 'string') s.transcript = e.transcript_path;
  const set = (state, message = '') => { if (s.state !== state) s.since = now; s.state = state; s.message = message; };
  switch (ev) {
    case 'SessionStart': if (s.state !== 'working') set('idle'); break;
    case 'UserPromptSubmit':
      // The first prompt names the session; later ones are shown while it works on them.
      if (!s.task) s.task = oneLine(e.prompt, 90);
      set('working', oneLine(e.prompt, 90));
      break;
    case 'Notification': {
      const msg = oneLine(e.message, 90);
      // "Claude is waiting for your input" comes a minute after it finished: still just "your turn".
      if (e.notification_type === 'idle_prompt' || /waiting for your input/i.test(msg)) { if (s.state !== 'done') set('done'); }
      else set('waiting', msg || 'Needs your OK');
      break;
    }
    case 'Stop': set('done'); break;
    default: return false;
  }
  return true;
}

// While a session waits on you, its transcript changing means you answered and it's working again.
function checkWaiting() {
  let changed = false;
  for (const s of sessions.values()) {
    if (Date.now() - s.seen > FORGET_AFTER) { sessions.delete(s.id); changed = true; continue; }
    if (s.state !== 'waiting' || !s.transcript) continue;
    try {
      if (fs.statSync(s.transcript).mtimeMs > s.since + 1500) { s.state = 'working'; s.since = Date.now(); s.message = ''; changed = true; }
    } catch { /* gone */ }
  }
  if (changed) broadcast();
}

// ---------- server ----------
const clients = new Set();
function snapshot() {
  const order = { waiting: 0, working: 1, done: 2, idle: 3 };
  const list = [...sessions.values()]
    .sort((a, b) => order[a.state] - order[b.state] || b.since - a.since)
    .map(({ id, project, state, since, task, message }) => ({ id: id.slice(0, 8), project: project || 'Claude', state, since, task, message }));
  return JSON.stringify({ now: Date.now(), sessions: list });
}
function broadcast() { const d = `data: ${snapshot()}\n\n`; for (const res of clients) res.write(d); }

// Widgets load from 127.0.0.1 pages (the dashboard) or iCUE (no web origin). Websites are refused.
const pageOrigin = o => !o || o === 'null' || !/^https?:\/\//i.test(o) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(o);

function handle(req, res) {
  const origin = req.headers.origin;
  const url = (req.url || '').split('?')[0];
  if (req.method === 'POST' && url === '/event') {
    // Only the hook script: browsers always send an Origin on POST and can't add this header without a preflight.
    if (origin || req.headers['x-claude-edge'] !== '1') { res.writeHead(403); return res.end(); }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 200_000) req.destroy(); });
    req.on('end', () => {
      let e; try { e = JSON.parse(body); } catch { res.writeHead(400); return res.end(); }
      if (onEvent(e)) broadcast();
      res.writeHead(204); res.end();
    });
    return;
  }
  if (!pageOrigin(origin)) { res.writeHead(403); return res.end(); }
  const cors = origin ? { 'access-control-allow-origin': origin, vary: 'origin' } : {};
  if (req.method === 'GET' && url === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', ...cors });
    res.write(`retry: 3000\ndata: ${snapshot()}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.method === 'GET' && url === '/state') { res.writeHead(200, { 'content-type': 'application/json', ...cors }); return res.end(snapshot()); }
  res.writeHead(200, { 'content-type': 'text/plain' }); res.end('claude-edge helper ok');
}

const servers = [];
for (const host of ['127.0.0.1', '::1']) {
  const srv = http.createServer(handle);
  srv.on('error', e => {
    if (e.code === 'EADDRINUSE') { log(`Port ${PORT} on ${host} already in use`); if (!HOSTED) process.exit(0); return; }
    if (e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT') return;
    log('Server error:', e.message);
  });
  srv.listen(PORT, host);
  servers.push(srv);
}
const timer = setInterval(checkWaiting, 2000);
// Keep the event streams alive through anything that drops idle connections.
const ping = setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25_000);
log(`Claude status helper on ${PORT}`);

module.exports = {
  stop() { clearInterval(timer); clearInterval(ping); for (const res of clients) res.end(); for (const s of servers) s.close(); },
  _onEvent: onEvent, _snapshot: snapshot,
};
