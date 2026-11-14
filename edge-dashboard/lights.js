// Lights for the Deck: Elgato Key Light, Philips Hue and the Hue Sync app, all over the local network.
//   Key Light   http://<light>:9123/elgato/lights            no sign-in, found by mDNS (_elg._tcp)
//   Hue         https://<bridge>/clip/v2/...                  app key from pairing once (link button), found by mDNS (_hue._tcp)
//   Hue Sync    ws://127.0.0.1:24851/                          the Hue Sync PC app, with "Third-party control" on
// lights.json (git-ignored) keeps the found addresses and the Hue app key.
//   node lights.js            find the lights and print their state
//   node lights.js pair       pair with the Hue bridge (press its link button first, or within 60 s)
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const os = require('os');
const { browse } = require('./mdns');
const jiggler = require('./jiggler');   // not lights, but live-state buttons too
const obs = require('./obs');

const FILE = path.join(__dirname, 'lights.json');
const HUESYNC_URL = 'ws://127.0.0.1:24851/';
let log = () => {};

const readCfg = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { keylights: [], hue: null }; } };
const writeCfg = c => fs.writeFileSync(FILE, JSON.stringify(c, null, 2) + '\n');
let cfg = readCfg();

// ---------- discovery ----------
let discovering = null;
function discover() {
  if (discovering) return discovering;
  discovering = browse(['_elg._tcp.local', '_hue._tcp.local'], 2500).then(found => {
    for (const f of found) {
      if (!f.ip) continue;
      if (f.service.startsWith('_elg')) {
        const id = (f.txt.id || f.name).toUpperCase();
        const k = cfg.keylights.find(x => x.id === id);
        if (k) Object.assign(k, { ip: f.ip, port: f.port || 9123 });
        else cfg.keylights.push({ id, name: f.name, ip: f.ip, port: f.port || 9123 });
      } else if (f.service.startsWith('_hue')) {
        const bridgeId = String(f.txt.bridgeid || '').toLowerCase();
        if (!cfg.hue) cfg.hue = { bridgeId, ip: f.ip };
        else if (!cfg.hue.bridgeId || cfg.hue.bridgeId === bridgeId) Object.assign(cfg.hue, { bridgeId, ip: f.ip });
      }
    }
    writeCfg(cfg);
    return cfg;
  }).finally(() => { discovering = null; });
  return discovering;
}

// ---------- HTTP helpers ----------
function request(mod, opts, body) {
  return new Promise((resolve, reject) => {
    const req = mod.request({ timeout: 2500, ...opts }, res => {
      let b = ''; res.on('data', d => { b += d; });
      res.on('end', () => { let j = null; try { j = b ? JSON.parse(b) : null; } catch { /* not json */ } res.statusCode < 400 ? resolve(j) : reject(new Error(`${res.statusCode} ${b.slice(0, 200)}`)); });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    if (opts.checkCert) req.on('socket', s => s.on('secureConnect', () => {
      // The bridge's certificate is self-signed with its bridge ID as the name; make sure it's ours.
      const cn = String((s.getPeerCertificate().subject || {}).CN || '').toLowerCase();
      if (cn !== opts.checkCert) req.destroy(new Error(`unexpected Hue bridge certificate "${cn}"`));
    }));
    if (body !== undefined) req.end(JSON.stringify(body)); else req.end();
  });
}

// ---------- Key Light ----------
const keylight = id => cfg.keylights.find(k => id === 'all' || k.id === String(id).toUpperCase()) || cfg.keylights[0];
async function klCall(k, method, body) {
  const opts = { host: k.ip, port: k.port || 9123, path: '/elgato/lights', method, headers: { 'content-type': 'application/json' } };
  try { return await request(http, opts, body); }
  catch (e) { await discover(); const k2 = keylight(k.id); return request(http, { ...opts, host: k2.ip }, body); }   // its address may have changed
}
async function keyLightAction(a) {
  const k = keylight(a.light || 'all');
  if (!k) throw new Error('no Key Light found');
  const cur = ((await klCall(k, 'GET')) || {}).lights[0];
  const next = {};
  switch (a.op || 'toggle') {
    case 'toggle': next.on = cur.on ? 0 : 1; break;
    case 'on': next.on = 1; break;
    case 'off': next.on = 0; break;
    case 'brightness': next.brightness = Math.max(3, Math.min(100, cur.brightness + Number(a.step || 10))); if (!cur.on) next.on = 1; break;
    // temperature is in mireds (143 = 7000 K, 344 = 2900 K): warmer is a higher number.
    case 'warmer': next.temperature = Math.min(344, cur.temperature + Math.abs(Number(a.step || 20))); break;
    case 'cooler': next.temperature = Math.max(143, cur.temperature - Math.abs(Number(a.step || 20))); break;
    default: throw new Error(`unknown Key Light op "${a.op}"`);
  }
  await klCall(k, 'PUT', { numberOfLights: 1, lights: [{ ...cur, ...next }] });
}

// ---------- Hue (API v2) ----------
async function hue(method, resource, body) {
  if (!cfg.hue || !cfg.hue.ip) await discover();
  if (!cfg.hue || !cfg.hue.appKey) throw new Error('Hue bridge not paired. Run: node lights.js pair');
  const opts = { host: cfg.hue.ip, path: '/clip/v2/resource/' + resource, method, rejectUnauthorized: false, checkCert: cfg.hue.bridgeId,
    headers: { 'hue-application-key': cfg.hue.appKey, 'content-type': 'application/json' } };
  try { return await request(https, opts, body); }
  catch (e) { if (!/^\d{3} /.test(e.message)) { await discover(); return request(https, { ...opts, host: cfg.hue.ip }, body); } throw e; }
}
const groupedLightOf = {};   // room id -> grouped_light id
async function roomLight(room) {
  if (groupedLightOf[room]) return groupedLightOf[room];
  for (const kind of ['room', 'zone']) {
    try {
      const r = await hue('GET', `${kind}/${room}`);
      const s = (r.data[0].services || []).find(x => x.rtype === 'grouped_light');
      if (s) return (groupedLightOf[room] = s.rid);
    } catch { /* try a zone */ }
  }
  throw new Error('Hue room not found');
}
async function hueAction(a) {
  if (a.type === 'hue-scene') return hue('PUT', `scene/${a.scene}`, { recall: { action: 'active' } });
  const gl = await roomLight(a.room);
  let on = a.op === 'on' ? true : a.op === 'off' ? false : null;
  if (on === null) on = !(await hue('GET', `grouped_light/${gl}`)).data[0].on.on;
  return hue('PUT', `grouped_light/${gl}`, { on: { on } });
}

async function pairHue({ wait = 60000 } = {}) {
  await discover();
  if (!cfg.hue || !cfg.hue.ip) throw new Error('no Hue bridge found on the network');
  const end = Date.now() + wait;
  const body = { devicetype: `edge_dashboard#${os.hostname().slice(0, 19)}`, generateclientkey: true };
  while (Date.now() < end) {
    const r = await request(https, { host: cfg.hue.ip, path: '/api', method: 'POST', rejectUnauthorized: false, checkCert: cfg.hue.bridgeId, headers: { 'content-type': 'application/json' } }, body);
    const ok = r && r[0] && r[0].success;
    if (ok) { cfg.hue.appKey = ok.username; writeCfg(cfg); return true; }
    if (!(r && r[0] && r[0].error && r[0].error.type === 101)) throw new Error('pairing failed: ' + JSON.stringify(r && r[0] && r[0].error));
    await new Promise(res => setTimeout(res, 2000));   // 101 = link button not pressed yet
  }
  return false;
}

// ---------- Hue Sync app ----------
let syncWs = null, syncState = null, syncTimer = null;
function connectSync() {
  if (syncWs || typeof WebSocket !== 'function') return;
  try { syncWs = new WebSocket(HUESYNC_URL); } catch { syncWs = null; return; }
  syncWs.onmessage = m => {
    try {
      const j = JSON.parse(m.data);
      if (j.event === 'app_state_update' && j.data && j.data.state && j.data.state !== syncState) { syncState = j.data.state; changed(); }
    } catch { /* ignore */ }
  };
  syncWs.onclose = () => {
    syncWs = null;
    if (syncState !== null) { syncState = null; changed(); }
    clearTimeout(syncTimer); syncTimer = setTimeout(connectSync, 10000);
  };
  syncWs.onerror = () => {};
}
async function hueSyncAction(a) {
  connectSync();
  if (!syncWs || syncWs.readyState !== 1) throw new Error('Hue Sync app not reachable (is it running, with Third-party control on?)');
  const stop = a.op === 'stop' || ((a.op || 'toggle') === 'toggle' && syncState === 'syncing');
  syncWs.send(JSON.stringify(stop ? { command: 'stop_sync', data: {} } : { command: 'start_sync', data: { mode: a.mode || 'games', intensity: a.intensity || 'moderate' } }));
}

// ---------- live state for the buttons ----------
// { "keylight:<id>": { on, brightness, kelvin }, "hue-room:<id>": { on }, "hue-scene:<id>": { on }, "huesync": { on, state } }
let state = {}, lastJson = '', watchers = new Set(), pollTimer = null;
function changed() { const j = JSON.stringify(stateNow()); if (j !== lastJson) { lastJson = j; for (const fn of watchers) fn(stateNow()); } }
const stateNow = () => ({ ...state, ...(syncState ? { huesync: { on: syncState === 'syncing', state: syncState } } : {}), obs: obs.state() });

async function poll() {
  const s = {};
  await Promise.all([
    ...cfg.keylights.map(async k => {
      try {
        const l = (await request(http, { host: k.ip, port: k.port || 9123, path: '/elgato/lights' })).lights[0];
        s['keylight:' + k.id] = { on: !!l.on, brightness: l.brightness, kelvin: Math.round(1e6 / l.temperature / 50) * 50 };
      } catch { /* offline */ }
    }),
    (async () => {
      if (!cfg.hue || !cfg.hue.appKey) return;
      try {
        const [rooms, scenes] = await Promise.all([hue('GET', 'room'), hue('GET', 'scene')]);
        const zones = await hue('GET', 'zone').catch(() => ({ data: [] }));
        const gls = await hue('GET', 'grouped_light');
        const glOn = Object.fromEntries(gls.data.map(g => [g.id, g.on && g.on.on]));
        for (const r of [...rooms.data, ...zones.data]) {
          const gl = (r.services || []).find(x => x.rtype === 'grouped_light');
          if (gl) { groupedLightOf[r.id] = gl.rid; s['hue-room:' + r.id] = { on: !!glOn[gl.rid], name: r.metadata && r.metadata.name }; }
        }
        for (const sc of scenes.data) s['hue-scene:' + sc.id] = { on: !!(sc.status && sc.status.active && sc.status.active !== 'inactive'), name: sc.metadata && sc.metadata.name };
      } catch (e) { log('Hue: ' + e.message); }
    })(),
  ]);
  try { s.jiggler = jiggler.state(); } catch { /* ignore */ }
  state = s; changed();
}
function watch(fn) {
  watchers.add(fn);
  if (!pollTimer) { poll(); pollTimer = setInterval(poll, 4000); connectSync(); }
}

// Runs a Deck light action, then refreshes the state so the button updates right away.
async function run(a) {
  if (a.type === 'keylight') await keyLightAction(a);
  else if (a.type === 'hue-scene' || a.type === 'hue-room') await hueAction(a);
  else if (a.type === 'huesync') await hueSyncAction(a);
  else if (a.type === 'jiggler') jiggler.toggle();
  else if (a.type === 'obs') return obs.run(a);   // OBS's own events update the state
  else throw new Error(`not a light action: ${a.type}`);
  setTimeout(poll, 250);
}
const isLight = t => ['keylight', 'hue-scene', 'hue-room', 'huesync', 'jiggler', 'obs'].includes(t);

// For the editor: the lights, rooms and scenes to choose from.
async function catalog() {
  connectSync();
  const live = stateNow();
  const out = {
    keylights: cfg.keylights.map(k => ({ id: k.id, name: k.name, ip: k.ip, reachable: !!live['keylight:' + k.id] })),
    hue: { paired: !!(cfg.hue && cfg.hue.appKey), found: !!(cfg.hue && cfg.hue.ip), ip: cfg.hue && cfg.hue.ip, bridgeId: cfg.hue && cfg.hue.bridgeId },
    huesync: { connected: !!(syncWs && syncWs.readyState === 1), state: syncState },
    rooms: [], scenes: [] };
  if (out.hue.paired) {
    try {
      const [rooms, zones, scenes] = await Promise.all([hue('GET', 'room'), hue('GET', 'zone').catch(() => ({ data: [] })), hue('GET', 'scene')]);
      out.rooms = [...rooms.data, ...zones.data].map(r => ({ id: r.id, name: r.metadata.name }));
      const roomName = Object.fromEntries(out.rooms.map(r => [r.id, r.name]));
      out.scenes = scenes.data.map(s => ({ id: s.id, name: s.metadata.name, room: s.group && s.group.rid, roomName: roomName[s.group && s.group.rid] || '' }))
        .sort((a, b) => (a.roomName + a.name).localeCompare(b.roomName + b.name));
    } catch (e) { out.error = e.message; }
  }
  return out;
}

function init(opts = {}) {
  if (opts.log) log = opts.log;
  if (!cfg.keylights.length || !cfg.hue) discover().catch(e => log('Light discovery: ' + e.message));
  obs.init({ log, notify: changed });
}

module.exports = { init, run, isLight, watch, stateNow, catalog, pairHue, discover, obs };

if (require.main === module) {
  (async () => {
    if (process.argv[2] === 'pair') {
      console.log('Press the round link button on the Hue bridge now (waiting up to 60 s)...');
      console.log((await pairHue()) ? 'Paired. The app key is saved in lights.json.' : 'Timed out: the link button was not pressed.');
      return;
    }
    await discover();
    console.log('Key Lights:', cfg.keylights.map(k => `${k.name} (${k.id}) at ${k.ip}`).join(', ') || 'none');
    console.log('Hue bridge:', cfg.hue ? `${cfg.hue.bridgeId} at ${cfg.hue.ip}, ${cfg.hue.appKey ? 'paired' : 'not paired'}` : 'none');
    connectSync(); await poll(); await new Promise(r => setTimeout(r, 1500));
    for (const [k, v] of Object.entries(stateNow())) if (!k.startsWith('hue-scene') || v.on) console.log(' ', k, JSON.stringify(v));
    process.exit(0);
  })().catch(e => { console.error(e.message); process.exit(1); });
}
