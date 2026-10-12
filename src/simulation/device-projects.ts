import { connect, makeComponent, prop, uid, type Kind, type Component, type Project, type Property, type Measurement } from './model';
export type DeviceMode = 'battery' | 'capacitor' | 'inductor' | 'contactor' | 'transformer' | 'radiator';
export function deviceStarter(mode: DeviceMode): Project {
  let p: Project = { version: 3, id: uid(), name: ({ battery: 'Finite battery discharge', capacitor: 'Charging a capacitor', inductor: 'Switching an inductor', contactor: 'Powering a contactor', transformer: 'Isolated AC conversion', radiator: 'Cooling water with a fan' })[mode], components: [], connections: [], probes: [], assemblies: [] };
  const add = (kind: Kind, x: number, y: number, props: Record<string, Property> = {}) => { const c = makeComponent(kind, x, y, p.components); c.props = { ...c.props, ...props }; p.components.push(c); return c; };
  const wire = (a: Component, ap: string, b: Component, bp: string) => { p = connect(p, { component: a.id, port: ap }, { component: b.id, port: bp }); };
  const trace = (c: Component, measurement: Measurement, name: string, color = '#22c55e') => p.probes!.push({ id: uid(), component: c.id, measurement, name, color, visible: true });
  if (mode === 'battery') {
    const battery = add('battery', 70, 130, { capacityAh: 0.2 }), load = add('resistor', 420, 130, { resistance: 6 });
    wire(battery, 'a', load, 'a'); wire(load, 'b', battery, 'b'); trace(battery, 'stateOfCharge', 'State of charge'); trace(battery, 'chemicalEnergy', 'Chemical energy'); trace(load, 'power', 'Load power', '#f59e0b');
  } else if (mode === 'capacitor') {
    // τ = C·(R ∥ R_bleed) ≈ 0.91 s charging toward 12 V·10/11; open the switch to discharge through the bleeder (τ = 10 s).
    const source = add('source', 50, 130, { voltage: 12 }), sw = add('switch', 300, 130), resistor = add('resistor', 550, 130, { resistance: 1000 });
    const cap = add('capacitor', 820, 300, { capacitance: 0.001, ratedVoltage: 25 }), bleeder = add('resistor', 550, 420, { resistance: 10000 });
    wire(source, 'a', sw, 'a'); wire(sw, 'b', resistor, 'a'); wire(resistor, 'b', cap, 'a'); wire(cap, 'b', source, 'b');
    wire(resistor, 'b', bleeder, 'a'); wire(bleeder, 'b', source, 'b');
    trace(cap, 'chargeVoltage', 'Capacitor voltage'); trace(cap, 'current', 'Charging current', '#38bdf8'); trace(cap, 'fieldEnergy', 'Stored energy', '#f59e0b');
  } else if (mode === 'inductor') {
    // τ = L/R ≈ 0.1 s while switched on; opening the switch lets the current freewheel through 100 Ω (τ = 10 ms).
    const source = add('source', 50, 130, { voltage: 12 }), sw = add('switch', 300, 130), resistor = add('resistor', 550, 130, { resistance: 10 });
    const coil = add('inductor', 820, 300, { inductance: 1, resistance: 0.5, ratedCurrent: 2 }), freewheel = add('resistor', 550, 420, { resistance: 100 });
    wire(source, 'a', sw, 'a'); wire(sw, 'b', resistor, 'a'); wire(resistor, 'b', coil, 'a'); wire(coil, 'b', source, 'b');
    wire(resistor, 'b', freewheel, 'a'); wire(freewheel, 'b', source, 'b');
    trace(coil, 'current', 'Inductor current', '#38bdf8'); trace(coil, 'fieldEnergy', 'Stored energy', '#f59e0b'); trace(freewheel, 'power', 'Freewheel power', '#ef4444');
  } else if (mode === 'contactor') {
    const power = add('sourceAC', 50, 70, { voltage: 24 }), contactor = add('contactor', 350, 70), load = add('resistor', 650, 70, { resistance: 24 });
    const coil = add('source', 50, 340, { voltage: 24 }), sw = add('switch', 350, 340);
    wire(power, 'a', contactor, 'a'); wire(contactor, 'b', load, 'a'); wire(load, 'b', power, 'b');
    wire(coil, 'a', sw, 'a'); wire(sw, 'b', contactor, 'ca'); wire(contactor, 'cb', coil, 'b');
    trace(contactor, 'coilVoltage', 'Coil voltage'); trace(contactor, 'state', 'Main contact'); trace(load, 'power', 'Load power', '#f59e0b');
  } else if (mode === 'transformer') {
    const source = add('sourceAC', 50, 130, { voltage: 230 }), transformer = add('transformer', 350, 130), load = add('resistor', 650, 130, { resistance: 24 });
    wire(source, 'a', transformer, 'a'); wire(transformer, 'b', source, 'b'); wire(transformer, 'sa', load, 'a'); wire(load, 'b', transformer, 'sb');
    trace(transformer, 'secondaryVoltage', 'Secondary RMS voltage'); trace(load, 'power', 'Load power', '#f59e0b'); trace(transformer, 'bodyTemperature', 'Transformer temperature', '#ef4444');
  } else {
    const hot = add('tank', 50, 80, { capacity: 2000, volume: 1000, surfaceArea: 1, elevation: 2, initialTemperature: 60, loss: 0 }), cold = add('tank', 680, 80, { capacity: 2000, volume: 500, surfaceArea: 1, loss: 0 });
    const radiator = add('radiator', 370, 130), supply = add('source', 50, 400, { voltage: 24 });
    wire(hot, 'fluid', radiator, 'inlet'); wire(radiator, 'outlet', cold, 'fluid'); wire(supply, 'a', radiator, 'a'); wire(radiator, 'b', supply, 'b');
    trace(radiator, 'fluidTemperature', 'Radiator outlet'); trace(radiator, 'heatDuty', 'Heat rejected', '#ef4444'); trace(radiator, 'fanPower', 'Fan power', '#f59e0b'); trace(radiator, 'flow', 'Water flow', '#38bdf8');
  }
  return p;
}
