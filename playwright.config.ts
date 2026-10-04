import { defineConfig, devices } from "@playwright/test";
import { SCENARIOS } from "./e2e/scenarios";

// One server per scenario, each on its own port. Run `npm run build` first:
// the servers start the compiled app from dist/.
const webServer = Object.entries(SCENARIOS).map(([scenario, s]) => ({
  command: "node e2e/serve.mjs",
  url: `http://127.0.0.1:${s.port}/healthz`,
  env: { SCENARIO: scenario, PORT: String(s.port), CONTROL_PORT: String(s.controlPort) },
  reuseExistingServer: false,
  // The hang scenario waits out the cache's 10 second start limit.
  timeout: scenario === "hang" ? 40_000 : 30_000,
  stdout: "ignore" as const,
  stderr: "pipe" as const,
}));

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${SCENARIOS.ok.port}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "phone-320",
      use: { ...devices["Pixel 7"], viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true },
    },
    {
      name: "phone-390",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer,
});
