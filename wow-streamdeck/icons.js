// Original vector artwork for the WoW raid-marker Stream Deck keys. Every icon is a 144x144 SVG
// (rendered to PNG by build.js). Shapes are drawn here, not taken from the game.
'use strict';

const BG = '#121316', INK = '#0b0c0f', TEXT = '#e9ecef';
let uid = 0;
const id = p => `${p}${++uid}`;

// Marker shapes in a 100x100 box centred on 50,50
const SHAPES = {
  star: (() => {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 20 : 49, a = -Math.PI / 2 + i * Math.PI / 5;
      pts.push(`${(50 + r * Math.cos(a)).toFixed(2)} ${(54 + r * Math.sin(a)).toFixed(2)}`);
    }
    return 'M' + pts.join('L') + 'Z';
  })(),
  circle: 'M8 50a42 42 0 1 0 84 0a42 42 0 1 0 -84 0Z',
  diamond: 'M50 3L88 50L50 97L12 50Z',
  triangle: 'M50 9L95 89H5Z',
  moon: 'M48 8A42 42 0 1 0 88 68A36 36 0 0 1 48 8Z',
  square: 'M12 12H88V88H12Z',
  cross: 'M20 7L50 37L80 7L93 20L63 50L93 80L80 93L50 63L20 93L7 80L37 50L7 20Z',
  heart: 'M50 90C22 70 6 54 6 33C6 18 17 8 30 8C39 8 46 13 50 21C54 13 61 8 70 8C83 8 94 18 94 33C94 54 78 70 50 90Z',
  skull: 'M50 5C75 5 91 21 91 43C91 57 85 66 77 70V81Q77 90 68 90H32Q23 90 23 81V70C15 66 9 57 9 43C9 21 25 5 50 5Z',
};
const SKULL_DETAIL = `<ellipse cx="34" cy="45" rx="11" ry="12" fill="${INK}"/><ellipse cx="66" cy="45" rx="11" ry="12" fill="${INK}"/>
  <path d="M50 57L44 69H56Z" fill="${INK}"/><path d="M41 78V90M50 78V90M59 78V90" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`;

const MARKERS = {
  star: { name: 'Star', hi: '#FFE066', lo: '#F59F00', glow: '#FFD43B' },
  circle: { name: 'Circle', hi: '#FFC078', lo: '#E8590C', glow: '#FF922B' },
  diamond: { name: 'Diamond', hi: '#E599F7', lo: '#9C36B5', glow: '#CC5DE8' },
  triangle: { name: 'Triangle', hi: '#8CE99A', lo: '#2F9E44', glow: '#51CF66' },
  moon: { name: 'Moon', hi: '#F8F9FA', lo: '#A5B4C4', glow: '#D0E4FF' },
  square: { name: 'Square', hi: '#74C0FC', lo: '#1971C2', glow: '#339AF0' },
  cross: { name: 'Cross', hi: '#FF8787', lo: '#E03131', glow: '#FA5252' },
  heart: { name: 'Heart', hi: '#FF8FAB', lo: '#D6336C', glow: '#F06595' },
  skull: { name: 'Skull', hi: '#FFFFFF', lo: '#C9CFD6', glow: '#F1F3F5' },
};
const TARGET_ORDER = ['star', 'circle', 'diamond', 'triangle', 'moon', 'square', 'cross', 'skull'];   // /tm 1-8
const WORLD_ORDER = ['square', 'triangle', 'diamond', 'cross', 'star', 'circle', 'moon', 'skull'];    // /wm 1-8

const blur = (fid, sd) => `<filter id="${fid}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;

// One glossy marker symbol, size = width in px, centred on cx,cy
function symbol(shape, cx, cy, size, { glow = true } = {}) {
  const m = MARKERS[shape], d = SHAPES[shape], g = id('g'), s = id('s'), f = id('f');
  return `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${m.hi}"/><stop offset="1" stop-color="${m.lo}"/></linearGradient>
  <linearGradient id="${s}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>${blur(f, 7)}</defs>
  <g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${size / 100})">
  ${glow ? `<path d="${d}" fill="${m.glow}" opacity=".55" filter="url(#${f})"/>` : ''}
  <path d="${d}" fill="none" stroke="${INK}" stroke-width="${Math.max(7, 900 / size)}" stroke-linejoin="round"/>
  <path d="${d}" fill="url(#${g})" stroke="${m.lo}" stroke-width="1.5" stroke-linejoin="round"/>
  ${shape === 'skull' ? SKULL_DETAIL : ''}
  <path d="${d}" fill="url(#${s})"/></g>`;
}

function tile(body, tint, opts = {}) {
  const r = id('bg');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="288" height="288" viewBox="0 0 144 144">
<defs><radialGradient id="${r}" cx=".5" cy="${opts.glowY || .45}" r=".7"><stop offset="0" stop-color="${tint}" stop-opacity=".30"/><stop offset="1" stop-color="${tint}" stop-opacity="0"/></radialGradient></defs>
<rect width="144" height="144" fill="${BG}"/><rect width="144" height="144" fill="url(#${r})"/>
${body}
${opts.label ? `<text x="72" y="134" text-anchor="middle" font-family="Segoe UI, sans-serif" font-weight="800" font-size="${opts.labelSize || 17}" letter-spacing="1" fill="${TEXT}">${opts.label}</text>` : ''}
</svg>`;
}

// The glowing ring + light pillar of a world-marker flare on the ground
function floor(color, cx = 72, cy = 108) {
  const b = id('beam'), fl = id('fl'), f = id('f');
  return `<defs><linearGradient id="${b}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${color}" stop-opacity=".55"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>
  <radialGradient id="${fl}"><stop offset="0" stop-color="${color}" stop-opacity=".55"/><stop offset=".7" stop-color="${color}" stop-opacity=".18"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>${blur(f, 3)}</defs>
  <path d="M${cx - 40} ${cy}L${cx - 30} 10H${cx + 30}L${cx + 40} ${cy}Z" fill="url(#${b})" filter="url(#${f})"/>
  <ellipse cx="${cx}" cy="${cy}" rx="62" ry="20" fill="url(#${fl})"/>
  <ellipse cx="${cx}" cy="${cy}" rx="50" ry="14" fill="none" stroke="${color}" stroke-width="3.5" filter="url(#${f})"/>
  <ellipse cx="${cx}" cy="${cy}" rx="50" ry="14" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="1.6"/>
  <ellipse cx="${cx}" cy="${cy}" rx="30" ry="8" fill="none" stroke="${color}" stroke-opacity=".8" stroke-width="2"/>`;
}

const slash = (x1, y1, x2, y2, color = '#FF6B6B') =>
  `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${INK}" stroke-width="17" stroke-linecap="round"/><path d="M${x1} ${y1}L${x2} ${y2}" stroke="${color}" stroke-width="10" stroke-linecap="round"/>`;

// Outline-then-fill so overlapping parts read as one shape
const blob = (parts, fill, ink = 7) => `<g fill="none" stroke="${INK}" stroke-width="${ink}" stroke-linejoin="round">${parts}</g><g fill="${fill}">${parts}</g>`;
const grad = (gid, a, b) => `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`;

const HAND = `<rect x="50" y="52" width="44" height="44" rx="14"/><rect x="50" y="22" width="11" height="42" rx="5.5"/>
  <rect x="61.5" y="15" width="11" height="48" rx="5.5"/><rect x="73" y="19" width="11" height="44" rx="5.5"/>
  <rect x="84.5" y="29" width="9.5" height="36" rx="4.75"/><rect x="40" y="52" width="12" height="34" rx="6" transform="rotate(-38 46 84)"/>`;
function hand() {
  return grad('hand', '#FFE066', '#F59F00') + `<g transform="rotate(-14 72 70)">${blob(HAND, 'url(#hand)')}</g>`;
}


// Cartoon hand, upright, about 70x92 around (72,66). Each finger is outlined separately so the gaps show.
function hand2(gid, hi, lo) {
  const F = [[93, 78, 95, 42, 11], [82, 74, 83, 29, 13], [70, 74, 70, 23, 13.5], [58, 76, 57, 31, 13]];
  const ln = (x1, y1, x2, y2, w, c) => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${c}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;
  const fill = `url(#${gid})`, palm = 'M50 66Q50 60 58 60H90Q98 60 98 68V86Q98 108 74 108Q50 108 50 88Z';
  return `<defs><linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="0" y1="20" x2="0" y2="110"><stop offset="0" stop-color="${hi}"/><stop offset="1" stop-color="${lo}"/></linearGradient></defs>
  <path d="${palm}" fill="${INK}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>
  ${F.map(([a, b, c, d, w]) => ln(a, b, c, d, w + 8, INK) + ln(a, b, c, d, w, fill) + ln(a - w * .22, b - 8, c - w * .22, d + 1, 2.6, 'rgba(255,255,255,.45)')).join('')}
  <path d="${palm}" fill="${fill}"/>
  ${ln(62, 96, 39, 72, 22, INK)}${ln(62, 96, 39, 72, 14, fill)}${ln(56, 93, 37, 73, 2.6, 'rgba(255,255,255,.45)')}
  <path d="M74 94q8 4 14 -2" fill="none" stroke="${INK}" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/>`;
}

const EXTRAS = {
  'target-clear': { name: 'Clear target marker', tags: ['clear', 'target', 'marker'], svg: () => tile(
    `<g stroke="#ced4da" stroke-width="6" stroke-linecap="round" fill="none"><circle cx="72" cy="58" r="30"/>
     <path d="M72 18V34M72 82V98M32 58H48M96 58H112"/></g><circle cx="72" cy="58" r="5" fill="#ced4da"/>` + slash(42, 92, 102, 24),
    '#FA5252', { label: 'CLEAR' }) },
  'all-clear': { name: 'Clear all markers', tags: ['clear', 'all', 'markers'], svg: () => tile(
    symbol('star', 50, 36, 36, { glow: false }) + symbol('circle', 94, 36, 34, { glow: false }) +
    symbol('triangle', 50, 80, 34, { glow: false }) + symbol('skull', 94, 80, 34, { glow: false }) + slash(36, 102, 108, 16),
    '#FA5252', { label: 'CLEAR ALL', labelSize: 15 }) },
  hello: { name: 'Hello', tags: ['emote', 'hello', 'wave'], svg: () => tile(
    `<g transform="rotate(-14 72 70) translate(0 -4)">${hand2('hg', '#FFE066', '#F08C00')}</g>` +
    `<g fill="none" stroke="#FFD43B" stroke-width="5" stroke-linecap="round"><path d="M110 30q8 9 5 21"/><path d="M120 20q13 15 7 35"/><path d="M34 34q-8 9 -5 21"/></g>`,
    '#FFD43B', { label: 'HELLO' }) },
  wait: { name: 'Wait', tags: ['emote', 'wait', 'hourglass'], svg: () => tile(
    grad('wd', '#E8B07A', '#9C6239') + grad('ws', '#FFE066', '#F08C00') +
    `<defs><linearGradient id="wg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#D0EBFF" stop-opacity=".35"/><stop offset="1" stop-color="#74C0FC" stop-opacity=".12"/></linearGradient>${blur('wf', 7)}</defs>
     <path d="M46 22H98C98 46 80 52 77 60C80 68 98 74 98 98H46C46 74 64 68 67 60C64 52 46 46 46 22Z" fill="#74C0FC" opacity=".35" filter="url(#wf)"/>
     <path d="M46 22H98C98 46 80 52 77 60C80 68 98 74 98 98H46C46 74 64 68 67 60C64 52 46 46 46 22Z" fill="url(#wg)" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>
     <path d="M46 22H98C98 46 80 52 77 60C80 68 98 74 98 98H46C46 74 64 68 67 60C64 52 46 46 46 22Z" fill="none" stroke="#E7F5FF" stroke-width="2.5" stroke-linejoin="round"/>
     <path d="M55 32H89C87 43 77 50 72 57C67 50 57 43 55 32Z" fill="url(#ws)"/><path d="M72 57V88" stroke="#FFD43B" stroke-width="3"/>
     <path d="M53 96C57 84 65 79 72 77C79 79 87 84 91 96Z" fill="url(#ws)"/>
     <path d="M54 30C54 42 60 48 64 52" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"/>
     <rect x="36" y="11" width="72" height="14" rx="5" fill="url(#wd)" stroke="${INK}" stroke-width="5"/><rect x="36" y="95" width="72" height="14" rx="5" fill="url(#wd)" stroke="${INK}" stroke-width="5"/>
     <path d="M42 15H102M42 99H102" stroke="#fff" stroke-opacity=".35" stroke-width="2.5" stroke-linecap="round"/>`,
    '#74C0FC', { label: 'WAIT' }) },
  pat: { name: 'Pat', tags: ['emote', 'pat'], svg: () => tile(
    grad('face', '#FFE066', '#F08C00') +
    `<circle cx="72" cy="92" r="25" fill="${INK}" stroke="${INK}" stroke-width="8"/><circle cx="72" cy="92" r="25" fill="url(#face)"/>
     <ellipse cx="63" cy="80" rx="9" ry="5" fill="#fff" opacity=".45" transform="rotate(-25 63 80)"/>
     <g fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"><path d="M58 93q5 -6 10 0M76 93q5 -6 10 0M64 102q8 7 16 0"/></g>
     <circle cx="56" cy="101" r="4.5" fill="#ff6b6b" opacity=".55"/><circle cx="88" cy="101" r="4.5" fill="#ff6b6b" opacity=".55"/>` +
    `<g transform="translate(72 48) rotate(90) scale(.6) translate(-72 -66)">${hand2('pg', '#FFE3C2', '#E8A15C')}</g>` +
    `<g fill="none" stroke="#FFD8A8" stroke-width="4" stroke-linecap="round"><path d="M44 30q-6 -4 -8 -12M100 30q6 -4 8 -12"/></g>`,
    '#FFA94D', { label: 'PAT' }) },
  'thank-you': { name: 'Thank you', tags: ['emote', 'thank', 'thanks', 'ty'], svg: () => tile(
    symbol('heart', 72, 60, 86) +
    `<g fill="#FFE066"><path d="M125 12l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3Z"/><path d="M30 18l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2Z"/><path d="M118 84l2 4 4 2 -4 2 -2 4 -2 -4 -4 -2 4 -2Z"/></g>`,
    '#F06595', { label: 'THANK YOU', labelSize: 15 }) },
  cheer: { name: 'Cheer', tags: ['emote', 'cheer', 'party', 'celebrate'], svg: () => {
    const cone = 'M30 110L58 46Q82 56 94 80Z';
    const bits = [['#FFD43B', 98, 30, 0], ['#4DABF7', 116, 46, 30], ['#69DB7C', 84, 18, -20], ['#FF6B6B', 122, 22, 45], ['#E599F7', 108, 64, 15], ['#FFA94D', 70, 26, -35]]
      .map(([c, x, y, r]) => `<rect x="${x - 5}" y="${y - 3}" width="10" height="6" rx="1.5" fill="${c}" stroke="${INK}" stroke-width="2" transform="rotate(${r} ${x} ${y})"/>`).join('');
    return tile(grad('cone', '#C77DFF', '#7B2CBF') +
      `<defs><clipPath id="cc"><path d="${cone}"/></clipPath>${blur('cf', 8)}</defs>
       <circle cx="96" cy="44" r="30" fill="#FFD43B" opacity=".25" filter="url(#cf)"/>
       <g fill="none" stroke-width="5" stroke-linecap="round"><path d="M80 42q6 -14 -2 -26" stroke="#FFD43B"/><path d="M96 58q14 -2 22 -14" stroke="#4DABF7"/><path d="M90 48q12 -10 10 -26" stroke="#FF6B6B"/></g>
       ${bits}<circle cx="128" cy="36" r="3.5" fill="#FFD43B"/><circle cx="64" cy="14" r="3" fill="#69DB7C"/><circle cx="118" cy="74" r="3" fill="#FF6B6B"/>
       <path d="${cone}" fill="none" stroke="${INK}" stroke-width="9" stroke-linejoin="round"/>
       <path d="${cone}" fill="url(#cone)"/>
       <g clip-path="url(#cc)" stroke="#FFD43B" stroke-width="6"><path d="M38 70L84 104M46 52L100 92M28 88L70 118"/></g>
       <path d="M58 46Q82 56 94 80" fill="none" stroke="#E5DBFF" stroke-width="3.5" stroke-linecap="round"/>
       <path d="M40 98L56 60" stroke="#fff" stroke-opacity=".45" stroke-width="3" stroke-linecap="round"/>`,
      '#CC5DE8', { label: 'CHEER' });
  } },
  'ready-check': { name: 'Ready check', tags: ['ready', 'check', 'raid'], svg: () => tile(
    symbol('circle', 72, 58, 78).replace(/#FFC078/g, '#8CE99A').replace(/#E8590C/g, '#2B8A3E').replace(/#FF922B/g, '#40C057') +
    `<path d="M53 59L67 73L92 45" fill="none" stroke="${INK}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
     <path d="M53 59L67 73L92 45" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`,
    '#40C057', { label: 'READY?' }) },
  'countdown-10': { name: 'Countdown 10', tags: ['countdown', 'pull', 'timer', '10'], svg: () => {
    const c = 2 * Math.PI * 38;
    return tile(grad('cd', '#FFA94D', '#FA5252') +
      `<circle cx="72" cy="58" r="38" fill="none" stroke="#2b2d31" stroke-width="9"/>
       <circle cx="72" cy="58" r="38" fill="none" stroke="url(#cd)" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(c * .78).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 72 58)"/>
       <text x="72" y="74" text-anchor="middle" font-family="Segoe UI, sans-serif" font-weight="800" font-size="44" fill="#fff">10</text>`,
      '#FF922B', { label: 'COUNTDOWN', labelSize: 14 });
  } },
  'world-clear': { name: 'Clear world markers', tags: ['clear', 'world', 'markers'], svg: () => tile(
    floor('#adb5bd', 72, 96) + slash(42, 104, 102, 30), '#FA5252', { label: 'CLEAR WM', labelSize: 15, glowY: .55 }) },
};

function all() {
  const out = [];
  TARGET_ORDER.forEach((k, i) => out.push({ file: `target-${i + 1}-${k}`, name: `${MARKERS[k].name} (target)`, tags: ['target', 'marker', k],
    svg: tile(symbol(k, 72, 72, 104), MARKERS[k].glow) }));
  WORLD_ORDER.forEach((k, i) => out.push({ file: `world-${i + 1}-${k}`, name: `${MARKERS[k].name} (world ${i + 1})`, tags: ['world', 'marker', 'flare', k],
    svg: tile(floor(MARKERS[k].glow) + symbol(k, 72, 60, 64) +
      `<text x="12" y="24" font-family="Segoe UI, sans-serif" font-weight="800" font-size="17" fill="${TEXT}" fill-opacity=".55">${i + 1}</text>`,
      MARKERS[k].glow, { glowY: .6 }) }));
  for (const [k, e] of Object.entries(EXTRAS)) out.push({ file: k, name: e.name, tags: e.tags, svg: e.svg() });
  return out;
}

module.exports = { all };
