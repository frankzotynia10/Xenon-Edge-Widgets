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

const ROOT = path.resolve(__dirname, '..');
const DASH_PORT = 6800;
const LAYOUT = path.join(__dirname, 'layout.json');
const SETTINGS = path.join(__dirname, 'settings.json');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };

const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const loadLayout = () => readJson(LAYOUT, { widgets: [] });
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
  const tag = `<script>window.__edgeSettings=${settings};</script><script>${SHIM}</script>`;
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

function dashHandler(req, res) {
  const p = req.url.split('?')[0];
  if (p === '/' || p === '/index.html') return sendFile(res, path.join(__dirname, 'dashboard.html'));
  if (p === '/layout.json') return sendFile(res, LAYOUT);
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
  for (const w of layout.widgets) servers.push(await listen(w.port, widgetHandler(w)));
  return { url: `http://127.0.0.1:${DASH_PORT}/`, servers };
}

module.exports = { start, DASH_PORT };

if (require.main === module) {
  start().then(r => console.log(`Edge dashboard on ${r.url}`), e => { console.error(e.message); process.exit(1); });
}
