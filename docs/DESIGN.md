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

## Schematic modules

A module on the canvas is a compact instrument housing, not a card. It answers four questions in a fixed order and leaves everything else to the Inspector. `src/components/ModuleFace.tsx` draws the face; `Workspace.tsx` draws the frame and the terminals.

1. **What is it?** A technical symbol (IEC 60617 style for electrical parts, ISA bubbles for instruments, IEC 61131 function blocks for logic) in neutral ink (`n-14`). Conductors entering the symbol keep their domain colour; a symbol part is coloured only when it is physically active (a lit filament, an energised heating stage, a turning impeller).
2. **Where do I connect it?** Exactly the ports of the catalog definition, at the positions `editor/geometry.ts` gives them; a face never adds, moves or implies a terminal. Labels (12 px mono) are drawn where polarity or function matters (`+ −`, `L N`, `BAT+`, `IN L`/`OUT L`, `A1 A2`, `EN`, `SPD`). Multi-terminal converters use a terminal strip: a short lead at the edge with the label on the terminal line. Labels of terminals entering from above sit beside the stub outside the body, since the name band is inside.
3. **What is it doing?** The status lamp in the name band: `ok` operating, grey idle or ready, `warning` outside rating or degraded (lockout, sensor fault, overflow), `fault` failed, tripped or latched (`moduleStatus`). Its tooltip names the state. A sentence-case state line repeats it in words where the state is the point (`Bulk`, `Grid connected`, `Tripped / latched`).
4. **Most important measurement?** One hero value (13 px mono) and at most one state or detail line (12 px sans). Before the first Run they show the rating or setting instead of operating values. Readouts never overlap a terminal label: they are fitted to the free span between edge labels and shortened with an ellipsis (full text in the tooltip).

Layout: 31 px name band (double-click renames) with the name in the domain colour and the lamp at the right; the symbol on the terminal axis; readouts in the bottom rows (moved up one row when terminals enter from below). Module footprints and terminal coordinates are unchanged by face design, so routes and saved projects are unaffected.

## Layout

- **Top bar:** brand, File, project name (truncates), mode badge; run controls and clock in the centre; Open, Save, Help on the right.
- **Rail:** icon-only on desktop with tooltips (schematic, physical, challenges, examples, new); a labelled bar on phones that also toggles the library and inspector.
- **Stage:** the lightest surface. Wires use their domain colour and weight (electrical 3 px, hydraulic 5 px, mechanical 4 px dashed, thermal dashed, control thin dotted neutral). Live chips on wires show flow, shaft speed or current, counter-scaled to stay legible; current is only shown where it is exact (a two-terminal element that is the only branch at that terminal). Chips hide below 50 % zoom.
- **Inspector:** name and health first, then one hero value, measurement tiles, ratings, then parameters. Section titles are sentence case at 13 px.
- **Dock:** telemetry charts with round tick values on a data-fitted range (no forced zero baseline).
- **Status bar:** run state, counts, cost, solver timing, warnings, residual.
- **Phones (≤ 580 px):** run controls stay in the header (step button hidden); library and inspector open over the workspace only, the inspector as a bottom sheet.

