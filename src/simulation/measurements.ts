import { effectiveAmbient } from "./environment";
import { batteryEnergy } from "./devices";
import {
  definitions,
  isSource,
  prop,
  type Measurement,
  type Probe,
  type Project,
} from "./model";
import { nodeVoltage } from "./electrical";
import type { Simulation } from "./engine";
export const units: Record<Measurement, string> = {
  acInputPower: 'W', acOutputPower: 'W', converterLossEnergy: 'J', transferLossEnergy: 'J', batteryHeatEnergy: 'J',
  gridPower: 'W', gridReactivePower: 'var', gridImportPower: 'W', gridExportPower: 'W', gridImportEnergy: 'Wh', gridExportEnergy: 'Wh', gridVoltage: 'V', gridFrequency: 'Hz', synchronized: 'bool', backupAvailable: 'bool', dcPower: 'W', acConversionPower: 'W',
  incidentEnergy: 'J', inputPower: 'W', outputPower: 'W', conversionLoss: 'W', mppPower: 'W', mppVoltage: 'V', mppCurrent: 'A', trackingEfficiency: '%', incidentPower: 'W', generatedEnergy: 'J', outputEnergy: 'J', lostEnergy: 'J',
  supplyTemperature: "°C", excessTemperature: "K", heatInput: "W",
  returnTemperature: "°C", elementTemperature: "°C", heatingStages: "1", heatingPower: "W", heatLoss: "W",
  stateOfCharge: "%", chemicalEnergy: "J", polarizationVoltage: "V", chargeVoltage: "V", fieldEnergy: "J", coilVoltage: "V", coilCurrent: "A", secondaryVoltage: "V", secondaryCurrent: "A", fanPower: "W",
  positionX: 'm', positionY: 'm', displacement: 'm', linearSpeed: 'm/s', velocityX: 'm/s', velocityY: 'm/s', angularVelocity: 'rad/s', acceleration: 'm/s²', appliedForce: 'N', appliedTorque: 'N·m', kineticEnergy: 'J', potentialEnergy: 'J', mechanicalResidual: 'J', contactImpulse: 'N·s', jointForce: 'N',
  inletPressure: "bar", pressure: "bar", differentialPressure: "bar", flow: "L/min", level: "%", fluidTemperature: "°C",
  rpm: "RPM", torque: "N·m", reactivePower: "var", powerFactor: "1", heatDuty: "W", npsh: "m", impellerPower: "W", mechanicalLoss: "W", hydraulicEfficiency: "%", overflow: "L/min", overflowVolume: "L", shaftPower: "W", hydraulicPower: "W", efficiency: "%", transferredVolume: "L",
  massResidual: "kg", energyResidual: "J", velocity: "m/s", reynolds: "1", frictionFactor: "1", position: "%",
  voltage: "V",
  nodeVoltage: "V",
  current: "A",
  currentNC: "A",
  power: "W",
  bodyTemperature: "°C", temperature: "°C",
  energy: "J",
  state: "bool",
  signal: "signal",
};
const isMotorKind = (c: { kind: string }) => c.kind === "motor" || c.kind === "inductionMotor";
export { measurements } from "./capabilities";
import { measurements } from "./capabilities";
export function readProbe(p: Probe, s: Simulation): number | null {
  const c = s.project.components.find((c) => c.id === p.component);
  if (!c || s.error || !measurements(c).includes(p.measurement)) return null;
  const r = s.electrical.readings[c.id];
  const h = s.multiphysics.hydraulic.readings[c.kind === "heatExchanger" ? `${c.id}#${p.port ?? "hot"}` : c.id], motor = s.multiphysics.motors[c.id];
  switch (p.measurement) {
    case 'acInputPower': return r?.hybrid?.acInputPower ?? null;
    case 'acOutputPower': return r?.hybrid?.outputPower ?? null;
    case 'converterLossEnergy': return s.devices.hybrid[c.id]?.converterLossEnergy ?? 0;
    case 'transferLossEnergy': return s.devices.hybrid[c.id]?.transferLossEnergy ?? 0;
    case 'batteryHeatEnergy': return s.devices.batteryHeat[c.id] ?? 0;
    case 'gridPower': return r?.hybrid?.gridPower ?? null;
    case 'gridReactivePower': return r?.hybrid?.gridReactive ?? null;
    case 'gridImportPower': return r?.hybrid ? Math.max(0, r.hybrid.gridPower) : null;
    case 'gridExportPower': return r?.hybrid ? Math.max(0, -r.hybrid.gridPower) : null;
    case 'gridImportEnergy': return (s.devices.hybrid[c.id]?.imported ?? 0) / 3600;
    case 'gridExportEnergy': return (s.devices.hybrid[c.id]?.exported ?? 0) / 3600;
    case 'gridVoltage': return r?.hybrid?.gridVoltage ?? null;
    case 'gridFrequency': return r?.hybrid?.gridFrequency ?? null;
    case 'synchronized': return r?.hybrid ? Number(r.hybrid.connected) : null;
    case 'backupAvailable': return r?.hybrid ? Number(r.hybrid.backupAvailable) : null;
    case 'dcPower': return r?.hybrid?.dcPower ?? null;
    case 'acConversionPower': return r?.hybrid?.acPower ?? null;
    case 'incidentEnergy': return s.devices.solar[c.id]?.generated ?? 0;
    case 'inputPower': return r?.solar?.inputPower ?? null;
    case 'outputPower': return r?.solar?.outputPower ?? null;
    case 'conversionLoss': return r?.heatPower ?? null;
    case 'mppPower': return r?.solar?.mppPower ?? null;
    case 'mppVoltage': return r?.solar?.mppVoltage ?? null;
    case 'mppCurrent': return r?.solar?.mppCurrent ?? null;
    case 'incidentPower': return r?.solar?.irradiation ?? null;
    case 'trackingEfficiency': return r?.solar?.trackingEfficiency === undefined ? null : r.solar.trackingEfficiency * 100;
    case 'generatedEnergy': return c.kind === 'solarPanel' ? s.devices.solar[c.id]?.output ?? 0 : s.devices.solar[c.id]?.generated ?? 0;
    case 'outputEnergy': return s.devices.solar[c.id]?.output ?? 0;
    case 'lostEnergy': return s.devices.solar[c.id]?.lost ?? 0;
    case "returnTemperature": return h?.returnTemperature === undefined || Math.abs(h.flow) < 1e-12 ? null : h.returnTemperature - 273.15;
    case "supplyTemperature": return h?.supplyTemperature === undefined || Math.abs(h.flow) < 1e-12 ? null : h.supplyTemperature - 273.15;
    case "excessTemperature": return h?.excessTemperature ?? null;
    case "heatInput": return h?.heatInput ?? 0;
    case "elementTemperature": return (s.multiphysics.boilers[c.id]?.elementTemperature ?? 293.15) - 273.15;
    case "heatingStages": return s.multiphysics.boilers[c.id]?.stages ?? 0;
    case "heatingPower": return r?.heatingPower ?? 0;
    case "heatLoss": return prop(c, 'loss') * ((s.fluidTemperatureMeasurement(c.id) ?? effectiveAmbient(s.project, c)) - effectiveAmbient(s.project, c));
    case "stateOfCharge": return (s.devices.batteries[c.id] ?? 0) * 100;
    case "chemicalEnergy": return batteryEnergy(c, s.devices.batteries[c.id] ?? 0);
    case "polarizationVoltage": return s.devices.polarization[c.id] ?? 0;
    case "chargeVoltage": return s.devices.capacitors[c.id] ?? null;
    case "fieldEnergy": {
      // ½·C·V² of a capacitor's dielectric, ½·L·I² of an inductor's winding current.
      const value = c.kind === "inductor" ? s.devices.inductors[c.id] : s.devices.capacitors[c.id];
      return value === undefined ? null : 0.5 * prop(c, c.kind === "inductor" ? "inductance" : "capacitance") * value * value;
    }
    case "coilVoltage": return r?.coilVoltage ?? null;
    case "coilCurrent": return r?.coilCurrent ?? null;
    case "secondaryVoltage": return r?.secondaryVoltage ?? null;
    case "secondaryCurrent": return r?.secondaryCurrent ?? null;
    case "fanPower": return r?.fanPower ?? null;
    case 'positionX': return s.spatial.readings[c.id]?.x ?? null;
    case 'positionY': return s.spatial.readings[c.id]?.y ?? null;
    case 'displacement': { const b = s.spatial.readings[c.id]; return b && c.spatial ? Math.hypot(b.x - c.spatial.x, b.y - c.spatial.y) : null; }
    case 'linearSpeed': { const b = s.spatial.readings[c.id]; return b ? Math.hypot(b.vx, b.vy) : null; }
    case 'velocityX': return s.spatial.readings[c.id]?.vx ?? null;
    case 'velocityY': return s.spatial.readings[c.id]?.vy ?? null;
    case 'angularVelocity': return s.spatial.readings[c.id]?.omega ?? null;
    case 'acceleration': { const b = s.spatial.readings[c.id]; return b ? Math.hypot(b.ax, b.ay) : null; }
    case 'appliedForce': { if (c.kind === 'forceActuator') return c.props.axis === 'torque' ? null : Math.abs(s.spatial.actuatorReadings[c.id] ?? 0); const b = s.spatial.readings[c.id]; return b ? Math.hypot(b.forceX, b.forceY) : null; }
    case 'appliedTorque': return c.kind === 'forceActuator' ? c.props.axis === 'torque' ? s.spatial.actuatorReadings[c.id] ?? 0 : null : s.spatial.readings[c.id]?.torque ?? null;
    case 'kineticEnergy': {
      if (c.kind !== 'flywheel') return s.spatial.readings[c.id]?.kinetic ?? null;
      const rpm = s.mechanicalMeasurement(c.id, 'rpm');
      return rpm === undefined ? 0 : 0.5 * prop(c, 'inertia') * (rpm * Math.PI / 30) ** 2;
    }
    // Motors: electromagnetic (air-gap) torque. Dynamometer: absorbed torque. Flywheel: torque at its own shaft.
    case "torque": return isMotorKind(c) ? motor?.torque ?? 0 : s.multiphysics.shaftElements[c.id]?.torque ?? 0;
    case 'potentialEnergy': return s.spatial.readings[c.id]?.potential ?? null;
    case 'mechanicalResidual': return s.spatial.residual;
    case 'contactImpulse': return s.spatial.readings[c.id]?.contactImpulse ?? null;
    case 'jointForce': { const joints = s.project.world?.joints.filter(j => j.a === c.id || j.b === c.id) ?? []; return joints.reduce((sum, j) => { const r = s.spatial.jointReadings[j.id]; return sum + (r ? Math.hypot(r.force.x, r.force.y) : 0); }, 0); }
    case "pressure": { const pressure = c.kind === "heatExchanger" ? h?.pressure : s.hydraulicMeasurement(c.id, "pressure"); return pressure === undefined ? null : pressure / 100000; }
    case "inletPressure": return h ? h.inletPressure / 100000 : null;
    case "differentialPressure": return h ? h.differentialPressure / 100000 : null;
    case "flow": return h ? h.flow * 60000 : null;
    case "level": return s.hydraulicMeasurement(c.id, "level") ?? null;
    case "fluidTemperature": return s.fluidTemperatureMeasurement(c.kind === "heatExchanger" ? `${c.id}#${p.port ?? "hot"}` : c.id) ?? null;
    case "rpm": return s.mechanicalMeasurement(c.id, "rpm") ?? null;
    case "shaftPower": return c.kind === "dynamometer" ? s.multiphysics.shaftElements[c.id]?.power ?? 0 : motor?.shaftPower ?? h?.shaftPower ?? null;
    // Pump quantities come from the shared pumpCurve() operating point (see hydraulic.ts).
    case "hydraulicPower": return h?.hydraulicPower ?? 0;
    case "impellerPower": return h?.impellerPower ?? 0;
    case "mechanicalLoss": return h?.mechanicalLoss ?? 0;
    case "hydraulicEfficiency": return h?.hydraulicEfficiency === null || h?.hydraulicEfficiency === undefined ? null : h.hydraulicEfficiency * 100;
    // A circulator: instantaneous wire-to-water efficiency, net hydraulic power over electrical input P1 (not the EEI).
    case "efficiency": if (r?.solar) return r.solar.efficiency * 100;
      if (c.kind === "circulator") return r && r.power > 1e-9 && h ? Math.max(0, h.hydraulicPower) / r.power * 100 : null;
      return motor ? r && r.power > 1e-9 ? motor.shaftPower / r.power * 100 : null : h?.efficiency === null || h?.efficiency === undefined ? null : h.efficiency * 100;
    case "reactivePower": return r?.ac ? (isSource(c) ? -(r.reactivePower ?? 0) : r.reactivePower ?? 0) : r ? 0 : null;
    case "powerFactor": return r?.ac ? r.powerFactor ?? null : r && Math.abs(r.power) > 1e-12 ? 1 : null;
    case "overflow": return (s.multiphysics.overflowRate[c.id] ?? 0) * 60000;
    case "overflowVolume": return (s.multiphysics.overflowed[c.id] ?? 0) * 1000;
    case "transferredVolume": return (s.multiphysics.transferred[c.id] ?? 0) * 1000;
    case "massResidual": return s.multiphysics.massResidual;
    case "energyResidual": return s.energyResidual;
    case "velocity": return h?.velocity ?? null;
    case "reynolds": return h?.reynolds ?? null;
    case "frictionFactor": return h?.frictionFactor ?? null;
    case "position": return s.multiphysics.positions[c.id] ?? null;
    case "heatDuty": return h?.duty ?? 0;
    case "npsh": return h?.npshAvailable ?? null;
    case "bodyTemperature": return s.temperatures[c.id] ?? null;
    case "temperature":
      return ["sensor", "thermostat", "safety"].includes(c.kind)
        ? s.automation.sensors[c.id]?.valid
          ? Number(s.automation.sensors[c.id].value)
          : null
        : (s.temperatures[c.id] ?? null);
    case "energy":
      if (c.kind === 'forceActuator') return s.spatial.brakeEnergy[c.id] ?? 0;
      if (c.kind === 'dynamometer') return s.multiphysics.shaftElements[c.id]?.energy ?? 0;
      return s.componentEnergy[c.id] ?? 0;
    case "state": {
      if (r?.solar) return Number(r.solar.running);
      if (c.kind === "electricBoiler") return Number((s.multiphysics.boilers[c.id]?.stages ?? 0) > 0 && !s.multiphysics.boilers[c.id]?.fault);
      if (c.kind === "contactor") return s.failed[c.id] ? 0 : s.faults[c.id] === "stuckClosed" ? 1 : s.faults[c.id] === "stuckOpen" ? 0 : Number(s.devices.contactors[c.id]?.closed ?? false);
      if (c.kind === "checkValve") return h ? Number(h.flow > 1e-12) : null;
      if (["valve", "actuatedValve"].includes(c.kind)) return Number((s.faults[c.id] === "stuckClosed" ? 0 : s.faults[c.id] === "stuckOpen" ? 100 : s.multiphysics.positions[c.id] ?? Number(c.props.opening)) > 0);
      if (s.failed[c.id] || s.faults[c.id] === "failedOpen") return 0;
      if (typeof s.automation.contacts[c.id] === "boolean")
        return Number(s.automation.contacts[c.id]);
      const signal = s.automation.signals[c.id];
      if (signal)
        return signal.valid
          ? typeof signal.value === "boolean"
            ? Number(signal.value)
            : 1
          : null;
      if (c.kind === "switch") return Number(c.props.closed);
      if (c.kind === "cooler") {
        if (s.faults[c.id] === "coolingFailed") return 0;
        const wired = s.project.connections.some(
          (w) => w.domain === "control" && w.to.component === c.id,
        );
        const command = s.automation.input(c, "in", s);
        return wired
          ? command.valid
            ? Number(command.value === true)
            : null
          : Number(c.props.enabled);
      }
      return 1;
    }
    case "signal":
      return s.automation.signals[c.id]?.valid
        ? Number(s.automation.signals[c.id].value)
        : null;
    case "nodeVoltage":
      return s.error
        ? null
        : nodeVoltage(
            s.electrical,
            `${c.id}:${p.terminal ?? "a"}`,
            p.reference
              ? `${p.reference.component}:${p.reference.port}`
              : undefined,
          );
    case "voltage":
      return s.error || r?.voltageValid === false ? null : (r?.voltage ?? null);
    case "current":
      return s.error ? null : (r?.current ?? null);
    case "currentNC":
      return s.error ? null : (r?.currentNC ?? null);
    case "power":
      return s.error
        ? null
        : isSource(c)
          ? -(r?.power ?? 0)
          : (r?.power ?? null);
  }
}
export const probeColors = [
  "#ef9975",
  "#e9bd6a",
  "#a58ae3",
  "#59b99b",
  "#3ba6d8",
  "#c9d3dc",
];

export function probeUnit(
  p: Pick<Probe, "component" | "measurement">,
  project: Project,
) {
  if (p.measurement !== "signal") return units[p.measurement];
  const c = project.components.find((c) => c.id === p.component);
  return c
    ? (definitions[c.kind].ports.find((p) => p.id === "out")?.unit ?? "1")
    : "1";
}

/** Keep small nonzero SI signals visible instead of rounding them into apparent zero. */
export function formatReading(value: number, decimals = 3): string {
  return value !== 0 && Math.abs(value) < 10 ** -decimals ? value.toExponential(3) : value.toFixed(decimals);
}
