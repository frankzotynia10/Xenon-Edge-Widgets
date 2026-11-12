// Discord Voice helper for the Xeneon Edge widget.
// Talks to the local Discord client over its RPC named pipe and serves
// live voice state to the iCUE widget over ws://localhost:6789.
'use strict';
// Runs standalone (`node index.js`) or loaded by the combined Edge helper (edge-helper/index.js).
const HOSTED = require.main !== module;


const net = require('net');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');

const DIR = __dirname;
const CONFIG_PATH = path.join(DIR, 'config.json');
const TOKEN_PATH = path.join(DIR, 'token.json');
const LOG_PATH = path.join(DIR, 'helper.log');
const PORT = 6789;
const SETTINGS_PATH = path.join(DIR, 'settings.json');
// rpc.notifications.read powers the Messages panel; adding it asked for approval in Discord once.
// (Discord doesn't let non-partner apps read channel messages over RPC - GET_CHANNEL returns none and
// MESSAGE_* subscriptions fail with 4005 - so "messages" here are the notifications Discord would show you.)
const SCOPES = ['rpc', 'rpc.voice.read', 'rpc.voice.write', 'rpc.notifications.read'];
const ALERT_LIMIT = 60;    // recent notifications kept
const CHANNEL_EVENTS = ['VOICE_STATE_CREATE', 'VOICE_STATE_UPDATE', 'VOICE_STATE_DELETE', 'SPEAKING_START', 'SPEAKING_STOP'];

// ---------- logging ----------
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  console.log(line);
  try {
    // keep the log from growing forever
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 1_000_000) fs.renameSync(LOG_PATH, LOG_PATH + '.old');
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch { /* ignore */ }
}

// ---------- config ----------
let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (e) {
  log(`Missing or invalid config.json (${e.message}). Copy config.example.json to config.json and fill it in.`);
  if (HOSTED) throw new Error('Discord helper: missing or invalid config.json');
  process.exit(1);
}
const { clientId, clientSecret } = config;
const redirectUri = config.redirectUri || 'http://localhost';
if (!clientId || !clientSecret || clientId.startsWith('PUT_')) {
  log('config.json needs clientId and clientSecret from the Discord Developer Portal.');
  if (HOSTED) throw new Error('Discord helper: config.json needs clientId and clientSecret');
  process.exit(1);
}

// ---------- state pushed to the widget ----------
const state = {
  status: 'starting', // starting | no_discord | authorizing | ready | error
  message: '',
  channel: null,      // { id, name, guild }
  self: { id: null, mute: false, deaf: false, live: false },
  members: [],        // { id, name, avatar, mute, deaf, speaking, volume, localMute }
  pins: [],           // favorite voice channels: { id, type: 'voice', name, guild, guildId, members: [{id,name,avatar}], missing? }
  alerts: [],         // notifications: { id, title, body, icon, author, channelId, channel, guild, ts }
  alertsEnabled: false
};

// ---------- saved settings (pins) ----------
let settings = { pins: [] };   // [{ id, type, name, guild, guildId }]
try { settings = { pins: [], ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) }; } catch { /* first run */ }
function saveSettings() {
  try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2)); } catch (e) { log('Could not save settings:', e.message); }
}
const membersById = new Map();
const speaking = new Set();

function setStatus(status, message = '') {
  state.status = status;
  state.message = message;
  broadcast();
}

function snapshot() {
  state.members = [...membersById.values()]
    .map(m => ({ ...m, speaking: speaking.has(m.id) }))
    .sort((a, b) => (a.id === state.self.id ? -1 : b.id === state.self.id ? 1 : a.name.localeCompare(b.name)));
  return JSON.stringify({ type: 'state', state });
}

// ---------- websocket server for the widget ----------
const wss = new WebSocketServer({ noServer: true });

function originAllowed(origin) {
  if (config.allowAnyOrigin) return true;
  // Block ordinary web pages; allow the iCUE widget host (file/qrc/null/no origin).
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
  ws.send(snapshot());
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    handleWidgetAction(msg, ws)
      .then(data => { if (msg.rid) reply(ws, { type: 'reply', rid: msg.rid, ok: true, data }); })
      .catch(e => {
        log('Action failed:', msg.action, e.message);
        if (msg.rid) reply(ws, { type: 'reply', rid: msg.rid, ok: false, error: e.message });
      });
  });
});

function reply(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function broadcast() {
  const data = snapshot();
  for (const c of wss.clients) if (c.readyState === 1) c.send(data);
}

function startServers() {
  // Chromium may resolve "localhost" to IPv4 or IPv6, so listen on both loopbacks.
  let listening = 0;
  for (const host of ['127.0.0.1', '::1']) {
    const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('discord-edge helper ok'); });
    srv.on('upgrade', onUpgrade);
    srv.on('error', e => {
      if (e.code === 'EADDRINUSE') { log(`Port ${PORT} on ${host} already in use - helper probably already running.${HOSTED ? '' : ' Exiting.'}`); if (!HOSTED) process.exit(0); return; }
      if (e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT') { log(`Skipping ${host}: ${e.code}`); return; }
      log('Server error:', e.message);
    });
    srv.listen(PORT, host, () => { listening++; log(`Listening on ${host}:${PORT}`); });
  }
}

// ---------- Discord IPC ----------
const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
let sock = null;
let buf = Buffer.alloc(0);
const pending = new Map();
let readyResolve = null;

function connectPipe() {
  return new Promise((resolve, reject) => {
    let i = 0;
    const tryNext = () => {
      if (i > 9) return reject(new Error('Discord is not running'));
      const p = process.env.DISCORD_IPC_PATH || `\\\\?\\pipe\\discord-ipc-${i}`;
      i++;
      const s = net.createConnection(p);
      const onErr = () => { s.destroy(); tryNext(); };
      s.once('error', onErr);
      s.once('connect', () => { s.removeListener('error', onErr); resolve(s); });
    };
    tryNext();
  });
}

function send(op, payload) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(json.length, 4);
  sock.write(Buffer.concat([header, json]));
}

function request(cmd, args = {}, evt) {
  return new Promise((resolve, reject) => {
    const nonce = randomUUID();
    const timeout = setTimeout(() => { pending.delete(nonce); reject(new Error(`${cmd} timed out`)); }, cmd === 'AUTHORIZE' ? 300000 : 10000);
    pending.set(nonce, { resolve, reject, timeout });
    const payload = { cmd, args, nonce };
    if (evt) payload.evt = evt;
    send(OP.FRAME, payload);
  });
}

const subscribe = (evt, args = {}) => request('SUBSCRIBE', args, evt);
const unsubscribe = (evt, args = {}) => request('UNSUBSCRIBE', args, evt).catch(() => {});

function onData(chunk) {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 8) {
    const op = buf.readInt32LE(0);
    const len = buf.readInt32LE(4);
    if (buf.length < 8 + len) break;
    const body = buf.subarray(8, 8 + len).toString('utf8');
    buf = buf.subarray(8 + len);
    let msg;
    try { msg = JSON.parse(body); } catch { continue; }
    if (op === OP.PING) { send(OP.PONG, msg); continue; }
    if (op === OP.CLOSE) { log('Discord closed the connection:', msg); sock.destroy(); continue; }
    onMessage(msg);
  }
}

function onMessage(msg) {
  if (msg.nonce && pending.has(msg.nonce)) {
    const p = pending.get(msg.nonce);
    pending.delete(msg.nonce);
    clearTimeout(p.timeout);
    if (msg.evt === 'ERROR') p.reject(new Error(`${msg.cmd}: ${msg.data && msg.data.message} (${msg.data && msg.data.code})`));
    else p.resolve(msg.data);
    return;
  }
  if (msg.cmd !== 'DISPATCH') return;
  switch (msg.evt) {
    case 'READY': if (readyResolve) readyResolve(msg.data); break;
    case 'VOICE_CHANNEL_SELECT': onChannelSelect(msg.data).catch(e => log('Channel select failed:', e.message)); break;
    case 'VOICE_STATE_CREATE':
    case 'VOICE_STATE_UPDATE': upsertMember(msg.data); broadcast(); break;
    case 'VOICE_STATE_DELETE': membersById.delete(msg.data.user.id); speaking.delete(msg.data.user.id); broadcast(); break;
    case 'SPEAKING_START': speaking.add(msg.data.user_id); broadcast(); break;
    case 'SPEAKING_STOP': speaking.delete(msg.data.user_id); broadcast(); break;
    case 'VOICE_SETTINGS_UPDATE': state.self.mute = !!msg.data.mute; state.self.deaf = !!msg.data.deaf; broadcast(); break;
    case 'NOTIFICATION_CREATE': onNotification(msg.data).catch(e => log('Notification failed:', e.message)); break;
  }
}

// ---------- OAuth token handling ----------
function loadToken() {
  try { return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')); } catch { return null; }
}
function saveToken(t) {
  const tok = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in - 60) * 1000,
    scopes: t.scope ? String(t.scope).split(' ') : SCOPES };
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tok, null, 2));
  return tok;
}
async function tokenRequest(params) {
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${JSON.stringify(body)}`);
  return saveToken(body);
}

async function authenticate() {
  let tok = loadToken();
  // Tokens from before a scope was added (e.g. alerts) need one new approval in Discord.
  if (tok && (!tok.scopes || SCOPES.some(sc => !tok.scopes.includes(sc)))) {
    log('Saved token is missing newer permissions - asking Discord to approve them once');
    tok = null;
  }
  if (tok && Date.now() > tok.expires_at && tok.refresh_token) {
    try { tok = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tok.refresh_token }); log('Refreshed token'); }
    catch (e) { log(e.message); tok = null; }
  }
  if (tok) {
    try { return await request('AUTHENTICATE', { access_token: tok.access_token }); }
    catch (e) { log('Saved token rejected, re-authorizing:', e.message); }
  }
  setStatus('authorizing', 'Approve the prompt in Discord');
  log('Requesting authorization - approve the popup in Discord');
  const { code } = await request('AUTHORIZE', { client_id: clientId, scopes: SCOPES });
  tok = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  return request('AUTHENTICATE', { access_token: tok.access_token });
}

// ---------- voice channel tracking ----------
function avatarUrl(user) {
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  const idx = Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

function upsertMember(vs) {
  const u = vs.user;
  const v = vs.voice_state || {};
  membersById.set(u.id, {
    id: u.id,
    name: vs.nick || u.global_name || u.username,
    avatar: avatarUrl(u),
    mute: !!(v.self_mute || v.mute || v.suppress),
    deaf: !!(v.self_deaf || v.deaf),
    stream: !!(v.self_stream || vs.self_stream),
    volume: typeof vs.volume === 'number' ? Math.round(vs.volume) : 100,   // 0-200, your local volume for them
    localMute: !!vs.mute                                                    // muted for you only
  });
}

let currentChannelId = null;

async function setChannel(ch) {
  if (currentChannelId) {
    for (const evt of CHANNEL_EVENTS) await unsubscribe(evt, { channel_id: currentChannelId });
  }
  membersById.clear();
  speaking.clear();
  if (!ch || ch.id !== currentChannelId) state.self.live = false;
  currentChannelId = ch ? ch.id : null;
  if (!ch) { state.channel = null; broadcast(); return; }

  let guild = '';
  if (ch.guild_id) {
    try { guild = (await request('GET_GUILD', { guild_id: ch.guild_id })).name; } catch { /* ignore */ }
  }
  state.channel = { id: ch.id, name: ch.name || 'Call', guild };
  for (const vs of ch.voice_states || []) upsertMember(vs);
  for (const evt of CHANNEL_EVENTS) await subscribe(evt, { channel_id: ch.id });
  log(`Tracking voice channel: ${guild ? guild + ' / ' : ''}${state.channel.name} (${membersById.size} members)`);
  broadcast();
}

async function onChannelSelect(data) {
  if (!data || !data.channel_id) return setChannel(null);
  if (data.channel_id === currentChannelId) return;
  return setChannel(await request('GET_CHANNEL', { channel_id: data.channel_id }));
}

// ---------- servers / channels ----------
const CH_VOICE = 2, CH_STAGE = 13;
const isVoiceType = t => t === CH_VOICE || t === CH_STAGE;
let guildCache = { at: 0, list: [] };

async function listGuilds() {
  if (Date.now() - guildCache.at < 5 * 60_000 && guildCache.list.length) return guildCache.list;
  const r = await request('GET_GUILDS');
  guildCache = { at: Date.now(), list: (r.guilds || []).map(g => ({ id: g.id, name: g.name, icon: g.icon_url || null })) };
  return guildCache.list;
}
function guildName(id) { const g = guildCache.list.find(x => x.id === id); return g ? g.name : ''; }

function brief(vs) {
  const u = vs.user || {};
  return { id: u.id, name: vs.nick || u.global_name || u.username, avatar: avatarUrl(u) };
}

// Voice and text channels for one server; voice channels include who's in them.
async function listChannels(guildId) {
  await listGuilds().catch(() => {});
  const r = await request('GET_CHANNELS', { guild_id: guildId });
  const chans = (r.channels || []).filter(c => isVoiceType(c.type));
  const voice = chans.filter(c => isVoiceType(c.type)).slice(0, 40);
  const detail = await Promise.all(voice.map(c => request('GET_CHANNEL', { channel_id: c.id }).catch(() => null)));
  const membersOf = {};
  voice.forEach((c, i) => { membersOf[c.id] = ((detail[i] && detail[i].voice_states) || []).map(brief); });
  const pinned = new Set(settings.pins.map(x => x.id));
  return chans.map(c => ({ id: c.id, name: c.name, type: 'voice', guildId, members: membersOf[c.id] || [], pinned: pinned.has(c.id) }));
}

async function joinVoice(channelId) {
  if (!channelId) throw new Error('No channel');
  await request('SELECT_VOICE_CHANNEL', { channel_id: channelId, force: true, timeout: 10 });
}

// ---------- pins (favorite voice channels, followed text channels) ----------
async function setPin(channelId, on) {
  const existing = settings.pins.find(x => x.id === channelId);
  if (on && !existing) {
    const ch = await request('GET_CHANNEL', { channel_id: channelId });
    await listGuilds().catch(() => {});
    if (!isVoiceType(ch.type)) throw new Error('Only voice channels can be favorites');
    settings.pins.push({ id: ch.id, type: 'voice', name: ch.name, guildId: ch.guild_id || null, guild: guildName(ch.guild_id) });
  } else if (!on && existing) {
    settings.pins = settings.pins.filter(x => x.id !== channelId);
  } else return state.pins;
  saveSettings();
  await refreshPins();
  return state.pins;
}
function movePin(channelId, dir) {
  const i = settings.pins.findIndex(x => x.id === channelId);
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= settings.pins.length) return;
  [settings.pins[i], settings.pins[j]] = [settings.pins[j], settings.pins[i]];
  saveSettings();
}

// Refresh names and who's-in-it for pinned voice channels.
async function refreshPins() {
  const out = [];
  for (const p of settings.pins) {
    const item = { id: p.id, type: p.type, name: p.name, guild: p.guild, guildId: p.guildId };
    if (state.status === 'ready') {
      try {
        const ch = await request('GET_CHANNEL', { channel_id: p.id });
        item.name = ch.name || p.name;
        if (p.type === 'voice') item.members = (ch.voice_states || []).map(brief);
        if (ch.name && ch.name !== p.name) { p.name = ch.name; saveSettings(); }
      } catch { item.missing = true; if (p.type === 'voice') item.members = []; }
    }
    out.push(item);
  }
  state.pins = out;
  broadcast();
}

// ---------- per-user voice settings (only affects what you hear) ----------
async function setUserVoice(userId, { volume, mute }) {
  const args = { user_id: userId };
  if (typeof volume === 'number') args.volume = Math.max(0, Math.min(200, Math.round(volume)));
  if (typeof mute === 'boolean') args.mute = mute;
  await request('SET_USER_VOICE_SETTINGS', args);
  const m = membersById.get(userId);
  if (m) { if ('volume' in args) m.volume = args.volume; if ('mute' in args) m.localMute = args.mute; broadcast(); }
}

// Turn <@123>, <#123>, <:emoji:123> into readable text.
function cleanContent(m) {
  let t = String((m && m.content) || '');
  const names = {};
  for (const u of (m && m.mentions) || []) names[u.id] = u.global_name || u.username;
  return t.replace(/<@!?(\d+)>/g, (_, id) => '@' + (names[id] || 'someone'))
    .replace(/<@&\d+>/g, '@role').replace(/<#(\d+)>/g, '#channel')
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .replace(/<t:(\d+)(:\w)?>/g, (_, sec) => new Date(Number(sec) * 1000).toLocaleString());
}

// ---------- notifications (mentions, DMs, and any channel set to "All Messages") ----------
const channelInfo = new Map(); // channel id -> { channel, guild }
async function describeChannel(id) {
  if (!id) return {};
  if (channelInfo.has(id)) return channelInfo.get(id);
  let info = {};
  try {
    const ch = await request('GET_CHANNEL', { channel_id: id });
    await listGuilds().catch(() => {});
    info = { channel: ch.name || '', guild: ch.guild_id ? guildName(ch.guild_id) : '', dm: !ch.guild_id };
  } catch { /* unknown */ }
  channelInfo.set(id, info);
  return info;
}
async function onNotification(d) {
  const m = d.message || {};
  const a = m.author || {};
  const info = await describeChannel(d.channel_id);
  const myId = state.self.id;
  const mentionsMe = !!((m.mentions || []).some(u => u.id === myId) || m.mention_everyone);
  state.alerts.unshift({
    id: m.id || randomUUID(), title: d.title || 'Discord', body: d.body || cleanContent(m),
    icon: d.icon_url || (a.id ? avatarUrl(a) : null), author: m.nick || a.global_name || a.username || '',
    channelId: d.channel_id || null, channel: info.channel || '', guild: info.guild || '', dm: !!info.dm,
    mention: mentionsMe || !!info.dm, ts: Date.now()
  });
  if (state.alerts.length > ALERT_LIMIT) state.alerts.length = ALERT_LIMIT;
  log(`Notification: ${d.title || ''}`);
  broadcast();
}

// ---------- synthetic hotkey (for Discord's Go Live keybind) ----------
// Discord's RPC has no "start stream" command, so we press the Go Live keybind
// you set in Discord > Settings > Keybinds.
const VK = { ctrl: 0x11, control: 0x11, alt: 0x12, shift: 0x10, win: 0x5B,
  '/': 0xBF, ';': 0xBA, '=': 0xBB, ',': 0xBC, '-': 0xBD, '.': 0xBE, '`': 0xC0, '[': 0xDB, '\\': 0xDC, ']': 0xDD, "'": 0xDE };
function vkFor(key) {
  const k = String(key).toLowerCase();
  if (VK[k]) return VK[k];
  const f = /^f(\d{1,2})$/.exec(k);
  if (f) return 0x6F + Number(f[1]);
  if (/^[a-z0-9]$/.test(k)) return k.toUpperCase().charCodeAt(0);
  throw new Error(`Unsupported key "${key}" in goLiveKeys`);
}
function pressHotkey(keys) {
  const vks = keys.map(vkFor);
  const script = path.join(DIR, 'sendkeys.ps1');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...vks.map(String)],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  child.on('error', e => log('Hotkey failed to launch:', e.message));
  child.on('exit', code => log(`Hotkey sent (exit ${code})${out.trim() ? ': ' + out.trim() : ''}`));
}

// ---------- widget actions ----------
async function handleWidgetAction(msg) {
  const action = msg.action;
  if (action === 'goLive') {
    const keys = config.goLiveKeys || ['ctrl', 'alt', 'shift', '/'];
    if (!state.channel) return;
    // Discord doesn't report stream state over RPC, so track our own toggles.
    state.self.live = !state.self.live;
    log(`Pressing Go Live keybind: ${keys.join('+')} (now ${state.self.live ? 'live' : 'not live'})`);
    broadcast();
    return pressHotkey(keys);
  }
  if (action === 'clearAlerts') { state.alerts = []; broadcast(); return; }
  if (action === 'dismissAlert') { state.alerts = state.alerts.filter(a => a.id !== msg.id); broadcast(); return; }
  if (state.status !== 'ready') throw new Error('Discord isn\'t connected');
  switch (action) {
    case 'toggleMute': return void await request('SET_VOICE_SETTINGS', { mute: !state.self.mute });
    case 'toggleDeaf': return void await request('SET_VOICE_SETTINGS', { deaf: !state.self.deaf });
    case 'disconnect': return void await request('SELECT_VOICE_CHANNEL', { channel_id: null, force: true });
    case 'guilds': return listGuilds();
    case 'channels': return listChannels(String(msg.guildId));
    case 'join': return void await joinVoice(String(msg.channelId));
    case 'pin': return setPin(String(msg.channelId), !!msg.on);
    case 'movePin': movePin(String(msg.channelId), msg.dir); return refreshPins();
    case 'refreshPins': return refreshPins();
    case 'userVolume': return void await setUserVoice(String(msg.userId), { volume: Number(msg.volume) });
    case 'userMute': return void await setUserVoice(String(msg.userId), { mute: !!msg.mute });
    case 'openChannel': return void await request('SELECT_TEXT_CHANNEL', { channel_id: String(msg.channelId) });
  }
}

// ---------- main loop ----------
async function session() {
  sock = await connectPipe();
  buf = Buffer.alloc(0);
  let isReady = false;
  const ready = new Promise((resolve, reject) => {
    readyResolve = d => { isReady = true; resolve(d); };
    sock.once('close', () => { if (!isReady) reject(new Error('Discord closed the pipe during handshake (check clientId)')); });
  });
  const closed = new Promise(resolve => sock.once('close', () => {
    // fail any in-flight requests immediately instead of waiting for timeouts
    for (const p of pending.values()) { clearTimeout(p.timeout); p.reject(new Error('Discord connection closed')); }
    pending.clear();
    resolve();
  }));
  sock.on('data', onData);
  sock.on('error', e => log('Pipe error:', e.message));

  send(OP.HANDSHAKE, { v: 1, client_id: clientId });
  await ready;
  log('Connected to Discord');

  const auth = await authenticate();
  state.self.id = auth.user.id;
  log(`Authenticated as ${auth.user.username}`);

  await subscribe('VOICE_CHANNEL_SELECT');
  await subscribe('VOICE_SETTINGS_UPDATE');
  const vsettings = await request('GET_VOICE_SETTINGS');
  state.self.mute = !!vsettings.mute;
  state.self.deaf = !!vsettings.deaf;
  setStatus('ready');
  await setChannel(await request('GET_SELECTED_VOICE_CHANNEL'));
  try { await subscribe('NOTIFICATION_CREATE'); state.alertsEnabled = true; }
  catch (e) { state.alertsEnabled = false; log('Mention alerts unavailable:', e.message); }
  await listGuilds().catch(e => log('Could not list servers:', e.message));
  for (const p of settings.pins) if (!p.guild && p.guildId) p.guild = guildName(p.guildId);
  settings.pins = settings.pins.filter(p => p.type === 'voice');
  await refreshPins();

  await closed;
  throw new Error('Discord connection closed');
}

// Pinned voice channels show who's in them; refresh that every 20s while a widget is watching.
setInterval(() => {
  if (state.status === 'ready' && settings.pins.some(p => p.type === 'voice') && [...wss.clients].some(c => c.readyState === 1)) {
    refreshPins().catch(() => {});
  }
}, 20_000);

async function main() {
  startServers();
  for (;;) {
    try {
      await session();
    } catch (e) {
      log(e.message);
      for (const p of pending.values()) { clearTimeout(p.timeout); p.reject(new Error('connection reset')); }
      pending.clear();
      if (sock) sock.destroy();
      currentChannelId = null;
      membersById.clear();
      speaking.clear();
      state.channel = null;
      state.self.live = false;
      state.alertsEnabled = false;
      setStatus('no_discord', /not running/.test(e.message) ? 'Discord is not running' : e.message);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
}

main();

// Leave a trace in helper.log if this process dies, so overnight stops can be diagnosed.
// (When loaded by the combined Edge helper, the host handles crashes and exit for everyone.)
if (!HOSTED) {
  process.on('uncaughtException', e => { log('Crashed:', (e && e.stack) || String(e)); process.exit(1); });
  process.on('unhandledRejection', e => log('Unhandled promise rejection:', (e && e.stack) || String(e)));
  process.on('exit', code => { try { log(`Helper exiting (code ${code})`); } catch { /* ignore */ } });
}
