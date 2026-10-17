import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { resolveRendererStyles } from "./tools/resolve-renderer-styles.mjs";

const configuredMaxWorkers = process.env.DEEPWRITE_TEST_MAX_WORKERS;
const maxWorkers =
  configuredMaxWorkers === undefined ? undefined : Number(configuredMaxWorkers);
if (
  maxWorkers !== undefined &&
  (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1)
) {
  throw new Error("DEEPWRITE_TEST_MAX_WORKERS must be a positive integer.");
}

export default defineConfig({
  plugins: [
    vue({
      template: {
        // The logo's <image href="/app-icon.png"> targets the public root at
        // runtime; asset-import compilation turns it into a synthetic URL
        // module that Windows cannot evaluate in tests.
        transformAssetUrls: { image: false }
      }
    }),
    {
      name: "deepwrite-test-source",
      enforce: "pre",
      resolveId(id) {
        if (id === "virtual:deepwrite-renderer-styles") {
          return "\0virtual:deepwrite-renderer-styles";
        }
        return null;
      },
      load(id) {
        if (id !== "\0virtual:deepwrite-renderer-styles") return null;
        const source = resolveRendererStyles();
        return `export default ${JSON.stringify(source)};`;
      }
    }
  ],
  test: {
    maxWorkers,
    globalSetup: ["./tools/setup-i18n-fixtures.ts"],
    setupFiles: ["./tools/setup-renderer-i18n.ts"],
    // Windows CI runners drive slower disks; keep the same budgets as the
    // failing bound instead of letting heavy fs tests trip the default.
    testTimeout: process.platform === "win32" ? 120_000 : 30_000,
    hookTimeout: process.platform === "win32" ? 60_000 : 20_000,
    include: [
      "packages/**/*.test.ts",
      "tools/**/*.test.mjs",
      "apps/desktop/src/main/**/*.test.ts",
      "apps/desktop/src/utilities/**/*.test.{ts,mjs}",
      "apps/desktop/src/extras/**/*.test.ts",
      "apps/desktop/src/renderer/**/*.test.ts"
    ],
    environment: "node"
  }
});
