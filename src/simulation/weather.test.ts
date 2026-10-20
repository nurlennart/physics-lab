import { describe, it, expect } from 'vitest';
import { Builder } from './scaling-validation';
import { AdaptiveRun, Simulation } from './engine';
import { projectAmbient, projectWeather, type Project } from './model';
import { parseProject, serializeProject, starter } from './projects';
import { challengeError } from './integrity';
import { challengeDefinition } from './challenges';
import { clockLabel, defaultDesignDay, weatherAt, weatherError, type WeatherModel } from './weather';

// The reference profile is the published hourly table (ASHRAE design day; EnergyPlus' default temperature range
// multipliers), entered here as numbers; it does not come from weather.ts.
const PUBLISHED = [0.88, 0.92, 0.95, 0.98, 1.00, 0.98, 0.91, 0.74, 0.55, 0.38, 0.23, 0.13, 0.05, 0.00, 0.00, 0.06, 0.14, 0.24, 0.39, 0.50, 0.59, 0.68, 0.75, 0.82];
/** Reference air temperature at clock hour h (linear between full hours; hour 0 = hour 24). */
const reference = (w: WeatherModel, h: number) => {
  const at = (k: number) => PUBLISHED[((k - 1) % 24 + 24) % 24], i = Math.floor(h);
  return w.maxTemperature - (at(i) + (at(i + 1) - at(i)) * (h - i)) * (w.maxTemperature - w.minTemperature);
};
const day = (patch: Partial<WeatherModel> = {}): WeatherModel => ({ ...defaultDesignDay(), ...patch });

describe('design-day weather', () => {
  it('follows the published hourly profile: minimum at 05:00, maximum 14:00–15:00', () => {
    const w = day({ minTemperature: -5, maxTemperature: 3 });
    for (let h = 0; h < 24; h += 0.25) expect(weatherAt(w, h * 3600).temperature, `${h} h`).toBeCloseTo(reference(w, h), 12);
    expect(weatherAt(w, 5 * 3600).temperature).toBe(-5);
    expect(weatherAt(w, 14 * 3600).temperature).toBe(3);
    expect(weatherAt(w, 15 * 3600).temperature).toBe(3);
  });
  it('starts at the configured clock time and repeats every 24 h', () => {
    const w = day({ startHour: 6.5 });
    expect(weatherAt(w, 0).temperature).toBeCloseTo(reference(w, 6.5), 12);
    expect(weatherAt(w, 30 * 3600).temperature).toBeCloseTo(weatherAt(w, 6 * 3600).temperature, 12);
    expect(clockLabel(w, 0)).toBe('Day 1 · 06:30');
    expect(clockLabel(w, 18 * 3600)).toBe('Day 2 · 00:30');
  });
  it('derives relative humidity from the constant dew point (Magnus, WMO 2008)', () => {
    const w = day({ minTemperature: -5, maxTemperature: 3, dewPoint: -5 }), magnus = (t: number) => 611.2 * Math.exp(17.62 * t / (243.12 + t));
    expect(weatherAt(w, 5 * 3600).relativeHumidity).toBeCloseTo(100, 10); // saturated at dawn
    expect(weatherAt(w, 14 * 3600).relativeHumidity).toBeCloseTo(100 * magnus(-5) / magnus(3), 10);
    expect(weatherAt(w, 14 * 3600).relativeHumidity).toBeCloseTo(55.72, 1);
  });
  it('rejects invalid days', () => {
    expect(weatherError(day())).toBeNull();
    expect(weatherError(day({ minTemperature: 5, maxTemperature: 3 }))).toMatch(/minimum/);
    expect(weatherError(day({ dewPoint: -4 }))).toMatch(/dew point/i);
    expect(weatherError(day({ startHour: 24 }))).toMatch(/start/i);
    expect(weatherError({ kind: 'tmy' })).toMatch(/Unknown/);
  });
});

describe('weather in the engine', () => {
  /** A lumped mass with loss to the experiment environment: C dT/dt = −G·(T − T_air(t)). */
  const rig = (w?: WeatherModel) => {
    const b = new Builder(), mass = b.add('thermalMass', { heatCapacity: 360000, loss: 10, initialTemperature: 0, maxTemperature: 500 });
    if (w) b.p.weather = w;
    return { p: b.p, mass };
  };
  /** Exact solution over the piecewise-linear air temperature, integrated segment by segment (τ = C/G). */
  const exact = (w: WeatherModel, t0: number, seconds: number, tau: number) => {
    let t = 0, x = t0;
    while (t < seconds - 1e-9) {
      const h = (w.startHour + t / 3600) % 24, end = Math.min(seconds, t + (Math.floor(h + 1e-9) + 1 - h) * 3600), dt = end - t;
      const a = reference(w, h), slope = (reference(w, (w.startHour + end / 3600) % 24 || 24) - a) / dt;
      // T_p(s) = a + slope·(s − τ) is the particular solution on the segment; the difference decays with τ.
      const particular = (s: number) => a + slope * (s - tau);
      x = particular(dt) + (x - particular(0)) * Math.exp(-dt / tau);
      t = end;
    }
    return x;
  };
  it('a body losing heat outdoors follows the exact solution through a day, ending steps on the hours', () => {
    const w = day({ minTemperature: -5, maxTemperature: 3, startHour: 0 }), { p, mass } = rig(w), s = new Simulation(p);
    const run = new AdaptiveRun(s, 24 * 3600), ends: number[] = [];
    while (!run.done) { run.run(0); ends.push(s.time); }
    expect(s.error).toBeNull();
    expect(Math.abs(s.temperatures[mass.id] - exact(w, 0, 24 * 3600, 36000))).toBeLessThan(0.02);
    for (let h = 1; h <= 24; h++) expect(ends.some(t => Math.abs(t - h * 3600) < 1e-6), `${h}:00`).toBe(true);
    expect(projectAmbient(s.project)).toBeCloseTo(weatherAt(w, s.time).temperature, 12);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
  });
  it('changes nothing for a project without weather', () => {
    const plain = rig(), s = new Simulation(plain.p);
    s.advanceAdaptive(3600);
    expect(projectAmbient(s.project)).toBe(20);
    expect(projectWeather(s.project)).toBeUndefined();
    expect(s.temperatures[plain.mass.id]).toBeCloseTo(20 - 20 * Math.exp(-3600 / 36000), 2);
  });
  it('gives the heat pump the weather humidity outdoors, and keeps its own inside a room or under an override', () => {
    const p = starter('heatPumpHouse'); p.weather = day({ startHour: 5 }); // dawn: −5 °C, saturated
    const s = new Simulation(p), id = p.components.find(c => c.kind === 'heatPump')!.id, inputs = () => s.multiphysics.heatPumpInputs(s, s.project.components.find(c => c.id === id)!);
    s.advanceAdaptive(10);
    const now = projectWeather(s.project)!;
    expect(inputs().humidity).toBeCloseTo(now.relativeHumidity, 9);
    expect(inputs().air).toBeCloseTo(now.temperature, 9);
    expect(now.relativeHumidity).toBeGreaterThan(99.9);
    const local: Project = structuredClone(s.project), unit = local.components.find(c => c.id === id)!;
    unit.props = { ...unit.props, ambientMode: 'override', ambient: 7 };
    expect(s.refresh(local), s.error ?? '').toBe(true);
    expect(inputs().humidity).toBeUndefined();
    expect(inputs().air).toBe(7);
  });
  it('round-trips through files, rejects invalid weather and is not available in assignments', () => {
    const { p } = rig(day({ startHour: 7 }));
    expect(parseProject(JSON.parse(serializeProject(p))).weather).toEqual(p.weather);
    expect(() => parseProject(JSON.parse(serializeProject({ ...p, weather: day({ dewPoint: 10 }) })))).toThrow();
    const mission = challengeDefinition('heat').scaffold();
    expect(challengeError({ ...mission, weather: day() })).toMatch(/weather/i);
  });
});
