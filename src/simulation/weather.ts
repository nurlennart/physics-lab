/**
 * Outdoor weather as a pure function of simulated time: a design day (outdoor air temperature and humidity over 24
 * hours) at a site and date, with the sun's position and clear-sky sunlight (sun.ts). Recorded weather data and clouds
 * are later kinds of the same union, so consumers read only `weatherAt`. Data provenance, equations and limits:
 * docs/WEATHER.md.
 */
import { extraterrestrial, ineichen, pressureAt, relativeAirmass, sunPosition, type ClearSky } from './sun';

/**
 * `designDay`: air temperature follows the ASHRAE design-day profile between the daily minimum and maximum; the dew point
 * is constant through the day. Simulated time 0 is `startHour` (local standard time, 0–24) on `date`. The site (latitude
 * and longitude in degrees, north and east positive; UTC offset of local standard time in hours; altitude in m), the
 * Linke turbidity of the clear sky and the ground albedo set the sun and sunlight. Site fields are optional: files from
 * before they existed take the defaults (Munich, 15 January).
 */
export type WeatherModel = {
  kind: 'designDay'; startHour: number; minTemperature: number; maxTemperature: number; dewPoint: number;
  date?: string; latitude?: number; longitude?: number; utcOffset?: number; altitude?: number; linkeTurbidity?: number; albedo?: number;
};
/** Default site: Munich (48.14° N, 11.58° E, 520 m, UTC+1), 15 January; Linke turbidity 3 and grass-like albedo 0.2 (assumptions). */
export const DEFAULT_SITE = { date: '2026-01-15', latitude: 48.14, longitude: 11.58, utcOffset: 1, altitude: 520, linkeTurbidity: 3, albedo: 0.2 } as const;
export const site = (w: WeatherModel) => ({ ...DEFAULT_SITE, ...Object.fromEntries(Object.entries(w).filter(([, v]) => v !== undefined)) }) as Required<WeatherModel>;

/** A cold, clear January day in central Europe (assumption, not a site value); the air saturates at dawn. */
export const defaultDesignDay = (): WeatherModel => ({ kind: 'designDay', startHour: 0, minTemperature: -5, maxTemperature: 3, dewPoint: -5, ...DEFAULT_SITE });
/** A clear June day in central Europe (assumption): 12/25 °C, dew point 10 °C, Linke turbidity 4. */
export const summerDesignDay = (): WeatherModel => ({ kind: 'designDay', startHour: 0, minTemperature: 12, maxTemperature: 25, dewPoint: 10, ...DEFAULT_SITE, date: '2026-06-21', linkeTurbidity: 4 });

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

/** The sun and clear-sky sunlight: apparent zenith, elevation and azimuth (degrees), and horizontal irradiance (W/m²). */
export interface SunState extends ClearSky { zenith: number; elevation: number; azimuth: number }
export interface WeatherState { hour: number; temperature: number; dewPoint: number; relativeHumidity: number; sun: SunState; albedo: number }
/** UTC instant (ms) of simulated time t: `date` + `startHour` local standard time + t. */
export function utcAt(w: WeatherModel, t: number) {
  const s = site(w), [y, m, d] = s.date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) + (w.startHour - s.utcOffset) * 3600000 + t * 1000;
}
/** Sun position and clear-sky sunlight (Ineichen–Perez) at simulated time t. */
export function sunAt(w: WeatherModel, t: number): SunState {
  const s = site(w), position = sunPosition(utcAt(w, t), s.latitude, s.longitude);
  const airmass = relativeAirmass(position.zenith) * pressureAt(s.altitude) / 101325;
  return { zenith: position.zenith, elevation: position.elevation, azimuth: position.azimuth, ...ineichen(position.zenith, airmass, s.linkeTurbidity, s.altitude, extraterrestrial(position.dayOfYear)) };
}
export function weatherAt(w: WeatherModel, t: number): WeatherState {
  const hour = hourOfDay(w, t), temperature = w.maxTemperature - rangeFraction(hour) * (w.maxTemperature - w.minTemperature);
  return { hour, temperature, dewPoint: w.dewPoint, relativeHumidity: Math.min(100, 100 * saturation(w.dewPoint) / saturation(temperature)), sun: sunAt(w, t), albedo: site(w).albedo };
}
/**
 * Step bound (s) for sunlight-driven panels: at most 1 % (at least 5 W/m²) of global horizontal irradiance change per
 * step, from the rate over the next minute.
 */
export function sunlightStepLimit(w: WeatherModel, t: number) {
  const now = sunAt(w, t).ghi, next = sunAt(w, t + 60).ghi, rate = Math.abs(next - now) / 60;
  return rate > 1e-9 ? Math.max(5, 0.01 * Math.max(now, next)) / rate : Infinity;
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
  if (x.date !== undefined && (typeof x.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x.date) || Number.isNaN(Date.parse(`${x.date}T00:00:00Z`)))) return 'Weather date must be a calendar date (YYYY-MM-DD).';
  const range = (v: unknown, lo: number, hi: number) => v === undefined || n(v) && (v as number) >= lo && (v as number) <= hi;
  if (!range(x.latitude, -90, 90) || !range(x.longitude, -180, 180)) return 'Latitude must be within ±90° and longitude within ±180°.';
  if (!range(x.utcOffset, -12, 14)) return 'UTC offset must be between −12 and +14 h.';
  if (!range(x.altitude, -400, 6000)) return 'Site altitude must be between −400 and 6000 m.';
  if (!range(x.linkeTurbidity, 1, 10)) return 'Linke turbidity must be between 1 and 10.';
  if (!range(x.albedo, 0, 1)) return 'Ground albedo must be between 0 and 1.';
  return null;
}

export const weatherBasisLabels = { published: 'Published method', assumed: 'Assumption' } as const;
export const weatherBasis: { kind: keyof typeof weatherBasisLabels; text: string }[] = [
  { kind: 'published', text: 'Air temperature follows the ASHRAE design-day profile: the hourly fraction of the daily range below the maximum (Handbook—Fundamentals), linear between full hours; minimum at 05:00, maximum 14:00–15:00. Relative humidity from a constant dew point by the Magnus formula (WMO 2008). Sun position by the NOAA solar calculator (Meeus) with refraction; clear-sky sunlight by Ineichen–Perez as in pvlib; sunlight on panels by the isotropic-sky model with ground reflection.' },
  { kind: 'assumed', text: 'The daily minimum, maximum and dew point are chosen values, not site data; the default is a cold clear January day in Munich (−5/3 °C, dew point −5 °C). The sky is always clear: Linke turbidity (default 3) and ground albedo (0.2) are chosen. Hours are local standard time (ASHRAE tabulates solar time). No clouds, wind or rain; windows gain no sunlight yet; the ground keeps its own model.' },
];
