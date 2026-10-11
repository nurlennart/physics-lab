import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";
// One worker per core (Vitest's default leaves one idle); long fixed-step campaigns live in their own files so
// they spread across workers. The timeout is a hang guard for simulation-heavy tests, not a performance assertion.
export default defineConfig({ test: { testTimeout: 30000, include: ["src/**/*.test.ts"], maxWorkers: availableParallelism() } });
