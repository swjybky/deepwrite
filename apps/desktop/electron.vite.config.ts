import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "electron-vite";
import { dependencies } from './package.json'

const workspaceRoot = resolve(__dirname, "../..");
const appRoot = resolve(__dirname);

const aliases = {
  "@deepwrite/contracts": resolve(workspaceRoot, "packages/contracts/src/index.ts"),
  "@deepwrite/pi-runtime-adapter": resolve(workspaceRoot, "packages/pi-runtime-adapter/src/index.ts"),
  "@deepwrite/shared": resolve(workspaceRoot, "packages/shared/src/index.ts")
};

export default defineConfig({
  main: {
    envDir: workspaceRoot,
    resolve: { alias: aliases },
    build: {
      rollupOptions: {
        external: ["electron", ...Object.keys(dependencies)],
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
    resolve: { alias: aliases },
    build: {
      rollupOptions: {
        external: ["electron", ...Object.keys(dependencies)],
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
