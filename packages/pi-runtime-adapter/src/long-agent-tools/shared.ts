import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Static, TSchema } from "@earendil-works/pi-ai";
import { createHash } from "node:crypto";
import {
  LongWorkspaceOperationError,
  previewLongWorkspaceOperations,
  type CommandResult,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import { piStrictToolSampling } from "../pi-tool-schema";
import type { LongAgentToolDetails, LongCommandExecutor } from "./index";

export function textResult(
  text: string,
  details: LongAgentToolDetails = { kind: "none" }
): AgentToolResult<LongAgentToolDetails> {
  return { content: [{ type: "text", text }], details };
}

export function preflightLongMutationProposal(
  index: LongWorkspaceIndexSnapshot,
  batch: LongWorkspaceOperationBatch
): AgentToolResult<LongAgentToolDetails> | undefined {
  if (batch.operations.length === 0) return undefined;
  try {
    previewLongWorkspaceOperations(index, { ...batch, documentWrites: [] });
    return undefined;
  } catch (error: unknown) {
    if (!(error instanceof LongWorkspaceOperationError)) throw error;
    const reasonLabels: Record<typeof error.code, string> = {
      not_found: "目标条目不存在",
      already_exists: "目标条目已经存在",
      invalid_reference: "引用关系无效",
      impact_mismatch: "关联影响已经变化",
      invalid_order: "排序范围或顺序不完整",
      recorded_chapter_order: "已写入连续性账本的章节位置固定",
      invalid_document_write: "文档写入目标无效",
      invalid_result: "操作后的结构不满足长篇约束",
      document_changed: "文档在读取后已有改动"
    };
    return textResult(
      [
        `未形成长篇结构变更提案：${reasonLabels[error.code]}（${error.code}）。`,
        `校验详情：${error.message}`,
        "不会生成审批卡。请先根据最新结构修正操作；如果修正会改变用户原意，请直接告知用户当前约束和可选方案，不要重复提交相同参数，也不要声称变更已经保存。"
      ].join("\n")
    );
  }
}

export function defineTool<T extends TSchema>(definition: {
  name: string;
  label: string;
  description: string;
  parameters: T;
  execute: (
    toolCallId: string,
    params: Static<T>,
    signal?: AbortSignal
  ) => Promise<AgentToolResult<LongAgentToolDetails>>;
  executionMode?: AgentTool["executionMode"];
}): AgentTool<T, LongAgentToolDetails> {
  return {
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: definition.parameters,
    ...piStrictToolSampling(definition.parameters),
    execute: definition.execute,
    ...(definition.executionMode
      ? { executionMode: definition.executionMode }
      : {})
  };
}

function abortError(): Error {
  const error = new Error("Long workspace query was aborted.");
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

export function requireExecutor(
  executor: LongCommandExecutor | undefined
): LongCommandExecutor {
  if (!executor) {
    throw new Error("Long workspace Core bridge is unavailable.");
  }
  return executor;
}

export function requireAccepted(result: CommandResult): unknown {
  if (result.status === "rejected") {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.payload;
}

export function stableHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function maxOrder(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

const STABLE_ENTITY_ID_HEX_LENGTH = 8;

export function stableEntityId(prefix: string, seed: string): string {
  return `${prefix}_${stableHash(seed).slice(0, STABLE_ENTITY_ID_HEX_LENGTH)}`;
}

export function allEntityIds(index: LongWorkspaceIndexSnapshot): Set<string> {
  return new Set([
    ...index.worldbuilding.map(({ id }) => id),
    ...index.worldbuilding.flatMap((category) =>
      category.format === "list" ? category.items.map(({ id }) => id) : []
    ),
    ...index.characters.map(({ id }) => id),
    ...index.characterTypes.map(({ id }) => id),
    ...index.plot.volumes.map(({ id }) => id),
    ...index.plot.arcs.map(({ id }) => id),
    ...index.plot.chapterCards.map(({ id }) => id),
    ...index.plot.storyEvents.map(({ id }) => id),
    ...index.plot.storyPlots.map(({ id }) => id),
    ...index.plot.eventConnections.map(({ id }) => id),
    ...index.plot.narrativePlacements.map(({ id }) => id),
    ...index.plot.foreshadowing.flatMap((thread) => [
      thread.id,
      ...thread.beats.map(({ id }) => id)
    ])
  ]);
}

/** Deterministic per run so retries of the same tool call reuse the same id. */
export function allocateStableId(
  index: LongWorkspaceIndexSnapshot,
  prefix: string,
  seed: string
): string {
  const occupied = allEntityIds(index);
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const id = stableEntityId(prefix, `${seed}:${attempt}`);
    if (!occupied.has(id)) return id;
  }
  throw new Error(`Unable to allocate a stable ${prefix} id.`);
}
