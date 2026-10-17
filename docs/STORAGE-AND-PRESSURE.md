# Stratified storage, expansion vessel and safety valve

Three components close the gaps the heat pump exposed:

- **`storageTank`**: a sealed vertical buffer or hot-water cylinder whose water is held in layers, with buoyancy mixing, four ports at set heights and an optional internal coil.
- **`expansionVessel`**: a membrane pressure vessel whose nitrogen cushion is compressed as the circuit's water expands. It replaces the fixed fill-pressure stand-in of its circuit.
- **`safetyValve`**: a spring-loaded relief valve that discharges water, with its mass and energy, out of the system.

All three are sandbox components (not available in scored assignments).

## Sources

| Tag | Document | Used for |
| --- | --- | --- |
| [BH] | Bosch BH 120-5 1 B heat-pump buffer, product page (Bosch Home Comfort BE, article 7735500777) | 122.9 l, 980 mm × Ø 510 mm, 41.2 kg, standby loss 52 W, 1.2 kWh/d |
| [WH] | Bosch WH 290-450 LP1 installation manual 6720872573, §2.7 Tab. 6 and dimension table | WH 290 LP1: 277 l useful, coil 2 × 12 turns, 3.2 m², 22.0 l, 11.0 kW at 55 °C flow and 45 °C store with 1,000 l/h, 10 bar, height 1,294 mm, Ø 600/700 mm; safety valve at least DN 20; standby loss 67 W (ErP, Bosch product page) |
| [CS] | Bosch Compress 6800i AW indoor unit CS6800iAW 12 M, installation manual 6721877107 (2025/06), §3.3–3.4, §5–8, §10.1 | Defrost energy from buffer and system water; integrated 17 l expansion vessel, factory precharge 0.75 bar; precharge = 0.1 bar/m static height + 0.2 bar; fill 0.2–0.5 bar above precharge, at least 1.3–1.5 bar cold, at most 2.5 bar at maximum temperature; 3 bar maximum; safety-valve working difference 0.5 bar; 170.7 l hot-water cylinder, 16 l buffer, 3-way valve VW1 |
| [RX] | Reflex N 25 data sheet (white, 3/1.5 bar) | 25 l, factory precharge 1.5 bar, permissible operating pressure 3 bar, 70 °C at the membrane, Ø 308 × 477 mm |
| [TRD] | TRD 721 (Technische Regeln für Dampfkessel), §7 and Tafel 3 | Safety valves marked "H" for hot-water generators: spring loaded, respond at 3.0 bar at the latest, prevent more than 0.5 bar overpressure, close within 0.5 bar below the response pressure; DN 15 to 50 kW, DN 20 to 100 kW, DN 25 to 200 kW |
| [EN] | EN 12828 (heating systems, design of water-based heating), vessel sizing | Water reserve 0.5 % of the system volume, at least 3 l; final pressure 0.5 bar below the safety-valve set pressure |
| [K] | Kell (1975), J. Chem. Eng. Data 20(1):97–105 | Water density 0–150 °C (already used for tanks) |

## Stratified storage tank

### Model

The water column of height H and volume V is a stack of N equal layers (default 20; bottom k = 0, top k = N − 1). Each layer holds its water at the reference density plus a share of the vessel steel, C_k = (m·c_p + C_steel)/N. Per step, all layers and the coil cells are solved implicitly (backward Euler):

```
C_k dT_k/dt = Σ_in,k ṁ c_p T_in − ṁ_out,k c_p T_k               ports at layer k
            + vertical upwind advection F_k|k+1 from continuity of the layers below
            + G (T_{k+1} − 2T_k + T_{k−1})                       G = k_eff·A/Δz
            − UA_k (T_k − T_amb)                                 UA split by wall area
            + Σ_coil g (T_ex,j − T_k)
C_c dT_j/dt = ṁ_c c_p (T_{j−1} − T_j) − g (T_ex,j − T_k(j)),   T_ex,j = w T_{j−1} + (1 − w) T_j,   g = UA_coil/M
```

- **Ports.** Four ports, each at a height in the column (0–100 %). Inflow enters the layer of its port; outflow is drawn from it. A nozzle between the port and the tank interior carries an entry-plus-exit loss (two-K: K∞ = 1.5, K₁ = 160, Hooper). Unconnected ports are blank plugs.
- **Buoyancy.** After each step, adjacent layers whose density increases upward (Kell; this includes the anomaly below 4 °C) are mixed to their capacity-weighted mean until the column is stably stratified (pool-adjacent-violators). Hot water entering low therefore rises, cold water entering high sinks. Energy is conserved exactly.
- **Coil.** One cell per layer the coil crosses, fed from its top (flow connection) to its bottom (return). The exponentially fitted inlet weight w = 1/x − 1/(eˣ − 1), x = g/(ṁc), is the one used by the panel radiator: each steady cell attenuates its excess over the layer by exactly e^(−x), so the coil reproduces ε = 1 − e^(−UA/ṁc) independent of the cell count, and without flow w = 0. The coil water is a separate circuit; it can be part of a different hydraulic group than the store.
- **Losses.** UA = S/45 K from the ErP standby loss S (EN 12897: 65 °C store, 20 °C air), split over the layers by area (side wall per layer, lid on the top layer, base on the bottom). The surroundings come from the ambient resolver, so a tank assigned to a Thermal Space heats that room.
- **Global coupling.** The layer/coil system is linear in the inlet node temperatures. Its response is solved once per step (a dense solve with one right-hand side per inlet), and each outflowing port and the coil outlet enter the global enthalpy solve as affine outlet relations. Tanks, pipes, radiators, the boiler and the heat pump are therefore solved together; no temperature is lagged and nothing is iterated.
- **Pressure.** The tank is rigid and sealed; its interior is one hydraulic node. Readings give the gauge pressure at the base and at each nozzle height.

### Data provenance

| Category | Content |
| --- | --- |
| Manufacturer data | Volumes, standby losses, coil area, water content and rating, pressure ratings, outer dimensions [BH], [WH] |
| Calculated | UA = S/45 K; the steady coil output at any flow from the fitted UA |
| Fitted | Coil UA = −ṁc·ln(1 − Q/(ṁc·ΔT)) = 3,419 W/K, exact for Bosch's 11.0 kW at 55/45 °C and 1,000 l/h |
| Assumed | Inner water-column height (BH 120: 0.85 m, WH 290: 1.15 m); port, sensor and coil heights (WH 290 coil 17–61 % read from the dimension table, letters not assigned in the text); steel heat capacity from the net weight less insulation at 480 J/(kg·K); effective vertical conductivity 1 W/(m·K) (water 0.64 plus wall conduction and inlet mixing); nozzle and coil loss coefficients (coil: about 30 m of DN 25 tube, K∞ 30, K₁ = 64·L/D); constant coil UA (the real natural-convection coefficient rises with the temperature difference) |

The Inspector shows the layer profile with ports, coil and sensors, the readings and this listing.

### Measurements

`fluidTemperature` is the upper sensor pocket (what a cylinder thermostat sees), `bottomTemperature` the lower pocket, `topTemperature` the top layer, `storedHeat` the heat stored since reset (kWh), `heatDuty` the coil heat into the store, `heatLoss` the standby loss, `flow` the throughflow (sum of the inflows) and `pressure` the gauge pressure at the base.

## Expansion vessel

### Model

A membrane vessel of nominal volume V_n with a nitrogen precharge p₀ (gauge, water side empty). The cushion is isothermal (slow expansion, the vessel near room temperature):

```
p_abs = p₀,abs · V_n / (V_n − V_w)                   V_w ≥ 0
p     = p₀ + V_w / (κ · V_system)                     V_w < 0 (vessel empty; κ = 4.5·10⁻¹⁰ 1/Pa, bounded by vapour pressure)
V_w,fill = V_n · (1 − p₀,abs / p_fill,abs)            fill pressure at the initial temperatures
```

Below 2 % gas volume the gas law continues linearly (the membrane bottoms out); the vessel then reports a fully compressed cushion.

**Thermal expansion.** The transport keeps every inventory at its fixed reference-density mass (Boussinesq), so expansion is computed, not transported. Each cell of container volume V_i = m_i/ρ_ref was filled with water of density ρ_i,fill; that water now occupies V_i·ρ_i,fill/ρ(T_i) (Kell). The circuit's expansion E = Σ V_i·(ρ_i,fill/ρ(T_i) − 1) over every inventory in the vessel's sealed circuit (pipes, boiler and heat-pump water, panel radiators, storage layers, coils) is displaced into the vessel:

```
V_w = V_w,fill + E − V_discharged
```

The vessel's pressure, plus ρ·g·z at its connection, is the piezometric boundary of its circuit in the network solve. Pumps then raise and lower the pressure around that point, so the vessel position matters (pump suction versus discharge) as in a real circuit.

**Water ledger.** The vessel holds a ledger inventory (mass and enthalpy at the fill temperature). It changes only when the circuit loses water through a safety valve: the vessel then supplies exactly the discharged flow at its water temperature. The circuit's mass is therefore exact. Continuity residue of the network solve at the vessel boundary is not booked as mass.

**Rules.** One vessel per sealed circuit (combine vessels into one of the summed volume). A circuit open to a vented tank already has its pressure reference, so a vessel there is rejected. Without a vessel, sealed circuits keep the fixed fill-pressure datum of the boiler or heat pump (an external compliant stand-in, no expansion pressure).

**Faults.** `gasLoss`: the nitrogen escapes; the cushion becomes atmospheric gas filling the nominal volume (a flat vessel). Pressure drops at once, and further heating raises it steeply.

### Data provenance

| Category | Content |
| --- | --- |
| Manufacturer data | Reflex N 25 (25 l, 1.5 bar factory precharge, 3 bar, 70 °C membrane) [RX]; Bosch indoor-unit vessel (17 l, 0.75 bar) and Bosch filling rules [CS] |
| Standard | EN 12828 sizing: reserve 0.5 % of the system, at least 3 l; end pressure 0.5 bar below the valve [EN] |
| Calculated | Water side at fill, usable volume to a given pressure, expansion from Kell densities |
| Assumed | Isothermal cushion; no gas permeation; rigid pipework (steel and copper expand about a tenth as much as water); no unmodelled system volume (zero-volume branches carry no water); vessel water at its fill temperature; the cushion's compression energy lies outside the constant-c_p enthalpy model (see below) |

The Bosch manual gives both "0.2–0.5 bar above the precharge" and "at least 1.3–1.5 bar" for the cold fill. The 17 l preset uses 1.3 bar (0.55 bar above 0.75 bar).

## Safety valve

### Model

A forward-only branch from its circuit to the discharge. Its flow is Q = lift·K_v·√(Δp/1 bar) (K_v at full lift, quadratic). The lift follows the differential pressure across the disc, sampled after each accepted substep like a spring on the last pressure:

```
closed:  lifts when Δp ≥ p_set,  to (Δp − p_reseat)/(p_full − p_reseat)        (partial pop)
open:    lift = (Δp − p_reseat)/(p_full − p_reseat),  reseats when Δp ≤ p_reseat
defaults: p_set 3.0 bar, p_full = p_set + 0.3 bar, p_reseat = p_set − 0.2 bar,  K_v 1 m³/h (DN 15)
```

Both offsets are assumptions inside the TRD 721 limits (≤ 0.5 bar overpressure, closing within 0.5 bar). An unconnected outlet is an open drain at atmospheric pressure at the valve height; the water leaves the system. A piped outlet must lead to a vented tank (tundish, collecting vessel). A safety valve needs a water reserve in its circuit: an expansion vessel, or a vented tank. With only the fixed fill-pressure stand-in it is rejected, because that datum cannot supply water.

Faults: `stuckClosed` (seized, no protection: the pressure rises to the ratings and the cushion bottoms out), `stuckOpen` (held open, continuous discharge).

**Time step.** An open valve and its vessel form a first-order system with τ = 1/(k_vessel·dQ/dp) (a few seconds). While the valve is open, substeps stay at a tenth of τ; a closed valve approaching its set pressure ends the substep before the pressure can pass it by more than a quarter of the remaining margin.

### Behaviour

With a correctly sized vessel the valve stays closed. With an undersized, flat or failed vessel the pressure reaches the set pressure; the valve pops partly open, discharges until the reseat pressure, and then simmers between reseat and set while the circuit keeps expanding, discharging exactly the excess expansion. After cooling, the lost water shows as a pressure below the original fill pressure, possibly below the precharge (vessel empty, a real low-pressure fault).

## Energy and mass accounting

- Storage layers and coils are cell inventories in the transport ledger; their losses go to ambient or the assigned Thermal Space; inversion mixing is an internal redistribution.
- Discharged water carries its mass, its enthalpy c_p·T at the valve outlet and its potential g·z at the outlet, like weir overflow.
- The gas cushion does work Π·Q on the water it supplies to the circuit (Π the piezometric pressure at the vessel): this is the energy that the valve throttles to heat and that the water carries away as potential energy. It is booked as **cushion work** (supplied). The cushion's own compression energy, ∫p·dV ≈ 1 kJ for a 25 l vessel taken to 2.5 bar, is part of the water's pV term and not a separate store: the constant-c_p enthalpy model counts water energy as m·c_p·T at any pressure.

Residuals stay at 10⁻⁷–10⁻⁴ J over hours (see the report).

## Starters

- **Heat pump with a buffer tank** (`heatPumpBuffer`): the heat-pump house with a BH 120-5 buffer in series in the return. The defrost draws on 123 l of stored water: the lowest flow temperature during defrost is about 2 K higher than without buffer.
- **Hot water in the heat-pump examples:** every heat-pump example charges a WH 290 LP1 through its coil via the 3-way valve VW1 (see [HEAT-PUMP.md § Hot-water mode](HEAT-PUMP.md#hot-water-mode-and-the-3-way-valve-vw1)). The charge runs at a visibly lower COP than heating (performance factor about 2.6 against about 4.0 at 2 °C; Bosch EN 14511 at maximum output: 3.07 at A7/W35, 2.64 at A7/W55). The water below the coil stays cold; above it the store heats nearly uniformly by inversion mixing.
- **Sealed boiler circuit** (`sealedBoiler`): the Bosch boiler charges the buffer to 75 °C; the circuit expands by about 3 l, the Reflex N 25 holds it at about 2.2 bar. A 12 l vessel, a flat vessel or a gas loss opens the 3 bar valve.
- The heat-pump starters include the indoor unit's 17 l vessel and 3 bar valve; the boiler and Kermi starters a 12 l vessel and a 3 bar valve.

## Validation

`storage-pressure.test.ts` (release gate) and `npm run validate:storage` ([report](../validation/storage-pressure.md)) check:

- standby loss: 52 W and 67 W at 65/20 °C; the 24 h free cool-down against the lumped decay;
- the coil rating exactly, and other flows against ε = 1 − e^(−UA/ṁc);
- plug-flow charging against an ideal plug and a fully mixed tank; buoyant rise of hot water entering low; stable stratification throughout;
- expansion of a uniformly heated circuit against Kell densities, and the vessel pressure against the gas law;
- an undersized vessel lifting the valve: peak pressure inside the TRD 721 bound, discharged volume equal to the excess expansion, exact mass, energy residual;
- a seized valve, a flat vessel and a gas loss; fixed against adaptive steps; the circuit rules;
- the heat-pump buffer and hot-water scenarios with energy residuals.

The preset campaign runs every new preset in an operating fixture.

## Limitations

- **Storage.** One-dimensional layers: no plume entrainment, no inlet-jet mixing, no internal flow structure; the thermocline cannot be thinner than about one layer plus conduction. Inflow enters at its port's layer (no stratifier lance). Constant coil UA. No anode, no legionella programme, no immersion heater (an existing heater cannot be placed in a storage tank). The heat pump's own hot-water mode with its 3-way diverting valve is not modelled.
- **Pressure.** Pressure is quasi-static: water is incompressible in the network, and only vessels and the empty-vessel stiffness relate volume to pressure. No water hammer, no air in the system, no automatic filling, no pressure switch on the boiler or heat pump (low pressure is reported, not acted on). Pipework, radiators and tanks are rigid. One vessel per circuit. Valve disc dynamics, chatter and simmer leakage below the set pressure are not modelled; the water capacity at full lift is an assumption. Steam discharge is not modelled (the liquid-water model stops at 100 °C).
