// Which built-in image (deck-edge/icons) suits a button's action -> { icon, iconOff? } or null.
// Used by the Deck editor in the page and by node (deck-icon-suggest.js --apply).
'use strict';
(function (root) {
  const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const rel = n => n && 'edge/' + n + '.svg';

  // a: the action. name: the Hue scene's name. have: optional list of icons that exist.
  function suggestIcon(a, name, have) {
    if (!a) return null;
    const ok = n => !have || have.includes(rel(n));
    const pick = (on, off) => ok(on) ? Object.assign({ icon: rel(on) }, off && ok(off) ? { iconOff: rel(off) } : {}) : null;
    switch (a.type) {
      case 'hue-room': return pick('bulb-on', 'bulb-off');
      case 'hue-scene': return pick('scene-' + slug(name)) || pick('bulb-on');
      case 'huesync': return pick('huesync-on', 'huesync-off');
      case 'keylight':
        if (a.op === 'brightness') return pick((a.step || 10) < 0 ? 'brightness-down' : 'brightness-up');
        if (a.op === 'warmer' || a.op === 'cooler') return pick(a.op);
        return pick('keylight-on', 'keylight-off');
      case 'shadowplay': return pick('shadowplay-' + (a.op || 'save-replay'));
      case 'obs': return pick('obs-' + (a.op || 'record'));
      case 'screens-off': return pick('screens-off');
      case 'webhook': return pick('webhook');
      default: return null;
    }
  }
  // True when the button's image is ours to manage: none chosen yet (null means "None" was picked),
  // or one we put there (autoIcon). An image you picked yourself is left alone.
  const autoIcon = b => b.icon === undefined || !!b.autoIcon;

  if (typeof module === 'object' && module.exports) module.exports = { suggestIcon, autoIcon, slug };
  else Object.assign(root, { suggestIcon, autoIcon });
})(this);

// node deck-icon-suggest.js --apply [--dry-run]: gives every button in deck.json whose image is
// missing or built-in the suggested one. Hue scene names come from the button titles.
if (typeof require === 'function' && typeof module === 'object' && require.main === module && process.argv.includes('--apply')) {
  const fs = require('fs'), path = require('path');
  const { suggestIcon, autoIcon } = module.exports;
  const deck = require('./deck');
  const file = process.env.DECK_FILE || path.join(__dirname, 'deck.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const have = deck.iconList();
  let n = 0;
  for (const p of cfg.profiles || []) for (const pg of p.pages || []) for (const [pos, b] of Object.entries(pg.buttons || {})) {
    // Imported light buttons kept the Stream Deck plugin's generic picture; ours are better.
    const imported = typeof b.icon === 'string' && b.icon.startsWith('sd/') && /^(hue-room|hue-scene|keylight|huesync)$/.test((b.action || {}).type);
    if (!autoIcon(b) && !imported) continue;
    const s = suggestIcon(b.action, b.title, have);
    if (!s || (s.icon === b.icon && s.iconOff === b.iconOff)) continue;
    console.log(`${p.name} / ${pg.name} / ${pos} ${b.title || ''}: ${b.icon || '-'} -> ${s.icon}${s.iconOff ? ' (off: ' + s.iconOff + ')' : ''}`);
    b.icon = s.icon; b.autoIcon = true; if (s.iconOff) b.iconOff = s.iconOff; else delete b.iconOff;
    n++;
  }
  if (!process.argv.includes('--dry-run') && n) fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`${n} buttons ${process.argv.includes('--dry-run') ? 'would change' : 'changed'}`);
}
