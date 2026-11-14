// Local web server for the Edge dashboard.
//   127.0.0.1:6800        the dashboard page and layout.json
//   127.0.0.1:<port>      one port per widget (from layout.json), so each widget has its own
//                         origin and storage, just like separate widgets in iCUE.
// index.html gets the saved settings and shim.js injected at the end of <head>.
// Run on its own for a browser preview: node server.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const sensors = require('./sensors');

const ROOT = path.resolve(__dirname, '..');
const DASH_PORT = 6800;
const LAYOUT = path.join(__dirname, 'layout.json');
const SETTINGS = path.join(__dirname, 'settings.json');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };

const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const loadLayout = () => readJson(LAYOUT, { widgets: {}, pages: [] });
// layout.json "widgets" is { id: { dir, port } }; this returns [{ id, dir, port }].
const widgetList = layout => Array.isArray(layout.widgets) ? layout.widgets : Object.entries(layout.widgets || {}).map(([id, w]) => ({ id, ...w }));
const loadSettings = () => readJson(SETTINGS, {});

function sendFile(res, file, transform) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    if (transform) data = transform(data.toString('utf8'));
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(data);
  });
}

function safeJoin(base, urlPath) {
  const p = path.normalize(path.join(base, decodeURIComponent(urlPath.split('?')[0])));
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

const SHIM = fs.readFileSync(path.join(__dirname, 'shim.js'), 'utf8');
function inject(html, widgetId) {
  const settings = JSON.stringify(loadSettings()[widgetId] || {}).replace(/</g, '\\u003c');
  const tag = `<script>window.__edgeSettings=${settings};window.__edgeApi='http://127.0.0.1:${DASH_PORT}';</script><script>${SHIM}</script>`;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, tag + '</head>') : tag + html;
}

function widgetHandler(w) {
  const base = path.resolve(ROOT, w.dir);
  return (req, res) => {
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    const file = safeJoin(base, p);
    if (!file) { res.writeHead(403); return res.end(); }
    sendFile(res, file, p === '/index.html' ? html => inject(html, w.id) : null);
  };
}

// ---------- widget properties, read from each widget's <meta name="x-icue-property"> tags ----------
const decodeEntities = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const PLUGINS_STUB = { Sensorsdataprovider: { getDefaultSensorIdBlock: (type, hint) => `auto:${type}:${hint}` } };
function evalExpr(expr) {
  if (expr == null || expr === '') return undefined;
  try { return new Function('tr', 'plugins', 'return (' + expr + ');')(s => s, PLUGINS_STUB); } catch { return expr; }
}
function readProps(w) {
  const html = fs.readFileSync(path.join(ROOT, w.dir, 'index.html'), 'utf8');
  const props = [];
  for (const tag of html.match(/<meta\s+name="x-icue-property"[^>]*>/g) || []) {
    const attrs = {};
    for (const [, k, v] of tag.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[k] = decodeEntities(v);
    if (!attrs.content) continue;
    props.push({
      key: attrs.content, type: attrs['data-type'] || 'textfield', label: evalExpr(attrs['data-label']) || attrs.content,
      default: evalExpr(attrs['data-default']), values: evalExpr(attrs['data-values']),
      min: attrs['data-min'] != null ? Number(attrs['data-min']) : undefined, max: attrs['data-max'] != null ? Number(attrs['data-max']) : undefined,
      step: attrs['data-step'] != null ? Number(attrs['data-step']) : undefined, unit: evalExpr(attrs['data-unit-label']),
    });
  }
  let groups = [];
  const g = /<script[^>]*id="x-icue-groups"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (g) { try { groups = JSON.parse(g[1]).map(x => ({ title: evalExpr(x.title) || x.title, properties: x.properties || [] })); } catch { /* ignore */ } }
  let name = w.id;
  try { name = JSON.parse(fs.readFileSync(path.join(ROOT, w.dir, 'manifest.json'), 'utf8')).name || w.id; } catch { /* ignore */ }
  return { id: w.id, name, port: w.port, props, groups };
}

// ---------- live updates (Server-Sent Events) ----------
const events = new EventEmitter();
const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

function saveSettings(all) { fs.writeFileSync(SETTINGS, JSON.stringify(all, null, 2) + '\n'); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
  });
}
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

async function dashHandler(req, res) {
  const p = req.url.split('?')[0];
  if (req.method === 'GET') {
    if (p === '/' || p === '/index.html') return sendFile(res, path.join(__dirname, 'dashboard.html'));
    if (p === '/settings') return sendFile(res, path.join(__dirname, 'settings.html'));
    if (p === '/layout.json') return sendFile(res, LAYOUT);
    if (p === '/api/widgets') return json(res, 200, widgetList(loadLayout()).map(w => { try { return readProps(w); } catch (e) { return { id: w.id, name: w.id, props: [], groups: [], error: e.message }; } }));
    if (p === '/api/settings') return json(res, 200, loadSettings());
    if (p === '/api/sensors') {
      // Read by the widgets (their own 127.0.0.1 ports), so allow those origins.
      const origin = req.headers.origin;
      const r = await sensors.read();
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store',
        ...(origin && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ? { 'access-control-allow-origin': origin } : {}) });
      return res.end(JSON.stringify({ ...r, labels: sensors.AUTO_LABELS }));
    }
    if (p === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': hi\n\n'); clients.add(res); req.on('close', () => clients.delete(res));
      return;
    }
  }
  if (req.method === 'POST' && p.startsWith('/api/')) {
    // Only our own pages may change things: they send this header, which other sites can't
    // send cross-origin without a CORS preflight we never answer.
    if (req.headers['x-edge-dashboard'] !== '1') { res.writeHead(403); return res.end(); }
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const m = /^\/api\/settings\/([\w-]+)$/.exec(p);
    if (m) {
      const id = m[1];
      if (!widgetList(loadLayout()).some(w => w.id === id)) return json(res, 404, { error: 'no such widget' });
      const all = loadSettings();
      all[id] = { ...(all[id] || {}), ...body };
      saveSettings(all);
      broadcast('settings', { id, settings: body });
      return json(res, 200, { ok: true });
    }
    if (p === '/api/import-icue') {
      try {
        const found = require('./import-icue').importSettings();
        const all = loadSettings();
        for (const [id, inst] of Object.entries(found)) { all[id] = { ...(all[id] || {}), ...inst.settings }; broadcast('settings', { id, settings: inst.settings }); }
        saveSettings(all);
        return json(res, 200, { ok: true, imported: Object.fromEntries(Object.entries(found).map(([id, i]) => [id, Object.keys(i.settings).length])) });
      } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (p === '/api/open-settings') { const opened = events.listenerCount('open-settings') > 0; events.emit('open-settings'); return json(res, 200, { opened }); }
    // Page switching, e.g. from a Stream Deck key: {"step": 1}, {"step": -1} or {"index": 0}
    if (p === '/api/page') { broadcast('page', typeof body.index === 'number' ? { index: body.index } : { step: body.step === -1 ? -1 : 1 }); return json(res, 200, { ok: true }); }
    if (p === '/api/reload') { broadcast('reload', {}); return json(res, 200, { ok: true }); }
  }
  res.writeHead(404); res.end();
}

function listen(port, handler) {
  return new Promise((resolve, reject) => {
    const s = http.createServer(handler);
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

async function start() {
  const layout = loadLayout();
  const servers = [await listen(DASH_PORT, dashHandler)];
  for (const w of widgetList(layout)) servers.push(await listen(w.port, widgetHandler(w)));
  return { url: `http://127.0.0.1:${DASH_PORT}/`, servers };
}

module.exports = { start, events, broadcast, widgetList, DASH_PORT };

if (require.main === module) {
  start().then(r => console.log(`Edge dashboard on ${r.url}`), e => { console.error(e.message); process.exit(1); });
}
