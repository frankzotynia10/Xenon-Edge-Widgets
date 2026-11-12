// Builds the App Launcher widget: bakes your current Start-menu app list into the 16 iCUE slot
// dropdowns (iCUE can't fill a dropdown at runtime), then packages launcher.icuewidget.
// Run again after installing apps you want to add:  node build.js
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const readline = require('readline');

const SRC = path.join(__dirname, 'widget-src');
const OUT = path.join(__dirname, 'widget');
const SKIP = /\b(uninstall|readme|read me|help|documentation|release notes|license|manual|website|support center|what'?s new|changelog)\b/i;

function getApps() {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'helper', 'launcher.ps1')],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
    const t = setTimeout(() => { p.kill(); reject(new Error('timed out listing apps')); }, 60_000);
    readline.createInterface({ input: p.stdout }).on('line', line => {
      let m; try { m = JSON.parse(line); } catch { return; }
      if (m.type === 'apps') { clearTimeout(t); p.stdin.end(); p.kill(); resolve(m.apps); }
    });
    p.stdin.write('{"cmd":"apps"}\n');
  });
}

// head must be ASCII for iCUE, so non-ASCII characters in app names become \uXXXX
const jsStr = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  .replace(/[^\x20-\x7e]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + "'";
const attr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

(async () => {
  let apps = (await getApps()).filter(a => a.name && !SKIP.test(a.name) && !/^https?:/i.test(a.id) && !/^https?:/i.test(a.target || ''));
  // same name twice (e.g. Store Notepad + classic Notepad): label the desktop one
  const count = {}; for (const a of apps) count[a.name.toLowerCase()] = (count[a.name.toLowerCase()] || 0) + 1;
  for (const a of apps) if (count[a.name.toLowerCase()] > 1 && /[\\.]exe$/i.test(a.id)) a.name += ' (desktop)';
  apps.sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base' }));

  const values = '[' + [`{'key':'','value':tr('(empty)')}`].concat(apps.map(a => `{'key':${jsStr(a.id)},'value':${jsStr(a.name)}}`)).join(',') + ']';
  const metas = [];
  for (let i = 1; i <= 16; i++) {
    metas.push(`<meta name="x-icue-property" content="app${i}" data-label="tr('Slot ${i}')" data-type="combobox" data-values="${attr(values)}" data-default="''" />`);
  }
  const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8').replace('<!--APP_SLOTS-->', metas.join('\n'));

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  for (const f of ['manifest.json', 'translation.json']) fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));
  fs.cpSync(path.join(SRC, 'resources'), path.join(OUT, 'resources'), { recursive: true });
  console.log(`${apps.length} apps in the slot lists (${Math.round(html.length / 1024)} KB)`);
  execSync('icuewidget package widget', { cwd: __dirname, stdio: 'inherit' });
})().catch(e => { console.error(e.message); process.exit(1); });
