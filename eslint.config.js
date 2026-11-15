import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";

const sourceFiles = ["**/*.{js,mjs,cjs,ts,vue}"];
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
      reportUnusedDisableDirectives: "error",
      reportUnusedInlineConfigs: "error"
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
  eslintConfigPrettier
);
