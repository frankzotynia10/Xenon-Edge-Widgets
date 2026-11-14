// Hardware sensors from LibreHardwareMonitor's web server (Options > Remote Web Server > Run,
// http://127.0.0.1:8085/data.json), in place of iCUE's sensor plugin.
// Sensor ids are LHM's own SensorId (e.g. /gpu-nvidia/0/temperature/0). "auto:<type>:<hint>" ids
// stand for iCUE's default sensors and are resolved to a real sensor on this PC.
'use strict';
const http = require('http');

const LHM_URL = process.env.LHM_URL || 'http://127.0.0.1:8085/data.json';
let cache = null, cacheAt = 0, inflight = null;

function fetchJson(url, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`LibreHardwareMonitor answered ${res.statusCode}`)); }
      let body = ''; res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('LibreHardwareMonitor did not answer')));
    req.on('error', reject);
  });
}

// "45.0 °C" -> { value: 45, unit: "°C" }; "1,5 GB" -> { value: 1.5, unit: "GB" }
function parseValue(s) {
  const m = /^\s*(-?[\d.,]+)\s*(.*)$/.exec(String(s || ''));
  if (!m) return { value: NaN, unit: '' };
  return { value: parseFloat(m[1].replace(',', '.')), unit: m[2].trim() };
}

// data.json is a tree: computer > hardware (> sub-hardware) > sensor type group > sensors.
// A node whose children are all leaves is a type group ("Temperatures", "Load"); its parent is the hardware.
function flatten(root) {
  const out = [];
  const seen = new Set();
  // LHM sometimes gives two sensors the same SensorId (e.g. "GPU Memory" and "GPU Bus" are both
  // /gpu-nvidia/0/load/3). The first keeps the id; later ones get their name appended.
  const unique = (id, name) => { let u = id; if (seen.has(u)) u = `${id}~${name}`; for (let n = 2; seen.has(u); n++) u = `${id}~${name}~${n}`; seen.add(u); return u; };
  (function walk(node, parentText) {
    const kids = node.Children || [];
    if (!kids.length) return;
    if (kids.every(k => !(k.Children || []).length)) {
      const group = String(node.Text || '').replace(/s$/, '');
      for (const k of kids) {
        if (k.Value == null || k.Value === '') continue;
        const { value, unit } = parseValue(k.Value);
        out.push({ id: unique(k.SensorId || `${parentText}/${group}/${k.Text}`, k.Text), name: k.Text, hardware: parentText,
          type: String(k.Type || group).toLowerCase(), value, unit });
      }
      return;
    }
    for (const k of kids) walk(k, node.Text);
  })(root, '');
  return out;
}

const isGpu = s => /^\/gpu-/.test(s.id) || /geforce|radeon|rtx|gtx|arc/i.test(s.hardware);
const gpuRank = s => (/^\/gpu-nvidia/.test(s.id) || /nvidia|geforce|rtx|gtx/i.test(s.hardware) ? 0 : /radeon\(tm\) graphics/i.test(s.hardware) ? 3 : 1);
const isCpu = s => /^\/(amdcpu|intelcpu)/.test(s.id) || /ryzen|core\(tm\)|intel|xeon|epyc/i.test(s.hardware) && !isGpu(s);
const ofType = (list, t) => list.filter(s => s.type.startsWith(t));
const byName = (list, ...names) => { for (const n of names) { const f = list.find(s => (n instanceof RegExp ? n.test(s.name) : s.name === n)); if (f) return f; } return null; };
const bestGpu = list => list.filter(isGpu).sort((a, b) => gpuRank(a) - gpuRank(b));

// iCUE's default sensor blocks used by Sensor Box -> a real sensor here.
function resolveAuto(id, list) {
  const [, type, hint] = id.split(':');
  const gpus = bestGpu(list), cpus = list.filter(isCpu);
  const gpuHw = gpus.length ? gpus[0].hardware : null, gpu = gpus.filter(s => s.hardware === gpuHw);
  switch (`${type}:${hint}`) {
    case 'temperature:gpu-temp': return byName(ofType(gpu, 'temperature'), 'GPU Core', /core/i, /gpu/i) || ofType(gpu, 'temperature')[0] || null;
    case 'load:gpu-load': return byName(ofType(gpu, 'load'), 'GPU Core', /core/i) || null;
    case 'load:frame-buffer-load': return byName(ofType(gpu, 'load'), 'GPU Memory', /memory$/i, 'GPU Memory Controller') || null;
    case 'load:package': return byName(ofType(cpus, 'load'), 'CPU Total', /total/i) || null;
    case 'temperature:cpu-temp': return byName(ofType(cpus, 'temperature'), 'Core (Tctl/Tdie)', 'CPU Package', /tctl|tdie|package/i) || ofType(cpus, 'temperature')[0] || null;
    default: return null;
  }
}

const AUTO_LABELS = {
  'auto:temperature:gpu-temp': 'GPU temperature', 'auto:load:gpu-load': 'GPU usage', 'auto:load:frame-buffer-load': 'GPU memory',
  'auto:load:package': 'CPU usage', 'auto:temperature:cpu-temp': 'CPU temperature',
};

// Returns { ok, error?, sensors: [...], auto: { autoId: realId } }, cached for a second.
async function read() {
  if (cache && Date.now() - cacheAt < 900) return cache;
  if (inflight) return inflight;
  inflight = fetchJson(LHM_URL).then(data => {
    const sensors = flatten(data);
    const auto = {};
    for (const a of Object.keys(AUTO_LABELS)) { const s = resolveAuto(a, sensors); if (s) auto[a] = s.id; }
    return { ok: true, sensors, auto };
  }).catch(e => ({ ok: false, error: e.message, sensors: [], auto: {} }))
    .then(r => { cache = r; cacheAt = Date.now(); inflight = null; return r; });
  return inflight;
}

module.exports = { read, flatten, resolveAuto, AUTO_LABELS, LHM_URL };

if (require.main === module) {
  read().then(r => {
    if (!r.ok) { console.log('No sensors:', r.error); return; }
    for (const [a, id] of Object.entries(r.auto)) { const s = r.sensors.find(x => x.id === id); console.log(`${AUTO_LABELS[a].padEnd(16)} -> ${s.hardware} / ${s.name} = ${s.value} ${s.unit}  (${id})`); }
    console.log(`${r.sensors.length} sensors in total`);
  });
}
