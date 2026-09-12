import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "electron-vite";
import { dependencies } from "./package.json";
import { keepDevServerUntilElectronExits } from "./scripts/dev-server-lifecycle";

const workspaceRoot = resolve(__dirname, "../..");
const appRoot = resolve(__dirname);

const aliases = {
  "@deepwrite/contracts": resolve(
    workspaceRoot,
    "packages/contracts/src/index.ts"
  ),
  "@deepwrite/pi-runtime-adapter": resolve(
    workspaceRoot,
    "packages/pi-runtime-adapter/src/index.ts"
  ),
  "@deepwrite/shared": resolve(workspaceRoot, "packages/shared/src/index.ts")
};

const rendererAliases = [
  {
    find: /^@deepwrite\/contracts$/,
    replacement: resolve(workspaceRoot, "packages/contracts/src/renderer.ts")
  },
  {
    find: /^@deepwrite\/contracts\/system$/,
    replacement: resolve(workspaceRoot, "packages/contracts/src/system.ts")
  },
  {
    find: "@deepwrite/pi-runtime-adapter",
    replacement: resolve(
      workspaceRoot,
      "packages/pi-runtime-adapter/src/index.ts"
    )
  },
  {
    find: "@deepwrite/shared",
    replacement: resolve(workspaceRoot, "packages/shared/src/index.ts")
  }
];

export default defineConfig({
  main: {
    envDir: workspaceRoot,
    resolve: { alias: aliases },
    build: {
      rollupOptions: {
        external: ["electron", ...Object.keys(dependencies)],
        input: {
          index: resolve(appRoot, "src/main/index.ts"),
          "utilities/conversation-storage/worker-entry": resolve(
            appRoot,
            "src/utilities/conversation-storage/worker-entry.ts"
          ),
          "utilities/core-entry": resolve(
            appRoot,
            "src/utilities/core-entry.ts"
          ),
          "utilities/agent-entry": resolve(
            appRoot,
            "src/utilities/agent-entry.ts"
          ),
          "utilities/tool-entry": resolve(
            appRoot,
            "src/utilities/tool-entry.ts"
          )
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
    plugins: [
      keepDevServerUntilElectronExits(),
      vue({
        template: {
          compilerOptions: {
            isCustomElement: (tag) => tag === "webview"
          }
        }
      })
    ],
    resolve: { alias: rendererAliases },
    build: {
      // Vite's Rolldown environment currently preserves readable identifiers
      // unless minification is explicit. Shipping that output adds roughly a
      // megabyte of parse work to the workspace shell.
      minify: true,
      rollupOptions: {
        input: resolve(appRoot, "src/renderer/index.html"),
        treeshake: {
          // Contracts declare schemas, constants and pure helpers; they do not
          // register handlers. Keep unused schema modules out of the Renderer
          // when their types/helpers are re-exported through its public entry.
          moduleSideEffects: (id) => !id.includes("/packages/contracts/src/")
        },
        output: {
          codeSplitting: {
            groups: [
              {
                name: "qr-code",
                test: /node_modules[\\/](?:qrcode|dijkstrajs)[\\/]/
              }
            ]
          }
        }
      }
    }
  }
});
