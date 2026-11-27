import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  areaOf,
  eslintFindings,
  gitIgnoredGlobs,
  parsePrettierOutput,
  parseTscOutput,
  vitestSummary
} from "./lib/check-all.mjs";
import { REPO_ROOT } from "./lib/paths.mjs";

describe("check all", () => {
  it("sorts paths into frontend, backend and tooling", () => {
    expect(areaOf("apps/desktop/src/renderer/src/App.vue")).toBe("frontend");
    expect(areaOf("apps/desktop/src/main/index.ts")).toBe("backend");
    expect(areaOf("packages/contracts/src/index.ts")).toBe("backend");
    expect(areaOf(join(REPO_ROOT, "tools/control/cli.mjs"))).toBe("tooling");
    expect(areaOf("eslint.config.js")).toBe("tooling");
  });

  it("turns git-ignored entries into escaped globs", () => {
    expect(gitIgnoredGlobs(["website/", ".env", "a/[id].js", ""])).toEqual([
      "website/**",
      ".env",
      "a/\\[id\\].js"
    ]);
  });

  it("parses tsc, prettier and eslint output into findings", () => {
    expect(
      parseTscOutput(
        "apps/desktop/src/main/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.\nFound 1 error."
      )
    ).toEqual([
      {
        file: "apps/desktop/src/main/a.ts",
        line: 3,
        column: 5,
        code: "TS2322",
        message: "Type 'string' is not assignable to type 'number'."
      }
    ]);
    expect(
      parsePrettierOutput(
        "Checking formatting...\n[warn] tools/a.mjs\n[warn] Code style issues found in the above file. Run Prettier with --write to fix."
      )
    ).toEqual([{ file: "tools/a.mjs", message: "格式不符合 Prettier" }]);
    expect(
      eslintFindings([
        {
          filePath: join(REPO_ROOT, "apps/desktop/src/renderer/src/a.ts"),
          messages: [
            {
              ruleId: "no-undef",
              severity: 2,
              message: "'x' is not defined.",
              line: 1,
              column: 2
            }
          ]
        },
        { filePath: join(REPO_ROOT, "tools/b.mjs"), messages: [] }
      ])
    ).toEqual([
      {
        file: "apps/desktop/src/renderer/src/a.ts",
        line: 1,
        column: 2,
        rule: "no-undef",
        severity: "error",
        message: "'x' is not defined."
      }
    ]);
  });

  it("counts tests per area and reports failed assertions and broken files", () => {
    const summary = vitestSummary({
      testResults: [
        {
          name: join(REPO_ROOT, "apps/desktop/src/renderer/src/a.test.ts"),
          status: "failed",
          assertionResults: [
            { fullName: "a works", status: "passed" },
            {
              fullName: "a fails",
              status: "failed",
              failureMessages: ["AssertionError: expected 1 to be 2\n    at x"]
            }
          ]
        },
        {
          name: join(REPO_ROOT, "apps/desktop/src/main/b.test.ts"),
          status: "failed",
          message: "Failed to load url ./missing",
          assertionResults: []
        },
        {
          name: join(REPO_ROOT, "tools/c.test.mjs"),
          status: "passed",
          assertionResults: [{ fullName: "c", status: "passed" }]
        }
      ]
    });
    expect(summary.frontend).toMatchObject({ files: 1, tests: 2, failed: 1 });
    expect(summary.frontend.findings[0]).toMatchObject({
      file: "apps/desktop/src/renderer/src/a.test.ts",
      test: "a fails"
    });
    expect(summary.backend).toMatchObject({ files: 1, tests: 0, failed: 1 });
    expect(summary.backend.findings[0].message).toContain("missing");
    expect(summary.tooling).toMatchObject({
      files: 1,
      failed: 0,
      findings: []
    });
  });
});
