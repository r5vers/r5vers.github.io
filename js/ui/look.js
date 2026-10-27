// Appearance: themes, page background, glass and light, type, chart and
// candle styling. All of it is per profile (kept in the profile's settings).
import { DEFAULT_LOOK } from '../chart/chart.js?v=446247be79';
import { field, h, icon } from './dom.js?v=446247be79';
import { LOCAL_NAMES } from '../local/site.js?v=446247be79';

// The saved look's format. Looks older than MIN_APPEARANCE_VERSION start
// from the defaults; newer ones are kept and only completed with new fields.
export const APPEARANCE_VERSION = 6;
const MIN_APPEARANCE_VERSION = 5;

/** Type pairings: display (headings), ui (text) and data (numbers, chart). */
export const FONT_PAIRS = {
  sistem: { name: 'Sistem', note: 'cihazın kendi yazısı (iPhone’da SF, Android’de Roboto) · Inter gibi',
    display: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto", ui: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto", mono: "'Inter'",
    dWeight: 650, dTrack: '-0.02em', dCase: 'none', dStretch: '100%', dSettings: 'normal', monoStretch: '100%', uiSize: '14px' },
  nokta: { name: 'Nokta', note: 'Doto (nokta matris) · Instrument Sans · Azeret Mono',
    display: "'Doto'", ui: "'Instrument Sans'", mono: "'Azeret Mono'",
    dWeight: 800, dTrack: '0.01em', dCase: 'none', dStretch: '100%', dSettings: '"ROND" 100', monoStretch: '100%', uiSize: '13.5px' },
  atolye: { name: 'Atölye', note: 'Syne · Schibsted Grotesk · Martian Mono',
    display: "'Syne'", ui: "'Schibsted Grotesk'", mono: "'Martian Mono'",
    dWeight: 700, dTrack: '-0.012em', dCase: 'none', dStretch: '100%', dSettings: 'normal', monoStretch: '87.5%', uiSize: '13px' },
  maison: { name: 'Maison', note: 'Bodoni Moda · Instrument Sans · Spline Sans Mono',
    display: "'Bodoni Moda'", ui: "'Instrument Sans'", mono: "'Spline Sans Mono'",
    dWeight: 600, dTrack: '-0.01em', dCase: 'none', dStretch: '100%', dSettings: 'normal', monoStretch: '100%', uiSize: '13px' },
  gazete: { name: 'Gazete', note: 'Fraunces · Familjen Grotesk · Azeret Mono',
    display: "'Fraunces'", ui: "'Familjen Grotesk'", mono: "'Azeret Mono'",
    dWeight: 640, dTrack: '-0.015em', dCase: 'none', dStretch: '100%', dSettings: '"SOFT" 50, "WONK" 0', monoStretch: '100%', uiSize: '13.5px' },
  teknik: { name: 'Teknik', note: 'Martian Mono · Spline Sans',
    display: "'Martian Mono'", ui: "'Spline Sans'", mono: "'Martian Mono'",
    dWeight: 600, dTrack: '0.02em', dCase: 'uppercase', dStretch: '112.5%', dSettings: 'normal', monoStretch: '87.5%', uiSize: '13px' },
  sade: { name: 'Sade', note: 'Instrument Sans · Martian Mono',
    display: "'Instrument Sans'", ui: "'Instrument Sans'", mono: "'Martian Mono'",
    dWeight: 640, dTrack: '-0.022em', dCase: 'none', dStretch: '100%', dSettings: 'normal', monoStretch: '87.5%', uiSize: '13.5px' },
  grotesk: { name: 'Grotesk', note: 'Bricolage Grotesque · Spline Sans Mono',
    display: "'Bricolage Grotesque'", ui: "'Bricolage Grotesque'", mono: "'Spline Sans Mono'",
    dWeight: 720, dTrack: '-0.025em', dCase: 'none', dStretch: '100%', dSettings: 'normal', monoStretch: '100%', uiSize: '13.5px' },
  editoryal: { name: 'Editoryal', note: 'Bodoni Moda · Schibsted Grotesk · Azeret Mono',
    display: "'Bodoni Moda'", ui: "'Schibsted Grotesk'", mono: "'Azeret Mono'",
    dWeight: 560, dTrack: '-0.005em', dCase: 'none', dStretch: '100%', dSettings: 'normal', monoStretch: '100%', uiSize: '13px' },
  yumusak: { name: 'Yumuşak', note: 'Fraunces · Instrument Sans · Martian Mono',
    display: "'Fraunces'", ui: "'Instrument Sans'", mono: "'Martian Mono'",
    dWeight: 560, dTrack: '-0.02em', dCase: 'none', dStretch: '100%', dSettings: '"SOFT" 100, "WONK" 1', monoStretch: '87.5%', uiSize: '13.5px' },
  genis: { name: 'Geniş', note: 'Syne · Familjen Grotesk · Spline Sans Mono',
    display: "'Syne'", ui: "'Familjen Grotesk'", mono: "'Spline Sans Mono'",
    dWeight: 800, dTrack: '0', dCase: 'none', dStretch: '100%', dSettings: 'normal', monoStretch: '100%', uiSize: '13.5px' },
  terminal: { name: 'Terminal', note: 'Azeret Mono · Spline Sans',
    display: "'Azeret Mono'", ui: "'Spline Sans'", mono: "'Azeret Mono'",
    dWeight: 600, dTrack: '-0.01em', dCase: 'uppercase', dStretch: '100%', dSettings: 'normal', monoStretch: '100%', uiSize: '13px' },
};

// RV Next's type: one family for text and titles, so what the choice shows
// is what the page gets (the earlier pairs mixed a display face the pages
// never used); a saved pair moves to the family it set the text in.
Object.assign(FONT_PAIRS, Object.fromEntries([
  ['instrument', 'Instrument', "'Instrument Sans'"], ['schibsted', 'Schibsted', "'Schibsted Grotesk'"], ['familjen', 'Familjen', "'Familjen Grotesk'"],
  ['bricolage', 'Bricolage', "'Bricolage Grotesque'"], ['spline', 'Spline', "'Spline Sans'"],
].map(([id, name, fam]) => [id, { name, note: fam.replace(/'/g, ''), display: fam, ui: fam, mono: fam, dWeight: 650, dTrack: '-0.02em', dCase: 'none', dStretch: '100%', dSettings: 'normal', monoStretch: '100%', uiSize: '14px' }])));
export const RV_FONTS = ['sistem', 'instrument', 'schibsted', 'familjen', 'bricolage', 'spline'];
const FONT_OF = { nokta: 'instrument', maison: 'instrument', sade: 'instrument', yumusak: 'instrument', atolye: 'schibsted', editoryal: 'schibsted',
  gazete: 'familjen', genis: 'familjen', grotesk: 'bricolage', teknik: 'spline', terminal: 'spline' };

/** Page backgrounds: a base tone, two or three light sources and a vignette,
 *  so the glass has something to refract. `light` ones switch the UI to
 *  dark-on-light. */
export const BACKGROUNDS = {
  onyx: { name: 'Oniks', light: false, css: 'radial-gradient(900px 620px at 12% -12%, rgba(124,58,237,.26), transparent 62%), radial-gradient(900px 620px at 108% 18%, rgba(37,99,235,.18), transparent 60%), radial-gradient(700px 500px at 50% 115%, rgba(168,85,247,.10), transparent 60%), #000' },
  gece: { name: 'Gece', light: false, css: 'radial-gradient(1000px 700px at 82% -12%, rgba(59,130,246,.34), transparent 62%), radial-gradient(900px 700px at -10% 108%, rgba(14,165,233,.16), transparent 60%), linear-gradient(180deg, #070b16, #03050b)' },
  iris: { name: 'İris', light: false, css: 'radial-gradient(1000px 700px at 80% -10%, rgba(99,102,241,.42), transparent 62%), radial-gradient(900px 700px at -10% 100%, rgba(168,85,247,.22), transparent 60%), linear-gradient(180deg, #0d0a20, #06050f)' },
  okyanus: { name: 'Okyanus', light: false, css: 'radial-gradient(1000px 700px at 85% -10%, rgba(45,212,191,.28), transparent 62%), radial-gradient(800px 600px at -10% 105%, rgba(16,185,129,.18), transparent 60%), linear-gradient(180deg, #05130f, #020806)' },
  amber: { name: 'Kehribar', light: false, css: 'radial-gradient(1000px 650px at 85% -15%, rgba(245,158,11,.30), transparent 62%), radial-gradient(800px 600px at -10% 110%, rgba(234,88,12,.16), transparent 60%), linear-gradient(180deg, #15100a, #0a0705)' },
  obsidian: { name: 'Obsidyen', light: false,
    css: 'radial-gradient(1100px 700px at 88% -12%, rgba(198,255,61,0.13), transparent 62%), radial-gradient(900px 640px at -8% 112%, rgba(46,230,166,0.12), transparent 60%), linear-gradient(180deg, #08090c, #050608)' },
  matte: { name: 'Mat siyah', light: false,
    css: 'radial-gradient(1200px 720px at 50% -22%, rgba(255,255,255,0.075), transparent 62%), radial-gradient(800px 600px at 100% 110%, rgba(215,25,33,0.07), transparent 60%), linear-gradient(180deg, #060606, #000)' },
  black: { name: 'Siyah', light: false,
    css: 'radial-gradient(1200px 700px at 50% -24%, rgba(120,140,255,0.16), transparent 64%), radial-gradient(900px 600px at 100% 110%, rgba(255,255,255,0.05), transparent 60%), linear-gradient(180deg, #050506, #000)' },
  smoke: { name: 'Duman', light: false,
    css: 'radial-gradient(1200px 760px at 84% -14%, rgba(217,183,121,0.32), transparent 62%), radial-gradient(1000px 760px at -8% 110%, rgba(120,136,170,0.30), transparent 62%), radial-gradient(760px 560px at 40% 46%, rgba(255,244,225,0.045), transparent 70%), linear-gradient(180deg, #141518 0%, #0a0b0d 100%)' },
  midnight: { name: 'Gece', light: false,
    css: 'radial-gradient(1100px 760px at 84% -18%, rgba(98,132,255,0.44), transparent 62%), radial-gradient(900px 720px at -8% 112%, rgba(76,52,190,0.40), transparent 62%), radial-gradient(600px 500px at 50% 50%, rgba(140,170,255,0.04), transparent 70%), linear-gradient(180deg, #0a0f22 0%, #05070f 100%)' },
  ocean: { name: 'Okyanus', light: false,
    css: 'radial-gradient(1100px 760px at 90% -10%, rgba(45,212,191,0.32), transparent 62%), radial-gradient(1000px 720px at -10% 104%, rgba(14,116,144,0.44), transparent 62%), linear-gradient(180deg, #071a1f 0%, #030b0e 100%)' },
  wine: { name: 'Bordo', light: false,
    css: 'radial-gradient(1100px 740px at 86% -12%, rgba(232,180,160,0.28), transparent 62%), radial-gradient(900px 720px at -8% 106%, rgba(127,29,55,0.52), transparent 62%), linear-gradient(180deg, #1a0c10 0%, #0b0507 100%)' },
  emerald: { name: 'Zümrüt', light: false,
    css: 'radial-gradient(1100px 740px at 84% -12%, rgba(167,214,140,0.26), transparent 62%), radial-gradient(900px 720px at -8% 106%, rgba(6,95,70,0.54), transparent 62%), linear-gradient(180deg, #08160f 0%, #040a07 100%)' },
  lavender: { name: 'Lavanta', light: false,
    css: 'radial-gradient(1000px 700px at 14% -8%, rgba(196,181,253,0.34), transparent 62%), radial-gradient(1000px 720px at 106% 34%, rgba(103,232,249,0.16), transparent 60%), radial-gradient(820px 600px at 50% 120%, rgba(244,114,182,0.14), transparent 60%), linear-gradient(180deg, #110c1d 0%, #07050d 100%)' },
  copper: { name: 'Bakır', light: false,
    css: 'radial-gradient(1100px 740px at 100% -8%, rgba(240,163,107,0.34), transparent 62%), radial-gradient(860px 640px at -4% 104%, rgba(146,64,14,0.40), transparent 62%), linear-gradient(180deg, #17100b 0%, #0a0705 100%)' },
  nebula: { name: 'Bulutsu', light: false,
    css: 'radial-gradient(1100px 700px at 88% -12%, rgba(150,168,255,0.16), transparent 62%), radial-gradient(900px 640px at -8% 112%, rgba(199,125,255,0.13), transparent 60%), linear-gradient(180deg, #08090f, #05060b)' },
  carbon: { name: 'Karbon', light: false,
    css: 'radial-gradient(1000px 700px at 80% -20%, rgba(255,255,255,0.14), transparent 60%), radial-gradient(800px 600px at 0% 110%, rgba(255,255,255,0.08), transparent 60%), linear-gradient(180deg, #111112 0%, #070708 100%)' },
  navy: { name: 'Lacivert', light: false,
    css: 'radial-gradient(1100px 720px at 86% -14%, rgba(230,180,80,0.16), transparent 62%), radial-gradient(1000px 720px at -8% 110%, rgba(40,70,160,0.42), transparent 62%), linear-gradient(180deg, #0a1022 0%, #050811 100%)' },
  amber: { name: 'Kehribar', light: false,
    css: 'radial-gradient(1100px 720px at 90% -12%, rgba(255,176,32,0.18), transparent 62%), radial-gradient(900px 680px at -6% 110%, rgba(45,212,191,0.10), transparent 62%), linear-gradient(180deg, #121212 0%, #08080a 100%)' },
  sakura: { name: 'Sakura', light: false,
    css: 'radial-gradient(1000px 700px at 84% -10%, rgba(255,143,171,0.22), transparent 62%), radial-gradient(900px 680px at -8% 110%, rgba(155,231,196,0.10), transparent 62%), linear-gradient(180deg, #160b12 0%, #080508 100%)' },
  tundra: { name: 'Tundra', light: false,
    css: 'radial-gradient(1100px 720px at 84% -14%, rgba(165,180,252,0.20), transparent 62%), radial-gradient(900px 680px at -8% 110%, rgba(134,239,172,0.08), transparent 62%), linear-gradient(180deg, #0e111a 0%, #06080d 100%)' },
  phosphor: { name: 'Fosfor', light: false,
    css: 'radial-gradient(1100px 700px at 50% -20%, rgba(60,255,122,0.12), transparent 62%), radial-gradient(800px 600px at 100% 110%, rgba(60,255,122,0.05), transparent 60%), linear-gradient(180deg, #050806 0%, #000 100%)' },
  cyber: { name: 'Siber', light: false,
    css: 'radial-gradient(1000px 680px at 92% -10%, rgba(255,43,214,0.26), transparent 62%), radial-gradient(1000px 700px at -6% 108%, rgba(0,229,255,0.22), transparent 62%), linear-gradient(180deg, #0a0612 0%, #030207 100%)' },
  plum: { name: 'Erik', light: false,
    css: 'radial-gradient(1100px 740px at 86% -14%, rgba(176,38,255,0.30), transparent 62%), radial-gradient(900px 700px at -8% 110%, rgba(255,55,95,0.16), transparent 62%), linear-gradient(180deg, #120a19 0%, #07040b 100%)' },
  forest: { name: 'Orman', light: false,
    css: 'radial-gradient(1100px 740px at 84% -12%, rgba(48,209,88,0.20), transparent 62%), radial-gradient(900px 700px at -8% 110%, rgba(20,83,45,0.50), transparent 62%), linear-gradient(180deg, #07110b 0%, #030805 100%)' },
  crimson: { name: 'Kızıl', light: false,
    css: 'radial-gradient(1100px 740px at 86% -12%, rgba(255,69,58,0.26), transparent 62%), radial-gradient(900px 700px at -8% 108%, rgba(120,20,30,0.45), transparent 62%), linear-gradient(180deg, #140708 0%, #080304 100%)' },
  slate: { name: 'Arduvaz', light: false,
    css: 'radial-gradient(1100px 740px at 84% -16%, rgba(148,163,184,0.22), transparent 62%), radial-gradient(900px 700px at -8% 110%, rgba(51,65,85,0.50), transparent 62%), linear-gradient(180deg, #0e1217 0%, #06080b 100%)' },
  sunset: { name: 'Gün batımı', light: false,
    css: 'radial-gradient(1000px 680px at 90% -10%, rgba(255,159,10,0.26), transparent 62%), radial-gradient(1000px 720px at -6% 110%, rgba(255,55,95,0.24), transparent 62%), linear-gradient(180deg, #140b0a 0%, #070404 100%)' },
  aurora: { name: 'Aurora', light: false,
    css: 'radial-gradient(900px 620px at 12% -4%, rgba(232,121,249,0.28), transparent 62%), radial-gradient(1000px 720px at 104% 28%, rgba(34,211,238,0.24), transparent 60%), radial-gradient(820px 600px at 48% 120%, rgba(163,230,53,0.14), transparent 60%), linear-gradient(180deg, #0c0817 0%, #06040c 100%)' },
  paper: { name: 'Kağıt', light: true,
    css: 'radial-gradient(1000px 700px at 90% -10%, rgba(29,59,209,0.10), transparent 60%), radial-gradient(900px 640px at -6% 110%, rgba(184,140,80,0.14), transparent 60%), linear-gradient(180deg, #f5f2ea 0%, #ebe6da 100%)' },
  sand: { name: 'Kum', light: true,
    css: 'radial-gradient(1000px 700px at 86% -10%, rgba(255,255,255,0.70), transparent 60%), radial-gradient(900px 700px at -6% 108%, rgba(160,110,60,0.20), transparent 60%), linear-gradient(180deg, #ece2d0 0%, #ddcfb6 100%)' },
  ice: { name: 'Buz', light: true,
    css: 'radial-gradient(1000px 700px at 86% -12%, rgba(37,99,235,0.16), transparent 60%), radial-gradient(900px 700px at -6% 108%, rgba(13,148,136,0.14), transparent 60%), linear-gradient(180deg, #f3f6fb 0%, #e3e9f3 100%)' },
  snow: { name: 'Kar', light: true,
    css: 'radial-gradient(1000px 700px at 86% -12%, rgba(10,132,255,0.08), transparent 60%), linear-gradient(180deg, #f9f9fb 0%, #eceef2 100%)' },
  mint: { name: 'Nane', light: true,
    css: 'radial-gradient(1000px 700px at 86% -12%, rgba(48,209,88,0.14), transparent 60%), radial-gradient(900px 700px at -6% 108%, rgba(64,200,224,0.14), transparent 60%), linear-gradient(180deg, #f1f8f4 0%, #e1eee8 100%)' },
  custom: { name: 'Özel', light: null, css: null },
};

/** Accent colours in three families: neon, the iOS dark-mode system colours
 *  and softer tones. */
export const ACCENT_GROUPS = [
  { name: 'Neon', colors: ['#c6ff3d', '#39ff88', '#00e5ff', '#4d7cff', '#b026ff', '#ff2bd6', '#ff3864', '#d71921', '#ff6b1a', '#ffe23d'] },
  { name: 'Sistem', colors: ['#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f', '#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#63e6e2', '#40c8e0', '#64d2ff', '#ac8e68', '#f5f5f7'] },
  { name: 'Yumuşak', colors: ['#e6b450', '#ff8fab', '#a5b4fc', '#d9b779', '#e8b4a0', '#f0a36b', '#b9d46a', '#9fc5a8', '#7aa2ff', '#c4b5fd', '#fb7185', '#1d3bd1', '#8b2635'] },
];

export const CANDLE_SETS = [
  { name: 'Neon nane / mercan', up: '#2ee6a6', down: '#ff4d6d' },
  { name: 'Lime / mor', up: '#c6ff3d', down: '#a855f7' },
  { name: 'Lavanta mavisi / orkide', up: '#8fa8ff', down: '#c77dff' },
  { name: 'Neon camgöbeği / magenta', up: '#00e5ff', down: '#ff2bd6' },
  { name: 'iOS yeşil / kırmızı', up: '#30d158', down: '#ff453a' },
  { name: 'Nane / mercan', up: '#3cc8a0', down: '#ee6a6a' },
  { name: 'Klasik', up: '#26a69a', down: '#ef5350' },
  { name: 'Zümrüt / yakut', up: '#10b981', down: '#e11d48' },
  { name: 'Camgöbeği / pembe', up: '#22d3ee', down: '#f472b6' },
  { name: 'Mavi / turuncu', up: '#3b82f6', down: '#f97316' },
  { name: 'Şampanya / bordo', up: '#d9b779', down: '#a33a4c' },
  { name: 'Yeşim / kiremit', up: '#7fb685', down: '#d9734e' },
  { name: 'Altın / mor', up: '#f6c453', down: '#8b5cf6' },
  { name: 'Gümüş / grafit', up: '#e9e9ea', down: '#5d616c' },
  { name: 'Mürekkep (açık tema)', up: '#0f8a6c', down: '#c93a3a', light: true },
  { name: 'Siyah / gri (açık tema)', up: '#1b1b1b', down: '#9a9a9a', light: true },
  { name: 'Canlı', up: '#2bf28a', down: '#ff3d6e' },
  { name: 'Turkuaz / turuncu', up: '#2dd4bf', down: '#fb923c' },
  { name: 'Elektrik mavisi / kırmızı', up: '#4d7cff', down: '#ff3864' },
  { name: 'Beyaz / kırmızı', up: '#f5f5f7', down: '#ff453a' },
  { name: 'Altın / gümüş', up: '#f6c453', down: '#9ca3af' },
  { name: 'Pastel', up: '#86efac', down: '#fca5a5' },
  { name: 'Lime / pembe', up: '#c6ff3d', down: '#ff2bd6' },
  { name: 'Beyaz / sinyal kırmızısı', up: '#f2f2f2', down: '#d71921' },
  { name: 'Altın / gül', up: '#e6b450', down: '#e06c75' },
  { name: 'Turkuaz / kehribar', up: '#2dd4bf', down: '#ff8a3d' },
  { name: 'Yeşim / sakura', up: '#9be7c4', down: '#ff8fab' },
  { name: 'Fosfor', up: '#3cff7a', down: '#ff5c5c' },
];

/** Metals for the RV star, the RV name and (by choice) the headings:
 *  five stops of a polished gradient, light to dark and back. */
export const METALS = {
  silver: { name: 'Gümüş', stops: ['#fbfcfd', '#a7adb7', '#f1f3f6', '#727884', '#dfe2e7'] },
  titanium: { name: 'Titanyum', stops: ['#e3e6ea', '#858c97', '#cfd3d9', '#4f5560', '#b9bec6'] },
  chrome: { name: 'Krom', stops: ['#ffffff', '#c7ccd4', '#5f6672', '#d5d9df', '#ffffff'], angle: 180 },
  gold: { name: 'Altın', stops: ['#fff4cf', '#cfa64d', '#f8e6a6', '#8e6c24', '#e2c27a'] },
  rose: { name: 'Rose gold', stops: ['#ffe3da', '#cf9585', '#f6cdbf', '#93594b', '#e7b3a3'] },
  bronze: { name: 'Bronz', stops: ['#f4d6b0', '#a46a36', '#e6b88a', '#6a3f1c', '#c9925e'] },
  graphite: { name: 'Grafit', stops: ['#b4b9c2', '#4a4f58', '#8d929b', '#2a2d34', '#6f747d'] },
  nebula: { name: 'Bulutsu', stops: ['#e6e9ff', '#8fa8ff', '#d6c3ff', '#8a5cf0', '#b8c4ff'] },
  cobalt: { name: 'Kobalt', stops: ['#d8e6ff', '#4f7fd9', '#b7cdf7', '#234a95', '#8fb0ea'] },
  emerald: { name: 'Zümrüt', stops: ['#d6f7e8', '#3aa77a', '#a8e6cb', '#1d6047', '#7fd0ad'] },
};
export const metalCss = (id, angle = null) => {
  const m = METALS[id] || METALS.silver;
  const [a, b, c, d, e] = m.stops;
  return `linear-gradient(${angle ?? m.angle ?? 135}deg, ${a} 0%, ${b} 30%, ${c} 50%, ${d} 72%, ${e} 100%)`;
};
// on a light page the metal is drawn darker, so it still reads
const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.round(v * f).toString(16).padStart(2, '0');
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
};

/** One-click looks: background, accent, candles and a type pairing. `orbs`
 *  are the three lights behind the glass, `base` the page's own tone. */
export const PRESETS = [
  { id: 'onyx', name: 'Oniks', bg: 'onyx', accent: '#a855f7', up: '#26a69a', down: '#ef5350', font: 'sistem', orbs: ['#7c3aed', '#2563eb', '#db2777'], base: '#05060b' },
  { id: 'grafit', name: 'Grafit', bg: 'grafit', accent: '#e4e4e7', up: '#26a69a', down: '#ef5350', font: 'sistem', orbs: ['#3f3f46', '#52525b', '#27272a'], base: '#040404' },
  { id: 'gece', name: 'Gece', bg: 'gece', accent: '#3b82f6', up: '#26a69a', down: '#ef5350', font: 'sistem', orbs: ['#2563eb', '#0ea5e9', '#6366f1'], base: '#04070f' },
  { id: 'buzul', name: 'Buzul', bg: 'buzul', accent: '#22d3ee', up: '#2dd4bf', down: '#fb7185', font: 'sistem', orbs: ['#0891b2', '#0ea5e9', '#0d9488'], base: '#03090c' },
  { id: 'iris', name: 'İris', bg: 'iris', accent: '#8b5cf6', up: '#38bdf8', down: '#f43f5e', font: 'sistem', orbs: ['#6d28d9', '#4f46e5', '#c026d3'], base: '#06050f' },
  { id: 'okyanus', name: 'Okyanus', bg: 'okyanus', accent: '#14b8a6', up: '#2dd4bf', down: '#fb7185', font: 'sistem', orbs: ['#0d9488', '#059669', '#0284c7'], base: '#030908' },
  { id: 'zumrut', name: 'Zümrüt', bg: 'zumrut', accent: '#10b981', up: '#34d399', down: '#f87171', font: 'sistem', orbs: ['#047857', '#4d7c0f', '#0f766e'], base: '#030805' },
  { id: 'amber', name: 'Kehribar', bg: 'amber', accent: '#f59e0b', up: '#2dd4bf', down: '#f97316', font: 'sistem', orbs: ['#d97706', '#ea580c', '#be123c'], base: '#0b0705' },
  { id: 'gunbatimi', name: 'Gün batımı', bg: 'gunbatimi', accent: '#fb923c', up: '#2dd4bf', down: '#f43f5e', font: 'sistem', orbs: ['#ea580c', '#db2777', '#7c3aed'], base: '#0b0507' },
  { id: 'kizil', name: 'Kızıl', bg: 'kizil', accent: '#ef4444', up: '#26a69a', down: '#ef5350', font: 'sistem', orbs: ['#b91c1c', '#9f1239', '#7c2d12'], base: '#0a0404' },
  { id: 'gul', name: 'Gül', bg: 'gul', accent: '#ec4899', up: '#34d399', down: '#fb7185', font: 'sistem', orbs: ['#be185d', '#7c3aed', '#e11d48'], base: '#0a0408' },
];
// the RV themes' backgrounds (previews, the chart's flat tone) from their lights
for (const p of PRESETS) {
  BACKGROUNDS[p.bg] = { name: p.name, light: false,
    css: `radial-gradient(900px 620px at 12% -12%, ${p.orbs[0]}66, transparent 62%), radial-gradient(900px 620px at 108% 18%, ${p.orbs[1]}44, transparent 60%), radial-gradient(700px 500px at 50% 115%, ${p.orbs[2]}2a, transparent 60%), linear-gradient(180deg, ${p.base}, ${p.base})` };
}
export const RV_THEMES = PRESETS.map((p) => p.id);

export const DEFAULT_APPEARANCE = {
  v: APPEARANCE_VERSION,
  preset: 'onyx', bg: 'onyx', accent: '#a855f7', font: 'sistem', nxOnyx: 1,
  depth: 55,               // how dark the page and its glass are, 0..100
  scene: 'rv',             // behind the page: rv (the accent's light) | ipek | dalga | halka | sirt | duz
  pos: null, neg: null,    // money made / lost on the app pages (null: emerald / rose)
  custom: { type: 'mesh', c1: '#0e1016', c2: '#3a2a5e', c3: '#0f4c5c', angle: 150 },
  design: 'classic',       // studio (lights, motion, boards) | classic (the earlier, plainer look)
  style: 'glass',          // glass | brutal (hard edges and offset shadows)
  radius: 'round',         // sharp | soft | round (round: pill-shaped controls)
  density: 'normal',       // compact | normal | airy
  textSize: 'normal',      // small | normal | large
  glass: 0.27,             // clear (0.2) .. tinted (0.95)
  blur: 9,                 // backdrop blur, px
  sheen: 0.3,              // rim highlight and pointer light, 0..1
  texture: 'none',         // grid | lines | dots | none, sharp between panels, frosted behind them
  pointerLight: false,     // the rim lights up where the pointer is
  motion: false,           // slowly drifting background light
  grain: 0,
  ...DEFAULT_LOOK,
  up: '#26a69a', down: '#ef5350',
  // the home screen's own colours (null: the same as the chart)
  homeAccent: null, homeUp: null, homeDown: null,
  // chart details (null: follow the theme)
  gridColor: null, textColor: null, crossColor: null, volOpacity: 26, markOpacity: 4,
  chartColor2: '#140d26',  // the second colour of a gradient chart background
  // the RV metal, and how headings are written: metal | solid | gradient | plain
  metal: 'silver', titleStyle: 'plain', titleColor: '#ffffff', titleStops: ['#e6e9ff', '#8fa8ff', '#c77dff'], titleAngle: 135, titleShine: 0,
  cardRim: 'soft',         // soft | metal (a fine metal edge on the home boards)
};

const TEXTURES = {
  grid: (c) => `linear-gradient(${c} 1px, transparent 1px) 0 0 / 56px 56px, linear-gradient(90deg, ${c} 1px, transparent 1px) 0 0 / 56px 56px`,
  lines: (c) => `repeating-linear-gradient(115deg, ${c} 0 1px, transparent 1px 22px)`,
  dots: (c) => `radial-gradient(${c} 1px, transparent 1.4px) 0 0 / 18px 18px`,
  none: () => 'linear-gradient(transparent, transparent)',
};

// panels, inner elements, controls (buttons, segmented controls)
const RADII = { sharp: [6, 4, 4], soft: [18, 11, 11], round: [24, 14, 999] };
const DENSITY = { compact: 0.86, normal: 1, airy: 1.12 };
const TEXT = { small: 0.94, normal: 1, large: 1.08 };

/** A saved look completed with any fields added since it was saved. */
export function normalizeAppearance(saved) {
  if (!saved || typeof saved !== 'object' || !(saved.v >= MIN_APPEARANCE_VERSION)) return structuredClone(DEFAULT_APPEARANCE);
  const a = { ...structuredClone(DEFAULT_APPEARANCE), ...saved, v: APPEARANCE_VERSION };
  a.custom = { ...DEFAULT_APPEARANCE.custom, ...(saved.custom || {}) };
  // v6: the untouched Neon (and the first Bebe mavisi) look moves to the new
  // default, Bulutsu; a look the user changed stays as it is
  if (saved.v < 6 && (saved.preset === 'neon' || saved.preset === 'bulut')) {
    const p = PRESETS[0];
    Object.assign(a, { preset: p.id, bg: p.bg, accent: p.accent, up: p.up, down: p.down });
  }
  // RV Next: the clean Onyx look (black, the device's own type, one purple
  // accent, classic candles) once over whatever was copied from the main site
  if (!saved.nxOnyx) {
    const p = PRESETS.find((x) => x.id === 'onyx');
    Object.assign(a, { preset: p.id, bg: p.bg, accent: p.accent, up: p.up, down: p.down, font: p.font, design: 'classic', style: 'glass', radius: 'round', titleStyle: 'plain', titleColor: '#ffffff', homeAccent: null, homeUp: null, homeDown: null, texture: 'none', motion: false, pointerLight: false, grain: 0 });
  }
  a.nxOnyx = 1;
  // the five RV themes: anything else falls back to Oniks
  if (!RV_THEMES.includes(a.preset)) a.preset = 'onyx';
  a.bg = a.preset;
  if (!BACKGROUNDS[a.bg]) a.bg = DEFAULT_APPEARANCE.bg;
  if (!FONT_PAIRS[a.font]) a.font = DEFAULT_APPEARANCE.font;
  if (!METALS[a.metal]) a.metal = DEFAULT_APPEARANCE.metal;
  if (!['metal', 'solid', 'gradient', 'plain'].includes(a.titleStyle)) a.titleStyle = 'metal';
  const hex = (v) => /^#[0-9a-f]{6}$/i.test(v || '');
  if (!Array.isArray(a.titleStops) || a.titleStops.length !== 3 || !a.titleStops.every(hex)) a.titleStops = [...DEFAULT_APPEARANCE.titleStops];
  if (!hex(a.titleColor)) a.titleColor = DEFAULT_APPEARANCE.titleColor;
  a.depth = Math.max(0, Math.min(100, Number.isFinite(+a.depth) ? +a.depth : DEFAULT_APPEARANCE.depth));
  if (!SCENES[a.scene]) a.scene = DEFAULT_APPEARANCE.scene;
  // the original RV page is the default again, once; the patterned scenes stay a choice
  if (!saved.nxRvBg) a.scene = 'rv';
  a.nxRvBg = 1;
  // the type: one family for text and titles; the old pairs go to theirs
  a.font = FONT_OF[a.font] || a.font;
  if (!RV_FONTS.includes(a.font)) a.font = 'sistem';
  if (!['glass', 'solid', 'gradient'].includes(a.chartBg)) a.chartBg = 'glass';
  if (!hex(a.chartColor2)) a.chartColor2 = DEFAULT_APPEARANCE.chartColor2;
  return a;
}

function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

function luminance(hex) {
  const [r, g, b] = hexRgb(hex).map((c) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const inkFor = (hex) => (luminance(hex) > 0.42 ? '#0b0c0e' : '#ffffff');

export function isLight(a) {
  if (a.bg === 'custom') return (luminance(a.custom.c1) + luminance(a.custom.c2)) / 2 > 0.45;
  return !!BACKGROUNDS[a.bg]?.light;
}

export function customBackground(c) {
  if (c.type === 'linear') return `linear-gradient(${c.angle}deg, ${c.c1}, ${c.c2} 55%, ${c.c3})`;
  if (c.type === 'radial') return `radial-gradient(120% 120% at 30% 0%, ${c.c2}, ${c.c1} 55%, ${c.c3} 120%)`;
  const [r2, g2, b2] = hexRgb(c.c2), [r3, g3, b3] = hexRgb(c.c3);
  return `radial-gradient(1100px 760px at 84% -12%, rgba(${r2},${g2},${b2},0.55), transparent 62%), `
    + `radial-gradient(1000px 720px at -8% 108%, rgba(${r3},${g3},${b3},0.55), transparent 62%), `
    + `linear-gradient(${c.angle}deg, ${c.c1}, ${c.c1})`;
}

/** One flat colour of the background, for pages that show candles: the base
 *  of its last linear layer (no glows), or the custom background's first colour. */
export function solidBackground(a) {
  if (a.bg === 'custom') return a.custom.c1;
  const css = (BACKGROUNDS[a.bg] || BACKGROUNDS.obsidian).css;
  const base = css.slice(css.lastIndexOf('linear-gradient('));
  return base.match(/#[0-9a-f]{3,8}\b/i)?.[0] || (BACKGROUNDS[a.bg]?.light ? '#f2f2f7' : '#000000');
}

export function backgroundCss(a) {
  return a.bg === 'custom' ? customBackground(a.custom) : (BACKGROUNDS[a.bg] || BACKGROUNDS.obsidian).css;
}

/** The chart options that come from the appearance. */
export function chartLook(a) {
  return { up: a.up, down: a.down, wick: a.wick, wickColor: a.wickColor, border: a.border, hollow: a.hollow,
    grid: a.grid, crosshair: a.crosshair, chartBg: a.chartBg, chartColor: a.chartColor, lastLine: a.lastLine,
    watermark: a.watermark, scale: a.scale, chartFont: a.chartFont,
    bodyUp: a.bodyUp, bodyDown: a.bodyDown, borderUp: a.borderUp, borderDown: a.borderDown, wickUp: a.wickUp, wickDown: a.wickDown,
    gridColor: a.gridColor, textColor: a.textColor, crossColor: a.crossColor, volOpacity: a.volOpacity, markOpacity: a.markOpacity };
}

/** The look this browser used last, painted before anything is loaded. */
export function paintLastLook(page = 'chart') {
  try {
    const last = JSON.parse(localStorage.getItem(LOCAL_NAMES.lastLook) || 'null');
    if (last) applyAppearance(last, undefined, { page });
  } catch { /* nothing saved */ }
}

/** Show a page that was hidden while booting. */
export function revealPage() {
  requestAnimationFrame(() => document.documentElement.classList.remove('booting'));
}

// The light behind the glass, one of a few scenes the user picks (Görünüm →
// Tema → Arka plan): sheets of dark silk, two lit waves, rings of light,
// ridges — each lit along its crests in the theme's colours (CSS variables,
// so a theme change repaints it as is) — or a plain page. `p` prefixes the
// SVG's ids, so a small preview can sit beside the real one.
const SILK = [
  ['M1700,-100 L860,-100 C1000,70 1150,170 1240,340 C1340,530 1300,720 1430,880 C1510,980 1610,1020 1700,1030 Z', 'a', '0 0 1 0', 'B'],
  ['M-100,-100 L720,-100 C580,40 400,130 210,160 C80,182 -20,240 -100,310 Z', 'c', '0 1 0 0', 'C'],
  ['M-100,1100 L-100,760 C100,700 260,560 430,520 C650,468 770,568 990,476 C1190,392 1310,210 1490,168 C1570,150 1640,172 1700,200 L1700,1100 Z', 'a', '0 0 0 1', 'A'],
  ['M-100,1100 L-100,990 C200,910 420,830 650,810 C910,788 1090,868 1310,826 C1470,796 1590,706 1700,646 L1700,1100 Z', 'b', '0 0 0 1', 'B'],
];
const RIDGES = [
  'M-100,1100 L-100,420 C180,360 420,470 700,410 C980,350 1220,250 1700,330 L1700,1100 Z',
  'M-100,1100 L-100,560 C260,500 520,610 820,560 C1120,510 1380,420 1700,470 L1700,1100 Z',
  'M-100,1100 L-100,700 C220,660 480,760 780,710 C1080,660 1360,600 1700,640 L1700,1100 Z',
  'M-100,1100 L-100,840 C300,800 560,880 860,850 C1160,820 1420,770 1700,800 L1700,1100 Z',
];
const defsCommon = (p) => `<filter id="${p}Glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="22"/></filter>
<filter id="${p}Halo" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
<linearGradient id="${p}rA" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:var(--o1);stop-opacity:.15"/><stop offset=".35" style="stop-color:var(--o3);stop-opacity:.95"/><stop offset=".62" style="stop-color:var(--crest);stop-opacity:1"/><stop offset="1" style="stop-color:var(--o1);stop-opacity:.25"/></linearGradient>
<linearGradient id="${p}rB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--o1);stop-opacity:.9"/><stop offset=".5" style="stop-color:var(--crest);stop-opacity:.85"/><stop offset="1" style="stop-color:var(--o2);stop-opacity:.2"/></linearGradient>
<linearGradient id="${p}rC" x1="1" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--o3);stop-opacity:.7"/><stop offset="1" style="stop-color:var(--o1);stop-opacity:.1"/></linearGradient>`;
/** A lit sheet: its fill, a glow falling inside from the crest, a halo and a crisp rim. */
const sheetOf = (p, i, d, glow, dir, rim) => {
  const [x1, y1, x2, y2] = dir.split(' ');
  return `<linearGradient id="${p}f${i}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" style="stop-color:var(--silk-hi)"/><stop offset=".55" style="stop-color:var(--silk-lo)"/></linearGradient><clipPath id="${p}c${i}"><path d="${d}"/></clipPath>
<g class="silk"><path d="${d}" fill="url(#${p}f${i})"/><path d="${d}" fill="none" class="glow g${glow}" stroke-width="70" clip-path="url(#${p}c${i})" filter="url(#${p}Glow)"/><path d="${d}" fill="none" stroke="url(#${p}r${rim})" stroke-width="5" opacity=".55" filter="url(#${p}Halo)"/><path d="${d}" fill="none" stroke="url(#${p}r${rim})" stroke-width="1.4"/></g>`;
};
const CREST_A = 'M-60,640 C200,590 350,380 620,340 C900,300 1080,480 1300,430 C1460,394 1550,300 1660,250';
const CREST_B = 'M-60,930 C280,880 520,700 820,720 C1100,740 1270,600 1660,560';
const wave = (p, crest, fill, rim) => `<path d="${crest} L1660,1060 L-60,1060 Z" style="fill:var(${fill})" fill-opacity=".22"/><path d="${crest}" fill="none" stroke="url(#${p}r${rim})" stroke-width="9" opacity=".5" filter="url(#${p}Halo)"/><path d="${crest}" fill="none" stroke="url(#${p}r${rim})" stroke-width="1.6"/>`;
const ring = (p, r, k) => `<circle cx="1380" cy="1080" r="${r}" fill="url(#${p}rf${k})"/><circle cx="1380" cy="1080" r="${r}" fill="none" class="glow g${'abc'[k % 3]}" stroke-width="60" clip-path="url(#${p}rc${k})" filter="url(#${p}Glow)"/><circle cx="1380" cy="1080" r="${r}" fill="none" stroke="url(#${p}rA)" stroke-width="5" opacity=".5" filter="url(#${p}Halo)"/><circle cx="1380" cy="1080" r="${r}" fill="none" stroke="url(#${p}rA)" stroke-width="1.4"/>`;

export const SCENES = {
  // the original RV page: the accent's light from two corners and three slow
  // soft lights of the accent and the candle colours (drawn by CSS)
  rv: { name: 'RV', html: '<div class="rv-nebula"><i></i><i></i><i></i></div>' },
  ipek: { name: 'İpek', svg: (p) => SILK.map(([d, g, dir, rim], i) => sheetOf(p, i, d, g, dir, rim)).join('') },
  dalga: { name: 'Dalga', svg: (p) => wave(p, CREST_A, '--o1', 'A') + wave(p, CREST_B, '--o2', 'B') },
  halka: { name: 'Halka', svg: (p) => [980, 760, 540].map((r, k) => `<radialGradient id="${p}rf${k}" cx="1380" cy="1080" r="${r}" gradientUnits="userSpaceOnUse"><stop offset=".55" style="stop-color:var(--silk-lo)"/><stop offset="1" style="stop-color:var(--silk-hi)"/></radialGradient><clipPath id="${p}rc${k}"><circle cx="1380" cy="1080" r="${r}"/></clipPath>${ring(p, r, k)}`).join('') },
  sirt: { name: 'Sırt', svg: (p) => RIDGES.map((d, i) => sheetOf(p, i, d, 'abca'[i], '0 0 0 1', 'AB'[i % 2])).join('') },
  duz: { name: 'Düz', svg: null },
};
export const sceneSvg = (id, p = 'a') => {
  const s = SCENES[id] || SCENES.rv;
  if (s.html) return s.html;
  return s.svg ? `<svg class="waves" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>${defsCommon(p)}</defs>${s.svg(p)}</svg>` : '';
};

/** Paint the page: CSS variables and data attributes on <html>. */
export function applyAppearance(input, root = document.documentElement, { page = 'chart' } = {}) {
  const a = normalizeAppearance(input);
  // the home screen can have its own accent and profit / loss colours
  const accent = page === 'home' && a.homeAccent ? a.homeAccent : a.accent;
  const up = page === 'home' && a.homeUp ? a.homeUp : a.up;
  const down = page === 'home' && a.homeDown ? a.homeDown : a.down;
  const light = isLight(a);
  const f = FONT_PAIRS[a.font];
  const set = (k, v) => root.style.setProperty(k, String(v));
  Object.assign(root.dataset, {
    rvTheme: RV_THEMES.includes(a.preset) ? a.preset : 'onyx',
    theme: light ? 'light' : 'dark', style: a.style, motion: a.motion ? 'on' : 'off',
    pointer: a.pointerLight ? 'on' : 'off', font: a.font, texture: a.texture || 'none', design: a.design === 'classic' ? 'classic' : 'studio',
  });
  set('--page-bg', backgroundCss(a));
  // the metal: logo, RV name, and the headings when they are written in it
  const metal = METALS[a.metal] || METALS.silver;
  metal.stops.forEach((c, i) => set(`--m${i + 1}`, light ? shade(c, 0.62) : c));
  set('--metal-angle', `${metal.angle ?? 135}deg`);
  const [t1, t2, t3] = a.titleStops;
  set('--title-fill', a.titleStyle === 'gradient' ? `linear-gradient(${a.titleAngle}deg, ${t1}, ${t2} 50%, ${t3})` : 'var(--metal)');
  set('--title-color', a.titleColor);
  set('--shine-dur', `${(14 - 10 * (a.titleShine || 0)).toFixed(1)}s`);
  Object.assign(root.dataset, { title: a.titleStyle, shine: a.titleShine > 0 ? 'on' : 'off', rim: a.cardRim === 'metal' ? 'metal' : 'soft' });
  set('--page-solid', solidBackground(a));
  // RV Next: the theme's lights, its depth, the type and the chart's ground
  const rv = PRESETS.find((x) => x.id === a.preset) || PRESETS[0];
  rv.orbs.forEach((c, i) => set(`--o${i + 1}`, c));
  set('--bg-base', rv.base);
  set('--depth', (a.depth / 100).toFixed(2));
  set('--rv-sans', `${f.ui}, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif`);
  set('--rv-display', `${f.display}, ${f.ui}, 'Inter', -apple-system, system-ui, sans-serif`);
  const opt = (k, v) => (v ? set(k, v) : root.style.removeProperty(k));
  opt('--pos', a.pos);
  opt('--neg', a.neg);
  opt('--chart-bg', a.chartBg === 'gradient' ? `linear-gradient(180deg, ${a.chartColor}, ${a.chartColor2})` : a.chartBg === 'solid' ? a.chartColor : null);
  // the studio design's light orbs live in one fixed layer behind everything
  if (document.body) {
    let amb = document.body.querySelector(':scope > .ambient');
    if (!amb) { amb = h('div.ambient', { 'aria-hidden': 'true' }); document.body.prepend(amb); }
    // the chart keeps a plain page; the app pages show the chosen scene
    const scene = page === 'chart' ? 'duz' : a.scene;
    if (amb.dataset.scene !== scene) { amb.innerHTML = sceneSvg(scene); amb.dataset.scene = scene; }
  }
  set('--accent', accent);
  set('--accent-ink', inkFor(accent));
  set('--up', up);
  set('--down', down);
  set('--up-ink', inkFor(up));
  set('--down-ink', inkFor(down));
  set('--glass', a.glass);
  set('--blur', `${a.blur}px`);
  set('--sheen', a.sheen);
  set('--grain', a.grain);
  set('--texture', (TEXTURES[a.texture] || TEXTURES.none)(light ? 'rgba(0,0,0,0.045)' : 'rgba(255,255,255,0.032)'));
  // brutal is hard-edged whatever the corner setting says
  const [r, rs, rc] = a.style === 'brutal' ? RADII.sharp : (RADII[a.radius] || RADII.round);
  set('--radius', `${r}px`);
  set('--radius-sm', `${rs}px`);
  set('--radius-ctl', `${rc}px`);
  set('--d', DENSITY[a.density] || 1);
  set('--display', `${f.display}, 'Schibsted Grotesk', system-ui, sans-serif`);
  set('--font', `${f.ui}, system-ui, -apple-system, 'Segoe UI', sans-serif`);
  set('--mono', `${f.mono}, ui-monospace, Menlo, Consolas, monospace`);
  set('--d-weight', f.dWeight);
  set('--d-track', f.dTrack);
  set('--d-case', f.dCase);
  set('--d-stretch', f.dStretch);
  set('--d-settings', f.dSettings);
  set('--mono-stretch', f.monoStretch);
  set('--ui-size', `calc(${f.uiSize} * ${TEXT[a.textSize] || 1})`);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', page === 'chart' ? solidBackground(a) : light ? '#f2f2f7' : '#000000');
  return { theme: light ? 'light' : 'dark', look: chartLook(a), appearance: a };
}

// ── the "Görünüm" section of the settings dialog ────────────────────────────
const SECTIONS = [['theme', 'Tema'], ['colors', 'Renkler'], ['glass', 'Cam ve ışık'], ['type', 'Yazı'], ['chart', 'Grafik']];

/** `onChange` previews live; `value()` returns the edited copy. */
/** The metal and heading controls, shared by the look dialog and the home
 *  screen's customise sheet. `emit(rerender)` saves and repaints. */
export function metalControls(a, emit) {
  return [...metalPicker(a, emit), ...titleControls(a, emit), ...rimControls(a, emit)];
}

export function metalPicker(a, emit) {
  return [
    h('h4', {}, 'Metal'),
    h('p.look-lead', {}, 'Yıldız logo ve RV yazısı bu metalle çizilir; başlıklar da istersen.'),
    h('div.metal-row', {}, Object.entries(METALS).map(([id, m]) => h(`button.metal-chip${a.metal === id ? '.on' : ''}`, {
      type: 'button', title: m.name, 'aria-label': m.name, onclick: () => { a.metal = id; emit(); },
    }, h('span.metal-swatch', { style: { background: metalCss(id) } }), h('span.metal-name', {}, m.name)))),
  ];
}

export function rimControls(a, emit) {
  return [
    h('h4', {}, 'Kart kenarı'),
    h('div.seg', {}, [['soft', 'Yumuşak'], ['metal', 'Metal']].map(([v, l]) => h(`button${a.cardRim === v ? '.on' : ''}`, { type: 'button', onclick: () => { a.cardRim = v; emit(); } }, l))),
  ];
}

export function titleControls(a, emit) {
  const fill = (el) => el.style.setProperty('--p', `${((el.value - el.min) / (el.max - el.min)) * 100}%`);
  const range = (min, max, step, value, onInput) => {
    const el = h('input', { type: 'range', min, max, step, value, oninput: (e) => { fill(e.target); onInput(Number(e.target.value)); } });
    fill(el);
    return el;
  };
  const styles = h('div.seg', {}, [['metal', 'Metal'], ['gradient', 'Geçiş'], ['solid', 'Düz renk'], ['plain', 'Sade']].map(([v, l]) =>
    h(`button${a.titleStyle === v ? '.on' : ''}`, { type: 'button', onclick: () => { a.titleStyle = v; emit(); } }, l)));
  const picker = (value, onInput, title) => h('input.color', { type: 'color', value, title, oninput: (e) => { onInput(e.target.value); emit(false); }, onchange: () => emit() });
  const more = [];
  if (a.titleStyle === 'solid') {
    more.push(h('div.inline-row', {}, h('span.muted', {}, 'Yazı rengi'), picker(a.titleColor, (v) => { a.titleColor = v; }, 'Yazı rengi'),
      ...['#ffffff', '#e6e9ff', '#9fa8ff', '#c6ff3d', '#ff8fab', '#f6c453'].map((c) => h(`button.swatch.round${a.titleColor === c ? '.on' : ''}`, { type: 'button', title: c, style: { background: c }, onclick: () => { a.titleColor = c; emit(); } }))));
  }
  if (a.titleStyle === 'gradient') {
    more.push(
      h('div.grad-preview', { style: { background: `linear-gradient(90deg, ${a.titleStops[0]}, ${a.titleStops[1]} 50%, ${a.titleStops[2]})` } }),
      h('div.inline-row', {}, ...a.titleStops.flatMap((c, i) => [h('span.muted', {}, ['Baş', 'Orta', 'Son'][i]), picker(c, (v) => { a.titleStops[i] = v; }, `${i + 1}. renk`)])),
      h('div.slider', {}, h('span.slider-label', {}, 'Açı'), h('span.slider-val', {}, `${a.titleAngle}°`),
        range(0, 360, 5, a.titleAngle, (v) => { a.titleAngle = v; emit(false); })));
  }
  if (a.titleStyle !== 'solid' && a.titleStyle !== 'plain') {
    more.push(h('div.slider', {}, h('span.slider-label', {}, 'Işıltı hareketi'), h('span.slider-val', {}, a.titleShine > 0 ? `%${Math.round(a.titleShine * 100)}` : 'kapalı'),
      range(0, 1, 0.05, a.titleShine, (v) => { a.titleShine = v; emit(false); }), h('div.ends', {}, h('span', {}, 'Kapalı'), h('span', {}, 'Hızlı'))));
  }
  return [
    h('h4', {}, 'Başlık yazısı'),
    styles,
    h('div.title-preview', {}, h('span', {}, 'İyi günler')),
    ...more,
  ];
}

export function appearanceSection(initial, onChange, { section = 'theme' } = {}) {
  const a = normalizeAppearance(initial);
  let tab = section;
  const box = h('div.look', {});
  const emit = (rerender = true) => { onChange(structuredClone(a)); if (rerender) render(); };
  const unpreset = () => { a.preset = null; };

  const seg = (options, key, after) => h('div.seg', {}, options.map(([v, label]) => h(`button${a[key] === v ? '.on' : ''}`, {
    type: 'button', onclick: () => { a[key] = v; after?.(); emit(); },
  }, label)));
  const toggle = (key, label, hint) => h('label.switch', {},
    h('input', { type: 'checkbox', checked: !!a[key], onchange: (e) => { a[key] = e.target.checked; emit(); } }),
    h('span.track', {}, h('span.knob')), h('span.switch-label', {}, label, hint ? h('small', {}, hint) : null));
  const fill = (el) => el.style.setProperty('--p', `${((el.value - el.min) / (el.max - el.min)) * 100}%`);
  const range = (attrs, onInput) => {
    const el = h('input', { type: 'range', ...attrs, oninput: (e) => { fill(e.target); onInput(e); } });
    fill(el);
    return el;
  };
  const slider = (key, min, max, step, label, fmt, ends) => {
    const out = h('span.slider-val', {}, fmt(a[key]));
    return h('div.slider', {}, h('span.slider-label', {}, label), out,
      range({ min, max, step, value: a[key] }, (e) => { a[key] = Number(e.target.value); out.textContent = fmt(a[key]); emit(false); }),
      ends ? h('div.ends', {}, h('span', {}, ends[0]), h('span', {}, ends[1])) : null);
  };
  const color = (get, set, title) => h('input.color', { type: 'color', value: get(), title,
    oninput: (e) => { set(e.target.value); unpreset(); emit(false); }, onchange: () => render() });
  // a colour that can also be "automatic" (null)
  const optColor = (key, label, fallback) => [
    h('span.muted', {}, label),
    h('input.color', { type: 'color', value: a[key] || fallback(), title: label, oninput: (e) => { a[key] = e.target.value; unpreset(); emit(false); }, onchange: () => render() }),
    a[key] ? h('button.btn.small.outline', { type: 'button', title: `${label}: otomatik`, onclick: () => { a[key] = null; emit(); } }, 'Oto') : h('span.auto-tag', {}, 'oto'),
  ];
  const swatch = (css, on, title, onclick, cls = '') => h(`button.swatch${on ? '.on' : ''}${cls}`, { type: 'button', title, 'aria-label': title, onclick, style: { background: css } });
  const mini = (p) => h(`span.preset-bg${BACKGROUNDS[p.bg].light ? '.light' : ''}`, { style: { background: BACKGROUNDS[p.bg].css } },
    h('span.preset-glass', {},
      h('span.preset-candles', {}, ...[1, 0, 1, 1, 0, 1].map((up, i) => h('i', { style: { background: up ? p.up : p.down, height: `${[12, 8, 16, 11, 7, 14][i]}px` } })))),
    h('span.preset-dot', { style: { background: p.accent } }));

  const panes = {
    theme: () => [
      field('Tasarım', seg([['studio', 'Stüdyo'], ['classic', 'Klasik']], 'design'), 'Stüdyo: arka plan ışıkları, akıcı geçişler, parlayan panolar · Klasik: önceki sade tasarım'),
      h('p.look-lead', {}, 'Hazır görünümler arka planı, vurgu rengini, mumları ve yazı tipini birlikte ayarlar. Sonra her birini ayrı ayrı değiştirebilirsin.'),
      h('div.preset-row', {}, PRESETS.map((p) => h(`button.preset${a.preset === p.id ? '.on' : ''}`, {
        type: 'button', onclick: () => { Object.assign(a, { preset: p.id, bg: p.bg, accent: p.accent, up: p.up, down: p.down, font: p.font, bodyUp: null, bodyDown: null, borderUp: null, borderDown: null, wickUp: null, wickDown: null }); emit(); },
      }, mini(p), h('span.preset-name', {}, p.name), h('span.preset-sub', {}, FONT_PAIRS[p.font].name)))),
      h('div.look-actions', {}, h('button.btn.small.outline', { type: 'button', onclick: () => { Object.assign(a, structuredClone(DEFAULT_APPEARANCE)); emit(); } }, icon('refresh', 14), 'Varsayılana dön')),
    ],
    colors: () => [
      ...metalControls(a, emit),
      h('h4', {}, 'Sayfa arka planı'),
      h('div.swatch-row', {}, Object.entries(BACKGROUNDS).filter(([k]) => k !== 'custom').map(([k, b]) =>
        swatch(b.css, a.bg === k, b.name, () => { a.bg = k; unpreset(); emit(); }, '.wide')),
      swatch(customBackground(a.custom), a.bg === 'custom', 'Özel', () => { a.bg = 'custom'; unpreset(); emit(); }, '.wide.custom')),
      a.bg === 'custom' ? h('div.custom-bg', {},
        h('div.seg', {}, [['mesh', 'Işık lekeleri'], ['linear', 'Doğrusal'], ['radial', 'Dairesel']].map(([v, l]) => h(`button${a.custom.type === v ? '.on' : ''}`, { type: 'button', onclick: () => { a.custom.type = v; emit(); } }, l))),
        h('div.inline-row', {},
          h('span.muted', {}, 'Zemin'), color(() => a.custom.c1, (v) => { a.custom.c1 = v; }, 'Zemin rengi'),
          h('span.muted', {}, 'Işık 1'), color(() => a.custom.c2, (v) => { a.custom.c2 = v; }, 'Birinci ışık'),
          h('span.muted', {}, 'Işık 2'), color(() => a.custom.c3, (v) => { a.custom.c3 = v; }, 'İkinci ışık')),
        h('div.slider', {}, h('span.slider-label', {}, 'Açı'), h('span.slider-val', {}, `${a.custom.angle}°`),
          range({ min: 0, max: 360, step: 5, value: a.custom.angle }, (e) => { a.custom.angle = Number(e.target.value); e.target.previousSibling.textContent = `${a.custom.angle}°`; emit(false); }))) : null,
      h('h4', {}, 'Vurgu rengi'),
      h('div.accent-groups', {}, ACCENT_GROUPS.map((g, i) => h('div.accent-group', {}, h('span', {}, g.name),
        h('div.swatch-row', {}, g.colors.map((c) => swatch(c, a.accent === c, c, () => { a.accent = c; unpreset(); emit(); }, '.round')),
          i === ACCENT_GROUPS.length - 1 ? color(() => a.accent, (v) => { a.accent = v; }, 'Özel vurgu rengi') : null)))),
      h('h4', {}, 'Ana ekran renkleri'),
      h('p.look-lead', {}, 'Ana ekrandaki vurgu ve kâr / zarar renkleri. Boş bırakılan grafiktekiyle aynı olur.'),
      h('div.inline-row', {},
        ...optColor('homeAccent', 'Vurgu', () => a.accent),
        ...optColor('homeUp', 'Kâr', () => a.up),
        ...optColor('homeDown', 'Zarar', () => a.down)),
      h('h4', {}, 'Mum renkleri'),
      h('div.candle-sets', {}, CANDLE_SETS.map((c) => h(`button.candle-set${a.up === c.up && a.down === c.down ? '.on' : ''}${c.light ? '.on-light' : ''}`, {
        type: 'button', title: c.name, 'aria-label': c.name, onclick: () => { Object.assign(a, { up: c.up, down: c.down, bodyUp: null, bodyDown: null, borderUp: null, borderDown: null, wickUp: null, wickDown: null }); unpreset(); emit(); },
      }, h('i', { style: { background: c.up } }), h('i', { style: { background: c.down } }), h('i', { style: { background: c.up } })))),
      h('div.inline-row', {},
        h('span.muted', {}, 'Yükselen'), color(() => a.up, (v) => { a.up = v; }, 'Yükselen mum'),
        h('span.muted', {}, 'Düşen'), color(() => a.down, (v) => { a.down = v; }, 'Düşen mum')),
      h('div.row2', {},
        field('Gövde', seg([['solid', 'Dolu'], ['hollow', 'Yükselen boş']], 'hollowMode', () => { a.hollow = a.hollowMode === 'hollow'; })),
        field('Fitil', seg([['match', 'Gövde renginde'], ['neutral', 'Nötr'], ['custom', 'Özel']], 'wick'))),
      a.wick === 'custom' ? h('div.inline-row', {}, h('span.muted', {}, 'Fitil rengi'), color(() => a.wickColor || '#9aa0aa', (v) => { a.wickColor = v; }, 'Fitil rengi')) : null,
      toggle('border', 'Mum kenarlığı'),
      h('h4', {}, 'Mum parçaları'),
      h('p.look-lead', {}, 'Gövde, kenarlık ve fitil için ayrı renkler (TradingView gibi). Oto: yükselen / düşen rengi.'),
      h('div.candle-parts', {},
        h('span'), h('span.muted', {}, 'Yükselen'), h('span.muted', {}, 'Düşen'),
        ...[['Gövde', 'body'], ['Kenarlık', 'border'], ['Fitil', 'wick']].flatMap(([label, k]) => [
          h('span', {}, label),
          h('div.inline-row', {}, ...optColor(`${k}Up`, `${label} yükselen`, () => a.up).slice(1)),
          h('div.inline-row', {}, ...optColor(`${k}Down`, `${label} düşen`, () => a.down).slice(1)),
        ])),
    ],
    glass: () => [
      field('Stil', seg([['glass', 'Cam'], ['brutal', 'Brütal']], 'style'), 'Brütal: keskin kenarlar, sert gölgeli düğmeler'),
      slider('glass', 0.2, 0.95, 0.01, 'Cam', (v) => `%${Math.round(v * 100)}`, ['Daha şeffaf', 'Daha koyu']),
      slider('blur', 0, 48, 1, 'Buzlanma', (v) => `${v}px`),
      slider('sheen', 0, 1, 0.05, 'Kenar parlaması', (v) => `%${Math.round(v * 100)}`),
      field('Cam arkası doku', seg([['grid', 'Izgara'], ['lines', 'Çizgi'], ['dots', 'Nokta'], ['none', 'Yok']], 'texture'), 'Paneller arasında keskin, camın arkasında buzlu görünür'),
      slider('grain', 0, 0.12, 0.005, 'Gren', (v) => `%${Math.round(v * 1000) / 10}`),
      toggle('pointerLight', 'İmleci izleyen ışık', 'Fare yaklaştıkça panel kenarları parlar'),
      toggle('motion', 'Hareketli arka plan ışığı', 'Işık lekeleri yavaşça kayar (pil ve işlemci kullanır)'),
      h('div.row2', {},
        field('Köşeler', seg([['sharp', 'Keskin'], ['soft', 'Yumuşak'], ['round', 'Yuvarlak']], 'radius'), a.style === 'brutal' ? 'Brütal stilde köşeler hep keskin' : 'Yuvarlak: hap biçimli düğmeler'),
        field('Yerleşim', seg([['compact', 'Sıkı'], ['normal', 'Normal'], ['airy', 'Ferah']], 'density'))),
    ],
    type: () => [
      h('div.font-row', {}, Object.entries(FONT_PAIRS).map(([id, f]) => h(`button.font-card${a.font === id ? '.on' : ''}`, {
        type: 'button', onclick: () => { a.font = id; unpreset(); emit(); },
      },
      h('span.font-sample', { style: { fontFamily: f.display, fontWeight: f.dWeight, letterSpacing: f.dTrack, textTransform: f.dCase, fontStretch: f.dStretch, fontVariationSettings: f.dSettings } }, 'Replay'),
      h('span.font-num', { style: { fontFamily: f.mono, fontStretch: f.monoStretch } }, '1.10256'),
      h('span.font-name', { style: { fontFamily: f.ui } }, f.name),
      h('span.font-note', {}, f.note)))),
      field('Yazı boyutu', seg([['small', 'Küçük'], ['normal', 'Normal'], ['large', 'Büyük']], 'textSize')),
    ],
    chart: () => [
      h('div.row2', {},
        field('Grafik zemini', seg([['glass', 'Cam'], ['solid', 'Düz renk']], 'chartBg')),
        a.chartBg === 'solid' ? field('Zemin rengi', color(() => a.chartColor, (v) => { a.chartColor = v; }, 'Grafik zemini')) : h('span')),
      h('div.row2', {},
        field('Izgara', seg([['both', 'Tam'], ['horz', 'Yatay'], ['none', 'Yok']], 'grid')),
        field('Artı imleci', seg([['dotted', 'Noktalı'], ['dashed', 'Kesikli'], ['solid', 'Düz']], 'crosshair'))),
      h('div.row2', {},
        field('Fiyat ölçeği', seg([['normal', 'Normal'], ['log', 'Logaritmik'], ['percent', 'Yüzde']], 'scale')),
        field('Eksen yazısı', seg([[10, '10'], [11, '11'], [12, '12'], [13, '13']], 'chartFont'))),
      h('h4', {}, 'Renkler (temadan bağımsız)'),
      h('div.inline-row', {},
        ...optColor('gridColor', 'Izgara', () => (isLight(a) ? '#e2e2e2' : '#1c1d22')),
        ...optColor('textColor', 'Eksen yazısı', () => (isLight(a) ? '#2a2a2a' : '#a1a1aa')),
        ...optColor('crossColor', 'Artı imleci', () => (isLight(a) ? '#6b6b6b' : '#8a8a90'))),
      slider('volOpacity', 0, 70, 1, 'Hacim çubukları', (v) => (v ? `%${v}` : 'gizli')),
      slider('markOpacity', 0, 20, 1, 'Filigran görünürlüğü', (v) => `%${v}`),
      toggle('lastLine', 'Son fiyat çizgisi'),
      toggle('watermark', 'Arka planda sembol filigranı'),
    ],
  };

  const render = () => {
    a.hollowMode = a.hollow ? 'hollow' : 'solid';
    const nav = h('div.look-nav', { role: 'tablist' }, SECTIONS.map(([id, label]) => h(`button${tab === id ? '.on' : ''}`, { type: 'button', role: 'tab', onclick: () => { tab = id; render(); } }, label)));
    box.replaceChildren(nav, h('div.look-pane', {}, ...panes[tab]().flat().filter(Boolean)));
  };
  render();
  return { el: box, value: () => { const v = structuredClone(a); delete v.hollowMode; return v; } };
}
