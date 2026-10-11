import { batteryEnergy } from "./devices";
import {
  definitions,
  isSource,
  type Measurement,
  type Probe,
  type Project,
} from "./model";
import { nodeVoltage } from "./electrical";
import type { Simulation } from "./engine";
export const units: Record<Measurement, string> = {
  stateOfCharge: "%", chemicalEnergy: "J", coilVoltage: "V", coilCurrent: "A", secondaryVoltage: "V", secondaryCurrent: "A", fanPower: "W",
  positionX: 'm', positionY: 'm', displacement: 'm', linearSpeed: 'm/s', velocityX: 'm/s', velocityY: 'm/s', angularVelocity: 'rad/s', acceleration: 'm/s²', appliedForce: 'N', appliedTorque: 'N·m', kineticEnergy: 'J', potentialEnergy: 'J', mechanicalResidual: 'J', contactImpulse: 'N·s', jointForce: 'N',
  inletPressure: "bar", pressure: "bar", differentialPressure: "bar", flow: "L/min", level: "%", fluidTemperature: "°C",
  rpm: "RPM", reactivePower: "var", powerFactor: "1", heatDuty: "W", npsh: "m", impellerPower: "W", mechanicalLoss: "W", hydraulicEfficiency: "%", overflow: "L/min", overflowVolume: "L", shaftPower: "W", hydraulicPower: "W", efficiency: "%", transferredVolume: "L",
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
export { measurements } from "./capabilities";
import { measurements } from "./capabilities";
export function readProbe(p: Probe, s: Simulation): number | null {
  const c = s.project.components.find((c) => c.id === p.component);
  if (!c || s.error || !measurements(c).includes(p.measurement)) return null;
  const r = s.electrical.readings[c.id];
  const h = s.multiphysics.hydraulic.readings[c.kind === "heatExchanger" ? `${c.id}#${p.port ?? "hot"}` : c.id], motor = s.multiphysics.motors[c.id];
  switch (p.measurement) {
    case "stateOfCharge": return (s.devices.batteries[c.id] ?? 0) * 100;
    case "chemicalEnergy": return batteryEnergy(c, s.devices.batteries[c.id] ?? 0);
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
    case 'kineticEnergy': return s.spatial.readings[c.id]?.kinetic ?? null;
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
    case "shaftPower": return motor?.shaftPower ?? h?.shaftPower ?? null;
    // Pump quantities come from the shared pumpCurve() operating point (see hydraulic.ts).
    case "hydraulicPower": return h?.hydraulicPower ?? 0;
    case "impellerPower": return h?.impellerPower ?? 0;
    case "mechanicalLoss": return h?.mechanicalLoss ?? 0;
    case "hydraulicEfficiency": return h?.hydraulicEfficiency === null || h?.hydraulicEfficiency === undefined ? null : h.hydraulicEfficiency * 100;
    case "efficiency": return motor ? r && r.power > 1e-9 ? motor.shaftPower / r.power * 100 : null : h?.efficiency === null || h?.efficiency === undefined ? null : h.efficiency * 100;
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
      return s.componentEnergy[c.id] ?? 0;
    case "state": {
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
