import { createHash, randomBytes } from "node:crypto";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  StringEnum,
  Type,
  type Static,
  type TSchema
} from "@earendil-works/pi-ai";
import {
  MATERIAL_KINDS,
  MYSTERY_STAGES,
  MysteryPreviewOperationsResultSchema,
  MysteryReadDocumentResultSchema,
  MysterySearchResultSchema,
  MysteryWorkspaceIndexResultSchema,
  MysteryWorkspaceOperationError,
  SKILL_KINDS,
  createEnvelope,
  mysteryCharCount,
  mysteryDocumentRelativePath,
  mysteryDocumentTargetKey,
  mysteryDocumentTitle,
  mysteryTextRevision,
  previewMysteryWorkspaceOperations,
  type AgentWriteApprovalMode,
  type CommandEnvelope,
  type CommandResult,
  type MysteryAgentProfile,
  type MysteryBookManifest,
  type MysteryDocumentTarget,
  type MysteryDocumentWrite,
  type MysteryFileChange,
  type MysteryOperation,
  type MysteryOperationBatch,
  type MysteryWorkspaceIndexSnapshot,
  type MysteryWorkspaceRuntimeContext,
  type PromptLocale
} from "@deepwrite/contracts";
import { buildAskUserQuestionTool } from "../ask-user-question-tool";
import {
  type AttachedMaterial,
  MATERIAL_QUERY_DESCRIPTION,
  queryAttachedMaterials
} from "../material-catalog";
import type { MaterialQueryRunner } from "../material-query-runtime";
import { piStrictToolSampling } from "../pi-tool-schema";
import {
  overwriteModeParameter,
  REPLACE_ALL_OVERWRITE_MODE,
  WRITING_EDIT_OVERWRITE_DESCRIPTION
} from "../writing-edit-guidance";
import {
  LOAD_SKILL_NAME_PARAMETER,
  LOAD_SKILL_TOOL_DESCRIPTION,
  formatLoadSkillToolResult,
  resolveAttachedSkill,
  type LoadSkillCandidate
} from "../resolve-attached-skill";
import type { AgentUserInputRequester } from "../runtime-types";
import { WRITING_EDIT_OVERWRITE_RECOVERY } from "../writing-edit-guidance";
import { resolveWritingEditSummary } from "../writing-edit-summary";
import { AUTO_APPROVE_PROPOSAL_SUBMITTED } from "../write-approval";

export type MysteryQueryCommandEnvelope = Extract<
  CommandEnvelope,
  {
    type:
      | "mystery.getWorkspaceIndex"
      | "mystery.readDocument"
      | "mystery.search"
      | "mystery.previewOperations";
  }
>;

export type MysteryCommandExecutor = (
  command: MysteryQueryCommandEnvelope,
  signal?: AbortSignal
) => Promise<CommandResult>;

export type MysteryAgentToolDetails =
  | { kind: "none" }
  | {
      kind: "mystery-mutation-proposal";
      bookId: string;
      agentId: MysteryAgentProfile["id"];
      summary: string;
      batch: MysteryOperationBatch;
      fileChanges: MysteryFileChange[];
      structureChanges: string[];
    };

export function isMysteryAgentToolDetails(
  value: unknown
): value is MysteryAgentToolDetails {
  return (
    value !== null &&
    typeof value === "object" &&
    "kind" in value &&
    (value.kind === "none" || value.kind === "mystery-mutation-proposal")
  );
}

export interface OverlayDocument {
  target: MysteryDocumentTarget;
  content: string;
  revision: string;
}

export interface MysteryWorkspaceToolSharedState {
  proposalOverlay: {
    documents: Map<string, OverlayDocument>;
    batches: MysteryOperationBatch[];
    clear(): void;
  };
}

export function createMysteryWorkspaceToolSharedState(): MysteryWorkspaceToolSharedState {
  const documents = new Map<string, OverlayDocument>();
  const batches: MysteryOperationBatch[] = [];
  return {
    proposalOverlay: {
      documents,
      batches,
      clear() {
        documents.clear();
        batches.length = 0;
      }
    }
  };
}

export interface BuildMysteryWorkspaceToolsInput {
  promptLocale?: PromptLocale | undefined;
  workspace: MysteryWorkspaceRuntimeContext;
  profile: MysteryAgentProfile;
  sessionId: string;
  runId: string;
  writeApprovalMode: AgentWriteApprovalMode;
  attachedSkills?: readonly LoadSkillCandidate[] | undefined;
  attachedMaterials?: readonly AttachedMaterial[] | undefined;
  queryMaterials?: MaterialQueryRunner | undefined;
  executor?: MysteryCommandExecutor | undefined;
  requestUserInput: AgentUserInputRequester;
  includeAskUserQuestion?: boolean | undefined;
  onContextCompacted?:
    | ((listener: (removedToolCallIds?: readonly string[]) => void) => void)
    | undefined;
  sharedState?: MysteryWorkspaceToolSharedState | undefined;
}

function textResult(
  text: string,
  details: MysteryAgentToolDetails = { kind: "none" }
): AgentToolResult<MysteryAgentToolDetails> {
  return { content: [{ type: "text", text }], details };
}

function defineMysteryTool<T extends TSchema>(definition: {
  name: string;
  label: string;
  description: string;
  parameters: T;
  execute: (
    toolCallId: string,
    params: Static<T>,
    signal?: AbortSignal
  ) => Promise<AgentToolResult<MysteryAgentToolDetails>>;
}): AgentTool<T, MysteryAgentToolDetails> {
  return {
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: definition.parameters,
    ...piStrictToolSampling(definition.parameters),
    execute: definition.execute
  };
}

function indexToManifestProxy(
  index: MysteryWorkspaceIndexSnapshot
): MysteryBookManifest {
  return {
    kind: "deepwrite.mystery-book",
    schemaVersion: 1,
    id: index.bookId,
    title: index.title,
    genre: index.genre,
    status: index.status,
    boardSpec: index.boardSpec,
    linkedMaterialIds: [],
    linkedSkillIds: [],
    truthDocuments: index.truthDocuments.map(
      ({ id, title, order, builtin }) => ({
        id,
        title,
        order,
        builtin
      })
    ),
    roles: index.roles.map(({ id, name, tag, order }) => ({
      id,
      name,
      tag,
      order
    })),
    acts: [...index.acts],
    clueRounds: index.clueRounds.map(({ id, title, order }) => ({
      id,
      title,
      order
    })),
    revision: index.revision,
    createdAt: index.updatedAt,
    updatedAt: index.updatedAt
  };
}

function normalizeMysteryId(prefix: string, rawId?: string): string {
  const cleaned = rawId?.trim();
  if (cleaned) return cleaned;
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}

export function resolveMysteryDocumentTarget(params: {
  kind: string;
  id?: string;
  role_id?: string;
  act_id?: string;
  document?: string;
}): MysteryDocumentTarget {
  const { kind } = params;
  const id = params.id?.trim();
  const roleId = params.role_id?.trim();
  const actId = params.act_id?.trim();
  const document = params.document?.trim();

  switch (kind) {
    case "agents_md":
      return { kind: "agents_md" };
    case "truth_doc": {
      const docId = id;
      if (!docId) {
        throw new Error(
          '读取或修改 truth_doc 时必须提供 id（如 "overview"、"core_truth"、"timeline_dispatch" 或自定义真相文档 id）。'
        );
      }
      return { kind: "truth_doc", docId };
    }
    case "character_relations":
      return { kind: "character_relations" };
    case "role": {
      const resolvedRole = roleId ?? id;
      if (!resolvedRole) {
        throw new Error(
          '读取或修改 role 时必须提供 role_id（或 id），以及 document="profile" 或 "pitch"。'
        );
      }
      if (document !== "profile" && document !== "pitch") {
        throw new Error(
          `role 目标必须指定 document="profile"（上帝底牌）或 document="pitch"（公开选角页），当前收到：${document ?? "空"}。`
        );
      }
      return { kind: "role", roleId: resolvedRole, document };
    }
    case "player_act": {
      if (!roleId || !actId) {
        throw new Error(
          '读取或修改 player_act 时必须同时提供 role_id 与 act_id，以及 document="brief" 或 "body"。'
        );
      }
      if (document !== "brief" && document !== "body") {
        throw new Error(
          `player_act 必须指定 document="brief"（视角任务卡）或 document="body"（玩家人物本正文），当前收到：${document ?? "空"}。`
        );
      }
      return { kind: "player_act", roleId, actId, document };
    }
    case "clue_round": {
      if (!id) {
        throw new Error("操作 clue_round 时必须提供 id（搜证轮次 roundId）。");
      }
      return { kind: "clue_round", roundId: id };
    }
    case "public_doc": {
      if (id !== "public_openings" && id !== "endings") {
        throw new Error(
          `public_doc 的 id 必须是 "public_openings" 或 "endings"，当前收到：${id ?? "空"}。`
        );
      }
      return { kind: "public_doc", docId: id };
    }
    case "dm_manual":
      return { kind: "dm_manual" };
    default:
      throw new Error(
        `不支持的目标类型 kind=${kind}。请使用 truth_doc、character_relations、role、player_act、clue_round、public_doc、dm_manual 或 agents_md。`
      );
  }
}

export function applyReplacements(
  source: string,
  replacements: readonly { original_text: string; new_text: string }[]
): { content: string } | { failure: string } {
  let content = source;
  for (const item of replacements) {
    const first = content.indexOf(item.original_text);
    const second =
      first < 0
        ? -1
        : content.indexOf(
            item.original_text,
            first + item.original_text.length
          );
    if (first < 0 || second >= 0) {
      return {
        failure: `未替换：原文片段必须在目标文本中唯一精确存在：${item.original_text.slice(0, 80)}`
      };
    }
    content =
      content.slice(0, first) +
      item.new_text +
      content.slice(first + item.original_text.length);
  }
  return { content };
}

export function createMysteryToolContext(
  input: BuildMysteryWorkspaceToolsInput
) {
  const { workspace, profile } = input;
  if (
    profile.workspaceType !== "mystery" ||
    profile.id !== workspace.activeAgentId
  ) {
    throw new Error(
      "Mystery agent profile does not match the active workspace agent."
    );
  }

  const sharedState =
    input.sharedState ?? createMysteryWorkspaceToolSharedState();
  const fullyRead = new Map<string, { content: string; revision: string }>();

  input.onContextCompacted?.(() => {
    fullyRead.clear();
  });

  const commandContext = {
    sessionId: input.sessionId,
    runId: input.runId,
    resourceId: workspace.bookId
  };

  const execute = async <TResult>(
    command: MysteryQueryCommandEnvelope,
    parse: (payload: unknown) => TResult,
    signal?: AbortSignal
  ): Promise<TResult> => {
    if (signal?.aborted) {
      const abortErr = new Error("Mystery query aborted.");
      abortErr.name = "AbortError";
      throw abortErr;
    }
    if (!input.executor) {
      throw new Error("Mystery workspace Core bridge is unavailable.");
    }
    const reply = await input.executor(command, signal);
    if (reply.status === "rejected") {
      throw new Error(reply.error.message);
    }
    return parse(reply.payload);
  };

  const loadBaseIndex = async (
    signal?: AbortSignal
  ): Promise<MysteryWorkspaceIndexSnapshot> => {
    if (!input.executor) {
      return workspace.workspaceIndex;
    }
    const cmd = createEnvelope(
      "mystery.getWorkspaceIndex",
      { bookId: workspace.bookId },
      { id: randomBytes(8).toString("hex"), context: commandContext }
    ) as MysteryQueryCommandEnvelope;
    const res = await execute(
      cmd,
      (p) => MysteryWorkspaceIndexResultSchema.parse(p),
      signal
    );
    return res.workspaceIndex;
  };

  const loadEffectiveIndex = async (
    signal?: AbortSignal
  ): Promise<{
    baseIndex: MysteryWorkspaceIndexSnapshot;
    effectiveIndex: MysteryWorkspaceIndexSnapshot;
  }> => {
    const baseIndex = await loadBaseIndex(signal);
    let currentManifest = indexToManifestProxy(baseIndex);
    let currentIndex = baseIndex;
    for (const batch of sharedState.proposalOverlay.batches) {
      const preview = previewMysteryWorkspaceOperations(
        currentManifest,
        currentIndex,
        batch
      );
      currentManifest = preview.manifest;
      currentIndex = preview.workspaceIndex;
    }
    return { baseIndex, effectiveIndex: currentIndex };
  };

  const readCurrentDocument = async (
    target: MysteryDocumentTarget,
    options?: {
      offset?: number | undefined;
      limit?: number | undefined;
      signal?: AbortSignal | undefined;
      forFullCredential?: boolean | undefined;
    }
  ): Promise<{
    content: string;
    totalCharacters: number;
    offset: number;
    hasMore: boolean;
    revision: string;
    fromOverlay: boolean;
  }> => {
    const key = mysteryDocumentTargetKey(target);
    const overlaid = sharedState.proposalOverlay.documents.get(key);
    if (overlaid) {
      const chars = Array.from(overlaid.content);
      const total = chars.length;
      const offset = Math.min(options?.offset ?? 0, total);
      const end =
        options?.limit === undefined
          ? total
          : Math.min(total, offset + options.limit);
      const sliced = chars.slice(offset, end).join("");
      const hasMore = end < total;
      if (options?.forFullCredential && offset === 0 && !hasMore) {
        fullyRead.set(key, {
          content: overlaid.content,
          revision: overlaid.revision
        });
      }
      return {
        content: sliced,
        totalCharacters: total,
        offset,
        hasMore,
        revision: overlaid.revision,
        fromOverlay: true
      };
    }

    // Check if created structurally inside current overlay without explicit doc write.
    const { effectiveIndex } = await loadEffectiveIndex(options?.signal);
    if (
      !input.executor ||
      sharedState.proposalOverlay.batches.some((b) => b.operations.length > 0)
    ) {
      // Check if target only exists in overlaid batches.
      try {
        const cmd = createEnvelope(
          "mystery.readDocument",
          {
            bookId: workspace.bookId,
            target,
            ...(options?.offset !== undefined
              ? { offset: options.offset }
              : {}),
            ...(options?.limit !== undefined ? { limit: options.limit } : {})
          },
          { id: randomBytes(8).toString("hex"), context: commandContext }
        ) as MysteryQueryCommandEnvelope;
        const result = await execute(
          cmd,
          (p) => MysteryReadDocumentResultSchema.parse(p),
          options?.signal
        );
        if (
          options?.forFullCredential &&
          result.offset === 0 &&
          !result.hasMore
        ) {
          fullyRead.set(key, {
            content: result.content,
            revision: result.revision
          });
        }
        return {
          content: result.content,
          totalCharacters: result.totalCharacters,
          offset: result.offset,
          hasMore: result.hasMore,
          revision: result.revision,
          fromOverlay: false
        };
      } catch (err) {
        // If target exists in effective overlay index (e.g. newly created role×act cell), return empty string.
        const keyExistsInOverlay = listTargetsFromIndex(effectiveIndex).some(
          (t) => mysteryDocumentTargetKey(t) === key
        );
        if (keyExistsInOverlay) {
          const rev = mysteryTextRevision("");
          if (options?.forFullCredential) {
            fullyRead.set(key, { content: "", revision: rev });
          }
          return {
            content: "",
            totalCharacters: 0,
            offset: 0,
            hasMore: false,
            revision: rev,
            fromOverlay: true
          };
        }
        throw err;
      }
    }

    const cmd = createEnvelope(
      "mystery.readDocument",
      {
        bookId: workspace.bookId,
        target,
        ...(options?.offset !== undefined ? { offset: options.offset } : {}),
        ...(options?.limit !== undefined ? { limit: options.limit } : {})
      },
      { id: randomBytes(8).toString("hex"), context: commandContext }
    ) as MysteryQueryCommandEnvelope;
    const result = await execute(
      cmd,
      (p) => MysteryReadDocumentResultSchema.parse(p),
      options?.signal
    );
    if (options?.forFullCredential && result.offset === 0 && !result.hasMore) {
      fullyRead.set(key, {
        content: result.content,
        revision: result.revision
      });
    }
    return {
      content: result.content,
      totalCharacters: result.totalCharacters,
      offset: result.offset,
      hasMore: result.hasMore,
      revision: result.revision,
      fromOverlay: false
    };
  };

  const previewAndSubmitProposal = async (options: {
    operations: MysteryOperation[];
    documentWrites: MysteryDocumentWrite[];
    summary: string;
    fileChanges: MysteryFileChange[];
    signal?: AbortSignal | undefined;
  }): Promise<AgentToolResult<MysteryAgentToolDetails>> => {
    const batch: MysteryOperationBatch = {
      operations: options.operations,
      documentWrites: options.documentWrites
    };

    const baseIndex = await loadBaseIndex(options.signal);
    const hasPriorOverlayOps = sharedState.proposalOverlay.batches.some(
      (b) => b.operations.length > 0
    );

    let effectiveIndex = baseIndex;
    let effectiveManifest = indexToManifestProxy(baseIndex);
    for (const prior of sharedState.proposalOverlay.batches) {
      const step = previewMysteryWorkspaceOperations(
        effectiveManifest,
        effectiveIndex,
        prior
      );
      effectiveManifest = step.manifest;
      effectiveIndex = step.workspaceIndex;
    }

    let preview;
    try {
      preview = previewMysteryWorkspaceOperations(
        effectiveManifest,
        effectiveIndex,
        batch
      );
    } catch (error: unknown) {
      if (error instanceof MysteryWorkspaceOperationError) {
        return textResult(
          [
            `未形成剧本杀结构/写入提案：${error.message}（${error.code}）。`,
            "不会生成审批卡。请先根据最新工作区结构修正参数后再重试，不要声称变更已经保存。"
          ].join("\n")
        );
      }
      throw error;
    }

    // Validate against Core previewOperations too when there are no prior uncommitted structural overlay ops.
    if (!hasPriorOverlayOps && input.executor) {
      const cmd = createEnvelope(
        "mystery.previewOperations",
        { bookId: workspace.bookId, batch },
        { id: randomBytes(8).toString("hex"), context: commandContext }
      ) as MysteryQueryCommandEnvelope;
      await execute(
        cmd,
        (p) => MysteryPreviewOperationsResultSchema.parse(p),
        options.signal
      );
    }

    sharedState.proposalOverlay.batches.push(batch);
    for (const fc of options.fileChanges) {
      const rev = mysteryTextRevision(fc.afterText);
      sharedState.proposalOverlay.documents.set(fc.targetKey, {
        target: fc.target,
        content: fc.afterText,
        revision: rev
      });
      fullyRead.set(fc.targetKey, {
        content: fc.afterText,
        revision: rev
      });
    }

    const changeLines = [
      ...preview.structureChanges.map((line) => `- 结构变更：${line}`),
      ...options.fileChanges.map(
        (fc) =>
          `- 文档提案：${fc.title}（${fc.operation}，${mysteryCharCount(fc.afterText)} 字）`
      )
    ];
    const tailNote =
      input.writeApprovalMode === "auto-approve"
        ? AUTO_APPROVE_PROPOSAL_SUBMITTED
        : "等待用户在差异审阅面板中确认后才会正式写盘。";

    return textResult(
      [`已提交剧本杀提案：${options.summary}`, ...changeLines, tailNote].join(
        "\n"
      ),
      {
        kind: "mystery-mutation-proposal",
        bookId: workspace.bookId,
        agentId: profile.id,
        summary: options.summary,
        batch,
        fileChanges: options.fileChanges,
        structureChanges: preview.structureChanges
      }
    );
  };

  return {
    input,
    workspace,
    profile,
    sharedState,
    fullyRead,
    commandContext,
    execute,
    loadBaseIndex,
    loadEffectiveIndex,
    readCurrentDocument,
    previewAndSubmitProposal,
    digest(text: string) {
      return createHash("sha256").update(text).digest("hex").slice(0, 12);
    }
  };
}

function listTargetsFromIndex(
  index: MysteryWorkspaceIndexSnapshot
): MysteryDocumentTarget[] {
  return [
    { kind: "agents_md" },
    ...index.truthDocuments.map((doc): MysteryDocumentTarget => ({
      kind: "truth_doc",
      docId: doc.id
    })),
    { kind: "character_relations" },
    ...index.roles.flatMap((role): MysteryDocumentTarget[] => [
      { kind: "role", roleId: role.id, document: "profile" },
      { kind: "role", roleId: role.id, document: "pitch" }
    ]),
    ...index.roles.flatMap((role) =>
      index.acts.flatMap((act): MysteryDocumentTarget[] => [
        {
          kind: "player_act",
          roleId: role.id,
          actId: act.id,
          document: "brief"
        },
        {
          kind: "player_act",
          roleId: role.id,
          actId: act.id,
          document: "body"
        }
      ])
    ),
    { kind: "public_doc", docId: "public_openings" },
    { kind: "public_doc", docId: "endings" },
    ...index.clueRounds.map((round): MysteryDocumentTarget => ({
      kind: "clue_round",
      roundId: round.id
    })),
    { kind: "dm_manual" }
  ];
}

function buildReadTool(
  ctx: ReturnType<typeof createMysteryToolContext>
): AgentTool {
  return defineMysteryTool({
    name: "read",
    label: "读取剧本杀文档",
    description:
      "按对象类型与稳定 id 读取剧本杀文档。role 须传 role_id(或 id) 与 document=profile|pitch；player_act 须传 role_id、act_id 与 document=brief|body。支持 range=head|tail + max_chars（1–8000），或 offset/limit 分段读取；片段不授予覆盖编辑凭据。",
    parameters: Type.Object(
      {
        kind: StringEnum([
          "truth_doc",
          "character_relations",
          "role",
          "player_act",
          "clue_round",
          "public_doc",
          "dm_manual",
          "agents_md"
        ] as const),
        id: Type.Optional(Type.String()),
        role_id: Type.Optional(Type.String()),
        act_id: Type.Optional(Type.String()),
        document: Type.Optional(
          StringEnum(["profile", "pitch", "brief", "body"] as const)
        ),
        range: Type.Optional(StringEnum(["head", "tail"] as const)),
        max_chars: Type.Optional(Type.Number()),
        offset: Type.Optional(Type.Number()),
        limit: Type.Optional(Type.Number())
      },
      { additionalProperties: false }
    ),
    execute: async (_toolCallId, params, signal) => {
      const target = resolveMysteryDocumentTarget(params);
      const { effectiveIndex } = await ctx.loadEffectiveIndex(signal);
      const title = mysteryDocumentTitle(
        indexToManifestProxy(effectiveIndex),
        target
      );
      const relPath = mysteryDocumentRelativePath(target);

      if (
        params.range &&
        (params.offset !== undefined || params.limit !== undefined)
      ) {
        throw new Error(
          "不能同时传 range 和 offset/limit，请二选一：读首尾片段用 range+max_chars，分段精读用 offset+limit。"
        );
      }

      if (params.range || params.max_chars !== undefined) {
        const range = params.range ?? "head";
        const maxChars = params.max_chars ?? 2_000;
        if (
          !Number.isSafeInteger(maxChars) ||
          maxChars < 1 ||
          maxChars > 8_000
        ) {
          throw new Error("max_chars 必须是 1–8000 的整数。");
        }
        const doc = await ctx.readCurrentDocument(target, {
          signal,
          forFullCredential: false
        });
        const chars = Array.from(doc.content);
        const excerpt =
          range === "head"
            ? chars.slice(0, maxChars).join("")
            : chars.slice(Math.max(0, chars.length - maxChars)).join("");
        return textResult(
          [
            `【${title}】（${relPath}｜${range === "head" ? "开头" : "结尾"}片段 ${Array.from(excerpt).length}/${doc.totalCharacters} 字${doc.fromOverlay ? "｜含未保存提案" : ""}）`,
            excerpt || "（当前为空白文档）"
          ].join("\n")
        );
      }

      const offset = params.offset ?? 0;
      const limit = params.limit ?? 50_000;
      if (!Number.isSafeInteger(offset) || offset < 0) {
        throw new Error("offset 必须是非负整数。");
      }
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200_000) {
        throw new Error("limit 必须是 1–200000 的整数。");
      }
      const doc = await ctx.readCurrentDocument(target, {
        offset,
        limit,
        signal,
        forFullCredential: offset === 0
      });
      return textResult(
        [
          `【${title}】（${relPath}｜${doc.totalCharacters} 字｜版本 ${doc.revision}${doc.fromOverlay ? "｜未保存提案版本" : ""}${doc.hasMore ? `｜已返回 [${doc.offset}, ${doc.offset + Array.from(doc.content).length})，仍有剩余请续传 offset` : ""}）`,
          doc.content || "（当前为空白文档）"
        ].join("\n")
      );
    }
  });
}

function buildSearchTool(
  ctx: ReturnType<typeof createMysteryToolContext>
): AgentTool {
  return defineMysteryTool({
    name: "search",
    label: "检索剧本杀全文",
    description:
      "在剧本杀已保存文档中按关键词检索。查玩家视角是否漏线索或泄密时，传 visibility=player_visible 仅检索选角页 pitch、人物本正文 body、公共序幕与搜证线索卡。",
    parameters: Type.Object(
      {
        query: Type.String(),
        stage: Type.Optional(StringEnum([...MYSTERY_STAGES] as const)),
        visibility: Type.Optional(
          StringEnum(["all", "player_visible"], {
            description:
              "all 检索所有文档（默认）；player_visible 仅检索玩家可见文档。"
          })
        ),
        limit: Type.Optional(Type.Number())
      },
      { additionalProperties: false }
    ),
    execute: async (_toolCallId, params, signal) => {
      const query = params.query.trim();
      if (!query) {
        throw new Error("search 的 query 不能为空。");
      }
      const limit = params.limit ?? 30;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("limit 必须是 1–100 的整数。");
      }
      const cmd = createEnvelope(
        "mystery.search",
        {
          bookId: ctx.workspace.bookId,
          query,
          ...(params.stage ? { stage: params.stage } : {}),
          ...(params.visibility !== undefined
            ? { playerVisibleOnly: params.visibility === "player_visible" }
            : {}),
          limit
        },
        { id: randomBytes(8).toString("hex"), context: ctx.commandContext }
      ) as MysteryQueryCommandEnvelope;
      const res = await ctx.execute(
        cmd,
        (p) => MysterySearchResultSchema.parse(p),
        signal
      );
      if (res.hits.length === 0) {
        return textResult(
          `检索「${query}」命中 0 条${params.visibility === "player_visible" ? "（仅限玩家可见文档）" : ""}。`
        );
      }
      return textResult(
        [
          `检索「${query}」共命中 ${res.totalHits} 处（展示 ${res.hits.length} 条文档）：`,
          ...res.hits.map(
            (hit) =>
              `- [${hit.playerVisible ? "玩家可见" : "上帝机密"}][stage=${hit.stage}] ${hit.title} (${hit.targetKey}) ×${hit.matchCount}：${hit.snippet}`
          )
        ].join("\n")
      );
    }
  });
}

function buildCreateTool(
  ctx: ReturnType<typeof createMysteryToolContext>
): AgentTool {
  return defineMysteryTool({
    name: "create",
    label: "新建剧本杀结构对象",
    description:
      "新建自定义真相文档（truth_doc）、角色双文件（role）、分幕（act）或搜证轮次（clue_round）。可附带初始正文，返回结构变更审批提案。",
    parameters: Type.Object(
      {
        kind: StringEnum(["truth_doc", "role", "act", "clue_round"] as const),
        id: Type.Optional(Type.String()),
        title: Type.Optional(Type.String()),
        name: Type.Optional(Type.String()),
        tag: Type.Optional(Type.String()),
        content: Type.Optional(Type.String()),
        profile_content: Type.Optional(Type.String()),
        pitch_content: Type.Optional(Type.String()),
        summary: Type.Optional(Type.String())
      },
      { additionalProperties: false }
    ),
    execute: async (_toolCallId, params, signal) => {
      const label = (params.title ?? params.name ?? "").trim();
      if (!label) {
        throw new Error(
          `创建 ${params.kind} 时必须提供非空的 title（或 name）。`
        );
      }

      const ops: MysteryOperation[] = [];
      const writes: MysteryDocumentWrite[] = [];
      const changes: MysteryFileChange[] = [];

      if (params.kind === "truth_doc") {
        const docId = normalizeMysteryId("truth", params.id);
        ops.push({
          type: "truthDoc.create",
          doc: {
            id: docId,
            title: label,
            ...(params.content !== undefined ? { content: params.content } : {})
          }
        });
        if (params.content) {
          const target: MysteryDocumentTarget = { kind: "truth_doc", docId };
          writes.push({ target, content: params.content });
          changes.push({
            targetKey: mysteryDocumentTargetKey(target),
            target,
            title: label,
            operation: "create",
            beforeText: "",
            afterText: params.content
          });
        }
      } else if (params.kind === "role") {
        const roleId = normalizeMysteryId("role", params.id);
        ops.push({
          type: "role.create",
          role: {
            id: roleId,
            name: label,
            tag: params.tag?.trim() ?? "",
            ...(params.profile_content !== undefined
              ? { profileContent: params.profile_content }
              : {}),
            ...(params.pitch_content !== undefined
              ? { pitchContent: params.pitch_content }
              : {})
          }
        });
        if (params.profile_content) {
          const target: MysteryDocumentTarget = {
            kind: "role",
            roleId,
            document: "profile"
          };
          writes.push({ target, content: params.profile_content });
          changes.push({
            targetKey: mysteryDocumentTargetKey(target),
            target,
            title: `${label} · 上帝底牌`,
            operation: "create",
            beforeText: "",
            afterText: params.profile_content
          });
        }
        if (params.pitch_content) {
          const target: MysteryDocumentTarget = {
            kind: "role",
            roleId,
            document: "pitch"
          };
          writes.push({ target, content: params.pitch_content });
          changes.push({
            targetKey: mysteryDocumentTargetKey(target),
            target,
            title: `${label} · 公开选角页`,
            operation: "create",
            beforeText: "",
            afterText: params.pitch_content
          });
        }
      } else if (params.kind === "act") {
        const actId = normalizeMysteryId("act", params.id);
        ops.push({
          type: "act.create",
          act: { id: actId, title: label }
        });
      } else {
        const roundId = normalizeMysteryId("round", params.id);
        ops.push({
          type: "clueRound.create",
          round: {
            id: roundId,
            title: label,
            ...(params.content !== undefined ? { content: params.content } : {})
          }
        });
        if (params.content) {
          const target: MysteryDocumentTarget = { kind: "clue_round", roundId };
          writes.push({ target, content: params.content });
          changes.push({
            targetKey: mysteryDocumentTargetKey(target),
            target,
            title: label,
            operation: "create",
            beforeText: "",
            afterText: params.content
          });
        }
      }

      return await ctx.previewAndSubmitProposal({
        operations: ops,
        documentWrites: writes,
        summary: params.summary?.trim() || `新建${params.kind}《${label}》`,
        fileChanges: changes,
        signal
      });
    }
  });
}

function buildEditTool(
  ctx: ReturnType<typeof createMysteryToolContext>
): AgentTool {
  return defineMysteryTool({
    name: "edit",
    label: "编辑剧本杀文档或结构",
    description:
      '修改文档正文或结构元数据/盘面规格。空白目标直接传 content；修改非空文本须先全文 read，再用 replacements 或 content+overwrite_mode=replace_all。改结构名称/顺序用 meta，改玩家人数/目标幕数/人称用 kind="board_spec" + board_spec。',
    parameters: Type.Object(
      {
        kind: StringEnum([
          "truth_doc",
          "character_relations",
          "role",
          "player_act",
          "clue_round",
          "public_doc",
          "dm_manual",
          "agents_md",
          "board_spec"
        ] as const),
        id: Type.Optional(Type.String()),
        role_id: Type.Optional(Type.String()),
        act_id: Type.Optional(Type.String()),
        document: Type.Optional(
          StringEnum(["profile", "pitch", "brief", "body"] as const)
        ),
        content: Type.Optional(Type.String()),
        replacements: Type.Optional(
          Type.Array(
            Type.Object(
              {
                original_text: Type.String(),
                new_text: Type.String()
              },
              { additionalProperties: false }
            )
          )
        ),
        overwrite_mode: overwriteModeParameter(
          WRITING_EDIT_OVERWRITE_DESCRIPTION
        ),
        meta: Type.Optional(
          Type.Object(
            {
              title: Type.Optional(Type.String()),
              name: Type.Optional(Type.String()),
              tag: Type.Optional(Type.String()),
              move: Type.Optional(StringEnum(["up", "down"] as const))
            },
            { additionalProperties: false }
          )
        ),
        board_spec: Type.Optional(
          Type.Object(
            {
              playerCount: Type.Optional(Type.Number()),
              actCountTarget: Type.Optional(Type.Number()),
              narrativePerson: Type.Optional(
                StringEnum(["second", "first"] as const)
              ),
              summary: Type.Optional(Type.String())
            },
            { additionalProperties: false }
          )
        ),
        summary: Type.Optional(Type.String())
      },
      { additionalProperties: false }
    ),
    execute: async (_toolCallId, params, signal) => {
      if (
        params.content !== undefined &&
        (params.replacements?.length ?? 0) > 0
      ) {
        throw new Error(
          "content 与 replacements 不能同时传入；整篇写/重写请传 content，局部修订请传 replacements。"
        );
      }

      if (params.kind === "board_spec") {
        if (!params.board_spec) {
          throw new Error(
            '修改 kind="board_spec" 时必须传入 board_spec 对象。'
          );
        }
        return await ctx.previewAndSubmitProposal({
          operations: [
            { type: "boardSpec.update", boardSpec: params.board_spec }
          ],
          documentWrites: [],
          summary: params.summary?.trim() || "更新剧本盘面规格",
          fileChanges: [],
          signal
        });
      }

      const ops: MysteryOperation[] = [];
      const { effectiveIndex } = await ctx.loadEffectiveIndex(signal);
      const manifest = indexToManifestProxy(effectiveIndex);

      // Meta-only / attached structure changes
      if (params.meta) {
        const m = params.meta;
        if (params.kind === "truth_doc") {
          const docId = params.id?.trim();
          if (!docId) throw new Error("更新 truth_doc 元数据需要 id。");
          ops.push({
            type: "truthDoc.updateMeta",
            docId,
            ...(m.title ? { title: m.title } : {}),
            ...(m.move ? { move: m.move } : {})
          });
        } else if (params.kind === "role") {
          const roleId = (params.role_id ?? params.id)?.trim();
          if (!roleId) throw new Error("更新 role 元数据需要 role_id 或 id。");
          ops.push({
            type: "role.updateMeta",
            roleId,
            ...((m.name ?? m.title) ? { name: (m.name ?? m.title)! } : {}),
            ...(m.tag !== undefined ? { tag: m.tag } : {}),
            ...(m.move ? { move: m.move } : {})
          });
        } else if (params.kind === "player_act") {
          const actId = (params.act_id ?? params.id)?.trim();
          if (!actId) throw new Error("更新 act 元数据需要 act_id 或 id。");
          ops.push({
            type: "act.updateMeta",
            actId,
            ...((m.title ?? m.name) ? { title: (m.title ?? m.name)! } : {}),
            ...(m.move ? { move: m.move } : {})
          });
        } else if (params.kind === "clue_round") {
          const roundId = params.id?.trim();
          if (!roundId) throw new Error("更新 clue_round 元数据需要 id。");
          ops.push({
            type: "clueRound.updateMeta",
            roundId,
            ...(m.title ? { title: m.title } : {}),
            ...(m.move ? { move: m.move } : {})
          });
        } else {
          throw new Error(`类型 ${params.kind} 不支持 meta 更新。`);
        }
      }

      const hasBodyEdit =
        params.content !== undefined || (params.replacements?.length ?? 0) > 0;
      if (!hasBodyEdit) {
        if (ops.length === 0) {
          throw new Error(
            "edit 至少需要提供 content、replacements、meta 或 board_spec 之一。"
          );
        }
        return await ctx.previewAndSubmitProposal({
          operations: ops,
          documentWrites: [],
          summary: params.summary?.trim() || "调整剧本杀结构元数据",
          fileChanges: [],
          signal
        });
      }

      const target = resolveMysteryDocumentTarget(params);
      const targetKey = mysteryDocumentTargetKey(target);
      const docTitle = mysteryDocumentTitle(manifest, target);
      const current = await ctx.readCurrentDocument(target, {
        signal,
        forFullCredential: false
      });

      const recorded = ctx.fullyRead.get(targetKey);
      let nextContent: string;
      if (params.replacements && params.replacements.length > 0) {
        if (!recorded || recorded.content !== current.content) {
          return textResult(
            `未修改：执行 replacements 局部修改前，必须先完整 read《${docTitle}》（${targetKey}）的最新内容。未生成提案。`
          );
        }
        const replaced = applyReplacements(
          current.content,
          params.replacements
        );
        if ("failure" in replaced) {
          return textResult(`未修改：${replaced.failure}`);
        }
        nextContent = replaced.content;
      } else {
        nextContent = params.content ?? "";
        if (
          current.content.trim().length > 0 &&
          params.overwrite_mode !== REPLACE_ALL_OVERWRITE_MODE
        ) {
          return textResult(WRITING_EDIT_OVERWRITE_RECOVERY);
        }
        if (
          current.content.trim().length > 0 &&
          (!recorded || recorded.content !== current.content)
        ) {
          return textResult(
            `未修改：覆盖非空文档《${docTitle}》前必须先完整 read 当前正文，再设置 overwrite_mode=replace_all。未生成提案。`
          );
        }
      }

      if (nextContent === current.content && ops.length === 0) {
        return textResult(
          `未修改：《${docTitle}》当前内容已与提交一致，无需重复生成提案。`
        );
      }

      const resolvedSummary = resolveWritingEditSummary(
        params.summary,
        docTitle,
        {
          content: params.content,
          replacements: params.replacements,
          meta: params.meta
        },
        ctx.input.promptLocale
      );

      const writes: MysteryDocumentWrite[] =
        nextContent !== current.content
          ? [
              {
                target,
                content: nextContent,
                ...(current.fromOverlay
                  ? {}
                  : { expectedRevision: current.revision })
              }
            ]
          : [];
      const fileChanges: MysteryFileChange[] =
        nextContent !== current.content
          ? [
              {
                targetKey,
                target,
                title: docTitle,
                operation: current.content ? "edit" : "write",
                beforeText: current.content,
                afterText: nextContent
              }
            ]
          : [];

      return await ctx.previewAndSubmitProposal({
        operations: ops,
        documentWrites: writes,
        summary: resolvedSummary,
        fileChanges,
        signal
      });
    }
  });
}

function buildDeleteTool(
  ctx: ReturnType<typeof createMysteryToolContext>
): AgentTool {
  return defineMysteryTool({
    name: "delete",
    label: "删除剧本杀结构对象",
    description:
      "删除非内置真相文档（truth_doc）、角色及其所有幕剧本（role）、幕次（act）或搜证轮次（clue_round）。至少保留 1 个角色和 1 个幕次。",
    parameters: Type.Object(
      {
        kind: StringEnum(["truth_doc", "role", "act", "clue_round"] as const),
        id: Type.Optional(Type.String()),
        role_id: Type.Optional(Type.String()),
        act_id: Type.Optional(Type.String()),
        summary: Type.Optional(Type.String())
      },
      { additionalProperties: false }
    ),
    execute: async (_toolCallId, params, signal) => {
      let op: MysteryOperation;
      if (params.kind === "truth_doc") {
        const docId = params.id?.trim();
        if (!docId) throw new Error("删除 truth_doc 必须提供 id。");
        op = { type: "truthDoc.delete", docId };
      } else if (params.kind === "role") {
        const roleId = (params.role_id ?? params.id)?.trim();
        if (!roleId) throw new Error("删除 role 必须提供 role_id 或 id。");
        op = { type: "role.delete", roleId };
      } else if (params.kind === "act") {
        const actId = (params.act_id ?? params.id)?.trim();
        if (!actId) throw new Error("删除 act 必须提供 act_id 或 id。");
        op = { type: "act.delete", actId };
      } else {
        const roundId = params.id?.trim();
        if (!roundId) throw new Error("删除 clue_round 必须提供 id。");
        op = { type: "clueRound.delete", roundId };
      }

      return await ctx.previewAndSubmitProposal({
        operations: [op],
        documentWrites: [],
        summary: params.summary?.trim() || `删除 ${params.kind}`,
        fileChanges: [],
        signal
      });
    }
  });
}

function buildQueryMaterialsTool(
  input: BuildMysteryWorkspaceToolsInput
): AgentTool {
  return defineMysteryTool({
    name: "query_linked_material_entries",
    label: "查询关联素材条目",
    description: MATERIAL_QUERY_DESCRIPTION,
    parameters: Type.Object({
      mode: StringEnum(["list", "search", "read"] as const),
      cursor: Type.Optional(Type.Integer({ minimum: 0 })),
      query: Type.Optional(Type.String({ maxLength: 300 })),
      entry_id: Type.Optional(Type.String({ minLength: 1, maxLength: 1200 })),
      entry_name: Type.Optional(Type.String({ maxLength: 240 })),
      material_kind: Type.Optional(StringEnum([...MATERIAL_KINDS] as const))
    }),
    execute: async (_toolCallId, params, signal) => {
      if (input.queryMaterials) {
        return textResult(
          await input.queryMaterials(params, [...MATERIAL_KINDS], signal)
        );
      }
      return textResult(
        queryAttachedMaterials(input.attachedMaterials ?? [], params)
      );
    }
  });
}

function buildMysteryLoadSkillTool(
  input: BuildMysteryWorkspaceToolsInput
): AgentTool {
  const allowed = new Set<string>(SKILL_KINDS);
  return defineMysteryTool({
    name: "load_skill",
    label: "加载技能",
    description: LOAD_SKILL_TOOL_DESCRIPTION,
    parameters: Type.Object({
      name: Type.String(LOAD_SKILL_NAME_PARAMETER)
    }),
    execute: async (_toolCallId, params) => {
      const name = String(params.name ?? "");
      const attached = input.attachedSkills ?? [];
      const isReadable = (item: LoadSkillCandidate): boolean =>
        item.kind !== undefined && allowed.has(item.kind);
      const result = resolveAttachedSkill(name, attached, isReadable);
      return textResult(
        formatLoadSkillToolResult(name, result, attached.filter(isReadable))
      );
    }
  });
}

export function buildMysteryWorkspaceTools(
  input: BuildMysteryWorkspaceToolsInput
): AgentTool[] {
  const ctx = createMysteryToolContext(input);
  const tools: AgentTool[] = [
    buildReadTool(ctx),
    buildSearchTool(ctx),
    buildCreateTool(ctx),
    buildEditTool(ctx),
    buildDeleteTool(ctx),
    buildQueryMaterialsTool(input),
    buildMysteryLoadSkillTool(input)
  ];
  if (input.includeAskUserQuestion !== false) {
    tools.push(buildAskUserQuestionTool(input.requestUserInput));
  }
  return tools;
}
