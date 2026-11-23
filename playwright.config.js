// End-to-end smoke tests, run against the Docker stack (docker compose up).
// They exist so the front-end restructure (docs/ARCHITECTURE.md, section 8)
// can be checked after every step: run `npm test`.
//
// One worker: the tests share the dev database and some of them edit it.
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL: process.env.BOARD_URL || "http://localhost:8080",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
