/**
 * Design tokens: the single source of truth for colour, type and shape.
 *
 * Rules (docs/DESIGN.md):
 * - Domain colours mean physics (wires, ports, chips, traces): electrical, thermal, hydraulic, mechanical.
 * - State colours mean status (ok/run, warning, fault, selection) and are never reused for domains.
 * - Everything else is neutral chrome. The stage is the lightest large surface.
 *
 * `src/theme/tokens.css` is generated from this file (`npm run tokens`; a unit test fails when it is
 * stale). It holds every token as a CSS custom property (`--n-2`, `--electrical`, …) plus an RGB
 * triplet (`--electrical-rgb`) so stylesheets can write `rgb(var(--electrical-rgb) / 0.2)`.
 * SVG presentation attributes cannot use var(), so components import `T` directly.
 */
export const neutral = {
  0: "#0B0E12", // deepest wells (inputs, chart backgrounds)
  1: "#0E1116", // app background
  2: "#10141A", // top bar, rails, floating chrome
  3: "#12161D", // panels
  4: "#161B23", // cards on panels
  5: "#181E27", // stage
  6: "#1D2530", // raised controls
  7: "#222A35", // dividers
  8: "#263040", // active control, track
  9: "#2C3644", // borders
  10: "#3A4656", // strong borders
  11: "#5B6879", // disabled
  12: "#8794A6", // faint text (≥ 4.5:1 on panels)
  13: "#9AA6B6", // muted text
  14: "#C4CDD8", // secondary text
  15: "#E8ECF2", // primary text
  16: "#FFFFFF",
} as const;

/** Each colour family: base (wires, traces), text (readable on dark), dim (tinted fill), deep (dark fill). */
const family = (base: string, text: string, dim: string, deep: string) => ({ base, text, dim, deep });
export const domain = {
  electrical: family("#F5B83D", "#F7CB6E", "#4A3A1C", "#241D10"),
  thermal: family("#F2785C", "#F59B85", "#4A2A22", "#231512"),
  hydraulic: family("#4DA8F5", "#8CC6F8", "#1E3A52", "#101D29"),
  mechanical: family("#A98BFA", "#C4B0FC", "#352C52", "#1A1629"),
} as const;
export const state = {
  ok: family("#36D399", "#7BE7BD", "#1B4535", "#0F231B"),
  warning: family("#FFB020", "#FFC95C", "#4D3A12", "#261D09"),
  fault: family("#F2545B", "#F7868B", "#4D2125", "#261113"),
  selection: family("#E8ECF2", "#FFFFFF", "#3A4656", "#1D2530"),
} as const;
/** Text on a filled ok/run button. */
export const onAccent = "#06210F";

export const font = {
  sans: '"IBM Plex Sans", system-ui, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
} as const;
/** Type scale in px. Nothing user-facing below `xs`. */
export const size = { xs: 12, sm: 13, md: 14, lg: 16, xl: 18, xxl: 24, hero: 40 } as const;
export const radius = { sm: 6, md: 9, lg: 12, pill: 999 } as const;

/** Flat lookup for components and SVG: T.electrical, T.n5, T.okText … */
export const T = {
  ...Object.fromEntries(Object.entries(neutral).map(([k, v]) => [`n${k}`, v])),
  ...Object.fromEntries([...Object.entries(domain), ...Object.entries(state)].flatMap(([name, f]) => [
    [name, f.base], [`${name}Text`, f.text], [`${name}Dim`, f.dim], [`${name}Deep`, f.deep],
  ])),
  onAccent,
} as Record<string, string>;

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ");
export function cssVariables(): Record<string, string> {
  const vars: Record<string, string> = {};
  const put = (name: string, value: string) => { vars[`--${name}`] = value; vars[`--${name}-rgb`] = rgb(value); };
  for (const [k, v] of Object.entries(neutral)) put(`n-${k}`, v);
  for (const [name, f] of [...Object.entries(domain), ...Object.entries(state)]) {
    put(name, f.base); put(`${name}-text`, f.text); put(`${name}-dim`, f.dim); put(`${name}-deep`, f.deep);
  }
  put("on-accent", onAccent);
  vars["--sans"] = font.sans;
  vars["--mono"] = font.mono;
  for (const [k, v] of Object.entries(size)) vars[`--fs-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(radius)) vars[`--r-${k}`] = `${v}px`;
  return vars;
}
