// Operating fixtures for every built-in component preset, plus the complete
// heater × tank preset matrix. References below do not call production solvers.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const bundle = await build({ stdin: { contents: `
  export { Simulation } from './src/simulation/engine';
  export { Builder } from './src/simulation/scaling-validation';
  export { builtinPresets, presetComponentProps } from './src/simulation/presets';
  export { parseProject, serializeProject } from './src/simulation/projects';
`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
const { Simulation, Builder, builtinPresets, presetComponentProps, parseProject, serializeProject } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const reports = [];
const g = 9.80665, cp = 4180, rho20 = 998.2041322005837;
const props = p => presetComponentProps(p).props;
function fixture() {
  const b = new Builder(), original = b.add.bind(b);
  // The identity seeds resistor tolerances. Keep fixtures reproducible.
  b.add = (...args) => { const c = original(...args); c.id = `fixture-${b.p.components.length}`; return c; };
  b.p.id = 'preset-validation';
  b.p.name = 'Preset operating validation';
  b.preset = p => b.add(p.kind, props(p), p.base, p.name);
  return b;
}
function near(report, label, expected, measured, relative = 1e-8, absolute = 1e-8) {
  const error = Math.abs(measured - expected), tolerance = absolute + relative * Math.abs(expected);
  report.checks.push({ label, expected, measured, absoluteError: error, tolerance });
  assert(Number.isFinite(measured) && error <= tolerance, `${label}: expected ${expected}, got ${measured} (tolerance ${tolerance})`);
}
function simulation(b) { const s = new Simulation(parseProject(JSON.parse(serializeProject(b.p)))); assert.equal(s.error, null); return s; }
function run(s, seconds = 1) {
  for (let i = 0; i < Math.round(seconds * 60); i++) assert(s.step(), `At ${s.time} s: ${s.error ?? 'Step failed'}`);
}
function healthy(s, report) {
  report.time = s.time; report.energyResidual = s.energyResidual; report.massResidual = s.multiphysics.massResidual;
  report.violations = s.violations; report.failed = s.failed;
  assert.equal(s.error, null); assert.deepEqual(s.violations, []); assert.deepEqual(s.failed, {});
  assert(Object.values(s.temperatures).every(Number.isFinite));
  const finite = (value, path) => {
    if (typeof value === 'number') assert(Number.isFinite(value), `${path} is non-finite`);
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) finite(item, `${path}.${key}`);
  };
  finite(s.electrical.readings, 'electrical'); finite(s.multiphysics.hydraulic.readings, 'hydraulic'); finite(s.multiphysics.motors, 'motors');
  near(report, 'mass residual (kg)', 0, s.multiphysics.massResidual, 0, 1e-6);
  near(report, 'energy residual (J)', 0, s.energyResidual, 0, Math.max(0.5, Math.abs(s.suppliedEnergy) * 0.005));
}
function source(b, voltage, extra = {}) {
  return b.add('source', { voltage, ratedVoltage: Math.max(30, voltage), maxCurrent: 1e6, maxPower: 1e12, ...extra });
}
function load(b, resistance) {
  return b.add('resistor', { resistance, ratedPower: 1e12, heatCapacity: 1e10, loss: 0, maxTemperature: 5000 });
}
function tanks(b, elevation = 2, temperature = 20) {
  const common = { capacity: 300000, volume: 100000, surfaceArea: 1000, loss: 0, maxPressure: 1e7 };
  return [b.add('tank', { ...common, elevation, initialTemperature: temperature }), b.add('tank', common)];
}
function connectFluid(b, high, c, low, inlet = 'inlet', outlet = 'outlet') {
  b.wire(high, 'fluid', c, inlet); b.wire(c, outlet, low, 'fluid');
}
async function record(name, presets, action) {
  const report = { name, presets: presets.map(p => p.id), checks: [], pass: false };
  try { action(report); report.pass = true; } catch (error) { report.error = error.message; }
  reports.push(report);
  if (!report.pass) console.error(`${name}: ${report.error}`);
}

for (const p of builtinPresets.filter(p => !['heater', 'tank'].includes(p.kind))) await record(p.name, [p], report => {
  const b = fixture(), c = b.preset(p), v = c.props;
  let s;
  switch (p.kind) {
    case 'source': {
      const current = v.mode === 'cc' ? v.current : Math.min(v.maxCurrent / 4, 10);
      const r = v.voltage / (v.mode === 'cc' ? 2 * current : current);
      const resistor = load(b, r); b.series(c, resistor); s = simulation(b);
      const expected = v.mode === 'cc' ? current : v.voltage / (r + v.internalResistance);
      near(report, 'load current (A)', expected, s.electrical.readings[resistor.id].current);
      run(s); break;
    }
    case 'source3': {
      const r = v.lineVoltage / Math.sqrt(3) / (v.maxCurrent / 10), resistor = load(b, r);
      b.series(c, resistor); s = simulation(b);
      const current = v.lineVoltage / Math.sqrt(3) / (r + v.internalResistance);
      near(report, 'line current (A)', current, s.electrical.readings[resistor.id].current);
      near(report, 'three-phase real power (W)', 3 * current ** 2 * r, s.electrical.readings[resistor.id].power);
      run(s); break;
    }
    case 'resistor': {
      // Low excitation also keeps the linearised NTC near its declared 20 °C point.
      const voltage = Math.sqrt(v.ratedPower * 0.01 * v.resistance), supply = source(b, voltage);
      b.series(supply, c); s = simulation(b);
      const r = s.electrical.readings[c.id].resistance;
      assert(Math.abs(r / v.resistance - 1) <= v.tolerance / 100 + 1e-12);
      near(report, 'Ohm current at sampled tolerance (A)', voltage / r, s.electrical.readings[c.id].current);
      near(report, 'Joule power (W)', voltage ** 2 / r, s.electrical.readings[c.id].power);
      run(s); break;
    }
    case 'cable': case 'fuse': case 'breaker': case 'motorProtector': case 'relay': {
      const current = Math.min(v.ratedCurrent / 2, 100), supply = source(b, 12), r = 12 / current - v.resistance;
      const resistor = load(b, r);
      if (p.kind === 'relay') {
        b.wire(supply, 'a', c, 'a'); b.wire(c, 'nc', resistor, 'a'); b.wire(resistor, 'b', supply, 'b');
      } else b.series(supply, c, resistor);
      s = simulation(b);
      if (p.kind === 'cable') near(report, 'material resistance (ohm)', (v.material === 'copper' ? 1.724e-8 : 2.82e-8) * v.length / (v.area * 1e-6), v.resistance);
      near(report, 'series current (A)', current, s.electrical.readings[c.id].contactCurrent ?? Math.abs(s.electrical.readings[c.id].current));
      near(report, 'contact/conductor loss (W)', current ** 2 * v.resistance, s.electrical.readings[c.id].power);
      run(s); break;
    }
    case 'battery': {
      const initial = v.initialSOC / 100, delta = v.fullVoltage - v.emptyVoltage;
      const r = (v.emptyVoltage + delta * initial) / Math.min(1, v.maxCurrent / 10), resistor = load(b, r);
      b.series(c, resistor); s = simulation(b); run(s);
      // Independent reference: RK4 over the two states, charge and the R₁ ∥ C₁ polarization voltage (20 °C), with the
      // documented open-circuit tables (docs/PHYSICS.md) and self-discharge; discharge only, so charge efficiency is moot.
      const curves = { linear: [[0, 1], [0, 1]], nmc: [[0, 0.05, 0.1, 0.2, 0.4, 0.6, 0.8, 1], [0, 0.375, 0.458, 0.517, 0.6, 0.708, 0.833, 1]], lfp: [[0, 0.05, 0.1, 0.2, 0.5, 0.8, 0.95, 1], [0, 0.545, 0.636, 0.682, 0.718, 0.745, 0.773, 1]] };
      const ocv = (soc) => { const [xs, fs] = curves[v.chemistry]; const k = Math.min(xs.length - 2, xs.findIndex((x, i) => i === xs.length - 1 || soc < xs[i + 1])); return v.emptyVoltage + delta * (fs[k] + (fs[k + 1] - fs[k]) * (soc - xs[k]) / (xs[k + 1] - xs[k])); };
      const q = v.capacityAh * 3600, r1 = v.polarizationResistance, c1 = r1 > 0 ? v.polarizationTimeConstant / r1 : 0, leak = q * v.selfDischarge / 100 / (30 * 86400);
      const rate = ([soc, vp]) => { const current = -(ocv(soc) + vp) / (r + v.internalResistance); return [(current - leak) / q, r1 > 0 ? (current - vp / r1) / c1 : 0]; };
      let state = [initial, 0];
      for (let i = 0, n = Math.round(s.time / 1e-3), dt = s.time / n; i < n; i++) {
        const k1 = rate(state), k2 = rate(state.map((x, j) => x + dt / 2 * k1[j])), k3 = rate(state.map((x, j) => x + dt / 2 * k2[j])), k4 = rate(state.map((x, j) => x + dt * k3[j]));
        state = state.map((x, j) => x + dt / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
      }
      near(report, 'discharge SOC (RK4 reference)', state[0], s.devices.batteries[c.id], 0, 1e-10);
      near(report, 'polarization voltage (V)', state[1], s.devices.polarization[c.id], 1e-9);
      near(report, 'external supply energy (J)', 0, s.suppliedEnergy);
      break;
    }
    case 'contactor': {
      const coil = source(b, v.coilVoltage), mains = b.add('sourceAC', { voltage: 24 }), resistor = load(b, 24);
      b.series(mains, c, resistor); b.wire(coil, 'a', c, 'ca'); b.wire(coil, 'b', c, 'cb');
      s = simulation(b); assert.equal(s.devices.contactors[c.id].closed, false); run(s);
      assert.equal(s.devices.contactors[c.id].closed, true);
      near(report, 'coil consumption (W)', v.coilVoltage ** 2 / v.coilResistance, s.electrical.readings[c.id].coilPower);
      near(report, 'switched AC load current (A)', 24 / (24 + v.resistance), s.electrical.readings[resistor.id].current);
      break;
    }
    case 'transformer': {
      const voltage = v.ratedVoltage, n = v.turnsRatio, r = (voltage / n) ** 2 / (v.ratedPower / 10);
      const mains = b.add('sourceAC', { voltage, ratedVoltage: voltage, maxCurrent: 1e6, maxPower: 1e12 }), resistor = load(b, r);
      b.series(mains, c); b.wire(c, 'sa', resistor, 'a'); b.wire(c, 'sb', resistor, 'b'); s = simulation(b);
      const transfer = voltage / Math.hypot(v.windingResistance + n * n * r, 2 * Math.PI * 50 * v.leakageInductance);
      near(report, 'reflected-load secondary current (A)', n * transfer, s.electrical.readings[resistor.id].current);
      near(report, 'core plus copper loss (W)', transfer ** 2 * v.windingResistance + voltage ** 2 / v.coreResistance, s.electrical.readings[c.id].power);
      run(s); break;
    }
    case 'motor': {
      // A current-limited drive supply avoids an unrealistic ideal-source stall surge.
      const supply = source(b, v.ratedVoltage, { mode: 'cvcc', maxCurrent: v.ratedCurrent }); b.series(supply, c); s = simulation(b); run(s, 5);
      near(report, 'DC no-load torque balance speed (rad/s)', v.ratedVoltage * v.torqueConstant / (v.torqueConstant ** 2 + v.resistance * v.friction), s.multiphysics.motors[c.id].omega, 0.001);
      break;
    }
    case 'cooler': {
      const tank = b.add('tank', { capacity: 110, volume: 100, initialTemperature: 60, loss: 0 });
      b.wire(c, 'heat', tank, 'heat'); s = simulation(b); run(s, 10);
      // Density is independently tabulated to 0.01% at 60 °C.
      const capacity = 0.1 * 983.2 * cp + tank.props.vesselHeatCapacity;
      near(report, 'Newton cooling (C)', v.ambient + (60 - v.ambient) * Math.exp(-v.conductance * s.time / capacity), s.temperatures[tank.id], 0, 0.002);
      break;
    }
    case 'thermalMass': {
      const resistor = b.add('resistor', { resistance: 10, heatCapacity: 20, loss: 0, conductance: 4 }), supply = source(b, 10);
      b.series(supply, resistor); b.wire(resistor, 'heat', c, 'heat'); s = simulation(b); run(s);
      assert(s.temperatures[c.id] > 20); assert(s.temperatures[resistor.id] > s.temperatures[c.id]);
      break;
    }
    case 'pipe': case 'valve': case 'pressureReducingValve': case 'radiator': case 'heatExchanger': {
      if (p.kind === 'heatExchanger') {
        const [hot, hotSink] = tanks(b, 2, 80), [cold, coldSink] = tanks(b, 2, 10);
        connectFluid(b, hot, c, hotSink, 'hotIn', 'hotOut'); connectFluid(b, cold, c, coldSink, 'coldIn', 'coldOut');
      } else {
        const elevation = p.kind === 'pressureReducingValve' ? 1.5 * v.pressureSetpoint / (1000 * g) : 2;
        const [high, low] = tanks(b, elevation, p.kind === 'radiator' ? 60 : 20);
        if (p.kind === 'pressureReducingValve') {
          const consumer = b.add('valve', { diameter: v.diameter / 2, opening: 40, maxPressure: 1e7 });
          b.wire(high, 'fluid', c, 'inlet'); b.wire(c, 'outlet', consumer, 'inlet'); b.wire(consumer, 'outlet', low, 'fluid');
        } else connectFluid(b, high, c, low);
        if (p.kind === 'radiator') b.series(source(b, v.ratedVoltage), c);
      }
      s = simulation(b);
      if (p.kind === 'pipe') {
        const reading = s.multiphysics.hydraulic.readings[c.id], q = reading.flow, d = v.diameter, velocity = q / (Math.PI * d * d / 4);
        const re = 1000 * Math.abs(velocity) * d / 0.0010016;
        let f = re <= 2300 ? 64 / re : 0.25 / Math.log10(v.roughness / (3.7 * d) + 5.74 / re ** 0.9) ** 2;
        assert(re <= 2300 || re >= 4000, 'Fixture must avoid uncertain transitional friction');
        near(report, 'Darcy pressure drop (Pa)', f * v.length / d * 1000 * velocity ** 2 / 2, reading.differentialPressure, 0.001);
      }
      if (p.kind === 'valve') {
        const r = s.multiphysics.hydraulic.readings[c.id], area = Math.PI * v.diameter ** 2 / 4, velocity = r.flow / area;
        const re = 1000 * Math.abs(velocity) * v.diameter / 0.0010016;
        near(report, 'two-K valve pressure drop (Pa)', (v.laminarK / re + v.lossCoefficient) * 1000 * velocity ** 2 / 2, r.differentialPressure, 0.001);
      }
      if (p.kind === 'pressureReducingValve') {
        run(s, 120); near(report, 'regulated outlet pressure (Pa)', v.pressureSetpoint, s.multiphysics.hydraulic.readings[c.id].pressure, 0.01);
      } else run(s);
      if (p.kind === 'heatExchanger') {
        const hot = s.multiphysics.hydraulic.readings[`${c.id}#hot`], cold = s.multiphysics.hydraulic.readings[`${c.id}#cold`];
        assert(hot.flow > 0 && cold.flow > 0 && hot.duty > 0);
        near(report, 'equal heat duty in both streams (W)', hot.duty, cold.duty);
        assert(hot.temperature < 353.15 && cold.temperature > 283.15);
      } else assert(s.multiphysics.hydraulic.readings[c.id].flow > 0);
      if (p.kind === 'radiator') {
        near(report, 'rated fan consumption (W)', v.fanRatedPower, s.electrical.readings[c.id].fanPower);
        assert(s.multiphysics.hydraulic.readings[c.id].duty > 0);
      }
      break;
    }
    case 'pump': {
      const nominalPower = 1000 * g * v.shutoffHead * v.ratedFlow / v.efficiency;
      const current = Math.max(10, nominalPower / v.ratedSpeed * 3);
      const motor = b.add('motor', { resistance: 0.01, torqueConstant: 1, inertia: 0.1, friction: 0.001, ratedVoltage: v.ratedSpeed * 1.05, ratedCurrent: current, ratedPower: nominalPower * 5, ratedTorque: current, maxSpeed: v.ratedSpeed * 2, heatCapacity: 1e8, maxTemperature: 5000 });
      const supply = source(b, v.ratedSpeed * 1.05, { mode: 'cvcc', maxCurrent: current });
      const [high, low] = tanks(b, 2); low.props.elevation = 2 + v.shutoffHead / 4;
      const pipe = b.add('pipe', { diameter: Math.sqrt(2 * v.ratedFlow / Math.PI), length: 10, inventory: false });
      b.series(supply, motor); b.wire(motor, 'shaft', c, 'shaft'); b.wire(high, 'fluid', c, 'inlet'); b.wire(c, 'outlet', pipe, 'inlet'); b.wire(pipe, 'outlet', low, 'fluid');
      s = simulation(b); run(s, 5);
      const r = s.multiphysics.hydraulic.readings[c.id]; assert(r.flow > 0); assert(r.shaftPower > r.hydraulicPower && r.hydraulicPower > 0);
      near(report, 'hydraulic pressure work (W)', -r.differentialPressure * r.flow, r.hydraulicPower);
      assert(r.efficiency > 0 && r.efficiency <= v.efficiency);
      break;
    }
    case 'circulator': {
      // Closed loop with an open expansion tank. Steady operation: input P1 = P0 + P_shaft/η_m (constant-power load),
      // within the electronic limit; motor loss = P1 − P_shaft heats the water; constant pressure holds its head.
      const supply = v.ratedVoltage >= 100 ? b.add('sourceAC', { voltage: v.ratedVoltage }) : source(b, v.ratedVoltage);
      const tank = b.add('tank', { capacity: 300, volume: 150, surfaceArea: 0.25, loss: 0 });
      const pipe = b.add('pipe', { diameter: 0.02, length: 30, inventory: false });
      b.series(supply, c); b.wire(tank, 'fluid', c, 'inlet'); b.wire(c, 'outlet', pipe, 'inlet'); b.wire(pipe, 'outlet', tank, 'fluid');
      s = simulation(b); run(s, 3 * v.rampTime + 5);
      const r = s.multiphysics.hydraulic.readings[c.id], e = s.electrical.readings[c.id], omega = s.multiphysics.circulators[c.id].omega;
      assert(r.flow > 0 && omega > 0);
      assert(e.power <= v.ratedPower * (1 + 1e-9));
      near(report, 'input power P1 = P0 + P_shaft/η_m (W)', v.standbyPower + r.shaftPower / (v.motorEfficiency / 100), e.power, 1e-6);
      near(report, 'motor loss into the water (W)', e.power - r.shaftPower, r.motorLoss, 1e-6);
      near(report, 'terminal voltage (V)', v.ratedVoltage, e.voltage, 1e-9);
      if (v.mode === 'constantPressure' && e.power < v.ratedPower * 0.999) near(report, 'held head (m)', v.headSetpoint, -r.differentialPressure / (1000 * g), 1e-3);
      break;
    }
    case 'flywheel': {
      // Run-up through the gear stage: J·dω/dt = k(V − kω)/R − (b + drag/(i²η))·ω with J = J_m + J/(i²η) while the
      // motor accelerates the flywheel (independent first-order reference). Motor: k = 1, R = 1, b = 0.
      const i = v.gearRatio, eta = v.gearEfficiency / 100, target = 0.8 * v.maxSpeed * i, jm = 0.01;
      const motor = b.add('motor', { resistance: 1, torqueConstant: 1, emfConstant: 1, inertia: jm, friction: 0, ratedVoltage: target * 2, ratedCurrent: 1e6, ratedPower: 1e9, ratedTorque: 1e6, maxSpeed: target * 2, heatCapacity: 1e8, maxTemperature: 5000 });
      const supply = source(b, target); b.series(supply, motor); b.wire(motor, 'shaft', c, 'shaft');
      s = simulation(b);
      const inertia = jm + v.inertia / (i * i * eta), damping = 1 + v.friction / (i * i * eta), t = 2 * inertia / damping;
      run(s, t);
      // Midpoint integration at h = 1/60 s: second-order error ≈ (h/τ)²/12 per time constant; allow (h/τ)²/4.
      near(report, 'motor speed during run-up (rad/s)', target / damping * -Math.expm1(-s.time * damping / inertia), s.multiphysics.motors[motor.id].omega, Math.max(1e-6, (damping / inertia / 60) ** 2 / 4));
      near(report, 'flywheel kinetic energy ½J(ω/i)² (J)', 0.5 * v.inertia * (s.multiphysics.motors[motor.id].omega / i) ** 2, s.multiphysics.kineticEnergy(s.project) - 0.5 * jm * s.multiphysics.motors[motor.id].omega ** 2, 1e-9);
      break;
    }
    case 'dynamometer': {
      // Steady absorbed torque: a DC motor (k = 1, R = 0.05 Ω) settles where k(V − kω)/R = T_dyno(ω) at about the rated speed.
      const speed = v.ratedSpeed, demand = v.absorber === 'waterBrake' ? v.torqueSetpoint : Math.min(v.torqueSetpoint, v.ratedTorque);
      const motor = b.add('motor', { resistance: 0.05, torqueConstant: 1, emfConstant: 1, inertia: 0.05, friction: 0, ratedVoltage: speed * 2, ratedCurrent: 1e6, ratedPower: 1e9, ratedTorque: 1e6, maxSpeed: v.maxSpeed, heatCapacity: 1e8, maxTemperature: 5000 });
      const supply = source(b, speed + 0.05 * demand); b.series(supply, motor); b.wire(motor, 'shaft', c, 'shaft');
      s = simulation(b); run(s, 20);
      const absorbed = (w) => v.absorber === 'electric' ? Math.min(v.torqueSetpoint, v.ratedTorque, v.ratedPower / w)
        : v.absorber === 'waterBrake' ? Math.min(v.torqueSetpoint * (w / speed) ** 2, v.ratedTorque, v.ratedPower / w)
        : Math.min(v.torqueSetpoint, v.ratedTorque * 2 * (w / speed) / (1 + (w / speed) ** 2), v.ratedPower / w);
      // Independent steady speed: bisection on (V − ω)/R = T(ω).
      let lo = 0.5 * speed, hi = 1.5 * speed;
      for (let k = 0; k < 200; k++) { const w = (lo + hi) / 2; if ((speed + 0.05 * demand - w) / 0.05 > absorbed(w)) lo = w; else hi = w; }
      const w = (lo + hi) / 2, omega = s.multiphysics.motors[motor.id].omega;
      near(report, 'steady speed (rad/s)', w, omega, 1e-6);
      near(report, 'absorbed torque (N·m)', absorbed(w), s.multiphysics.shaftElements[c.id].torque, 1e-5);
      near(report, 'absorbed power (W)', absorbed(w) * w, s.multiphysics.shaftElements[c.id].power, 1e-5);
      break;
    }
    default: throw Error(`Missing operating fixture for ${p.kind}`);
  }
  healthy(s, report);
});

// All 56 pairings run with their unchanged engineering properties. This is a
// short coupling check; small tanks with large heaters still need protection
// during long runs. Compare with the exact continuous two-node thermal ODE.
for (const heater of builtinPresets.filter(p => p.kind === 'heater'))
  for (const tank of builtinPresets.filter(p => p.kind === 'tank')) await record(`${heater.name} + ${tank.name}`, [heater, tank], report => {
    const b = fixture(), h = b.preset(heater), t = b.preset(tank), supply = source(b, h.props.ratedVoltage);
    b.series(supply, h); b.wire(h, 'heat', t, 'heat'); const s = simulation(b); run(s);
    const ce = h.props.heatCapacity, cw = t.props.volume / 1000 * rho20 * cp + t.props.vesselHeatCapacity;
    const ua = h.props.conductance, a = (ua + h.props.loss) / ce, d = (ua + t.props.loss) / cw;
    const bh = ua / ce, c = ua / cw, input = h.props.ratedPower / ce, det = a * d - bh * c;
    const x = input * d / det, y = input * c / det, trace = -(a + d) / 2, delta = Math.sqrt((a - d) ** 2 / 4 + bh * c);
    const rise = y - Math.exp(trace * s.time) * (y * Math.cosh(delta * s.time) + (c * x + (-d - trace) * y) * Math.sinh(delta * s.time) / delta);
    near(report, 'nominal heater electrical power (W)', h.props.ratedPower, s.electrical.readings[h.id].power);
    near(report, 'two-node analytic water rise (K)', rise, s.temperatures[t.id] - 20, 0.03, 0.002);
    healthy(s, report);
  });

// Actual preset combinations: distinguish nominal heater power from the power
// its chosen supply can deliver, and exercise a complete industrial feeder.
const named = name => { const p = builtinPresets.find(p => p.name === name); assert(p, `Missing preset ${name}`); return p; };
const bench = named('Bench CV/CC 30 V / 3 A'), labHeater = named('Lab element 100 W / 24 V');
for (const voltage of [12, 24]) await record(`Bench supply + 100 W heater, ${voltage} V command`, [bench, labHeater], report => {
  const b = fixture(), supply = b.preset(bench), heater = b.preset(labHeater), tank = b.preset(named('Beaker 1 L'));
  supply.props.voltage = voltage;
  b.series(supply, heater); b.wire(heater, 'heat', tank, 'heat'); const s = simulation(b);
  const current = Math.min(voltage / heater.props.resistance, supply.props.maxCurrent);
  near(report, 'available heater power (W)', current ** 2 * heater.props.resistance, s.electrical.readings[heater.id].power);
  assert.equal(s.electrical.readings[supply.id].regulation, voltage === 12 ? 'cv' : 'cc');
  run(s); healthy(s, report);
});
const feederPresets = ['DC supply 400 V / 100 A CV/CC', 'Power fuse 125 A', 'Contactor 400 V / 80 A', 'Cu 35 mm² · 50 m', 'Heating bank 30 kW / 400 V', 'Process tank 2,000 L'].map(named);
await record('30 kW industrial preset feeder and tank', feederPresets, report => {
  const b = fixture(), [supply, fuse, relay, cable, heater, tank] = feederPresets.map(p => b.preset(p));
  b.wire(supply, 'a', fuse, 'a'); b.wire(fuse, 'b', relay, 'a'); b.wire(relay, 'nc', cable, 'a');
  b.wire(cable, 'b', heater, 'a'); b.wire(heater, 'b', supply, 'b'); b.wire(heater, 'heat', tank, 'heat');
  const s = simulation(b), current = supply.props.voltage / [supply.props.internalResistance, fuse.props.resistance, relay.props.resistance, cable.props.resistance, heater.props.resistance].reduce((a, b) => a + b, 0);
  near(report, 'feeder current including all voltage drops (A)', current, s.electrical.readings[heater.id].current);
  near(report, 'actual heater power (W)', current ** 2 * heater.props.resistance, s.electrical.readings[heater.id].power);
  run(s); healthy(s, report);
});

const covered = new Set(reports.filter(r => r.pass).flatMap(r => r.presets));
const summary = { presets: builtinPresets.length, coveredPresets: covered.size, scenarios: reports.length, passed: reports.filter(r => r.pass).length, failed: reports.filter(r => !r.pass).length };
await writeFile('validation/presets.json', JSON.stringify({ summary, reports }, null, 2) + '\n');
console.log(JSON.stringify(summary));
if (summary.failed || summary.coveredPresets !== summary.presets) process.exitCode = 1;
