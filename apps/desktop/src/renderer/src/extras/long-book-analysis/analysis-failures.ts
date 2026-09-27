import { isInsufficientQuotaErrorMessage } from "@deepwrite/contracts/renderer";

/**
 * Why a long-book analysis unit stopped. The scheduler treats these very
 * differently, so the distinction has to survive the trip from the agent
 * process to the renderer.
 */
export type AnalysisFailureKind =
  /** The agent process is at its concurrent-run ceiling — wait, don't fail. */
  | "capacity"
  /** The run was stopped on purpose (pause / cancel). */
  | "aborted"
  /** The account is out of credit — stop the whole plan. */
  | "insufficient_quota"
  | "other";

export interface AnalysisFailure {
  kind: AnalysisFailureKind;
  /** Provider or IPC error code, when one was available. */
  code?: string;
  message: string;
}

/** Carries the structured code/details an agent.error event provides. */
export class LongBookAnalysisUnitError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "LongBookAnalysisUnitError";
  }
}

/** Rejections arrive as `"<code>: <message>"` from the preload command bridge. */
const CODE_PREFIX = /^([a-z][\w.]*):\s/u;

function failureCode(cause: unknown, message: string): string | undefined {
  if (cause instanceof LongBookAnalysisUnitError && cause.code) {
    return cause.code;
  }
  return CODE_PREFIX.exec(message)?.[1];
}

function failureDetails(
  cause: unknown
): Record<string, unknown> | undefined {
  return cause instanceof LongBookAnalysisUnitError ? cause.details : undefined;
}

/**
 * Classify a unit failure.
 *
 * Order matters: capacity and abort are checked before the quota wording, so a
 * message that happens to mention both is not misread as an exhausted account.
 */
export function classifyAnalysisFailure(cause: unknown): AnalysisFailure {
  const message =
    cause instanceof Error ? cause.message : String(cause ?? "");
  const code = failureCode(cause, message);
  const details = failureDetails(cause);

  if (code === "agent.capacity_reached" || message.includes("agent.capacity_reached")) {
    return { kind: "capacity", ...(code ? { code } : {}), message };
  }
  if (code === "pi_agent.aborted") {
    return { kind: "aborted", code, message };
  }
  if (
    details?.failureKind === "insufficient_quota" ||
    isInsufficientQuotaErrorMessage(message)
  ) {
    return { kind: "insufficient_quota", ...(code ? { code } : {}), message };
  }
  return { kind: "other", ...(code ? { code } : {}), message };
}
