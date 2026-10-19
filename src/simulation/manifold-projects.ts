import { applyDerived } from './parameters';
import { connect, makeComponent, uid, type Component, type Kind, type Measurement, type Project, type Property } from './model';
import { makeEnvelope, makeThermalSpace, type ThermalElement, type ThermalSpace } from './thermal-spaces';
import { GROUND, defaultSlab } from './ground';

export const manifoldTitle = 'Underfloor manifold: three rooms';
/**
 * A three-room flat (living room, bedroom, bathroom; slabs on the ground, shared interior walls) heated by underfloor
 * loops of different lengths from an Oventrop Multidis SF manifold. A Bosch electric boiler holds 35 °C flow; an ALPHA2
 * at 3 m constant pressure circulates. Each room thermostat drives its circuit's thermal actuator, a minimum-flow bypass
 * keeps the boiler's flow interlock satisfied when every circuit is closed. The inserts start fully open (unbalanced).
 */
export function manifoldStarter(): Project {
  let p: Project = { version: 5, id: uid(), name: manifoldTitle, components: [], connections: [], probes: [], assemblies: [], environment: { ambient: 0 } };
  const add = (kind: Kind, x: number, y: number, props: Record<string, Property> = {}, name?: string, variant?: string) => {
    const c = makeComponent(kind, x, y, p.components); if (variant) c.variant = variant; c.props = applyDerived(kind, { ...c.props, ...props }); if (name) c.name = name; p.components.push(c); return c;
  };
  const wire = (a: Component, ap: string, b: Component, bp: string) => { p = connect(p, { component: a.id, port: ap }, { component: b.id, port: bp }); };
  const trace = (c: { id: string }, measurement: Measurement, name: string, color: string, space = false) =>
    p.probes!.push({ id: uid(), component: c.id, measurement, name, color, visible: true, ...(space ? { targetKind: 'space' as const } : {}) });

  // Rooms side by side (plan: 100 canvas units per metre). Living 5 × 4 m, bedroom 4 × 3.5 m, bathroom 2.5 × 3 m.
  const room = (name: string, x: number, width: number, length: number, initial: number) =>
    Object.assign(makeThermalSpace(x, 740, width, length), { name, initialTemperature: initial, airChangesPerHour: 0.5, addedHeatCapacity: width * length * 50000 });
  const living = room('Living room', 900, 5, 4, 19), bedroom = room('Bedroom', 1400, 4, 3.5, 17), bath = room('Bathroom', 1800, 2.5, 3, 21);
  const shared = [[living, bedroom, 3.5], [bedroom, bath, 3]] as const;
  const elements: ThermalElement[] = [];
  for (const r of [living, bedroom, bath]) {
    const exposed = 2 * (r.width + r.length) - shared.reduce((sum, [a, b, l]) => sum + (a === r || b === r ? l : 0), 0);
    for (const e of makeEnvelope(r)) {
      if (e.kind === 'floor') { elements.push({ ...e, to: GROUND, uValue: 0.3, slab: { ...defaultSlab(), perimeter: exposed } }); continue; }
      const east = shared.find(([a]) => a === r), west = shared.find(([, b]) => b === r);
      if (e.side === 'west' && west) continue; // replaced by the shared partition
      if (e.side === 'east' && east) { elements.push({ ...e, area: (r.length - east[2]) * r.height, uValue: 0.28 }); continue; }
      elements.push(e.kind === 'wall' ? { ...e, uValue: 0.28 } : e);
    }
  }
  for (const [a, b, l] of shared) elements.push({ id: uid(), name: `Wall ${a.name} / ${b.name}`, kind: 'wall', from: a.id, to: b.id, area: l * a.height, uValue: 1.5, heatCapacity: 0, preset: 'Illustrative 115 mm interior wall (plastered)' });
  const window = (r: ThermalSpace, area: number) => { const north = elements.find(e => e.from === r.id && e.side === 'north')!; elements.push({ id: uid(), name: `${r.name} window`, kind: 'window', from: r.id, to: 'outdoors', area, parentId: north.id, uValue: 1.1, heatCapacity: 0, preset: 'Illustrative modern glazing' }); };
  window(living, 3); window(bedroom, 1.5); window(bath, 0.6);
  p.thermalSpaces = [living, bedroom, bath]; p.thermalElements = elements;

  // Heat source: Bosch TH3000 at 35 °C flow, ALPHA2 at 3 m constant pressure, sealed circuit with vessel and safety valve.
  const phases = [0, -120, 120].map((phase, i) => add('sourceAC', 40 + i * 280, 45, { voltage: 230, phase, maxCurrent: 16, maxPower: 3680 }, `Mains L${i + 1} · ${phase}°`));
  const boiler = add('electricBoiler', 330, 330, { flowInterlock: true }, 'Bosch TH3000 9 · 3.7 L');
  const earth = add('ground', 900, 45), target = add('constant', 40, 330, { value: 35 }, 'Flow target · °C');
  const pump = add('circulator', 330, 650, { headSetpoint: 3 }, 'ALPHA2 25-60 · CP 3 m');
  const supply = add('pipe', 640, 330, { diameter: 0.022, length: 6, thermalUA: 1, segments: 2 }, 'Insulated flow · 6 m');
  const back = add('pipe', 640, 650, { diameter: 0.022, length: 6, thermalUA: 1, segments: 2 }, 'Insulated return · 6 m');
  const manifold = add('heatingManifold', 960, 500, { circuits: 3, planned1: 1.8, planned2: 1.3, planned3: 0.7 }, 'Oventrop Multidis SF · 3 circuits', 'standard');
  const bypass = add('valve', 480, 910, { diameter: 0.015, lossCoefficient: 100, opening: 100 }, 'Minimum-flow bypass');
  for (let i = 0; i < 3; i++) { wire(phases[i], 'a', boiler, `L${i + 1}`); wire(phases[i], 'b', boiler, 'N'); }
  wire(earth, 'a', boiler, 'PE'); wire(phases[0], 'a', pump, 'a'); wire(phases[0], 'b', pump, 'b'); wire(target, 'out', boiler, 'setpoint');
  wire(boiler, 'outlet', supply, 'inlet'); wire(supply, 'outlet', manifold, 'supply'); wire(manifold, 'return', back, 'inlet');
  wire(back, 'outlet', pump, 'inlet'); wire(pump, 'outlet', boiler, 'inlet');
  wire(boiler, 'outlet', bypass, 'inlet'); wire(bypass, 'outlet', pump, 'inlet');
  const vessel = add('expansionVessel', 640, 850, { nominalVolume: 12 }, 'Expansion vessel · 12 L', 'generic12'), relief = add('safetyValve', 40, 520, {}, 'Safety valve · 3 bar');
  wire(vessel, 'fluid', back, 'outlet'); wire(relief, 'inlet', boiler, 'outlet');

  // One loop per room (EN 1264 practice: at most about 120 m per 16 mm loop). Lengths differ, so unbalanced the short
  // bathroom loop takes the most water.
  const loops: { r: ThermalSpace; x: number; props: Record<string, number>; name: string; setpoint: number }[] = [
    { r: living, x: 930, props: { heatedArea: 18, pipeSpacing: 0.15, initialTemperature: 22 }, name: 'Living room floor · 120 m', setpoint: 21 },
    { r: bedroom, x: 1430, props: { heatedArea: 12, pipeSpacing: 0.15, initialTemperature: 20 }, name: 'Bedroom floor · 80 m', setpoint: 18 },
    { r: bath, x: 1838, props: { heatedArea: 6, pipeSpacing: 0.1, coveringResistance: 0, initialTemperature: 24 }, name: 'Bathroom floor (tiles) · 60 m', setpoint: 24 },
  ];
  loops.forEach(({ r, x, props, name, setpoint }, i) => {
    const floor = add('underfloorHeating', x, 890, { ...props, length: (props.heatedArea as number) / (props.pipeSpacing as number) }, name);
    floor.thermalSpaceId = r.id; floor.thermalSpacePinned = true;
    wire(manifold, `flow${i + 1}`, floor, 'inlet'); wire(floor, 'outlet', manifold, `return${i + 1}`);
    const stat = add('thermostat', x, 752, { target: r.id, setpoint, hysteresis: 0.5 }, `${r.name} thermostat · ${setpoint} °C`);
    wire(stat, 'out', manifold, `act${i + 1}`);
    trace(r, 'roomTemperature', `${r.name} air`, ['#F59B85', '#C4B0FC', '#8CC6F8'][i], true);
    trace(floor, 'flow', `${r.name} circuit flow`, ['#F5A524', '#D2A8FF', '#5EC8E5'][i]);
  });
  trace(manifold, 'differentialPressure', 'Manifold Δp', '#9AA6B6'); trace(manifold, 'flow', 'Manifold total flow', '#7EE0B5');
  trace(boiler, 'fluidTemperature', 'Boiler flow', '#ef4444'); trace(boiler, 'heatingPower', 'Element input', '#eab308');
  trace(boiler, 'energyResidual', 'Energy balance residual', '#94a3b8');
  return p;
}
