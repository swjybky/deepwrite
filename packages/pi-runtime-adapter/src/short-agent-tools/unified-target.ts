import {
  createShortWorkspaceContentRevision,
  type ShortWorkspaceStageId
} from "@deepwrite/contracts";
import {
  draftUnitLabel,
  type BuildWritingWorkspaceToolsInput,
  type DraftFileKind,
  type ShortWorkspaceToolSharedState
} from "./shared";
import { WRITING_DOCUMENTS, WRITING_TARGET_KINDS } from "./tool-parameters";

export const SHORT_UNIFIED_TARGET_KINDS = WRITING_TARGET_KINDS;
export type ShortUnifiedTargetKind =
  (typeof SHORT_UNIFIED_TARGET_KINDS)[number];
export type ShortUnifiedDocument = (typeof WRITING_DOCUMENTS)[number];

export interface ShortUnifiedTarget {
  kind: ShortUnifiedTargetKind;
  id: string;
  title: string;
  stageId: ShortWorkspaceStageId;
  documentId: string;
  content: string;
  revision: string;
  truncated: boolean;
  itemId?: string;
  sectionId?: string;
  fileKind?: DraftFileKind;
}

/** Single-file objects only have a body, so document=body is redundant, not wrong. */
function assertSingleFileDocument(
  input: BuildWritingWorkspaceToolsInput,
  kind: Exclude<ShortUnifiedTargetKind, "draft_section">,
  document: ShortUnifiedDocument | undefined
): void {
  if (document && document !== "body")
    throw new Error(
      input.promptLocale === "en-US"
        ? `${kind} has a single file and no State; omit document.`
        : `${kind} 只有一份文件，没有状态；不要传 document。`
    );
}

/** Generated ids use "-" and fixed ids use "_", so models mix the two. */
function matchStableId<T extends string>(
  ids: Iterable<T>,
  id: string
): T | undefined {
  const candidates = [...ids];
  if (candidates.includes(id as T)) return id as T;
  const normalized = id.replace(/_/gu, "-");
  const matches = candidates.filter(
    (candidate) => candidate.replace(/_/gu, "-") === normalized
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function titleMatchHint(
  input: BuildWritingWorkspaceToolsInput,
  entries: Iterable<{ id: string; title: string }>,
  requested: string
): string {
  for (const entry of entries)
    if (entry.title.trim() === requested)
      return input.promptLocale === "en-US"
        ? ` “${entry.title}” has id=${entry.id}.`
        : `「${entry.title}」的 id 是 ${entry.id}。`;
  return "";
}

function resolveCharacterOverviewTarget(
  input: BuildWritingWorkspaceToolsInput,
  sharedState: ShortWorkspaceToolSharedState,
  id: string,
  document: ShortUnifiedDocument | undefined
): ShortUnifiedTarget {
  assertSingleFileDocument(input, "character_overview", document);
  if (matchStableId(["character_design"], id) === undefined) {
    throw new Error(
      input.promptLocale === "en-US"
        ? "The character overview id must be character_design."
        : "人物概览的稳定 id 固定为 character_design。"
    );
  }
  const snapshot = input.workspace.stages.find(
    (stage) => stage.stageId === "character_design"
  );
  if (!snapshot)
    throw new Error(
      input.promptLocale === "en-US"
        ? "The character overview does not exist."
        : "不存在人物概览。"
    );
  return {
    kind: "character_overview",
    id: "character_design",
    title: snapshot.title,
    stageId: "character_design",
    documentId: "character_design",
    content: sharedState.stageBodies.get("character_design") ?? "",
    revision:
      sharedState.stageRevisions.get("character_design") ?? snapshot.revision,
    truncated: snapshot.truncated === true
  };
}

function resolvePlotStageTarget(
  input: BuildWritingWorkspaceToolsInput,
  sharedState: ShortWorkspaceToolSharedState,
  requested: string,
  document: ShortUnifiedDocument | undefined
): ShortUnifiedTarget {
  assertSingleFileDocument(input, "plot_stage", document);
  const id =
    matchStableId(sharedState.plotStages.keys(), requested) ?? requested;
  const stage = sharedState.plotStages.get(id);
  if (!stage)
    throw new Error(
      (input.promptLocale === "en-US"
        ? `Plot stage ${requested} was not found. Read kind=workspace, id=workspace for current ids.`
        : `不存在剧情结构 ${requested}。请用 read（kind=workspace，id=workspace）查询最新 id。`) +
        titleMatchHint(input, sharedState.plotStages.values(), requested)
    );
  const snapshot = input.workspace.stages.find((item) => item.stageId === id);
  return {
    kind: "plot_stage",
    id,
    title: stage.title,
    stageId: id,
    documentId: id,
    content: sharedState.stageBodies.get(id) ?? "",
    revision:
      sharedState.stageRevisions.get(id) ??
      snapshot?.revision ??
      createShortWorkspaceContentRevision(""),
    truncated: snapshot?.truncated === true
  };
}

function resolveCharacterTarget(
  input: BuildWritingWorkspaceToolsInput,
  sharedState: ShortWorkspaceToolSharedState,
  id: string,
  document: ShortUnifiedDocument | undefined
): ShortUnifiedTarget {
  assertSingleFileDocument(input, "character", document);
  if ((input.workspace.characterStructure?.format ?? "text") !== "list") {
    throw new Error(
      input.promptLocale === "en-US"
        ? "Characters use text layout; use kind=character_overview, id=character_design."
        : "当前人物为文本样式，请使用 kind=character_overview、id=character_design。"
    );
  }
  const item = sharedState.characterItems.get(
    matchStableId(sharedState.characterItems.keys(), id) ?? id
  );
  if (!item) {
    throw new Error(
      (input.promptLocale === "en-US"
        ? `Character ${id} was not found. Read kind=workspace, id=workspace for current ids, not character names.`
        : `不存在人物条目 ${id}。请用 read（kind=workspace，id=workspace）查询最新人物 id，不要用人名代替 id。`) +
        titleMatchHint(input, sharedState.characterItems.values(), id)
    );
  }
  return {
    kind: "character",
    id: item.id,
    title: item.title,
    stageId: "character_design",
    documentId: item.id,
    content: item.content,
    revision: item.revision,
    truncated: item.truncated === true,
    itemId: item.id
  };
}

function resolveDraftTarget(
  input: BuildWritingWorkspaceToolsInput,
  sharedState: ShortWorkspaceToolSharedState,
  id: string,
  document: ShortUnifiedDocument | undefined
): ShortUnifiedTarget {
  const section = sharedState.expertSections.get(
    matchStableId(sharedState.expertSections.keys(), id) ?? id
  );
  if (!section)
    throw new Error(
      (input.promptLocale === "en-US"
        ? `The ${draftUnitLabel(input)} ${id} was not found. Read kind=workspace, id=workspace for current ids.`
        : `不存在${draftUnitLabel(input)} ${id}。请用 read（kind=workspace，id=workspace）查询最新 id。`) +
        titleMatchHint(input, sharedState.expertSections.values(), id)
    );
  const fileKind: DraftFileKind =
    document === "state" || document === "character_state"
      ? "characterState"
      : "body";
  const file = section[fileKind];
  return {
    kind: "draft_section",
    id: section.id,
    title:
      input.promptLocale === "en-US"
        ? `${section.title} · ${fileKind === "body" ? "Body" : "State"}`
        : `${section.title} · ${fileKind === "body" ? "正文" : "状态"}`,
    stageId: "draft",
    documentId: file.documentId,
    content: file.content,
    revision: file.revision,
    truncated: false,
    sectionId: section.id,
    fileKind
  };
}

export function resolveWritingEditKind(
  input: BuildWritingWorkspaceToolsInput,
  sharedState: ShortWorkspaceToolSharedState,
  request: {
    kind?: ShortUnifiedTargetKind;
    id: string;
    document?: ShortUnifiedDocument;
    meta?: { title?: string };
  }
): ShortUnifiedTargetKind {
  if (request.kind !== undefined) return request.kind;
  if (
    request.document === "body" ||
    request.document === "state" ||
    request.document === "character_state"
  ) {
    return "draft_section";
  }
  const id = request.id.trim();
  if (
    request.meta?.title !== undefined &&
    sharedState.expertSections.has(id) &&
    !sharedState.characterItems.has(id) &&
    !sharedState.plotStages.has(id) &&
    id !== "character_design"
  ) {
    return "draft_section";
  }
  throw new Error(
    input.promptLocale === "en-US"
      ? "Cannot infer the target. Supply kind and a stable id explicitly. For section renames use kind=draft_section and meta.title, without document."
      : "无法确定修改对象。正文修改省略 kind 时必须指定 document=body 或 state；小节改名请提供 kind=draft_section、稳定小节 id 和 meta.title，无需 document。"
  );
}

export function resolveShortUnifiedTarget(
  input: BuildWritingWorkspaceToolsInput,
  sharedState: ShortWorkspaceToolSharedState,
  request: {
    kind: ShortUnifiedTargetKind;
    id: string;
    document?: ShortUnifiedDocument;
  }
): ShortUnifiedTarget {
  const id = request.id.trim();
  if (!id)
    throw new Error(
      input.promptLocale === "en-US" ? "id cannot be empty." : "id 不能为空。"
    );
  if (request.kind === "character_overview") {
    return resolveCharacterOverviewTarget(
      input,
      sharedState,
      id,
      request.document
    );
  }
  if (request.kind === "character") {
    return resolveCharacterTarget(input, sharedState, id, request.document);
  }
  if (request.kind === "plot_stage") {
    return resolvePlotStageTarget(input, sharedState, id, request.document);
  }
  return resolveDraftTarget(input, sharedState, id, request.document);
}

export function assertWritableTarget(
  input: BuildWritingWorkspaceToolsInput,
  target: ShortUnifiedTarget
): void {
  if (target.truncated) {
    throw new Error(
      input.promptLocale === "en-US"
        ? "The snapshot is truncated. Read the complete original before editing."
        : "目标快照已截断，不能在未读取完整原文时修改。"
    );
  }
}

export function updateShortUnifiedTarget(
  input: BuildWritingWorkspaceToolsInput,
  sharedState: ShortWorkspaceToolSharedState,
  target: ShortUnifiedTarget,
  content: string
): string {
  const revision = createShortWorkspaceContentRevision(content);
  if (target.kind === "character_overview" || target.kind === "plot_stage") {
    sharedState.stageBodies.set(target.stageId, content);
    sharedState.stageRevisions.set(target.stageId, revision);
    return revision;
  }
  if (target.kind === "character") {
    const item = sharedState.characterItems.get(target.itemId!);
    if (!item)
      throw new Error(
        input.promptLocale === "en-US"
          ? `Character ${target.itemId} was not found. Read kind=workspace, id=workspace for current ids.`
          : `不存在人物条目 ${target.itemId}。请用 read（kind=workspace，id=workspace）查询最新 id。`
      );
    sharedState.characterItems.set(item.id, { ...item, content, revision });
    return revision;
  }
  const section = sharedState.expertSections.get(target.sectionId!);
  if (!section || !target.fileKind) {
    throw new Error(
      input.promptLocale === "en-US"
        ? `Manuscript object ${target.sectionId} was not found. Read kind=workspace, id=workspace for current ids.`
        : `不存在正文对象 ${target.sectionId}。请用 read（kind=workspace，id=workspace）查询最新 id。`
    );
  }
  sharedState.expertSections.set(section.id, {
    ...section,
    [target.fileKind]: {
      ...section[target.fileKind],
      content,
      revision
    }
  });
  return revision;
}
