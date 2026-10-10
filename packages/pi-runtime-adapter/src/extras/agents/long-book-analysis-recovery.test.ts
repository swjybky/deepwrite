import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  fauxAssistantMessage,
  fauxThinking,
  fauxToolCall,
  type FauxResponseStep
} from "@earendil-works/pi-ai";
import { AgentRunKernel } from "../../kernel/run-kernel";
import { ConversationAgentCache } from "../../kernel/run-agent";
import { AgentUserInputBroker } from "../../user-input-broker";
import type { AgentRuntimeEvent } from "../../runtime-types";
import { planExtrasRun } from "../run-plan";
import { longBookAnalysisTask as task } from "./long-book-analysis.test-support";

function submit(
  phase: "batch" | "reduce" | "final",
  stopReason: "toolUse" | "length" = "toolUse"
) {
  return fauxAssistantMessage(
    phase === "final"
      ? fauxToolCall("write_analysis_result", {
          name: "剧情结构",
          description: "用于检查剧情推进。",
          content: "# 结果\n第 1—2 章通过延迟信息与人物选择推动剧情。"
        })
      : fauxToolCall("write_analysis_note", {
          text: "第 1—2 章通过延迟信息与人物选择推动剧情。"
        }),
    { stopReason }
  );
}

async function runRecovery(
  phase: "batch" | "reduce" | "final",
  responses: FauxResponseStep[],
  onEvent?: (event: AgentRuntimeEvent, controller: AbortController) => void
) {
  const controller = new AbortController();
  const plan = planExtrasRun({
    runId: "run-recovery",
    spec: { sessionId: "session-recovery", task: task(phase) },
    signal: controller.signal
  });
  const build = plan.build;
  let messages: () => readonly AgentMessage[] = () => [];
  plan.build = (context) => {
    messages = context.getParentMessages;
    return build(context);
  };
  plan.fauxResponses = () => responses;
  const kernel = new AgentRunKernel({
    agents: new ConversationAgentCache(new Map(), {}),
    userInputBroker: new AgentUserInputBroker(),
    idleTimeoutMs: 0,
    tokensPerSecond: 0,
    evaluationMode: false,
    retryPolicy: { delaysMs: [] },
    describe: () => ({
      provider: "fixture",
      model: "analysis-recovery-fixture",
      mode: "local-faux"
    })
  });
  const events: AgentRuntimeEvent[] = [];
  for await (const event of kernel.run(plan)) {
    events.push(event);
    onEvent?.(event, controller);
  }
  return { events, messages: messages() };
}

describe("long-book analysis result recovery in the shared kernel", () => {
  it.each(["batch", "reduce", "final"] as const)(
    "nudges a prose-only %s without rereading its inputs or accepting the prose as output",
    async (phase) => {
      const prose = "已有分析：延迟信息制造悬念，人物选择带来下一轮压力。";
      const writer =
        phase === "final" ? "write_analysis_result" : "write_analysis_note";
      const { events, messages } = await runRecovery(phase, [
        fauxAssistantMessage(fauxToolCall("list_analysis_inputs", {}), {
          stopReason: "toolUse"
        }),
        fauxAssistantMessage(
          fauxToolCall("read_analysis_input", {
            input_id: phase === "batch" ? "segment-1" : "note-1"
          }),
          { stopReason: "toolUse" }
        ),
        fauxAssistantMessage(prose),
        submit(phase),
        fauxAssistantMessage("")
      ]);
      expect(
        events.filter((event) => event.type === "extras_agent.output_updated")
      ).toMatchObject([
        {
          payload: {
            output: {
              kind:
                phase === "final"
                  ? "book-analysis-result"
                  : "book-analysis-note",
              unitId: `unit-${phase}`
            }
          }
        }
      ]);
      expect(events.filter((event) => event.type === "agent.error")).toEqual(
        []
      );
      expect(
        events.filter((event) => event.type === "agent.completed")
      ).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({ content: "" })
        })
      ]);
      expect(
        events.filter(
          (event) =>
            event.type === "agent.tool_requested" &&
            event.payload.toolName === "read_analysis_input"
        )
      ).toHaveLength(1);
      expect(JSON.stringify(messages)).toContain(prose);
      expect(
        messages.filter((message) => message.role === "user")
      ).toHaveLength(2);
      expect(
        JSON.stringify(
          messages.filter((message) => message.role === "user").at(-1)
        )
      ).toContain(`直接调用 ${writer}`);
    }
  );

  it.each(["batch", "reduce", "final"] as const)(
    "stops a %s after two unsuccessful nudges without emitting completion",
    async (phase) => {
      const { events } = await runRecovery(phase, [
        fauxAssistantMessage("第一次普通回复。"),
        fauxAssistantMessage("第二次普通回复。"),
        fauxAssistantMessage("第三次普通回复。"),
        submit(phase)
      ]);
      expect(
        events.filter((event) => event.type === "agent.turn_started")
      ).toHaveLength(3);
      expect(
        events.filter((event) => event.type === "extras_agent.output_updated")
      ).toEqual([]);
      expect(
        events.filter((event) => event.type === "agent.completed")
      ).toEqual([]);
      expect(
        events.filter((event) => event.type === "agent.error")
      ).toMatchObject([
        {
          payload: {
            code: "pi_agent.output_missing",
            message: expect.stringContaining("已自动提示补交 2 次")
          }
        }
      ]);
    }
  );

  it.each(["empty", "whitespace", "thinking"])(
    "nudges a %s reply to submit a valid note",
    async (kind) => {
      const { events } = await runRecovery("batch", [
        fauxAssistantMessage(
          kind === "thinking"
            ? fauxThinking("分析完成。")
            : kind === "whitespace"
              ? " \n "
              : ""
        ),
        submit("batch"),
        fauxAssistantMessage("已提交。")
      ]);
      expect(
        events.filter((event) => event.type === "extras_agent.output_updated")
      ).toHaveLength(1);
      expect(
        events.filter((event) => event.type === "agent.completed")
      ).toHaveLength(1);
      expect(events.filter((event) => event.type === "agent.error")).toEqual(
        []
      );
    }
  );

  it.each(["thinking", "prose", "tool"])(
    "asks for a shorter submission after truncated %s and never accepts the cut-off output",
    async (kind) => {
      const cut =
        kind === "tool"
          ? submit("batch", "length")
          : fauxAssistantMessage(
              kind === "thinking"
                ? fauxThinking("展开全部章节的分析……")
                : "未完成的分析……",
              { stopReason: "length" }
            );
      const { events, messages } = await runRecovery("batch", [
        cut,
        submit("batch"),
        fauxAssistantMessage("已提交。")
      ]);
      expect(
        events.filter((event) => event.type === "extras_agent.output_updated")
      ).toHaveLength(1);
      expect(
        events.filter((event) => event.type === "agent.completed")
      ).toHaveLength(1);
      expect(events.filter((event) => event.type === "agent.error")).toEqual(
        []
      );
      expect(
        JSON.stringify(messages.filter((message) => message.role === "user"))
      ).toContain("精简思考与提交内容");
    }
  );

  it("reports repeated truncation instead of a missing-tool error", async () => {
    const { events } = await runRecovery("final", [
      submit("final", "length"),
      submit("final", "length"),
      submit("final", "length"),
      submit("final")
    ]);
    expect(
      events.filter((event) => event.type === "agent.turn_started")
    ).toHaveLength(3);
    expect(
      events.filter((event) => event.type === "extras_agent.output_updated")
    ).toEqual([]);
    expect(events.filter((event) => event.type === "agent.completed")).toEqual(
      []
    );
    expect(
      events.filter((event) => event.type === "agent.error")
    ).toMatchObject([
      {
        payload: {
          code: "pi_agent.output_truncated",
          message: expect.stringContaining("单次输出上限被截断")
        }
      }
    ]);
  });

  it("requires a successful writer result after an invalid submission", async () => {
    const { events } = await runRecovery("batch", [
      fauxAssistantMessage(
        fauxToolCall("write_analysis_note", { text: "  " }),
        {
          stopReason: "toolUse"
        }
      ),
      fauxAssistantMessage("已经完成。"),
      submit("batch"),
      fauxAssistantMessage("已提交。")
    ]);
    expect(
      events.filter((event) => event.type === "agent.tool_completed")
    ).toMatchObject([
      { payload: { isError: true } },
      { payload: { isError: false } }
    ]);
    expect(
      events.filter((event) => event.type === "extras_agent.output_updated")
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "agent.completed")
    ).toHaveLength(1);
  });

  it("keeps a valid result when only the closing acknowledgement is truncated", async () => {
    const { events, messages } = await runRecovery("final", [
      submit("final"),
      fauxAssistantMessage("已提交结果……", { stopReason: "length" })
    ]);
    expect(
      events.filter((event) => event.type === "extras_agent.output_updated")
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "agent.completed")
    ).toHaveLength(1);
    expect(events.filter((event) => event.type === "agent.error")).toEqual([]);
    expect(messages.filter((message) => message.role === "user")).toHaveLength(
      1
    );
  });

  it("allows stopping a recovery before its next submission", async () => {
    let turns = 0;
    const { events } = await runRecovery(
      "batch",
      [
        fauxAssistantMessage("普通分析。"),
        submit("batch"),
        fauxAssistantMessage("已提交。")
      ],
      (event, controller) => {
        if (event.type === "agent.turn_started" && ++turns === 2)
          controller.abort();
      }
    );
    expect(
      events.filter((event) => event.type === "extras_agent.output_updated")
    ).toEqual([]);
    expect(events.filter((event) => event.type === "agent.completed")).toEqual(
      []
    );
    expect(
      events.filter((event) => event.type === "agent.error")
    ).toMatchObject([{ payload: { code: "pi_agent.aborted" } }]);
  });
});
