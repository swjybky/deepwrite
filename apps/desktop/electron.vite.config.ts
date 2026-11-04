import { i18nResourcesPlugin } from "./scripts/i18n-resources";
import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "electron-vite";
import { dependencies } from "./package.json";
import { keepDevServerUntilElectronExits } from "./scripts/dev-server-lifecycle";

const workspaceRoot = resolve(__dirname, "../..");
const appRoot = resolve(__dirname);

const aliases = {
  // Before the package alias, which would otherwise capture this subpath.
  "@deepwrite/contracts/external-control": resolve(
    workspaceRoot,
    "packages/contracts/src/external-control/index.ts"
  ),
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
    // Never bundle legacy OSS credentials from a developer or release .env.
    envPrefix: ["MAIN_VITE_DEEPWRITE_"],
    resolve: { alias: aliases },
    build: {
      rollupOptions: {
        external: ["electron", ...Object.keys(dependencies)],
        input: {
          index: resolve(appRoot, "src/main/index.ts"),
          "extras/external-control/bridge-entry": resolve(
            appRoot,
            "src/extras/external-control/bridge-entry.ts"
          ),
          "utilities/conversation-storage/worker-entry": resolve(
            appRoot,
            "src/utilities/conversation-storage/worker-entry.ts"
          ),
          "utilities/core-entry": resolve(
            appRoot,
            "src/utilities/core-entry.ts"
          ),
          "utilities/storage-migration-entry": resolve(
            appRoot,
            "src/utilities/storage-migration-entry.ts"
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
    define: {
      __VUE_I18N_FULL_INSTALL__: false,
      __VUE_I18N_LEGACY_API__: false,
      __INTLIFY_PROD_DEVTOOLS__: false
    },
    root: resolve(appRoot, "src/renderer"),
    plugins: [
      i18nResourcesPlugin(resolve(appRoot, "src/renderer/src/i18n/messages")),
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
                name: "vue-runtime",
                includeDependenciesRecursively: false,
                // Shared Vue primitives must initialize before application i18n.
                test: /node_modules[\\/](?:vue[\\/]|@vue[\\/])/
              },
              {
                name: "i18n-runtime",
                includeDependenciesRecursively: false,
                // Keep the new translation dependency measurable on its own.
                test: /node_modules[\\/](?:vue-i18n[\\/]|@intlify[\\/])/
              },
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
