import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.ts",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    headless: true,
    baseURL: "http://127.0.0.1:4173",
  },
});
