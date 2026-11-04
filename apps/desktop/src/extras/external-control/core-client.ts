import {
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { randomUUID } from "node:crypto";
import { ExternalControlError } from "./errors";

export type CoreRequest = (
  command: CommandEnvelope,
  timeoutMs: number
) => Promise<CommandResult>;

/** Below the bridge's own call timeout, so the agent gets this error instead. */
const CORE_READ_TIMEOUT_MS = 30_000;

/** Core failures carry paths and internals, so none of their text is relayed. */
function coreFailure(code: string, notFound?: string): ExternalControlError {
  return notFound && !code.startsWith("utility.")
    ? new ExternalControlError("external.not_found", notFound)
    : new ExternalControlError(
        "external.not_ready",
        "DeepWrite 暂时无法读取。请稍后重试。"
      );
}

export async function readCore<T>(
  core: CoreRequest,
  type: CommandEnvelope["type"],
  payload: unknown,
  schema: { parse(value: unknown): T },
  notFound?: string
): Promise<T> {
  const id = randomUUID();
  const result = await core(
    createEnvelope(type, payload, { id }) as CommandEnvelope,
    CORE_READ_TIMEOUT_MS
  );
  if (result.status === "rejected") {
    throw coreFailure(result.error.code, notFound);
  }
  return schema.parse(result.payload);
}
