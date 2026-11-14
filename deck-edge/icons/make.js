// Draws the Deck's built-in button images as SVGs in this folder:
//   node make.js
// The Deck lists them as edge/<name>.svg in the button image picker.
// Keys are 144x144. The bottom third stays quiet because the button title is drawn over it.
const fs = require('fs');
const path = require('path');

const icons = {};
let uid = 0;

// A key: rounded square, a two-stop background, a soft top sheen, then the drawing.
function key(bg, body, defs = '') {
  const id = 'k' + (uid++);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144" width="144" height="144">
<defs>
<linearGradient id="${id}bg" x1="0" y1="0" x2="0" y2="1">${bg.map((c, i) => `<stop offset="${i / (bg.length - 1)}" stop-color="${c}"/>`).join('')}</linearGradient>
<linearGradient id="${id}sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".10"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
<filter id="${id}glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter>
<filter id="${id}soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5"/></filter>
<clipPath id="${id}clip"><rect width="144" height="144" rx="22"/></clipPath>
${defs.replace(/#ID/g, id)}
</defs>
<g clip-path="url(#${id}clip)">
<rect width="144" height="144" fill="url(#${id}bg)"/>
${body.replace(/#ID/g, '#' + id)}
<rect width="144" height="144" fill="url(#${id}sh)"/>
</g>
</svg>
`;
}
const add = (name, svg) => { icons[name] = svg; };

// Shared pieces --------------------------------------------------------------
const S = (c, w = 6) => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const glow = (c, r, cx = 72, cy = 52, o = .8) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}" opacity="${o}" filter="url(#IDglow)"/>`;
const rays = (cx, cy, r1, r2, c, w = 5, skip = []) => {
  let out = '';
  for (let i = 0; i < 8; i++) {
    if (skip.includes(i)) continue;
    const a = i * Math.PI / 4;
    out += `<line x1="${(cx + Math.cos(a) * r1).toFixed(1)}" y1="${(cy + Math.sin(a) * r1).toFixed(1)}" x2="${(cx + Math.cos(a) * r2).toFixed(1)}" y2="${(cy + Math.sin(a) * r2).toFixed(1)}" ${S(c, w)}/>`;
  }
  return out;
};
const DARK = ['#2a2c33', '#121317'];
const OFF = ['#1c1d21', '#0d0e10'];

// Bulb: the glass is an arc from (60,66) over the top to (84,66).
const BULB = 'M61 68 A22 22 0 1 1 83 68 L81 75 H63 Z';
function bulb(on, cy = 0) {
  const t = `transform="translate(0 ${cy})"`;
  if (on) return `<g ${t}>${glow('#ffcf4a', 30, 72, 48, .75)}
${rays(72, 48, 30, 37, '#ffd76a', 5, [1, 2, 3])}
<path d="${BULB}" fill="url(#IDbulb)" stroke="#fff3c4" stroke-width="2"/>
<path d="M66 60 q6 -8 12 0" ${S('#c98a00', 3)}/>
<rect x="63" y="78" width="18" height="5" rx="2.5" fill="#cfd3da"/><rect x="65" y="85" width="14" height="5" rx="2.5" fill="#a9aeb8"/></g>`;
  return `<g ${t}><path d="${BULB}" ${S('#5d626c', 4)}/>
<rect x="63" y="78" width="18" height="5" rx="2.5" fill="#4a4e57"/><rect x="65" y="85" width="14" height="5" rx="2.5" fill="#3b3e45"/></g>`;
}
const BULB_DEFS = '<radialGradient id="#IDbulb" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="#fffbe6"/><stop offset=".55" stop-color="#ffe27a"/><stop offset="1" stop-color="#ffb627"/></radialGradient>';

// A circular arrow (counter-clockwise, "replay") centred on 72,52.
const replayArrow = c => `<path d="M50 40 A26 26 0 1 1 46 58" ${S(c)}/><path d="M42 30 L50 41 L62 37" ${S(c)}/>`;
const mic = (c, cy = 0) => `<g transform="translate(0 ${cy})"><rect x="62" y="24" width="20" height="36" rx="10" fill="${c}"/>
<path d="M52 50 a20 20 0 0 0 40 0" ${S(c, 5)}/><line x1="72" y1="70" x2="72" y2="80" ${S(c, 5)}/><line x1="62" y1="80" x2="82" y2="80" ${S(c, 5)}/></g>`;
const recDot = (ring, dot) => `<circle cx="72" cy="52" r="28" ${S(ring, 5)}/><circle cx="72" cy="52" r="16" fill="${dot}"/>${glow(dot, 14, 72, 52, .5)}`;

// Lights ---------------------------------------------------------------------
add('bulb-on', key(['#3a2f12', '#14110a'], bulb(true), BULB_DEFS));
add('bulb-off', key(OFF, bulb(false), BULB_DEFS));

const PANEL = '<rect x="40" y="26" width="64" height="40" rx="7"';
add('keylight-on', key(['#33302a', '#121110'], `${glow('#fff1d0', 34, 72, 46, .7)}
${PANEL} fill="url(#IDpanel)" stroke="#fffaf0" stroke-width="2"/>
<line x1="72" y1="66" x2="72" y2="86" ${S('#9aa0aa', 5)}/><line x1="58" y1="88" x2="86" y2="88" ${S('#9aa0aa', 5)}/>`,
'<linearGradient id="#IDpanel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ffe9c2"/></linearGradient>'));
add('keylight-off', key(OFF, `${PANEL} ${S('#5d626c', 4)}/>
<line x1="72" y1="66" x2="72" y2="86" ${S('#4a4e57', 5)}/><line x1="58" y1="88" x2="86" y2="88" ${S('#4a4e57', 5)}/>`));

const sun = (cx, cy, r, c) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/>${rays(cx, cy, r + 6, r + 13, c, 4)}`;
add('brightness-up', key(DARK, `${glow('#ffd36b', 22, 58, 52, .5)}${sun(58, 52, 11, '#ffd36b')}
<line x1="90" y1="52" x2="110" y2="52" ${S('#ffffff')}/><line x1="100" y1="42" x2="100" y2="62" ${S('#ffffff')}/>`));
add('brightness-down', key(DARK, `${sun(58, 52, 9, '#b9a26a')}<line x1="90" y1="52" x2="110" y2="52" ${S('#ffffff')}/>`));
add('warmer', key(['#3b2312', '#140c07'], `${glow('#ff8a2a', 24, 72, 54, .6)}
<path d="M72 22 C86 38 94 50 90 64 C87 78 57 78 54 64 C51 54 60 48 63 38 C67 47 70 50 72 53 C76 44 76 33 72 22 Z" fill="url(#IDflame)"/>`,
'<linearGradient id="#IDflame" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd25a"/><stop offset="1" stop-color="#ff5a1f"/></linearGradient>'));
const flake = c => {
  let out = '';
  for (let i = 0; i < 3; i++) {
    const a = i * 60;
    out += `<g transform="rotate(${a} 72 52)"><line x1="72" y1="22" x2="72" y2="82" ${S(c, 5)}/>
<path d="M64 28 L72 36 L80 28 M64 76 L72 68 L80 76" ${S(c, 4)}/></g>`;
  }
  return out;
};
add('cooler', key(['#12263b', '#070d14'], glow('#6cc6ff', 22, 72, 52, .5) + flake('#bfe6ff')));

const TV = '<rect x="38" y="28" width="68" height="44" rx="6"';
add('huesync-on', key(DARK, `${glow('#ff4fa3', 16, 36, 50, .8)}${glow('#3fb6ff', 16, 108, 50, .8)}
${TV} fill="url(#IDscr)" stroke="#e9ecf2" stroke-width="3"/>
<line x1="60" y1="84" x2="84" y2="84" ${S('#9aa0aa', 5)}/>`,
'<linearGradient id="#IDscr" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff4fa3"/><stop offset=".5" stop-color="#a66bff"/><stop offset="1" stop-color="#3fb6ff"/></linearGradient>'));
add('huesync-off', key(OFF, `${TV} ${S('#5d626c', 4)}/><line x1="60" y1="84" x2="84" y2="84" ${S('#4a4e57', 5)}/>`));

// PC ------------------------------------------------------------------------------
// Screens off: a monitor with a crescent moon on it.
add('screens-off', key(['#1a1d33', '#090a14'], `${glow('#8f9bff', 20, 72, 48, .45)}
<rect x="34" y="26" width="76" height="50" rx="7" ${S('#c9cdf5', 4)}/>
<path d="M60 84 H84 M72 76 V84" ${S('#8a8fb0', 4)}/>
<path d="M78 36 A14 14 0 1 0 84 62 A11 11 0 1 1 78 36 Z" fill="#ffd36b"/>`));
// Audio: a speaker with sound waves (e.g. a folder of volume sliders).
add('audio', key(['#0f2a3a', '#061219'], `${glow('#4cc2ff', 22, 66, 50, .45)}
<path d="M36 42 H50 L66 28 V72 L50 58 H36 Z" fill="#e6f6ff"/>
<path d="M78 40 A14 14 0 0 1 78 60 M86 32 A26 26 0 0 1 86 68" ${S('#4cc2ff', 5)}/>`));
// Webhook: three linked nodes, like the webhook symbol.
add('webhook', key(['#2b1638', '#100818'], `${glow('#c56bff', 22, 72, 50, .4)}
<path d="M72 30 L52 64 M72 30 L92 64 M52 64 H92" ${S('#e3b8ff', 5)}/>
<circle cx="72" cy="30" r="9" fill="#c56bff" stroke="#f3e2ff" stroke-width="3"/>
<circle cx="52" cy="64" r="9" fill="#ff6bb5" stroke="#f3e2ff" stroke-width="3"/>
<circle cx="92" cy="64" r="9" fill="#6bb8ff" stroke="#f3e2ff" stroke-width="3"/>`));

// NVIDIA ShadowPlay (green) ------------------------------------------------------
const G = '#76b900', GBG = ['#22300f', '#0c1107'];
add('shadowplay-save-replay', key(GBG, `${replayArrow(G)}<path d="M72 40 V60 M64 53 L72 61 L80 53" ${S('#ffffff', 5)}/>`));
add('shadowplay-replay-toggle', key(GBG, `${replayArrow(G)}<path d="M66 41 L82 52 L66 63 Z" fill="#ffffff"/>`));
add('shadowplay-record', key(GBG, recDot(G, '#ff3b3b')));
add('shadowplay-screenshot', key(GBG, `<path d="M40 38 H56 L62 30 H82 L88 38 H104 V76 H40 Z" ${S(G, 5)}/><circle cx="72" cy="56" r="12" ${S('#ffffff', 5)}/>`));
add('shadowplay-overlay', key(GBG, `<rect x="36" y="26" width="72" height="52" rx="7" ${S(G, 5)}/>
<rect x="44" y="34" width="18" height="36" rx="3" fill="${G}"/><line x1="70" y1="40" x2="98" y2="40" ${S('#ffffff', 5)}/><line x1="70" y1="52" x2="92" y2="52" ${S('#ffffff', 5)}/><line x1="70" y1="64" x2="96" y2="64" ${S('#ffffff', 5)}/>`));
add('shadowplay-mic', key(GBG, mic(G)));
add('shadowplay-photo-mode', key(GBG, `<circle cx="72" cy="52" r="28" ${S(G, 5)}/>
${[0, 60, 120, 180, 240, 300].map(d => {
  const p = a => [72 + Math.cos(a * Math.PI / 180) * 26, 52 + Math.sin(a * Math.PI / 180) * 26].map(n => n.toFixed(1));
  const [x1, y1] = p(d), [x2, y2] = p(d + 110);
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${S('#ffffff', 4)}/>`;
}).join('')}`));
add('shadowplay-game-filter', key(GBG, [[44, 60], [72, 38], [100, 54]].map(([x, y]) =>
  `<line x1="${x}" y1="26" x2="${x}" y2="80" ${S('#5b6b47', 5)}/><circle cx="${x}" cy="${y}" r="8" fill="${G}"/>`).join('')));
add('shadowplay-perf-overlay', key(GBG, `<path d="M40 70 A32 32 0 0 1 104 70" ${S(G, 6)}/>
${[-60, -30, 0, 30, 60].map(a => `<line x1="72" y1="42" x2="72" y2="46" transform="rotate(${a} 72 70)" ${S('#ffffff', 3)}/>`).join('')}
<line x1="72" y1="70" x2="90" y2="50" ${S('#ffffff', 5)}/><circle cx="72" cy="70" r="5" fill="#ffffff"/>`));

// OBS Studio (white on violet) --------------------------------------------------
const O = '#eceaf6', OBG = ['#2c2645', '#100e1a'];
add('obs-record', key(OBG, recDot(O, '#ff3b3b')));
add('obs-record-pause', key(OBG, `<circle cx="72" cy="52" r="28" ${S(O, 5)}/><rect x="60" y="38" width="8" height="28" rx="3" fill="${O}"/><rect x="76" y="38" width="8" height="28" rx="3" fill="${O}"/>`));
add('obs-stream', key(OBG, `${glow('#ff3b6b', 10, 72, 52, .7)}<circle cx="72" cy="52" r="7" fill="#ff4f6f"/>
<path d="M58 38 A20 20 0 0 0 58 66 M86 38 A20 20 0 0 1 86 66" ${S(O, 5)}/>
<path d="M46 28 A34 34 0 0 0 46 76 M98 28 A34 34 0 0 1 98 76" ${S(O, 5)}/>`));
add('obs-replay-buffer', key(OBG, `${replayArrow('#a99cff')}<path d="M72 38 V52 L82 58" ${S(O, 5)}/>`));
add('obs-save-replay', key(OBG, `${replayArrow('#a99cff')}<path d="M72 40 V60 M64 53 L72 61 L80 53" ${S(O, 5)}/>`));
add('obs-virtualcam', key(OBG, `<rect x="34" y="34" width="54" height="38" rx="7" ${S(O, 5)}/><path d="M88 46 L108 36 V70 L88 60" ${S('#a99cff', 5)}/>`));
add('obs-scene', key(OBG, `<rect x="48" y="24" width="56" height="38" rx="6" ${S('#7b6fd0', 5)}/>
<rect x="38" y="36" width="56" height="38" rx="6" fill="${OBG[0]}" stroke="${O}" stroke-width="5"/><path d="M48 66 L60 52 L70 62 L76 56 L86 66" ${S('#a99cff', 4)}/>`));
add('obs-mute', key(OBG, `${mic(O)}<line x1="46" y1="24" x2="98" y2="82" ${S('#ff4f6f', 6)}/>`));

// Hue scenes: a small picture of each scene's colours ---------------------------
const scene = (name, bg, body, defs) => add('scene-' + name, key(bg, body, defs));
const stars = pts => pts.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r || 1.6}" fill="#ffffff" opacity=".85"/>`).join('');
const sparkle = (x, y, s, c) => `<path d="M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s} Z" fill="${c}"/>`;

scene('tokyo', ['#1a0b3d', '#5a1470', '#ff2e88'], `${stars([[22, 20], [50, 14], [118, 22], [96, 12]])}
${glow('#ff2e88', 30, 72, 96, .6)}
<path d="M0 144 V86 H14 V64 H28 V78 H38 V48 H52 V70 H60 V56 H74 V36 H86 V66 H96 V58 H108 V74 H118 V52 H132 V80 H144 V144 Z" fill="#12061f"/>
${[[42, 56], [46, 64], [78, 44], [80, 52], [78, 60], [122, 60], [126, 68], [18, 72], [100, 64], [64, 64]].map(([x, y], i) =>
  `<rect x="${x}" y="${y}" width="4" height="4" fill="${i % 2 ? '#2ee6ff' : '#ff6ad5'}"/>`).join('')}`);

scene('vapor', ['#2b1055', '#7a1f8f', '#ff6ec7'], `<circle cx="72" cy="66" r="34" fill="url(#IDsun)"/>
${[66, 74, 81, 87, 92].map((y, i) => `<rect x="30" y="${y}" width="84" height="${2 + i * .8}" fill="#7a1f8f"/>`).join('')}
<rect x="0" y="98" width="144" height="46" fill="#1a0838"/>
${[-60, -30, 0, 30, 60].map(d => `<line x1="${72 + d * .3}" y1="98" x2="${72 + d * 1.6}" y2="144" stroke="#2ee6ff" stroke-width="1.5" opacity=".8"/>`).join('')}
${[104, 112, 124, 140].map(y => `<line x1="0" y1="${y}" x2="144" y2="${y}" stroke="#2ee6ff" stroke-width="1.5" opacity=".8"/>`).join('')}`,
'<linearGradient id="#IDsun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe45e"/><stop offset="1" stop-color="#ff3fa4"/></linearGradient>');

scene('energize', ['#e9f6ff', '#8cc8ff', '#3d8bff'], `${glow('#ffffff', 34, 72, 52, .9)}
<circle cx="72" cy="52" r="20" fill="#ffffff"/>${rays(72, 52, 28, 40, '#ffffff', 6)}
<path d="M76 36 L64 56 H74 L68 70 L82 48 H72 Z" fill="#3d8bff"/>`);

scene('spellbound', ['#14072f', '#4a1d7a', '#0f8f97'], `${stars([[24, 24], [40, 70], [112, 82], [124, 30], [96, 16]])}
${glow('#c9a6ff', 24, 66, 50, .6)}
<path d="M80 26 A28 28 0 1 0 92 70 A22 22 0 1 1 80 26 Z" fill="#efe3ff"/>
${sparkle(104, 46, 10, '#7ff5e6')}${sparkle(40, 36, 7, '#e3c8ff')}${sparkle(98, 72, 5, '#ffffff')}`);

scene('relax', ['#ffcf7a', '#ff9a3c', '#c2541c'], `${glow('#fff3c4', 26, 72, 70, .8)}
<circle cx="72" cy="74" r="22" fill="#fff1c9"/>
<rect x="0" y="74" width="144" height="70" fill="#c2541c"/>
${[84, 96, 108].map((y, i) => `<path d="M${10 + i * 6} ${y} q15 -7 30 0 t30 0 t30 0 t30 0" fill="none" stroke="#ffd59a" stroke-width="3.5" stroke-linecap="round" opacity="${.9 - i * .2}"/>`).join('')}`);

scene('tropical', ['#ffd23f', '#ff8a3c', '#e8455e'], `<circle cx="96" cy="64" r="24" fill="#fff0a8" opacity=".95"/>
<rect x="0" y="86" width="144" height="58" fill="#1b8a8f"/>
${[92, 100, 110].map(y => `<line x1="70" y1="${y}" x2="128" y2="${y}" stroke="#7fe0dc" stroke-width="2.5" stroke-linecap="round" opacity=".7"/>`).join('')}
<path d="M44 140 C46 110 48 80 56 50" fill="none" stroke="#1d3b17" stroke-width="7" stroke-linecap="round"/>
<g fill="#1f5a1a"><path d="M56 48 C40 34 22 38 12 50 C28 44 42 46 56 50 Z"/><path d="M56 48 C46 26 30 20 18 24 C34 30 46 38 56 50 Z"/>
<path d="M56 48 C66 28 84 24 96 30 C80 32 66 40 56 50 Z"/><path d="M56 48 C74 40 92 46 100 58 C86 52 70 50 56 50 Z"/><path d="M56 48 C56 30 62 18 70 12 C64 26 60 38 56 50 Z"/></g>`);

scene('nightlite', ['#0d0805', '#2a1406', '#5a2a08'], `${stars([[24, 22], [116, 20], [34, 64], [108, 70], [90, 14]])}
${glow('#ff9a2a', 26, 72, 50, .7)}
<path d="M80 24 A28 28 0 1 0 98 66 A22 22 0 1 1 80 24 Z" fill="#ffb24a"/>`);

scene('morning', ['#9fd3ff', '#ffe2a6', '#ffb36b'], `${glow('#fff3c0', 34, 72, 84, .9)}
${rays(72, 84, 34, 48, '#fff4cf', 5, [0, 1, 2, 3, 4])}
<circle cx="72" cy="84" r="26" fill="#fff6d8"/>
<rect x="0" y="84" width="144" height="60" fill="#e48a4a"/>
<path d="M0 92 Q36 84 72 92 T144 92 V144 H0 Z" fill="#c9673a"/>`);

scene('dimmed', ['#2a2016', '#140f0a'], `${glow('#c78a3a', 22, 72, 48, .45)}
<path d="${BULB}" fill="#7a5a2c" stroke="#b08850" stroke-width="2"/>
<rect x="63" y="78" width="18" height="5" rx="2.5" fill="#6d6a66"/><rect x="65" y="85" width="14" height="5" rx="2.5" fill="#55524e"/>`);

scene('bright', ['#fffdf2', '#ffe9a8'], `${glow('#ffffff', 36, 72, 52, 1)}<circle cx="72" cy="52" r="22" fill="#fff8d6"/>${rays(72, 52, 30, 42, '#ffcf4a', 6)}`);

scene('concentrate', ['#eef6ff', '#a9d0ff', '#5b9cff'], `<circle cx="72" cy="52" r="32" fill="none" stroke="#ffffff" stroke-width="6"/>
<circle cx="72" cy="52" r="20" fill="none" stroke="#2f6fe0" stroke-width="6"/><circle cx="72" cy="52" r="8" fill="#ffffff"/>`);

scene('read', ['#fff4dc', '#f2c27a'], `<path d="M72 34 C60 26 46 26 34 30 V78 C46 74 60 74 72 82 Z" fill="#ffffff" stroke="#b07a2a" stroke-width="3" stroke-linejoin="round"/>
<path d="M72 34 C84 26 98 26 110 30 V78 C98 74 84 74 72 82 Z" fill="#fffaf0" stroke="#b07a2a" stroke-width="3" stroke-linejoin="round"/>
${[42, 52, 62].map(y => `<line x1="42" y1="${y}" x2="64" y2="${y + 3}" stroke="#d8b47a" stroke-width="2.5" stroke-linecap="round"/><line x1="80" y1="${y + 3}" x2="102" y2="${y}" stroke="#d8b47a" stroke-width="2.5" stroke-linecap="round"/>`).join('')}`);

scene('savanna-sunset', ['#ffb347', '#ff6a3d', '#b8322a'], `<circle cx="72" cy="70" r="30" fill="#ffd36b"/>
<rect x="0" y="92" width="144" height="52" fill="#4a1a10"/>
<path d="M66 92 C66 80 64 72 60 66 M66 82 C72 74 80 70 88 66" fill="none" stroke="#2a0c06" stroke-width="5" stroke-linecap="round"/>
<path d="M30 62 C40 52 70 50 82 56 C96 50 116 54 124 62 C110 66 90 66 80 64 C66 68 44 68 30 62 Z" fill="#2a0c06"/>`);

scene('arctic-aurora', ['#04121f', '#06283a', '#0a4c55'], `${stars([[20, 18], [118, 16], [64, 12], [128, 50], [14, 56]])}
<path d="M-10 70 C20 40 40 80 70 46 S120 30 154 54" fill="none" stroke="#3dffb0" stroke-width="12" stroke-linecap="round" opacity=".7" filter="url(#IDsoft)"/>
<path d="M-10 84 C30 60 56 92 86 62 S130 54 154 70" fill="none" stroke="#2ee6ff" stroke-width="9" stroke-linecap="round" opacity=".55" filter="url(#IDsoft)"/>
<path d="M0 110 L30 92 L52 104 L80 84 L108 100 L144 88 V144 H0 Z" fill="#06121c"/>`);

// Write ---------------------------------------------------------------------------
for (const [name, svg] of Object.entries(icons)) fs.writeFileSync(path.join(__dirname, name + '.svg'), svg);
console.log(`wrote ${Object.keys(icons).length} icons`);
