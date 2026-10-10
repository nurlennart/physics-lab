import { catalog, connect, makeComponent, uid, type Component, type Kind, type Project } from './model';
export type HydraulicMode = 'transfer' | 'pressure' | 'supply' | 'circulation';
export function industrialStarter(): Project {
  const p = hydraulicStarter('transfer');
  p.name = 'Industrial pumping station · 180 V';
  for (const c of p.components) {
    const variant = c.kind === 'motor' ? 'industrial180' : c.kind === 'pump' ? 'industrial' : c.kind === 'source' ? 'motorSupply' : undefined;
    if (variant) { c.variant = variant; c.props = { ...catalog(c).props }; }
    if (c.kind === 'tank') c.props = { ...c.props, volume: c.name === 'Source reservoir' ? 2000 : 0, capacity: c.name === 'Source reservoir' ? 2000 : 1000, surfaceArea: c.name === 'Source reservoir' ? 1 : 0.5, elevation: c.name === 'Source reservoir' ? 0 : 12 };
    if (c.kind === 'pipe') c.props = { ...c.props, diameter: 0.05, length: 30 };
    if (c.kind === 'valve') c.props.diameter = 0.05;
  }
  const motor = p.components.find(c => c.kind === 'motor')!, pump = p.components.find(c => c.kind === 'pump')!;
  p.probes!.push(
    { id: uid(), name: 'Motor RPM', component: motor.id, measurement: 'rpm', color: '#c5aaec', visible: true },
    { id: uid(), name: 'Shaft power', component: motor.id, measurement: 'shaftPower', color: '#e9bd6a', visible: true },
    { id: uid(), name: 'Hydraulic power', component: pump.id, measurement: 'hydraulicPower', color: '#59b99b', visible: true },
  );
  return p;
}
export function hydraulicStarter(mode: HydraulicMode, challenge = false): Project {
  let p: Project = { version: 3, id: uid(), name: mode === 'transfer' ? 'Water transfer laboratory' : mode === 'pressure' ? 'Pressure regulation laboratory' : mode === 'supply' ? 'Automatic water supply' : 'Heated circulation loop', components: [], connections: [], probes: [], assemblies: [], ...(challenge && mode !== 'circulation' ? { challenge: mode } : {}) };
  const add = (kind: Kind, x: number, y: number, props: Component['props'] = {}, name?: string) => {
    const c = makeComponent(kind, x, y, p.components); c.props = { ...c.props, ...props }; if (name) c.name = name; p.components.push(c); return c;
  };
  const wire = (a: Component, ap: string, b: Component, bp: string) => { p = connect(p, { component: a.id, port: ap }, { component: b.id, port: bp }); };
  const source = add('source', 40, 70), motor = add('motor', 300, 70), pump = add('pump', 300, 330);
  const tank = add('tank', 30, 340, { volume: 150, capacity: 150, ...(mode === 'circulation' ? { initialTemperature: 60 } : {}) }, 'Source reservoir');
  const destination = add('tank', 1010, 340, { volume: 0, capacity: 120, elevation: mode === 'pressure' || mode === 'circulation' ? 0 : 2 }, 'Destination tank');
  const pipe = add('pipe', 550, 330), valve = add('valve', 780, 330, {}, 'Delivery valve');
  wire(source, 'a', motor, 'a'); wire(motor, 'b', source, 'b'); wire(motor, 'shaft', pump, 'shaft');
  wire(tank, 'fluid', pump, 'inlet'); wire(pump, 'outlet', pipe, 'inlet'); wire(pipe, 'outlet', valve, 'inlet'); wire(valve, 'outlet', destination, 'fluid');
  if (mode === 'pressure') {
    const sense = add('pressureSensor', 540, 70, { target: pipe.id }), pi = add('pid', 790, 70, { kp: 0.06, ki: 0.08, maxOutput: 3500 });
    wire(sense, 'out', pi, 'in'); wire(pi, 'out', motor, 'speed');
    // Pressure target is pipe outlet upstream of consumer restriction.
    valve.props.opening = 40;
    valve.props.diameter = 0.018;
    const returnPipe = add('pipe', 1010, 650, { length: 1, diameter: 0.04 }, 'Return line');
    wire(destination, 'fluid', returnPipe, 'inlet'); wire(returnPipe, 'outlet', tank, 'fluid');
    valve.name = 'Consumer demand';
  }
  if (mode === 'supply') {
    const sensor = add('levelSensor', 30, 650, { target: destination.id }, 'Primary level sensor');
    const hysteresis = add('hysteresis', 280, 650, { low: 30, high: 90 });
    const lowSense = add('levelSensor', 30, 900, { target: tank.id }), lowGuard = add('comparator', 280, 900, { mode: 'gt', reference: 5 });
    const highSense = add('levelSensor', 530, 900, { target: destination.id }), highGuard = add('comparator', 780, 900, { mode: 'lt', reference: 95 });
    const interlock = add('and', 540, 650), protection = add('and', 790, 650);
    wire(sensor, 'out', hysteresis, 'in'); wire(lowSense, 'out', lowGuard, 'in'); wire(highSense, 'out', highGuard, 'in');
    wire(hysteresis, 'out', interlock, 'in'); wire(lowGuard, 'out', interlock, 'in2'); wire(interlock, 'out', protection, 'in'); wire(highGuard, 'out', protection, 'in2'); wire(protection, 'out', motor, 'enable');
    const drain = add('valve', 1010, 650, { diameter: 0.012, opening: 35 }, 'Consumer demand');
    wire(destination, 'fluid', drain, 'inlet'); wire(drain, 'outlet', tank, 'fluid');
  }
  if (mode === 'circulation') {
    destination.props.volume = 50;
    // Tall vessels provide enough return head for a sustained loop without filling the receiver.
    tank.props.surfaceArea = 0.02;
    destination.props.surfaceArea = 0.02;
    destination.props.capacity = 200;
    const returnPipe = add('pipe', 750, 650, { length: 10, thermalUA: 30 }), heater = add('heater', 40, 70 + 580), heaterSource = add('source', 300, 650, { voltage: 120 });
    wire(destination, 'fluid', returnPipe, 'inlet'); wire(returnPipe, 'outlet', tank, 'fluid');
    wire(heaterSource, 'a', heater, 'a'); wire(heater, 'b', heaterSource, 'b'); wire(heater, 'heat', tank, 'heat');
  }
  p.probes = [
    { id: uid(), name: 'Destination level', component: destination.id, measurement: 'level', color: '#59b99b', visible: true },
    { id: uid(), name: 'Delivery flow', component: pipe.id, measurement: 'flow', color: '#3ba6d8', visible: true },
    { id: uid(), name: 'Motor current', component: motor.id, measurement: 'current', color: '#e9bd6a', visible: true },
    { id: uid(), name: 'Delivery pressure', component: pipe.id, measurement: 'pressure', color: '#a58ae3', visible: true },
    { id: uid(), name: 'Destination water', component: destination.id, measurement: 'fluidTemperature', color: '#ef9975', visible: true },
  ];
  if (mode === 'circulation') p.probes.push(
    { id: uid(), name: 'Source water', component: tank.id, measurement: 'fluidTemperature', color: '#e9bd6a', visible: true },
  );
  // Scored assignments provide an editable physical scaffold, but the learner wires it.
  if (challenge) p.connections = [];
  return p;
}

/** Two finite gravity-fed streams recover heat without mixing their water. */
export function heatExchangerStarter(): Project {
  let p: Project = { version: 3, id: uid(), name: 'Heat exchanger · waste heat recovery', components: [], connections: [], probes: [], assemblies: [] };
  const add = (kind: Kind, x: number, y: number, props: Component['props'], name: string) => {
    const c = makeComponent(kind, x, y, p.components);
    c.name = name; c.props = { ...c.props, ...props }; p.components.push(c); return c;
  };
  const source = { capacity: 2000, volume: 1500, surfaceArea: 1, elevation: 5, loss: 0 };
  const sink = { capacity: 2000, volume: 0, surfaceArea: 1, elevation: 0, loss: 0 };
  const hot = add('tank', 30, 40, { ...source, initialTemperature: 80 }, 'Hot feed · 80 °C');
  const cold = add('tank', 1050, 440, { ...source, initialTemperature: 10 }, 'Cold feed · 10 °C');
  const hotSink = add('tank', 1050, 40, { ...sink, initialTemperature: 80 }, 'Cooled hot water');
  const coldSink = add('tank', 30, 440, { ...sink, initialTemperature: 10 }, 'Warmed cold water');
  const hotPipe = add('pipe', 310, 120, { diameter: 0.05, length: 10, inventory: false }, 'Hot feed pipe');
  const coldPipe = add('pipe', 790, 480, { diameter: 0.05, length: 10, inventory: false }, 'Cold feed pipe');
  const hx = add('heatExchanger', 570, 250, { ua: 5000, diameter: 0.05, lossCoefficient: 2 }, 'HX-01');
  const wire = (a: Component, ap: string, b: Component, bp: string) => { p = connect(p, { component: a.id, port: ap }, { component: b.id, port: bp }); };
  wire(hot, 'fluid', hotPipe, 'inlet'); wire(hotPipe, 'outlet', hx, 'hotIn'); wire(hx, 'hotOut', hotSink, 'fluid');
  wire(cold, 'fluid', coldPipe, 'inlet'); wire(coldPipe, 'outlet', hx, 'coldIn'); wire(hx, 'coldOut', coldSink, 'fluid');
  p.probes = [
    { id: uid(), name: 'Cooled hot water', component: hotSink.id, measurement: 'fluidTemperature', color: '#ef9975', visible: true },
    { id: uid(), name: 'Warmed cold water', component: coldSink.id, measurement: 'fluidTemperature', color: '#59b99b', visible: true },
    { id: uid(), name: 'Recovered heat', component: hx.id, measurement: 'heatDuty', color: '#e9bd6a', visible: true },
    { id: uid(), name: 'Hot stream flow', component: hotPipe.id, measurement: 'flow', color: '#c5aaec', visible: true },
    { id: uid(), name: 'Cold stream flow', component: coldPipe.id, measurement: 'flow', color: '#3ba6d8', visible: true },
  ];
  return p;
}
