import { defineConfig } from "vitest/config";
// Serialize CPU-heavy physics files for reproducible timings on small hosts.
// Verbose output reports individual tests instead of appearing idle until a long
// file completes. Both fork and thread pools pass focused diagnostics; no solver
// assertions or existing timeouts are changed. Override --maxWorkers as needed.
export default defineConfig({ test: { testTimeout: 30000, include: ["src/**/*.test.ts"], pool: "forks", maxWorkers: 1, reporters: ["verbose"] } });
