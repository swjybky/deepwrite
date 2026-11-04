import type { ExternalControl } from "../extras/external-control";
import { runExternalConcurrencySmoke } from "./smoke-external-concurrency";
import type { BrowserWindow } from "electron";
import {
  CommandEnvelopeSchema,
  ErrorPayloadSchema,
  SessionPromptAcceptedPayloadSchema,
  createEnvelope,
  type SystemHealthPayload,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import type { UtilitySupervisor } from "./supervisor";
import { runBookTemplateSmoke } from "./smoke-book-templates";
import { runExtrasAgentSmoke } from "./smoke-extras-agents";
import { runExtrasChatSmoke } from "./smoke-extras-chat";
import { runFeedbackSmoke } from "./smoke-feedback";
import { runContextCompactionSmoke } from "./smoke-context-compaction";
import { runConversationSmoke } from "./smoke-conversation";
import { runVoiceSmoke } from "./smoke-voice";
import { runVoiceUiSmoke } from "./smoke-voice-ui";
import { runI18nSmoke } from "./smoke-i18n";
import { runLongBookDecompositionSmoke } from "./smoke-long-book-decomposition";
import {
  runDecompositionUiSmoke,
  runPresetProtectionSmoke
} from "./smoke-decomposition-ui";
import { runBookIdentitySmoke } from "./smoke-book-identity";
import { runLibraryGroupDeletionSmoke } from "./smoke-library-group-deletion";
import { runShortBookSourceSmoke } from "./smoke-short-book-sources";
import { smokeReleaseConfig } from "./smoke-release-config";

export function smokeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const payload = ErrorPayloadSchema.safeParse(error);
  return payload.success
    ? `${payload.data.code}: ${payload.data.message}`
    : "unknown";
}

export async function runApplicationSmoke(
  health: SystemHealthPayload,
  supervisor: UtilitySupervisor,
  window: BrowserWindow,
  setEventTap: (
    tap: ((event: SystemEventEnvelope) => void) | undefined
  ) => void,
  externalCall?: ExternalControl["call"]
): Promise<void> {
  const releaseConfig = smokeReleaseConfig();
  if (process.env.DEEPWRITE_SMOKE_SUITE === "external-concurrency") {
    if (!externalCall) throw new Error("External control smoke unavailable");
    const concurrency = await runExternalConcurrencySmoke(externalCall);
    console.log(
      `DEEPWRITE_SMOKE_OK ${JSON.stringify({ health, concurrency })}`
    );
    return;
  }
  if (process.env.DEEPWRITE_SMOKE_SUITE === "preset-protection") {
    const presetProtection = await runPresetProtectionSmoke(window);
    console.log(
      `DEEPWRITE_SMOKE_OK ${JSON.stringify({ health, presetProtection })}`
    );
    return;
  }
  if (process.env.DEEPWRITE_SMOKE_SUITE === "short-book-sources") {
    const shortBookSources = await runShortBookSourceSmoke(window);
    console.log(
      `DEEPWRITE_SMOKE_OK ${JSON.stringify({ health, shortBookSources })}`
    );
    return;
  }
  if (process.env.DEEPWRITE_SMOKE_SUITE === "library-groups") {
    const libraryGroups = await runLibraryGroupDeletionSmoke(window);
    console.log(
      `DEEPWRITE_SMOKE_OK ${JSON.stringify({ health, libraryGroups })}`
    );
    return;
  }
  if (process.env.DEEPWRITE_SMOKE_SUITE === "book-identity") {
    const bookIdentity = await runBookIdentitySmoke(window, supervisor);
    console.log(
      `DEEPWRITE_SMOKE_OK ${JSON.stringify({ health, bookIdentity })}`
    );
    return;
  }
  if (
    ["decomposition", "decomposition-real-model"].includes(
      process.env.DEEPWRITE_SMOKE_SUITE ?? ""
    )
  ) {
    const decomposition = await runLongBookDecompositionSmoke(
      window,
      supervisor
    );
    const decompositionUi =
      process.env.DEEPWRITE_SMOKE_SUITE === "decomposition"
        ? await runDecompositionUiSmoke(window)
        : undefined;
    console.log(
      `DEEPWRITE_SMOKE_OK ${JSON.stringify({ health, decomposition, decompositionUi })}`
    );
    return;
  }
  if (process.env.DEEPWRITE_SMOKE_SUITE === "conversation") {
    const conversation = await runConversationSmoke(window);
    console.log(
      `DEEPWRITE_SMOKE_OK ${JSON.stringify({ health, conversation })}`
    );
    return;
  }
  if (process.env.DEEPWRITE_SMOKE_SUITE === "i18n") {
    const localization = await runI18nSmoke(window);
    console.log(
      `DEEPWRITE_SMOKE_OK ${JSON.stringify({ health, localization })}`
    );
    return;
  }
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
    const bookTemplates = await runBookTemplateSmoke(window);
    const shortBookSources = await runShortBookSourceSmoke(window);
    const extrasAgents = await runExtrasAgentSmoke(window);
    const extrasChat = await runExtrasChatSmoke(window);
    const feedback = await runFeedbackSmoke(window);
    const contextCompaction = await runContextCompactionSmoke(window);
    const voice = await runVoiceSmoke(window);
    const voiceUi = await runVoiceUiSmoke(window);
    const localization = await runI18nSmoke(window);
    console.log(
      `DEEPWRITE_SMOKE_OK ${JSON.stringify({
        health,
        releaseConfig,
        conversation,
        bookTemplates,
        shortBookSources,
        extrasAgents,
        extrasChat,
        feedback,
        contextCompaction,
        voice,
        voiceUi,
        localization,
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
