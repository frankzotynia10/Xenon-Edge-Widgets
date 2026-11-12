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
  plus: 'M36 6H64V36H94V64H64V94H36V64H6V36H36Z',
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
  plus: { name: 'Plus', hi: '#8CE99A', lo: '#2B8A3E', glow: '#51CF66' },
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


// ---------- More emotes ----------
const ln = (d, w = 4.5, c = INK) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const drop = (x, y, c = '#74C0FC') => `<path d="M${x} ${y - 10}C${x + 7} ${y - 1} ${x + 7} ${y + 8} ${x} ${y + 8}C${x - 7} ${y + 8} ${x - 7} ${y - 1} ${x} ${y - 10}Z" fill="${c}" stroke="${INK}" stroke-width="2.5"/>`;
const blush = `<circle cx="50" cy="74" r="5" fill="#ff6b6b" opacity=".5"/><circle cx="94" cy="74" r="5" fill="#ff6b6b" opacity=".5"/>`;
const spark = (x, y, r, c = '#FFE066') => `<path d="M${x} ${y - r}l${r * .3} ${r * .7} ${r * .7} ${r * .3} -${r * .7} ${r * .3} -${r * .3} ${r * .7} -${r * .3} -${r * .7} -${r * .7} -${r * .3} ${r * .7} -${r * .3}Z" fill="${c}"/>`;
const outlined = (d, fill, w = 7) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linejoin="round"/><path d="${d}" fill="${fill}"/>`;

// glossy round face, centre 72,62, radius 40
function face(inner, hi = '#FFE066', lo = '#F08C00', cx = 72, cy = 62, r = 40) {
  const g = id('fc');
  return `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="1" stop-color="${lo}"/></linearGradient></defs>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${INK}" stroke="${INK}" stroke-width="8"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${g})"/>
  <ellipse cx="${cx - r * .35}" cy="${cy - r * .55}" rx="${r * .3}" ry="${r * .15}" fill="#fff" opacity=".4" transform="rotate(-25 ${cx - r * .35} ${cy - r * .55})"/>${inner}`;
}

// thumbs up, upright around 72,64
// Fist faces left like the 👍 emoji: curled fingers stacked on the left, short fat thumb on top, wrist cuff on the right.
function thumb(gid) {
  const f = `url(#${gid})`;
  const fist = 'M56 58H92Q102 58 102 68V98Q102 110 90 110H60Q50 110 50 100V64Q50 58 56 58Z';
  const thumbD = 'M54 64C50 50 50 36 56 26C60 19 70 18 73 26C76 34 72 44 74 60Z';
  const fingers = [[38, 58, 48, 14], [38, 71, 48, 13.5], [40, 84, 46, 13], [44, 96.5, 42, 12]]
    .map(([x, y, w, h]) => outlined(`M${x + h / 2} ${y}H${x + w}V${y + h}H${x + h / 2}A${h / 2} ${h / 2} 0 0 1 ${x + h / 2} ${y}Z`, f, 6) +
      ln(`M${x + h / 2} ${y + 3.5}H${x + w - 14}`, 2.2, 'rgba(255,255,255,.45)')).join('');
  return `<defs><linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="0" y1="18" x2="0" y2="112"><stop offset="0" stop-color="#FFE066"/><stop offset="1" stop-color="#F08C00"/></linearGradient></defs>` +
    grad(gid + 's', '#74C0FC', '#1971C2') +
    outlined('M98 60H116V112H98Z', `url(#${gid}s)`, 6) +
    `<path d="${thumbD}" fill="${INK}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>` +
    `<path d="${fist}" fill="${INK}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>` +
    `<path d="${thumbD}" fill="${f}"/><path d="${fist}" fill="${f}"/>` +
    ln('M57 52C55 42 56 33 60 27', 3, 'rgba(255,255,255,.55)') +
    `<path d="M60 30Q64 24 69 28L68 36Q63 33 60 36Z" fill="#FFF3BF" opacity=".8"/>` +
    fingers + ln('M84 100q6 2 10 -4', 3, 'rgba(11,12,15,.35)');
}

function sword() {
  return `<g transform="translate(72 66) scale(1.08) translate(-72 -66)">
    ${outlined('M64 26L72 8L80 26V86H64Z', 'url(#blade)', 6)}${ln('M72 14V84', 1.5, 'rgba(255,255,255,.6)')}
    ${outlined('M54 84H90Q93 84 93 88Q93 92 90 92H54Q51 92 51 88Q51 84 54 84Z', 'url(#gold)', 6)}
    ${outlined('M67 92H77V112H67Z', '#8B5A2B', 6)}<circle cx="72" cy="117" r="6" fill="url(#gold)" stroke="${INK}" stroke-width="3"/></g>`;
}

const EMOTES = {
  dance: { name: 'Dance', tags: ['emote', 'dance', 'disco'], svg: () => tile(
    `<defs><radialGradient id="ball" cx=".35" cy=".3"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#868e96"/></radialGradient><clipPath id="bc"><circle cx="72" cy="68" r="36"/></clipPath></defs>
     ${ln('M72 6V32', 3, '#adb5bd')}<circle cx="72" cy="68" r="36" fill="${INK}" stroke="${INK}" stroke-width="8"/><circle cx="72" cy="68" r="36" fill="url(#ball)"/>
     <g clip-path="url(#bc)" fill="none" stroke="#495057" stroke-width="1.6"><path d="M30 50H114M30 59H114M30 68H114M30 77H114M30 86H114M30 95H114M30 41H114"/>
     <ellipse cx="72" cy="68" rx="12" ry="36"/><ellipse cx="72" cy="68" rx="25" ry="36"/><path d="M72 30V106"/>
     <rect x="50" y="42" width="11" height="8" fill="#fff"/><rect x="85" y="60" width="11" height="8" fill="#E599F7"/><rect x="61" y="78" width="11" height="8" fill="#74C0FC"/><rect x="85" y="87" width="11" height="8" fill="#FFD43B"/></g>
     <text x="16" y="56" font-family="Segoe UI Symbol, Segoe UI" font-size="30" fill="#E599F7">&#x266A;</text><text x="110" y="112" font-family="Segoe UI Symbol, Segoe UI" font-size="28" fill="#74C0FC">&#x266B;</text>
     ${spark(118, 34, 9)}${spark(28, 96, 7, '#74C0FC')}`, '#CC5DE8', { label: 'DANCE' }) },
  lol: { name: 'LOL', tags: ['emote', 'lol', 'laugh'], svg: () => tile(face(
    ln('M52 54q7 -9 14 0') + ln('M78 54q7 -9 14 0') +
    `<path d="M50 70H94Q92 98 72 98Q52 98 50 70Z" fill="${INK}"/><path d="M54 72H90V77Q72 80 54 77Z" fill="#fff"/><path d="M60 92Q72 84 84 92Q72 99 60 92Z" fill="#ff6b6b"/>` +
    drop(36, 58) + drop(108, 58)), '#FFD43B', { label: 'LOL' }) },
  cry: { name: 'Cry', tags: ['emote', 'cry', 'sad'], svg: () => tile(face(
    ln('M50 44l14 -6') + ln('M94 44l-14 -6') + ln('M52 56q7 6 14 0') + ln('M78 56q7 6 14 0') + ln('M58 90q14 -12 28 0') +
    ln('M59 64V100', 7, '#74C0FC') + ln('M85 64V100', 7, '#74C0FC') + drop(59, 110) + drop(85, 110), '#FFE066', '#E8A15C'), '#74C0FC', { label: 'CRY' }) },
  roar: { name: 'Roar', tags: ['emote', 'roar', 'angry'], svg: () => tile(face(
    ln('M50 40l14 8', 5) + ln('M94 40l-14 8', 5) + `<circle cx="58" cy="54" r="4.5" fill="${INK}"/><circle cx="86" cy="54" r="4.5" fill="${INK}"/>` +
    `<path d="M48 66H96Q94 104 72 104Q50 104 48 66Z" fill="${INK}"/><path d="M53 67L59 81L65 67ZM79 67L85 81L91 67Z" fill="#fff"/><path d="M60 102L65 93L70 102ZM74 102L79 93L84 102Z" fill="#fff"/>`,
    '#FFC078', '#E8590C') + ln('M20 38l-10 -6M16 62H4M20 86l-10 6M124 38l10 -6M128 62h12M124 86l10 6', 5, '#FF922B'), '#FA5252', { label: 'ROAR' }) },
  facepalm: { name: 'Facepalm', tags: ['emote', 'facepalm'], svg: () => tile(face(ln('M62 90h20')) +
    `<g transform="translate(74 50) rotate(-12) scale(.62) translate(-72 -66)">${hand2('fp', '#FFE3C2', '#E8A15C')}</g>`, '#FFD43B', { label: 'FACEPALM', labelSize: 15 }) },
  hug: { name: 'Hug', tags: ['emote', 'hug'], svg: () => tile(face(ln('M52 54q7 -9 14 0') + ln('M78 54q7 -9 14 0') + ln('M58 76q14 12 28 0') + blush) +
    `<g transform="translate(38 96) rotate(35) scale(.42) translate(-72 -66)">${hand2('hg1', '#FFE066', '#F08C00')}</g>` +
    `<g transform="translate(106 96) scale(-1 1) rotate(35) scale(.42) translate(-72 -66)">${hand2('hg2', '#FFE066', '#F08C00')}</g>`, '#FFA94D', { label: 'HUG' }) },
  kiss: { name: 'Kiss', tags: ['emote', 'kiss'], svg: () => tile(face(ln('M52 56q7 -7 14 0') + `<circle cx="86" cy="54" r="5" fill="${INK}"/>` +
    ln('M70 74q9 1 5 7q9 1 0 8', 4.5) + blush) + symbol('heart', 112, 30, 30, { glow: false }), '#F06595', { label: 'KISS' }) },
  shrug: { name: 'Shrug', tags: ['emote', 'shrug'], svg: () => tile(
    `<path d="M16 28H128Q136 28 136 36V86Q136 94 128 94H60L42 110L45 94H16Q8 94 8 86V36Q8 28 16 28Z" fill="#26272b" stroke="#ced4da" stroke-width="4" stroke-linejoin="round"/>
     <text x="72" y="70" text-anchor="middle" font-family="Segoe UI, Yu Gothic UI, sans-serif" font-weight="700" font-size="25" fill="#fff">&#xAF;\\_(&#x30C4;)_/&#xAF;</text>`,
    '#adb5bd', { label: 'SHRUG' }) },
  sleep: { name: 'Sleep', tags: ['emote', 'sleep', 'zzz'], svg: () => tile(symbol('moon', 58, 68, 78) +
    `<g font-family="Segoe UI, sans-serif" font-weight="800" fill="#D0E4FF"><text x="96" y="52" font-size="28">Z</text><text x="114" y="32" font-size="20">z</text><text x="126" y="17" font-size="14">z</text></g>`,
    '#748FFC', { label: 'SLEEP' }) },
  flex: { name: 'Flex', tags: ['emote', 'flex', 'strong'], svg: () => tile(grad('plate', '#FF8787', '#C92A2A') + grad('bar', '#F1F3F5', '#868E96') +
    `<g transform="rotate(-14 72 62)">${outlined('M30 58H114V66H30Z', 'url(#bar)', 6)}
     ${outlined('M42 34H54Q57 34 57 37V87Q57 90 54 90H42Q39 90 39 87V37Q39 34 42 34Z', 'url(#plate)', 6)}${outlined('M27 44H36Q39 44 39 47V77Q39 80 36 80H27Q24 80 24 77V47Q24 44 27 44Z', 'url(#plate)', 6)}
     ${outlined('M90 34H102Q105 34 105 37V87Q105 90 102 90H90Q87 90 87 87V37Q87 34 90 34Z', 'url(#plate)', 6)}${outlined('M108 44H117Q120 44 120 47V77Q120 80 117 80H108Q105 80 105 77V47Q105 44 108 44Z', 'url(#plate)', 6)}
     ${ln('M44 40V60M92 40V60', 2.5, 'rgba(255,255,255,.5)')}</g>` + ln('M60 22l-4 -10M72 20V8M84 22l4 -10', 4, '#FFD43B'), '#FA5252', { label: 'FLEX' }) },
  salute: { name: 'Salute', tags: ['emote', 'salute', 'respect'], svg: () => tile(grad('gold', '#FFE066', '#E67700') +
    outlined('M48 8H68L80 48H60Z', '#339AF0', 5) + outlined('M96 8H76L64 48H84Z', '#FA5252', 5) +
    `<circle cx="72" cy="78" r="32" fill="${INK}" stroke="${INK}" stroke-width="7"/><circle cx="72" cy="78" r="32" fill="url(#gold)"/><circle cx="72" cy="78" r="24" fill="none" stroke="#F08C00" stroke-width="3"/>
     <g transform="translate(52 58) scale(.4)"><path d="${SHAPES.star}" fill="#FFF3BF" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/></g>
     <ellipse cx="60" cy="62" rx="10" ry="5" fill="#fff" opacity=".45" transform="rotate(-30 60 62)"/>`, '#FFD43B', { label: 'SALUTE' }) },
  applaud: { name: 'Applaud', tags: ['emote', 'applaud', 'clap'], svg: () => tile(
    `<g transform="translate(54 70) rotate(24) scale(.62) translate(-72 -66)">${hand2('ap1', '#FFE066', '#F08C00')}</g>` +
    `<g transform="translate(90 70) scale(-1 1) rotate(24) scale(.62) translate(-72 -66)">${hand2('ap2', '#FFE066', '#F08C00')}</g>` +
    ln('M72 18V6M58 22l-7 -9M86 22l7 -9', 4.5, '#FFD43B'), '#FFD43B', { label: 'APPLAUD' }) },
  charge: { name: 'Charge', tags: ['emote', 'charge', 'attack'], svg: () => tile(grad('blade', '#F8F9FA', '#868E96') + grad('gold', '#FFE066', '#E67700') +
    `<g transform="rotate(40 72 66)">${sword()}</g><g transform="rotate(-40 72 66)">${sword()}</g>`, '#FA5252', { label: 'CHARGE' }) },
  followme: { name: 'Follow me', tags: ['emote', 'follow', 'followme'], svg: () => tile(grad('arrow', '#8CE99A', '#2F9E44') +
    outlined('M16 48H72V26L124 62L72 98V76H16Z', 'url(#arrow)', 8) + ln('M22 54H76V40', 3, 'rgba(255,255,255,.5)'),
    '#51CF66', { label: 'FOLLOW ME', labelSize: 15 }) },
  train: { name: 'Train', tags: ['emote', 'train', 'choo'], svg: () => tile(grad('loco', '#FF8787', '#C92A2A') +
    `<circle cx="44" cy="16" r="8" fill="#dee2e6"/><circle cx="30" cy="9" r="6" fill="#dee2e6" opacity=".8"/><circle cx="18" cy="6" r="4" fill="#dee2e6" opacity=".6"/>` +
    outlined('M38 26H60V32H56V50H42V32H38Z', '#343a40', 6) + outlined('M30 62Q30 50 42 50H92V88H30Z', 'url(#loco)', 7) +
    outlined('M88 30H122V88H88Z', '#A61E4D', 7) + `<rect x="96" y="38" width="18" height="16" rx="2" fill="#D0EBFF" stroke="${INK}" stroke-width="3"/>` +
    outlined('M30 88L16 100H40Z', '#495057', 5) + `<circle cx="30" cy="64" r="5" fill="#FFE066" stroke="${INK}" stroke-width="2.5"/>` +
    [[48, 98, 10], [74, 98, 10], [104, 96, 13]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#343a40" stroke="${INK}" stroke-width="5"/><circle cx="${x}" cy="${y}" r="3" fill="#adb5bd"/>`).join('') +
    ln('M36 58H86', 2.5, 'rgba(255,255,255,.45)'), '#FF6B6B', { label: 'TRAIN' }) },
  violin: { name: 'Violin', tags: ['emote', 'violin', 'sad'], svg: () => tile(grad('wood', '#E8A15C', '#8B4513') +
    `<g transform="rotate(-28 72 64)">
     ${outlined('M72 48C58 48 52 57 56 65C49 68 45 76 47 86C50 100 61 107 72 107C83 107 94 100 97 86C99 76 95 68 88 65C92 57 86 48 72 48Z', 'url(#wood)', 7)}
     ${ln('M63 72q-3 8 0 16', 2.5)}${ln('M81 72q3 8 0 16', 2.5)}<rect x="68" y="92" width="8" height="11" rx="2" fill="#212529"/>
     ${outlined('M68.5 10H75.5V60H68.5Z', '#212529', 4)}<circle cx="72" cy="9" r="5.5" fill="#495057" stroke="${INK}" stroke-width="3"/>
     ${ln('M70.5 12V94M73.5 12V94', .9, '#dee2e6')}<ellipse cx="62" cy="56" rx="6" ry="3" fill="#fff" opacity=".35"/></g>` +
    ln('M22 104L124 30', 6) + ln('M22 104L124 30', 2.5, '#dee2e6'), '#E8A15C', { label: 'VIOLIN' }) },
  oom: { name: 'Out of mana', tags: ['emote', 'oom', 'mana'], svg: () => tile(
    `<defs><clipPath id="fl"><path d="M62 18H82V46A32 32 0 1 1 62 46Z"/></clipPath></defs>
     <path d="M62 18H82V46A32 32 0 1 1 62 46Z" fill="#a5d8ff" fill-opacity=".14" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>
     <g clip-path="url(#fl)"><rect x="30" y="98" width="84" height="20" fill="#339AF0"/><path d="M30 98q10 -4 21 0t21 0t21 0t21 0" fill="#74C0FC"/></g>
     <path d="M62 18H82V46A32 32 0 1 1 62 46Z" fill="none" stroke="#E7F5FF" stroke-width="2.5" stroke-linejoin="round"/>
     ${ln('M50 62q-6 12 0 26', 3, 'rgba(255,255,255,.55)')}${outlined('M58 9H86Q88 9 88 11V19Q88 21 86 21H58Q56 21 56 19V11Q56 9 58 9Z', '#C08552', 5)}
     <circle cx="80" cy="90" r="3" fill="none" stroke="#a5d8ff" stroke-width="1.5"/>`, '#339AF0', { label: 'OOM' }) },
  healme: { name: 'Heal me', tags: ['emote', 'heal', 'healme'], svg: () => tile(symbol('plus', 72, 62, 88) + spark(118, 26, 10, '#B2F2BB') + spark(26, 98, 8, '#B2F2BB'),
    '#40C057', { label: 'HEAL ME', labelSize: 15 }) },
  yes: { name: 'Yes', tags: ['emote', 'yes', 'thumbs up'], svg: () => tile(thumb('ty'), '#40C057', { label: 'YES' }) },
  no: { name: 'No', tags: ['emote', 'no', 'thumbs down'], svg: () => tile(`<g transform="translate(0 128) scale(1 -1)">${thumb('td')}</g>`, '#FA5252', { label: 'NO' }) },
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
  for (const [k, e] of Object.entries(EMOTES)) out.push({ file: 'emote-' + k, name: e.name, tags: e.tags, svg: e.svg() });
  return out;
}

module.exports = { all };
