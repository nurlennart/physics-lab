/** Solver quantities are SI. Legacy editor thermal properties remain L and °C. */
export const unitsSI = {
  litersToM3: (v: number) => v / 1000,
  m3ToLiters: (v: number) => v * 1000,
  lpmToM3s: (v: number) => v / 60000,
  m3sToLpm: (v: number) => v * 60000,
  barToPa: (v: number) => v * 100000,
  paToBar: (v: number) => v / 100000,
  celsiusToK: (v: number) => v + 273.15,
  kToCelsius: (v: number) => v - 273.15,
  rpmToRad: (v: number) => v * Math.PI / 30,
  radToRpm: (v: number) => v * 30 / Math.PI,
};
export const WATER_CP = 4180;
export const WATER_RHO = 1000;
export const WATER_MU = 0.001;
export const GRAVITY = 9.80665;
