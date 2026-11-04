import {
  createEnvelope,
  type AgentTeamCatalogSnapshot,
  type CommandEnvelope,
  type CommandResult,
  type GeneralSettings
} from "@deepwrite/contracts";
import type {
  ExternalControlClient,
  ExternalControlErrorCode,
  ExternalControlResourceChange,
  ExternalWindowRequest
} from "@deepwrite/contracts/external-control";
import { randomUUID } from "node:crypto";
import type { CoreRequest } from "./core-client";
import { ExternalControlError } from "./errors";
import type { TrashStore } from "./trash-store";

/** Everything a write tool may touch. */
export interface MutationContext {
  /** The same command route the window uses, so behavior cannot drift. */
  command(command: CommandEnvelope): Promise<CommandResult>;
  core: CoreRequest;
  activeRunCount(): number;
  /** Main-owned resource ids; unknown runs use "*". */
  activeResourceIds?(): ReadonlySet<string>;
  rendererReady(): boolean;
  generalSettings(): GeneralSettings;
  windowRequest(request: ExternalWindowRequest): Promise<unknown>;
  agentTeams(): Promise<AgentTeamCatalogSnapshot>;
  broadcastChange(change: ExternalControlResourceChange): void;
  trash: TrashStore;
  client: ExternalControlClient;
}

const STALE_CODES = new Set(["catalog.conflict", "long.document_conflict"]);
const GENERIC_REFUSAL = "DeepWrite 拒绝了这次操作。请确认目标和参数后重试。";

/** A running agent's proposals would lose their base if text moved under it. */
export function assertNoActiveRun(
  context: MutationContext,
  resourceIds?: readonly string[]
): void {
  const active = context.activeResourceIds?.();
  const conflicts =
    resourceIds === undefined ||
    !active ||
    active.has("*") ||
    resourceIds.some((id) => active.has(id));
  if (context.activeRunCount() > 0 && conflicts) {
    throw new ExternalControlError(
      "external.busy",
      "目标资源或全局配置正被智能体使用，暂时不能修改。请等对应运行结束后重试。"
    );
  }
}

function mappedFailure(code: string, message: string): ExternalControlError {
  if (STALE_CODES.has(code)) {
    return new ExternalControlError(
      "external.stale_revision",
      "内容已被修改，这次写入没有生效。请重新读取后，基于最新内容再写一次。"
    );
  }
  if (code === "ipc.invalid_command") {
    return new ExternalControlError("external.invalid_input", GENERIC_REFUSAL);
  }
  if (code.startsWith("utility.") || code.startsWith("ipc.")) {
    return new ExternalControlError(
      "external.not_ready",
      "DeepWrite 暂时无法完成这次操作。请稍后重试。"
    );
  }
  // Core explains refusals usefully, such as a work's last section, but its
  // messages may also carry local paths, which must stay on this machine.
  const safe = message.length <= 200 && !/[/\\]/u.test(message);
  return new ExternalControlError(
    "external.invalid_input",
    safe ? message : GENERIC_REFUSAL
  );
}

export async function runCommand<T>(
  context: MutationContext,
  type: CommandEnvelope["type"],
  payload: unknown,
  schema: { parse(value: unknown): T }
): Promise<T> {
  const id = randomUUID();
  const result = await context.command(
    createEnvelope(type, payload, { id }) as CommandEnvelope
  );
  if (result.status === "rejected") {
    throw mappedFailure(result.error.code, result.error.message);
  }
  return schema.parse(result.payload);
}

export function requireField<T>(
  value: T | undefined,
  action: string,
  field: string
): T {
  if (value === undefined) {
    throw new ExternalControlError(
      "external.invalid_input" satisfies ExternalControlErrorCode,
      `${action} 需要提供 ${field}。`
    );
  }
  return value;
}

/** Results of create commands wrap the new resource in a few different shapes. */
export function createdId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const value = payload as {
    id?: unknown;
    resource?: { id?: unknown };
    book?: { id?: unknown };
  };
  const id = value.resource?.id ?? value.book?.id ?? value.id;
  return typeof id === "string" ? id : undefined;
}

export const ANY_PAYLOAD = { parse: (value: unknown): unknown => value };
