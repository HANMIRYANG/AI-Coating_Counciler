import { defineConfig, devices } from "@playwright/test";

// Why no Playwright-managed webServer by default on Windows:
//   Playwright's own webServer block can spawn Next fine, but its post-test
//   teardown is unreliable on Windows. Tests pass, then the run hangs
//   without printing the final summary and never exits. The runner script
//   at `apps/web/scripts/run-e2e.mjs` owns the dev server lifecycle
//   instead (spawn → wait-for-ready → run Playwright with stdio inherited
//   → taskkill /T /F in finally) and sets `E2E_SERVER_EXTERNAL=1` to tell
//   this config to skip its own webServer block.
//
// The Playwright-managed fallback below is kept for environments where the
// runner is not used (e.g. ad-hoc `npx playwright test` on a POSIX host).
const PORT = 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const NEXT_BIN_RELATIVE = "../../node_modules/next/dist/bin/next";
const externalServer = process.env.E2E_SERVER_EXTERNAL === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  ...(externalServer
    ? {}
    : {
        webServer: {
          command: `node ${NEXT_BIN_RELATIVE} dev -H 127.0.0.1 -p ${PORT}`,
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          stdout: "ignore",
          stderr: "pipe",
        },
      }),
});
