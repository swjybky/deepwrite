import { randomUUID } from "node:crypto";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { SubagentActivity } from "@deepwrite/contracts";
import { observeAssistantStream } from "./tool-stream";

type Activity = Extract<SubagentActivity, { type: "model_call" }>;

/** SDK-normalized model names are not evidence of the upstream response model. */
export function traceSubagentStream(
  source: StreamFn,
  emit: (activity: Activity) => void
): StreamFn {
  let sequence = 0;
  return (model, context, options) => {
    const start = Date.now();
    const call: Activity["call"] = {
      snapshot: JSON.parse(
        JSON.stringify({
          systemPrompt: "systemPrompt" in context ? context.systemPrompt : "",
          messages: context.messages,
          tools: "tools" in context ? context.tools : []
        })
      ),
      requestId: randomUUID(),
      sequence: ++sequence,
      requestedProvider: model.provider,
      requestedModel: model.id,
      responseModel: null,
      responseModelEvidence: "unknown",
      startedAt: new Date(start).toISOString(),
      status: "running"
    };
    emit({ type: "model_call", call: { ...call } });
    // The inner observer converts throws and unterminated streams to errors.
    return observeAssistantStream(
      observeAssistantStream(source, () => {}),
      (event) => {
        if (event.type !== "done" && event.type !== "error") return;
        emit({
          type: "model_call",
          call: {
            ...call,
            endedAt: new Date().toISOString(),
            durationMs: Math.max(0, Date.now() - start),
            status:
              event.type === "done"
                ? "completed"
                : event.reason === "aborted"
                  ? "aborted"
                  : "error"
          }
        });
      }
    )(model, context, {
      ...options,
      onPayload: async (payload, targetModel) => {
        const replacement = await options?.onPayload?.(payload, targetModel);
        const effective = replacement ?? payload;
        if (effective && typeof effective === "object" && call.snapshot) {
          // Only model input fields; transport headers and credentials stay out.
          const input = Object.fromEntries(
            Object.entries(effective).filter(([key]) =>
              [
                "messages",
                "system",
                "systemInstruction",
                "contents",
                "input",
                "instructions",
                "tools",
                "tool_choice"
              ].includes(key)
            )
          );
          call.snapshot.providerInput = JSON.parse(JSON.stringify(input));
          emit({ type: "model_call", call: { ...call } });
        }
        return replacement;
      }
    });
  };
}
