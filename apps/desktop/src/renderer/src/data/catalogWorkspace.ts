import {
  MATERIAL_KINDS,
  SHORT_WORKSPACE_STAGE_IDS,
  SKILL_KINDS,
  type CatalogDocument,
  type CatalogDraftSection,
  type CatalogSnapshot,
  type MaterialKind,
  type MaterialLibrary,
  type MaterialLibraryKind,
  type MaterialStageId,
  type ShortBook,
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

export const MATERIAL_STAGE_KINDS: Record<MaterialStageId, MaterialKind> = {
  gimmick: "gimmick",
  character: "character",
  pacing: "plot",
  intro: "plot",
  plot_refine: "plot",
  draft_excerpt: "draft",
  other: "other"
};

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

const SHORT_STAGE_LABELS: Record<ShortWorkspaceStageId, string> = {
  character_design: "人物",
  plot_design: "剧情设计",
  intro_design: "导语设计",
  plot_refine: "剧情细化",
  outline: "大纲",
  draft: "正文"
};

const SHORT_STAGE_TITLE_ALIASES: Record<string, ShortWorkspaceStageId> = {
  人物: "character_design",
  人物设计: "character_design",
  剧情设计: "plot_design",
  导语设计: "intro_design",
  剧情细化: "plot_refine",
  大纲: "outline",
  短篇大纲: "outline",
  正文: "draft",
  正文编写: "draft"
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
  title: string;
  sections: DraftSectionProjection[];
}

export function resolvePreferredBookResourceId(
  projection: CatalogWorkspaceProjection | undefined,
  workspaceId: string
): string | undefined {
  return (
    projection?.draftDirectories.find(
      (directory) => directory.workspaceId === workspaceId
    )?.id ??
    projection?.workspaceDocuments.find(
      (document) => document.workspaceId === workspaceId
    )?.id
  );
}

function findProjectedResourceNode(
  nodes: readonly ResourceTreeNode[],
  resourceId: string
): ResourceTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === resourceId) return node;
    const nested = findProjectedResourceNode(node.children ?? [], resourceId);
    if (nested) return nested;
  }
  return undefined;
}

export function resolveBookWorkspaceId(
  projection: CatalogWorkspaceProjection | undefined,
  resourceId: string
): string | undefined {
  if (!projection) return undefined;
  const directory = projection.draftDirectories.find(
    (candidate) => candidate.id === resourceId
  );
  if (directory) return directory.workspaceId;

  const directDocument = projection.workspaceDocuments.find(
    (document) => document.id === resourceId
  );
  if (directDocument?.domain === "creation") return directDocument.workspaceId;

  const creationNodes =
    projection.resourceSections.find((section) => section.id === "creation")?.nodes ?? [];
  const node = findProjectedResourceNode(creationNodes, resourceId);
  if (!node) return undefined;
  if (
    node.catalogNodeType === "book" &&
    projection.draftDirectories.some(
      (candidate) => candidate.workspaceId === node.id
    )
  ) {
    return node.id;
  }
  const target = node.targetDocumentId
    ? projection.workspaceDocuments.find(
        (document) => document.id === node.targetDocumentId
      )
    : undefined;
  return target?.domain === "creation" ? target.workspaceId : undefined;
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

function catalogNodeId(...parts: string[]): string {
  return ["catalog", ...parts.map((part) => encodeURIComponent(part))].join(":");
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

function linkedMaterialLibraryIds(book: ShortBook): string[] {
  return uniqueIds(
    MATERIAL_KINDS.flatMap((kind) => book.linkedMaterialIdsByKind[kind])
  );
}

function linkedSkillLibraryIds(book: ShortBook): string[] {
  return uniqueIds(SKILL_KINDS.flatMap((kind) => book.linkedSkillIdsByKind[kind]));
}

function inferShortStageId(document: CatalogDocument): ShortWorkspaceStageId | undefined {
  const candidates = [
    document.id,
    ...document.id.split(/[/:.]/).reverse(),
    document.title
  ];
  for (const candidate of candidates) {
    if (SHORT_WORKSPACE_STAGE_IDS.includes(candidate as ShortWorkspaceStageId)) {
      return candidate as ShortWorkspaceStageId;
    }
    const alias = SHORT_STAGE_TITLE_ALIASES[candidate.trim()];
    if (alias) {
      return alias;
    }
  }
  return undefined;
}

function createBookDocument(
  book: ShortBook,
  document: CatalogDocument,
  stageId: ShortWorkspaceStageId | undefined
): WorkspaceDocument {
  const stageLabel = stageId ? SHORT_STAGE_LABELS[stageId] : document.title;
  const path =
    stageId === "plot_design" || stageId === "intro_design" || stageId === "plot_refine"
      ? [book.title, "剧情", stageLabel]
      : stageId
        ? [book.title, stageLabel]
        : [book.title, "其他文稿", document.title];
  return {
    id: bookDocumentId(book.id, document.id),
    domain: "creation",
    title: document.title,
    eyebrow: stageId ? `短篇 · ${stageLabel}` : "短篇 · 其他文稿",
    path,
    content: document.content,
    format: stageId === "draft" ? "正文" : "设定",
    workspaceId: book.id,
    workspaceType: "short",
    workspaceTitle: book.title,
    workspaceCategories: [book.genre],
    ...(stageId ? { stageId } : {}),
    catalogDocumentId: document.id,
    ...(book.projectRevision === undefined
      ? {}
      : { catalogProjectRevision: book.projectRevision })
  };
}

function createDraftFileDocument(
  book: ShortBook,
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
    eyebrow: fileKind === "body" ? "短篇 · 小节正文" : "短篇 · 人物状态",
    path: [book.title, book.draft.title, section.title, fileLabel],
    content: source.content,
    format: fileKind === "body" ? "正文" : "账本",
    workspaceId: book.id,
    workspaceType: "short",
    workspaceTitle: book.title,
    workspaceCategories: [book.genre],
    stageId: "draft",
    shortAgentId: "expert_section_writer",
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

function createBookProjection(book: ShortBook): {
  node: ResourceTreeNode;
  documents: WorkspaceDocument[];
  draftDirectory: DraftDirectoryProjection;
} {
  const claimedStages = new Set<ShortWorkspaceStageId>();
  const projected = book.documents.map((document) => {
    const inferred = inferShortStageId(document);
    const stageId =
      inferred && inferred !== "draft" && !claimedStages.has(inferred)
        ? inferred
        : undefined;
    if (stageId) {
      claimedStages.add(stageId);
    }
    return {
      source: document,
      stageId,
      document: createBookDocument(book, document, stageId)
    };
  });
  const stageNodes = new Map<ShortWorkspaceStageId, ResourceTreeNode>();
  const otherNodes: ResourceTreeNode[] = [];
  for (const item of projected) {
    const node: ResourceTreeNode = {
      id: item.document.id,
      label: item.document.title,
      icon: "file",
      catalogNodeType: "document",
      stageCategoryId: item.stageId ?? "other",
      ...(item.stageId ? {} : { muted: false })
    };
    if (item.stageId) {
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
  const draftDocuments = book.draft.sections.flatMap((section, sectionOrder) => [
    createDraftFileDocument(book, section, sectionOrder, "body"),
    createDraftFileDocument(book, section, sectionOrder, "character-state")
  ]);
  const draftDirectory: DraftDirectoryProjection = {
    id: draftDirectoryId,
    workspaceId: book.id,
    title: book.draft.title,
    sections: book.draft.sections.map((section) => ({
      id: section.id,
      title: section.title,
      wordCountRequirement: section.wordCountRequirement,
      bodyDocumentId: bookDocumentId(book.id, section.body.id),
      characterStateDocumentId: bookDocumentId(book.id, section.characterState.id)
    }))
  };
  stageNodes.set("draft", {
    id: draftDirectoryId,
    label: book.draft.title,
    icon: "folder",
    catalogNodeType: "category",
    stageCategoryId: "draft",
    selectableBranch: true,
    shortAgentId: "expert_draft_coordinator",
    draftDirectoryId: book.draft.id,
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
      shortAgentId: "expert_section_writer",
      expertSectionId: section.id,
      draftDirectoryId: book.draft.id
    }))
  });

  const children: ResourceTreeNode[] = [];
  const character = stageNodes.get("character_design");
  if (character) children.push(character);
  const plotChildren = ["plot_design", "intro_design", "plot_refine"]
    .map((stageId) => stageNodes.get(stageId as ShortWorkspaceStageId))
    .filter((node): node is ResourceTreeNode => node !== undefined);
  if (plotChildren.length) {
    children.push({
      id: catalogNodeId("book-category", book.id, "plot"),
      label: "剧情",
      icon: "sparkles",
      catalogNodeType: "category",
      stageCategoryId: "plot",
      children: plotChildren
    });
  }
  const outline = stageNodes.get("outline");
  if (outline) children.push(outline);
  const draft = stageNodes.get("draft");
  if (draft) children.push(draft);
  if (otherNodes.length) {
    children.push({
      id: catalogNodeId("book-category", book.id, "other"),
      label: "其他文稿",
      icon: "folder",
      catalogNodeType: "category",
      stageCategoryId: "other",
      children: otherNodes
    });
  }

  return {
    node: {
      id: book.id,
      label: book.title,
      icon: "book",
      badge: "短篇",
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
    ...(library.parentGenre.trim() ? { parentGenre: library.parentGenre.trim() } : {}),
    ...(library.subGenre.trim() ? { subGenre: library.subGenre.trim() } : {}),
    children: [
      {
        id: materialOverviewDocumentId(library.id),
        label: "库介绍",
        icon: "file",
        muted: !library.overview.trim(),
        catalogNodeType: "document",
        libraryId: library.id,
        ...(library.materialKind === "mixed" ? {} : { materialKind: library.materialKind })
      },
      ...library.entries.map((entry) => ({
        id: materialEntryDocumentId(library.id, entry.id),
        label: entry.title,
        icon: "file" as const,
        catalogNodeType: "document" as const,
        libraryId: library.id,
        catalogEntryId: entry.id,
        materialKind: MATERIAL_STAGE_KINDS[entry.stageId],
        stageCategoryId: entry.stageId,
        ...(library.parentGenre.trim() ? { parentGenre: library.parentGenre.trim() } : {}),
        ...(library.subGenre.trim() ? { subGenre: library.subGenre.trim() } : {})
      }))
    ]
  };
}

function createMaterialDocuments(library: MaterialLibrary): WorkspaceDocument[] {
  const typeLabel = `${LIBRARY_TYPE_LABELS[library.materialType]}素材`;
  const genreParts = materialGenreParts(library);
  const overviewKind = library.materialKind === "mixed" ? undefined : library.materialKind;
  const overview: WorkspaceDocument = {
    id: materialOverviewDocumentId(library.id),
    domain: "material",
    title: `${library.title} · 库介绍`,
    eyebrow: [typeLabel, ...genreParts, MATERIAL_KIND_LABELS[library.materialKind]].join(" · "),
    path: [library.title, "库介绍"],
    content: library.overview,
    format: "素材",
    readOnly: true,
    libraryId: library.id,
    ...(library.projectRevision === undefined
      ? {}
      : { catalogProjectRevision: library.projectRevision }),
    ...(overviewKind ? { materialKind: overviewKind } : {}),
    ...(library.parentGenre.trim() ? { parentGenre: library.parentGenre.trim() } : {}),
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
        eyebrow: [typeLabel, ...genreParts, MATERIAL_KIND_LABELS[kind]].join(" · "),
        path: [
          library.title,
          MATERIAL_KIND_LABELS[kind],
          ...genreParts,
          MATERIAL_STAGE_LABELS[entry.stageId],
          entry.title
        ],
        content: entry.body,
        format: "素材" as const,
        catalogEntryId: entry.id,
        libraryId: library.id,
        ...(library.projectRevision === undefined
          ? {}
          : { catalogProjectRevision: library.projectRevision }),
        materialKind: kind,
        stageCategoryId: entry.stageId,
        ...(library.parentGenre.trim() ? { parentGenre: library.parentGenre.trim() } : {}),
        ...(library.subGenre.trim() ? { subGenre: library.subGenre.trim() } : {})
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

function missingLibraryNode(domain: "material" | "skill", libraryId: string): ResourceTreeNode {
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

function createMaterialGroupNodes(snapshot: CatalogSnapshot): ResourceTreeNode[] {
  const librariesById = new Map(snapshot.materials.map((library) => [library.id, library]));
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
      return [{ ...node, categoryTag: MATERIAL_TREE_KIND_LABELS[kind], groupId: group.id }];
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
    children: [
      {
        id: skillOverviewDocumentId(library.id),
        label: "库说明",
        icon: "file",
        muted: !library.overview.trim(),
        catalogNodeType: "document",
        libraryId: library.id,
        readOnly: library.isBuiltin,
        skillKind: library.skillKind
      },
      ...library.entries.map((entry) => ({
        id: skillEntryDocumentId(library.id, entry.id),
        label: entry.title,
        icon: "wand" as const,
        catalogNodeType: "document" as const,
        libraryId: library.id,
        catalogEntryId: entry.id,
        readOnly: library.isBuiltin,
        skillKind: library.skillKind,
        stageCategoryId: entry.stageId
      }))
    ]
  };
}

function createSkillDocuments(library: SkillLibrary): WorkspaceDocument[] {
  const typeLabel = `${LIBRARY_TYPE_LABELS[library.skillType]}技能`;
  const readOnly = library.isBuiltin ? { readOnly: true as const } : {};
  return [
    {
      id: skillOverviewDocumentId(library.id),
      domain: "skill",
      title: `${library.title} · 库说明`,
      eyebrow: `${typeLabel} · ${SKILL_KIND_LABELS[library.skillKind]}`,
      path: [library.title, "库说明"],
      content: library.overview,
      format: "技能",
      readOnly: true,
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
  const librariesById = new Map(snapshot.skills.map((library) => [library.id, library]));
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
      return [{ ...node, categoryTag: SKILL_KIND_TAG_LABELS[kind], groupId: group.id }];
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
export function projectCatalogWorkspace(snapshot: CatalogSnapshot): CatalogWorkspaceProjection {
  const bookProjections = snapshot.books.map(createBookProjection);
  const materialGroupNodes = createMaterialGroupNodes(snapshot);
  const groupedMaterialLibraryIds = new Set(
    snapshot.materialGroups.flatMap((group) =>
      Object.values(group.members).filter((libraryId): libraryId is string => Boolean(libraryId))
    )
  );
  const materialKindNodes = MATERIAL_TREE_KIND_ORDER.flatMap<ResourceTreeNode>((kind) => {
    const libraries = snapshot.materials.filter(
      (library) =>
        !groupedMaterialLibraryIds.has(library.id) &&
        (library.materialKind === kind ||
          (kind === "other" && library.materialKind === "mixed"))
    );
    return libraries.length ? [createMaterialKindNode(kind, libraries)] : [];
  });
  const skillGroupNodes = createSkillGroupNodes(snapshot);
  const groupedSkillLibraryIds = new Set(
    snapshot.skillGroups.flatMap((group) =>
      Object.values(group.members).filter((libraryId): libraryId is string => Boolean(libraryId))
    )
  );
  const diagnosticBookNodes: ResourceTreeNode[] = (snapshot.projectDiagnostics ?? [])
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
  const diagnosticSkillNodes: ResourceTreeNode[] = (snapshot.projectDiagnostics ?? [])
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
  const diagnosticMaterialNodes: ResourceTreeNode[] = (snapshot.projectDiagnostics ?? [])
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

  return {
    resourceSections: [
      {
        id: "creation",
        label: "创作空间",
        icon: "book",
        nodes: [...diagnosticBookNodes, ...bookProjections.map(({ node }) => node)]
      },
      {
        id: "skill",
        label: "技能库",
        icon: "library",
        nodes: [
          ...diagnosticSkillNodes,
          ...skillGroupNodes,
          ...skillKindNodes
        ]
      },
      {
        id: "material",
        label: "素材库",
        icon: "archive",
        nodes: [...diagnosticMaterialNodes, ...materialGroupNodes, ...materialKindNodes]
      }
    ],
    workspaceDocuments: [
      ...bookProjections.flatMap(({ documents }) => documents),
      ...snapshot.skills.flatMap(createSkillDocuments),
      ...snapshot.materials.flatMap(createMaterialDocuments)
    ],
    draftDirectories: bookProjections.map(({ draftDirectory }) => draftDirectory)
  };
}

export const buildCatalogWorkspace = projectCatalogWorkspace;
