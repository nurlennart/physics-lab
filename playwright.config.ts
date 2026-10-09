import { defineConfig } from "@playwright/test";
const productionURL = process.env.PHYSICS_LAB_URL;
export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: productionURL ?? "http://localhost:5173",
    viewport: { width: 1440, height: 1000 },
    launchOptions: { args: ["--no-sandbox"] },
  },
  webServer: productionURL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:5173",
        reuseExistingServer: true,
      },
  reporter: "list",
});
