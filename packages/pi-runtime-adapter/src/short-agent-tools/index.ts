import { buildAskUserQuestionTool } from "../ask-user-question-tool";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  SHORT_MATERIAL_KINDS,
  SHORT_SKILL_KINDS,
  type ScriptWorkspaceSnapshot,
  type ShortWorkspaceSnapshot,
  type ShortWorkspaceStageId
} from "@deepwrite/contracts";
import {
  buildLoadSkillTool,
  buildQueryLinkedMaterialEntriesTool
} from "./catalog-tools";
import {
  type BuildScriptWorkspaceToolsInput,
  type BuildShortWorkspaceToolsInput,
  type BuildWritingWorkspaceToolsInput,
  type ScriptWorkspaceToolSharedState,
  type ShortWorkspaceToolDetails,
  type ShortWorkspaceToolSharedState,
  type WritingWorkspaceSnapshot
} from "./shared";
import { buildShortUnifiedCreateTool } from "./unified-create-tool";
import { buildShortUnifiedDeleteTool } from "./unified-delete-tool";
import { buildShortUnifiedEditTool } from "./unified-edit-tool";
import {
  buildShortUnifiedReadTool,
  createShortUnifiedReadState
} from "./unified-read-tool";

export { SHORT_WORKSPACE_TOOL_MANIFEST } from "./manifest";
export { sanitizeToolSchemaForGemini } from "./schema";
export type {
  BuildScriptWorkspaceToolsInput,
  BuildShortWorkspaceToolsInput,
  ScriptWorkspaceToolDetails,
  ScriptWorkspaceToolSharedState,
  ShortWorkspaceToolDetails,
  ShortWorkspaceToolSharedState
} from "./shared";

/**
 * Creates the per-parent-run mutation/revision overlay. Parent and child tools
 * receive this same object, while each tool set keeps its own read evidence.
 */
function createWritingWorkspaceToolSharedState(
  workspace: WritingWorkspaceSnapshot
): ShortWorkspaceToolSharedState {
  const characterStructure = workspace.characterStructure ?? {
    format: "text" as const
  };
  const expertSections = new Map(
    workspace.expertDraft.sections.map(
      (section) =>
        [
          section.id,
          {
            ...section,
            body: { ...section.body },
            characterState: { ...section.characterState }
          }
        ] as const
    )
  );
  return {
    stageBodies: new Map<ShortWorkspaceStageId, string>(
      workspace.stages.map((stage) => [stage.stageId, stage.content])
    ),
    stageRevisions: new Map<ShortWorkspaceStageId, string>(
      workspace.stages.map((stage) => [stage.stageId, stage.revision])
    ),
    characterItems: new Map(
      characterStructure.format === "list"
        ? characterStructure.items.map(
            (item) =>
              [
                item.id,
                {
                  id: item.id,
                  title: item.title,
                  order: item.order,
                  content: item.content,
                  revision: item.revision,
                  ...(item.truncated ? { truncated: true } : {})
                }
              ] as const
          )
        : []
    ),
    characterItemOrder:
      characterStructure.format === "list"
        ? [...characterStructure.items]
            .sort((left, right) => left.order - right.order)
            .map(({ id }) => id)
        : [],
    pendingCharacterSeq: 0,
    plotStages: new Map(
      workspace.plotStages.map((stage) => [stage.id, { ...stage }])
    ),
    plotStageOrder: workspace.plotStages.map(({ id }) => id),
    pendingPlotStageSeq: 0,
    expertSections,
    expertSectionOrder: workspace.expertDraft.sections.map(
      (section) => section.id
    ),
    pendingExpertSectionTitles: new Set<string>(),
    pendingSectionSeq: 0,
    expertDraftDirectoryBaseRevision: workspace.expertDraft.revision
  };
}

export function createShortWorkspaceToolSharedState(
  workspace: ShortWorkspaceSnapshot
): ShortWorkspaceToolSharedState {
  return createWritingWorkspaceToolSharedState(workspace);
}

export function createScriptWorkspaceToolSharedState(
  workspace: ScriptWorkspaceSnapshot
): ScriptWorkspaceToolSharedState {
  return createWritingWorkspaceToolSharedState(workspace);
}

function buildUnifiedWritingWorkspaceTools(
  input: BuildWritingWorkspaceToolsInput
): AgentTool[] {
  const sharedState =
    input.sharedState ?? createWritingWorkspaceToolSharedState(input.workspace);
  const toolInput = { ...input, sharedState };
  const readState = createShortUnifiedReadState();
  return [
    buildShortUnifiedReadTool(toolInput, sharedState, readState),
    buildShortUnifiedCreateTool(toolInput, sharedState),
    buildShortUnifiedEditTool(toolInput, sharedState, readState),
    buildShortUnifiedDeleteTool(toolInput, sharedState, readState),
    buildQueryLinkedMaterialEntriesTool(toolInput),
    buildLoadSkillTool(toolInput),
    ...(input.includeAskUserQuestion === false
      ? []
      : [buildAskUserQuestionTool(input.requestUserInput)])
  ];
}

export function buildShortWorkspaceTools(
  input: BuildShortWorkspaceToolsInput
): AgentTool[] {
  return buildUnifiedWritingWorkspaceTools({
    workspaceType: "short",
    ...input
  });
}

export function buildScriptWorkspaceTools(
  input: BuildScriptWorkspaceToolsInput
): AgentTool[] {
  return buildUnifiedWritingWorkspaceTools({
    workspaceType: "script",
    ...input
  });
}

export function isShortWorkspaceToolDetails(
  value: unknown
): value is ShortWorkspaceToolDetails {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "none" ||
    kind === "workspace-editor-mutation" ||
    kind === "workspace-character-file-mutation" ||
    kind === "workspace-character-structure-mutation" ||
    kind === "workspace-plot-structure-mutation" ||
    kind === "workspace-expert-draft-file-mutation" ||
    kind === "workspace-expert-draft-section-creation" ||
    kind === "workspace-expert-draft-section-rename" ||
    kind === "workspace-expert-draft-section-deletion" ||
    kind === "workspace-stage-selection"
  );
}

export function assertKnownShortWorkspaceStage(
  stageId: string
): ShortWorkspaceStageId {
  if (
    stageId !== "character_design" &&
    stageId !== "draft" &&
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(stageId)
  ) {
    throw new Error(`Unknown short workspace stage: ${stageId}`);
  }
  return stageId as ShortWorkspaceStageId;
}

export function isKnownShortMaterialKind(kind: string): boolean {
  return SHORT_MATERIAL_KINDS.includes(
    kind as (typeof SHORT_MATERIAL_KINDS)[number]
  );
}

export function isKnownShortSkillKind(kind: string): boolean {
  return SHORT_SKILL_KINDS.includes(kind as (typeof SHORT_SKILL_KINDS)[number]);
}
