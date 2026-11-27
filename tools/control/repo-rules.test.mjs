import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Linter } from "eslint";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deepwriteRules } from "../eslint-rules.mjs";
import {
  deadFiles,
  duplicateFunctions,
  externalSkillDrift,
  layerViolations,
  sensitiveContent
} from "./lib/repo-rules.mjs";

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "deepwrite-rules-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path, content) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

describe("repository rules", () => {
  it("disallows assembling a rejected response with an inline error payload", () => {
    const ruleId = "deepwrite/no-inline-rejection";
    const linter = new Linter();
    const config = {
      plugins: { deepwrite: { rules: deepwriteRules } },
      rules: { [ruleId]: "error" }
    };
    expect(
      linter.verify(
        `export const result = { status: "rejected", error: { code: "test.invalid", message: "sample" } };`,
        config
      )
    ).toMatchObject([{ ruleId }]);
    expect(
      linter.verify(
        `export const status = { status: "rejected", entries: { error: { code: "test.invalid" } } };`,
        config
      )
    ).toEqual([]);
  });

  it("follows build entries and actual imports, including dynamic imports", () => {
    write(
      "apps/desktop/electron.vite.config.ts",
      'const entry = "src/main/index.ts";'
    );
    write("apps/desktop/src/renderer/index.html", "");
    write(
      "apps/desktop/src/main/index.ts",
      '// import "./orphan";\nexport const load = () => import("./loaded.js");'
    );
    write("apps/desktop/src/main/loaded.ts", "export const loaded = true;");
    write("apps/desktop/src/main/orphan.ts", "export const orphan = true;");
    write("apps/desktop/src/main/loaded.test.ts", 'import "./orphan";');
    expect(deadFiles(root)).toEqual(["apps/desktop/src/main/orphan.ts"]);
  });

  it("checks a Vue script's imports across layers without banning bundled documentation", () => {
    write("apps/desktop/src/main/internal.ts", "export const secret = 0;");
    write("apps/desktop/src/extras/skill/SKILL.md", "# Skill");
    write(
      "apps/desktop/src/renderer/App.vue",
      `<template><p>Sample</p></template>
<script setup lang="ts">
import { secret } from "../main/internal";
import text from "../extras/skill/SKILL.md?raw";
</script>`
    );
    expect(layerViolations(root)).toEqual([
      {
        from: "apps/desktop/src/renderer/App.vue",
        to: "apps/desktop/src/main/internal.ts",
        rule: "renderer → main"
      }
    ]);
  });

  it("reports duplicate function bodies with their source line numbers", () => {
    write("apps/desktop/src/main/a.ts", "function a() { return 'example'; }");
    write(
      "apps/desktop/src/main/b.vue",
      "<template></template>\n<script setup lang='ts'>\nfunction b() {\n  // sample\n  return 'example';\n}\n</script>"
    );
    expect(duplicateFunctions(root, 12)).toEqual([
      {
        length: 2,
        copies: [
          { file: "apps/desktop/src/main/a.ts", name: "a", line: 1 },
          { file: "apps/desktop/src/main/b.vue", name: "b", line: 3 }
        ]
      }
    ]);
  });

  it("locates suspicious credentials without printing any of their value", () => {
    write(
      "test/sample/log.json",
      JSON.stringify({ value: ["sk", "A".repeat(28)].join("-") })
    );
    write(
      "tools/example.test.mjs",
      'const key = "sk-test-example-placeholder-key";'
    );
    expect(sensitiveContent(root)).toEqual([
      { file: "test/sample/log.json", kind: "credential", line: 1 }
    ]);
  });

  it("reports missing and obsolete names in the external control skill", () => {
    write(
      "apps/desktop/src/extras/external-control/tool-routes.ts",
      'switch (tool.name) {\n  case "get_app_status":\n    break;\n}'
    );
    write(
      "packages/contracts/src/external-control/protocol.ts",
      'export const ExternalControlErrorCodeSchema = z.enum(["external.invalid_input"]);'
    );
    write(
      "apps/desktop/src/extras/external-control/skill/SKILL.md",
      "## Tools\r\n\r\n- `old_tool_name`\r\n\r\n## When the tools fail\r\n\r\n- `external.invalid_input`\r\n"
    );
    expect(externalSkillDrift(root)).toMatchObject([
      { kind: "tool", name: "get_app_status", issue: "文档缺少" },
      { kind: "tool", name: "old_tool_name", issue: "源码已无此项" }
    ]);
  });
});
