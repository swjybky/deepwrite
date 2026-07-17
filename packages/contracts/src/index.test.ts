import { describe, expect, it } from "vitest";
import {
  AgentMessageCompletedEventEnvelopeSchema,
  AgentMessageDeltaEventEnvelopeSchema,
  ActiveResourceSnapshotSchema,
  CommandEnvelopeSchema,
  PROTOCOL_VERSION,
  SessionPromptAcceptedPayloadSchema,
  SystemEventEnvelopeSchema,
  SystemHealthPayloadSchema,
  UtilityInboundMessageSchema,
  UtilityOutboundMessageSchema,
  WorkspaceRuntimeContextSchema,
  createEnvelope
} from "./index";

const runtime = {
  provider: "deepwrite",
  model: "deepwrite-writing-faux",
  mode: "local-faux" as const
};

describe("DeepWrite desktop contracts", () => {
  it("creates a versioned command envelope with a correlation id", () => {
    const envelope = createEnvelope("system.health", {}, { id: "cmd_health" });

    expect(CommandEnvelopeSchema.parse(envelope)).toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
      id: "cmd_health",
      type: "system.health",
      context: { correlationId: "cmd_health" }
    });
  });

  it("rejects unknown protocol versions", () => {
    const envelope = createEnvelope("system.health", {}, { id: "cmd_health" });

    expect(() => CommandEnvelopeSchema.parse({ ...envelope, protocolVersion: 2 })).toThrow();
  });

  it("accepts three healthy utility workers", () => {
    const workers = ["core", "agent", "tool"].map((name, index) => ({
      name,
      status: "ok",
      pid: 1000 + index,
      details: {}
    }));

    expect(
      SystemHealthPayloadSchema.parse({
        status: "ok",
        checkedAt: new Date().toISOString(),
        workers
      }).workers
    ).toHaveLength(3);
  });

  it("accepts a prompt with a matching session and live editor snapshot", () => {
    const envelope = createEnvelope(
      "session.prompt",
      {
        sessionId: "session_1",
        message: "续写这一段",
        thinkingLevel: "medium" as const,
        workspaceContext: {
          activeResource: {
            id: "chapter_1",
            domain: "creation" as const,
            title: "第一章",
            path: ["长篇小说", "第一章"],
            format: "markdown",
            source: "live-editor" as const,
            content: "窗外正在下雨。"
          }
        }
      },
      {
        id: "cmd_prompt",
        context: { sessionId: "session_1", resourceId: "chapter_1" }
      }
    );

    expect(CommandEnvelopeSchema.parse(envelope).type).toBe("session.prompt");
  });

  it("rejects blank prompts and mismatched session context", () => {
    const blank = createEnvelope(
      "session.prompt",
      { sessionId: "session_1", message: "   " },
      { id: "cmd_blank", context: { sessionId: "session_1" } }
    );
    const mismatch = createEnvelope(
      "session.prompt",
      { sessionId: "session_1", message: "继续" },
      { id: "cmd_mismatch", context: { sessionId: "session_2" } }
    );

    expect(() => CommandEnvelopeSchema.parse(blank)).toThrow();
    expect(() => CommandEnvelopeSchema.parse(mismatch)).toThrow();
  });

  it("validates quick acceptance independently from streamed events", () => {
    expect(
      SessionPromptAcceptedPayloadSchema.parse({
        sessionId: "session_1",
        runId: "run_1",
        acceptedAt: new Date().toISOString(),
        runtime
      })
    ).toMatchObject({ runId: "run_1", runtime });
  });

  it("accepts delta and completion events with consistent envelope identity", () => {
    const delta = createEnvelope(
      "agent.message_delta",
      {
        sessionId: "session_1",
        runId: "run_1",
        messageId: "message_1",
        delta: "第一段",
        runtime
      },
      {
        id: "event_delta",
        context: { sessionId: "session_1", runId: "run_1" }
      }
    );
    const completed = createEnvelope(
      "agent.message_completed",
      {
        sessionId: "session_1",
        runId: "run_1",
        messageId: "message_1",
        role: "assistant" as const,
        content: "第一段",
        thinking: "先理解上下文。",
        stopReason: "stop",
        runtime
      },
      {
        id: "event_completed",
        context: { sessionId: "session_1", runId: "run_1" }
      }
    );

    expect(AgentMessageDeltaEventEnvelopeSchema.parse(delta).payload.delta).toBe("第一段");
    expect(AgentMessageCompletedEventEnvelopeSchema.parse(completed).payload.content).toBe(
      "第一段"
    );
    expect(SystemEventEnvelopeSchema.parse(completed).type).toBe("agent.message_completed");
  });

  it("rejects an event whose run context differs from its payload", () => {
    const event = createEnvelope(
      "agent.message_delta",
      {
        sessionId: "session_1",
        runId: "run_1",
        messageId: "message_1",
        delta: "内容",
        runtime
      },
      {
        id: "event_bad_run",
        context: { sessionId: "session_1", runId: "run_2" }
      }
    );

    expect(() => AgentMessageDeltaEventEnvelopeSchema.parse(event)).toThrow();
  });

  it("validates command and event messages at the Utility boundary", () => {
    const command = createEnvelope(
      "session.prompt",
      { sessionId: "session_1", message: "分析人物动机" },
      { id: "cmd_utility", context: { sessionId: "session_1" } }
    );
    const event = createEnvelope(
      "agent.message_delta",
      {
        sessionId: "session_1",
        runId: "run_1",
        messageId: "message_1",
        delta: "正在分析",
        runtime
      },
      {
        id: "event_utility",
        context: { sessionId: "session_1", runId: "run_1" }
      }
    );

    expect(
      UtilityInboundMessageSchema.parse({
        kind: "utility.command.request",
        requestId: "request_1",
        command
      }).kind
    ).toBe("utility.command.request");
    expect(
      UtilityOutboundMessageSchema.parse({
        kind: "utility.command.event",
        worker: "agent",
        requestId: "request_1",
        event
      }).kind
    ).toBe("utility.command.event");
  });

  it("requires truthful truncation metadata for a shortened live snapshot", () => {
    const snapshot = {
      id: "chapter_long",
      domain: "creation" as const,
      title: "长章节",
      path: ["作品", "长章节"],
      source: "live-editor" as const,
      content: "字".repeat(20_000),
      truncated: true,
      originalLength: 20_010
    };

    expect(ActiveResourceSnapshotSchema.parse(snapshot).originalLength).toBe(20_010);
    expect(() =>
      ActiveResourceSnapshotSchema.parse({ ...snapshot, originalLength: 20_000 })
    ).toThrow();
  });

  it("does not allow material snapshots in the attached skill list", () => {
    expect(() =>
      WorkspaceRuntimeContextSchema.parse({
        attachedSkills: [
          {
            id: "material_1",
            title: "雨夜声音",
            source: "attached-material",
            content: "雨声素材"
          }
        ]
      })
    ).toThrow();
  });
});
