// NVIDIA ShadowPlay (NVIDIA App overlay) buttons for the Deck. NVIDIA has no API for it, so a button
// sends the overlay's own hotkey. The hotkeys are read from where the NVIDIA App keeps them
// (HKCU\Software\NVIDIA Corporation\Global\ShadowPlay\NVSPCAPS, as virtual-key codes), so changing one in
// the NVIDIA App changes the button too. The defaults are only used when nothing is saved there.
'use strict';
const { execFile } = require('child_process');

const KEY = 'HKCU\\Software\\NVIDIA Corporation\\Global\\ShadowPlay\\NVSPCAPS';
// op -> [registry name, default keys, label]
const OPS = {
  'save-replay':   ['DVRHKey',               [0x12, 0x79],       'Save replay'],
  'replay-toggle': ['IRToggleHKey',          [0x12, 0x10, 0x79], 'Instant replay on/off'],
  'record':        ['ManualHKey',            [0x12, 0x78],       'Record start/stop'],
  'screenshot':    ['ScreenshotHKey',        [0x12, 0x70],       'Screenshot'],
  'overlay':       ['GFEOverlayHKeyV2',      [0x12, 0x5A],       'Open the overlay'],
  'mic':           ['MicToggleHKey',         [0x11, 0x12, 0x4D], 'Microphone on/off'],
  'photo-mode':    ['AnselUIHKey',           [0x12, 0x71],       'Photo mode'],
  'game-filter':   ['FSUIHKeyV1',            [0x12, 0x72],       'Game filter'],
  'perf-overlay':  ['PMOCOverlayVisibilityHKey', [0x12, 0x11, 0x52], 'Performance overlay'],
};

// Reads e.g. DVRHKeyCount = 2, DVRHKey0 = 0x12, DVRHKey1 = 0x79 -> [0x12, 0x79]
function keysFor(op) {
  const o = OPS[op];
  if (!o) return Promise.reject(new Error(`unknown ShadowPlay action "${op}"`));
  return new Promise(resolve => {
    execFile('reg.exe', ['query', KEY], { windowsHide: true }, (err, out) => {
      if (err) return resolve(o[1]);
      const vals = {};
      for (const m of String(out).matchAll(/^\s+(\S+)\s+REG_BINARY\s+([0-9A-F]+)\s*$/gim)) vals[m[1]] = parseInt(m[2].slice(0, 2), 16) | (parseInt(m[2].slice(2, 4) || '0', 16) << 8);
      const n = vals[o[0] + 'Count'];
      if (!n) return resolve(o[1]);
      const keys = [];
      for (let i = 0; i < n; i++) if (vals[o[0] + i]) keys.push(vals[o[0] + i]);
      resolve(keys.length ? keys : o[1]);
    });
  });
}

const MODS = [0x10, 0x11, 0x12, 0x5B];
// Modifiers first, the main key last, as SendInput needs them.
const order = keys => [...keys.filter(k => MODS.includes(k)), ...keys.filter(k => !MODS.includes(k))];

module.exports = { OPS, keysFor: op => keysFor(op).then(order) };

if (require.main === module) {
  const { keysName } = require('./deck');
  (async () => { for (const op of Object.keys(OPS)) console.log(op.padEnd(14), keysName(await module.exports.keysFor(op))); process.exit(0); })();
}
