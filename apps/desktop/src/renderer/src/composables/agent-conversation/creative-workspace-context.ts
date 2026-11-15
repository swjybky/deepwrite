import { createScopedTranslator } from "../../i18n";
import {
  createExpertDraftDirectoryRevision,
  createShortWorkspaceContentRevision,
  ScriptWorkspaceSnapshotSchema,
  ShortWorkspaceSnapshotSchema,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts/renderer";
export { loadWritingContextForPrompt } from "./writing-context";
import type { WorkspaceDocument } from "../../types/workspace";

const t = createScopedTranslator("workspace");

/** Assemble live creative documents only when a prompt is sent. */
export function buildCreativeWorkspaceContext(
  activeDocument: WorkspaceDocument,
  workspaceDocuments: WorkspaceDocument[]
):
  | Pick<WorkspaceRuntimeContext, "shortWorkspace" | "scriptWorkspace">
  | undefined {
  if (
    (activeDocument.workspaceType !== "short" &&
      activeDocument.workspaceType !== "script") ||
    !activeDocument.workspaceId ||
    !activeDocument.workspaceTitle ||
    !activeDocument.stageId
  )
    return undefined;
  const workspaceType = activeDocument.workspaceType;
  const currentDocument = workspaceDocuments.find(
    (document) => document.id === activeDocument.id
  );
  // Keep navigation and selection in the prompt. Core owns saved text and revisions.
  const unloaded = {
    content: "",
    revision: createShortWorkspaceContentRevision("")
  };
  const liveStages = [
    ...workspaceDocuments.filter(
      (document) => document.id !== activeDocument.id
    ),
    { ...currentDocument, ...activeDocument }
  ].filter(
    (document) =>
      document.workspaceType === workspaceType &&
      document.workspaceId === activeDocument.workspaceId &&
      document.stageId
  );
  const plotStageDocuments = liveStages
    .filter(
      (document) =>
        document.draftFileKind === undefined &&
        document.plotStageOrder !== undefined &&
        document.plotStageDescription !== undefined
    )
    .sort(
      (left, right) => (left.plotStageOrder ?? 0) - (right.plotStageOrder ?? 0)
    );
  const plotStages = plotStageDocuments.map((document) => ({
    id: document.stageId!,
    title: document.title,
    description: document.plotStageDescription!
  }));
  const textStageIds = ["character_design", ...plotStages.map(({ id }) => id)];
  const stages = textStageIds.map((stageId) => {
    const document = liveStages.find(
      (candidate) =>
        candidate.stageId === stageId &&
        candidate.draftFileKind === undefined &&
        (stageId !== "character_design" ||
          candidate.characterFileKind !== "item")
    );
    if (!document) return undefined;
    return {
      stageId,
      title: document.title,
      ...unloaded
    };
  });
  const completeStages = stages.filter(
    (stage): stage is NonNullable<typeof stage> => stage !== undefined
  );
  const characterItemDocuments = liveStages
    .filter(
      (document) =>
        document.stageId === "character_design" &&
        document.characterFileKind === "item" &&
        document.characterItemId
    )
    .sort(
      (left, right) =>
        (left.characterItemOrder ?? 0) - (right.characterItemOrder ?? 0)
    );
  const characterStructure =
    characterItemDocuments.length > 0 ||
    liveStages.some(
      (document) =>
        document.stageId === "character_design" &&
        document.characterFileKind === "overview" &&
        document.path.length > 2
    )
      ? {
          format: "list" as const,
          items: characterItemDocuments.map((document, index) => {
            return {
              id: document.characterItemId!,
              title: document.title,
              order: document.characterItemOrder ?? index + 1,
              ...unloaded
            };
          })
        }
      : { format: "text" as const };
  const draftSections = new Map<
    string,
    {
      id: string;
      order: number;
      title: string;
      wordCountRequirement: string;
      body?: WorkspaceDocument;
      characterState?: WorkspaceDocument;
    }
  >();
  for (const document of liveStages) {
    if (
      document.stageId !== "draft" ||
      !document.expertSectionId ||
      !document.draftFileKind
    ) {
      continue;
    }
    const current = draftSections.get(document.expertSectionId) ?? {
      id: document.expertSectionId,
      order: document.expertSectionOrder ?? Number.MAX_SAFE_INTEGER,
      title:
        document.draftFileKind === "body"
          ? document.title
          : document.title.replace(
              /\s*·\s*(?:人物状态|状态|Character state|State)$/u,
              ""
            ),
      wordCountRequirement: document.expertWordCountRequirement ?? ""
    };
    if (document.draftFileKind === "body") {
      current.title = document.title;
      current.wordCountRequirement = document.expertWordCountRequirement ?? "";
      current.body = document;
    } else {
      current.characterState = document;
    }
    draftSections.set(document.expertSectionId, current);
  }
  const completeDraftSections = [...draftSections.values()]
    .sort((left, right) => left.order - right.order)
    .flatMap((section) => {
      if (!section.body || !section.characterState) return [];
      return [
        {
          id: section.id,
          title: section.title,
          wordCountRequirement: section.wordCountRequirement,
          body: {
            documentId: section.body.id,
            title: section.body.title,
            ...unloaded
          },
          characterState: {
            documentId: section.characterState.id,
            title: section.characterState.title,
            ...unloaded
          }
        }
      ];
    });
  if (
    completeStages.length === textStageIds.length &&
    completeDraftSections.length > 0
  ) {
    const expertDraftRevision = createExpertDraftDirectoryRevision(
      completeDraftSections.map((section) => ({
        id: section.id,
        title: section.title,
        wordCountRequirement: section.wordCountRequirement
      }))
    );
    const creativeWorkspace = {
      readSource: "core",
      id: activeDocument.workspaceId,
      title: activeDocument.workspaceTitle,
      categories: [...(activeDocument.workspaceCategories ?? [])],
      activeStageId: activeDocument.stageId,
      plotStages,
      characterStructure,
      ...(activeDocument.shortAgentId
        ? { activeAgentId: activeDocument.shortAgentId }
        : {}),
      ...(activeDocument.expertSectionId
        ? { activeSectionId: activeDocument.expertSectionId }
        : {}),
      expertDraft: {
        id: "draft",
        title:
          workspaceType === "script"
            ? t("workspaceResourceCoordinator.episode")
            : t("catalogWorkspace.manuscript"),
        revision: expertDraftRevision,
        sections: completeDraftSections
      },
      stages: completeStages
    };
    if (workspaceType === "script") {
      return {
        scriptWorkspace: ScriptWorkspaceSnapshotSchema.parse(creativeWorkspace)
      };
    } else {
      return {
        shortWorkspace: ShortWorkspaceSnapshotSchema.parse(creativeWorkspace)
      };
    }
  }
  return undefined;
}
