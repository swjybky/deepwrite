import type { AgentConversationContext } from "./context";
import type { AgentRuntimeRef } from "@deepwrite/contracts";
import type { ChatMessage } from "../../types/conversation";
import { id } from "./shared";

type MessageIdentityContext = Pick<
  AgentConversationContext,
  "runMessageIds" | "messages" | "failProtocol" | "messageMutations"
>;
export function assistantMessageForRun(
  ctx: MessageIdentityContext,
  runId: string
): ChatMessage | undefined {
  const mappedMessageId = ctx.runMessageIds.get(runId);
  return (
    (mappedMessageId
      ? ctx.messages.value.find(
          (message) =>
            message.id === mappedMessageId &&
            message.role === "assistant" &&
            message.runId === runId
        )
      : undefined) ??
    ctx.messages.value.find(
      (message) => message.role === "assistant" && message.runId === runId
    )
  );
}
export function ensureAssistantMessage(
  ctx: MessageIdentityContext,
  runId: string,
  messageId: string,
  eventRuntime?: AgentRuntimeRef,
  createdAt = new Date().toISOString()
): ChatMessage | undefined {
  const mappedMessageId = ctx.runMessageIds.get(runId);
  if (mappedMessageId && mappedMessageId !== messageId) {
    const placeholder = ctx.messages.value.find(
      (message) =>
        message.id === mappedMessageId &&
        message.role === "assistant" &&
        message.runId === runId &&
        message.activityOnly
    );
    if (
      !placeholder ||
      ctx.messages.value.some((message) => message.id === messageId)
    ) {
      ctx.failProtocol(
        runId,
        "智能体为同一运行返回了不一致的消息标识。",
        eventRuntime
      );
      return undefined;
    }
    placeholder.id = messageId;
    placeholder.activityOnly = false;
    if (eventRuntime) {
      placeholder.runtime = eventRuntime;
    }
    ctx.runMessageIds.set(runId, messageId);
    return placeholder;
  }
  const existing = ctx.messageMutations.findById(messageId);
  if (existing) {
    if (existing.role !== "assistant" || existing.runId !== runId) {
      ctx.failProtocol(
        runId,
        "智能体消息标识与现有消息发生冲突。",
        eventRuntime
      );
      return undefined;
    }
    ctx.runMessageIds.set(runId, messageId);
    existing.activityOnly = false;
    if (eventRuntime) {
      existing.runtime = eventRuntime;
    }
    return existing;
  }
  const message: ChatMessage = {
    id: messageId,
    role: "assistant",
    content: "",
    createdAt,
    runId,
    status: "streaming",
    ...(eventRuntime ? { runtime: eventRuntime } : {})
  };
  ctx.runMessageIds.set(runId, messageId);
  ctx.messages.value.push(message);
  return ctx.messageMutations.findById(messageId)!;
}
export function ensureActivityMessage(
  ctx: MessageIdentityContext,
  runId: string,
  eventRuntime: AgentRuntimeRef,
  createdAt: string
): ChatMessage {
  const mappedMessageId = ctx.runMessageIds.get(runId);
  const existing = mappedMessageId
    ? ctx.messages.value.find(
        (message) =>
          message.id === mappedMessageId &&
          message.role === "assistant" &&
          message.runId === runId
      )
    : undefined;
  if (existing) {
    existing.runtime = eventRuntime;
    return existing;
  }
  const message: ChatMessage = {
    id: `${runId}_assistant`,
    role: "assistant",
    content: "",
    createdAt,
    runId,
    status: "streaming",
    runtime: eventRuntime,
    activityOnly: true,
    toolCalls: [],
    processingSteps: []
  };
  ctx.runMessageIds.set(runId, message.id);
  ctx.messages.value.push(message);
  return ctx.messageMutations.findById(message.id)!;
}
export function ensureSubagentMessage(
  ctx: MessageIdentityContext,
  runId: string,
  createdAt: string
): ChatMessage {
  const mappedMessageId = ctx.runMessageIds.get(runId);
  const existing = mappedMessageId
    ? ctx.messages.value.find(
        (message) =>
          message.id === mappedMessageId &&
          message.role === "assistant" &&
          message.runId === runId
      )
    : ctx.messages.value.find(
        (message) => message.role === "assistant" && message.runId === runId
      );
  if (existing) {
    ctx.runMessageIds.set(runId, existing.id);
    return existing;
  }
  const preferredId = `${runId}_assistant`;
  const message: ChatMessage = {
    id: ctx.messages.value.some((candidate) => candidate.id === preferredId)
      ? `${preferredId}_${id("subagent")}`
      : preferredId,
    role: "assistant",
    content: "",
    createdAt,
    runId,
    status: "streaming",
    activityOnly: true,
    toolCalls: [],
    processingSteps: [],
    subagentRuns: []
  };
  ctx.runMessageIds.set(runId, message.id);
  ctx.messages.value.push(message);
  return ctx.messageMutations.findById(message.id)!;
}
