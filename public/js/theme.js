/**
 * Theming — light/dark presets with a user-customisable 5-colour palette.
 *
 * Defaults (as requested):
 *   light: #0081a7 #00afb9 #fdfcdc #fed9b7 #f07167
 *   dark : #0b132b #1c2541 #3a506b #5bc0be #6fffe9
 *
 * Each mode's palette maps to five named "slots"; the full set of CSS variables
 * used across the app is derived from them. The chosen theme is persisted, and
 * the computed variables are also cached so an inline <head> script can apply
 * them before first paint (no flash). See index.html.
 */
const KEY = 'scivox_theme';
const VARS_KEY = 'scivox_theme_vars';

export const DEFAULTS = {
  light: ['#0081a7', '#00afb9', '#fdfcdc', '#fed9b7', '#f07167'],
  dark:  ['#0b132b', '#1c2541', '#3a506b', '#5bc0be', '#6fffe9']
};
export const SLOTS = {
  light: ['Primary', 'Accent', 'Background', 'Warm', 'Alert'],
  dark:  ['Background', 'Surface', 'Border', 'Primary', 'Accent']
};

/* ---- colour helpers ---- */
const hex2rgb = h => { const n = parseInt(h.replace('#', ''), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const rgb2hex = ([r, g, b]) => '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A.map((v, i) => v + (B[i] - v) * t)); };
const lighten = (h, t) => mix(h, '#ffffff', t);
const darken = (h, t) => mix(h, '#000000', t);
const rgba = (h, a) => { const [r, g, b] = hex2rgb(h); return `rgba(${r},${g},${b},${a})`; };

/* ---- build the full CSS variable set from a 5-colour palette ---- */
export function buildVars(mode, p) {
  if (mode === 'dark') {
    const [bg, surface, border, primary, accent] = p;
    return {
      '--bg': bg, '--panel': surface, '--panel2': mix(surface, border, 0.4), '--line': border,
      '--ink': '#e8f6f4', '--muted': lighten(border, 0.35),
      '--accent': primary, '--accent2': accent, '--lock': primary,
      '--danger': '#f07167', '--warn': '#f0b45f',
      '--chip': mix(surface, border, 0.55), '--chip-ink': lighten(border, 0.5),
      '--header-bg': rgba(bg, 0.85), '--shadow': '0 8px 28px rgba(0,0,0,.45)'
    };
  }
  // light
  const [primary, accent, bg, warm, alert] = p;
  return {
    '--bg': bg, '--panel': '#ffffff', '--panel2': mix(bg, '#ffffff', 0.5), '--line': darken(bg, 0.12),
    '--ink': darken(primary, 0.45), '--muted': mix(primary, '#7a8b8f', 0.5),
    '--accent': primary, '--accent2': accent, '--lock': darken(accent, 0.08),
    '--danger': alert, '--warn': darken(warm, 0.32),
    '--chip': lighten(accent, 0.82), '--chip-ink': darken(accent, 0.28),
    '--header-bg': rgba(bg, 0.85), '--shadow': '0 8px 24px rgba(20,40,60,.10)'
  };
}

/* ---- persistence ---- */
export function getConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY));
    if (c && c.mode && c.palettes) return c;
  } catch {}
  return { mode: 'dark', palettes: { light: [...DEFAULTS.light], dark: [...DEFAULTS.dark] } };
}
export function saveConfig(cfg) { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {} }

export function applyTheme(cfg = getConfig()) {
  const vars = buildVars(cfg.mode, cfg.palettes[cfg.mode]);
  const root = document.documentElement;
  for (const k in vars) root.style.setProperty(k, vars[k]);
  root.dataset.mode = cfg.mode;
  try { localStorage.setItem(VARS_KEY, JSON.stringify(vars)); } catch {}
  return vars;
}

export function initTheme() { applyTheme(); }
export function setMode(mode) { const c = getConfig(); c.mode = mode; saveConfig(c); applyTheme(c); return c; }
export function toggleMode() { const c = getConfig(); return setMode(c.mode === 'dark' ? 'light' : 'dark'); }
export function setPaletteColor(mode, index, value) { const c = getConfig(); c.palettes[mode][index] = value; saveConfig(c); applyTheme(c); return c; }
export function resetPalette(mode) { const c = getConfig(); c.palettes[mode] = [...DEFAULTS[mode]]; saveConfig(c); applyTheme(c); return c; }
