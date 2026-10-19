# Heating circuit manifold

The `heatingManifold` component is an underfloor heating manifold modelled on the **Oventrop Multidis SF, type 140 43** (stainless steel 1.4301). A flow bar carries a flow meter with a regulating insert for each circuit; a return bar carries valve inserts for thermal actuators. Code: `src/simulation/heating-manifold.ts`; tests: `src/simulation/heating-manifold.test.ts`; example: **Underfloor manifold: three rooms**.

## Data and provenance

| Quantity | Value | Class |
| --- | --- | --- |
| Circuits | 2–12 | Manufacturer (Oventrop range) |
| kvs per circuit | 1.1 m³/h | Manufacturer (type 140 43) |
| Flow meters | 0–5 l/min, in the flow bar | Manufacturer |
| Return inserts | M 30 × 1.5, for thermal actuators | Manufacturer |
| Maximum operating pressure | 6 bar | Manufacturer |
| Maximum operating temperature | 80 °C | Manufacturer |
| Maximum differential pressure | 1 bar | Manufacturer |
| Kv between closed and fully open | linear in the setting | **Assumption** |
| kvs applies to the whole circuit (both inserts) | — | **Interpretation**: the tender text gives one value |
| Actuator stroke time | 180 s, no dead time | **Assumption** (typical normally closed wax actuators: about 3 min) |
| Bars | no pressure drop, no water volume, no heat loss | **Assumption** |

Source: Oventrop GmbH & Co. KG, tender texts for Multidis SF type 140 43 (2–12 circuits, integrated flow, measuring and regulating inserts 0–5 l/min) and type 140 45, published on heinze.de (retrieved 2026-10-19). Oventrop's data sheets could not be read in machine form. The Kv-against-setting curve of the flow-meter insert was not found, which is why the characteristic is an assumption.

## Hydraulics

Each fitted circuit with something connected to its flow port is one valve branch:

```
flow bar ──[ regulating insert · thermal actuator ]──► circuit k flow port ── loop ──► circuit k return port ── return bar
Δp = 1 bar · (Q / Kv)²,   Q in m³/h,   Kv = kvs · (setting/100) · (stroke/100)
```

- **Bars.** All return ports and the main return form one node (ideal mixing). The flow bar is the supply node.
- **Closed circuits.** A setting of 0 % or a fully closed actuator isolates the circuit exactly. A fitted circuit whose flow port is unconnected is plugged, so it has no branch.
- **Ports.** Ports exist only up to the configured number of circuits (`componentPorts`). Reducing the circuits while a higher circuit is still connected is refused.
- **Transport.** The branch has no water volume, so the circuit carries the flow-bar temperature into the loop. The insert's dissipation Δp·Q heats the water, as in every valve.
- **Readings.** Per circuit: flow and insert pressure drop. For the manifold: total flow, flow-bar gauge pressure, flow-to-return differential pressure and flow-bar temperature. The flow meters show l/min and peg at their range ("> 5.0"); the module warns when a flow is beyond the range or the differential pressure exceeds 1 bar.

## Thermal actuators

The `act1…act12` inputs take a Boolean, for example from a room thermostat. Actuators are **normally closed**:

| Input | Actuator |
| --- | --- |
| Not wired | No actuator fitted: open |
| `true` | Opens |
| `false` | Closes |
| Invalid, or wire disconnected | Closes (unpowered) |

The stroke runs linearly at 100 % per `actuatorTime`, and the timestep is limited while an actuator moves. Actuators start open.

## Hydraulic balancing

Each circuit has a **planned flow** (l/min, from the heating-load calculation). **Balance to planned flows** in the inspector sets every regulating insert at the current operating point:

1. Measure the bar-to-bar differential pressure H and each circuit's flow Q.
2. The loop's share of H is H − Δp_insert(Q). Assume it scales as Q^1.75 (smooth-pipe turbulent law).
3. Give the insert the Kv that leaves exactly H − Δp_loop(q_planned) for the planned flow.
4. A circuit that would need more than kvs stays fully open and is reported: raise the pump head or shorten the loop.

The differential pressure changes once the pump meets a new total flow, so balancing is repeated with the system running, as an installer does by reading the meters. In the test rigs and in the example, three rounds bring every circuit within 1 % of its planned flow. Each round is one undoable edit.

## Example: Underfloor manifold, three rooms

- **Rooms:** a living room (5 × 4 m), bedroom (4 × 3.5 m) and bathroom (2.5 × 3 m), all on the [ground](GROUND.md) with shared interior walls, at 0 °C outdoors.
- **Loops:** one per room, on a 3-circuit Multidis SF:
  - living room: 120 m, 150 mm spacing;
  - bedroom: 80 m, 150 mm spacing;
  - bathroom: 60 m, 100 mm spacing, tiles.
- **Heat source:** a Bosch electric boiler at 40 °C flow, limited to two of its three stages (6 kW) with the smallest hysteresis Bosch allows (3 K), and an ALPHA2 at 3 m constant pressure. With all three stages and the default 7 K, the boiler short-cycled every 84 s on the ~1.5 kW floor load, and the flow swung between 28 and 35 °C: too cold on average for the rooms to reach their setpoints.
- **Bathroom floor:** surface limit 33 °C, the EN 1264 value for bathrooms (29 °C in the other rooms).
- **Controls:** room thermostats (21, 18 and 24 °C) drive the actuators. A minimum-flow bypass keeps the boiler flowing when all circuits close.

The inserts start fully open. The short bathroom loop then takes 2.7 l/min and the long living-room loop 2.0 l/min, against planned flows of 1.8 / 1.3 / 0.7 l/min. Three balancing rounds give 1.80 / 1.30 / 0.70 l/min, with inserts at about 43 / 19 / 9 %.

## Validation

`heating-manifold.test.ts`:

- **Flow split.** Each circuit's flow is checked against a bisection on the Kv law plus Darcy–Weisbach for its loop, solved at the measured bar Δp, to 1e-4. The insert drop is 1 bar·(Q/Kv)², and the flows sum to the bar flow.
- **Closing.** Closed inserts isolate exactly, and unconnected circuits have no branch.
- **Half stroke.** A half-stroked actuator halves the circuit Kv.
- **Actuators.** The stroke moves at 100 %/stroke time; a false command closes, an unwired circuit stays open, and a lost signal closes.
- **Balancing.** It converges within 1 % in a few rounds and reports an unreachable planned flow.
- **Meters, ports and files.** Meters peg at their range. Ports match the circuit count, reducing circuits with a loop attached is refused, and a wire to an unfitted circuit is rejected on load. The project round-trips through save and load.
- **Conservation.** The energy residual stays below 0.05 J and the mass residual below 1 mg with warm water through heat-losing loops.
- **Example.** The starter begins unbalanced and balances to its planned flows in three running rounds.

`e2e/heating-manifold.spec.ts` covers reading the meters, balancing in the browser and convergence. The component test in `e2e/components-next.spec.ts` covers the inspector and its provenance.

## Limitations

- **Insert curve.** Only kvs is published. Partly open settings follow a linear Kv, so absolute settings differ from Oventrop's scale; the flows they produce are physical.
- **Bars.** No pressure drop along the bars, so circuits far from the supply are not disadvantaged. The manifold holds no water and loses no heat.
- **Actuators.** No dead time or wax heating phase, and no 24 V or 230 V electrical load.
- **One loop per circuit.** A connected underfloor component with several identical loops sends all of their flow through one circuit, and its meter reads the sum. Use one loop per circuit for meaningful meters.
- **No other inserts.** No automatic flow limiters (as in Heimeier Dynacon Eclipse) and no differential-pressure bypass.
