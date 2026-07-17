import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const workspaceRoot = resolve(__dirname, "../..");
const appRoot = resolve(__dirname);

const aliases = {
  "@deepwrite/contracts": resolve(workspaceRoot, "packages/contracts/src/index.ts"),
  "@deepwrite/pi-runtime-adapter": resolve(workspaceRoot, "packages/pi-runtime-adapter/src/index.ts"),
  "@deepwrite/shared": resolve(workspaceRoot, "packages/shared/src/index.ts")
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: aliases },
    build: {
      rollupOptions: {
        external: ["electron"],
        input: {
          index: resolve(appRoot, "src/main/index.ts"),
          "utilities/core-entry": resolve(appRoot, "src/utilities/core-entry.ts"),
          "utilities/agent-entry": resolve(appRoot, "src/utilities/agent-entry.ts"),
          "utilities/tool-entry": resolve(appRoot, "src/utilities/tool-entry.ts")
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: aliases },
    build: {
      rollupOptions: {
        external: ["electron"],
        input: { index: resolve(appRoot, "src/preload/index.ts") },
        output: { format: "cjs", entryFileNames: "[name].js" }
      }
    }
  },
  renderer: {
    root: resolve(appRoot, "src/renderer"),
    plugins: [vue()],
    resolve: { alias: aliases }
  }
});
