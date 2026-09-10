import {
  type LibraryAgentToolDetails,
  type LibraryDomain,
  type MutableLibraryEntry
} from "./types";
import {
  type AgentToolResult,
  type AgentTool
} from "@earendil-works/pi-agent-core";
import { Type, type Static } from "@earendil-works/pi-ai";
import { piStrictToolSampling } from "../pi-tool-schema";
import { LIBRARY_AGENT_ENTRY_MAX_CHARACTERS } from "@deepwrite/contracts";

export const MATERIAL_STAGE_LABELS: Record<string, string> = {
  gimmick: "梗",
  character: "人设",
  pacing: "剧情设计",
  intro: "导语设计",
  plot_refine: "剧情细化",
  draft_excerpt: "优秀正文片段",
  other: "其他素材"
};

export const SKILL_STAGE_LABELS: Record<string, string> = {
  character_design: "人物技能",
  plot_design: "剧情技能",
  outline: "大纲技能",
  draft: "正文专家编写技能",
  expert_section_writer: "分节写手技能"
};

export function textResult(
  text: string,
  details: LibraryAgentToolDetails = { kind: "none" }
): AgentToolResult<LibraryAgentToolDetails> {
  return { content: [{ type: "text", text }], details };
}

export function defineTool<
  T extends ReturnType<typeof Type.Object>
>(definition: {
  name: string;
  label: string;
  description: string;
  parameters: T;
  execute: (
    toolCallId: string,
    params: Static<T>,
    signal?: AbortSignal
  ) => Promise<AgentToolResult<LibraryAgentToolDetails>>;
  executionMode?: AgentTool["executionMode"];
}): AgentTool<T, LibraryAgentToolDetails> {
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

export function normalizedName(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

export function countTextCharacters(value: string): number {
  return value.replace(/\s/gu, "").length;
}

export function stageLabel(domain: LibraryDomain, stageId: string): string {
  return (
    (domain === "material" ? MATERIAL_STAGE_LABELS : SKILL_STAGE_LABELS)[
      stageId
    ] ?? stageId
  );
}

export function clampInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

export function lineColumnAt(
  text: string,
  index: number
): { line: number; column: number } {
  const prefix = text.slice(0, index);
  const lines = prefix.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

export function formatEntryChoice(
  domain: LibraryDomain,
  entry: MutableLibraryEntry
): string {
  const libraryPart = entry.isCurrentLibrary
    ? ""
    : `｜来源库：${entry.sourceLibraryTitle}（${entry.sourceLibraryId}）`;
  return `- ${entry.title}｜${stageLabel(domain, entry.stageId)}（${entry.stageId}）${libraryPart}｜entry_id=${entry.entryId}`;
}

/** Catalog 原生条目 ID；跨库快照里可能是 `libraryId/entryId`。 */
export function catalogEntryId(entry: MutableLibraryEntry): string {
  const prefix = `${entry.sourceLibraryId}/`;
  return entry.entryId.startsWith(prefix)
    ? entry.entryId.slice(prefix.length)
    : entry.entryId;
}

/**
 * 同时接受：
 * - 快照 ID（当前库裸 ID，或同组跨库的 `libraryId/entryId`）
 * - Catalog 裸 entry_id（可再配合 library_id 消歧）
 */
export function entryIdMatches(
  entry: MutableLibraryEntry,
  requested: string
): boolean {
  if (entry.entryId === requested) return true;
  const nativeId = catalogEntryId(entry);
  if (nativeId === requested) return true;
  return `${entry.sourceLibraryId}/${nativeId}` === requested;
}

export function resolveEntry(
  entries: readonly MutableLibraryEntry[],
  domain: LibraryDomain,
  input: {
    entry_id?: unknown;
    name?: unknown;
    stage_id?: unknown;
    library_id?: unknown;
  }
): { entry: MutableLibraryEntry } | { error: string } {
  const libraryIdFilter = String(input.library_id ?? "").trim();
  const libraryScoped = libraryIdFilter
    ? entries.filter((entry) => entry.sourceLibraryId === libraryIdFilter)
    : entries;
  const stageId = String(input.stage_id ?? "").trim();
  const scoped = stageId
    ? libraryScoped.filter((entry) => entry.stageId === stageId)
    : libraryScoped;
  const entryId = String(input.entry_id ?? "").trim();
  if (entryId) {
    const matches = scoped.filter((entry) => entryIdMatches(entry, entryId));
    if (matches.length === 1) return { entry: matches[0]! };
    if (matches.length > 1) {
      return {
        error: [
          `entry_id=${entryId} 匹配到多个条目，请补充 library_id 或 stage_id：`,
          ...matches.map((entry) => formatEntryChoice(domain, entry))
        ].join("\n")
      };
    }
    return {
      error: `未找到 entry_id=${entryId} 的${domain === "material" ? "素材" : "技能"}条目。`
    };
  }

  const name = normalizedName(String(input.name ?? ""));
  if (!name) return { error: "请提供 entry_id 或 name。" };
  const matches = scoped.filter(
    (entry) => normalizedName(entry.title) === name
  );
  if (matches.length === 1) return { entry: matches[0]! };
  if (matches.length > 1) {
    return {
      error: [
        `找到 ${matches.length} 个同名条目「${name}」，请补充 library_id、stage_id 或 entry_id：`,
        ...matches.map((entry) => formatEntryChoice(domain, entry))
      ].join("\n")
    };
  }
  const nearby = scoped.filter((entry) =>
    normalizedName(entry.title).includes(name)
  );
  return nearby.length
    ? {
        error: [
          `未找到标题完全等于「${name}」的条目。相近条目：`,
          ...nearby
            .slice(0, 10)
            .map((entry) => formatEntryChoice(domain, entry))
        ].join("\n")
      }
    : {
        error: `未找到名为「${name}」的条目，请先调用 list_${domain}_entries。`
      };
}

export const MAX_ENTRY_CONTENT_CHARACTERS = LIBRARY_AGENT_ENTRY_MAX_CHARACTERS;
