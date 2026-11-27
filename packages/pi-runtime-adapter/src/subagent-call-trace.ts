import { randomUUID } from "node:crypto";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type {
  ModelCallInputSummary,
  SubagentActivity
} from "@deepwrite/contracts";
import { jsonClone } from "@deepwrite/shared";
import { observeAssistantStream } from "./tool-stream";
import { normalizeUsage } from "./usage";

type Activity = Extract<SubagentActivity, { type: "model_call" }>;

export interface TraceSubagentStreamOptions {
  captureSnapshot?: boolean;
}

const PROVIDER_INPUT_KEYS = [
  "messages",
  "system",
  "systemInstruction",
  "contents",
  "input",
  "instructions",
  "tools",
  "tool_choice"
] as const;

function buildInputSummary(
  context: Parameters<StreamFn>[1]
): ModelCallInputSummary {
  const systemPrompt =
    "systemPrompt" in context && typeof context.systemPrompt === "string"
      ? context.systemPrompt
      : "";
  const tools =
    "tools" in context && Array.isArray(context.tools) ? context.tools : [];
  return {
    systemPromptChars: systemPrompt.length,
    messageCount: context.messages.length,
    toolCount: tools.length
  };
}

function summarizeProviderPayload(
  effective: Record<string, unknown>,
  base: ModelCallInputSummary
): ModelCallInputSummary {
  const providerMessages = Array.isArray(effective.messages)
    ? effective.messages.length
    : Array.isArray(effective.contents)
      ? effective.contents.length
      : Array.isArray(effective.input)
        ? effective.input.length
        : undefined;
  const hasProviderTools =
    (Array.isArray(effective.tools) && effective.tools.length > 0) ||
    effective.tool_choice !== undefined;
  return {
    ...base,
    ...(providerMessages !== undefined
      ? { providerMessageCount: providerMessages }
      : {}),
    hasProviderTools
  };
}

/** SDK-normalized model names are not evidence of the upstream response model. */
export function traceSubagentStream(
  source: StreamFn,
  emit: (activity: Activity) => void,
  traceOptions?: TraceSubagentStreamOptions
): StreamFn {
  let sequence = 0;
  const captureSnapshot =
    traceOptions?.captureSnapshot === true ||
    process.env.DEEPWRITE_SUBAGENT_TRACE_SNAPSHOT === "1";

  return (model, context, options) => {
    const start = Date.now();
    let inputSummary = buildInputSummary(context);
    const snapshot = captureSnapshot
      ? (jsonClone({
          systemPrompt: "systemPrompt" in context ? context.systemPrompt : "",
          messages: context.messages,
          tools: "tools" in context ? context.tools : []
        }) as NonNullable<Activity["call"]["snapshot"]>)
      : undefined;
    const baseCall: Activity["call"] = {
      requestId: randomUUID(),
      sequence: ++sequence,
      requestedProvider: model.provider,
      requestedModel: model.id,
      responseModel: null,
      responseModelEvidence: "unknown",
      startedAt: new Date(start).toISOString(),
      status: "running"
    };
    emit({
      type: "model_call",
      call: {
        ...baseCall,
        ...(snapshot ? { snapshot: jsonClone(snapshot) } : {}),
        inputSummary: { ...inputSummary }
      }
    });
    // The inner observer converts throws and unterminated streams to errors.
    return observeAssistantStream(
      observeAssistantStream(source, () => {}),
      (event) => {
        if (event.type !== "done" && event.type !== "error") return;
        const terminalMessage =
          event.type === "done" ? event.message : event.error;
        const usage = normalizeUsage(terminalMessage?.usage);
        const stopReason = terminalMessage?.stopReason ?? event.reason;
        emit({
          type: "model_call",
          call: {
            ...baseCall,
            ...(snapshot ? { snapshot } : {}),
            inputSummary,
            endedAt: new Date().toISOString(),
            durationMs: Math.max(0, Date.now() - start),
            status:
              event.type === "done"
                ? "completed"
                : event.reason === "aborted"
                  ? "aborted"
                  : "error",
            ...(stopReason ? { stopReason } : {}),
            ...(usage ? { usage } : {})
          }
        });
      }
    )(model, context, {
      ...options,
      onPayload: async (payload, targetModel) => {
        const replacement = await options?.onPayload?.(payload, targetModel);
        const effective = replacement ?? payload;
        if (effective && typeof effective === "object") {
          const record = effective as Record<string, unknown>;
          inputSummary = summarizeProviderPayload(record, inputSummary);
          if (snapshot) {
            // Only model input fields; transport headers and credentials stay out.
            const input = Object.fromEntries(
              Object.entries(record).filter(([key]) =>
                (PROVIDER_INPUT_KEYS as readonly string[]).includes(key)
              )
            );
            snapshot.providerInput = jsonClone(input);
          }
        }
        return replacement;
      }
    });
  };
}
