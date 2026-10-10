// Challenge score guard: runs every challenge's reference design and compares completion,
// score, stars and completion time with validation/reference-scores.json.
// Any difference fails (exit 1). After a deliberate change, re-record with:
//   node scripts/check-scores.mjs --update
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
const bundle = await build({
  stdin: { contents: `export { Simulation } from './src/simulation/engine'; export { starter } from './src/simulation/projects'; export { hydraulicStarter } from './src/simulation/hydraulic-projects'; export { mechanicalStarter } from './src/simulation/spatial-projects'; export { evaluateChallenge } from './src/simulation/challenges';`, resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "esm", write: false,
});
const { Simulation, starter, hydraulicStarter, mechanicalStarter, evaluateChallenge } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const designs = {
  light: () => starter("light"),
  heat: () => starter("heat"),
  runaway: () => starter("automated"),
  transfer: () => hydraulicStarter("transfer"),
  pressure: () => hydraulicStarter("pressure"),
  supply: () => hydraulicStarter("supply"),
  descent: () => mechanicalStarter("descent"),
  lift: () => mechanicalStarter("lift"),
  rotation: () => mechanicalStarter("rotation"),
};
const only = process.env.PHYSICS_CHALLENGES?.split(",");
const results = {};
for (const [id, make] of Object.entries(designs)) {
  if (only && !only.includes(id)) continue;
  const p = make();
  p.challenge = id;
  const s = new Simulation(p), started = performance.now();
  for (let i = 0; i < 7200 * 60; i++) {
    // The Thermal Runaway assignment requires a manual reset once the vessel has cooled.
    if (id === "runaway" && s.runaway.phase === "recovery" && s.runaway.safetyId && !s.automation.memory[s.runaway.safetyId].manualResets) {
      const cutoff = p.components.find((c) => c.id === s.runaway.safetyId);
      if (s.temperatures[String(cutoff.props.target)] <= 85) s.resetSafety(cutoff.id);
    }
    if (!s.step() || evaluateChallenge(p, s)?.complete) break;
  }
  const r = evaluateChallenge(p, s);
  results[id] = { complete: !!r?.complete, failed: !!r?.failed, score: r?.score ?? 0, stars: r?.stars ?? 0, time: Number(s.time.toFixed(3)), error: s.error, violations: s.violations };
  console.log(`${id.padEnd(9)} complete=${results[id].complete} score=${results[id].score} stars=${results[id].stars} t=${results[id].time}s (${((performance.now() - started) / 1000).toFixed(1)} s wall)${s.error ? " error: " + s.error : ""}`);
}
const file = "validation/reference-scores.json";
if (process.argv.includes("--update")) {
  await writeFile(file, JSON.stringify({ recordedAt: new Date().toISOString(), results }, null, 2) + "\n");
  console.log(`Recorded ${file}.`);
} else {
  const expected = JSON.parse(await readFile(file, "utf8")).results;
  const keys = ["complete", "failed", "score", "stars", "time", "error"];
  const diffs = Object.entries(results).flatMap(([id, r]) => keys.filter((k) => JSON.stringify(r[k]) !== JSON.stringify(expected[id]?.[k])).map((k) => `${id}.${k}: expected ${JSON.stringify(expected[id]?.[k])}, got ${JSON.stringify(r[k])}`));
  if (diffs.length) {
    console.error("Challenge reference results changed:\n  " + diffs.join("\n  ") + "\nIf the change is deliberate, re-record with: node scripts/check-scores.mjs --update");
    process.exitCode = 1;
  } else console.log("All challenge reference results match the recorded values.");
}
