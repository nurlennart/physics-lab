/** Bosch TH3000 9. Published ratings and explicitly approximate controller/thermal data: docs/ELECTRIC-BOILER.md. */
import { prop, type Component } from './model';
import { WATER_CP } from './units';
import type { Simulation } from './engine';
export interface BoilerState {
  elementTemperature: number; stages: number; demand: boolean; switchedAt: number; offAt: number;
  lowFlowTime: number; restartAt: number; resetPrevious: boolean; fault: '' | 'overtemperature' | 'flow';
  status: string; setpoint: number; switches: number;
}
export const newBoiler = (c: Component): BoilerState => ({ elementTemperature: prop(c, 'initialTemperature') + 273.15, stages: 0, demand: false, switchedAt: -Infinity, offAt: -Infinity, lowFlowTime: 0, restartAt: 0, resetPrevious: false, fault: '', status: 'Ready', setpoint: prop(c, 'setpoint'), switches: 0 });
export const boilerWaterCapacity = (c: Component) => prop(c, 'waterVolume') * WATER_CP + prop(c, 'vesselHeatCapacity');
/** Eliminate the implicit element node from the water equation; no explicit temperature/energy injection. */
export function boilerExchange(c: Component, state: BoilerState, power: number, h: number) {
  const ce = prop(c, 'heatCapacity'), g = prop(c, 'conductance'), den = ce + h * g;
  return { sink: g * ce / den, source: g * (ce * state.elementTemperature + h * power) / den,
    element: (water: number) => h === 0 ? state.elementTemperature : (ce * state.elementTemperature + h * g * water + h * power) / den };
}
export function resetBoiler(s: Simulation, c: Component, state: BoilerState): string | null {
  const temperature = s.multiphysics.pipeCells[c.id]?.[0] ?? 293.15;
  if (temperature - 273.15 > prop(c, 'resetTemperature')) return `Cool below ${prop(c, 'resetTemperature')} °C before resetting the limiter.`;
  if (state.fault === 'flow' && Math.abs(s.multiphysics.hydraulic.readings[c.id]?.flow ?? 0) < prop(c, 'minFlow')) return 'Restore circulation before resetting the flow interlock.';
  state.fault = ''; s.automation.status[c.id] = 'healthy'; state.demand = false; state.lowFlowTime = 0; state.stages = 0; state.offAt = s.time;
  s.log(`${c.name}: protective latch manually reset.`, 'success'); return null;
}
/** Evaluate only at accepted substep boundaries. Fault removal never resets a safety latch. */
export function controlBoiler(s: Simulation, c: Component, state: BoilerState, now: number) {
  const has = (port: string) => s.project.connections.some(w => w.domain === 'control' && w.to.component === c.id && w.to.port === port);
  const command = s.automation.input(c, 'enable', s), target = s.automation.input(c, 'setpoint', s), reset = s.automation.input(c, 'reset', s);
  const requested = has('enable') ? command.valid && command.value === true : c.props.enabled === true;
  const validTarget = !has('setpoint') || target.valid && typeof target.value === 'number';
  state.setpoint = Math.max(10, Math.min(85, has('setpoint') && validTarget ? Number(target.value) : prop(c, 'setpoint')));
  const manual = reset.valid && reset.value === true;
  if (manual && !state.resetPrevious && state.fault) resetBoiler(s, c, state);
  state.resetPrevious = manual;
  const temperature = (s.multiphysics.pipeCells[c.id]?.[0] ?? 293.15) - 273.15;
  const trip = (reason: BoilerState['fault']) => { if (!state.fault) { state.fault = reason; s.log(`${c.name}: ${reason} safety trip — manual reset required.`, 'error'); } };
  if (temperature >= prop(c, 'tripTemperature') - 1e-9) trip('overtemperature');
  if (c.props.flowInterlock && state.lowFlowTime >= prop(c, 'flowDelay') && state.demand && Math.abs(s.multiphysics.hydraulic.readings[c.id]?.flow ?? 0) < prop(c, 'minFlow')) trip('flow');
  const volts = s.electrical.readings[c.id]?.stageVoltages ?? [0, 0, 0];
  const powered = volts.every(v => v >= prop(c, 'minVoltage')) && !s.failed[c.id] && s.faults[c.id] !== 'failedOpen';
  if (!powered) state.restartAt = now + prop(c, 'restartDelay');
  const fault = s.faults[c.id];
  if (state.fault || !powered || now < state.restartAt || !requested || !validTarget || fault === 'controlLost') {
    if (state.stages) { state.stages = 0; state.offAt = now; state.switchedAt = now; state.switches++; }
    state.demand = false;
    if (state.fault) s.automation.status[c.id] = 'tripped';
    state.status = state.fault ? `Tripped: ${state.fault}` : !powered ? 'Undervoltage / phase missing' : now < state.restartAt ? 'Supply restart delay' : !validTarget || fault === 'controlLost' ? 'Control unavailable' : 'Disabled';
    return;
  }
  if (temperature >= state.setpoint) state.demand = false;
  else if (temperature <= state.setpoint - prop(c, 'hysteresis')) state.demand = true;
  // Welded regulation relays bypass the ordinary thermostat, but the independent STB still opens all stages.
  if (fault === 'stuckClosed') state.demand = true;
  const desired = state.demand ? Math.floor(prop(c, 'maxStages')) : 0;
  if (state.stages !== desired && now - state.switchedAt >= prop(c, 'stageDelay') - 1e-9 && (state.stages > 0 || now - state.offAt >= prop(c, 'antiCycleTime') - 1e-9)) {
    state.stages += Math.sign(desired - state.stages); state.switchedAt = now; state.switches++;
    if (!state.stages) state.offAt = now;
  }
  state.status = state.stages ? `Heating: ${state.stages}/3 stages` : state.demand ? desired === 0 ? 'Power limit: 0 stages' : 'Restart inhibit' : 'At temperature';
}
export const boilerReference = 'https://bosch-de-de.boschhc-documents.com/download/pdf/file/6720859226';
export const boilerBasis = [
  { label: 'Manufacturer specifications', text: 'Bosch Tronic Heat 3000 9 (2018 manual): external pump; 3 × 3 kW stages, 3.7 L water, 400/230 V or bridged 230 V, 13.1 A/phase or 39.2 A single-phase. 85 °C maximum, 95 °C limiter, reset near 70 °C. Minimum flow 130 L/h; maximum pressure 3 bar.' },
  { label: 'Thermal assumptions', text: 'Fully mixed fixed water inventory; 3,500 J/K wetted steel and 1,500 J/K immersed elements; 1,200 W/K element-to-water transfer. Shell UA 1.8 W/K (90 W at 70/20 °C). Electronics modeled as a 3 W nominal resistive load to ambient.' },
  { label: 'Control approximations', text: 'Sequential stages with SE04-style 7 K hysteresis, 2 s switching and 10 s restart inhibit. Optional flow interlock, 180 V phase lockout and 2 s recovery are model assumptions. Bosch adaptive/PID, rate-of-rise retry logic, frost protection and pump relay are not reproduced.' },
];
