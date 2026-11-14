// OBS Studio for the Deck, over OBS's built-in WebSocket server (obs-websocket 5, OBS 28+).
// In OBS: Tools > WebSocket Server Settings > Enable WebSocket server. Put its password on the Deck
// settings page; it's kept in obs.json (git-ignored) and never sent back to the page.
// Live state (recording, streaming, replay buffer, virtual camera, current scene, muted inputs) comes
// from OBS's events, so the buttons update the moment anything changes, from the Deck or OBS itself.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, 'obs.json');
const readCfg = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
let cfg = readCfg();
let log = () => {}, notify = () => {};

let ws = null, identified = false, retry = null, nextId = 1, lastError = null;
const pending = new Map();
const st = { record: false, recordPaused: false, stream: false, replay: false, virtualcam: false, scene: '', scenes: [], muted: {}, inputs: [] };

const sha = s => crypto.createHash('sha256').update(s).digest('base64');

function request(requestType, requestData) {
  return new Promise((resolve, reject) => {
    if (!ws || !identified) return reject(new Error(lastError || 'OBS not connected'));
    const requestId = String(nextId++);
    const t = setTimeout(() => { pending.delete(requestId); reject(new Error('OBS did not answer')); }, 4000);
    pending.set(requestId, { resolve, reject, t });
    ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
  });
}

async function loadState() {
  const tryReq = (t, d) => request(t, d).catch(() => null);
  const [rec, str, rb, vc, scenes, inputs] = await Promise.all([tryReq('GetRecordStatus'), tryReq('GetStreamStatus'), tryReq('GetReplayBufferStatus'),
    tryReq('GetVirtualCamStatus'), tryReq('GetSceneList'), tryReq('GetInputList')]);
  if (rec) { st.record = rec.outputActive; st.recordPaused = rec.outputPaused; }
  if (str) st.stream = str.outputActive;
  if (rb) st.replay = rb.outputActive;
  if (vc) st.virtualcam = vc.outputActive;
  if (scenes) { st.scene = scenes.currentProgramSceneName; st.scenes = scenes.scenes.map(s => s.sceneName).reverse(); }
  if (inputs) {
    st.inputs = [];
    st.muted = {};
    await Promise.all(inputs.inputs.map(async i => {
      const m = await tryReq('GetInputMute', { inputName: i.inputName });   // fails for inputs without audio
      if (m) { st.muted[i.inputName] = m.inputMuted; st.inputs.push(i.inputName); }
    }));
    st.inputs.sort();
  }
  notify();
}

function onEvent(type, d) {
  switch (type) {
    case 'RecordStateChanged': st.record = d.outputActive; if (!d.outputActive) st.recordPaused = false; break;
    case 'RecordPauseStateChanged': st.recordPaused = d.outputPaused; break;   // older builds only send RecordStateChanged
    case 'StreamStateChanged': st.stream = d.outputActive; break;
    case 'ReplayBufferStateChanged': st.replay = d.outputActive; break;
    case 'VirtualcamStateChanged': st.virtualcam = d.outputActive; break;
    case 'CurrentProgramSceneChanged': st.scene = d.sceneName; break;
    case 'InputMuteStateChanged': st.muted[d.inputName] = d.inputMuted; break;
    case 'SceneListChanged': case 'InputCreated': case 'InputRemoved': case 'InputNameChanged': case 'SceneNameChanged': loadState(); return;
    default: return;
  }
  notify();
}

function connect() {
  clearTimeout(retry);
  if (ws || typeof WebSocket !== 'function') return;
  const url = `ws://${cfg.host || '127.0.0.1'}:${cfg.port || 4455}`;
  try { ws = new WebSocket(url); } catch { ws = null; retry = setTimeout(connect, 5000); return; }
  identified = false;
  ws.onmessage = m => {
    let msg; try { msg = JSON.parse(m.data); } catch { return; }
    const { op, d } = msg;
    if (op === 0) {   // Hello: answer the password challenge
      const ident = { rpcVersion: 1, eventSubscriptions: 1 | 4 | 8 | 64 };   // General, Scenes, Inputs, Outputs
      if (d.authentication) {
        if (!cfg.password) { lastError = 'OBS needs its WebSocket password'; ws.close(); return; }
        ident.authentication = sha(sha(cfg.password + d.authentication.salt) + d.authentication.challenge);
      }
      ws.send(JSON.stringify({ op: 1, d: ident }));
    } else if (op === 2) {   // Identified
      identified = true; lastError = null; log('OBS: connected');
      loadState();
    } else if (op === 5) onEvent(d.eventType, d.eventData || {});
    else if (op === 7) {
      const p = pending.get(d.requestId);
      if (!p) return;
      pending.delete(d.requestId); clearTimeout(p.t);
      d.requestStatus.result ? p.resolve(d.responseData || {}) : p.reject(new Error(d.requestStatus.comment || `OBS error ${d.requestStatus.code}`));
    }
  };
  ws.onclose = e => {
    if (identified) log('OBS: disconnected');
    if (e && e.code === 4009) lastError = 'Wrong OBS WebSocket password';
    ws = null; identified = false;
    for (const p of pending.values()) { clearTimeout(p.t); p.reject(new Error('OBS disconnected')); }
    pending.clear();
    notify();
    retry = setTimeout(connect, lastError && /password/i.test(lastError) ? 30000 : 5000);   // OBS not running: try again soon
  };
  ws.onerror = () => {};
}

// Deck action { type: 'obs', op, scene?, input? }
const OPS = {
  'record': ['ToggleRecord', 'Record start/stop'],
  'record-pause': ['ToggleRecordPause', 'Recording pause/resume'],
  'stream': ['ToggleStream', 'Stream start/stop'],
  'replay-buffer': ['ToggleReplayBuffer', 'Replay buffer on/off'],
  'save-replay': ['SaveReplayBuffer', 'Save replay'],
  'virtualcam': ['ToggleVirtualCam', 'Virtual camera on/off'],
  'scene': ['SetCurrentProgramScene', 'Switch to scene'],
  'mute': ['ToggleInputMute', 'Mute/unmute an input'],
};
async function run(a) {
  const o = OPS[a.op];
  if (!o) throw new Error(`unknown OBS action "${a.op}"`);
  if (a.op === 'scene') return request(o[0], { sceneName: a.scene });
  if (a.op === 'mute') return request(o[0], { inputName: a.input });
  return request(o[0]);
}

function state() { return { connected: identified, error: identified ? null : lastError, ...st }; }

function status() { return { connected: identified, error: lastError, hasPassword: !!cfg.password, port: cfg.port || 4455, scenes: st.scenes, inputs: st.inputs }; }

function setConfig({ password, port }) {
  if (typeof password === 'string') cfg.password = password;
  if (port) cfg.port = Number(port) || 4455;
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2) + '\n');
  lastError = null;
  if (ws) ws.close(); else connect();
}

function init(opts = {}) {
  if (opts.log) log = opts.log;
  if (opts.notify) notify = opts.notify;
  connect();
}

module.exports = { init, run, state, status, setConfig, OPS };
