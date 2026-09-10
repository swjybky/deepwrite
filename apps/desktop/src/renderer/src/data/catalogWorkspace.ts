import { MATERIAL_STAGE_KINDS } from "@deepwrite/contracts/renderer";
import {
  MATERIAL_KINDS,
  SKILL_KINDS,
  type CatalogDocument,
  type CatalogDraftSection,
  type CatalogSnapshot,
  type Book,
  type MaterialKind,
  type MaterialLibrary,
  type MaterialLibraryKind,
  type MaterialStageId,
  type ShortWorkspaceStageId,
  type SkillKind,
  type SkillLibrary,
  type SkillStageId
} from "@deepwrite/contracts";
import type {
  ResourceTreeNode,
  ResourceTreeSection,
  WorkspaceDocument
} from "../types/workspace";

export const MATERIAL_KIND_LABELS: Record<MaterialLibraryKind, string> = {
  character: "人设素材库",
  gimmick: "梗素材库",
  plot: "剧情素材库",
  draft: "正文素材库",
  other: "其他素材库",
  mixed: "综合素材库"
};

export const MATERIAL_STAGE_LABELS: Record<MaterialStageId, string> = {
  gimmick: "梗",
  character: "人设",
  pacing: "剧情设计",
  intro: "导语设计",
  plot_refine: "剧情细化",
  draft_excerpt: "优秀正文片段",
  other: "其他素材"
};

export { MATERIAL_STAGE_KINDS } from "@deepwrite/contracts/renderer";

export const SKILL_KIND_LABELS: Record<SkillKind, string> = {
  general: "通用技能库",
  plot: "剧情设计技能库",
  style: "文风写作技能库",
  other: "其他技能库"
};

export const SKILL_STAGE_LABELS: Record<SkillStageId, string> = {
  character_design: "人物技能",
  plot_design: "剧情技能",
  outline: "大纲技能",
  draft: "正文专家编写技能",
  expert_section_writer: "分节写手技能"
};

const MATERIAL_TREE_KIND_ORDER: readonly MaterialKind[] = [
  "character",
  "plot",
  "gimmick",
  "draft",
  "other"
];

const MATERIAL_TREE_KIND_LABELS: Record<MaterialKind, string> = {
  character: "人设",
  plot: "剧情",
  gimmick: "梗",
  draft: "正文",
  other: "其他"
};

const SKILL_KIND_TAG_LABELS: Record<SkillKind, string> = {
  general: "通用",
  plot: "剧情",
  style: "文风",
  other: "其他"
};

const LIBRARY_TYPE_LABELS = {
  short: "短篇",
  long: "长篇",
  script: "剧本"
} as const;

export interface CatalogWorkspaceProjection {
  resourceSections: ResourceTreeSection[];
  workspaceDocuments: WorkspaceDocument[];
  draftDirectories: DraftDirectoryProjection[];
  /**
   * Read-only lookup tables built alongside the projection. Keeping these on
   * the projection makes selection, navigation and draft recovery independent
   * of repeated full-tree walks as a catalog grows.
   */
  index: CatalogWorkspaceProjectionIndex;
}

export interface CatalogWorkspaceProjectionIndex {
  resourceNodeById: ReadonlyMap<string, ResourceTreeNode>;
  workspaceDocumentById: ReadonlyMap<string, WorkspaceDocument>;
  resourceIdByDocumentId: ReadonlyMap<string, string>;
  resourceTargetDocumentIdById: ReadonlyMap<string, string>;
  draftDirectoryById: ReadonlyMap<string, DraftDirectoryProjection>;
  draftDirectoryByWorkspaceId: ReadonlyMap<string, DraftDirectoryProjection>;
  preferredResourceIdByWorkspaceId: ReadonlyMap<string, string>;
  workspaceIdByResourceId: ReadonlyMap<string, string>;
}

export interface DraftSectionProjection {
  id: string;
  title: string;
  wordCountRequirement: string;
  bodyDocumentId: string;
  characterStateDocumentId: string;
}

export interface DraftDirectoryProjection {
  id: string;
  workspaceId: string;
  workspaceType: "short" | "script";
  title: string;
  sections: DraftSectionProjection[];
}

export function resolvePreferredBookResourceId(
  projection: CatalogWorkspaceProjection | undefined,
  workspaceId: string
): string | undefined {
  return projection?.index.preferredResourceIdByWorkspaceId.get(workspaceId);
}

export function findProjectedResourceNode(
  projection: CatalogWorkspaceProjection | undefined,
  resourceId: string
): ResourceTreeNode | undefined {
  return projection?.index.resourceNodeById.get(resourceId);
}

export function resolveProjectedResourceIdForDocumentId(
  projection: CatalogWorkspaceProjection | undefined,
  documentId: string
): string | undefined {
  return projection?.index.resourceIdByDocumentId.get(documentId);
}

export function resolveProjectedResourceTargetDocumentId(
  projection: CatalogWorkspaceProjection | undefined,
  resourceId: string
): string {
  return (
    projection?.index.resourceTargetDocumentIdById.get(resourceId) ?? resourceId
  );
}

export function resolveBookWorkspaceId(
  projection: CatalogWorkspaceProjection | undefined,
  resourceId: string
): string | undefined {
  return projection?.index.workspaceIdByResourceId.get(resourceId);
}

export function findProjectedWorkspaceDocument(
  projection: CatalogWorkspaceProjection | undefined,
  documentId: string
): WorkspaceDocument | undefined {
  return projection?.index.workspaceDocumentById.get(documentId);
}

export function findProjectedDraftDirectoryForWorkspace(
  projection: CatalogWorkspaceProjection | undefined,
  workspaceId: string
): DraftDirectoryProjection | undefined {
  return projection?.index.draftDirectoryByWorkspaceId.get(workspaceId);
}

export function resolveDraftSectionResourceId(
  directoryNode: ResourceTreeNode | undefined,
  sectionId: string
): string | undefined {
  return directoryNode?.children?.find(
    (child) => child.expertSectionId === sectionId
  )?.id;
}

export function resolveDraftSectionProjection(
  directory: DraftDirectoryProjection,
  selectedSectionId?: string,
  nodeSectionId?: string
): DraftSectionProjection | undefined {
  return (
    (selectedSectionId
      ? directory.sections.find((section) => section.id === selectedSectionId)
      : undefined) ??
    (nodeSectionId
      ? directory.sections.find((section) => section.id === nodeSectionId)
      : undefined) ??
    directory.sections[0]
  );
}

function setIndexValueIfAbsent<Key, Value>(
  index: Map<Key, Value>,
  key: Key,
  value: Value
): void {
  if (!index.has(key)) index.set(key, value);
}

function createCatalogWorkspaceProjectionIndex(
  resourceSections: readonly ResourceTreeSection[],
  workspaceDocuments: readonly WorkspaceDocument[],
  draftDirectories: readonly DraftDirectoryProjection[]
): CatalogWorkspaceProjectionIndex {
  const resourceNodeById = new Map<string, ResourceTreeNode>();
  const workspaceDocumentById = new Map<string, WorkspaceDocument>();
  const resourceIdByDocumentId = new Map<string, string>();
  const resourceTargetDocumentIdById = new Map<string, string>();
  const draftDirectoryById = new Map<string, DraftDirectoryProjection>();
  const draftDirectoryByWorkspaceId = new Map<
    string,
    DraftDirectoryProjection
  >();
  const preferredResourceIdByWorkspaceId = new Map<string, string>();
  const workspaceIdByResourceId = new Map<string, string>();

  for (const directory of draftDirectories) {
    setIndexValueIfAbsent(draftDirectoryById, directory.id, directory);
    setIndexValueIfAbsent(
      draftDirectoryByWorkspaceId,
      directory.workspaceId,
      directory
    );
    setIndexValueIfAbsent(
      preferredResourceIdByWorkspaceId,
      directory.workspaceId,
      directory.id
    );
    setIndexValueIfAbsent(
      workspaceIdByResourceId,
      directory.id,
      directory.workspaceId
    );
  }

  for (const document of workspaceDocuments) {
    setIndexValueIfAbsent(workspaceDocumentById, document.id, document);
    if (!document.workspaceId) continue;
    setIndexValueIfAbsent(
      preferredResourceIdByWorkspaceId,
      document.workspaceId,
      document.id
    );
    if (document.domain === "creation") {
      setIndexValueIfAbsent(
        workspaceIdByResourceId,
        document.id,
        document.workspaceId
      );
    }
  }

  const visit = (
    nodes: readonly ResourceTreeNode[],
    creationSection: boolean
  ): void => {
    for (const node of nodes) {
      setIndexValueIfAbsent(resourceNodeById, node.id, node);
      setIndexValueIfAbsent(resourceIdByDocumentId, node.id, node.id);
      if (node.targetDocumentId) {
        setIndexValueIfAbsent(
          resourceIdByDocumentId,
          node.targetDocumentId,
          node.id
        );
      }
      if (node.characterStateDocumentId) {
        setIndexValueIfAbsent(
          resourceIdByDocumentId,
          node.characterStateDocumentId,
          node.id
        );
      }
      const targetDocumentId =
        node.targetDocumentId ??
        (node.stageCategoryId === "draft"
          ? node.children?.find((child) => child.targetDocumentId)
              ?.targetDocumentId
          : undefined) ??
        node.id;
      setIndexValueIfAbsent(
        resourceTargetDocumentIdById,
        node.id,
        targetDocumentId
      );

      if (creationSection) {
        if (
          node.catalogNodeType === "book" &&
          draftDirectoryByWorkspaceId.has(node.id)
        ) {
          setIndexValueIfAbsent(workspaceIdByResourceId, node.id, node.id);
        }
        if (node.targetDocumentId) {
          const target = workspaceDocumentById.get(node.targetDocumentId);
          if (target?.domain === "creation" && target.workspaceId) {
            setIndexValueIfAbsent(
              workspaceIdByResourceId,
              node.id,
              target.workspaceId
            );
          }
        }
      }
      visit(node.children ?? [], creationSection);
    }
  };

  for (const section of resourceSections) {
    visit(section.nodes, section.id === "creation");
  }

  return {
    resourceNodeById,
    workspaceDocumentById,
    resourceIdByDocumentId,
    resourceTargetDocumentIdById,
    draftDirectoryById,
    draftDirectoryByWorkspaceId,
    preferredResourceIdByWorkspaceId,
    workspaceIdByResourceId
  };
}

function catalogNodeId(...parts: string[]): string {
  return ["catalog", ...parts.map((part) => encodeURIComponent(part))].join(
    ":"
  );
}

function indexedContentBytes(
  value: object,
  field: "contentBytes" | "overviewContentBytes" = "contentBytes"
): number | undefined {
  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === "number" && Number.isSafeInteger(candidate)
    ? candidate
    : undefined;
}

function indexedContentStamp(
  value: object,
  field: "contentStamp" | "overviewContentStamp" = "contentStamp"
): string | undefined {
  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : undefined;
}

function catalogContentState(
  value: object,
  field: "contentBytes" | "overviewContentBytes" = "contentBytes"
): Pick<
  WorkspaceDocument,
  "catalogContentBytes" | "catalogContentStamp" | "catalogContentLoaded"
> {
  const contentBytes = indexedContentBytes(value, field);
  const contentStamp = indexedContentStamp(
    value,
    field === "overviewContentBytes" ? "overviewContentStamp" : "contentStamp"
  );
  return contentBytes === undefined
    ? { catalogContentLoaded: true }
    : {
        catalogContentBytes: contentBytes,
        ...(contentStamp ? { catalogContentStamp: contentStamp } : {}),
        catalogContentLoaded: false
      };
}

function catalogContentPresent(
  value: object,
  content: string,
  field: "contentBytes" | "overviewContentBytes" = "contentBytes"
): boolean {
  const contentBytes = indexedContentBytes(value, field);
  return contentBytes === undefined
    ? content.trim().length > 0
    : contentBytes > 0;
}

function materialEntryDocumentId(libraryId: string, entryId: string): string {
  return catalogNodeId("material-entry", libraryId, entryId);
}

function materialOverviewDocumentId(libraryId: string): string {
  return catalogNodeId("material-overview", libraryId);
}

function skillEntryDocumentId(libraryId: string, entryId: string): string {
  return catalogNodeId("skill-entry", libraryId, entryId);
}

function skillOverviewDocumentId(libraryId: string): string {
  return catalogNodeId("skill-overview", libraryId);
}

function bookDocumentId(bookId: string, documentId: string): string {
  return catalogNodeId("book-document", bookId, documentId);
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function linkedMaterialLibraryIds(book: Book): string[] {
  return uniqueIds(
    MATERIAL_KINDS.flatMap((kind) => book.linkedMaterialIdsByKind[kind])
  );
}

function linkedSkillLibraryIds(book: Book): string[] {
  return uniqueIds(
    SKILL_KINDS.flatMap((kind) => book.linkedSkillIdsByKind[kind])
  );
}

function inferWorkspaceStageId(
  document: CatalogDocument,
  enabledPlotStageIds: ReadonlySet<string>
): ShortWorkspaceStageId | undefined {
  if (
    document.id === "character_design" ||
    document.title.trim() === "人物" ||
    document.title.trim() === "人物设计"
  ) {
    return "character_design";
  }
  if (enabledPlotStageIds.has(document.id)) {
    return document.id;
  }
  return undefined;
}

function createBookDocument(
  book: Book,
  document: CatalogDocument,
  stageId: ShortWorkspaceStageId | undefined,
  plotStage: Book["plotStages"][number] | undefined,
  plotStageIndex: number,
  characterItem?: { id: string; title: string; order: number }
): WorkspaceDocument {
  const stageLabel =
    stageId === "character_design"
      ? (characterItem?.title ??
        (book.characterStructure.format === "list" ? "概览" : "人物"))
      : (plotStage?.title ?? document.title);
  const path = plotStage
    ? [book.title, "剧情", plotStage.title]
    : stageId === "character_design"
      ? characterItem
        ? [book.title, "人物", characterItem.title]
        : book.characterStructure.format === "list"
          ? [book.title, "人物", "概览"]
          : [book.title, "人物"]
      : [book.title, "剧情", document.title];
  const documentTitle =
    stageId === "character_design" &&
    !characterItem &&
    book.characterStructure.format === "list"
      ? "概览"
      : document.title;
  return {
    id: bookDocumentId(book.id, document.id),
    domain: "creation",
    title: documentTitle,
    eyebrow: stageId
      ? `${LIBRARY_TYPE_LABELS[book.bookType]} · ${stageLabel}`
      : `${LIBRARY_TYPE_LABELS[book.bookType]} · 其他文稿`,
    path,
    content: document.content,
    ...catalogContentState(document),
    format: stageId === "draft" ? "正文" : "设定",
    workspaceId: book.id,
    workspaceType: book.bookType,
    workspaceTitle: book.title,
    workspaceCategories: [book.genre],
    ...(stageId ? { stageId } : {}),
    ...(stageId === "character_design"
      ? {
          shortAgentId:
            book.bookType === "short"
              ? ("short" as const)
              : ("script" as const),
          characterFileKind: characterItem
            ? ("item" as const)
            : ("overview" as const),
          ...(characterItem
            ? {
                characterItemId: characterItem.id,
                characterItemOrder: characterItem.order
              }
            : {})
        }
      : plotStage
        ? {
            shortAgentId:
              book.bookType === "short"
                ? ("short" as const)
                : ("script" as const),
            plotStageDescription: plotStage.description,
            plotStageOrder: plotStageIndex
          }
        : {}),
    catalogDocumentId: document.id,
    ...(book.projectRevision === undefined
      ? {}
      : { catalogProjectRevision: book.projectRevision })
  };
}

function createDraftFileDocument(
  book: Book,
  section: CatalogDraftSection,
  sectionOrder: number,
  fileKind: "body" | "character-state"
): WorkspaceDocument {
  const source = fileKind === "body" ? section.body : section.characterState;
  const fileLabel = fileKind === "body" ? "正文" : "人物状态";
  return {
    id: bookDocumentId(book.id, source.id),
    domain: "creation",
    title: fileKind === "body" ? section.title : source.title,
    eyebrow:
      fileKind === "body"
        ? `${LIBRARY_TYPE_LABELS[book.bookType]} · ${book.bookType === "script" ? "剧集正文" : "小节正文"}`
        : `${LIBRARY_TYPE_LABELS[book.bookType]} · 人物状态`,
    path: [book.title, book.draft.title, section.title, fileLabel],
    content: source.content,
    ...catalogContentState(source),
    format: fileKind === "body" ? "正文" : "账本",
    workspaceId: book.id,
    workspaceType: book.bookType,
    workspaceTitle: book.title,
    workspaceCategories: [book.genre],
    stageId: "draft",
    shortAgentId: book.bookType === "short" ? "short" : "script",
    expertSectionId: section.id,
    expertSectionOrder: sectionOrder,
    expertWordCountRequirement: section.wordCountRequirement,
    draftDirectoryId: book.draft.id,
    draftFileKind: fileKind,
    catalogDocumentId: source.id,
    ...(book.projectRevision === undefined
      ? {}
      : { catalogProjectRevision: book.projectRevision })
  };
}

function createBookProjection(book: Book): {
  node: ResourceTreeNode;
  documents: WorkspaceDocument[];
  draftDirectory: DraftDirectoryProjection;
} {
  const enabledPlotStages = book.plotStages.filter((stage) => stage.enabled);
  const enabledPlotStageById = new Map(
    enabledPlotStages.map((stage) => [stage.id, stage] as const)
  );
  const enabledPlotStageOrderById = new Map(
    enabledPlotStages.map((stage, index) => [stage.id, index] as const)
  );
  const enabledPlotStageIds = new Set(enabledPlotStageById.keys());
  const plotStageIds = new Set(book.plotStages.map((stage) => stage.id));
  const characterItems = new Map(
    book.characterStructure.format === "list"
      ? book.characterStructure.items.map((item) => [item.id, item] as const)
      : []
  );
  const projected = book.documents
    .filter((document) => {
      return (
        !plotStageIds.has(document.id) || enabledPlotStageIds.has(document.id)
      );
    })
    .map((document) => {
      const characterItem = characterItems.get(document.id);
      const stageId = characterItem
        ? ("character_design" as const)
        : inferWorkspaceStageId(document, enabledPlotStageIds);
      const plotStage = stageId ? enabledPlotStageById.get(stageId) : undefined;
      return {
        source: document,
        stageId,
        characterItem,
        document: createBookDocument(
          book,
          document,
          stageId,
          plotStage,
          plotStage ? (enabledPlotStageOrderById.get(plotStage.id) ?? -1) : -1,
          characterItem
        )
      };
    });
  const stageNodes = new Map<ShortWorkspaceStageId, ResourceTreeNode>();
  const otherNodes: ResourceTreeNode[] = [];
  for (const item of projected) {
    const node: ResourceTreeNode = {
      id: item.document.id,
      label: item.stageId === "character_design" ? "人物" : item.document.title,
      icon: "file",
      catalogNodeType: "document",
      stageCategoryId: item.stageId ?? "other",
      workspaceType: book.bookType,
      ...(item.stageId ? {} : { muted: false })
    };
    if (item.stageId === "character_design" && item.characterItem) {
      // List-style character items are projected under the synthetic character directory.
    } else if (item.stageId) {
      stageNodes.set(item.stageId, node);
    } else {
      otherNodes.push(node);
    }
  }

  const draftDirectoryId = catalogNodeId(
    "book-draft-directory",
    book.id,
    book.draft.id
  );
  const draftDocuments = book.draft.sections.flatMap(
    (section, sectionOrder) => [
      createDraftFileDocument(book, section, sectionOrder, "body"),
      createDraftFileDocument(book, section, sectionOrder, "character-state")
    ]
  );
  const draftDirectory: DraftDirectoryProjection = {
    id: draftDirectoryId,
    workspaceId: book.id,
    workspaceType: book.bookType,
    title: book.draft.title,
    sections: book.draft.sections.map((section) => ({
      id: section.id,
      title: section.title,
      wordCountRequirement: section.wordCountRequirement,
      bodyDocumentId: bookDocumentId(book.id, section.body.id),
      characterStateDocumentId: bookDocumentId(
        book.id,
        section.characterState.id
      )
    }))
  };
  stageNodes.set("draft", {
    id: draftDirectoryId,
    label: book.draft.title,
    icon: "folder",
    catalogNodeType: "category",
    stageCategoryId: "draft",
    selectableBranch: true,
    shortAgentId: book.bookType === "short" ? "short" : "script",
    draftDirectoryId: book.draft.id,
    workspaceType: book.bookType,
    children: draftDirectory.sections.map((section) => ({
      id: catalogNodeId(
        "book-expert-section",
        book.id,
        book.draft.id,
        section.id
      ),
      label: section.title,
      icon: "file",
      catalogNodeType: "document",
      stageCategoryId: "draft",
      targetDocumentId: section.bodyDocumentId,
      characterStateDocumentId: section.characterStateDocumentId,
      shortAgentId: book.bookType === "short" ? "short" : "script",
      expertSectionId: section.id,
      draftDirectoryId: book.draft.id,
      workspaceType: book.bookType
    }))
  });

  const children: ResourceTreeNode[] = [];
  const character = stageNodes.get("character_design");
  if (character) {
    if (book.characterStructure.format === "list") {
      const characterItemNodes = projected
        .filter((item) => item.characterItem !== undefined)
        .sort(
          (left, right) =>
            left.characterItem!.order - right.characterItem!.order
        )
        .map((item) => ({
          id: item.document.id,
          label: item.characterItem!.title,
          icon: "file" as const,
          catalogNodeType: "document" as const,
          stageCategoryId: "character_design",
          workspaceType: book.bookType,
          shortAgentId:
            book.bookType === "short"
              ? ("short" as const)
              : ("script" as const),
          characterItemId: item.characterItem!.id
        }));
      children.push({
        id: catalogNodeId("book-category", book.id, "character"),
        label: "人物",
        icon: "user",
        catalogNodeType: "category",
        stageCategoryId: "character_design",
        workspaceType: book.bookType,
        selectableBranch: true,
        targetDocumentId: character.id,
        shortAgentId: book.bookType === "short" ? "short" : "script",
        characterDirectory: true,
        children: [{ ...character, label: "概览" }, ...characterItemNodes]
      });
    } else {
      children.push(character);
    }
  }
  const plotChildren = enabledPlotStages
    .map(({ id }) => stageNodes.get(id))
    .filter((node): node is ResourceTreeNode => node !== undefined);
  children.push({
    id: catalogNodeId("book-category", book.id, "plot"),
    label: "剧情",
    icon: "sparkles",
    catalogNodeType: "category",
    stageCategoryId: "plot",
    workspaceType: book.bookType,
    children: [...plotChildren, ...otherNodes]
  });
  const draft = stageNodes.get("draft");
  if (draft) children.push(draft);

  return {
    node: {
      id: book.id,
      label: book.title,
      icon: "book",
      badge: LIBRARY_TYPE_LABELS[book.bookType],
      workspaceType: book.bookType,
      catalogNodeType: "book",
      ...(book.projectRevision === undefined
        ? {}
        : { projectRevision: book.projectRevision }),
      boundMaterialLibraryIds: linkedMaterialLibraryIds(book),
      boundSkillLibraryIds: linkedSkillLibraryIds(book),
      boundMaterialLibraryIdsByKind: {
        ...book.linkedMaterialIdsByKind,
        character: [...book.linkedMaterialIdsByKind.character],
        gimmick: [...book.linkedMaterialIdsByKind.gimmick],
        plot: [...book.linkedMaterialIdsByKind.plot],
        draft: [...book.linkedMaterialIdsByKind.draft],
        other: [...book.linkedMaterialIdsByKind.other]
      },
      boundSkillLibraryIdsByKind: {
        ...book.linkedSkillIdsByKind,
        general: [...book.linkedSkillIdsByKind.general],
        plot: [...book.linkedSkillIdsByKind.plot],
        style: [...book.linkedSkillIdsByKind.style],
        other: [...book.linkedSkillIdsByKind.other]
      },
      children
    },
    documents: [...projected.map((item) => item.document), ...draftDocuments],
    draftDirectory
  };
}

function materialGenreParts(library: MaterialLibrary): string[] {
  return [library.parentGenre.trim(), library.subGenre.trim()].filter(Boolean);
}

function createMaterialLibraryNode(library: MaterialLibrary): ResourceTreeNode {
  return {
    id: library.id,
    label: library.title,
    icon: "archive",
    catalogNodeType: "library",
    libraryId: library.id,
    ...(library.projectRevision === undefined
      ? {}
      : { projectRevision: library.projectRevision }),
    materialKind: library.materialKind,
    workspaceType: library.materialType,
    ...(library.parentGenre.trim()
      ? { parentGenre: library.parentGenre.trim() }
      : {}),
    ...(library.subGenre.trim() ? { subGenre: library.subGenre.trim() } : {}),
    children: [
      {
        id: materialOverviewDocumentId(library.id),
        label: "库介绍",
        icon: "file",
        muted: !catalogContentPresent(
          library,
          library.overview,
          "overviewContentBytes"
        ),
        catalogNodeType: "document",
        libraryId: library.id,
        workspaceType: library.materialType,
        ...(library.materialKind === "mixed"
          ? {}
          : { materialKind: library.materialKind })
      },
      ...library.entries.map((entry) => ({
        id: materialEntryDocumentId(library.id, entry.id),
        label: entry.title,
        icon: "file" as const,
        catalogNodeType: "document" as const,
        libraryId: library.id,
        workspaceType: library.materialType,
        catalogEntryId: entry.id,
        materialKind: MATERIAL_STAGE_KINDS[entry.stageId],
        stageCategoryId: entry.stageId,
        ...(library.parentGenre.trim()
          ? { parentGenre: library.parentGenre.trim() }
          : {}),
        ...(library.subGenre.trim()
          ? { subGenre: library.subGenre.trim() }
          : {})
      }))
    ]
  };
}

function createMaterialDocuments(
  library: MaterialLibrary
): WorkspaceDocument[] {
  const typeLabel = "素材";
  const genreParts = materialGenreParts(library);
  const overviewKind =
    library.materialKind === "mixed" ? undefined : library.materialKind;
  const overview: WorkspaceDocument = {
    id: materialOverviewDocumentId(library.id),
    domain: "material",
    title: `${library.title} · 库介绍`,
    eyebrow: [
      typeLabel,
      ...genreParts,
      MATERIAL_KIND_LABELS[library.materialKind]
    ].join(" · "),
    path: [library.title, "库介绍"],
    content: library.overview,
    ...catalogContentState(library, "overviewContentBytes"),
    format: "素材",
    catalogLibraryField: "overview",
    libraryId: library.id,
    ...(library.projectRevision === undefined
      ? {}
      : { catalogProjectRevision: library.projectRevision }),
    ...(overviewKind ? { materialKind: overviewKind } : {}),
    ...(library.parentGenre.trim()
      ? { parentGenre: library.parentGenre.trim() }
      : {}),
    ...(library.subGenre.trim() ? { subGenre: library.subGenre.trim() } : {})
  };
  return [
    overview,
    ...library.entries.map((entry) => {
      const kind = MATERIAL_STAGE_KINDS[entry.stageId];
      return {
        id: materialEntryDocumentId(library.id, entry.id),
        domain: "material" as const,
        title: entry.title,
        eyebrow: [typeLabel, ...genreParts, MATERIAL_KIND_LABELS[kind]].join(
          " · "
        ),
        path: [
          library.title,
          MATERIAL_KIND_LABELS[kind],
          ...genreParts,
          MATERIAL_STAGE_LABELS[entry.stageId],
          entry.title
        ],
        content: entry.body,
        ...catalogContentState(entry),
        format: "素材" as const,
        catalogEntryId: entry.id,
        libraryId: library.id,
        ...(library.projectRevision === undefined
          ? {}
          : { catalogProjectRevision: library.projectRevision }),
        materialKind: kind,
        stageCategoryId: entry.stageId,
        ...(library.parentGenre.trim()
          ? { parentGenre: library.parentGenre.trim() }
          : {}),
        ...(library.subGenre.trim()
          ? { subGenre: library.subGenre.trim() }
          : {})
      };
    })
  ];
}

function createMaterialKindNode(
  kind: MaterialKind,
  libraries: readonly MaterialLibrary[]
): ResourceTreeNode {
  return {
    id: catalogNodeId("material-kind", kind),
    label: MATERIAL_TREE_KIND_LABELS[kind],
    icon: "archive",
    badge: String(libraries.length),
    catalogNodeType: "category",
    materialKind: kind,
    children: libraries.map(createMaterialLibraryNode)
  };
}

function missingLibraryNode(
  domain: "material" | "skill",
  libraryId: string
): ResourceTreeNode {
  return {
    id: catalogNodeId(domain, "missing-library", libraryId),
    label: `已丢失的${domain === "material" ? "素材" : "技能"}库（${libraryId}）`,
    icon: domain === "material" ? "archive" : "library",
    badge: "缺失",
    muted: true,
    missing: true,
    catalogNodeType: "library",
    libraryId
  };
}

function createMaterialGroupNodes(
  snapshot: CatalogSnapshot
): ResourceTreeNode[] {
  const librariesById = new Map(
    snapshot.materials.map((library) => [library.id, library])
  );
  return snapshot.materialGroups.map((group) => {
    const seenLibraryIds = new Set<string>();
    const memberNodes = MATERIAL_KINDS.flatMap<ResourceTreeNode>((kind) => {
      const libraryId = group.members[kind];
      if (!libraryId || seenLibraryIds.has(libraryId)) {
        return [];
      }
      seenLibraryIds.add(libraryId);
      const library = librariesById.get(libraryId);
      const node = library
        ? createMaterialLibraryNode(library)
        : missingLibraryNode("material", libraryId);
      return [
        {
          ...node,
          categoryTag: MATERIAL_TREE_KIND_LABELS[kind],
          groupId: group.id
        }
      ];
    });
    return {
      id: catalogNodeId("material-group", group.id),
      label: group.title,
      icon: "folder",
      catalogNodeType: "group",
      groupId: group.id,
      ...(group.projectRevision === undefined
        ? {}
        : { projectRevision: group.projectRevision }),
      children: memberNodes
    };
  });
}

function createSkillLibraryNode(library: SkillLibrary): ResourceTreeNode {
  return {
    id: library.id,
    label: library.title,
    icon: "library",
    catalogNodeType: "library",
    libraryId: library.id,
    readOnly: library.isBuiltin,
    skillKind: library.skillKind,
    workspaceType: library.skillType,
    children: [
      {
        id: skillOverviewDocumentId(library.id),
        label: "库说明",
        icon: "file",
        muted: !catalogContentPresent(
          library,
          library.overview,
          "overviewContentBytes"
        ),
        catalogNodeType: "document",
        libraryId: library.id,
        workspaceType: library.skillType,
        readOnly: library.isBuiltin,
        skillKind: library.skillKind
      },
      ...library.entries.map((entry) => ({
        id: skillEntryDocumentId(library.id, entry.id),
        label: entry.title,
        icon: "wand" as const,
        catalogNodeType: "document" as const,
        libraryId: library.id,
        workspaceType: library.skillType,
        catalogEntryId: entry.id,
        readOnly: library.isBuiltin,
        skillKind: library.skillKind,
        stageCategoryId: entry.stageId
      }))
    ]
  };
}

function createSkillDocuments(library: SkillLibrary): WorkspaceDocument[] {
  const typeLabel = "技能";
  const readOnly = library.isBuiltin ? { readOnly: true as const } : {};
  return [
    {
      id: skillOverviewDocumentId(library.id),
      domain: "skill",
      title: `${library.title} · 库说明`,
      eyebrow: `${typeLabel} · ${SKILL_KIND_LABELS[library.skillKind]}`,
      path: [library.title, "库说明"],
      content: library.overview,
      ...catalogContentState(library, "overviewContentBytes"),
      format: "技能",
      catalogLibraryField: "overview",
      libraryId: library.id,
      ...(library.projectRevision === undefined
        ? {}
        : { catalogProjectRevision: library.projectRevision }),
      skillKind: library.skillKind,
      ...readOnly
    },
    ...library.entries.map((entry) => ({
      id: skillEntryDocumentId(library.id, entry.id),
      domain: "skill" as const,
      title: entry.title,
      eyebrow: `${typeLabel} · ${SKILL_KIND_LABELS[library.skillKind]}`,
      path: [
        library.title,
        SKILL_KIND_LABELS[library.skillKind],
        SKILL_STAGE_LABELS[entry.stageId],
        entry.title
      ],
      content: entry.body,
      ...catalogContentState(entry),
      format: "技能" as const,
      catalogEntryId: entry.id,
      libraryId: library.id,
      ...(library.projectRevision === undefined
        ? {}
        : { catalogProjectRevision: library.projectRevision }),
      skillKind: library.skillKind,
      stageCategoryId: entry.stageId,
      ...readOnly
    }))
  ];
}

function createSkillGroupNodes(snapshot: CatalogSnapshot): ResourceTreeNode[] {
  const librariesById = new Map(
    snapshot.skills.map((library) => [library.id, library])
  );
  return snapshot.skillGroups.map((group) => {
    const memberNodes = SKILL_KINDS.flatMap<ResourceTreeNode>((kind) => {
      const libraryId = group.members[kind];
      if (!libraryId) {
        return [];
      }
      const library = librariesById.get(libraryId);
      const node = library
        ? createSkillLibraryNode(library)
        : missingLibraryNode("skill", libraryId);
      return [
        { ...node, categoryTag: SKILL_KIND_TAG_LABELS[kind], groupId: group.id }
      ];
    });
    return {
      id: catalogNodeId("skill-group", group.id),
      label: group.title,
      icon: "folder",
      catalogNodeType: "group",
      groupId: group.id,
      ...(group.projectRevision === undefined
        ? {}
        : { projectRevision: group.projectRevision }),
      children: memberNodes
    };
  });
}

/**
 * Projects the persisted catalog into the renderer's generic resource trees and
 * editor documents. A library owned by a group is shown only inside that group;
 * dissolving or changing the group makes it return to its canonical kind.
 */
export function projectCatalogWorkspace(
  snapshot: CatalogSnapshot
): CatalogWorkspaceProjection {
  const bookProjections = snapshot.books.map(createBookProjection);
  const materialGroupNodes = createMaterialGroupNodes(snapshot);
  const groupedMaterialLibraryIds = new Set(
    snapshot.materialGroups.flatMap((group) =>
      Object.values(group.members).filter((libraryId): libraryId is string =>
        Boolean(libraryId)
      )
    )
  );
  const materialKindNodes = MATERIAL_TREE_KIND_ORDER.flatMap<ResourceTreeNode>(
    (kind) => {
      const libraries = snapshot.materials.filter(
        (library) =>
          !groupedMaterialLibraryIds.has(library.id) &&
          (library.materialKind === kind ||
            (kind === "other" && library.materialKind === "mixed"))
      );
      return libraries.length ? [createMaterialKindNode(kind, libraries)] : [];
    }
  );
  const skillGroupNodes = createSkillGroupNodes(snapshot);
  const groupedSkillLibraryIds = new Set(
    snapshot.skillGroups.flatMap((group) =>
      Object.values(group.members).filter((libraryId): libraryId is string =>
        Boolean(libraryId)
      )
    )
  );
  const diagnosticBookNodes: ResourceTreeNode[] = (
    snapshot.projectDiagnostics ?? []
  )
    .filter(({ kind }) => kind === "deepwrite.book")
    .map((diagnostic) => ({
      id: diagnostic.projectId,
      label: `无法读取的书籍（${diagnostic.projectId}）`,
      icon: "book",
      badge: diagnostic.code === "unavailable" ? "不可用" : "配置损坏",
      muted: true,
      unavailable: true,
      catalogNodeType: "book"
    }));
  const diagnosticSkillNodes: ResourceTreeNode[] = (
    snapshot.projectDiagnostics ?? []
  )
    .filter(({ kind }) => kind === "deepwrite.skill-library")
    .map((diagnostic) => ({
      id: diagnostic.projectId,
      label: `无法读取的技能库（${diagnostic.projectId}）`,
      icon: "library",
      badge: diagnostic.code === "unavailable" ? "不可用" : "配置损坏",
      muted: true,
      unavailable: true,
      catalogNodeType: "library",
      libraryId: diagnostic.projectId
    }));
  const diagnosticMaterialNodes: ResourceTreeNode[] = (
    snapshot.projectDiagnostics ?? []
  )
    .filter(({ kind }) => kind === "deepwrite.material-library")
    .map((diagnostic) => ({
      id: diagnostic.projectId,
      label: `无法读取的素材库（${diagnostic.projectId}）`,
      icon: "archive",
      badge: diagnostic.code === "unavailable" ? "不可用" : "配置损坏",
      muted: true,
      unavailable: true,
      catalogNodeType: "library",
      libraryId: diagnostic.projectId
    }));
  const skillKindNodes = SKILL_KINDS.flatMap<ResourceTreeNode>((kind) => {
    const libraries = snapshot.skills.filter(
      (library) =>
        library.skillKind === kind && !groupedSkillLibraryIds.has(library.id)
    );
    return libraries.length
      ? [
          {
            id: catalogNodeId("skill-kind", kind),
            label: SKILL_KIND_LABELS[kind],
            icon: "library",
            badge: String(libraries.length),
            catalogNodeType: "category",
            skillKind: kind,
            children: libraries.map(createSkillLibraryNode)
          }
        ]
      : [];
  });

  const resourceSections: ResourceTreeSection[] = [
    {
      id: "creation",
      label: "创作空间",
      icon: "book",
      nodes: [
        ...diagnosticBookNodes,
        ...bookProjections.map(({ node }) => node)
      ]
    },
    {
      id: "skill",
      label: "技能库",
      icon: "library",
      nodes: [...diagnosticSkillNodes, ...skillGroupNodes, ...skillKindNodes]
    },
    {
      id: "material",
      label: "素材库",
      icon: "archive",
      nodes: [
        ...diagnosticMaterialNodes,
        ...materialGroupNodes,
        ...materialKindNodes
      ]
    }
  ];
  const workspaceDocuments = [
    ...bookProjections.flatMap(({ documents }) => documents),
    ...snapshot.skills.flatMap(createSkillDocuments),
    ...snapshot.materials.flatMap(createMaterialDocuments)
  ];
  const draftDirectories = bookProjections.map(
    ({ draftDirectory }) => draftDirectory
  );

  return {
    resourceSections,
    workspaceDocuments,
    draftDirectories,
    index: createCatalogWorkspaceProjectionIndex(
      resourceSections,
      workspaceDocuments,
      draftDirectories
    )
  };
}

export const buildCatalogWorkspace = projectCatalogWorkspace;
