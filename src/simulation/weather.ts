/**
 * Outdoor weather as a pure function of simulated time. Phase 1a: a design day (outdoor air temperature and humidity
 * over 24 hours). Sun, panels and recorded weather data are later kinds of the same union, so consumers read only
 * `weatherAt`. Data provenance, equations and limits: docs/WEATHER.md.
 */

/**
 * `designDay`: air temperature follows the ASHRAE design-day profile between the daily minimum and maximum; the dew point
 * is constant through the day. Simulated time 0 is `startHour` (local standard time, 0–24).
 */
export type WeatherModel = { kind: 'designDay'; startHour: number; minTemperature: number; maxTemperature: number; dewPoint: number };

/** A cold, clear January day in central Europe (assumption, not a site value); the air saturates at dawn. */
export const defaultDesignDay = (): WeatherModel => ({ kind: 'designDay', startHour: 0, minTemperature: -5, maxTemperature: 3, dewPoint: -5 });

/**
 * Fraction of the daily range below the maximum at each full hour 1…24 (ASHRAE Handbook—Fundamentals, design-day hourly
 * profile; also EnergyPlus' default temperature range multipliers). Minimum at 05:00, maximum 14:00–15:00.
 */
export const DAILY_RANGE_FRACTION = [0.88, 0.92, 0.95, 0.98, 1.00, 0.98, 0.91, 0.74, 0.55, 0.38, 0.23, 0.13, 0.05, 0.00, 0.00, 0.06, 0.14, 0.24, 0.39, 0.50, 0.59, 0.68, 0.75, 0.82] as const;

/** Hour of day (0–24) at simulated time t (s). */
export const hourOfDay = (w: WeatherModel, t: number) => ((w.startHour + t / 3600) % 24 + 24) % 24;
/** Range fraction at hour h, linear between the tabulated full hours (hour 0 = hour 24). */
function rangeFraction(h: number) {
  const i = Math.floor(h), f = h - i, at = (k: number) => DAILY_RANGE_FRACTION[((k - 1) % 24 + 24) % 24];
  return at(i) + (at(i + 1) - at(i)) * f;
}
/** Saturation vapour pressure over water (Pa), Magnus form (WMO 2008), t in °C; the heat pump uses the same form. */
const saturation = (t: number) => 611.2 * Math.exp(17.62 * t / (243.12 + t));

export interface WeatherState { hour: number; temperature: number; dewPoint: number; relativeHumidity: number }
export function weatherAt(w: WeatherModel, t: number): WeatherState {
  const hour = hourOfDay(w, t), temperature = w.maxTemperature - rangeFraction(hour) * (w.maxTemperature - w.minTemperature);
  return { hour, temperature, dewPoint: w.dewPoint, relativeHumidity: Math.min(100, 100 * saturation(w.dewPoint) / saturation(temperature)) };
}
/** Simulated seconds from t to the next full hour, where the profile's slope changes (Infinity within 1 ns of one). */
export function nextBreakpoint(w: WeatherModel, t: number) {
  const hour = hourOfDay(w, t), left = (Math.floor(hour + 1e-9) + 1 - hour) * 3600;
  return left > 1e-9 ? left : 3600;
}
/** |dT/dt| (K/s) of the air temperature at t, on the current hourly segment. */
export function temperatureRate(w: WeatherModel, t: number) {
  const hour = hourOfDay(w, t), i = Math.floor(hour + 1e-9);
  return Math.abs(rangeFraction(i + 1) - rangeFraction(i)) * (w.maxTemperature - w.minTemperature) / 3600;
}

/** Day and clock time at simulated time t, e.g. "Day 1 · 05:30". */
export function clockLabel(w: WeatherModel, t: number) {
  const minutes = Math.floor((w.startHour * 60 + t / 60) + 1e-6), day = Math.floor(minutes / 1440) + 1, m = ((minutes % 1440) + 1440) % 1440;
  return `Day ${day} · ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Null when valid; otherwise the reason. */
export function weatherError(w: unknown): string | null {
  const x = w as Partial<WeatherModel> | null;
  if (!x || typeof x !== 'object' || x.kind !== 'designDay') return 'Unknown weather model.';
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (!n(x.startHour) || x.startHour! < 0 || x.startHour! >= 24) return 'Weather start time must be between 0 and 24 h.';
  if (![x.minTemperature, x.maxTemperature, x.dewPoint].every(v => n(v) && v! >= -50 && v! <= 50)) return 'Weather temperatures must be between −50 and 50 °C.';
  if (x.minTemperature! > x.maxTemperature!) return 'The daily minimum must not exceed the maximum.';
  if (x.dewPoint! > x.minTemperature!) return 'The dew point must not exceed the daily minimum (the air would be supersaturated).';
  return null;
}

export const weatherBasisLabels = { published: 'Published method', assumed: 'Assumption' } as const;
export const weatherBasis: { kind: keyof typeof weatherBasisLabels; text: string }[] = [
  { kind: 'published', text: 'Air temperature follows the ASHRAE design-day profile: the hourly fraction of the daily range below the maximum (Handbook—Fundamentals), linear between full hours; minimum at 05:00, maximum 14:00–15:00. Relative humidity from a constant dew point by the Magnus formula (WMO 2008).' },
  { kind: 'assumed', text: 'The daily minimum, maximum and dew point are chosen values, not site data; the default is a cold clear January day in central Europe (−5/3 °C, dew point −5 °C). Hours are local standard time (ASHRAE tabulates solar time). No sun, wind, clouds or rain; the ground keeps its own model.' },
];
