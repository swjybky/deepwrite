import type { BrowserWindow } from "electron";
import {
  CommandEnvelopeSchema,
  SessionPromptAcceptedPayloadSchema,
  createEnvelope,
  type SystemHealthPayload,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import type { UtilitySupervisor } from "./supervisor";
import { runConversationSmoke } from "./smoke-conversation";

export async function runApplicationSmoke(
  health: SystemHealthPayload,
  supervisor: UtilitySupervisor,
  window: BrowserWindow,
  setEventTap: (tap: ((event: SystemEventEnvelope) => void) | undefined) => void
): Promise<void> {
  const sessionId = "session_electron_smoke";
  const commandId = createId("cmd_smoke");
  const events: SystemEventEnvelope[] = [];
  let resolveTerminal: (() => void) | undefined;
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve;
  });

  setEventTap((event) => {
    if (
      event.type.startsWith("agent.") &&
      "sessionId" in event.payload &&
      event.payload.sessionId === sessionId
    ) {
      events.push(event);
      if (
        event.type === "agent.message_completed" ||
        event.type === "agent.error"
      ) {
        resolveTerminal?.();
      }
    }
  });

  try {
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "agent.prompt",
        {
          sessionId,
          message: "验证 DeepWrite Electron Faux 流式链路",
          thinkingLevel: "medium" as const,
          workspaceContext: {
            activeResource: {
              id: "chapter_smoke",
              domain: "creation" as const,
              title: "冒烟测试章节",
              path: ["测试作品", "冒烟测试章节"],
              format: "正文",
              source: "live-editor" as const,
              content: "这是发送瞬间的实时文稿。"
            }
          }
        },
        {
          id: commandId,
          context: {
            correlationId: commandId,
            sessionId,
            resourceId: "chapter_smoke"
          }
        }
      )
    );

    const result = await supervisor.requestCommand("agent", command);
    if (result.status === "rejected") {
      throw new Error(`${result.error.code}: ${result.error.message}`);
    }
    const accepted = SessionPromptAcceptedPayloadSchema.parse(result.payload);
    await Promise.race([
      terminal,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Agent smoke timed out.")), 8_000)
      )
    ]);

    const completed = events.find(
      (event) => event.type === "agent.message_completed"
    );
    const errors = events.filter((event) => event.type === "agent.error");
    const deltas = events.filter(
      (event) => event.type === "agent.message_delta"
    );
    const thinking = events.filter(
      (event) => event.type === "agent.thinking_delta"
    );
    const deltaText = deltas
      .map((event) =>
        event.type === "agent.message_delta" ? event.payload.delta : ""
      )
      .join("");

    if (
      accepted.runtime.mode !== "local-faux" ||
      !completed ||
      errors.length > 0 ||
      deltas.length < 2 ||
      thinking.length < 1 ||
      (completed.type === "agent.message_completed" &&
        completed.payload.content !== deltaText)
    ) {
      throw new Error("Agent smoke event assertions failed.");
    }

    const conversation = await runConversationSmoke(window);
    console.log(
      `DEEPWRITE_SMOKE_OK ${JSON.stringify({
        health,
        conversation,
        agent: {
          status: "ok",
          runtime: accepted.runtime,
          deltaCount: deltas.length,
          thinkingDeltaCount: thinking.length,
          completed: true
        }
      })}`
    );
  } finally {
    setEventTap(undefined);
  }
}
