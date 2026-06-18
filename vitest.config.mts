import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
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
