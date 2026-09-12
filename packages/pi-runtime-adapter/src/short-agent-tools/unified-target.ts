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

function resolveCharacterOverviewTarget(
  input: BuildWritingWorkspaceToolsInput,
  sharedState: ShortWorkspaceToolSharedState,
  id: string,
  document: ShortUnifiedDocument | undefined
): ShortUnifiedTarget {
  if (document)
    throw new Error("character_overview 目标不接受 document 参数。");
  if (id !== "character_design") {
    throw new Error("人物概览的稳定 id 固定为 character_design。");
  }
  const snapshot = input.workspace.stages.find(
    (stage) => stage.stageId === "character_design"
  );
  if (!snapshot) throw new Error("不存在人物概览。");
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
  id: string,
  document: ShortUnifiedDocument | undefined
): ShortUnifiedTarget {
  if (document) throw new Error("plot_stage 目标不接受 document 参数。");
  const stage = sharedState.plotStages.get(id);
  if (!stage) throw new Error(`不存在剧情结构 ${id}。`);
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
  if (document) throw new Error("character 目标不接受 document 参数。");
  if ((input.workspace.characterStructure?.format ?? "text") !== "list") {
    throw new Error(
      "当前人物为文本样式，请使用 kind=character_overview、id=character_design。"
    );
  }
  const item = sharedState.characterItems.get(id);
  if (!item) throw new Error(`不存在人物条目 ${id}。`);
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
  const section = sharedState.expertSections.get(id);
  if (!section) throw new Error(`不存在${draftUnitLabel(input)} ${id}。`);
  const fileKind: DraftFileKind =
    document === "character_state" ? "characterState" : "body";
  const file = section[fileKind];
  return {
    kind: "draft_section",
    id: section.id,
    title: `${section.title} · ${fileKind === "body" ? "正文" : "人物状态"}`,
    stageId: "draft",
    documentId: file.documentId,
    content: file.content,
    revision: file.revision,
    truncated: false,
    sectionId: section.id,
    fileKind
  };
}

export function resolveWritingMutationKind(
  kind: ShortUnifiedTargetKind | undefined,
  document: ShortUnifiedDocument | undefined
): ShortUnifiedTargetKind {
  if (kind !== undefined) return kind;
  if (document === "body" || document === "character_state") {
    return "draft_section";
  }
  throw new Error(
    "省略 kind 时必须指定 document=body 或 character_state，并提供稳定小节 id。"
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
  if (!id) throw new Error("id 不能为空。");
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
  _input: BuildWritingWorkspaceToolsInput,
  target: ShortUnifiedTarget
): void {
  if (target.truncated) {
    throw new Error("目标快照已截断，不能在未读取完整原文时修改。");
  }
}

export function updateShortUnifiedTarget(
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
    if (!item) throw new Error(`不存在人物条目 ${target.itemId}。`);
    sharedState.characterItems.set(item.id, { ...item, content, revision });
    return revision;
  }
  const section = sharedState.expertSections.get(target.sectionId!);
  if (!section || !target.fileKind) {
    throw new Error(`不存在正文对象 ${target.sectionId}。`);
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
