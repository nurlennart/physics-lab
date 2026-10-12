# Design system

The interface is an instrument panel: **colour means physics, grey means chrome.**

## Tokens

`src/theme/tokens.ts` is the single source of truth. `src/theme/tokens.css` is generated from it (`npm run tokens`); a unit test fails when the two differ.

- **CSS:** every token is a custom property, plus an RGB triplet for transparency: `color: var(--n-14)`, `background: rgb(var(--hydraulic-rgb) / 0.15)`.
- **SVG and inline styles:** presentation attributes cannot use `var()`, so components use `T` (`fill={T.n4}`, `stroke={T.hydraulic}`).
- Never add a hex colour in a stylesheet or component. Physics data that carries its own colour (probe traces, materials) is exempt.

### Colour roles

| Group | Tokens | Use |
| --- | --- | --- |
| Neutral ramp | `n-0` … `n-16` | Chrome: 1 app background, 3 panels, 4 cards, **5 stage (lightest large surface)**, 7 dividers, 9 borders, 12–15 text from faint to primary |
| Domains | `electrical`, `thermal`, `hydraulic`, `mechanical` | Wires, ports, chips, chart traces, domain icons. Only ever for physics |
| State | `ok`, `warning`, `fault`, `selection` | Run/healthy, tolerated over-rating, trip/failure, selection outline. Never for domains |

Each colour family has four steps: base (`--hydraulic`, lines and fills), `-text` (readable on dark), `-dim` (tinted fill), `-deep` (dark fill).

### Type

- IBM Plex Sans for words, IBM Plex Mono **only** for numbers, units in readouts and component IDs.
- Scale `--fs-xs` 12 … `--fs-hero` 40 px. Nothing user-facing below 12 px.
- No uppercase letter-spaced labels for body content; section titles are sentence case.

### Shape

Radii `--r-sm` 6, `--r-md` 9, `--r-lg` 12 px. Touch targets at least 32 px on desktop, 44 px on touch layouts.

## Layout

- **Top bar:** brand, File, project name (truncates), mode badge; run controls and clock in the centre; Open, Save, Help on the right.
- **Rail:** icon-only on desktop with tooltips (schematic, physical, challenges, examples, new); a labelled bar on phones that also toggles the library and inspector.
- **Stage:** the lightest surface. Wires use their domain colour and weight (electrical 3 px, hydraulic 5 px, mechanical 4 px dashed, thermal dashed, control thin dotted neutral). Live chips on wires show flow, shaft speed or current, counter-scaled to stay legible; current is only shown where it is exact (a two-terminal element that is the only branch at that terminal). Chips hide below 50 % zoom.
- **Inspector:** name and health first, then one hero value, measurement tiles, ratings, then parameters. Section titles are sentence case at 13 px.
- **Dock:** telemetry charts with round tick values on a data-fitted range (no forced zero baseline).
- **Status bar:** run state, counts, cost, solver timing, warnings, residual.
- **Phones (≤ 580 px):** run controls stay in the header (step button hidden); library and inspector open over the workspace only, the inspector as a bottom sheet.

