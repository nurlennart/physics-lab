/**
 * Component presets: named engineering configurations of an existing physical
 * model. A preset is only data (base catalog variant + property values); it never
 * bypasses validation. Applying it in a scored challenge is rejected unless the
 * result equals a purchasable catalog model.
 */
import { catalog, definitions, type Component, type Kind, type Property } from "./model";
import { applyDerived } from "./parameters";
import { componentError } from "./integrity";

export type Family = "Laboratory" | "General-purpose" | "Industrial" | "High-capacity" | "Custom";
export interface ComponentPreset {
  id: string;
  name: string;
  kind: Kind;
  family: Family;
  /** Catalog variant the configuration starts from. */
  base: string;
  props: Record<string, Property>;
  note?: string;
  builtin?: boolean;
}
const preset = (kind: Kind, family: Family, name: string, props: Record<string, Property>, note?: string, base = "standard"): ComponentPreset =>
  ({ id: `builtin:${kind}:${name}`, name, kind, family, base, props, note, builtin: true });
/** Heater scaling at constant surface loading: UA ≈ 0.09 W/K per W, element mass ≈ 0.15 J/K per W. */
const heater = (family: Family, name: string, voltage: number, power: number, note?: string) =>
  preset("heater", family, name, { ratedVoltage: voltage, ratedPower: power, heatCapacity: Math.max(10, 0.15 * power), conductance: Math.max(5, 0.09 * power), loss: Math.max(0.1, power / 10000), maxTemperature: power >= 6000 ? 200 : 150 }, note);
const equivalent = "Single resistive equivalent at the stated DC/single-phase voltage. Three-phase banks are not solved as three-phase networks.";
/** Cylindrical tank with an insulated wall. */
const tank = (family: Family, name: string, capacity: number, volume: number, diameter: number, vessel: number, insulation: number) =>
  preset("tank", family, name, { capacity, volume, surfaceArea: Math.round(Math.PI * diameter * diameter / 4 * 1000) / 1000, vesselHeatCapacity: vessel, lossModel: insulation > 0 ? "insulation" : "manual", insulationThickness: insulation || 0.05, insulationConductivity: 0.04, ...(insulation > 0 ? {} : { loss: 2.2 * Math.sqrt(capacity / 20) }) });
const cable = (area: number, length: number, material: "copper" | "aluminium" = "copper") =>
  preset("cable", area < 10 ? "General-purpose" : "Industrial", `${material === "copper" ? "Cu" : "Al"} ${area} mm² · ${length} m`, { material, area, length, ratedCurrent: Math.round(13.5 * area ** 0.625 * (material === "copper" ? 1 : 0.78) * 10) / 10, maxTemperature: area < 10 ? 70 : 90 });
const pipe = (dn: number, length: number, family: Family) =>
  preset("pipe", family, `DN${dn} · ${length} m steel`, { diameter: dn / 1000, length, roughness: 0.000045, material: "steel", maxPressure: dn >= 100 ? 1600000 : 1000000 });

export const builtinPresets: ComponentPreset[] = [
  preset("battery", "Laboratory", "12 V rechargeable · 20 Ah", {}),
  preset("battery", "Industrial", "48 V rechargeable · 100 Ah", { capacityAh: 100, chemistry: "lfp", emptyVoltage: 40, fullVoltage: 58.4, coulombicEfficiency: 99.5, selfDischarge: 2, internalResistance: 0.03, polarizationResistance: 0.02, polarizationTimeConstant: 40, maxCurrent: 200, maxPower: 10000, heatCapacity: 30000, loss: 8 }),
  preset("contactor", "General-purpose", "24 V DC coil · 25 A contact", {}),
  preset("transformer", "Laboratory", "230 / 24 V · 250 VA", {}),
  preset("radiator", "Laboratory", "24 V fan · 100 W/K radiator", {}),
  preset("circulator", "General-purpose", "Heating circulator 230 V · 6 m · proportional pressure", {}),
  preset("circulator", "General-purpose", "Heating circulator 230 V · constant pressure 3 m", { mode: "constantPressure", headSetpoint: 3 }),
  preset("circulator", "Laboratory", "Solar circulator 12 V DC · 19 W", {}, undefined, "dc12"),
  heater("Laboratory", "Lab element 100 W / 24 V", 24, 100),
  heater("Laboratory", "Lab element 500 W / 230 V", 230, 500),
  heater("General-purpose", "Immersion 1 kW / 230 V", 230, 1000),
  heater("General-purpose", "Immersion 3 kW / 230 V", 230, 3000),
  heater("Industrial", "Immersion 6 kW / 400 V", 400, 6000, equivalent),
  heater("Industrial", "Immersion 12 kW / 400 V", 400, 12000, equivalent),
  heater("High-capacity", "Heating bank 30 kW / 400 V", 400, 30000, equivalent),
  heater("High-capacity", "Heating bank 100 kW / 690 V", 690, 100000, equivalent),
  preset("source", "Laboratory", "Bench CV/CC 30 V / 3 A", { mode: "cvcc", voltage: 12, ratedVoltage: 30, maxCurrent: 3, maxPower: 90, internalResistance: 0 }),
  preset("source", "Laboratory", "Constant-current 2 A / 60 V", { mode: "cc", voltage: 60, ratedVoltage: 60, current: 2, maxCurrent: 2, maxPower: 120, internalResistance: 0 }),
  preset("source", "General-purpose", "Battery 12 V · 20 mΩ", { mode: "internal", voltage: 12.6, ratedVoltage: 14.4, maxCurrent: 600, maxPower: 7500, internalResistance: 0.02 }, "Fixed-voltage equivalent with unlimited stored energy. Use the Battery component for finite charge and discharge."),
  preset("source", "Industrial", "DC supply 400 V / 100 A CV/CC", { mode: "cvcc", voltage: 400, ratedVoltage: 450, maxCurrent: 100, maxPower: 45000, internalResistance: 0.005 }),
  preset("source", "High-capacity", "DC bus 690 V / 400 A CV/CC", { mode: "cvcc", voltage: 690, ratedVoltage: 750, maxCurrent: 400, maxPower: 300000, internalResistance: 0.002 }),
  preset("resistor", "Laboratory", "Precision 1 kΩ · 0.25 W", { resistance: 1000, ratedPower: 0.25, heatCapacity: 0.2, loss: 0.004, maxTemperature: 155, tolerance: 1, tempCoefficient: 0.0001 }),
  preset("resistor", "General-purpose", "Wirewound 10 Ω · 100 W", { resistance: 10, ratedPower: 100, heatCapacity: 80, loss: 0.5, maxTemperature: 350, tolerance: 5, tempCoefficient: 0.00002 }),
  preset("resistor", "Industrial", "Load bank 2 Ω · 20 kW", { resistance: 2, ratedPower: 20000, heatCapacity: 20000, loss: 60, maxTemperature: 450, tolerance: 5 }),
  preset("resistor", "Laboratory", "NTC thermistor 10 kΩ", { resistance: 10000, ratedPower: 0.5, heatCapacity: 0.5, loss: 0.01, maxTemperature: 150, tempCoefficient: -0.04, tolerance: 1 }, "Linearised α = −4 %/K; accurate only near 20 °C."),
  preset("fuse", "General-purpose", "Fuse 2 A", { ratedCurrent: 2, resistance: 0.1, ratedPower: 2, tripTime: 0.1 }),
  preset("fuse", "Industrial", "Power fuse 125 A", { ratedCurrent: 125, resistance: 0.0005, ratedPower: 60, heatCapacity: 120, tripTime: 0.2 }, undefined, "power63"),
  preset("fuse", "High-capacity", "NH fuse 630 A", { ratedCurrent: 630, resistance: 0.0001, ratedPower: 120, heatCapacity: 500, loss: 4, tripTime: 0.3 }, undefined, "power250"),
  preset("relay", "Industrial", "Contactor 400 V / 80 A", { ratedCurrent: 80, ratedVoltage: 690, resistance: 0.0008, ratedPower: 20, heatCapacity: 300, loss: 2 }),
  cable(1.5, 10), cable(2.5, 20), cable(6, 25), cable(16, 30), cable(35, 50), cable(95, 50), cable(240, 100, "aluminium"),
  tank("Laboratory", "Beaker 1 L", 1.2, 1, 0.1, 150, 0),
  tank("Laboratory", "Lab vessel 10 L", 12, 10, 0.25, 2000, 0),
  tank("General-purpose", "Water heater 100 L", 110, 100, 0.45, 15000, 0.05),
  tank("General-purpose", "Hot-water cylinder 300 L", 320, 300, 0.6, 35000, 0.06),
  tank("Industrial", "Process tank 2,000 L", 2200, 2000, 1.4, 150000, 0.1),
  tank("High-capacity", "Storage tank 10,000 L", 11000, 10000, 2.5, 600000, 0.15),
  tank("High-capacity", "Reservoir 50,000 L", 55000, 50000, 4.5, 2000000, 0.15),
  preset("cooler", "Industrial", "Plate cooler 300 W/K · 15 °C", { conductance: 300, ambient: 15 }),
  preset("cooler", "High-capacity", "Chiller coil 3 kW/K · 7 °C", { conductance: 3000, ambient: 7 }),
  preset("motor", "Industrial", "DC motor 400 V · 22 kW", { resistance: 0.35, torqueConstant: 2.4, inertia: 0.35, friction: 0.01, ratedVoltage: 400, ratedCurrent: 60, ratedTorque: 144, ratedPower: 24000, maxSpeed: 200, heatCapacity: 25000, loss: 30, maxTemperature: 155 }),
  preset("pump", "Laboratory", "Circulator 20 L/min · 4 m", { ratedFlow: 0.000333, shutoffHead: 4, efficiency: 0.45, mechanicalLoss: 2 }),
  preset("pump", "High-capacity", "Process pump 6,000 L/min · 45 m", { ratedSpeed: 154.5, ratedFlow: 0.1, shutoffHead: 45, efficiency: 0.84, mechanicalLoss: 1.3, maxPressure: 1600000 }, undefined, "highCapacity"),
  pipe(15, 5, "Laboratory"), pipe(25, 10, "General-purpose"), pipe(50, 20, "General-purpose"), pipe(100, 50, "Industrial"), pipe(200, 100, "High-capacity"),
  preset("valve", "Industrial", "Gate valve DN100", { diameter: 0.1, lossCoefficient: 0.2, maxPressure: 1600000 }),
  preset("breaker", "General-purpose", "B16 socket circuit", { ratedCurrent: 16, magneticTrip: 5 }),
  preset("breaker", "General-purpose", "C32 heater circuit", { ratedCurrent: 32, magneticTrip: 10, resistance: 0.0025, heatCapacity: 60 }),
  preset("breaker", "Industrial", "D125 feeder breaker", { ratedCurrent: 125, magneticTrip: 15, resistance: 0.0006, breakingCapacity: 25000, thermalTimeConstant: 90, heatCapacity: 250, loss: 2 }, undefined, "d63"),
  preset("breaker", "High-capacity", "MCCB 630 A", { ratedCurrent: 630, ratedVoltage: 690, magneticTrip: 10, resistance: 0.00008, breakingCapacity: 50000, thermalTimeConstant: 180, heatCapacity: 1500, loss: 5 }, undefined, "mccb250"),
  preset("motorProtector", "Industrial", "Motor protector 45 A class 10", { ratedCurrent: 45, resistance: 0.0018, heatCapacity: 120 }),
  preset("motorProtector", "Industrial", "Motor protector 150 A class 20 (fan/pump)", { ratedCurrent: 150, tripClass: 20, resistance: 0.0004, heatCapacity: 400, loss: 2 }, undefined, "mpcb200"),
  preset("thermalMass", "Laboratory", "Small heat sink 2 K/W", { heatCapacity: 90, loss: 0.5, conductance: 20 }),
  preset("thermalMass", "General-purpose", "Forced-air heat sink 0.1 K/W", { heatCapacity: 1800, loss: 10, conductance: 200, maxTemperature: 150 }),
  preset("thermalMass", "Industrial", "Concrete floor slab 1 m² × 0.2 m", { heatCapacity: 4.4e5, loss: 8, conductance: 50, maxTemperature: 300 }),
  preset("heatExchanger", "Laboratory", "Coil exchanger 300 W/K", { ua: 300, diameter: 0.012, lossCoefficient: 20 }),
  preset("heatExchanger", "Industrial", "Plate exchanger 50 kW/K", { ua: 50000, diameter: 0.08, lossCoefficient: 15, maxPressure: 1600000 }, undefined, "plate"),
  preset("pressureReducingValve", "General-purpose", "Building PRV 3 bar DN25", { pressureSetpoint: 300000, diameter: 0.025 }),
  preset("pressureReducingValve", "Industrial", "Process PRV 6 bar DN80", { pressureSetpoint: 600000, diameter: 0.08, lossCoefficient: 6, responseTime: 10, proportionalBand: 50000 }),
  preset("pump", "Industrial", "Measured curve 0–400 L/min (data points)", { curvePoints: "0:36; 100:35; 200:32; 300:26; 400:17", ratedFlow: 0.005, shutoffHead: 36, efficiency: 0.76, npshRequired: 3 }, "Head curve from manufacturer-style data points at rated speed.", "industrial"),
  preset("source3", "General-purpose", "Workshop supply 400 V 3~ 32 A", { lineVoltage: 400, maxCurrent: 32, maxPower: 22000, internalResistance: 0.05 }),
  preset("source3", "Industrial", "Transformer 630 kVA (400 V)", { lineVoltage: 400, maxCurrent: 910, maxPower: 630000, internalResistance: 0.0025 }),
  preset("pipe", "General-purpose", "Insulated DN25 · 20 m (8 cells)", { diameter: 0.025, length: 20, thermalUA: 2, segments: 8, inventory: true }),
  preset("flywheel", "Laboratory", "Steel disc Ø400 × 50 mm · direct", { inertia: 0.99, gearRatio: 1, gearEfficiency: 100, friction: 0.002, maxSpeed: 314 }, "Solid steel disc: m = 49 kg, J = ½·m·r²."),
  preset("flywheel", "Industrial", "Conveyor drive 40 kg·m² · 20:1 helical reducer", { inertia: 40, gearRatio: 20, gearEfficiency: 94, friction: 0.5, maxSpeed: 15.7 }, "Drum, belt and load inertia at the drum shaft; two helical stages at about 97 % each. The motor sees 0.1 kg·m²."),
  preset("dynamometer", "Laboratory", "Eddy-current 50 N·m · 15 kW · 2,865 RPM", { absorber: "eddyCurrent", ratedTorque: 50, ratedSpeed: 300, ratedPower: 15000, inertia: 0.0127, maxSpeed: 1885, torqueSetpoint: 20 }, "Water-cooled eddy-current brake class (e.g. Magtrol WB 115): peak torque at the rated speed."),
  preset("dynamometer", "High-capacity", "Eddy-current 560 N·m · 140 kW · 2,390 RPM", { absorber: "eddyCurrent", ratedTorque: 560, ratedSpeed: 250.3, ratedPower: 140000, inertia: 0.2, maxSpeed: 785.4, torqueSetpoint: 200 }, "Water-cooled eddy-current brake class (e.g. Magtrol 4 WB 15)."),
  preset("dynamometer", "Industrial", "Electric AC dynamometer 300 N·m · 75 kW", { absorber: "electric", ratedTorque: 300, ratedSpeed: 250, ratedPower: 75000, inertia: 0.35, maxSpeed: 628, torqueSetpoint: 100 }, "Inverter-fed AC machine in absorbing (braking) mode: full torque down to standstill."),
  preset("dynamometer", "General-purpose", "Water brake 1,000 N·m · 300 kW", { absorber: "waterBrake", ratedTorque: 1000, ratedSpeed: 314, ratedPower: 300000, inertia: 0.4, maxSpeed: 628, torqueSetpoint: 800 }, "Hydraulic absorber: torque ∝ speed² at a given water fill; the set torque applies at the rated speed."),
];

/** Properties a preset may carry: everything except operating commands and assignments. */
const excluded = new Set(["target", "closed", "enabled", "speedControl", "opening"]);
export function presetProps(c: Component): Record<string, Property> {
  const model = catalog({ ...c, variant: c.variant ?? "standard" }).props;
  return Object.fromEntries(Object.entries(c.props).filter(([k, v]) => !excluded.has(k) && v !== model[k]));
}
/** Resolve a preset into a full, derived-consistent property set. */
export function presetComponentProps(p: ComponentPreset, current?: Component): { variant: string; props: Record<string, Property> } {
  const model = catalog({ kind: p.kind, variant: p.base } as Component).props;
  const keep = current ? Object.fromEntries(Object.entries(current.props).filter(([k]) => excluded.has(k))) : {};
  return { variant: p.base, props: applyDerived(p.kind, { ...model, ...p.props, ...keep }) };
}
export function validatePreset(value: unknown): ComponentPreset {
  const p = value as ComponentPreset;
  if (!p || typeof p !== "object" || typeof p.id !== "string" || typeof p.name !== "string" || !p.name.trim() || p.name.length > 80 || !Object.hasOwn(definitions, p.kind) || typeof p.props !== "object" || !p.props)
    throw Error("Invalid component preset.");
  const base = typeof p.base === "string" ? p.base : "standard";
  const known = definitions[p.kind].defaults;
  for (const [k, v] of Object.entries(p.props)) {
    if (!(k in known)) throw Error(`Preset “${p.name}”: unsupported property ${k}.`);
    if (typeof v !== typeof known[k]) throw Error(`Preset “${p.name}”: invalid ${k}.`);
  }
  const clean: ComponentPreset = { id: p.id, name: p.name.trim(), kind: p.kind, family: "Custom", base, props: { ...p.props }, ...(typeof p.note === "string" ? { note: p.note.slice(0, 200) } : {}) };
  const resolved = presetComponentProps(clean);
  const error = componentError({ id: "preset", kind: clean.kind, name: clean.name, x: 0, y: 0, rotation: 0, variant: resolved.variant, props: resolved.props });
  if (error) throw Error(`Preset “${p.name}”: ${error}`);
  return clean;
}
export interface PresetFile { format: "physics-lab-presets"; version: 1; presets: ComponentPreset[] }
export function parsePresetFile(value: unknown): ComponentPreset[] {
  const f = value as PresetFile;
  if (!f || f.format !== "physics-lab-presets" || f.version !== 1 || !Array.isArray(f.presets) || f.presets.length > 500)
    throw Error("Not a PHYSICS LAB preset file (format physics-lab-presets, version 1, ≤ 500 presets).");
  return f.presets.map(validatePreset);
}
export const serializePresets = (presets: ComponentPreset[]) =>
  JSON.stringify({ format: "physics-lab-presets", version: 1, presets: presets.map(({ builtin: _b, ...p }) => p) } satisfies PresetFile, null, 2);
const STORAGE_KEY = "physics-lab-presets";
export function loadUserPresets(): ComponentPreset[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? parsePresetFile(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}
export function storeUserPresets(presets: ComponentPreset[]) {
  globalThis.localStorage?.setItem(STORAGE_KEY, serializePresets(presets));
}
