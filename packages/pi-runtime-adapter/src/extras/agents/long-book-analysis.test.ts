import { describe, expect, it } from "vitest";
import { isExtrasAgentOutputDetails } from "../output";
import {
  resolveTaskAgent,
  runFauxExtras,
  toolNamed,
  toolText
} from "../extras.test-support";

import { longBookAnalysisTask as task } from "./long-book-analysis.test-support";

const tools = (phase: "batch" | "reduce" | "final") =>
  resolveTaskAgent(task(phase)).tools();

describe("long-book analysis agent", () => {
  it("exposes only the phase-appropriate writer and no subagent tool", () => {
    expect(tools("batch").map((item) => item.name)).toEqual([
      "list_analysis_inputs",
      "read_analysis_input",
      "search_analysis_inputs",
      "write_analysis_note"
    ]);
    expect(tools("final").map((item) => item.name)).toEqual([
      "list_analysis_inputs",
      "read_analysis_input",
      "search_analysis_inputs",
      "write_analysis_result"
    ]);
  });

  it("lists and reads chapter inputs without embedding them in the prompt", async () => {
    const batch = tools("batch");
    const agent = resolveTaskAgent(task("batch"));
    expect(agent.userMessage).not.toContain("雨夜收到一封信");
    expect(agent.userMessage).toContain(
      "分析当前章节批次并写入结构化中间笔记。"
    );
    expect(
      toolText(
        await toolNamed(batch, "list_analysis_inputs").execute("list", {})
      )
    ).toContain("id=segment-1");
    expect(
      toolText(
        await toolNamed(batch, "read_analysis_input").execute("read", {
          input_id: "segment-1"
        })
      )
    ).toContain("雨夜收到一封信");
  });

  it("puts the editable preset prompt before the phase boundary", () => {
    const { systemPrompt } = resolveTaskAgent(task("final"));
    expect(systemPrompt.startsWith("依据章节证据提炼剧情结构。")).toBe(true);
    expect(systemPrompt.indexOf("【长篇拆书运行边界】")).toBeGreaterThan(0);
    expect(systemPrompt).toContain("当前是最终结果生成阶段。");
    expect(systemPrompt).not.toContain("DeepWrite 的本地创作协作智能体");
  });

  it("emits unified note and result outputs for the current unit", async () => {
    const note = await toolNamed(
      tools("reduce"),
      "write_analysis_note"
    ).execute("write-note", { text: "归并后的结构化笔记。" });
    expect(isExtrasAgentOutputDetails(note.details)).toBe(true);
    expect(note.details).toMatchObject({
      agentId: "long-book-analysis",
      jobId: "job-1",
      output: { kind: "book-analysis-note", unitId: "unit-reduce" }
    });
    const result = await toolNamed(
      tools("final"),
      "write_analysis_result"
    ).execute("write-result", {
      name: "剧情结构",
      description: "用于提炼写作方法。",
      content: "# 结果"
    });
    expect(result.details).toMatchObject({
      output: {
        kind: "book-analysis-result",
        unitId: "unit-final",
        result: {
          name: "剧情结构",
          description: "用于提炼写作方法。",
          content: "# 结果"
        }
      }
    });
  });

  it("requires name, description and content for the final result", async () => {
    const writer = toolNamed(tools("final"), "write_analysis_result");
    expect(writer.parameters).toMatchObject({
      required: ["name", "description", "content"]
    });
    await expect(
      writer.execute("missing-description", { name: "名称", content: "正文" })
    ).rejects.toThrow();
    await expect(
      writer.execute("blank-description", {
        name: "名称",
        description: "  ",
        content: "正文"
      })
    ).rejects.toThrow();
  });

  it("completes a Faux Runtime batch through the scoped note writer", async () => {
    const events = await runFauxExtras(task("batch"));
    expect(
      events.filter((event) => event.type === "extras_agent.output_updated")
    ).toMatchObject([
      {
        payload: {
          agentId: "long-book-analysis",
          output: { kind: "book-analysis-note", unitId: "unit-batch" }
        }
      }
    ]);
    expect(events.some((event) => event.type === "agent.completed")).toBe(true);
    expect(events.some((event) => event.type === "subagent.activity")).toBe(
      false
    );
  });
});
