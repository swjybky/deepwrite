import {
  DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES,
  type ShortWorkspaceSnapshot
} from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import {
  buildScriptWorkspaceTools,
  buildShortWorkspaceTools
} from "./short-agent-tools";
import {
  expertSection,
  resultText,
  shortProfile,
  shortWorkspace,
  toolByName
} from "./short-agent-tools.test-support";

const body = "# 甲 A，\n\t乙\u3000🙂";
const blank = " \r\n\t\u00a0\u3000\ufeff";
const targets = [
  { kind: "character_overview", id: "character_design" },
  { kind: "character", id: "character-lin" },
  { kind: "plot_stage", id: "plot_design" },
  { kind: "draft_section", id: "section-1", document: "body" },
  { kind: "draft_section", id: "section-1", document: "character_state" }
];

function snapshot(content = body) {
  const workspace = shortWorkspace("draft", { characterList: true });
  for (const stage of workspace.stages) stage.content = content;
  if (workspace.characterStructure?.format === "list") {
    for (const item of workspace.characterStructure.items) {
      item.content = content;
    }
  }
  workspace.expertDraft.sections = [
    expertSection("section-1", "第一节", content, content),
    expertSection("section-2", "第二节", "乙 。", "")
  ];
  return workspace;
}

function writingTools(type: "short" | "script", workspace = snapshot()) {
  const input = { workspace };
  return type === "short"
    ? buildShortWorkspaceTools({ ...input, profile: shortProfile() })
    : buildScriptWorkspaceTools({
        ...input,
        workspace: { ...workspace, activeAgentId: "script" },
        profile: DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0]!
      });
}

describe.each(["short", "script"] as const)("%s read counts", (type) => {
  it.each(targets)("counts the body of $kind $document", async (target) => {
    const read = toolByName(writingTools(type), "read");
    expect(read.description).toContain("去除空白，包含标点和 Markdown 符号");
    const text = resultText(await read.execute("read", target));
    expect(text).toContain("当前字数：7 字");
    expect(text).toContain(body);
  });

  it.each(targets)(
    "counts whitespace-only $kind $document as zero",
    async (target) => {
      const read = toolByName(writingTools(type, snapshot(blank)), "read");
      expect(resultText(await read.execute("read", target))).toContain(
        "当前字数：0 字"
      );
    }
  );

  it("returns per-section and total counts without reading bodies into the directory", async () => {
    const read = toolByName(writingTools(type), "read");
    const text = resultText(
      await read.execute("directory", { kind: "draft", id: "draft" })
    );
    expect(text).toContain("正文总字数：9 字");
    expect(text).toContain("状态总字数：7 字");
    expect(text).toContain("字数要求=1000 字；正文字数=7；状态字数=7");
    expect(text).toContain("正文字数=2；状态字数=0");
    expect(text).not.toContain(body);
  });

  it.each([
    { document: undefined, total: 9, second: 2 },
    { document: "body", total: 9, second: 2 },
    { document: "character_state", total: 7, second: 0 }
  ])(
    "counts all sections for $document",
    async ({ document, total, second }) => {
      const read = toolByName(writingTools(type), "read");
      const text = resultText(
        await read.execute("all", {
          kind: "draft",
          id: "draft",
          section_scope: "all_sections",
          ...(document ? { document } : {})
        })
      );
      expect(text).toContain(`total_characters: ${total}`);
      expect(text).toContain(`合计字数：${total} 字`);
      expect(text).toContain("当前字数：7 字");
      expect(text).toContain(`当前字数：${second} 字`);
      expect(text).toContain(body);
    }
  );

  it.each([targets[1]!, targets[2]!])(
    "does not present truncated $kind as a full count or allow editing it",
    async (target) => {
      const workspace = snapshot();
      if (workspace.characterStructure?.format === "list") {
        workspace.characterStructure.items[0]!.truncated = true;
      }
      workspace.stages.find(
        (stage) => stage.stageId === "plot_design"
      )!.truncated = true;
      const tools = writingTools(type, workspace);
      const text = resultText(
        await toolByName(tools, "read").execute("truncated", target)
      );
      expect(text).toContain("已返回内容字数：7 字（快照已截断，非全文字数）");
      expect(text).not.toContain("当前字数：");
      await expect(
        toolByName(tools, "edit").execute("edit", {
          ...target,
          content: "新内容",
          summary: "修改"
        })
      ).rejects.toThrow("目标快照已截断");
    }
  );

  it("counts the latest same-run proposal rather than the initial snapshot", async () => {
    const tools = writingTools(type);
    const target = targets[2]!;
    const read = toolByName(tools, "read");
    await read.execute("before", target);
    await toolByName(tools, "edit").execute("edit", {
      ...target,
      content: "新 剧情。",
      overwrite_mode: "replace_all",
      summary: "改写"
    });
    const text = resultText(await read.execute("after", target));
    expect(text).toContain("当前字数：4 字");
    expect(text).toContain("新 剧情。");
    expect(text).not.toContain(body);
  });

  it("counts an empty manuscript as zero", async () => {
    const workspace: ShortWorkspaceSnapshot = snapshot();
    workspace.expertDraft.sections = [];
    const read = toolByName(writingTools(type, workspace), "read");
    const text = resultText(
      await read.execute("empty", {
        kind: "draft",
        id: "draft",
        section_scope: "all_sections"
      })
    );
    expect(text).toContain("合计字数：0 字");
  });
});
