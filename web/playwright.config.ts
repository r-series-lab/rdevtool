import { defineConfig } from "@playwright/test";

const smokePort = 4174;

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  outputDir: "node_modules/.cache/playwright-results",
  use: {
    baseURL: `http://127.0.0.1:${smokePort}`,
    browserName: "chromium",
    channel: process.env.CI ? undefined : "chrome",
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --port ${smokePort}`,
    url: `http://127.0.0.1:${smokePort}/smoke.html`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
