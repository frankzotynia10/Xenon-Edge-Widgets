// Wireless mouse and keyboard batteries for the Deck's battery buttons.
// The reading happens in deck-keys.ps1 (battery.cs, on its own thread, once a minute); deck.js passes its
// "bats" lines here.
'use strict';

let devices = {};   // id -> { level: 0-100 | null (asleep), charging, name }
let ask = () => {};
const listeners = new Set();

function ingest(line) {
  const next = {};
  for (const item of line.slice(5).split(';').filter(Boolean)) {
    const [id, lvl, charging, ...name] = item.split('|');
    next[id] = { level: lvl === '-' ? null : Number(lvl), charging: charging === '1', name: name.join('|') };
  }
  if (JSON.stringify(next) !== JSON.stringify(devices)) { devices = next; for (const fn of listeners) fn(state()); }
}
// Read everything again now (a tap on a battery button).
const refresh = () => ask();
const setAsk = fn => { ask = fn; };
// Keyed like the light states, for the Deck page: { 'battery:<id>': { level, charging, name } }
const state = () => Object.fromEntries(Object.entries(devices).map(([k, v]) => ['battery:' + k, v]));
const list = () => Object.entries(devices).map(([id, v]) => ({ id, ...v }));
const onChange = fn => listeners.add(fn);

module.exports = { ingest, refresh, setAsk, state, list, onChange };
