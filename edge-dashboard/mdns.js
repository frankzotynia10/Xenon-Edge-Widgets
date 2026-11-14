// Tiny mDNS (Bonjour) browser for finding lights on the local network, e.g.
//   _elg._tcp.local   Elgato Key Light
//   _hue._tcp.local   Philips Hue bridge
// browse(['_elg._tcp.local'], 2500) -> [{ service, name, host, ip, port, txt }]
'use strict';
const dgram = require('dgram');
const os = require('os');

function encodeName(name) {
  const parts = name.replace(/\.$/, '').split('.');
  return Buffer.concat([...parts.map(p => Buffer.concat([Buffer.from([Buffer.byteLength(p)]), Buffer.from(p)])), Buffer.from([0])]);
}
function query(services) {
  const head = Buffer.alloc(12); head.writeUInt16BE(services.length, 4);
  return Buffer.concat([head, ...services.map(s => Buffer.concat([encodeName(s), Buffer.from([0, 12, 0, 1])]))]);   // PTR, IN
}
function readName(buf, off) {
  const labels = []; let jumped = false, end = off, guard = 0;
  while (guard++ < 128) {
    const len = buf[off];
    if (len === 0) { off++; break; }
    if ((len & 0xc0) === 0xc0) { if (!jumped) end = off + 2; off = ((len & 0x3f) << 8) | buf[off + 1]; jumped = true; continue; }
    labels.push(buf.toString('utf8', off + 1, off + 1 + len)); off += 1 + len;
  }
  return { name: labels.join('.'), next: jumped ? end : off };
}
function parse(buf) {
  const qd = buf.readUInt16BE(4), n = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let off = 12;
  for (let i = 0; i < qd; i++) off = readName(buf, off).next + 4;
  const recs = [];
  for (let i = 0; i < n && off < buf.length; i++) {
    const { name, next } = readName(buf, off); off = next;
    const type = buf.readUInt16BE(off), len = buf.readUInt16BE(off + 8); const data = off + 10; off = data + len;
    const r = { name, type };
    if (type === 12) r.ptr = readName(buf, data).name;
    else if (type === 33) { r.port = buf.readUInt16BE(data + 4); r.target = readName(buf, data + 6).name; }
    else if (type === 1) r.ip = [...buf.subarray(data, data + 4)].join('.');
    else if (type === 16) { r.txt = {}; let o = data; while (o < data + len) { const l = buf[o]; const s = buf.toString('utf8', o + 1, o + 1 + l); const eq = s.indexOf('='); if (eq > 0) r.txt[s.slice(0, eq)] = s.slice(eq + 1); o += 1 + l; } }
    recs.push(r);
  }
  return recs;
}

function browse(services, ms = 2500) {
  return new Promise(resolve => {
    const recs = [];
    const sockets = [];
    // One socket per IPv4 interface, so the query goes out on the LAN and not just the first adapter.
    const addrs = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
    for (const addr of addrs.length ? addrs : ['0.0.0.0']) {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      s.on('error', () => {});
      s.on('message', m => { try { recs.push(...parse(m)); } catch { /* bad packet */ } });
      s.bind(0, addr, () => { try { s.setMulticastInterface(addr); s.send(query(services), 5353, '224.0.0.251'); } catch { /* skip */ } });
      sockets.push(s);
    }
    setTimeout(() => {
      for (const s of sockets) try { s.close(); } catch { /* closed */ }
      const out = [];
      for (const svc of services) {
        for (const p of recs.filter(r => r.type === 12 && r.name.toLowerCase() === svc.toLowerCase())) {
          if (out.some(o => o.name === p.ptr)) continue;
          const srv = recs.find(r => r.type === 33 && r.name === p.ptr) || {};
          const a = recs.find(r => r.type === 1 && r.name === srv.target) || {};
          const txt = (recs.find(r => r.type === 16 && r.name === p.ptr) || {}).txt || {};
          out.push({ service: svc, name: p.ptr.replace('.' + svc, ''), host: srv.target, ip: a.ip, port: srv.port, txt });
        }
      }
      resolve(out);
    }, ms);
  });
}

module.exports = { browse };

if (require.main === module) {
  browse(process.argv.slice(2).length ? process.argv.slice(2) : ['_elg._tcp.local', '_hue._tcp.local', '_huesync._tcp.local'], 3000)
    .then(r => console.log(JSON.stringify(r, null, 2)));
}
