// Builds the WoW marker Stream Deck icons: svg/ (sources), png/ (288x288) and the
// com.frank.wowmarkers.sdIconPack icon pack. Rendering uses headless Chrome or Edge.
//   node build.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { all } = require('./icons');

const SVG = path.join(__dirname, 'svg'), PNG = path.join(__dirname, 'png');
const PACK = path.join(__dirname, 'com.frank.wowmarkers.sdIconPack');
const BROWSER = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p));
if (!BROWSER) { console.error('Chrome or Edge is needed to render the PNGs.'); process.exit(1); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wowicons-'));
function render(svgFile, pngFile) {
  execFileSync(BROWSER, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--user-data-dir=${profile}`, '--window-size=288,288', `--screenshot=${pngFile}`, 'file:///' + svgFile.replace(/\\/g, '/')],
    { stdio: 'ignore', timeout: 30_000 });
}

for (const d of [SVG, PNG, path.join(PACK, 'icons')]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }
const icons = all();
for (const ic of icons) {
  const s = path.join(SVG, ic.file + '.svg'), p = path.join(PNG, ic.file + '.png');
  fs.writeFileSync(s, ic.svg);
  render(s, p);
  fs.copyFileSync(p, path.join(PACK, 'icons', ic.file + '.png'));
  process.stdout.write('.');
}
fs.rmSync(profile, { recursive: true, force: true });

fs.writeFileSync(path.join(PACK, 'manifest.json'), JSON.stringify({
  Author: 'Frank', Description: 'Raid target markers, world markers, clear buttons and emote keys for World of Warcraft.',
  Name: 'WoW Raid Markers', URL: '', Version: '1.0', Icon: 'icon.png', Tags: 'wow, raid, markers, emotes',
}, null, 2));
fs.writeFileSync(path.join(PACK, 'icons.json'), JSON.stringify(icons.map(i => ({ path: i.file + '.png', name: i.name, tags: i.tags })), null, 2));
fs.copyFileSync(path.join(PNG, 'target-8-skull.png'), path.join(PACK, 'icon.png'));

fs.writeFileSync(path.join(__dirname, 'preview.html'), `<!doctype html><meta charset="utf-8"><title>WoW Stream Deck icons</title>
<style>body{background:#000;color:#adb5bd;font:14px Segoe UI,sans-serif;margin:24px}h2{color:#fff;font-weight:600;margin:24px 0 10px}
.row{display:flex;flex-wrap:wrap;gap:14px}figure{margin:0;text-align:center;width:120px}img{width:120px;height:120px;border-radius:16px;display:block}figcaption{margin-top:6px;font-size:12px}</style>
${[['Target markers', 'target-'], ['World markers', 'world-'], ['Extras', '']].map(([h, pre]) => `<h2>${h}</h2><div class="row">` +
  icons.filter(i => pre ? new RegExp('^' + pre + '\\d').test(i.file) : !/^(target|world)-\d/.test(i.file))
    .map(i => `<figure><img src="png/${i.file}.png"><figcaption>${i.name}</figcaption></figure>`).join('') + '</div>').join('')}`);
console.log(`\n${icons.length} icons -> png/ and ${path.basename(PACK)}`);
