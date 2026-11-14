// Imports our widgets' settings from iCUE into settings.json.
//   node import-icue.js            write settings.json (merged over what's there)
//   node import-icue.js --dry-run  print what would be imported
// iCUE keeps the Edge dashboard in %APPDATA%\Corsair\CUE5\dashlcd\storage: XML (cereal) where each
// widget's settings are <key>/<value> pairs, and each value is a Qt QVariant in base64.
'use strict';
const fs = require('fs');
const path = require('path');

const STORAGE = path.join(process.env.APPDATA || '', 'Corsair', 'CUE5', 'dashlcd', 'storage');
const SETTINGS = path.join(__dirname, 'settings.json');
const LAYOUT = path.join(__dirname, 'layout.json');
const ROOT = path.resolve(__dirname, '..');

// ---------- QVariant (Qt 6 QDataStream, big endian) ----------
const hex2 = n => n.toString(16).padStart(2, '0');
function rgbHex(r, g, b, a) {
  const h = '#' + hex2(r) + hex2(g) + hex2(b);
  return a < 255 ? h + hex2(a) : h;
}
function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map(t => Math.round((t + m) * 255));
}
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map(t => Math.round((t + m) * 255));
}
function readColor(buf, o) {
  const spec = buf.readInt8(o), a = buf.readUInt16BE(o + 1), c1 = buf.readUInt16BE(o + 3), c2 = buf.readUInt16BE(o + 5), c3 = buf.readUInt16BE(o + 7);
  const alpha = Math.round(a / 257);
  if (spec === 1 || spec === 5) return rgbHex(Math.round(c1 / 257), Math.round(c2 / 257), Math.round(c3 / 257), alpha);
  const h = c1 === 0xffff ? 0 : c1 / 100;
  if (spec === 2) return rgbHex(...hsvToRgb(h, c2 / 65535, c3 / 65535), alpha);
  if (spec === 4) return rgbHex(...hslToRgb(h, c2 / 65535, c3 / 65535), alpha);
  return undefined; // invalid or CMYK: leave the widget's default
}
function decodeVariant(b64) {
  const buf = Buffer.from(b64, 'base64');
  const type = buf.readUInt32BE(0), o = 5; // byte 4 is the "is null" flag
  switch (type) {
    case 1: return buf.readUInt8(o) !== 0;                       // bool
    case 2: return buf.readInt32BE(o);                           // int
    case 3: return buf.readUInt32BE(o);                          // uint
    case 4: return Number(buf.readBigInt64BE(o));                // long long
    case 6: return buf.readDoubleBE(o);                          // double
    case 38: return buf.readFloatBE(o);                          // float
    case 10: {                                                   // QString, UTF-16BE
      const len = buf.readUInt32BE(o);
      if (len === 0xffffffff) return '';
      const s = buf.subarray(o + 4, o + 4 + len);
      return Buffer.from(s).swap16().toString('utf16le');
    }
    case 0x1003: case 67: return readColor(buf, o);              // QColor (Qt 6 / Qt 5)
    default: return undefined;
  }
}

// ---------- read the dashboard XML ----------
function readIcue() {
  const xml = fs.readFileSync(STORAGE, 'utf8');
  const out = []; // { typeId, settings }
  const re = /<typeId>([^<]+)<\/typeId>[\s\S]*?<data size="dynamic">([\s\S]*?)<\/data>/g;
  let m;
  while ((m = re.exec(xml))) {
    const settings = {}, skipped = [];
    const kv = /<key>([^<]*)<\/key>\s*<value>([^<]*)<\/value>/g;
    let k;
    while ((k = kv.exec(m[2]))) {
      if (/^widgetPersonalization/.test(k[1])) continue; // iCUE's own styling switches
      const v = decodeVariant(k[2]);
      if (v === undefined) skipped.push(k[1]); else settings[k[1]] = v;
    }
    out.push({ typeId: m[1], settings, skipped });
  }
  return out;
}

// manifest id (com.frank.discordvoice) -> our layout id (discord)
function idMap() {
  const layout = JSON.parse(fs.readFileSync(LAYOUT, 'utf8'));
  const map = {};
  const list = Array.isArray(layout.widgets) ? layout.widgets : Object.entries(layout.widgets || {}).map(([id, w]) => ({ id, ...w }));
  for (const w of list) {
    try { map[JSON.parse(fs.readFileSync(path.join(ROOT, w.dir, 'manifest.json'), 'utf8')).id] = w.id; } catch { /* no manifest */ }
  }
  return map;
}

function importSettings() {
  const map = idMap();
  const found = {};
  for (const inst of readIcue()) {
    const id = map[inst.typeId];
    if (!id) continue;
    // A widget can be on several iCUE pages; keep the instance with the most settings.
    if (!found[id] || Object.keys(inst.settings).length > Object.keys(found[id].settings).length) found[id] = inst;
  }
  return found;
}

module.exports = { importSettings, decodeVariant, STORAGE };

if (require.main === module) {
  const dry = process.argv.includes('--dry-run');
  if (!fs.existsSync(STORAGE)) { console.error(`iCUE dashboard storage not found: ${STORAGE}`); process.exit(1); }
  const found = importSettings();
  let current = {};
  try { current = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { /* none yet */ }
  for (const [id, inst] of Object.entries(found)) {
    console.log(`${id}: ${Object.keys(inst.settings).length} settings` + (inst.skipped.length ? ` (skipped: ${inst.skipped.join(', ')})` : ''));
    if (dry) console.log('  ' + JSON.stringify(inst.settings));
    current[id] = { ...(current[id] || {}), ...inst.settings };
  }
  if (!Object.keys(found).length) console.log('None of the dashboard widgets are in iCUE.');
  if (!dry) { fs.writeFileSync(SETTINGS, JSON.stringify(current, null, 2) + '\n'); console.log(`Wrote ${SETTINGS}`); }
}
