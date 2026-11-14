// Mute lights: a Hue light turns red while you're muted in a Teams meeting, another while you're muted
// (or deafened) in a Discord voice channel. When you unmute or leave, the light goes back to how it was.
//
// Mute state comes from the Edge helper's Teams (ws 6793) and Discord (ws 6789) feeds.
// Settings live in mute-lights.json (git-ignored): { teams: { light, on }, discord: { light, on } }.
// While a light is red, its old state is kept in mute-lights.saved.json, so a crash or restart
// still puts it back.
'use strict';
const fs = require('fs');
const path = require('path');
const lights = require('./lights');

const DIR = process.env.MUTE_LIGHTS_DIR || __dirname;   // tests point these elsewhere
const CFG = path.join(DIR, 'mute-lights.json');
const SAVED = path.join(DIR, 'mute-lights.saved.json');
const SOURCES = {
  teams:   { url: process.env.MUTE_LIGHTS_TEAMS || 'ws://127.0.0.1:6793', muted: s => !!(s.meeting && s.meeting.isInMeeting && s.meeting.isMuted) },
  discord: { url: process.env.MUTE_LIGHTS_DISCORD || 'ws://127.0.0.1:6789', muted: s => s.status === 'ready' && !!s.channel && !!(s.self && (s.self.mute || s.self.deaf)) },
};
const RED = { xy: { x: 0.675, y: 0.322 } };
const BRIGHTNESS = 80;

let log = () => {};
let cfg = read(CFG, { teams: { light: '', on: false }, discord: { light: '', on: false } });
let saved = read(SAVED, {});                 // light id -> its state before it went red
const muted = { teams: false, discord: false };
const live = { teams: false, discord: false };  // is the helper's feed connected
let timer = null, busy = Promise.resolve();

function read(f, def) { try { return { ...def, ...JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch { return def; } }
function write(f, o) { fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); }

// Which lights should be red right now (a light can serve both Teams and Discord).
function wanted() {
  const out = new Set();
  for (const k of Object.keys(SOURCES)) if (cfg[k] && cfg[k].on && cfg[k].light && muted[k]) out.add(cfg[k].light);
  return out;
}

// Brings each light in line with what's wanted: red it (saving how it was) or put it back.
function sync() {
  busy = busy.then(async () => {
    const want = wanted();
    for (const id of want) {
      if (saved[id]) continue;
      try {
        const l = (await lights.hue('GET', `light/${id}`)).data[0];
        saved[id] = {
          on: !!(l.on && l.on.on),
          brightness: l.dimming && l.dimming.brightness,
          mirek: l.color_temperature && l.color_temperature.mirek_valid ? l.color_temperature.mirek : null,
          xy: l.color && l.color.xy,
        };
        write(SAVED, saved);
        await lights.hue('PUT', `light/${id}`, { on: { on: true }, dimming: { brightness: BRIGHTNESS }, color: RED });
        log(`Mute light: ${id.slice(0, 8)} red`);
      } catch (e) { log('Mute light: ' + e.message); delete saved[id]; }
    }
    for (const id of Object.keys(saved)) {
      if (want.has(id)) continue;
      const s = saved[id];
      try {
        const body = s.on
          ? { on: { on: true }, ...(s.brightness != null ? { dimming: { brightness: s.brightness } } : {}),
              ...(s.mirek ? { color_temperature: { mirek: s.mirek } } : s.xy ? { color: { xy: s.xy } } : {}) }
          : { on: { on: false } };
        // Colour first while on, then off, so the light isn't still red the next time it's switched on.
        if (!s.on) await lights.hue('PUT', `light/${id}`, { ...(s.brightness != null ? { dimming: { brightness: s.brightness } } : {}),
          ...(s.mirek ? { color_temperature: { mirek: s.mirek } } : s.xy ? { color: { xy: s.xy } } : {}) });
        await lights.hue('PUT', `light/${id}`, body);
        delete saved[id]; write(SAVED, saved);
        log(`Mute light: ${id.slice(0, 8)} restored`);
      } catch (e) { log('Mute light restore: ' + e.message); }
    }
  }).catch(() => {});
  return busy;
}
// Short wait so a quick mute-unmute doesn't flash the light.
function schedule() { clearTimeout(timer); timer = setTimeout(sync, 400); }

function connect(name) {
  const src = SOURCES[name];
  let ws;
  try { ws = new WebSocket(src.url); } catch { return setTimeout(() => connect(name), 5000); }
  ws.onopen = () => { live[name] = true; };
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type !== 'state' || !m.state) return;
    const now = src.muted(m.state);
    if (now !== muted[name]) { muted[name] = now; schedule(); }
  };
  ws.onclose = () => {
    live[name] = false;
    // Helper gone (restarting): treat it as unmuted so the light doesn't stay red.
    if (muted[name]) { muted[name] = false; schedule(); }
    setTimeout(() => connect(name), 5000);
  };
  ws.onerror = () => {};
}

function init(opts = {}) {
  if (opts.log) log = opts.log;
  connect('teams'); connect('discord');
  schedule();   // puts back anything left red by a crash
}
const status = () => ({ ...cfg, muted: { ...muted }, live: { ...live }, red: Object.keys(saved) });
function setConfig(c) {
  for (const k of Object.keys(SOURCES)) {
    if (!c || !c[k]) continue;
    cfg[k] = { light: typeof c[k].light === 'string' ? c[k].light.slice(0, 64) : '', on: !!c[k].on };
  }
  write(CFG, cfg);
  schedule();
  return status();
}
// For a test from the settings page: the light goes red for a few seconds, then back.
async function test(name) {
  const c = cfg[name];
  if (!c || !c.light) throw new Error('Pick a light first');
  const was = muted[name], on = c.on;
  c.on = true; muted[name] = true; await sync();
  await new Promise(r => setTimeout(r, 3000));
  muted[name] = was; c.on = on; await sync();
}
// On quit: put the lights back.
const stop = () => { for (const k of Object.keys(muted)) muted[k] = false; return sync(); };

module.exports = { init, status, setConfig, test, stop };
