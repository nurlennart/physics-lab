// Exit 0 when node_modules holds exactly the package versions of package-lock.json (as `npm ci`
// installs them), so a gate run with these modules is equivalent to one after a clean install.
import { readFile } from "node:fs/promises";
const lock = JSON.parse(await readFile("package-lock.json", "utf8")).packages ?? {};
const installed = await readFile("node_modules/.package-lock.json", "utf8").then(JSON.parse, () => null);
if (!installed) { console.error("node_modules has no install record; run npm ci."); process.exit(1); }
const have = installed.packages ?? {};
const differs = Object.entries(lock)
  .filter(([path, entry]) => path && !entry.link && !entry.optional && !entry.peer)
  .filter(([path, entry]) => have[path]?.version !== entry.version)
  .map(([path, entry]) => `${path.replace(/^node_modules\//, "")}: lock ${entry.version}, installed ${have[path]?.version ?? "missing"}`);
const extra = Object.keys(have).filter((path) => path && !lock[path]);
if (differs.length || extra.length) {
  console.error(`node_modules differs from package-lock.json (run npm ci):\n  ${[...differs, ...extra.map((p) => `${p}: not in lock`)].slice(0, 10).join("\n  ")}`);
  process.exit(1);
}
