import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 15000, // Cold route-module imports on hosted workspaces can exceed five seconds.
    include: ["src/tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    pool: "threads",
    maxWorkers: 1,
    fileParallelism: false,
  },
});
