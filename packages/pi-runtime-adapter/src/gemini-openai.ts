import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  normalizeContext,
  type Api,
  type Context,
  type Model,
  type SimpleStreamOptions
} from "@earendil-works/pi-ai";
import { observeAssistantStream } from "./tool-stream";

const SIGNATURE_TYPE = "gemini-openai-thought-signature";
const GEMINI_MODEL_PATTERN = /(?:^|[/_.:-])gemini-(?:\d|flash|pro)/iu;

export const GEMINI_OPENAI_COMPLETIONS_COMPAT = {
  supportsStore: false,
  supportsDeveloperRole: false,
  maxTokensField: "max_tokens",
  requiresToolResultName: true
} as const satisfies Model<"openai-completions">["compat"];

export function isGeminiModelId(modelId: string): boolean {
  return GEMINI_MODEL_PATTERN.test(modelId);
}

export function isGeminiOpenAIConfig(
  config: Pick<AgentProviderRuntimeConfig, "api" | "modelId" | "requestModelId">
): boolean {
  return (
    config.api === "openai-completions" &&
    (isGeminiModelId(config.modelId) ||
      isGeminiModelId(config.requestModelId ?? ""))
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function decodeSignature(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = record(JSON.parse(value));
    return parsed?.type === SIGNATURE_TYPE &&
      typeof parsed.signature === "string"
      ? parsed.signature
      : undefined;
  } catch {
    return undefined;
  }
}

function replayToolSignatures(
  payload: unknown,
  model: Model<Api>,
  context: Context
): unknown {
  const request = record(payload);
  if (!Array.isArray(request?.messages)) return payload;
  const signatures = new Map<string, Array<string | undefined>>();
  let hasSignature = false;
  for (const message of context.messages) {
    if (
      message.role !== "assistant" ||
      message.stopReason === "error" ||
      message.stopReason === "aborted"
    ) {
      continue;
    }
    const sameModel =
      message.api === model.api &&
      message.provider === model.provider &&
      message.model === model.id;
    for (const block of message.content) {
      if (block.type !== "toolCall") continue;
      const signature = sameModel
        ? decodeSignature(block.thoughtSignature)
        : undefined;
      const occurrences = signatures.get(block.id) ?? [];
      occurrences.push(signature);
      signatures.set(block.id, occurrences);
      hasSignature ||= Boolean(signature);
    }
  }
  if (!hasSignature) return payload;
  return {
    ...request,
    messages: request.messages.map((value) => {
      const message = record(value);
      if (message?.role !== "assistant" || !Array.isArray(message.tool_calls)) {
        return value;
      }
      return {
        ...message,
        tool_calls: message.tool_calls.map((value) => {
          const call = record(value);
          const signature =
            typeof call?.id === "string"
              ? signatures.get(call.id)?.shift()
              : undefined;
          if (!signature) return value;
          const extra = record(call!.extra_content);
          return {
            ...call,
            extra_content: {
              ...extra,
              google: {
                ...record(extra?.google),
                thought_signature: signature
              }
            }
          };
        })
      };
    })
  };
}

/**
 * Pi's OpenAI serializer does not retain Google's tool-call extra_content.
 * Preserve it in Pi's existing opaque signature slot, tagged so OpenRouter
 * reasoning metadata cannot be replayed as a Google signature. The signature
 * stays on its original call; missing signatures are never manufactured.
 */
export function withGeminiOpenAIToolSignatures(
  sourceStreamFn: StreamFn
): (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions
) => ReturnType<StreamFn> {
  return (model, rawContext, options) => {
    const context = normalizeContext(rawContext);
    const signatures = new Map<string, string>();
    const callIds = new Map<number, string>();
    const indexedSignatures = new Map<number, string>();
    const observeChunk = (value: unknown) => {
      const chunk = record(value);
      const choice = Array.isArray(chunk?.choices)
        ? record(chunk.choices[0])
        : undefined;
      const calls = record(choice?.delta)?.tool_calls;
      if (!Array.isArray(calls)) return;
      for (const value of calls) {
        const call = record(value);
        if (!call) continue;
        const index = typeof call.index === "number" ? call.index : undefined;
        const id = typeof call.id === "string" && call.id ? call.id : undefined;
        const signature = record(
          record(call.extra_content)?.google
        )?.thought_signature;
        if (index !== undefined && id) callIds.set(index, id);
        if (typeof signature === "string" && signature) {
          if (id) signatures.set(id, signature);
          if (index !== undefined) indexedSignatures.set(index, signature);
        }
        if (index !== undefined) {
          const callId = callIds.get(index);
          const indexedSignature = indexedSignatures.get(index);
          if (callId && indexedSignature)
            signatures.set(callId, indexedSignature);
        }
      }
    };
    return observeAssistantStream(
      (requestModel, requestContext, requestOptions) =>
        sourceStreamFn(requestModel, requestContext, {
          ...requestOptions,
          onPayload: async (payload, payloadModel) => {
            const adapted = replayToolSignatures(
              payload,
              payloadModel,
              requestContext
            );
            const replacement = await options?.onPayload?.(
              adapted,
              payloadModel
            );
            return replacement === undefined ? adapted : replacement;
          },
          onProviderStreamEvent: async (chunk, chunkModel) => {
            observeChunk(chunk);
            await options?.onProviderStreamEvent?.(chunk, chunkModel);
          }
        }),
      (event) => {
        const message =
          "partial" in event
            ? event.partial
            : event.type === "done"
              ? event.message
              : event.error;
        for (const block of message.content) {
          if (block.type !== "toolCall") continue;
          const signature = signatures.get(block.id);
          if (signature) {
            block.thoughtSignature = JSON.stringify({
              type: SIGNATURE_TYPE,
              signature
            });
          }
        }
      }
    )(model, context, options);
  };
}
