import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";
import {
  LIBRARY_AGENT_ENTRY_MAX_CHARACTERS,
  MATERIAL_STAGE_IDS,
  SKILL_STAGE_IDS,
  createShortWorkspaceContentRevision,
  type AgentWriteApprovalMode,
  type LibraryAgentDomain,
  type LibraryAgentProfile,
  type LibraryAgentWorkspaceSnapshot,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts";

type LibraryDomain = LibraryAgentDomain;

export type LibraryAgentToolDetails =
  | { kind: "none" }
  | {
      kind: "library-entry-mutation";
      operation: "create";
      domain: LibraryDomain;
      libraryId: string;
      stageId: string;
      title: string;
      text: string;
      baseRevision: string;
      baseProjectRevision?: number;
      summary: string;
    }
  | {
      kind: "library-entry-mutation";
      operation: "edit";
      domain: LibraryDomain;
      libraryId: string;
      entryId: string;
      documentId: string;
      stageId: string;
      title: string;
      text: string;
      baseRevision: string;
      baseProjectRevision?: number;
      summary: string;
    };

export interface BuildLibraryAgentToolsInput {
  workspace: LibraryAgentWorkspaceSnapshot;
  profile: LibraryAgentProfile;
  writeApprovalMode?: AgentWriteApprovalMode;
  attachedSkills?: WorkspaceRuntimeContext["attachedSkills"];
}

export const LIBRARY_AGENT_TOOL_MANIFEST = {
  material: [
    "list_material_entries",
    "read_material_entry",
    "search_material_entries",
    "load_skill",
    "create_material_entry",
    "edit_material_entry"
  ],
  skill: [
    "list_skill_entries",
    "read_skill_entry",
    "search_skill_entries",
    "load_skill",
    "create_skill_entry",
    "edit_skill_entry"
  ]
} as const;

interface LibraryEntryShape {
  id?: string;
  entryId?: string;
  documentId?: string;
  stageId?: string;
  title?: string;
  content?: string;
  body?: string;
  revision?: string;
  truncated?: boolean;
  originalLength?: number;
  readOnly?: boolean;
  sourceLibraryId?: string;
  sourceLibraryTitle?: string;
}

interface LibraryReadableLibraryShape {
  libraryId?: string;
  id?: string;
  title?: string;
  kind?: string;
}

interface LibraryWorkspaceShape {
  id?: string;
  libraryId?: string;
  domain?: LibraryDomain;
  title?: string;
  kind?: string;
  materialKind?: string;
  skillKind?: string;
  readOnly?: boolean;
  isReadOnly?: boolean;
  projectRevision?: number;
  baseProjectRevision?: number;
  omittedEntryCount?: number;
  allowedStageIds?: readonly string[];
  stageIds?: readonly string[];
  groupId?: string;
  groupTitle?: string;
  readableLibraries?: readonly LibraryReadableLibraryShape[];
  entries?: readonly LibraryEntryShape[];
}

interface LibraryProfileShape {
  id?: string;
  domain?: LibraryDomain;
  readOnly?: boolean;
}

interface MutableLibraryEntry {
  entryId: string;
  documentId: string;
  stageId: string;
  title: string;
  content: string;
  revision: string;
  truncated: boolean;
  originalLength?: number;
  readOnly: boolean;
  pendingCreate: boolean;
  sourceLibraryId: string;
  sourceLibraryTitle: string;
  isCurrentLibrary: boolean;
}

const MATERIAL_STAGE_LABELS: Record<string, string> = {
  gimmick: "梗",
  character: "人设",
  pacing: "剧情设计",
  intro: "导语设计",
  plot_refine: "剧情细化",
  draft_excerpt: "优秀正文片段",
  other: "其他素材"
};

const SKILL_STAGE_LABELS: Record<string, string> = {
  character_design: "人物技能",
  plot_design: "剧情技能",
  outline: "大纲技能",
  draft: "正文专家编写技能",
  expert_section_writer: "分节写手技能"
};

const MATERIAL_KIND_STAGE_IDS: Record<string, readonly string[]> = {
  character: ["character"],
  gimmick: ["gimmick"],
  plot: ["pacing", "intro", "plot_refine"],
  draft: ["draft_excerpt"],
  other: ["other"],
  mixed: MATERIAL_STAGE_IDS
};

const SKILL_KIND_STAGE_IDS: Record<string, readonly string[]> = {
  general: SKILL_STAGE_IDS,
  plot: ["character_design", "plot_design", "outline"],
  style: ["draft", "expert_section_writer"],
  other: SKILL_STAGE_IDS
};

const MAX_SEARCH_QUERY_CHARACTERS = 600;
const MIN_SEARCH_CONTEXT_CHARACTERS = 10;
const DEFAULT_SEARCH_CONTEXT_CHARACTERS = 80;
const MAX_SEARCH_CONTEXT_CHARACTERS = 500;
const DEFAULT_SEARCH_MATCHES = 10;
const MAX_SEARCH_MATCHES = 200;
const MAX_REPLACEMENTS = 20;
const MAX_ORIGINAL_FRAGMENT_CHARACTERS = 2_400;
const MAX_NEW_FRAGMENT_CHARACTERS = 20_000;
const MAX_ENTRY_CONTENT_CHARACTERS = LIBRARY_AGENT_ENTRY_MAX_CHARACTERS;

function textResult(
  text: string,
  details: LibraryAgentToolDetails = { kind: "none" }
): AgentToolResult<LibraryAgentToolDetails> {
  return { content: [{ type: "text", text }], details };
}

function primitiveTypeOf(value: unknown): string | undefined {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "boolean") return "boolean";
  return undefined;
}

function sanitizeToolSchemaForGemini(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeToolSchemaForGemini(item));
  }
  if (!value || typeof value !== "object") return value;

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) {
    output[key] = sanitizeToolSchemaForGemini(child);
  }

  for (const unionKey of ["anyOf", "oneOf"]) {
    const union = output[unionKey];
    if (!Array.isArray(union) || union.length === 0) continue;
    const branches = union as Array<Record<string, unknown>>;
    const values = branches.map((branch) => {
      if (
        branch &&
        typeof branch === "object" &&
        Object.prototype.hasOwnProperty.call(branch, "const")
      ) {
        return { matched: true, value: branch.const };
      }
      if (Array.isArray(branch?.enum) && branch.enum.length === 1) {
        return { matched: true, value: branch.enum[0] };
      }
      return { matched: false, value: undefined };
    });
    if (values.every((value) => value.matched)) {
      const enumValues = values.map((value) => value.value);
      delete output[unionKey];
      output.enum = enumValues;
      if (!output.type) {
        const types = [
          ...new Set(enumValues.map(primitiveTypeOf).filter(Boolean))
        ];
        if (types.length === 1) output.type = types[0];
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(output, "const")) {
    output.enum = [output.const];
    if (!output.type) output.type = primitiveTypeOf(output.const);
    delete output.const;
  }
  return output;
}

function defineTool<T extends ReturnType<typeof Type.Object>>(definition: {
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
    parameters: sanitizeToolSchemaForGemini(definition.parameters) as T,
    execute: definition.execute,
    ...(definition.executionMode ? { executionMode: definition.executionMode } : {})
  };
}

function literalUnion(values: readonly string[]) {
  const unique = [...new Set(values)];
  if (unique.length === 1) return Type.Literal(unique[0]!);
  return Type.Union(unique.map((value) => Type.Literal(value)));
}

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function countTextCharacters(value: string): number {
  return value.replace(/\s/gu, "").length;
}

function stageLabel(domain: LibraryDomain, stageId: string): string {
  return (domain === "material" ? MATERIAL_STAGE_LABELS : SKILL_STAGE_LABELS)[stageId] ?? stageId;
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function lineColumnAt(text: string, index: number): { line: number; column: number } {
  const prefix = text.slice(0, index);
  const lines = prefix.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function profileDomain(profile: LibraryAgentProfile): LibraryDomain {
  const value = profile as unknown as LibraryProfileShape;
  if (value.domain === "material" || value.domain === "skill") return value.domain;
  if (value.id?.includes("material")) return "material";
  if (value.id?.includes("skill")) return "skill";
  throw new Error("Library agent profile does not declare a supported domain.");
}

function workspaceShape(workspace: LibraryAgentWorkspaceSnapshot): LibraryWorkspaceShape {
  return workspace as unknown as LibraryWorkspaceShape;
}

function workspaceDomain(workspace: LibraryAgentWorkspaceSnapshot): LibraryDomain {
  const value = workspaceShape(workspace).domain;
  if (value === "material" || value === "skill") return value;
  throw new Error("Library workspace snapshot does not declare a supported domain.");
}

function libraryId(workspace: LibraryAgentWorkspaceSnapshot): string {
  const value = workspaceShape(workspace);
  const id = String(value.libraryId ?? value.id ?? "").trim();
  if (!id) throw new Error("Library workspace snapshot is missing its library id.");
  return id;
}

function libraryTitle(workspace: LibraryAgentWorkspaceSnapshot): string {
  return String(workspaceShape(workspace).title ?? "未命名资料库").trim() || "未命名资料库";
}

function libraryProjectRevision(
  workspace: LibraryAgentWorkspaceSnapshot
): number | undefined {
  const value = workspaceShape(workspace);
  return value.projectRevision ?? value.baseProjectRevision;
}

function omittedEntryCount(workspace: LibraryAgentWorkspaceSnapshot): number {
  return Math.max(0, Number(workspaceShape(workspace).omittedEntryCount ?? 0));
}

function isReadOnly(
  workspace: LibraryAgentWorkspaceSnapshot,
  profile: LibraryAgentProfile
): boolean {
  const value = workspaceShape(workspace);
  const profileValue = profile as unknown as LibraryProfileShape;
  return value.readOnly === true || value.isReadOnly === true || profileValue.readOnly === true;
}

function readableLibraries(
  workspace: LibraryAgentWorkspaceSnapshot
): Array<{ libraryId: string; title: string; kind: string }> {
  const value = workspaceShape(workspace);
  const currentId = libraryId(workspace);
  const currentTitle = libraryTitle(workspace);
  const currentKind = String(
    value.kind ??
      (workspaceDomain(workspace) === "material"
        ? value.materialKind
        : value.skillKind) ??
      "unknown"
  );
  const listed = (value.readableLibraries ?? [])
    .map((library) => ({
      libraryId: String(library.libraryId ?? library.id ?? "").trim(),
      title: String(library.title ?? "").trim() || "未命名资料库",
      kind: String(library.kind ?? "").trim() || "unknown"
    }))
    .filter((library) => library.libraryId);
  if (!listed.length) {
    return [{ libraryId: currentId, title: currentTitle, kind: currentKind }];
  }
  if (!listed.some((library) => library.libraryId === currentId)) {
    return [
      { libraryId: currentId, title: currentTitle, kind: currentKind },
      ...listed
    ];
  }
  return listed;
}

function allowedStageIds(
  workspace: LibraryAgentWorkspaceSnapshot,
  domain: LibraryDomain
): string[] {
  const value = workspaceShape(workspace);
  const explicit = value.allowedStageIds ?? value.stageIds;
  if (explicit?.length) return [...new Set(explicit.map(String).filter(Boolean))];
  const kind = String(
    value.kind ?? (domain === "material" ? value.materialKind : value.skillKind) ?? ""
  );
  const byKind = domain === "material" ? MATERIAL_KIND_STAGE_IDS : SKILL_KIND_STAGE_IDS;
  return [...(byKind[kind] ?? (domain === "material" ? MATERIAL_STAGE_IDS : SKILL_STAGE_IDS))];
}

function mutableEntries(
  workspace: LibraryAgentWorkspaceSnapshot,
  libraryReadOnly: boolean
): MutableLibraryEntry[] {
  const currentLibraryId = libraryId(workspace);
  const currentLibraryTitle = libraryTitle(workspace);
  return (workspaceShape(workspace).entries ?? []).map((entry, index) => {
    const entryId = String(entry.entryId ?? entry.id ?? `entry-${index + 1}`);
    const content = String(entry.content ?? entry.body ?? "");
    const sourceLibraryId = String(entry.sourceLibraryId ?? currentLibraryId).trim() || currentLibraryId;
    const sourceLibraryTitle =
      String(entry.sourceLibraryTitle ?? "").trim() ||
      (sourceLibraryId === currentLibraryId
        ? currentLibraryTitle
        : sourceLibraryId);
    return {
      entryId,
      documentId: String(entry.documentId ?? entryId),
      stageId: String(entry.stageId ?? ""),
      title: String(entry.title ?? "").trim() || "未命名条目",
      content,
      revision: String(entry.revision ?? createShortWorkspaceContentRevision(content)),
      truncated: entry.truncated === true,
      ...(entry.originalLength === undefined
        ? {}
        : { originalLength: entry.originalLength }),
      readOnly:
        libraryReadOnly ||
        entry.readOnly === true ||
        sourceLibraryId !== currentLibraryId,
      pendingCreate: false,
      sourceLibraryId,
      sourceLibraryTitle,
      isCurrentLibrary: sourceLibraryId === currentLibraryId
    };
  });
}

function formatEntryChoice(domain: LibraryDomain, entry: MutableLibraryEntry): string {
  const libraryPart = entry.isCurrentLibrary
    ? ""
    : `｜来源库：${entry.sourceLibraryTitle}（${entry.sourceLibraryId}）`;
  return `- ${entry.title}｜${stageLabel(domain, entry.stageId)}（${entry.stageId}）${libraryPart}｜entry_id=${entry.entryId}`;
}

/** Catalog 原生条目 ID；跨库快照里可能是 `libraryId/entryId`。 */
function catalogEntryId(entry: MutableLibraryEntry): string {
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
function entryIdMatches(entry: MutableLibraryEntry, requested: string): boolean {
  if (entry.entryId === requested) return true;
  const nativeId = catalogEntryId(entry);
  if (nativeId === requested) return true;
  return `${entry.sourceLibraryId}/${nativeId}` === requested;
}

function resolveEntry(
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
  const matches = scoped.filter((entry) => normalizedName(entry.title) === name);
  if (matches.length === 1) return { entry: matches[0]! };
  if (matches.length > 1) {
    return {
      error: [
        `找到 ${matches.length} 个同名条目「${name}」，请补充 library_id、stage_id 或 entry_id：`,
        ...matches.map((entry) => formatEntryChoice(domain, entry))
      ].join("\n")
    };
  }
  const nearby = scoped.filter((entry) => normalizedName(entry.title).includes(name));
  return nearby.length
    ? {
        error: [
          `未找到标题完全等于「${name}」的条目。相近条目：`,
          ...nearby.slice(0, 10).map((entry) => formatEntryChoice(domain, entry))
        ].join("\n")
      }
    : {
        error: `未找到名为「${name}」的条目，请先调用 list_${domain}_entries。`
      };
}

function approvalSummary(
  summary: string,
  approvalMode: AgentWriteApprovalMode | undefined
): string {
  return approvalMode === "auto-approve"
    ? summary.replace("，等待用户审阅。", "，将在本轮完成后自动批准并保存。")
    : summary;
}

function mutationResult(
  input: BuildLibraryAgentToolsInput,
  operation: "create" | "edit",
  entry: MutableLibraryEntry,
  baseRevision: string,
  summary: string
): AgentToolResult<LibraryAgentToolDetails> {
  const finalizedSummary = approvalSummary(summary, input.writeApprovalMode);
  const projectRevision = libraryProjectRevision(input.workspace);
  const common = {
    kind: "library-entry-mutation",
    domain: workspaceDomain(input.workspace),
    libraryId: libraryId(input.workspace),
    stageId: entry.stageId,
    title: entry.title,
    text: entry.content,
    baseRevision,
    ...(projectRevision === undefined ? {} : { baseProjectRevision: projectRevision }),
    summary: finalizedSummary
  } as const;
  return operation === "create"
    ? textResult(finalizedSummary, { ...common, operation })
    : textResult(finalizedSummary, {
        ...common,
        operation,
        entryId: entry.entryId,
        documentId: entry.documentId
      });
}

function buildListTool(
  input: BuildLibraryAgentToolsInput,
  domain: LibraryDomain,
  entries: MutableLibraryEntry[],
  stages: readonly string[],
  libraries: readonly { libraryId: string; title: string }[]
): AgentTool {
  const noun = domain === "material" ? "素材" : "技能";
  const libraryIds = libraries.map((library) => library.libraryId);
  const withPeers = libraries.length > 1;
  return defineTool({
    name: `list_${domain}_entries`,
    label: `列出${noun}条目`,
    description: withPeers
      ? `列出当前${noun}库及同分组其它成员库中的条目名称、栏目、来源库、entry_id 和字数；可用 library_id 只看某一个成员库。写入仍只针对当前库。`
      : `列出当前${noun}库中的条目名称、栏目、entry_id 和字数；不会读取其它资料库。`,
    parameters: Type.Object({
      stage_id: Type.Optional(literalUnion(stages)),
      ...(withPeers
        ? { library_id: Type.Optional(literalUnion(libraryIds)) }
        : {})
    }),
    execute: async (_toolCallId, params) => {
      const stageId = String(params.stage_id ?? "");
      const libraryIdFilter = String(params.library_id ?? "").trim();
      const scoped = entries.filter((entry) => {
        if (stageId && entry.stageId !== stageId) return false;
        if (libraryIdFilter && entry.sourceLibraryId !== libraryIdFilter) return false;
        return true;
      });
      const omitted = omittedEntryCount(input.workspace);
      const group = workspaceShape(input.workspace);
      const groupNote =
        group.groupTitle && withPeers
          ? `｜分组：《${group.groupTitle}》｜可读 ${libraries.length} 个成员库`
          : "";
      const header = `${noun}库：《${libraryTitle(input.workspace)}》｜当前快照 ${scoped.length} 条${groupNote}${omitted ? `｜另有 ${omitted} 条因容量限制未载入` : ""}`;
      if (!scoped.length) return textResult(`${header}\n\n暂无${noun}条目。`);
      return textResult(
        [
          header,
          "",
          ...scoped.map((entry, index) => {
            const source =
              withPeers || !entry.isCurrentLibrary
                ? `｜来源库：${entry.sourceLibraryTitle}（${entry.sourceLibraryId}）${entry.isCurrentLibrary ? "｜当前库" : "｜只读"}`
                : "";
            return `${index + 1}. ${entry.title}｜栏目：${stageLabel(domain, entry.stageId)}（${entry.stageId}）${source}｜entry_id=${entry.entryId}｜字数=${countTextCharacters(entry.content)}${entry.truncated ? "｜正文已截断" : ""}${entry.readOnly && entry.isCurrentLibrary ? "｜只读" : ""}`;
          })
        ].join("\n")
      );
    }
  });
}

function buildReadTool(
  input: BuildLibraryAgentToolsInput,
  domain: LibraryDomain,
  entries: MutableLibraryEntry[],
  stages: readonly string[],
  libraries: readonly { libraryId: string; title: string }[],
  accessedEntryIds: Set<string>
): AgentTool {
  const noun = domain === "material" ? "素材" : "技能";
  const libraryIds = libraries.map((library) => library.libraryId);
  const withPeers = libraries.length > 1;
  return defineTool({
    name: `read_${domain}_entry`,
    label: `读取${noun}条目`,
    description: withPeers
      ? `按 entry_id 或精确标题读取当前${noun}库或同分组其它成员库中的一个条目全文；可用 Catalog 裸 entry_id，跨库时建议同时传 library_id；也兼容 list 返回的 libraryId/entryId。`
      : `按 entry_id 或精确标题读取当前${noun}库中的一个条目全文；重名时必须补充栏目或 entry_id。`,
    parameters: Type.Object({
      entry_id: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
      name: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      stage_id: Type.Optional(literalUnion(stages)),
      ...(withPeers
        ? { library_id: Type.Optional(literalUnion(libraryIds)) }
        : {})
    }),
    execute: async (_toolCallId, params) => {
      const resolved = resolveEntry(entries, domain, params);
      if ("error" in resolved) {
        const omitted = omittedEntryCount(input.workspace);
        return textResult(
          `${resolved.error}${omitted ? `\n注意：当前快照另有 ${omitted} 条因容量限制未载入。` : ""}`
        );
      }
      const entry = resolved.entry;
      accessedEntryIds.add(entry.entryId);
      const truncation = entry.truncated
        ? `\n\n注意：本轮只提供前 ${entry.content.length.toLocaleString("zh-CN")} 个字符，原文共 ${entry.originalLength?.toLocaleString("zh-CN") ?? "更多"} 个字符；该条目不可由智能体写入。`
        : "";
      const peerNote = entry.isCurrentLibrary
        ? ""
        : `\n来源：同分组成员库《${entry.sourceLibraryTitle}》（只读）`;
      return textResult(
        [
          `${noun}库：《${entry.sourceLibraryTitle}》${entry.isCurrentLibrary ? "（当前库）" : "（同分组只读）"}`,
          `条目：${entry.title}`,
          `栏目：${stageLabel(domain, entry.stageId)}（${entry.stageId}）`,
          `entry_id：${entry.entryId}`,
          `document_id：${entry.documentId}`,
          `当前字数：${countTextCharacters(entry.content).toLocaleString("zh-CN")}`,
          `版本：${entry.revision}${peerNote}`,
          "",
          entry.content || "该条目暂无正文。"
        ].join("\n") + truncation
      );
    }
  });
}

function buildSearchTool(
  input: BuildLibraryAgentToolsInput,
  domain: LibraryDomain,
  entries: MutableLibraryEntry[],
  stages: readonly string[],
  libraries: readonly { libraryId: string; title: string }[],
  accessedEntryIds: Set<string>
): AgentTool {
  const noun = domain === "material" ? "素材" : "技能";
  const libraryIds = libraries.map((library) => library.libraryId);
  const withPeers = libraries.length > 1;
  return defineTool({
    name: `search_${domain}_entries`,
    label: `搜索${noun}条目`,
    description: withPeers
      ? `在当前${noun}库及同分组其它成员库的标题和正文中搜索文本，只返回命中位置与少量上下文；可用 library_id 限定范围。`
      : `在当前${noun}库的标题和正文中搜索文本，只返回命中位置与少量上下文。`,
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: MAX_SEARCH_QUERY_CHARACTERS }),
      stage_id: Type.Optional(literalUnion(stages)),
      ...(withPeers
        ? { library_id: Type.Optional(literalUnion(libraryIds)) }
        : {}),
      max_matches: Type.Optional(
        Type.Integer({ minimum: 1, maximum: MAX_SEARCH_MATCHES })
      ),
      context_chars: Type.Optional(
        Type.Integer({
          minimum: MIN_SEARCH_CONTEXT_CHARACTERS,
          maximum: MAX_SEARCH_CONTEXT_CHARACTERS
        })
      )
    }),
    execute: async (_toolCallId, params) => {
      const query = String(params.query ?? "").trim();
      if (!query) return textResult("搜索文本不能为空。");
      const stageId = String(params.stage_id ?? "");
      const libraryIdFilter = String(params.library_id ?? "").trim();
      const scoped = entries.filter((entry) => {
        if (stageId && entry.stageId !== stageId) return false;
        if (libraryIdFilter && entry.sourceLibraryId !== libraryIdFilter) return false;
        return true;
      });
      const maxMatches = clampInteger(
        params.max_matches,
        DEFAULT_SEARCH_MATCHES,
        1,
        MAX_SEARCH_MATCHES
      );
      const contextCharacters = clampInteger(
        params.context_chars,
        DEFAULT_SEARCH_CONTEXT_CHARACTERS,
        MIN_SEARCH_CONTEXT_CHARACTERS,
        MAX_SEARCH_CONTEXT_CHARACTERS
      );
      const output = [
        `${noun}库：《${libraryTitle(input.workspace)}》${withPeers ? "及同分组成员库" : ""}`,
        `搜索：${query}`
      ];
      const normalizedQuery = query.toLocaleLowerCase();
      let total = 0;
      for (const entry of scoped) {
        const titleHit = entry.title.toLocaleLowerCase().includes(normalizedQuery);
        const bodyLower = entry.content.toLocaleLowerCase();
        const matches: number[] = [];
        let cursor = 0;
        while (matches.length + total < maxMatches) {
          const index = bodyLower.indexOf(normalizedQuery, cursor);
          if (index < 0) break;
          matches.push(index);
          cursor = index + Math.max(1, query.length);
        }
        if (!titleHit && matches.length === 0) continue;
        accessedEntryIds.add(entry.entryId);
        const source =
          withPeers || !entry.isCurrentLibrary
            ? `｜${entry.sourceLibraryTitle}`
            : "";
        output.push(
          "",
          `【${stageLabel(domain, entry.stageId)}】${entry.title}（entry_id=${entry.entryId}）${source}${titleHit ? "｜标题命中" : ""}`
        );
        for (const [index, start] of matches.entries()) {
          const end = start + query.length;
          const contextStart = Math.max(0, start - contextCharacters);
          const contextEnd = Math.min(entry.content.length, end + contextCharacters);
          const location = lineColumnAt(entry.content, start);
          output.push(
            `${index + 1}. L${location.line}:C${location.column} chars ${start}-${end}`,
            `${contextStart > 0 ? "…" : ""}${entry.content.slice(contextStart, contextEnd)}${contextEnd < entry.content.length ? "…" : ""}`
          );
          total += 1;
        }
        if (entry.truncated) output.push("注意：该条目仅搜索了本轮可见的截断快照。");
        if (total >= maxMatches) break;
      }
      if (output.length === 2) {
        const hasTruncatedEntries = scoped.some((entry) => entry.truncated);
        const omitted = omittedEntryCount(input.workspace);
        return textResult(
          `未在当前${noun}库${withPeers ? "及同分组成员库" : ""}${hasTruncatedEntries || omitted ? "可见快照" : ""}中找到「${query}」。${hasTruncatedEntries ? "存在截断条目，不能据此判断完整原文没有匹配。" : ""}${omitted ? `另有 ${omitted} 条因容量限制未载入。` : ""}`
        );
      }
      const omitted = omittedEntryCount(input.workspace);
      if (omitted) output.push(`注意：另有 ${omitted} 条因容量限制未载入，未参与搜索。`);
      output.push("", `已返回 ${total} 处正文匹配。`);
      return textResult(output.join("\n"));
    }
  });
}

function buildCreateTool(
  input: BuildLibraryAgentToolsInput,
  domain: LibraryDomain,
  entries: MutableLibraryEntry[],
  stages: readonly string[],
  accessedEntryIds: Set<string>
): AgentTool {
  const noun = domain === "material" ? "素材" : "技能";
  const currentLibraryId = libraryId(input.workspace);
  return defineTool({
    name: `create_${domain}_entry`,
    label: `创建${noun}条目`,
    description: `在当前${noun}库的允许栏目中创建一个条目；只提交待审阅变更，不会直接绕过客户端保存。即使同分组其它成员库可读，也不会写入那些库。`,
    parameters: Type.Object({
      stage_id: literalUnion(stages),
      title: Type.String({ minLength: 1, maxLength: 256 }),
      body: Type.Optional(Type.String({ maxLength: MAX_ENTRY_CONTENT_CHARACTERS }))
    }),
    execute: async (toolCallId, params) => {
      const stageId = String(params.stage_id ?? "");
      if (!stages.includes(stageId)) {
        return textResult(`未创建：当前${noun}库不允许写入栏目 ${stageId}。`);
      }
      const title = String(params.title ?? "").trim();
      if (!title) return textResult("未创建：title 不能为空。");
      if (
        entries.some(
          (entry) =>
            entry.isCurrentLibrary &&
            entry.stageId === stageId &&
            normalizedName(entry.title) === normalizedName(title)
        )
      ) {
        return textResult(`未创建：栏目「${stageLabel(domain, stageId)}」中已存在同名条目「${title}」。`);
      }
      const content = String(params.body ?? "").trim();
      const safeCallId = toolCallId.replace(/[^A-Za-z0-9._-]/gu, "-").slice(0, 180);
      const entry: MutableLibraryEntry = {
        entryId: `pending:${safeCallId || "entry"}`,
        documentId: `pending:${domain}:${safeCallId || "entry"}`,
        stageId,
        title,
        content,
        revision: createShortWorkspaceContentRevision(content),
        truncated: false,
        readOnly: false,
        pendingCreate: true,
        sourceLibraryId: currentLibraryId,
        sourceLibraryTitle: libraryTitle(input.workspace),
        isCurrentLibrary: true
      };
      entries.push(entry);
      accessedEntryIds.add(entry.entryId);
      return mutationResult(
        input,
        "create",
        entry,
        createShortWorkspaceContentRevision(""),
        `已生成创建${noun}条目「${title}」的变更，等待用户审阅。`
      );
    },
    executionMode: "sequential"
  });
}

interface TextReplacement {
  original_text: string;
  new_text: string;
}

function replaceFragments(
  current: string,
  replacements: readonly TextReplacement[]
): { text?: string; count: number; error?: string } {
  if (!replacements.length) return { count: 0, error: "replacements 不能为空。" };
  let next = current;
  let count = 0;
  for (const [index, replacement] of replacements.entries()) {
    const originalText = String(replacement.original_text ?? "");
    if (!originalText) {
      return { count, error: `第 ${index + 1} 个 original_text 不能为空。` };
    }
    const first = next.indexOf(originalText);
    if (first < 0) {
      return {
        count,
        error: `没有找到第 ${index + 1} 个原文片段：${originalText.slice(0, 80)}`
      };
    }
    if (next.indexOf(originalText, first + originalText.length) >= 0) {
      return {
        count,
        error: `第 ${index + 1} 个原文片段出现多次，请提供更长且唯一的上下文：${originalText.slice(0, 80)}`
      };
    }
    next = `${next.slice(0, first)}${replacement.new_text}${next.slice(first + originalText.length)}`;
    count += 1;
  }
  return { text: next, count };
}

function buildEditTool(
  input: BuildLibraryAgentToolsInput,
  domain: LibraryDomain,
  entries: MutableLibraryEntry[],
  stages: readonly string[],
  accessedEntryIds: Set<string>
): AgentTool {
  const noun = domain === "material" ? "素材" : "技能";
  return defineTool({
    name: `edit_${domain}_entry`,
    label: `编辑${noun}条目`,
    description: `编辑当前${noun}库中的一个条目。必须先 read/search；局部修改用 replace_fragments，追加用 append，明确整篇覆盖才用 replace。`,
    parameters: Type.Object({
      entry_id: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
      name: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      stage_id: Type.Optional(literalUnion(stages)),
      title: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      mode: Type.Union([
        Type.Literal("replace_fragments"),
        Type.Literal("append"),
        Type.Literal("replace")
      ]),
      body: Type.Optional(Type.String({ maxLength: MAX_ENTRY_CONTENT_CHARACTERS })),
      allow_overwrite_existing: Type.Optional(Type.Boolean()),
      replacements: Type.Optional(
        Type.Array(
          Type.Object({
            original_text: Type.String({
              minLength: 1,
              maxLength: MAX_ORIGINAL_FRAGMENT_CHARACTERS
            }),
            new_text: Type.String({ maxLength: MAX_NEW_FRAGMENT_CHARACTERS })
          }),
          { minItems: 1, maxItems: MAX_REPLACEMENTS }
        )
      )
    }),
    execute: async (_toolCallId, params) => {
      const resolved = resolveEntry(entries, domain, params);
      if ("error" in resolved) return textResult(resolved.error);
      const entry = resolved.entry;
      if (!accessedEntryIds.has(entry.entryId)) {
        return textResult(
          `未修改：请先调用 read_${domain}_entry 或 search_${domain}_entries 读取并确认「${entry.title}」的当前内容。`
        );
      }
      if (entry.pendingCreate) {
        return textResult(
          `未修改：「${entry.title}」已在本轮提交新建变更。请等待该变更保存后再编辑，或在 create_${domain}_entry 时一次提供最终正文。`
        );
      }
      if (entry.readOnly) {
        return textResult(
          entry.isCurrentLibrary
            ? `未修改：「${entry.title}」属于只读资料库。`
            : `未修改：「${entry.title}」来自同分组其它库《${entry.sourceLibraryTitle}》，只读；请先切换到该库再编辑。`
        );
      }
      if (entry.truncated) {
        return textResult(
          `未修改：「${entry.title}」超过本轮安全快照上限，无法在看不到完整原文时写入。`
        );
      }

      const baseRevision = entry.revision;
      const previousTitle = entry.title;
      const previousContent = entry.content;
      const nextTitle = params.title === undefined ? entry.title : String(params.title).trim();
      if (!nextTitle) return textResult("未修改：title 不能为空。");
      const mode = String(params.mode) as "replace_fragments" | "append" | "replace";
      let nextContent = entry.content;
      let changeDescription = "更新";
      if (mode === "replace_fragments") {
        const replacements = (params.replacements ?? []) as TextReplacement[];
        const result = replaceFragments(entry.content, replacements);
        if (result.error || result.text === undefined) {
          return textResult(`未修改：${result.error ?? "未知错误"}`);
        }
        nextContent = result.text;
        changeDescription = `${result.count} 处局部替换`;
      } else if (params.body !== undefined) {
        const body = String(params.body).trim();
        if (mode === "append") {
          if (!body) return textResult("未修改：append 模式的 body 不能为空。");
          const separator = entry.content.length === 0
            ? ""
            : entry.content.endsWith("\n")
              ? "\n"
              : "\n\n";
          nextContent = `${entry.content}${separator}${body}`;
          changeDescription = "正文追加";
        } else {
          if (entry.content.trim() && params.allow_overwrite_existing !== true) {
            return textResult(
              "未覆盖：该条目已有正文。只有用户明确要求覆盖全文时，才可设置 allow_overwrite_existing=true；普通修改请使用 replace_fragments。"
            );
          }
          nextContent = body;
          changeDescription = "全文覆盖";
        }
      } else if (nextTitle === entry.title) {
        return textResult(`未修改：${mode} 模式需要提供 body，或通过 title 修改标题。`);
      }

      if (nextTitle === previousTitle && nextContent === previousContent) {
        return textResult("文本和标题没有实际变化，无需提交修改。");
      }
      if (nextContent.length > MAX_ENTRY_CONTENT_CHARACTERS) {
        return textResult(
          `未修改：变更后正文共 ${nextContent.length.toLocaleString("zh-CN")} 个字符，超过单条资料库快照上限 ${MAX_ENTRY_CONTENT_CHARACTERS.toLocaleString("zh-CN")}。`
        );
      }
      if (
        nextTitle !== previousTitle &&
        entries.some(
          (candidate) =>
            candidate !== entry &&
            candidate.isCurrentLibrary &&
            candidate.stageId === entry.stageId &&
            normalizedName(candidate.title) === normalizedName(nextTitle)
        )
      ) {
        return textResult(
          `未修改：栏目「${stageLabel(domain, entry.stageId)}」中已存在同名条目「${nextTitle}」。`
        );
      }
      entry.title = nextTitle;
      entry.content = nextContent;
      entry.revision = createShortWorkspaceContentRevision(nextContent);
      return mutationResult(
        input,
        "edit",
        entry,
        baseRevision,
        `已生成${noun}条目「${entry.title}」的${changeDescription}变更，等待用户审阅。`
      );
    },
    executionMode: "sequential"
  });
}

function buildLoadSkillTool(input: BuildLibraryAgentToolsInput): AgentTool {
  const configuredNames = new Set(input.profile.readAccess.skills.map((skill) => skill.name));
  return defineTool({
    name: "load_skill",
    label: "加载技能",
    description:
      "按名称加载本轮显式附加、且属于当前资料库智能体配置中的方法正文。技能是方法，不会自动成为资料库事实。",
    parameters: Type.Object({ name: Type.String({ minLength: 1, maxLength: 240 }) }),
    execute: async (_toolCallId, params) => {
      const name = String(params.name ?? "").trim();
      const found = (input.attachedSkills ?? []).find(
        (item) => item.title === name && configuredNames.has(name)
      );
      return textResult(
        found
          ? `【技能：${found.title}】\n\n${found.content}`
          : "没有找到可读取的同名已附加技能。"
      );
    }
  });
}

export function buildLibraryAgentTools(
  input: BuildLibraryAgentToolsInput
): AgentTool[] {
  const domain = workspaceDomain(input.workspace);
  if (profileDomain(input.profile) !== domain) {
    throw new Error("Library agent profile domain does not match the workspace snapshot.");
  }
  const readOnly = isReadOnly(input.workspace, input.profile);
  const writeStages = allowedStageIds(input.workspace, domain);
  if (!writeStages.length) {
    throw new Error("Library workspace snapshot does not expose any allowed stages.");
  }
  const libraries = readableLibraries(input.workspace);
  const entries = mutableEntries(input.workspace, readOnly);
  const readStages = [
    ...new Set(
      [
        ...writeStages,
        ...entries.map((entry) => entry.stageId).filter(Boolean)
      ]
    )
  ];
  const accessedEntryIds = new Set<string>();
  const readTools = [
    buildListTool(input, domain, entries, readStages, libraries),
    buildReadTool(input, domain, entries, readStages, libraries, accessedEntryIds),
    buildSearchTool(input, domain, entries, readStages, libraries, accessedEntryIds),
    buildLoadSkillTool(input)
  ];
  return readOnly
    ? readTools
    : [
        ...readTools,
        buildCreateTool(input, domain, entries, writeStages, accessedEntryIds),
        buildEditTool(input, domain, entries, readStages, accessedEntryIds)
      ];
}

export function isLibraryAgentToolDetails(value: unknown): value is LibraryAgentToolDetails {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "none" || kind === "library-entry-mutation";
}
