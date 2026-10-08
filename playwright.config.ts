import { defineConfig } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "e2e",
  // `.e2e.ts` (not `.spec.ts`/`.test.ts`) keeps Vitest from picking these files up.
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Locally use the installed Edge so no browser has to be downloaded; CI installs Chromium.
    channel: process.env.CI ? undefined : "msedge",
  },
  // The production build is tested on purpose: only it carries the Content-Security-Policy.
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
