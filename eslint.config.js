import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";
import { deepwriteRules } from "./tools/eslint-rules.mjs";

const deepwritePlugin = { rules: deepwriteRules };
const sourceFiles = ["**/*.{js,mjs,cjs,ts,vue}"];
const testFiles = [
  "**/*.test.{ts,mjs}",
  "**/*.test-support.ts",
  "**/*-test-support.ts",
  "**/test-support.ts",
  "**/test-utils/**",
  "**/fixtures/**",
  "**/smoke-*.ts",
  "**/faux.ts"
];
const appSource = ["apps/desktop/src/**/*.{ts,vue}", "packages/*/src/**/*.ts"];
const mainSource = [
  "apps/desktop/src/main/**/*.ts",
  "apps/desktop/src/extras/**/*.ts"
];
const fsWriteImports = [
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "rename",
  "renameSync",
  "rm",
  "rmSync",
  "unlink",
  "unlinkSync",
  "copyFile",
  "copyFileSync",
  "cp",
  "cpSync",
  "truncate",
  "truncateSync",
  "mkdir",
  "mkdirSync",
  "rmdir",
  "rmdirSync",
  "link",
  "linkSync",
  "symlink",
  "symlinkSync",
  "default",
  "createWriteStream"
];
// Main may write only what it owns: its userData config and state, the
// storage relocation it performs, and export files at a path the user chose.
const mainFileWriters = [
  "apps/desktop/src/extras/book-identity/cover-export.ts",
  "apps/desktop/src/extras/cloud-backup/identity.ts",
  "apps/desktop/src/extras/device-sync/initialization-workspace.ts",
  "apps/desktop/src/extras/device-sync/local-storage.ts",
  "apps/desktop/src/extras/external-control/audit-log.ts",
  "apps/desktop/src/extras/external-control/control-server.ts",
  "apps/desktop/src/extras/external-control/control-state-file.ts",
  "apps/desktop/src/extras/external-control/skill-install.ts",
  "apps/desktop/src/extras/external-control/trash-store.ts",
  "apps/desktop/src/main/academic-manuscript-export.ts",
  "apps/desktop/src/main/agent-team-package-service.ts",
  "apps/desktop/src/main/appearance-font-store.ts",
  "apps/desktop/src/main/book-template-store.ts",
  "apps/desktop/src/main/configuration-lock.ts",
  "apps/desktop/src/main/configuration-profile.ts",
  "apps/desktop/src/main/desktop-startup.ts",
  "apps/desktop/src/main/export-file-paths.ts",
  "apps/desktop/src/main/image/image-json.ts",
  "apps/desktop/src/main/long-manuscript-export.ts",
  "apps/desktop/src/main/manuscript-markdown.ts",
  "apps/desktop/src/main/marketplace-account-client.ts",
  "apps/desktop/src/main/model-config-persistence.ts",
  "apps/desktop/src/main/model-usage-store.ts",
  "apps/desktop/src/main/mystery-bundle-export.ts",
  "apps/desktop/src/main/short-manuscript-export.ts",
  "apps/desktop/src/main/startup-log.ts",
  "apps/desktop/src/main/storage-bootstrap.ts",
  "apps/desktop/src/main/storage-location-store.ts",
  "apps/desktop/src/main/storage-settings-service.ts",
  "apps/desktop/src/main/subagent-call-journal.ts",
  "apps/desktop/src/main/update-install-marker.ts",
  "apps/desktop/src/main/voice/voice-persistence.ts",
  "apps/desktop/src/main/web-search/web-search-json.ts",
  "apps/desktop/src/main/workspace-directory-store.ts"
];
const sqliteImport = {
  name: "node:sqlite",
  message:
    "SQLite 只在 utilities/conversation-storage/ 里使用，其他代码经它的接口读写对话记录。"
};
const directNetworkGlobals = [
  "error",
  {
    globals: ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"].map(
      (name) => ({
        name,
        message: "远程请求经 Main，Renderer 使用 api/deepwrite.ts。"
      })
    ),
    checkGlobalObject: true
  }
];
const nodeFiles = [
  "*.{js,mjs,cjs,ts}",
  "tools/**/*.{js,mjs,cjs,ts}",
  "packages/**/*.{js,mjs,cjs,ts}",
  "apps/desktop/src/main/**/*.{js,mjs,cjs,ts}",
  "apps/desktop/src/preload/**/*.{js,mjs,cjs,ts}",
  "apps/desktop/src/utilities/**/*.{js,mjs,cjs,ts}",
  "apps/desktop/src/extras/**/*.{js,mjs,cjs,ts}",
  "apps/desktop/scripts/**/*.{js,mjs,cjs,ts}"
];

export default defineConfig(
  globalIgnores([
    "**/node_modules/**",
    "**/out/**",
    "**/dist/**",
    "**/release/**",
    "**/coverage/**",
    ".agents/**",
    ".codex/**",
    ".claude/**",
    "test/**"
  ]),
  {
    files: sourceFiles,
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    linterOptions: {
      // Conventions are fixed in this file; inline eslint comments cannot waive them.
      noInlineConfig: true
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_"
        }
      ],
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": true,
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false
        }
      ],
      // These expressions intentionally strip unsafe filesystem characters.
      "no-control-regex": "off",
      // DeepWrite often maps infrastructure errors to safe user-facing errors;
      // requiring the original error as `cause` could expose sensitive details.
      "preserve-caught-error": "off"
    }
  },
  {
    files: ["**/*.vue"],
    extends: [...pluginVue.configs["flat/essential"]],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser
      }
    },
    rules: {
      "vue/no-mutating-props": ["error", { shallowOnly: true }]
    }
  },
  {
    files: nodeFiles,
    languageOptions: {
      globals: globals.node
    }
  },
  {
    files: ["apps/desktop/src/renderer/**/*.{js,ts,vue}"],
    languageOptions: {
      globals: globals.browser
    }
  },
  {
    // Serialized and run inside the app window by the verification CLI.
    files: ["tools/control/lib/page-helper.mjs"],
    languageOptions: {
      globals: globals.browser
    }
  },
  {
    files: appSource,
    ignores: testFiles,
    plugins: { deepwrite: deepwritePlugin },
    rules: {
      "deepwrite/no-double-cast": "error",
      "deepwrite/no-json-clone": "error",
      "deepwrite/no-local-helper": "error"
    }
  },
  {
    files: [
      "packages/shared/src/**",
      "packages/contracts/src/expert-draft.ts",
      "apps/desktop/src/renderer/src/composables/useDialogKeyboard.ts"
    ],
    rules: {
      "deepwrite/no-json-clone": "off",
      "deepwrite/no-local-helper": "off"
    }
  },
  {
    files: mainSource,
    ignores: testFiles,
    plugins: { deepwrite: deepwritePlugin },
    rules: {
      "deepwrite/no-inline-rejection": "error",
      "deepwrite/no-core-registry": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...["node:fs", "node:fs/promises", "fs", "fs/promises"].map(
              (name) => ({
                name,
                importNames: fsWriteImports,
                message:
                  "作品与注册表交给 Core；Main 配置写入用 @deepwrite/shared/node 的 writeJsonAtomic，导出文件用 Main 的导出接口。"
              })
            ),
            sqliteImport
          ]
        }
      ]
    }
  },
  {
    files: mainFileWriters,
    rules: {
      "no-restricted-imports": ["error", { paths: [sqliteImport] }]
    }
  },
  {
    files: [
      "apps/desktop/src/main/ipc/errors.ts",
      "apps/desktop/src/extras/external-control/**"
    ],
    rules: { "deepwrite/no-inline-rejection": "off" }
  },
  {
    files: ["apps/desktop/src/utilities/**/*.ts"],
    ignores: [
      ...testFiles,
      "apps/desktop/src/utilities/conversation-storage/**"
    ],
    rules: { "no-restricted-imports": ["error", { paths: [sqliteImport] }] }
  },
  {
    files: [
      "apps/desktop/src/preload/**/*.ts",
      "packages/contracts/src/**/*.ts",
      "packages/shared/src/**/*.ts"
    ],
    ignores: testFiles,
    rules: { "no-restricted-imports": ["error", { paths: [sqliteImport] }] }
  },
  {
    files: ["packages/pi-runtime-adapter/src/**/*.ts"],
    ignores: testFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            "node:fs",
            "node:fs/promises",
            "node:child_process",
            "node:sqlite",
            "fs",
            "fs/promises",
            "child_process",
            "@deepwrite/shared/node"
          ].map((name) => ({
            name,
            message:
              "智能体不直接碰文件和进程：读作品走 Core 只读桥，改文稿先出 proposal。"
          }))
        }
      ]
    }
  },
  {
    files: ["apps/desktop/src/renderer/**/*.{ts,vue}"],
    ignores: testFiles,
    plugins: { deepwrite: deepwritePlugin },
    rules: {
      "deepwrite/renderer-bridge": "error",
      "deepwrite/renderer-storage": "error",
      "deepwrite/renderer-native-dialog": "error",
      "deepwrite/renderer-error-text": "error",
      "no-restricted-globals": directNetworkGlobals
    }
  },
  {
    files: ["apps/desktop/src/renderer/src/api/deepwrite.ts"],
    rules: { "deepwrite/renderer-bridge": "off" }
  },
  {
    files: ["apps/desktop/src/renderer/src/utils/uiStorage.ts"],
    rules: { "deepwrite/renderer-storage": "off" }
  },
  {
    files: ["apps/desktop/src/renderer/src/i18n/errors.ts"],
    rules: { "deepwrite/renderer-error-text": "off" }
  },
  {
    files: ["apps/desktop/src/renderer/src/i18n/load-messages.ts"],
    rules: { "no-restricted-globals": "off" }
  },
  {
    files: testFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "\\.(ts|vue|mjs|css)\\?raw$",
              message: "测试不读源码文本：渲染组件、调用函数，断言行为。"
            },
            {
              group: ["virtual:*"],
              message: "测试不读打包后的样式文本，断言渲染结果。"
            }
          ]
        }
      ]
    }
  },
  eslintConfigPrettier
);
