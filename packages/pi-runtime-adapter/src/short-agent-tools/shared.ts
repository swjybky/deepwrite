import type { MaterialQueryRunner } from "../material-query-runtime";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  SCRIPT_SCREENPLAY_FORMAT_REQUIREMENTS,
  type AgentWriteApprovalMode,
  type ExpertDraftSectionSnapshot,
  type ScriptWorkspaceAgentProfile,
  type ScriptWorkspaceSnapshot,
  type ShortWorkspaceAgentProfile,
  type ShortWorkspaceSnapshot,
  type ShortWorkspaceStageId,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import type { AgentUserInputRequester } from "../runtime-types";

export type ShortWorkspaceToolDetails =
  | { kind: "none" }
  | {
      kind: "workspace-editor-mutation";
      workspaceId: string;
      stageId: ShortWorkspaceStageId;
      text: string;
      baseRevision: string;
      summary: string;
    }
  | {
      kind: "workspace-character-file-mutation";
      workspaceId: string;
      stageId: "character_design";
      documentId: string;
      itemId?: string;
      text: string;
      baseRevision: string;
      summary: string;
    }
  | {
      kind: "workspace-character-structure-mutation";
      workspaceId: string;
      stageId: "character_design";
      mutation:
        | { type: "createItem"; title: string; provisionalItemId: string }
        | {
            type: "updateItem";
            itemId: string;
            previousTitle: string;
            title: string;
          }
        | {
            type: "moveItem";
            itemId: string;
            direction: "up" | "down";
            title: string;
          }
        | {
            type: "deleteItem";
            itemId: string;
            title: string;
            deletedText: string;
          };
      baseRevision: string;
      summary: string;
      /** Optional body written immediately after a same-proposal create. */
      initialContent?: string;
    }
  | {
      kind: "workspace-expert-draft-file-mutation";
      workspaceId: string;
      stageId: "draft";
      documentId: string;
      sectionId: string;
      fileKind: "body" | "characterState";
      text: string;
      baseRevision: string;
      summary: string;
    }
  | {
      kind: "workspace-expert-draft-section-creation";
      workspaceId: string;
      stageId: "draft";
      sections: Array<{
        title: string;
        wordCountRequirement: string;
        provisionalSectionId: string;
        bodyContent?: string;
        characterStateContent?: string;
      }>;
      afterSectionId?: string;
      baseRevision: string;
      summary: string;
    }
  | {
      kind: "workspace-plot-structure-mutation";
      workspaceId: string;
      stageId: ShortWorkspaceStageId;
      mutation:
        | {
            type: "create";
            title: string;
            description: string;
            provisionalStageId: string;
            content: string;
          }
        | {
            type: "update";
            stageId: ShortWorkspaceStageId;
            previousTitle: string;
            title: string;
            description: string;
          };
      baseRevision: string;
      summary: string;
    }
  | {
      kind: "workspace-expert-draft-section-rename";
      workspaceId: string;
      stageId: "draft";
      sectionId: string;
      previousTitle: string;
      title: string;
      baseRevision: string;
      summary: string;
    }
  | {
      kind: "workspace-expert-draft-section-deletion";
      workspaceId: string;
      stageId: "draft";
      sectionId: string;
      title: string;
      baseRevision: string;
      summary: string;
    }
  | {
      kind: "workspace-stage-selection";
      workspaceId: string;
      stageId: ShortWorkspaceStageId;
    };

/** Script-facing alias kept separate so its mutation protocol can diverge later. */
export type ScriptWorkspaceToolDetails = ShortWorkspaceToolDetails;

export interface BuildShortWorkspaceToolsInput {
  workspace: ShortWorkspaceSnapshot;
  profile: ShortWorkspaceAgentProfile;
  writeApprovalMode?: AgentWriteApprovalMode;
  autoApproveCrossStageOperations?: boolean;
  attachedSkills?: WorkspaceRuntimeContext["attachedSkills"];
  attachedMaterials?: WorkspaceRuntimeContext["attachedMaterials"];
  queryMaterials?: MaterialQueryRunner | undefined;
  requestUserInput?: AgentUserInputRequester;
  includeAskUserQuestion?: boolean;
  /**
   * Mutable content shared by every agent participating in the same parent run.
   * Read evidence deliberately stays outside this object and is recreated by
   * every buildShortWorkspaceTools() call.
   */
  sharedState?: ShortWorkspaceToolSharedState;
}

export interface BuildScriptWorkspaceToolsInput {
  workspace: ScriptWorkspaceSnapshot;
  profile: ScriptWorkspaceAgentProfile;
  writeApprovalMode?: AgentWriteApprovalMode;
  autoApproveCrossStageOperations?: boolean;
  attachedSkills?: WorkspaceRuntimeContext["attachedSkills"];
  attachedMaterials?: WorkspaceRuntimeContext["attachedMaterials"];
  queryMaterials?: MaterialQueryRunner | undefined;
  requestUserInput?: AgentUserInputRequester;
  includeAskUserQuestion?: boolean;
  /** Shared across the parent and its children during one script run. */
  sharedState?: ScriptWorkspaceToolSharedState;
}

export type WritingWorkspaceType = "short" | "script";

export interface WritingWorkspaceSnapshot {
  id: ShortWorkspaceSnapshot["id"];
  title: ShortWorkspaceSnapshot["title"];
  activeStageId: ShortWorkspaceStageId;
  activeAgentId?:
    | ShortWorkspaceSnapshot["activeAgentId"]
    | ScriptWorkspaceSnapshot["activeAgentId"];
  activeSectionId?: ShortWorkspaceSnapshot["activeSectionId"];
  expertDraft: ShortWorkspaceSnapshot["expertDraft"];
  plotStages: ShortWorkspaceSnapshot["plotStages"];
  characterStructure: ShortWorkspaceSnapshot["characterStructure"];
  stages: ShortWorkspaceSnapshot["stages"];
}

export interface WritingWorkspaceAgentProfile {
  id: ShortWorkspaceAgentProfile["id"] | ScriptWorkspaceAgentProfile["id"];
  readAccess:
    | ShortWorkspaceAgentProfile["readAccess"]
    | ScriptWorkspaceAgentProfile["readAccess"];
}

export interface BuildWritingWorkspaceToolsInput {
  workspaceType: WritingWorkspaceType;
  workspace: WritingWorkspaceSnapshot;
  profile: WritingWorkspaceAgentProfile;
  writeApprovalMode?: AgentWriteApprovalMode;
  autoApproveCrossStageOperations?: boolean;
  attachedSkills?: WorkspaceRuntimeContext["attachedSkills"];
  attachedMaterials?: WorkspaceRuntimeContext["attachedMaterials"];
  queryMaterials?: MaterialQueryRunner | undefined;
  requestUserInput?: AgentUserInputRequester;
  includeAskUserQuestion?: boolean;
  sharedState?: ShortWorkspaceToolSharedState;
}

export type ExpertSectionMap = Map<string, ExpertDraftSectionSnapshot>;

export interface ShortWorkspaceToolSharedState {
  stageBodies: Map<ShortWorkspaceStageId, string>;
  stageRevisions: Map<ShortWorkspaceStageId, string>;
  characterItems: Map<
    string,
    {
      id: string;
      title: string;
      order: number;
      content: string;
      revision: string;
      truncated?: boolean;
      provisional?: boolean;
    }
  >;
  characterItemOrder: string[];
  pendingCharacterSeq: number;
  plotStages: Map<
    ShortWorkspaceStageId,
    {
      id: ShortWorkspaceStageId;
      title: string;
      description: string;
      provisional?: boolean;
    }
  >;
  plotStageOrder: ShortWorkspaceStageId[];
  pendingPlotStageSeq: number;
  expertSections: ExpertSectionMap;
  /** Stable directory order including provisional sections created in this run. */
  expertSectionOrder: string[];
  pendingExpertSectionTitles: Set<string>;
  pendingSectionSeq: number;
  /**
   * Structural directory revision at run start. Section creation proposals keep
   * this base so Renderer same-run accept chaining stays valid.
   */
  expertDraftDirectoryBaseRevision: string;
}

/** Script-facing alias kept separate so its run overlay can diverge later. */
export type ScriptWorkspaceToolSharedState = ShortWorkspaceToolSharedState;

export type DraftFileKind = "body" | "characterState";

export const DRAFT_FILE_PARAMETER_VALUES = ["body", "character_state"] as const;

export function textResult(
  text: string,
  details: ShortWorkspaceToolDetails = { kind: "none" }
): AgentToolResult<ShortWorkspaceToolDetails> {
  return { content: [{ type: "text", text }], details };
}

export function workspaceKindLabel(
  input: BuildWritingWorkspaceToolsInput
): string {
  return input.workspaceType === "script" ? "剧本" : "短篇";
}

export function draftUnitLabel(input: BuildWritingWorkspaceToolsInput): string {
  return input.workspaceType === "script" ? "剧集" : "章节";
}

export function scriptBodyToolConstraint(
  input: BuildWritingWorkspaceToolsInput
): string {
  return input.workspaceType === "script"
    ? `\n当 document=body 时，剧本正文必须遵守以下不可编辑格式约束：\n${SCRIPT_SCREENPLAY_FORMAT_REQUIREMENTS.trim()}\n` +
        "写入 body 的 content 或 replacements[].new_text 不得包含 Markdown 表格、分析标题或格式讲解。"
    : "";
}

export function replaceText(
  current: string,
  replacements: Array<{ original_text: string; new_text: string }>
): { next?: string; count: number; error?: string } {
  let next = current;
  let count = 0;
  for (const replacement of replacements) {
    const original = replacement.original_text;
    if (!original) {
      return { count, error: "original_text 不能为空。" };
    }
    const first = next.indexOf(original);
    if (first < 0) {
      return { count, error: `没有找到原文片段：${original.slice(0, 80)}` };
    }
    if (next.indexOf(original, first + original.length) >= 0) {
      return {
        count,
        error: `原文片段出现多次，请提供更长且唯一的上下文：${original.slice(0, 80)}`
      };
    }
    next = `${next.slice(0, first)}${replacement.new_text}${next.slice(first + original.length)}`;
    count += 1;
  }
  return { next, count };
}

export function orderedExpertSections(
  input: BuildWritingWorkspaceToolsInput,
  expertSections: ExpertSectionMap
): ExpertDraftSectionSnapshot[] {
  const order =
    input.sharedState?.expertSectionOrder ??
    input.workspace.expertDraft.sections.map((section) => section.id);
  return order
    .map((sectionId) => expertSections.get(sectionId))
    .filter((section): section is ExpertDraftSectionSnapshot =>
      Boolean(section)
    );
}
