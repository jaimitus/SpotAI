import { defineConfig } from "@playwright/test";

/**
 * E2E smoke tests for the Spotlight UI. Locally the suite runs against the
 * system Chrome (`PW_CHANNEL=chrome npx playwright test`), avoiding a browser
 * download; in CI it uses the bundled chromium installed by
 * `npx playwright install --with-deps chromium`.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  use: {
    baseURL: "http://localhost:4199",
    browserName: "chromium",
    channel: process.env.PW_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 4199 --strictPort",
    url: "http://localhost:4199",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
