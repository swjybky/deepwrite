import {
  CommandEnvelopeSchema,
  SessionAbortAcceptedPayloadSchema,
  SessionSteerAcceptedPayloadSchema,
  SessionUserInputResponseAcceptedPayloadSchema,
  conversationPromptBudgetError,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { safeErrorDetails } from "./errors";
import { teamPromptReviews } from "../team-prompt-reviews";
import type { IpcCommandContext } from "./command-types";

type RunControlContext = Pick<
  IpcCommandContext,
  "supervisor" | "requireGeneralSettingsStore"
>;

interface RunControlForward<TAccepted> {
  internalType: "agent.abort" | "agent.user_input_response" | "agent.steer";
  parseAccepted(payload: unknown): TAccepted;
  /** True when the Agent's receipt names the requested run (and item). */
  matches(accepted: TAccepted): boolean;
  mismatch: { code: string; message: string };
  failure: { code: string; message: string };
}

/**
 * activeRuns is a Main-side event-stream mirror and can briefly lag the Agent
 * utility that owns the run. Run controls are forwarded to that authoritative
 * owner, which validates sessionId and runId before acting.
 */
async function forwardRunControl<TAccepted>(
  ctx: RunControlContext,
  command: CommandEnvelope,
  forward: RunControlForward<TAccepted>
): Promise<CommandResult> {
  try {
    const internalCommand = CommandEnvelopeSchema.parse(
      createEnvelope(forward.internalType, command.payload, {
        id: command.id,
        context: command.context
      })
    );
    const result = await ctx.supervisor.requestCommand(
      "agent",
      internalCommand,
      10_000
    );
    if (result.status !== "accepted") return result;
    const accepted = forward.parseAccepted(result.payload);
    if (!forward.matches(accepted)) {
      return {
        status: "rejected",
        requestId: command.id,
        error: forward.mismatch
      };
    }
    return { status: "accepted", requestId: command.id, payload: accepted };
  } catch (error: unknown) {
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: forward.failure.code,
        message:
          error instanceof Error ? error.message : forward.failure.message,
        details: safeErrorDetails(error)
      }
    };
  }
}

/** Stop, answer and steer an active run. */
export async function handleSessionRunControlCommands(
  ctx: RunControlContext,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (command.type === "session.user_input_response") {
    const request = command.payload;
    teamPromptReviews.answer(request);
    const result = await forwardRunControl(ctx, command, {
      internalType: "agent.user_input_response",
      parseAccepted: (payload) =>
        SessionUserInputResponseAcceptedPayloadSchema.parse(payload),
      matches: (accepted) =>
        accepted.sessionId === request.sessionId &&
        accepted.runId === request.runId &&
        accepted.requestId === request.requestId,
      mismatch: {
        code: "ipc.invalid_agent_user_input_result",
        message: "Agent user-input result does not match the request."
      },
      failure: {
        code: "ipc.agent_user_input_failed",
        message: "提交用户回答失败。"
      }
    });
    if (result.status !== "accepted")
      teamPromptReviews.clearRequest(request.runId, request.requestId);
    return result;
  }

  if (command.type === "session.abort") {
    const request = command.payload;
    return forwardRunControl(ctx, command, {
      internalType: "agent.abort",
      parseAccepted: (payload) =>
        SessionAbortAcceptedPayloadSchema.parse(payload),
      matches: (accepted) =>
        accepted.sessionId === request.sessionId &&
        accepted.runId === request.runId,
      mismatch: {
        code: "ipc.invalid_agent_abort_result",
        message: "Agent abort result does not match the requested run."
      },
      failure: {
        code: "ipc.agent_abort_failed",
        message: "Agent abort failed."
      }
    });
  }

  if (command.type === "session.steer") {
    const request = command.payload;
    const { settings } = await ctx.requireGeneralSettingsStore().list();
    const budgetError = conversationPromptBudgetError(
      { message: request.message, attachments: request.attachments },
      settings.contextCompaction.budgetTokens
    );
    if (budgetError) {
      return { status: "rejected", requestId: command.id, error: budgetError };
    }
    return forwardRunControl(ctx, command, {
      internalType: "agent.steer",
      parseAccepted: (payload) =>
        SessionSteerAcceptedPayloadSchema.parse(payload),
      matches: (accepted) =>
        accepted.sessionId === request.sessionId &&
        accepted.runId === request.runId &&
        accepted.steerId === request.steerId,
      mismatch: {
        code: "ipc.invalid_agent_steer_result",
        message: "Agent steering result does not match the request."
      },
      failure: { code: "ipc.agent_steer_failed", message: "插话发送失败。" }
    });
  }

  return undefined;
}
