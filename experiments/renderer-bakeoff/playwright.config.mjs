import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.mjs",
  timeout: 45_000,
  use: { baseURL: "http://127.0.0.1:4178", browserName: "chromium",
    viewport: { width: 1450, height: 940 }, headless: true },
  webServer: { command: "npm run dev -- --port 4178 --strictPort",
    url: "http://127.0.0.1:4178", reuseExistingServer: !process.env.CI,
    timeout: 120_000 },
  reporter: [["list"], ["json", { outputFile: "test-results/playwright.json" }]],
});
