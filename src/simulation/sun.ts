/**
 * Sun and clear-sky sunlight (published methods; no project state). Used by the weather model for a site, date and
 * time; data provenance and validation in docs/WEATHER.md.
 *
 *  - Sun position: NOAA solar calculator (after Meeus, Astronomical Algorithms), with NOAA's refraction correction.
 *  - Clear sky: Ineichen & Perez (2002), as implemented in pvlib (no Perez enhancement factor).
 *  - Sunlight on a tilted plane: isotropic sky (Liu & Jordan) with ground-reflected light.
 *  - Cell temperature: NOCT model, T_cell = T_air + (NOCT − 20 °C)·G/800 W/m².
 */
const rad = Math.PI / 180, deg = 180 / Math.PI;

export interface SunPosition {
  /** Apparent (refracted) zenith and elevation, and azimuth clockwise from north, in degrees. */
  zenith: number; elevation: number; azimuth: number;
  /** Day of year 1…366 of the UTC instant. */
  dayOfYear: number;
}

/** Sun position at a UTC instant (ms since 1970) for latitude/longitude in degrees (east and north positive). */
export function sunPosition(utcMillis: number, latitude: number, longitude: number): SunPosition {
  const jd = utcMillis / 86400000 + 2440587.5, jc = (jd - 2451545) / 36525;
  const l0 = ((280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360 + 360) % 360;
  const m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const c = Math.sin(m * rad) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) + Math.sin(2 * m * rad) * (0.019993 - 0.000101 * jc) + Math.sin(3 * m * rad) * 0.000289;
  const omega = 125.04 - 1934.136 * jc, apparentLongitude = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const meanObliquity = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * rad);
  const declination = Math.asin(Math.sin(obliquity * rad) * Math.sin(apparentLongitude * rad));
  const y = Math.tan(obliquity * rad / 2) ** 2;
  const equationOfTime = 4 * deg * (y * Math.sin(2 * l0 * rad) - 2 * e * Math.sin(m * rad) + 4 * e * y * Math.sin(m * rad) * Math.cos(2 * l0 * rad)
    - 0.5 * y * y * Math.sin(4 * l0 * rad) - 1.25 * e * e * Math.sin(2 * m * rad));
  const utcMinutes = ((utcMillis / 60000) % 1440 + 1440) % 1440;
  const trueSolarTime = ((utcMinutes + equationOfTime + 4 * longitude) % 1440 + 1440) % 1440;
  const hourAngle = trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180;
  const phi = latitude * rad;
  const cosZenith = Math.max(-1, Math.min(1, Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle * rad)));
  const zenith = Math.acos(cosZenith) * deg, elevation = 90 - zenith;
  const cosAzimuth = Math.max(-1, Math.min(1, (Math.sin(phi) * cosZenith - Math.sin(declination)) / (Math.cos(phi) * Math.sin(zenith * rad))));
  const azimuth = hourAngle > 0 ? (Math.acos(cosAzimuth) * deg + 180) % 360 : (540 - Math.acos(cosAzimuth) * deg) % 360;
  const apparent = elevation + refraction(elevation);
  const start = Date.UTC(new Date(utcMillis).getUTCFullYear(), 0, 1);
  return { zenith: 90 - apparent, elevation: apparent, azimuth, dayOfYear: Math.floor((utcMillis - start) / 86400000) + 1 };
}
/** NOAA atmospheric refraction (degrees) at a geometric elevation (degrees). */
export function refraction(elevation: number) {
  if (elevation > 85) return 0;
  const t = Math.tan(elevation * rad);
  const arcsec = elevation > 5 ? 58.1 / t - 0.07 / t ** 3 + 0.000086 / t ** 5
    : elevation > -0.575 ? 1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)))
      : -20.772 / t;
  return arcsec / 3600;
}

/** Extraterrestrial normal irradiance (W/m²), Spencer (1971) with a 1366.1 W/m² solar constant (pvlib's default). */
export function extraterrestrial(dayOfYear: number) {
  const b = 2 * Math.PI * (dayOfYear - 1) / 365;
  return 1366.1 * (1.00011 + 0.034221 * Math.cos(b) + 0.00128 * Math.sin(b) + 0.000719 * Math.cos(2 * b) + 0.000077 * Math.sin(2 * b));
}
/** Station pressure (Pa) at an altitude (m), as pvlib's alt2pres. */
export const pressureAt = (altitude: number) => 100 * ((44331.514 - altitude) / 11880.516) ** (1 / 0.1902632);
/** Relative optical air mass at an apparent zenith (degrees), Kasten & Young (1989); NaN at or below the horizon. */
export const relativeAirmass = (zenith: number) => zenith >= 90 ? NaN : 1 / (Math.cos(zenith * rad) + 0.50572 * (96.07995 - zenith) ** -1.6364);

export interface ClearSky { ghi: number; dni: number; dhi: number }
/**
 * Ineichen–Perez clear-sky global, direct normal and diffuse horizontal irradiance (W/m²) for an apparent zenith
 * (degrees), absolute air mass, Linke turbidity, altitude (m) and extraterrestrial irradiance — pvlib.clearsky.ineichen.
 */
export function ineichen(zenith: number, airmassAbsolute: number, linkeTurbidity: number, altitude = 0, dniExtra = 1364): ClearSky {
  const cosZenith = Math.max(0, Math.cos(zenith * rad));
  if (!(cosZenith > 0) || !Number.isFinite(airmassAbsolute)) return { ghi: 0, dni: 0, dhi: 0 };
  const tl = linkeTurbidity, fh1 = Math.exp(-altitude / 8000), fh2 = Math.exp(-altitude / 1250);
  const cg1 = 5.09e-5 * altitude + 0.868, cg2 = 3.92e-5 * altitude + 0.0387;
  const ghi = cg1 * dniExtra * cosZenith * Math.max(0, Math.exp(-cg2 * airmassAbsolute * (fh1 + fh2 * (tl - 1))));
  const b = 0.664 + 0.163 / fh1, beam = dniExtra * Math.max(0, b * Math.exp(-0.09 * airmassAbsolute * (tl - 1)));
  const cap = ghi * Math.min(Math.max((1 - (0.1 - 0.2 * Math.exp(-tl)) / (0.1 + 0.882 / fh1)) / cosZenith, 0), 1e20);
  const dni = Math.min(beam, cap);
  return { ghi, dni, dhi: ghi - dni * cosZenith };
}

/** Cosine of the angle of incidence on a plane of tilt β and azimuth (degrees, clockwise from north). */
export function incidenceCosine(sunZenith: number, sunAzimuth: number, tilt: number, azimuth: number) {
  return Math.cos(sunZenith * rad) * Math.cos(tilt * rad) + Math.sin(sunZenith * rad) * Math.sin(tilt * rad) * Math.cos((sunAzimuth - azimuth) * rad);
}
/** Sunlight on a tilted plane (W/m²): beam + isotropic sky diffuse + ground-reflected light. */
export function planeOfArray(sky: ClearSky, sunZenith: number, sunAzimuth: number, tilt: number, azimuth: number, albedo: number) {
  const beam = sky.dni * Math.max(0, incidenceCosine(sunZenith, sunAzimuth, tilt, azimuth));
  return beam + sky.dhi * (1 + Math.cos(tilt * rad)) / 2 + sky.ghi * albedo * (1 - Math.cos(tilt * rad)) / 2;
}
/** NOCT cell temperature (°C): the module's nominal operating cell temperature at 800 W/m², 20 °C air (IEC 61215). */
export const noctCellTemperature = (air: number, irradiance: number, noct: number) => air + (noct - 20) * irradiance / 800;
