import type { CommandResult } from "@deepwrite/contracts";

export function safeErrorDetails(error: unknown): Record<string, unknown> {
  return { kind: error instanceof Error ? error.name : "unknown" };
}

export function rejectedResult(
  requestId: string,
  code: string,
  message: string,
  details?: Record<string, unknown>
): CommandResult {
  return {
    status: "rejected",
    requestId,
    error: { code, message, ...(details ? { details } : {}) }
  };
}
