import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  applyLearningImitationWrite,
  cloneEmptyLearningImitationResult,
  type LearningImitationDocument,
  type LearningImitationRuntimeContext,
  type LearningImitationStageId
} from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import {
  buildLearningImitationTools,
  isLearningImitationToolDetails,
  type LearningImitationToolDetails
} from "./learning-imitation-tools";

function learningDocument(
  overrides: Partial<LearningImitationDocument> = {}
): LearningImitationDocument {
  const text = overrides.text ?? "雾港的汽笛迟到了七分钟。";
  return {
    id: "novel-1",
    name: "雾港回声.txt",
    extension: "txt",
    mediaType: "text/plain",
    size: text.length,
    text,
    charCount: text.length,
    ...overrides
  };
}

function runtimeContext(
  stageId: LearningImitationStageId = "material_split",
  documents: LearningImitationDocument[] = [learningDocument()]
): LearningImitationRuntimeContext {
  return {
    stageId,
    documents,
    result: cloneEmptyLearningImitationResult()
  };
}

function toolByName(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

function resultText(result: AgentToolResult<unknown>): string {
  return result.content
    .filter(
      (item): item is Extract<(typeof result.content)[number], { type: "text" }> =>
        item.type === "text"
    )
    .map((item) => item.text)
    .join("\n");
}

describe("learning imitation tools", () => {
  it("builds the four source-compatible tools without forcing tool-level concurrency", () => {
    const tools = buildLearningImitationTools(runtimeContext());

    expect(tools.map((tool) => tool.name)).toEqual([
      "list_learning_documents",
      "read_learning_document",
      "search_learning_documents",
      "write_learning_result"
    ]);
    expect(tools.every((tool) => tool.executionMode === undefined)).toBe(true);

    const writeSchema = toolByName(tools, "write_learning_result").parameters as {
      properties?: { mode?: Record<string, unknown> };
    };
    expect(writeSchema.properties?.mode).toMatchObject({
      enum: ["replace", "append"]
    });
    expect(writeSchema.properties?.mode).not.toHaveProperty("anyOf");
  });

  it("lists document metadata, chunk counts, and truncation status", async () => {
    const text = `${"甲".repeat(12_000)}第二块`;
    const document = learningDocument({
      text,
      charCount: 18_000,
      truncated: true,
      originalLength: 18_000
    });
    const list = toolByName(
      buildLearningImitationTools(runtimeContext("material_split", [document])),
      "list_learning_documents"
    );

    const result = await list.execute("list-1", {});

    expect(resultText(result)).toContain("id=novel-1");
    expect(resultText(result)).toContain("文件：雾港回声.txt");
    expect(resultText(result)).toContain("字数：18000");
    expect(resultText(result)).toContain("分块：2");
    expect(resultText(result)).toContain("正文已截断");
    expect(result.details).toEqual({ kind: "none" });
  });

  it("reads long documents in 12000-character, one-based chunks", async () => {
    const text = `${"甲".repeat(12_000)}SECOND-CHUNK`;
    const read = toolByName(
      buildLearningImitationTools(
        runtimeContext("material_split", [learningDocument({ text })])
      ),
      "read_learning_document"
    );

    const first = await read.execute("read-1", { document_id: "novel-1" });
    const second = await read.execute("read-2", {
      document_id: "novel-1",
      chunk_index: 2
    });
    const missingChunk = await read.execute("read-3", {
      document_id: "novel-1",
      chunk_index: 3
    });
    const missingDocument = await read.execute("read-4", {
      document_id: "missing"
    });

    expect(resultText(first)).toContain("共 2 块，当前第 1 块");
    expect(resultText(first)).not.toContain("SECOND-CHUNK");
    expect(resultText(second)).toContain("共 2 块，当前第 2 块");
    expect(resultText(second)).toContain("SECOND-CHUNK");
    expect(resultText(missingChunk)).toContain("没有第 3 个分块");
    expect(resultText(missingDocument)).toContain("未找到文档：missing");
  });

  it("searches case-insensitively with bounded contextual results", async () => {
    const documents = [
      learningDocument({
        id: "novel-1",
        name: "第一部.txt",
        text: `${"前".repeat(130)}FoG-HARBOR${"后".repeat(170)}`,
        charCount: 310
      }),
      learningDocument({
        id: "novel-2",
        name: "第二部.txt",
        text: "第二个 fog-harbor 命中。",
        charCount: 20
      })
    ];
    const search = toolByName(
      buildLearningImitationTools(runtimeContext("material_split", documents)),
      "search_learning_documents"
    );

    const result = await search.execute("search-1", {
      query: "fog-harbor",
      max_results: 1
    });
    const empty = await search.execute("search-2", { query: "   " });

    expect(resultText(result)).toContain("【第一部.txt】");
    expect(resultText(result)).toContain("FoG-HARBOR");
    expect(resultText(result)).not.toContain("【第二部.txt】");
    expect(resultText(result)).toMatch(/^【第一部\.txt】\n\.\.\./);
    expect(resultText(result)).toMatch(/\.\.\.$/);
    expect(resultText(empty)).toBe("请提供搜索关键词");
  });

  it("returns a stage-scoped preview update that the contracts layer can apply", async () => {
    const write = toolByName(
      buildLearningImitationTools(runtimeContext("plot_learning")),
      "write_learning_result"
    );

    const result = await write.execute("write-1", {
      mode: "append",
      plot_design_skill: "先制造时间差，再揭示证词矛盾。"
    });

    expect(result.details).toEqual({
      kind: "learning-imitation-result-update",
      stageId: "plot_learning",
      update: {
        mode: "append",
        plot_design_skill: "先制造时间差，再揭示证词矛盾。"
      }
    });
    expect(isLearningImitationToolDetails(result.details)).toBe(true);

    const next = applyLearningImitationWrite(
      cloneEmptyLearningImitationResult(),
      "plot_learning",
      (result.details as Extract<
        LearningImitationToolDetails,
        { kind: "learning-imitation-result-update" }
      >).update
    );
    expect(next.plot_learning.plotDesignSkill).toBe(
      "先制造时间差，再揭示证词矛盾。"
    );
    expect(resultText(result)).toContain("等待用户确认落盘");
  });

  it("defaults writes to replace and rejects empty result payloads", async () => {
    const write = toolByName(
      buildLearningImitationTools(runtimeContext("style_learning")),
      "write_learning_result"
    );

    const result = await write.execute("write-1", {
      style_skill_title: "冷峻悬疑文风",
      style_skill_body: "用短句压缩叙事时间。"
    });

    expect(result.details).toMatchObject({
      kind: "learning-imitation-result-update",
      stageId: "style_learning",
        update: {
          mode: "replace",
          style_skill_title: "冷峻悬疑文风",
          style_skill_body: "用短句压缩叙事时间。"
      }
    });
    await expect(write.execute("write-2", { mode: "append" })).rejects.toThrow(
      "at least one non-empty field"
    );
    await expect(
      write.execute("write-3", { gimmick: "不属于文风阶段的字段" })
    ).rejects.toThrow("文风学习");
  });

  it("recognizes only well-formed learning-imitation tool details", () => {
    expect(isLearningImitationToolDetails({ kind: "none" })).toBe(false);
    expect(
      isLearningImitationToolDetails({
        kind: "learning-imitation-result-update",
        stageId: "material_split",
        update: { gimmick: "失踪名单", mode: "replace" }
      })
    ).toBe(true);
    expect(
      isLearningImitationToolDetails({
        kind: "learning-imitation-result-update",
        stageId: "unknown",
        update: { gimmick: "失踪名单" }
      })
    ).toBe(false);
    expect(
      isLearningImitationToolDetails({
        kind: "learning-imitation-result-update",
        stageId: "material_split",
        update: { mode: "append" }
      })
    ).toBe(false);
    expect(isLearningImitationToolDetails({ kind: "other" })).toBe(false);
  });

  it("rejects append writes that would overflow the accumulated preview", async () => {
    const context = runtimeContext("plot_learning");
    context.result.plot_learning.plotDesignSkill = "甲".repeat(200_000);
    const write = toolByName(
      buildLearningImitationTools(context),
      "write_learning_result"
    );

    await expect(
      write.execute("write-overflow", {
        mode: "append",
        plot_design_skill: "继续追加"
      })
    ).rejects.toThrow("超过长度限制");
  });
});
