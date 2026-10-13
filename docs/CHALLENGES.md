# Challenges and scoring

**Challenges** opens nine scored assignments. A mission starts from a scaffold that contains only the fixed environment (vessels, loads, supports, consumer demand); the player chooses, buys, places and wires the equipment. A guidebook opens at launch with the objectives, suggested equipment and three optional hints, and can be reopened from the challenge strip. The example shelf (**File → Starters & examples**) has complete, working versions of most of these systems as free experiments.

Each mission is one definition in the registry `src/simulation/challenges/` (see [Adding a mission](#adding-a-mission)).

## Adding a mission

A mission is a `ChallengeDefinition` (`challenges/types.ts`): card text, budget and economy target, locked rules (ambient, initial temperature, supply voltage, allowed kinds), engine limits, guidebook, starting layout (`scaffold`), catalog reference design (`reference`, with `operateReference` for operator actions such as a manual reset), integrity (`validate`, `vessels`), tracking state with engine hooks (`beforeStep`, `afterSolve`, `update`, `actuatorValue`, `onAdd`), `evaluate`, and optional status text for the challenge strip and dialog.

Families share their mechanics: `circuits.ts` (requirement-checked electrical and thermal missions, 001–002), `runaway.ts` (003), `hydraulic.ts` (vessels, 24 V/500 W/2 bar limits and scoring, 004–006) and `mechanical.ts` (locked loads in the Physical view, 007–009). A mission in an existing family is mostly configuration; a new kind of mission implements the hooks it needs.

To add one:
1. Add its id to `challengeIds` (`challenges/ids.ts`, mission-number order) and its definition to `challengeRegistry` (`challenges/registry.ts`); the compiler reports a missing definition.
2. Run `node scripts/check-scores.mjs`: it runs every registered reference design and fails for a mission without a recorded result. Record it with `--update` and explain the result in the commit.
3. The mission list, guidebook, parts library, integrity checks, engine hooks and `learning.test.ts` (valid starting layout, three hints) pick it up from the registry.

## Assignments

| # | Title | Task | Budget |
| --- | --- | --- | ---: |
| 001 | First Light | Power a lamp continuously for 3 s with at most 12 V, within its rating | €100 |
| 002 | Heating Challenge | Heat 10 L of water from 20 °C to 80 °C with at most 2,000 W input and no failures | €180 |
| 003 | Thermal Runaway | Regulate 10 L at 78–82 °C for ≥ 240 s with a full automatic cycle; an independent cutoff must interrupt heating through welded relay contacts during a loss of coolant; then reset manually and regulate ≥ 120 s with a full recovery cycle. 2 kW limit | €500 |
| 004 | Water Transfer | Deliver ≥ 100 L from a finite 150 L source to a tank 2 m higher within 300 s, without overflow or dry running. 500 W, 24 V, 2 bar | €650 |
| 005 | Pressure Control | Hold 0.35 bar at the delivery outlet for 180 s after 15 s startup while consumer demand alternates between 40 % and 80 % every 60 s: ≥ 90 % within ±10 %, RMS error ≤ 3.5 kPa, no overshoot above 0.6 bar | €750 |
| 006 | Automated Water Supply | Keep a destination between 30 % and 90 % for 600 s after 120 s commissioning: ≥ 95 % in band, 2–12 motor switchings, an independent high-level guard, and survive a primary level-sensor fault at 300 s without operator input | €850 |
| 007 | Controlled Descent | Lower a 10 kg guided load from 5 m to 1.00 ± 0.08 m with a passive brake and rest 3 s; impact ≤ 0.6 m/s, braking heat ≤ 500 J, within 120 s | €250 |
| 008 | Motorized Lift | With a 48 V motor, rack transmission and position feedback, lift 10 kg from 1 m to 3.00 ± 0.08 m and hold 3 s; ≥ 100 J actual shaft work; 2 kW, 120 s | €900 |
| 009 | Rotational Control | Regulate a physical rotor at 1,200 RPM for 60 s after 10 s startup while the load alternates between 0.4 and 1.2 N·m every 15 s: ≥ 95 % within ±60 RPM, RMS ≤ 60 RPM, four load changes; 48 V, 2 kW, 90 s | €750 |

## Integrity

- Ratings, catalog models, initial environment (20 °C ambient, initial masses and temperatures), available components, supply limits and budgets are locked to the assignment and validated at import and at every engine boundary. Custom sandbox configurations are rejected before costing.
- Physical configuration and initial conditions require Reset after time advances. Hydraulic and mechanical scored runs lock operating edits, free forces and impulses after startup, so they must run autonomously.
- Completion depends on solved physical state and on the signal ancestry of the control, not on one predefined circuit. Examples: 003 requires measured-feedback relay transitions that actually change heater power (passive cooling through the band earns nothing), and protection credit requires that the tripped contact really isolates the heater (checked by hypothetical electrical solves without changing state); 005 requires feedback from the actual consumer inlet with both demand phases producing distinct flows; 006 requires real source and destination feedback and two connected destination sensing paths.
- Any rating violation or overflow fails the safety check.
- `node scripts/check-scores.mjs` (part of the release gate) runs a catalog reference design for every assignment and compares completion and score with `validation/reference-scores.json`.

## Scoring

A completed assignment scores 0–100 points: three stars at ≥ 90, two at ≥ 80, otherwise one.

- **Economy:** full credit at or below the reference build cost, declining linearly to zero at the budget. Reference costs: 001 €68, 002 €158, 003 €293, 004 €458, 005 €494, 006 €544, 007 €100, 008 €549, 009 €482. Each guidebook shows its economy target.
- **Electrical assignments (001, 002):** 60 + 20 × energy efficiency (ideal energy / actual) + 10 × economy + 10 × time (ideal time / actual).
- **Thermal Runaway (003):** 50 base plus stability (15, reduced by normal-operation overshoot over 13 K), energy (10), economy (10), time (10) and relay wear (5, fewer switchings score higher) terms.
- **Hydraulic assignments (004–006):** 55 + 15 × energy + 10 × economy + 10 × time + 10 × time in band (004: full), with a response and overshoot penalty of up to 5 points for 005.
- **Mechanical assignments (007–009):** 60 + 20 × energy + 10 × economy + 10 × time.

The standard €68 source, switch and lamp circuit earns 100/100 on First Light.
