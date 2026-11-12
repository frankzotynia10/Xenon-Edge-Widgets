// Teams helper for the Xeneon Edge widget. Serves meeting state + controls on ws://localhost:6793.
//
// Two sources, best first:
//  1. Teams' own "third-party app API" on ws://127.0.0.1:8124 (Settings > Privacy > Manage API).
//     Not available on every PC/tenant - on this one Teams never opens it.
//  2. UI Automation on the Teams meeting window (teams-uia.ps1): reads the mic/camera/hand/share
//     buttons and presses them directly. Works whenever a meeting window is open.
// Pairing (API only): the first button press in a meeting asks you to allow "Edge Widget" in Teams.
'use strict';
// Runs standalone (`node index.js`) or loaded by the combined Edge helper (edge-helper/index.js).
const HOSTED = require.main !== module;

const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const graph = require('./graph');
const { WebSocketServer } = WebSocket;

const DIR = __dirname;
const CONFIG_PATH = path.join(DIR, 'config.json');
const TOKEN_PATH = path.join(DIR, 'token.json');
const LOG_PATH = path.join(DIR, 'helper.log');

let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { /* defaults */ }
const PORT = config.port || 6793;
const TEAMS_URL = config.teamsUrl || 'ws://127.0.0.1:8124';
const APP = { manufacturer: 'Frank', device: 'Xeneon Edge', app: 'Edge Widget', 'app-version': '1.0' };

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  if (!HOSTED) console.log(line);
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 1_000_000) fs.renameSync(LOG_PATH, LOG_PATH + '.old');
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch { /* ignore */ }
}

// ---------- state pushed to the widget ----------
const EMPTY_MEETING = { isInMeeting: false, isMuted: false, isVideoOn: false, isHandRaised: false, isBackgroundBlurred: false,
  isSharing: false, isRecordingOn: false, hasUnreadMessages: false };
const EMPTY_PERMS = { canToggleMute: false, canToggleVideo: false, canToggleHand: false, canToggleBlur: false, canLeave: false,
  canReact: false, canToggleShareTray: false, canToggleChat: false, canStopSharing: false, canPair: false };
const state = {
  status: 'starting',   // starting | waiting (not in a meeting) | connected | pairing
  source: 'none',       // api | uia | none
  title: '',            // meeting window title (UI Automation only)
  paired: false,
  meeting: { ...EMPTY_MEETING },
  perms: { ...EMPTY_PERMS },
  lastError: '',
  calendar: null          // Microsoft Graph agenda (graph.js), shown on the L / XL widget sizes
};
function snapshot() { return JSON.stringify({ type: 'state', state }); }

// ---------- widget websocket ----------
const wss = new WebSocketServer({ noServer: true });
function originAllowed(origin) {
  if (config.allowAnyOrigin) return true;
  if (!origin || origin === 'null') return true;
  return !/^https?:\/\//i.test(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}
function onUpgrade(req, socket, head) {
  if (!originAllowed(req.headers.origin)) { log(`Rejected widget connection from origin ${req.headers.origin}`); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
}
function broadcast() { const d = snapshot(); for (const c of wss.clients) if (c.readyState === 1) c.send(d); }

const ACTIONS = {
  toggleMute: 'toggle-mute', toggleVideo: 'toggle-video', toggleHand: 'toggle-hand', toggleBlur: 'toggle-background-blur',
  leave: 'leave-call', stopSharing: 'stop-sharing'
};
const REACTIONS = new Set(['like', 'love', 'applause', 'wow', 'laugh']);

// widget action -> UI Automation bridge command
const UIA_CMDS = { toggleMute: 'mute', toggleVideo: 'video', toggleHand: 'hand', leave: 'leave', stopSharing: 'share',
  toggleShareTray: 'share', toggleChat: 'chat' };

wss.on('connection', (ws, req) => {
  log(`Widget connected (origin: ${req.headers.origin || 'none'})`);
  ws.send(snapshot());
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.action === 'calSignIn') return void graph.startSignIn().catch(e => log('Graph sign-in error:', e.message));
    if (msg.action === 'calCancelSignIn') return graph.cancelSignIn();
    if (msg.action === 'calRefresh') return void graph.refreshCalendar().catch(e => log('Graph refresh error:', e.message));
    if (msg.action === 'calJoin' && typeof msg.id === 'string') return void graph.joinEvent(msg.id);
    if (state.source === 'uia') {
      if (msg.action === 'react' && REACTIONS.has(msg.type)) return uiaSend(`react ${msg.type}`);
      if (UIA_CMDS[msg.action]) return uiaSend(UIA_CMDS[msg.action]);
      return;
    }
    if (ACTIONS[msg.action]) return teamsAction(ACTIONS[msg.action]);
    if (msg.action === 'react' && REACTIONS.has(msg.type)) return teamsAction('send-reaction', { type: msg.type });
    if (msg.action === 'toggleChat') return teamsAction('toggle-ui', { type: 'chat' });
    if (msg.action === 'toggleShareTray') return teamsAction('toggle-ui', { type: 'sharing-tray' });
  });
});

function startServers() {
  for (const host of ['127.0.0.1', '::1']) {
    const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('teams-edge helper ok'); });
    srv.on('upgrade', onUpgrade);
    srv.on('error', e => {
      if (e.code === 'EADDRINUSE') { log(`Port ${PORT} on ${host} already in use - helper probably already running.${HOSTED ? '' : ' Exiting.'}`); if (!HOSTED) process.exit(0); return; }
      if (e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT') return;
      log('Server error:', e.message);
    });
    srv.listen(PORT, host, () => log(`Listening on ${host}:${PORT}`));
  }
}

// ---------- Teams local API ----------
function loadToken() { try { return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')).token || ''; } catch { return ''; } }
function saveToken(t) { try { fs.writeFileSync(TOKEN_PATH, JSON.stringify({ token: t, savedAt: new Date().toISOString() }, null, 2)); } catch (e) { log('Could not save token:', e.message); } }

let teams = null, reqId = 1, retryTimer = null, everConnected = false, lastWaitLog = 0;

function teamsUrl() {
  const q = new URLSearchParams({ token: loadToken(), 'protocol-version': '2.0.0', ...APP });
  return `${TEAMS_URL}?${q.toString()}`;
}

function connectTeams() {
  clearTimeout(retryTimer);
  let ws;
  try { ws = new WebSocket(teamsUrl()); } catch (e) { return scheduleRetry(); }
  teams = ws;
  ws.on('open', () => {
    everConnected = true;
    state.source = 'api';
    state.status = loadToken() ? 'connected' : 'pairing';
    state.paired = !!loadToken();
    log(`Connected to Teams (${state.paired ? 'paired' : 'not paired yet - press a button during the meeting and allow it in Teams'})`);
    broadcast();
    send({ action: 'query-state', parameters: {}, requestId: reqId++ });
  });
  ws.on('message', raw => onTeamsMessage(raw));
  ws.on('close', (code, reason) => {
    if (teams === ws) teams = null;
    if (state.source === 'api') {
      log(`Teams API closed (${code}${reason && reason.length ? ' ' + reason : ''})`);
      state.source = 'none'; state.status = 'waiting';
      state.meeting = { ...EMPTY_MEETING }; state.perms = { ...EMPTY_PERMS };
      applyUia(); // fall back to whatever UI Automation sees
      broadcast();
    }
    scheduleRetry();
  });
  ws.on('error', e => {
    // ECONNREFUSED just means Teams isn't in a meeting (it only opens the API then)
    if (e.code !== 'ECONNREFUSED') { state.lastError = e.message; log('Teams API error:', e.message); }
    else if (Date.now() - lastWaitLog > 30 * 60_000) { lastWaitLog = Date.now(); log('Teams API not open (normal outside meetings) - checking every few seconds'); }
  });
}
function scheduleRetry() { clearTimeout(retryTimer); retryTimer = setTimeout(connectTeams, 3000); }
function send(obj) { if (teams && teams.readyState === 1) { teams.send(JSON.stringify(obj)); return true; } return false; }

function teamsAction(action, parameters = {}) {
  if (!send({ action, parameters, requestId: reqId++ })) { log(`Can't ${action}: Teams API not connected (are you in a meeting?)`); return; }
  log(`Action: ${action}${parameters.type ? ' ' + parameters.type : ''}`);
}

function onTeamsMessage(raw) {
  let msg; try { msg = JSON.parse(raw); } catch { return; }
  if (msg.tokenRefresh) {
    saveToken(msg.tokenRefresh);
    state.paired = true; state.status = 'connected';
    log('Paired with Teams (token saved)');
    broadcast();
    return;
  }
  if (msg.meetingUpdate) {
    const u = msg.meetingUpdate;
    state.source = 'api';
    if (u.meetingState) Object.assign(state.meeting, EMPTY_MEETING, u.meetingState);
    if (u.meetingPermissions) Object.assign(state.perms, EMPTY_PERMS, u.meetingPermissions);
    if (state.status === 'waiting' || state.status === 'starting') state.status = state.paired ? 'connected' : 'pairing';
    broadcast();
    return;
  }
  if (msg.response || msg.errorMsg) {
    if (msg.errorMsg) log('Teams said:', msg.errorMsg);
    return;
  }
  log('Teams message:', String(raw).slice(0, 300));
}

// ---------- UI Automation bridge (fallback when the API isn't available) ----------
let uia = null, uiaLast = null, uiaStopping = false;
function startUia() {
  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(DIR, 'teams-uia.ps1')],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  uia = proc;
  readline.createInterface({ input: proc.stdout }).on('line', line => {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.type === 'log') return log('uia:', m.msg);
    if (m.type === 'meeting') {
      const was = uiaLast && uiaLast.inMeeting;
      uiaLast = m;
      if (m.inMeeting && !was) log(`Meeting window found: ${m.title}`);
      if (!m.inMeeting && was) log('Meeting window closed');
      applyUia();
    }
  });
  readline.createInterface({ input: proc.stderr }).on('line', l => { if (l.trim()) log('uia stderr:', l.trim()); });
  proc.on('exit', code => {
    uia = null;
    if (uiaStopping) return;
    log(`UI Automation bridge exited (code ${code}), restarting in 3s`);
    setTimeout(startUia, 3000);
  });
}
function uiaSend(cmd) {
  if (!uia || !uia.stdin.writable) return log(`Can't ${cmd}: UI Automation bridge not running`);
  log(`Action (uia): ${cmd}`);
  uia.stdin.write(cmd + '\n');
}
function applyUia() {
  if (state.source === 'api') return;          // the official API wins when it's available
  const m = uiaLast;
  if (!m || !m.inMeeting) {
    if (state.source === 'uia' || state.status !== 'waiting') {
      state.source = 'none'; state.status = 'waiting'; state.title = '';
      state.meeting = { ...EMPTY_MEETING }; state.perms = { ...EMPTY_PERMS };
      broadcast();
    }
    return;
  }
  state.source = 'uia'; state.status = 'connected'; state.title = m.title || '';
  state.meeting = { ...EMPTY_MEETING, isInMeeting: true, isMuted: m.isMuted, isVideoOn: m.isVideoOn, isHandRaised: m.isHandRaised,
    isSharing: m.isSharing, hasUnreadMessages: m.hasUnreadMessages };
  state.perms = { ...EMPTY_PERMS, canToggleMute: m.canToggleMute, canToggleVideo: m.canToggleVideo, canToggleHand: m.canToggleHand,
    canReact: m.canReact, canToggleChat: m.canToggleChat, canToggleShareTray: m.canToggleShareTray, canLeave: m.canLeave,
    canStopSharing: m.isSharing && m.canToggleShareTray };
  broadcast();
}

state.calendar = graph.publicState();
graph.start({ log: (...a) => log(...a), onChange: () => { state.calendar = graph.publicState(); broadcast(); } });

startServers();
startUia();
state.status = 'waiting';
state.paired = !!loadToken();
connectTeams();

if (!HOSTED) {
  process.on('uncaughtException', e => { log('Crashed:', (e && e.stack) || String(e)); process.exit(1); });
  process.on('unhandledRejection', e => log('Unhandled promise rejection:', (e && e.stack) || String(e)));
  process.on('exit', code => { try { log(`Helper exiting (code ${code})`); } catch { /* ignore */ } });
}
module.exports = { stop() {
  clearTimeout(retryTimer); try { if (teams) teams.close(); } catch { /* ignore */ }
  graph.stop();
  uiaStopping = true; if (uia) { try { uia.stdin.end(); uia.kill(); } catch { /* ignore */ } }
} };
