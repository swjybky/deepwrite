import { describe, expect, it } from "vitest";
import {
  changedFiles,
  executeChangedSteps,
  planChecks
} from "./commands/check.mjs";
import { assertThemeApplied } from "./commands/ui.mjs";
import { checkRun, proposalCheck, waitForRun } from "./lib/agent.mjs";
import { cropImage, decodePng, diffImages, encodePng } from "./lib/png.mjs";
import { REPO_ROOT } from "./lib/paths.mjs";

function image(width, height, paint = () => [255, 255, 255, 255]) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels.set(paint(x, y), (y * width + x) * 4);
    }
  }
  return { width, height, pixels };
}

describe("png", () => {
  it("round-trips and finds the changed area", () => {
    const before = image(6, 4);
    const after = image(6, 4, (x, y) =>
      x >= 2 && x < 4 && y === 1 ? [0, 0, 0, 255] : [255, 255, 255, 255]
    );
    const decoded = decodePng(encodePng(after));
    expect(decoded.pixels.equals(after.pixels)).toBe(true);
    const diff = diffImages(before, decoded);
    expect(diff).toMatchObject({
      changedPixels: 2,
      changedBox: { x: 2, y: 1, width: 2, height: 1 }
    });
    expect(
      diffImages(
        before,
        image(6, 4, () => [250, 250, 250, 255])
      ).changedPixels
    ).toBe(0);
    expect(diffImages(before, image(5, 4)).sameSize).toBe(false);
  });

  it("crops a CSS-pixel box from a device-pixel capture", () => {
    const shot = image(8, 6, (x, y) => [x, y, 0, 255]);
    const crop = cropImage(shot, { x: 1, y: 1, width: 2, height: 1 }, 2);
    expect([crop.width, crop.height]).toEqual([4, 2]);
    expect([...crop.pixels.subarray(0, 4)]).toEqual([2, 2, 0, 255]);
    expect(
      cropImage(shot, { x: 10, y: 0, width: 2, height: 2 }, 2)
    ).toBeUndefined();
  });
});

describe("check plan", () => {
  it("adds type and boundary checks by changed path", () => {
    const plan = planChecks([
      "apps/desktop/src/main/index.ts",
      "apps/desktop/src/renderer/src/App.vue",
      "docs/x.md",
      "test/a.png"
    ]);
    expect(plan.typecheck).toEqual([
      "apps/desktop/tsconfig.node.json",
      "apps/desktop/tsconfig.web.json"
    ]);
    expect(plan.boundary).toBe(true);
    expect(plan.eslint).toEqual([
      "apps/desktop/src/main/index.ts",
      "apps/desktop/src/renderer/src/App.vue"
    ]);
    expect(plan.prettier).toContain("docs/x.md");
    expect(planChecks(["tools/control/cli.mjs"])).toMatchObject({
      typecheck: [],
      boundary: false
    });
    expect(planChecks(["references/features/new-book.md"]).features).toBe(true);
    expect(planChecks(["docs/x.md"]).features).toBe(false);
    expect(plan.i18n).toBe(true);
    expect(planChecks(["apps/desktop/src/main/index.ts"]).i18n).toBe(false);
    expect(planChecks(["packages/shared/src/index.ts"]).typecheck).toEqual([
      "apps/desktop/tsconfig.node.json",
      "apps/desktop/tsconfig.web.json",
      "packages/shared/tsconfig.json"
    ]);
  });

  it("normalizes --files entries and skips vitest when earlier static steps fail", async () => {
    expect(
      changedFiles({
        files: ` ./a.ts , ${REPO_ROOT}/apps/desktop/src/renderer/src/App.vue, , a.ts `
      })
    ).toEqual(["a.ts", "apps/desktop/src/renderer/src/App.vue"]);

    const invoked = [];
    const failedStatic = await executeChangedSteps(
      [
        ["prettier", "node", ["prettier", "--check"]],
        ["eslint", "node", ["eslint", "."]],
        ["tests", "node", ["vitest", "related"]]
      ],
      async (step) => {
        invoked.push(step);
        return {
          step,
          ok: step !== "prettier",
          command: step,
          durationMs: 5
        };
      }
    );
    expect(invoked).toEqual(["prettier", "eslint"]);
    expect(failedStatic[2]).toMatchObject({
      step: "tests",
      ok: false,
      skipped: true,
      durationMs: 0
    });

    const passedStatic = [];
    const allPassed = await executeChangedSteps(
      [
        ["prettier", "node", ["prettier", "--check"]],
        ["tests", "node", ["vitest", "related"]]
      ],
      async (step) => {
        passedStatic.push(step);
        return { step, ok: true, command: step, durationMs: 5 };
      }
    );
    expect(passedStatic).toEqual(["prettier", "tests"]);
    expect(allPassed.every((entry) => entry.ok)).toBe(true);
  });

  it("validates whether ui theme actually updated document state and persisted settings", () => {
    expect(() =>
      assertThemeApplied(
        { mode: "dark", sizes: { uiFontSize: 18 } },
        {
          applied: "dark",
          settings: { mode: "dark", light: { uiFontSize: 18 } }
        }
      )
    ).not.toThrow();

    expect(() =>
      assertThemeApplied(
        { mode: "system", sizes: { editorFontSize: 16 } },
        {
          applied: "light",
          settings: { mode: "system", light: { editorFontSize: 16 } }
        }
      )
    ).not.toThrow();

    expect(() =>
      assertThemeApplied(
        { mode: "dark", sizes: {} },
        { applied: "light", settings: { mode: "light", light: {} } }
      )
    ).toThrow(expect.objectContaining({ code: "ui.theme_failed" }));

    expect(() =>
      assertThemeApplied(
        { mode: null, sizes: { uiFontSize: 18 } },
        {
          applied: "light",
          settings: { mode: "light", light: { uiFontSize: 14 } }
        }
      )
    ).toThrow(expect.objectContaining({ code: "ui.theme_failed" }));
  });
});

describe("agent runs", () => {
  function fakeSession(statuses, documents = {}) {
    let index = 0;
    return {
      async call(tool, args) {
        if (tool === "get_agent_run") {
          const status = statuses[Math.min(index, statuses.length - 1)];
          index += 1;
          return {
            runId: args.runId,
            status,
            workId: "book-1",
            toolUsage: { byTool: [] }
          };
        }
        if (tool === "get_work") {
          return {
            documents: Object.keys(documents).map((title, i) => ({
              id: `d${i}`,
              title
            }))
          };
        }
        if (tool === "read_document") {
          const title =
            Object.keys(documents)[Number(args.documentId.slice(1))];
          return { content: documents[title], nextOffset: null, revision: "r" };
        }
        throw new Error(tool);
      }
    };
  }

  it("treats a brief waiting_for_user during auto-saves as still running", async () => {
    const session = fakeSession(["running", "waiting_for_user", "completed"]);
    const { run } = await waitForRun(session, "r1", {
      timeoutMs: 1_000,
      intervalMs: 1,
      userGraceMs: 50
    });
    expect(run.status).toBe("completed");
  });

  it("reports waiting_for_user once it outlasts the grace period", async () => {
    const session = fakeSession(["waiting_for_user"]);
    const { run, timedOut } = await waitForRun(session, "r1", {
      timeoutMs: 1_000,
      intervalMs: 1,
      userGraceMs: 5
    });
    expect(run.status).toBe("waiting_for_user");
    expect(timedOut).toBe(false);
  });

  it("checks status, tools and document text with what was seen", async () => {
    const session = fakeSession([], {
      "第一节 · 正文": "正文\nDW-1",
      剧情设计: "修表匠"
    });
    const run = {
      runId: "r1",
      status: "completed",
      workId: "book-1",
      toolUsage: {
        byTool: [
          { name: "read", succeeded: 2, failed: 0 },
          { name: "edit", succeeded: 0, failed: 1 }
        ]
      }
    };
    const checks = await checkRun(session, run, {
      status: "completed",
      tools: ["read", ["edit", "write"]],
      noFailedTools: true,
      documents: { "第一节 · 正文": ["DW-1"], 缺失: ["x"] },
      absent: { 剧情设计: ["修复箱"] }
    });
    expect(checks.map(({ name, ok }) => [name, ok])).toEqual([
      ["status=completed", true],
      ["tool:read", true],
      ["tool:edit|write", false],
      ["noFailedTools", false],
      ["document:第一节 · 正文 含「DW-1」", true],
      ["document:缺失", false],
      ["document:剧情设计 不含「修复箱」", true]
    ]);
  });

  it("fails when an auto-approved proposal ended in conflict", () => {
    const trace = {
      turns: [
        { role: "user" },
        {
          role: "assistant",
          proposals: [
            { title: "正文", status: "accepted" },
            {
              title: "写作指引",
              status: "conflict",
              message: "本地文件已在其他位置更新"
            }
          ]
        }
      ]
    };
    expect(proposalCheck(trace)).toEqual({
      name: "proposals:全部已保存",
      ok: false,
      actual: [
        {
          title: "写作指引",
          status: "conflict",
          message: "本地文件已在其他位置更新"
        }
      ]
    });
  });
});
