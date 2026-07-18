import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/desktop/src/main/**/*.test.ts",
      "apps/desktop/src/renderer/**/*.test.ts"
    ],
    environment: "node"
  }
});
