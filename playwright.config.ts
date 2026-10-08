import { defineConfig } from "@playwright/test";

const PORT = 4173;

/**
 * By default the suite builds the app and tests it on a local preview server (only the production build carries the CSP).
 * Set E2E_BASE_URL to run the same behaviour tests against a deployed copy, e.g. after publishing to a site:
 *   E2E_BASE_URL=https://example.com/assets/tools/dq-profiler/ npm run test:e2e
 * The trailing slash matters: tests navigate with "./", which resolves against it.
 */
const remote = process.env.E2E_BASE_URL;
const baseURL = remote ? (remote.endsWith("/") ? remote : `${remote}/`) : `http://localhost:${PORT}/`;

export default defineConfig({
  testDir: "e2e",
  // `.e2e.ts` (not `.spec.ts`/`.test.ts`) keeps Vitest from picking these files up.
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL,
    // Locally use the installed Edge so no browser has to be downloaded; CI installs Chromium.
    channel: process.env.CI ? undefined : "msedge",
  },
  webServer: remote
    ? undefined
    : {
        command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
