// Homelab status for the Xeneon Edge, on http://127.0.0.1:6796.
//   GET /events  server-sent events for the widget: { servers: [...], pings: [...] } after every round
//   GET /state   the same, once
// Every 10 s (config "every") it reads each Unraid server and pings the servers and the ping targets.
// A server is read one of two ways (config.json, "via"):
//   ssh  runs probe.sh over SSH with your existing key (ssh user@host must work without a password)
//   api  asks Unraid's built-in API (GraphQL) with an API key made in Unraid (Settings -> Management Access -> API Keys)
// Read-only either way: nothing on the servers is changed.
'use strict';
const HOSTED = require.main !== module;

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const PORT = 6796;
const DIR = __dirname;
const LOG_PATH = path.join(DIR, 'helper.log');
const CONFIG = path.join(DIR, 'config.json');
const PROBE = fs.readFileSync(path.join(DIR, 'probe.sh'), 'utf8').replace(/^﻿/, '').replace(/\r/g, '');

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  if (!HOSTED) console.log(line);
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 300_000) fs.renameSync(LOG_PATH, LOG_PATH + '.old');
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch { /* ignore */ }
}

// { servers: [{ name, host, via: 'ssh'|'api', user?, apiKey?, url? }], pings: [{ name, host }], every }
function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}
const safeHost = h => typeof h === 'string' && /^[\w.\-:]+$/.test(h);   // never anything a shell could read as an option or command

// ---------- ping (Windows ping.exe) ----------
function ping(host) {
  return new Promise(resolve => {
    if (!safeHost(host)) return resolve(null);
    const p = spawn('ping', ['-n', '1', '-w', '1500', host], { windowsHide: true });
    let out = '';
    p.stdout.on('data', d => out += d);
    p.on('error', () => resolve(null));
    p.on('close', () => {
      const m = /(?:time|Zeit|temps)[=<]\s*(\d+)\s*ms/i.exec(out);
      resolve(m && /TTL=/i.test(out) ? Number(m[1]) : null);
    });
  });
}

// ---------- SSH ----------
function viaSsh(s) {
  return new Promise((resolve, reject) => {
    if (!safeHost(s.host)) return reject(new Error('bad host'));
    const user = /^[\w.\-]+$/.test(s.user || '') ? s.user : 'root';
    const p = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', '-o', 'ServerAliveInterval=5', `${user}@${s.host}`, 'sh -s'], { windowsHide: true });
    let out = '', err = '';
    const t = setTimeout(() => { p.kill(); reject(new Error('SSH timed out')); }, 20000);
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('error', e => { clearTimeout(t); reject(new Error('ssh not found: ' + e.message)); });
    p.on('close', () => {
      clearTimeout(t);
      if (!out.includes('@end')) return reject(new Error((err.trim().split(/\r?\n/).pop() || 'no answer').slice(0, 140)));
      resolve(parseProbe(out));
    });
    p.stdin.end(PROBE);
  });
}
function parseProbe(out) {
  const sec = {};
  let cur = null;
  for (const line of out.replace(/\r/g, '').split('\n')) {
    const m = /^@(\w+)$/.exec(line.trim());
    if (m) { cur = sec[m[1]] = []; continue; }
    if (cur && line.trim()) cur.push(line);
  }
  const r = {};
  // CPU: two /proc/stat samples a second apart -> busy share
  const st = (sec.cpu || []).map(l => l.trim().split(/\s+/).slice(1).map(Number));
  if (st.length === 2) {
    const tot = a => a.reduce((x, y) => x + y, 0), idle = a => a[3] + (a[4] || 0);
    const dt = tot(st[1]) - tot(st[0]), di = idle(st[1]) - idle(st[0]);
    if (dt > 0) r.cpu = Math.round((1 - di / dt) * 100);
  }
  const mem = Object.fromEntries((sec.mem || []).map(l => { const [k, v] = l.split(':'); return [k.trim(), parseInt(v, 10) * 1024]; }));
  if (mem.MemTotal) r.mem = { total: mem.MemTotal, used: mem.MemTotal - (mem.MemAvailable || 0) };
  if (sec.up && sec.up[0]) r.uptime = Math.round(parseFloat(sec.up[0]));
  const v = Object.fromEntries((sec.array || []).map(l => { const m = /^(\w+)="(.*)"$/.exec(l.trim()); return m ? [m[1], m[2]] : [l, '']; }));
  if (v.mdState) {
    // Problems: disks whose status isn't OK or an empty slot (DISK_NP). An unassigned parity slot reads
    // DISK_NP_DSBL, which is normal; on a data disk that means a missing disk. (The mdNum* counters
    // count that unused parity slot too, so they'd show a problem on a healthy array.)
    const bad = (sec.disks || []).filter(l => {
      const [name, status] = l.replace(/"/g, '').split(' ');
      return !/^DISK_(OK|NP)$/.test(status) && !(/^parity/.test(name) && status === 'DISK_NP_DSBL');
    }).length;
    r.array = { state: v.mdState, problems: sec.disks ? bad : Number(v.mdNumMissing || 0) };
    // mdResync > 0 while a parity check/sync runs; mdResyncPos / mdResyncSize is how far along
    if (Number(v.mdResync) > 0 && Number(v.mdResyncSize) > 0) r.array.check = { pct: Math.round(Number(v.mdResyncPos) / Number(v.mdResyncSize) * 100), action: v.mdResyncAction || 'check' };
  }
  const df = (sec.df || [])[0];
  if (df && r.array) { const [size, used] = df.trim().split(/\s+/).map(Number); if (size) { r.array.total = size; r.array.used = used; } }
  if (sec.docker) {
    const list = sec.docker.map(l => { const [name, state, status] = l.split('|'); return { name, state, status }; });
    r.docker = { total: list.length, running: list.filter(c => c.state === 'running').length,
      stopped: list.filter(c => c.state !== 'running').map(c => c.name).slice(0, 12),
      unhealthy: list.filter(c => /unhealthy/i.test(c.status || '')).map(c => c.name).slice(0, 12) };
  }
  return r;
}

// ---------- Unraid API (GraphQL) ----------
const QUERY = `query { info { os { uptime } } array { state capacity { kilobytes { total used } } parityCheckStatus { status progress } disks { status } }
  docker { containers { names state status } } metrics { cpu { percentTotal } memory { total available } } }`;
// Posts the query. Unraid often redirects http:// to its https:// address (another port, e.g. 443 or
// 8443); that's followed, but only to the same server name, so the API key never goes anywhere else.
// onMoved(url) is told the address that answered, so later rounds go straight there.
function postJson(url, body, headers, onMoved, hops = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), mod = u.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    // Unraid's own certificate is usually self-signed; this only ever talks to your server's address.
    const req = mod.request(u, { method: 'POST', timeout: 10000, rejectUnauthorized: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        let next; try { next = new URL(res.headers.location, u); } catch { return reject(new Error('API sent a bad redirect')); }
        if (next.hostname !== u.hostname || !/^https?:$/.test(next.protocol)) return reject(new Error(`API redirects to another host (${next.hostname}); set "url" in config.json`));
        if (hops >= 3) return reject(new Error('API redirects too many times'));
        if (onMoved) onMoved(next.href);
        return postJson(next.href, body, headers, onMoved, hops + 1).then(resolve, reject);
      }
      let out = ''; res.on('data', d => out += d);
      res.on('end', () => { try { const j = JSON.parse(out); res.statusCode < 400 ? resolve(j) : reject(new Error(`API ${res.statusCode}: ${(j.errors && j.errors[0] && j.errors[0].message) || ''}`)); } catch { reject(new Error(`API ${res.statusCode}`)); } });
    });
    req.on('timeout', () => req.destroy(new Error('API timed out')));
    req.on('error', reject);
    req.end(data);
  });
}
const movedTo = {};   // host -> the https address its http:// redirected to
async function viaApi(s) {
  if (!s.apiKey) throw new Error('no apiKey in config.json');
  const url = s.url || movedTo[s.host] || `http://${s.host}/graphql`;
  const j = await postJson(url, { query: QUERY }, { 'x-api-key': s.apiKey }, to => { if (!s.url) movedTo[s.host] = to; });
  if (j.errors && j.errors.length && !j.data) throw new Error(j.errors[0].message.slice(0, 140));
  const d = j.data || {}, r = {};
  const m = d.metrics || {};
  if (m.cpu && m.cpu.percentTotal != null) r.cpu = Math.round(m.cpu.percentTotal);
  if (m.memory && m.memory.total) r.mem = { total: Number(m.memory.total), used: Number(m.memory.total) - Number(m.memory.available || 0) };
  const up = d.info && d.info.os && d.info.os.uptime;
  if (up) r.uptime = typeof up === 'number' ? up : Math.round((Date.now() - Date.parse(up)) / 1000);   // a boot time
  const a = d.array;
  if (a) {
    r.array = { state: a.state, problems: (a.disks || []).filter(x => x.status && !/OK|NP|DISK_OK/i.test(x.status)).length };
    const kb = a.capacity && a.capacity.kilobytes;
    if (kb) { r.array.total = Number(kb.total) * 1024; r.array.used = Number(kb.used) * 1024; }
    const pc = a.parityCheckStatus;
    if (pc && /RUNNING/i.test(pc.status || '')) r.array.check = { pct: Math.round(Number(pc.progress) || 0), action: 'check' };
  }
  const cs = d.docker && d.docker.containers;
  if (cs) {
    const name = c => String((c.names || [])[0] || '').replace(/^\//, '');
    r.docker = { total: cs.length, running: cs.filter(c => /running/i.test(c.state)).length,
      stopped: cs.filter(c => !/running/i.test(c.state)).map(name).slice(0, 12),
      unhealthy: cs.filter(c => /unhealthy/i.test(c.status || '')).map(name).slice(0, 12) };
  }
  if (j.errors && j.errors.length) r.note = 'Some API fields are missing: ' + j.errors[0].message.slice(0, 100);
  return r;
}

// ---------- the round ----------
let state = { servers: [], pings: [], configured: false, updated: 0 };
const clients = new Set();
function broadcast() { const d = `data: ${JSON.stringify(state)}\n\n`; for (const res of clients) res.write(d); }
let timer = null, busy = false;
async function round() {
  if (busy) return; busy = true;
  try {
    const cfg = readConfig();
    if (!cfg || !Array.isArray(cfg.servers)) { state = { servers: [], pings: [], configured: false, updated: Date.now() }; broadcast(); return; }
    const prev = Object.fromEntries(state.servers.map(s => [s.name, s]));
    const servers = await Promise.all(cfg.servers.slice(0, 8).map(async s => {
      const name = String(s.name || s.host || '?').slice(0, 40), via = s.via === 'api' ? 'api' : 'ssh';
      const [ms, data] = await Promise.all([ping(s.host), (via === 'api' ? viaApi(s) : viaSsh(s)).then(d => d, e => ({ error: e.message }))]);
      const online = !data.error || ms != null;
      if (data.error && (!prev[name] || prev[name].error !== data.error)) log(`${name}: ${data.error}`);
      // A failed read keeps the last numbers (marked stale) so a blip doesn't blank the card.
      const keep = data.error && prev[name] && !prev[name].error ? { ...prev[name], stale: true } : {};
      return { ...keep, name, via, ping: ms, online, ...data, updated: data.error ? (keep.updated || 0) : Date.now() };
    }));
    const pings = await Promise.all((cfg.pings || [{ name: 'Internet', host: '1.1.1.1' }]).slice(0, 6).map(async p => ({ name: String(p.name || p.host).slice(0, 30), ms: await ping(p.host) })));
    state = { servers, pings, configured: true, updated: Date.now() };
    broadcast();
  } catch (e) { log('Round failed: ' + e.message); }
  finally { busy = false; }
}
function schedule() {
  const cfg = readConfig();
  const every = Math.max(5, Math.min(300, Number(cfg && cfg.every) || 10)) * 1000;
  clearInterval(timer); timer = setInterval(round, every);
}

// Widgets load from 127.0.0.1 pages (the dashboard) or iCUE (no web origin). Websites are refused.
const pageOrigin = o => !o || o === 'null' || !/^https?:\/\//i.test(o) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(o);
function handle(req, res) {
  const origin = req.headers.origin;
  const url = (req.url || '').split('?')[0];
  if (!pageOrigin(origin)) { res.writeHead(403); return res.end(); }
  const cors = origin ? { 'access-control-allow-origin': origin, vary: 'origin' } : {};
  if (req.method === 'GET' && url === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', ...cors });
    res.write(`retry: 3000\ndata: ${JSON.stringify(state)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.method === 'GET' && url === '/state') { res.writeHead(200, { 'content-type': 'application/json', ...cors }); return res.end(JSON.stringify(state)); }
  res.writeHead(200, { 'content-type': 'text/plain' }); res.end('homelab-edge helper ok');
}

const servers = [];
for (const host of ['127.0.0.1', '::1']) {
  const srv = http.createServer(handle);
  srv.on('error', e => {
    if (e.code === 'EADDRINUSE') { log(`Port ${PORT} on ${host} already in use`); if (!HOSTED) process.exit(0); return; }
    if (e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT') return;
    log('Server error:', e.message);
  });
  srv.listen(PORT, host);
  servers.push(srv);
}
const keepAlive = setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25_000);
// config.json changes (servers added, interval) are picked up on the next round.
const cfgWatch = setInterval(schedule, 60_000);
schedule(); round();
log(`Homelab helper on ${PORT}`);

module.exports = {
  stop() { clearInterval(timer); clearInterval(keepAlive); clearInterval(cfgWatch); for (const res of clients) res.end(); for (const s of servers) s.close(); },
  _parseProbe: parseProbe,
};
