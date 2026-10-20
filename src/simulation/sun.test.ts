import { describe, it, expect } from 'vitest';
import { Simulation } from './engine';
import { makeComponent, type Project } from './model';
import { parseProject, serializeProject, starter } from './projects';
import { incidenceCosine, ineichen, noctCellTemperature, planeOfArray, sunPosition } from './sun';
import { panelConditions, pvModel } from './solar';
import { defaultDesignDay, site, summerDesignDay, sunAt, weatherAt, weatherError } from './weather';

// References are published values entered here as numbers; they do not come from sun.ts:
//  - NREL Solar Position Algorithm report (Reda & Andreas 2004, NREL/TP-560-34302), worked example;
//  - pvlib-python's clear-sky tests (tests/test_clearsky.py: ineichen scalar, dni_extra, altitude and 3×3×3 grid);
//  - Trina Solar Vertex S+ TSM-450NEG9R.28 datasheet NOCT point (withheld from the PV fit).

describe('sun position (NOAA, after Meeus)', () => {
  it('matches the NREL SPA worked example within 0.01°', () => {
    // 17 Oct 2003, 12:30:30 local time at UTC−7; 39.742476° N, 105.1786° W. SPA: zenith 50.11162°, azimuth 194.34024°.
    const p = sunPosition(Date.UTC(2003, 9, 17, 19, 30, 30), 39.742476, -105.1786);
    expect(Math.abs(p.zenith - 50.11162)).toBeLessThan(0.01);
    expect(Math.abs(p.azimuth - 194.34024)).toBeLessThan(0.01);
  });
  it('puts the noon sun over Munich at 90° − φ ± 23.44° at the solstices', () => {
    const highest = (month: number, day: number) => Math.max(...Array.from({ length: 241 }, (_, k) => sunPosition(Date.UTC(2026, month, day, 9) + k * 60000, 48.14, 11.58).elevation));
    expect(highest(5, 21)).toBeCloseTo(90 - 48.14 + 23.44, 0);
    expect(highest(11, 21)).toBeCloseTo(90 - 48.14 - 23.44, 0);
  });
});

describe('clear-sky sunlight (Ineichen–Perez, as pvlib)', () => {
  it('reproduces pvlib\'s scalar, extraterrestrial and altitude cases', () => {
    const scalar = ineichen(10, 1, 3);
    expect(scalar.ghi).toBeCloseTo(1038.159219, 5); expect(scalar.dni).toBeCloseTo(942.2081860378344, 5); expect(scalar.dhi).toBeCloseTo(110.26529293612793, 5);
    const extra = ineichen(10, 1, 3, 0, 1370);
    expect(extra.ghi).toBeCloseTo(1042.72590228, 5); expect(extra.dni).toBeCloseTo(946.35279683, 5); expect(extra.dhi).toBeCloseTo(110.75033088, 5);
    const high = ineichen(10, 1, 3, 2000);
    expect(high.ghi).toBeCloseTo(1134.24312405, 5); expect(high.dni).toBeCloseTo(994.95377835, 5); expect(high.dhi).toBeCloseTo(154.40492924, 5);
  });
  it('reproduces pvlib\'s 3 × 3 × 3 grid of zenith, air mass and turbidity', () => {
    // np.meshgrid(zenith [0, 40, 80], air mass [1, 5.5, 10], turbidity [2, 3, 4]): index [air mass][zenith][turbidity].
    const ghi = [[[1095.77074798, 1054.17449885, 1014.15727338], [839.40909243, 807.54451692, 776.88954373], [190.27859353, 183.05548067, 176.10656239]],
      [[773.49041181, 625.19479557, 505.33080493], [592.52803177, 478.92699901, 387.10585505], [134.31520045, 108.56393694, 87.74977339]],
      [[545.9968869, 370.78162375, 251.79449885], [418.25788117, 284.03520249, 192.88577665], [94.81136442, 64.38555328, 43.72365587]]];
    const dni = [[1014.38807396, 942.20818604, 861.11344424], [687.61305142, 419.14891162, 255.50098235], [458.62196014, 186.46177428, 75.80970012]];
    const dhi = [[[81.38267402, 111.96631281, 153.04382915], [62.3427452, 85.77117175, 117.23837487], [14.13195304, 19.44274618, 26.57578203]],
      [[85.87736039, 206.04588395, 249.82982258], [65.78587472, 157.84030442, 191.38074731], [14.91244713, 35.77949226, 43.38249342]],
      [[87.37492676, 184.31984947, 175.98479873], [66.93307711, 141.19719644, 134.81217714], [15.17249681, 32.00680597, 30.5594396]]];
    [1, 5.5, 10].forEach((am, i) => [0, 40, 80].forEach((z, j) => [2, 3, 4].forEach((tl, k) => {
      const x = ineichen(z, am, tl);
      expect(x.ghi, `ghi ${am}/${z}/${tl}`).toBeCloseTo(ghi[i][j][k], 5);
      expect(x.dni, `dni ${am}/${z}/${tl}`).toBeCloseTo(dni[i][k], 5);
      expect(x.dhi, `dhi ${am}/${z}/${tl}`).toBeCloseTo(dhi[i][j][k], 5);
    })));
  });
  it('gives no sunlight with the sun below the horizon', () => {
    expect(ineichen(95, NaN, 3)).toEqual({ ghi: 0, dni: 0, dhi: 0 });
    const night = sunAt({ ...summerDesignDay(), startHour: 0 }, 0);
    expect(night.elevation).toBeLessThan(0); expect(night.ghi).toBe(0);
  });
});

describe('sunlight on the module and cell temperature', () => {
  const sky = ineichen(30, 1.15, 3);
  it('a flat module sees the horizontal sunlight; a module facing the sun the direct beam in full', () => {
    expect(planeOfArray(sky, 30, 180, 0, 180, 0.2)).toBeCloseTo(sky.ghi, 9);
    expect(incidenceCosine(30, 200, 30, 200)).toBeCloseTo(1, 12);
    expect(planeOfArray(sky, 30, 200, 30, 200, 0)).toBeCloseTo(sky.dni + sky.dhi * (1 + Math.cos(Math.PI / 6)) / 2, 9);
    // A vertical north wall gets no beam from a southern sun, only sky and ground light.
    expect(planeOfArray(sky, 30, 180, 90, 0, 0.2)).toBeCloseTo(sky.dhi / 2 + sky.ghi * 0.2 / 2, 9);
  });
  it('reaches the datasheet NOCT point: 43 °C cell at 800 W/m² and 20 °C air, 344 W and 50.2 V within 3 %', () => {
    const pv = makeComponent('solarPanel', 0, 0, []);
    const cell = noctCellTemperature(20, 800, pv.props.noct as number), x = pvModel(pv, { irradiance: 800, cellTemperature: cell, fromWeather: true });
    expect(cell).toBe(43);
    expect(Math.abs(x.pmp / 344 - 1)).toBeLessThan(0.03);
    expect(Math.abs(x.voc / 50.2 - 1)).toBeLessThan(0.01);
    expect(Math.abs(x.isc / 8.66 - 1)).toBeLessThan(0.01);
  });
  it('uses the fixed values unless the panel follows the weather', () => {
    const pv = makeComponent('solarPanel', 0, 0, []), w = weatherAt(summerDesignDay(), 10 * 3600); // 10:00
    expect(panelConditions(pv, w)).toEqual({ irradiance: 1000, cellTemperature: 25, fromWeather: false });
    pv.props.conditions = 'weather';
    expect(panelConditions(pv).fromWeather).toBe(false); // no weather in force
    const sun = panelConditions(pv, w);
    expect(sun.fromWeather).toBe(true); expect(sun.irradiance).toBeGreaterThan(600);
    expect(sun.cellTemperature).toBeCloseTo(w.temperature + 23 * sun.irradiance / 800, 9);
  });
});

describe('a June day in the engine', () => {
  it('produces PV power with the sun only and closes the energy ledger', () => {
    const at = (startHour: number, seconds: number) => {
      const p = starter('solarDay'); p.weather = { ...p.weather!, startHour };
      const s = new Simulation(p), pv = p.components.find(c => c.kind === 'solarPanel')!;
      s.advanceAdaptive(seconds);
      expect(s.error).toBeNull(); expect(s.violations).toEqual([]);
      expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
      return s.electrical.readings[pv.id]?.solar?.outputPower ?? 0;
    };
    expect(at(11.5, 1800)).toBeGreaterThan(300); // around noon
    expect(at(22, 600)).toBe(0); // night
  });
  it('keeps old weather files valid and round-trips the site', () => {
    const old = { kind: 'designDay' as const, startHour: 0, minTemperature: -5, maxTemperature: 3, dewPoint: -5 };
    expect(weatherError(old)).toBeNull();
    expect(site(old).latitude).toBe(48.14);
    expect(weatherAt(old, 0).sun.elevation).toBeCloseTo(weatherAt(defaultDesignDay(), 0).sun.elevation, 12);
    const p: Project = { ...starter('solarDay') };
    expect(parseProject(JSON.parse(serializeProject(p))).weather).toEqual(p.weather);
    for (const bad of [{ date: '2026-13-40' }, { latitude: 91 }, { utcOffset: 15 }, { linkeTurbidity: 0.5 }, { albedo: 1.5 }])
      expect(weatherError({ ...summerDesignDay(), ...bad }), JSON.stringify(bad)).not.toBeNull();
  });
});
