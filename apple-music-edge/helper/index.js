// Apple Music helper for the Xeneon Edge widget.
// Reads the Apple Music session from Windows' media controls (via smtc.ps1)
// and serves now-playing state + controls to the iCUE widget on ws://localhost:6790.
'use strict';
// Runs standalone (`node index.js`) or loaded by the combined Edge helper (edge-helper/index.js).
const HOSTED = require.main !== module;


const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');

const DIR = __dirname;
const CONFIG_PATH = path.join(DIR, 'config.json');
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

// ---------- config (optional) ----------
let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { /* defaults */ }
const PORT = config.port || 6790;
const APP_MATCH = config.appMatch || 'AppleMusic|iTunes';

// ---------- state pushed to the widget ----------
const state = {
  status: 'starting', // starting | idle (Apple Music not open) | ready
  title: '', artist: '', album: '',
  playing: false,
  canNext: false, canPrev: false,
  position: 0, duration: 0, positionAt: 0, // positionAt = ms timestamp when position was sampled
  trackKey: '',
  art: null,
  // from the UI Automation bridge (uia.ps1)
  ui: false, shuffle: false, repeat: 'off', favorite: null,
  // from the audio bridge (audio.ps1)
  volume: 1, muted: false, volumeAvailable: false
};

// Apple Music for Windows puts "Artist — Album" in the artist field and leaves album empty.
function splitArtist(artist, album) {
  if (album || !artist) return { artist: artist || '', album: album || '' };
  const m = /^(.*?)\s+[—–]\s+(.*)$/.exec(artist);
  return m ? { artist: m[1], album: m[2] } : { artist, album: '' };
}

function snapshot() { return JSON.stringify({ type: 'state', state }); }

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

const ACTIONS = { toggle: 'toggle', play: 'play', pause: 'pause', next: 'next', prev: 'prev' };
const BROWSE = new Set(['playlists', 'list', 'play', 'playAll', 'search']);

wss.on('connection', (ws, req) => {
  log(`Widget connected (origin: ${req.headers.origin || 'none'})`);
  ws.wantsVis = false;
  ws.send(snapshot());
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const cmd = ACTIONS[msg.action];
    if (cmd) return sendCommand(cmd);
    switch (msg.action) {
      case 'shuffle':
        state.shuffle = !state.shuffle; broadcast();
        return uiRequest({ cmd: 'shuffle' }).catch(() => {});
      case 'repeat':
        state.repeat = { off: 'all', all: 'one', one: 'off' }[state.repeat] || 'off'; broadcast();
        return uiRequest({ cmd: 'repeat' }).catch(() => {});
      case 'favorite':
        if (state.favorite !== null) { state.favorite = !state.favorite; broadcast(); }
        return uiRequest({ cmd: 'favorite' }).catch(() => {});
      case 'seek': {
        const pos = Number(msg.pos);
        if (!(pos >= 0)) return;
        state.position = pos; state.positionAt = Date.now(); broadcast();
        return uiRequest({ cmd: 'seek', pos }).catch(e => log('seek failed:', e.message));
      }
      case 'volume': return setVolume(Number(msg.value));
      case 'mute': return audioSend(`mute ${msg.on ? 1 : 0}`);
      case 'vis': ws.wantsVis = !!msg.on; return updateVis();
      case 'art': return lookupArt(ws, msg.items || []);
      case 'browse': {
        if (!BROWSE.has(msg.req)) return;
        const { action, req: r, rid, ...args } = msg;
        if (r === 'play' || r === 'playAll') log(`Browse: ${r} ${args.title || args.target || ''} (${args.mode || ''})`);
        uiRequest({ cmd: r, ...args }, 60000)
          .then(data => reply(ws, { type: 'browse', rid, req: r, ok: true, data }))
          .catch(e => { log(`Browse ${r} failed:`, e.message); reply(ws, { type: 'browse', rid, req: r, ok: false, error: e.message }); });
      }
    }
  });
  ws.on('close', updateVis);
});

function reply(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function broadcast() {
  const data = snapshot();
  for (const c of wss.clients) if (c.readyState === 1) c.send(data);
}

function startServers() {
  for (const host of ['127.0.0.1', '::1']) {
    const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('apple-music-edge helper ok'); });
    srv.on('upgrade', onUpgrade);
    srv.on('error', e => {
      if (e.code === 'EADDRINUSE') { log(`Port ${PORT} on ${host} already in use - helper probably already running.${HOSTED ? '' : ' Exiting.'}`); if (!HOSTED) process.exit(0); return; }
      if (e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT') { log(`Skipping ${host}: ${e.code}`); return; }
      log('Server error:', e.message);
    });
    srv.listen(PORT, host, () => log(`Listening on ${host}:${PORT}`));
  }
}

// ---------- SMTC bridge (PowerShell child process) ----------
let bridge = null;

function sendCommand(cmd) {
  if (!bridge || !bridge.stdin.writable) return;
  log(`Command: ${cmd}`);
  bridge.stdin.write(cmd + '\n');
  // Optimistic flip so the button reacts instantly; the next poll corrects it.
  if (cmd === 'toggle' && state.status === 'ready') {
    state.position = currentPosition();
    state.positionAt = Date.now();
    state.playing = !state.playing;
    broadcast();
  }
}

function currentPosition() {
  if (!state.playing) return state.position;
  return Math.min(state.duration || Infinity, state.position + (Date.now() - state.positionAt) / 1000);
}

function onBridgeState(s) {
  const now = Date.now();
  if (!s.active) {
    if (state.status !== 'idle') {
      Object.assign(state, { status: 'idle', title: '', artist: '', album: '', playing: false, position: 0, duration: 0, positionAt: now, trackKey: '', art: null });
      log('Apple Music session gone');
      broadcast();
    }
    return;
  }
  const { artist, album } = splitArtist(s.artist, s.album);
  const playing = s.status === 'Playing';
  const expected = currentPosition();
  let changed = state.status !== 'ready' || s.trackKey !== state.trackKey || playing !== state.playing
    || s.title !== state.title || s.duration !== state.duration || s.canNext !== state.canNext || s.canPrev !== state.canPrev;
  // Only resend position when it drifts from what the widget is already extrapolating (e.g. a seek).
  if (Math.abs(s.position - expected) > 1.5) changed = true;

  if (s.trackKey !== state.trackKey) log(`Now playing: ${s.title} — ${artist}${album ? ' (' + album + ')' : ''}`);
  if (s.art) state.art = s.art;
  else if (s.trackKey !== state.trackKey) state.art = null;

  Object.assign(state, {
    status: 'ready', title: s.title || '', artist, album, playing,
    canNext: !!s.canNext, canPrev: !!s.canPrev, duration: s.duration || 0, trackKey: s.trackKey
  });
  if (changed) { state.position = s.position || 0; state.positionAt = now; broadcast(); }
}

function startBridge() {
  const script = path.join(DIR, 'smtc.ps1');
  bridge = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-AppMatch', APP_MATCH],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  log(`Started media bridge (pid ${bridge.pid})`);
  readline.createInterface({ input: bridge.stdout }).on('line', line => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.type === 'state') onBridgeState(msg);
  });
  readline.createInterface({ input: bridge.stderr }).on('line', line => { if (line.trim()) log('bridge:', line.trim()); });
  bridge.on('error', e => log('Bridge failed to launch:', e.message));
  bridge.on('exit', code => {
    bridge = null;
    if (stopping) return;
    log(`Media bridge exited (code ${code}), restarting in 3s`);
    setTimeout(startBridge, 3000);
  });
}

// ---------- generic PowerShell child with auto-restart ----------
function startChild(name, script, args, onLine) {
  const child = { proc: null, send(line) { if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(line + '\n'); } };
  const start = () => {
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(DIR, script), ...args],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.proc = proc;
    log(`Started ${name} bridge (pid ${proc.pid})`);
    readline.createInterface({ input: proc.stdout }).on('line', onLine);
    readline.createInterface({ input: proc.stderr }).on('line', line => { if (line.trim()) log(`${name}:`, line.trim()); });
    proc.on('error', e => log(`${name} bridge failed to launch:`, e.message));
    proc.on('exit', code => {
      child.proc = null;
      if (stopping) return;
      log(`${name} bridge exited (code ${code}), restarting in 3s`);
      if (child.onExit) child.onExit();
      setTimeout(start, 3000);
    });
    if (child.onStart) child.onStart();
  };
  setImmediate(start);
  return child;
}

// ---------- UI Automation bridge: shuffle / repeat / favorite / seek / browsing ----------
let ui = null, uiSeq = 0;
const uiPending = new Map();

function uiRequest(obj, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!ui || !ui.proc) return reject(new Error('Apple Music controls are starting up'));
    const id = ++uiSeq;
    const timer = setTimeout(() => { uiPending.delete(id); reject(new Error('Apple Music took too long to respond')); }, timeoutMs);
    uiPending.set(id, { resolve, reject, timer });
    ui.send(JSON.stringify({ id, ...obj }));
  });
}

function onUiLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.type === 'ext') {
    const next = { ui: !!msg.available, shuffle: !!msg.shuffle, repeat: msg.repeat || 'off', favorite: msg.favorite === undefined ? null : msg.favorite };
    if (Object.keys(next).some(k => state[k] !== next[k])) { Object.assign(state, next); broadcast(); }
  } else if (msg.type === 'reply') {
    const p = uiPending.get(msg.id);
    if (!p) return;
    uiPending.delete(msg.id); clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.data); else p.reject(new Error(msg.error || 'failed'));
  }
}

// ---------- audio bridge: visualizer + Apple Music volume ----------
let audio = null, visOn = null, lastVis = '';
function audioSend(line) { if (audio) audio.send(line); }

let volTimer = null, volPending = null;
function setVolume(v) {
  if (!(v >= 0 && v <= 1)) return;
  state.volume = v; state.muted = false;
  volPending = v;
  if (volTimer) return;
  volTimer = setTimeout(() => { volTimer = null; audioSend(`vol ${volPending}`); }, 60);
}

function updateVis() {
  const want = [...wss.clients].some(c => c.readyState === 1 && c.wantsVis);
  if (want !== visOn) { visOn = want; audioSend(want ? 'vis on' : 'vis off'); }
}

function onAudioLine(line) {
  if (line.startsWith('V ')) {
    const bars = line.slice(2);
    if (bars === lastVis && /^0*$/.test(bars)) return;
    lastVis = bars;
    const data = JSON.stringify({ type: 'vis', b: bars });
    for (const c of wss.clients) if (c.readyState === 1 && c.wantsVis) c.send(data);
  } else if (line.startsWith('S ')) {
    const [v, m, found] = line.slice(2).split(' ');
    const next = { volume: Number(v), muted: m === '1', volumeAvailable: found === '1' };
    if (volTimer && next.volumeAvailable) next.volume = state.volume; // don't fight a drag in progress
    if (Object.keys(next).some(k => state[k] !== next[k])) { Object.assign(state, next); broadcast(); }
  }
}

// ---------- artwork for browse lists (Apple's public iTunes Search API, cached on disk) ----------
const crypto = require('crypto');
const ART_DIR = path.join(DIR, 'art-cache');
const ART_LOOKUP = config.artworkLookup !== false;
const artMem = new Map();      // key -> data URL | '' (none found)
const artQueue = [];           // { key, term, entity, waiters: Set<ws> }
let artBusy = false;

function artKeyFor(it) { return `${(it.artist || '').toLowerCase()}|${(it.album || it.title || '').toLowerCase()}`.slice(0, 200); }
function artFile(key) { return path.join(ART_DIR, crypto.createHash('sha1').update(key).digest('hex') + '.json'); }

function lookupArt(ws, items) {
  if (!ART_LOOKUP) return;
  // walk backwards so that, after unshift, the first item in the list is looked up first
  for (const it of items.slice(0, 60).reverse()) {
    if (!it || !(it.title || it.album)) continue;
    const key = artKeyFor(it);
    if (artMem.has(key)) { if (artMem.get(key)) reply(ws, { type: 'art', key, url: artMem.get(key) }); continue; }
    try {
      const cached = JSON.parse(fs.readFileSync(artFile(key), 'utf8'));
      artMem.set(key, cached.url || '');
      if (cached.url) reply(ws, { type: 'art', key, url: cached.url });
      continue;
    } catch { /* not cached yet */ }
    let q = artQueue.find(x => x.key === key);
    if (!q) {
      const term = it.album ? `${it.artist || ''} ${it.album}` : `${it.artist || ''} ${it.title}`;
      q = { key, term: term.trim(), entity: it.album ? 'album' : 'song', waiters: new Set() };
      artQueue.unshift(q); // newest requests first: they're what's on screen
    }
    q.waiters.add(ws);
  }
  if (artQueue.length > 200) artQueue.length = 200;
  pumpArt();
}

async function pumpArt() {
  if (artBusy || !artQueue.length) return;
  artBusy = true;
  const q = artQueue.shift();
  let url = '';
  try {
    const res = await fetch(`https://itunes.apple.com/search?media=music&limit=1&entity=${q.entity}&term=${encodeURIComponent(q.term)}`);
    if (res.status === 403 || res.status === 429) {
      artQueue.unshift(q);
      log('Artwork lookups rate-limited, pausing a minute');
      setTimeout(() => { artBusy = false; pumpArt(); }, 60000);
      return;
    }
    const j = await res.json();
    const src = j.results && j.results[0] && j.results[0].artworkUrl100;
    if (src) {
      const img = await fetch(src.replace('100x100bb', '120x120bb'));
      const buf = Buffer.from(await img.arrayBuffer());
      url = 'data:' + (img.headers.get('content-type') || 'image/jpeg') + ';base64,' + buf.toString('base64');
    }
    fs.mkdirSync(ART_DIR, { recursive: true });
    fs.writeFileSync(artFile(q.key), JSON.stringify({ url }));
  } catch (e) { log('Artwork lookup failed:', e.message); }
  artMem.set(q.key, url);
  if (url) for (const ws of q.waiters) reply(ws, { type: 'art', key: q.key, url });
  // Apple allows roughly 20 searches a minute
  setTimeout(() => { artBusy = false; pumpArt(); }, 3100);
}

let stopping = false;
function stopBridges() {
  stopping = true;
  for (const c of [bridge, ui && ui.proc, audio && audio.proc]) if (c) { try { c.stdin.end(); c.kill(); } catch { /* ignore */ } }
}
function shutdown() { stopBridges(); process.exit(0); }
if (!HOSTED) {
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
// The combined Edge helper calls this when it exits, so the PowerShell bridges go with it.
module.exports = { stop: stopBridges };

startServers();
startBridge();
ui = startChild('controls', 'uia.ps1', [], onUiLine);
ui.onExit = () => {
  for (const [, p] of uiPending) { clearTimeout(p.timer); p.reject(new Error('Apple Music controls restarted')); }
  uiPending.clear(); state.ui = false; broadcast();
};
audio = startChild('audio', 'audio.ps1', ['-Bands', String(config.bars || 48)], onAudioLine);
audio.onStart = () => { visOn = null; setTimeout(updateVis, 3000); };

// Leave a trace in helper.log if this process dies, so overnight stops can be diagnosed.
// (When loaded by the combined Edge helper, the host handles crashes and exit for everyone.)
if (!HOSTED) {
  process.on('uncaughtException', e => { log('Crashed:', (e && e.stack) || String(e)); process.exit(1); });
  process.on('unhandledRejection', e => log('Unhandled promise rejection:', (e && e.stack) || String(e)));
  process.on('exit', code => { try { log(`Helper exiting (code ${code})`); } catch { /* ignore */ } });
}
