import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // PGlite boots a full Postgres in-process for each test file.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
