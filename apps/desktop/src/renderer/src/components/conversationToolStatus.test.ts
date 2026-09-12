import { describe, expect, it } from "vitest";
import type { AgentToolTrace } from "../types/conversation";
import {
  isWriteTool,
  toolDetail,
  toolKind,
  toolLabel,
  workspaceToolLabel,
  writeToolAction
} from "./conversationToolPresentation";

function editTrace(overrides: Partial<AgentToolTrace> = {}): AgentToolTrace {
  return {
    id: "edit-rewrite",
    name: "edit",
    args: { id: "section-1", document: "body" },
    status: "completed",
    requestedAt: "2026-09-12T00:00:00.000Z",
    ...overrides
  };
}

describe("workspace tool presentation", () => {
  it.each([
    ["create_draft_sections", "创建章节文件", "write"],
    ["write_draft_section", "写入正文章节", "write"],
    ["replace_draft_section_text", "替换正文章节文本", "modify"],
    ["rename_draft_section", "修改章节名称", "write"],
    ["delete_draft_section", "删除章节", "write"],
    ["create_worldbuilding_file", "创建世界观文件", "modify"],
    ["write_worldbuilding_file", "写入世界观文件", "write"],
    ["edit_worldbuilding_file", "编辑世界观文件", "modify"],
    ["create_worldbuilding_items", "创建世界观文件", "modify"],
    ["create", "新建对象", "modify"],
    ["edit", "写入或修改", "modify"]
  ])("labels and classifies %s", (name, label, action) => {
    const tool = editTrace({ name });
    expect(workspaceToolLabel(name)).toBe(label);
    expect(isWriteTool(tool)).toBe(true);
    expect(toolKind(name)).toBe("write");
    expect(writeToolAction(tool)).toBe(action);
  });

  it("keeps chapter reads outside write tool presentation", () => {
    const tool = editTrace({ name: "read_draft_sections" });
    expect(workspaceToolLabel(tool.name)).toBe("读取正文章节");
    expect(isWriteTool(tool)).toBe(false);
    expect(toolKind(tool.name)).toBe("read");
  });

  it.each(["create", "edit"])(
    "shows chapter review states for %s targeting a chapter body",
    (name) => {
      const tool = editTrace({
        name,
        args: { id: "chapter_one", document: "body" }
      });
      expect(toolLabel(tool)).toBe("当前章正文待审核");
      expect(toolLabel({ ...tool, status: "running" })).toBe(
        "正在生成正文审核"
      );
      expect(toolLabel({ ...tool, status: "error" })).toBe("正文审核生成失败");
    }
  );

  it("shows creation and pending review feedback", () => {
    expect(
      toolLabel(editTrace({ name: "create_draft_sections", status: "running" }))
    ).toBe("正在创建文件");
    expect(toolDetail(editTrace({ status: "preparing", args: {} }))).toBe(
      "待审阅文本生成中"
    );
  });
});

describe("edit tool result labels", () => {
  it.each(["未修改", "未写入", "未覆盖", "未替换"])(
    "shows %s when a completed tool did not produce a change",
    (outcome) => {
      expect(
        toolLabel(editTrace({ resultSummary: `${outcome}：请修正参数。` }))
      ).toBe(outcome);
    }
  );

  it("does not show a chapter approval label for a blocked rewrite", () => {
    expect(
      toolLabel(
        editTrace({
          args: { id: "chapter_one", document: "body" },
          resultSummary: "未修改：目标已有正文。"
        })
      )
    ).toBe("未修改");
  });

  it("preserves generated, running, and error states", () => {
    expect(toolLabel(editTrace({ resultSummary: "已形成修改提案。" }))).toBe(
      "修改结果已生成"
    );
    expect(toolLabel(editTrace({ status: "running" }))).toBe("正在修改");
    expect(toolLabel(editTrace({ status: "error" }))).toBe("修改失败");
  });
});
