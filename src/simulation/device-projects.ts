import { applyDerived } from './parameters';
import { connect, makeComponent, prop, uid, type Kind, type Component, type Project, type Property, type Measurement } from './model';
export type DeviceMode = 'battery' | 'capacitor' | 'inductor' | 'contactor' | 'transformer' | 'radiator' | 'circulator' | 'boiler' | 'kermi' | 'sealedBoiler';
export function deviceStarter(mode: DeviceMode): Project {
  let p: Project = { version: 3, id: uid(), name: ({ battery: 'Finite battery discharge', capacitor: 'Charging a capacitor', inductor: 'Switching an inductor', contactor: 'Powering a contactor', transformer: 'Isolated AC conversion', radiator: 'Cooling water with a fan', boiler: 'Bosch boiler and ALPHA2 heating loop', sealedBoiler: 'Sealed boiler circuit: expansion vessel and safety valve', kermi: 'Bosch boiler, ALPHA2 and Kermi radiator', circulator: 'Circulating heat with an electric pump' })[mode], components: [], connections: [], probes: [], assemblies: [] };
  const add = (kind: Kind, x: number, y: number, props: Record<string, Property> = {}) => { const c = makeComponent(kind, x, y, p.components); c.props = applyDerived(kind, { ...c.props, ...props }); p.components.push(c); return c; };
  const wire = (a: Component, ap: string, b: Component, bp: string) => { p = connect(p, { component: a.id, port: ap }, { component: b.id, port: bp }); };
  const trace = (c: Component, measurement: Measurement, name: string, color = '#22c55e') => p.probes!.push({ id: uid(), component: c.id, measurement, name, color, visible: true });
  // Pressure equipment of a sealed boiler circuit (the TH3000 has none built in): a membrane vessel on the pump suction
  // and a 3 bar safety valve at the boiler flow.
  const pressureEquipment = (boiler: Component, suction: Component, liters = 12) => {
    const vessel = add('expansionVessel', 640, 850, { nominalVolume: liters }); vessel.name = `Expansion vessel · ${liters} L`; if (liters === 12) vessel.variant = 'generic12';
    const relief = add('safetyValve', 40, 520); relief.name = 'Safety valve · 3 bar';
    wire(vessel, 'fluid', suction, 'outlet'); wire(relief, 'inlet', boiler, 'outlet');
    return { vessel, relief };
  };
  if (mode === 'boiler') {
    const phases = [0, -120, 120].map((phase, i) => {
      const c = add('sourceAC', 40 + i * 280, 45, { voltage: 230, phase, maxCurrent: 16, maxPower: 3680 }); c.name = `Mains L${i + 1} · ${phase}°`; return c;
    });
    const boiler = add('electricBoiler', 330, 330, { flowInterlock: true }); boiler.name = 'Bosch TH3000 9 · 3.7 L';
    const earth = add('ground', 900, 45), target = add('constant', 40, 330, { value: 60 }); target.name = 'Supply target · °C';
    const pump = add('circulator', 330, 650, { headSetpoint: 3 }); pump.name = 'ALPHA2 25-60 · PP 3 m';
    const supply = add('pipe', 640, 330, { diameter: 0.02, length: 8, thermalUA: 2, segments: 4 }); supply.name = 'Insulated supply · 8 m';
    const radiator = add('radiator', 930, 330, { naturalUA: 100, forcedUA: 0 }); radiator.name = 'Radiator · 100 W/K';
    const valve = add('valve', 930, 650, { diameter: 0.02 }); valve.name = 'Balancing valve';
    const back = add('pipe', 640, 650, { diameter: 0.02, length: 8, thermalUA: 2, segments: 4 }); back.name = 'Insulated return · 8 m';
    // One sealed filled circuit. The boiler's pressure datum represents an externally precharged compliant
    // expansion connection; no water is supplied or drained there. See the model limitations.
    for (let i = 0; i < 3; i++) { wire(phases[i], 'a', boiler, `L${i + 1}`); wire(phases[i], 'b', boiler, 'N'); }
    wire(earth, 'a', boiler, 'PE'); wire(phases[0], 'a', pump, 'a'); wire(phases[0], 'b', pump, 'b');
    wire(target, 'out', boiler, 'setpoint');
    wire(boiler, 'outlet', supply, 'inlet'); wire(supply, 'outlet', radiator, 'inlet'); wire(radiator, 'outlet', valve, 'inlet');
    wire(valve, 'outlet', back, 'inlet'); wire(back, 'outlet', pump, 'inlet'); wire(pump, 'outlet', boiler, 'inlet');
    trace(boiler, 'fluidTemperature', 'Boiler supply', '#ef4444'); trace(boiler, 'returnTemperature', 'Boiler return', '#38bdf8');
    trace(boiler, 'elementTemperature', 'Immersed elements', '#f59e0b'); trace(boiler, 'heatingPower', 'Element input', '#eab308');
    trace(boiler, 'heatingStages', 'Active stages', '#a78bfa'); trace(pump, 'flow', 'Loop flow', '#06b6d4');
    trace(pump, 'power', 'Circulator input', '#22c55e'); trace(radiator, 'heatDuty', 'Radiator heat output', '#f97316');
    const { vessel } = pressureEquipment(boiler, back); trace(vessel, 'pressure', 'System pressure', '#8CC6F8');
    trace(boiler, 'energyResidual', 'Energy balance residual', '#94a3b8');
  } else if (mode === 'sealedBoiler') {
    // The boiler charges a 123 L buffer to 75 °C. A Reflex N 25 holds the expansion (≈ 3 L) below 2.5 bar; with a
    // 12 L vessel, a flat vessel or a lost cushion the 3 bar safety valve opens.
    const phases = [0, -120, 120].map((phase, i) => {
      const c = add('sourceAC', 40 + i * 280, 45, { voltage: 230, phase, maxCurrent: 16, maxPower: 3680 }); c.name = `Mains L${i + 1} · ${phase}°`; return c;
    });
    const boiler = add('electricBoiler', 330, 330, { flowInterlock: true }); boiler.name = 'Bosch TH3000 9 · 3.7 L';
    const earth = add('ground', 900, 45), target = add('constant', 40, 330, { value: 75 }); target.name = 'Supply target · °C';
    const pump = add('circulator', 330, 650, { headSetpoint: 3 }); pump.name = 'ALPHA2 25-60 · PP 3 m';
    const supply = add('pipe', 640, 330, { diameter: 0.022, length: 6, thermalUA: 1.5, segments: 3 }); supply.name = 'Insulated flow · 6 m';
    const buffer = add('storageTank', 930, 420); buffer.name = 'Bosch BH 120-5 · 123 L buffer';
    const back = add('pipe', 640, 650, { diameter: 0.022, length: 6, thermalUA: 1.5, segments: 3 }); back.name = 'Insulated return · 6 m';
    for (let i = 0; i < 3; i++) { wire(phases[i], 'a', boiler, `L${i + 1}`); wire(phases[i], 'b', boiler, 'N'); }
    wire(earth, 'a', boiler, 'PE'); wire(phases[0], 'a', pump, 'a'); wire(phases[0], 'b', pump, 'b');
    wire(target, 'out', boiler, 'setpoint');
    wire(boiler, 'outlet', supply, 'inlet'); wire(supply, 'outlet', buffer, 'p1'); wire(buffer, 'p2', back, 'inlet'); wire(back, 'outlet', pump, 'inlet'); wire(pump, 'outlet', boiler, 'inlet');
    const vessel = add('expansionVessel', 640, 850); vessel.name = 'Reflex N 25 · 1.5 bar';
    const relief = add('safetyValve', 40, 520); relief.name = 'Safety valve · 3 bar';
    wire(vessel, 'fluid', back, 'outlet'); wire(relief, 'inlet', boiler, 'outlet');
    trace(vessel, 'pressure', 'System pressure at the vessel', '#8CC6F8'); trace(boiler, 'pressure', 'Pressure at the boiler flow', '#38bdf8');
    trace(vessel, 'expansionVolume', 'Thermal expansion', '#a78bfa'); trace(vessel, 'vesselWater', 'Water in the vessel', '#06b6d4');
    trace(relief, 'dischargedVolume', 'Safety valve discharge', '#ef4444'); trace(boiler, 'fluidTemperature', 'Boiler flow', '#f97316');
    trace(buffer, 'topTemperature', 'Buffer top', '#f59e0b'); trace(buffer, 'bottomTemperature', 'Buffer lower sensor', '#38bdf8'); trace(buffer, 'storedHeat', 'Stored heat', '#d2a8ff');
    trace(boiler, 'energyResidual', 'Energy balance residual', '#94a3b8');
  } else if (mode === 'kermi') {
    // A one-radiator heating circuit: the boiler is limited to one 3 kW stage, the lockshield valve is preset for
    // about the radiator's nominal flow (143 kg/h, 10 K spread at Φ₅₀; 146 kg/h here) at the pump's proportional-pressure head.
    const phases = [0, -120, 120].map((phase, i) => {
      const c = add('sourceAC', 40 + i * 280, 45, { voltage: 230, phase, maxCurrent: 16, maxPower: 3680 }); c.name = `Mains L${i + 1} · ${phase}°`; return c;
    });
    const boiler = add('electricBoiler', 330, 330, { flowInterlock: true, maxStages: 1 }); boiler.name = 'Bosch TH3000 9 · 3 kW';
    const earth = add('ground', 900, 45), target = add('constant', 40, 330, { value: 60 }); target.name = 'Supply target · °C';
    const pump = add('circulator', 330, 650, { headSetpoint: 2 }); pump.name = 'ALPHA2 25-60 · PP 2 m';
    const supply = add('pipe', 640, 330, { diameter: 0.016, length: 6, thermalUA: 1.5, segments: 4 }); supply.name = 'Insulated supply · 6 m';
    const radiator = add('panelRadiator', 930, 330); radiator.name = 'Kermi 22 · 600×1000';
    const valve = add('valve', 930, 650, { diameter: 0.015, opening: 12 }); valve.name = 'Lockshield · 12 %';
    const back = add('pipe', 640, 650, { diameter: 0.016, length: 6, thermalUA: 1.5, segments: 4 }); back.name = 'Insulated return · 6 m';
    for (let i = 0; i < 3; i++) { wire(phases[i], 'a', boiler, `L${i + 1}`); wire(phases[i], 'b', boiler, 'N'); }
    wire(earth, 'a', boiler, 'PE'); wire(phases[0], 'a', pump, 'a'); wire(phases[0], 'b', pump, 'b');
    wire(target, 'out', boiler, 'setpoint');
    wire(boiler, 'outlet', supply, 'inlet'); wire(supply, 'outlet', radiator, 'inlet'); wire(radiator, 'outlet', valve, 'inlet');
    wire(valve, 'outlet', back, 'inlet'); wire(back, 'outlet', pump, 'inlet'); wire(pump, 'outlet', boiler, 'inlet');
    trace(radiator, 'supplyTemperature', 'Radiator supply', '#ef4444'); trace(radiator, 'returnTemperature', 'Radiator return', '#38bdf8');
    trace(radiator, 'fluidTemperature', 'Radiator mean water', '#f59e0b'); trace(radiator, 'heatDuty', 'Radiator heat output', '#f97316');
    trace(radiator, 'heatInput', 'Water heat input ṁ·c·ΔT', '#a78bfa'); trace(radiator, 'excessTemperature', 'Excess temperature ΔT', '#eab308');
    trace(radiator, 'flow', 'Radiator flow', '#06b6d4');
    trace(boiler, 'heatingPower', 'Boiler element input', '#facc15'); trace(pump, 'power', 'Circulator input', '#22c55e');
    const { vessel: kv } = pressureEquipment(boiler, back); trace(kv, 'pressure', 'System pressure', '#8CC6F8');
    trace(boiler, 'energyResidual', 'Energy balance residual', '#94a3b8');
  } else if (mode === 'battery') {
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
  } else if (mode === 'circulator') {
    // A boiler loop on one 230 V supply: a 1.5 kW element heats a 50 L vessel (the open expansion tank); the circulator
    // pushes water through a 15 m emitter pipe that gives off 40 W/K (a radiator stand-in) and a throttling valve
    // (thermostatic radiator valves closing). Equilibrium is about 37 K above ambient.
    const supply = add('sourceAC', 380, 80, { voltage: 230 }), heater = add('heater', 40, 80, { ratedVoltage: 230, ratedPower: 1500, heatCapacity: 225, conductance: 135, loss: 0.15 });
    const boiler = add('tank', 30, 330, { capacity: 60, volume: 50, surfaceArea: 0.12, loss: 0.5 }), pump = add('circulator', 380, 380);
    const emitter = add('pipe', 680, 380, { diameter: 0.02, length: 15, thermalUA: 40, segments: 6 }), valve = add('valve', 680, 630, { diameter: 0.02 }), back = add('pipe', 380, 630, { diameter: 0.02, length: 15, segments: 4 });
    wire(supply, 'a', pump, 'a'); wire(pump, 'b', supply, 'b'); wire(supply, 'a', heater, 'a'); wire(heater, 'b', supply, 'b'); wire(heater, 'heat', boiler, 'heat');
    wire(boiler, 'fluid', pump, 'inlet'); wire(pump, 'outlet', emitter, 'inlet'); wire(emitter, 'outlet', valve, 'inlet'); wire(valve, 'outlet', back, 'inlet'); wire(back, 'outlet', boiler, 'fluid');
    trace(pump, 'flow', 'Circulated flow', '#38bdf8'); trace(pump, 'differentialPressure', 'Pump Δp (rise negative)', '#a78bfa'); trace(pump, 'power', 'Pump input P1', '#f59e0b');
    trace(pump, 'efficiency', 'Wire-to-water efficiency', '#22c55e'); trace(boiler, 'temperature', 'Boiler temperature', '#ef4444');
  } else {
    const hot = add('tank', 50, 80, { capacity: 2000, volume: 1000, surfaceArea: 1, elevation: 2, initialTemperature: 60, loss: 0 }), cold = add('tank', 680, 80, { capacity: 2000, volume: 500, surfaceArea: 1, loss: 0 });
    const radiator = add('radiator', 370, 130), supply = add('source', 50, 400, { voltage: 24 });
    wire(hot, 'fluid', radiator, 'inlet'); wire(radiator, 'outlet', cold, 'fluid'); wire(supply, 'a', radiator, 'a'); wire(radiator, 'b', supply, 'b');
    trace(radiator, 'fluidTemperature', 'Radiator outlet'); trace(radiator, 'heatDuty', 'Heat rejected', '#ef4444'); trace(radiator, 'fanPower', 'Fan power', '#f59e0b'); trace(radiator, 'flow', 'Water flow', '#38bdf8');
  }
  return p;
}
