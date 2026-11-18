import { Check } from "typebox/value";
import { validateToolArguments, type JsonObject } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { screenplayWorkspace, scriptAgentProfile } from "./index.test-support";
import {
  buildScriptWorkspaceTools,
  buildShortWorkspaceTools
} from "./short-agent-tools";
import {
  shortProfile,
  shortWorkspace,
  toolByName,
  resultText
} from "./short-agent-tools.test-support";
import {
  documentExecutor,
  fixtureIndex,
  longTools
} from "./long-agent-tools.test-support";
import { resolveWritingEditSummary } from "./writing-edit-summary";
import type { AgentTool } from "@earendil-works/pi-agent-core";

function validate(tool: AgentTool, args: JsonObject) {
  return validateToolArguments(tool, {
    type: "toolCall",
    id: "edit-summary",
    name: tool.name,
    arguments: args
  });
}
function bookTools(type: "short" | "script") {
  const workspace = shortWorkspace("draft");
  return type === "short"
    ? buildShortWorkspaceTools({ workspace, profile: shortProfile() })
    : buildScriptWorkspaceTools({
        workspace: {
          ...screenplayWorkspace(),
          expertDraft: workspace.expertDraft,
          activeSectionId: "section-1"
        },
        profile: scriptAgentProfile()
      });
}

describe.each(["short", "script"] as const)(
  "%s optional edit summary",
  (type) => {
    it.each([undefined, "", "   "])(
      "generates a proposal summary for %j",
      async (summary) => {
        const edit = toolByName(bookTools(type), "edit");
        const result = await edit.execute(
          "write",
          validate(edit, {
            id: "section-2",
            document: "character_state",
            content: "发现新的线索。",
            ...(summary === undefined ? {} : { summary })
          })
        );
        expect(result.details).toMatchObject({
          summary: expect.stringMatching(/^更新《.+状态》的内容$/u),
          text: "发现新的线索。"
        });
        expect(resultText(result)).not.toContain("undefined");
      }
    );
    it("supports replacements, metadata, and clearing without bypassing guards", async () => {
      const tools = bookTools(type);
      const edit = toolByName(tools, "edit");
      const target = { id: "section-2", document: "body" };
      const args = validate(edit, { ...target, content: "" });
      expect(resultText(await edit.execute("unread", args))).toContain(
        "请先用 read 完整读取"
      );
      await toolByName(tools, "read").execute("read", target);
      expect(resultText(await edit.execute("unguarded", args))).toContain(
        "overwrite_mode=replace_all"
      );
      const replaced = await edit.execute(
        "replace",
        validate(edit, {
          ...target,
          replacements: [{ original_text: "暗房", new_text: "房间" }]
        })
      );
      expect(replaced.details).toMatchObject({
        summary: expect.stringMatching(/^局部修改/u)
      });
      const cleared = await edit.execute(
        "clear",
        validate(edit, { ...args, overwrite_mode: "replace_all" })
      );
      expect(cleared.details).toMatchObject({
        text: "",
        summary: expect.stringMatching(/^清空/u)
      });
      const renamed = await edit.execute(
        "rename",
        validate(edit, {
          kind: "draft_section",
          id: target.id,
          meta: { title: "新的章节" }
        })
      );
      expect(renamed.details).toMatchObject({
        summary: expect.stringMatching(/的属性$/u)
      });
    });
  }
);

describe("long optional edit summary", () => {
  it.each([undefined, "", "   ", "  调整叙述节奏  "])(
    "keeps proposals valid for %j",
    async (summary) => {
      const index = fixtureIndex();
      const tools = longTools({
        index,
        executor: documentExecutor(index)
      });
      const edit = toolByName(tools, "edit");
      const result = await edit.execute(
        "write",
        validate(edit, {
          id: "chapter_one",
          document: "body",
          content: "新的正文。",
          ...(summary === undefined ? {} : { summary })
        })
      );
      expect(result.details).toMatchObject({
        summary: summary?.trim() || expect.stringMatching(/^更新《.+》的内容$/u)
      });
    }
  );
  it("handles record metadata and preserves overwrite protection", async () => {
    const index = fixtureIndex();
    const tools = longTools({
      index,
      executor: documentExecutor(index)
    });
    const edit = toolByName(tools, "edit");
    const target = { id: "volume_one" };
    index.plot.volumes[0]!.summary = "原有概要。";
    await toolByName(tools, "read").execute("read", target);
    expect(
      resultText(
        await edit.execute(
          "unguarded",
          validate(edit, { ...target, content: "" })
        )
      )
    ).toContain("overwrite_mode=replace_all");
    const cleared = await edit.execute(
      "clear",
      validate(edit, { ...target, content: "", overwrite_mode: "replace_all" })
    );
    expect(cleared.details).toMatchObject({
      summary: expect.stringMatching(/^清空/u)
    });
    const renamed = await edit.execute(
      "rename",
      validate(edit, { ...target, meta: { title: "新卷名" } })
    );
    expect(renamed.details).toMatchObject({
      summary: expect.stringMatching(/的属性$/u)
    });
  });
  it("rejects invalid types and oversized summaries", () => {
    const index = fixtureIndex();
    const edit = toolByName(
      longTools({ executor: documentExecutor(index) }),
      "edit"
    );
    for (const summary of [null, 123, "x".repeat(1001)]) {
      expect(
        Check(edit.parameters, { id: "book_line", content: "正文", summary })
      ).toBe(false);
    }
  });
});

it("preserves supplied summaries and bounds generated summaries", () => {
  expect(
    resolveWritingEditSummary("  修正时间线  ", "目标", { content: "内容" })
  ).toBe("修正时间线");
  expect(
    resolveWritingEditSummary(undefined, "长标题".repeat(1000), {
      content: "内容",
      meta: {}
    })
  ).toMatch(/内容及属性$/u);
  expect(
    resolveWritingEditSummary(undefined, "长标题".repeat(1000), { content: "" })
      .length
  ).toBeLessThan(1000);
});
