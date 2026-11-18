import type {
  AcademicBook,
  AcademicFrameworkStage,
  AcademicManuscriptSection,
  AcademicReferenceCard,
  CatalogDocument
} from "@deepwrite/contracts/renderer";
import {
  academicCardTypeBadge,
  academicCitationStyleLabel,
  academicFrameworkStageLabel,
  academicSubtypeLabel,
  academicTreeT
} from "../components/academic/academicTreeLabels";
import type { ResourceTreeNode, WorkspaceDocument } from "../types/workspace";
import {
  registerAcademicBookProjector,
  type DraftDirectoryProjection,
  type DraftSectionProjection
} from "./catalogWorkspace";

function catalogNodeId(...parts: string[]): string {
  return ["catalog", ...parts.map((part) => encodeURIComponent(part))].join(
    ":"
  );
}

function bookDocumentId(bookId: string, documentId: string): string {
  return catalogNodeId("book-document", bookId, documentId);
}

function indexedContentBytes(value: object): number | undefined {
  const candidate = (value as Record<string, unknown>).contentBytes;
  return typeof candidate === "number" && Number.isSafeInteger(candidate)
    ? candidate
    : undefined;
}

function indexedContentStamp(value: object): string | undefined {
  const candidate = (value as Record<string, unknown>).contentStamp;
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : undefined;
}

function catalogContentState(
  value: object
): Pick<
  WorkspaceDocument,
  "catalogContentBytes" | "catalogContentStamp" | "catalogContentLoaded"
> {
  const contentBytes = indexedContentBytes(value);
  const contentStamp = indexedContentStamp(value);
  return contentBytes === undefined
    ? { catalogContentLoaded: true }
    : {
        catalogContentBytes: contentBytes,
        ...(contentStamp ? { catalogContentStamp: contentStamp } : {}),
        catalogContentLoaded: false
      };
}

function baseAcademicDocument(
  book: AcademicBook,
  source: CatalogDocument,
  academicZone: NonNullable<WorkspaceDocument["academicZone"]>,
  academicDocKind: NonNullable<WorkspaceDocument["academicDocKind"]>,
  format: NonNullable<WorkspaceDocument["format"]>
) {
  return {
    id: bookDocumentId(book.id, source.id),
    domain: "creation" as const,
    content: source.content,
    ...catalogContentState(source),
    format,
    workspaceId: book.id,
    workspaceType: "academic" as const,
    workspaceTitle: book.title,
    workspaceCategories: [
      academicSubtypeLabel(book.subtype),
      academicCitationStyleLabel(book.citationStyle)
    ],
    academicZone,
    academicDocKind,
    academicSubtype: book.subtype,
    citationStyle: book.citationStyle,
    catalogDocumentId: source.id,
    ...(book.projectRevision === undefined
      ? {}
      : { catalogProjectRevision: book.projectRevision })
  };
}

function createFoundationFixedDocument(
  book: AcademicBook,
  source: CatalogDocument,
  kind: "thesis_overview" | "terminology"
): WorkspaceDocument {
  const label = () =>
    kind === "thesis_overview"
      ? academicTreeT("thesisOverview")
      : academicTreeT("terminology");
  return {
    ...baseAcademicDocument(book, source, "foundation", kind, "设定"),
    get title() {
      return label();
    },
    get eyebrow() {
      return `${academicTreeT("academicWork")} · ${academicSubtypeLabel(book.subtype)} · ${academicTreeT("zoneFoundation")}`;
    },
    get path() {
      return [book.title, academicTreeT("zoneFoundation"), label()];
    }
  };
}

function createReferenceCardDocument(
  book: AcademicBook,
  card: AcademicReferenceCard
): WorkspaceDocument {
  return {
    ...baseAcademicDocument(
      book,
      card.document,
      "foundation",
      "reference_card",
      "素材"
    ),
    get title() {
      return card.title;
    },
    get eyebrow() {
      return `${academicTreeT("academicWork")} · ${academicTreeT("referenceCards")} · [${card.citeKey}]`;
    },
    get path() {
      return [
        book.title,
        academicTreeT("zoneFoundation"),
        academicTreeT("referenceCards"),
        `[${card.citeKey}] ${card.title}`
      ];
    },
    academicCardId: card.id,
    academicCiteKey: card.citeKey,
    academicCardType: card.cardType
  };
}

function createFrameworkStageDocument(
  book: AcademicBook,
  stage: AcademicFrameworkStage,
  stageOrder: number,
  source: CatalogDocument
): WorkspaceDocument {
  const stageTitle = () => academicFrameworkStageLabel(stage);
  return {
    ...baseAcademicDocument(
      book,
      source,
      "framework",
      "framework_stage",
      "设定"
    ),
    get title() {
      return stageTitle();
    },
    get eyebrow() {
      return `${academicTreeT("academicWork")} · ${academicTreeT("zoneFramework")} · ${stageTitle()}`;
    },
    get path() {
      return [book.title, academicTreeT("zoneFramework"), stageTitle()];
    },
    stageId: stage.id,
    plotStageDescription: stage.description,
    plotStageOrder: stageOrder
  };
}

function createAcademicSectionFileDocument(
  book: AcademicBook,
  section: AcademicManuscriptSection,
  sectionOrder: number,
  chapterTitle: string | undefined,
  fileKind: "brief" | "body" | "state",
  draftDirectoryId: string
): WorkspaceDocument {
  const source =
    fileKind === "brief"
      ? section.brief
      : fileKind === "body"
        ? section.body
        : section.state;
  const tabLabel = () =>
    fileKind === "brief"
      ? academicTreeT("tabBrief")
      : fileKind === "body"
        ? academicTreeT("tabBody")
        : academicTreeT("tabState");
  return {
    ...baseAcademicDocument(
      book,
      source,
      "manuscript",
      "section",
      fileKind === "body" ? "正文" : fileKind === "state" ? "账本" : "设定"
    ),
    get title() {
      return fileKind === "body"
        ? section.title
        : `${section.title} · ${tabLabel()}`;
    },
    get eyebrow() {
      return chapterTitle
        ? `${academicTreeT("academicWork")} · ${chapterTitle} · ${tabLabel()}`
        : `${academicTreeT("academicWork")} · ${academicTreeT("zoneManuscript")} · ${tabLabel()}`;
    },
    get path() {
      return chapterTitle
        ? [
            book.title,
            academicTreeT("zoneManuscript"),
            chapterTitle,
            section.title,
            tabLabel()
          ]
        : [
            book.title,
            academicTreeT("zoneManuscript"),
            section.title,
            tabLabel()
          ];
    },
    stageId: "draft",
    expertSectionId: section.id,
    expertSectionOrder: sectionOrder,
    expertWordCountRequirement: section.wordCountRequirement,
    draftDirectoryId,
    draftFileKind: fileKind,
    ...(section.chapterId ? { academicChapterId: section.chapterId } : {}),
    ...(chapterTitle ? { academicChapterTitle: chapterTitle } : {})
  };
}

function isReferencesSectionTitle(title: string): boolean {
  const normalized = title.trim().toLocaleLowerCase();
  return (
    normalized === "参考文献" ||
    normalized === "references" ||
    normalized === "bibliography"
  );
}

export function createAcademicBookProjection(book: AcademicBook): {
  node: ResourceTreeNode;
  documents: WorkspaceDocument[];
  draftDirectory: DraftDirectoryProjection;
} {
  const thesisDoc = createFoundationFixedDocument(
    book,
    book.foundation.thesisOverview,
    "thesis_overview"
  );
  const terminologyDoc = createFoundationFixedDocument(
    book,
    book.foundation.terminology,
    "terminology"
  );
  const cardEntries = book.foundation.cards.map((card) => {
    const doc = createReferenceCardDocument(book, card);
    const node: ResourceTreeNode = {
      id: doc.id,
      get label() {
        return `[${card.citeKey}] ${card.title}`;
      },
      get badge() {
        return academicCardTypeBadge(card.cardType);
      },
      icon: "file",
      catalogNodeType: "document",
      workspaceType: "academic",
      academicZone: "foundation",
      academicCardItem: {
        bookId: book.id,
        cardId: card.id,
        citeKey: card.citeKey,
        cardType: card.cardType,
        title: card.title
      }
    };
    return { doc, node };
  });

  const foundationCardsNode: ResourceTreeNode = {
    id: catalogNodeId("academic-cards", book.id),
    get label() {
      return academicTreeT("referenceCards");
    },
    get badge() {
      return String(book.foundation.cards.length);
    },
    icon: "quote",
    catalogNodeType: "category",
    workspaceType: "academic",
    academicZone: "foundation",
    selectableBranch: cardEntries.length > 0,
    ...(cardEntries[0] ? { targetDocumentId: cardEntries[0].doc.id } : {}),
    academicCollection: {
      kind: "reference-cards",
      bookId: book.id
    },
    children: cardEntries.map((item) => item.node)
  };

  const foundationNode: ResourceTreeNode = {
    id: catalogNodeId("academic-zone", book.id, "foundation"),
    get label() {
      return academicTreeT("zoneFoundation");
    },
    icon: "ledger",
    catalogNodeType: "category",
    workspaceType: "academic",
    academicZone: "foundation",
    selectableBranch: true,
    targetDocumentId: thesisDoc.id,
    children: [
      {
        id: thesisDoc.id,
        get label() {
          return academicTreeT("thesisOverview");
        },
        icon: "file",
        catalogNodeType: "document",
        workspaceType: "academic",
        academicZone: "foundation"
      },
      {
        id: terminologyDoc.id,
        get label() {
          return academicTreeT("terminology");
        },
        icon: "file",
        catalogNodeType: "document",
        workspaceType: "academic",
        academicZone: "foundation"
      },
      foundationCardsNode
    ]
  };

  const docById = new Map(
    book.documents.map((document) => [document.id, document] as const)
  );
  const enabledStages = book.frameworkStages.filter((stage) => stage.enabled);
  const frameworkEntries = enabledStages.flatMap((stage, stageOrder) => {
    const source = docById.get(stage.id);
    if (!source) return [];
    const doc = createFrameworkStageDocument(book, stage, stageOrder, source);
    const node: ResourceTreeNode = {
      id: doc.id,
      get label() {
        return academicFrameworkStageLabel(stage);
      },
      icon: "file",
      catalogNodeType: "document",
      stageCategoryId: stage.id,
      workspaceType: "academic",
      academicZone: "framework"
    };
    return [{ doc, node }];
  });

  const frameworkNode: ResourceTreeNode = {
    id: catalogNodeId("academic-zone", book.id, "framework"),
    get label() {
      return academicTreeT("zoneFramework");
    },
    icon: "sparkles",
    catalogNodeType: "category",
    stageCategoryId: "plot",
    workspaceType: "academic",
    academicZone: "framework",
    selectableBranch: frameworkEntries.length > 0,
    ...(frameworkEntries[0]
      ? { targetDocumentId: frameworkEntries[0].doc.id }
      : {}),
    academicCollection: {
      kind: "framework-stages",
      bookId: book.id
    },
    children: frameworkEntries.map((item) => item.node)
  };

  const draftDirectoryNodeId = catalogNodeId(
    "book-draft-directory",
    book.id,
    "manuscript"
  );
  const chapters = book.manuscript.chapters;
  const chapterById = new Map(
    chapters.map((chapter) => [chapter.id, chapter] as const)
  );
  const totalSections = book.manuscript.sections.length;

  let orderedSections: AcademicManuscriptSection[];
  const sectionsByChapterId = new Map<string, AcademicManuscriptSection[]>();
  const leadingUnchaptered: AcademicManuscriptSection[] = [];
  const trailingUnchaptered: AcademicManuscriptSection[] = [];

  if (chapters.length === 0) {
    orderedSections = [...book.manuscript.sections];
  } else {
    for (const chapter of chapters) {
      sectionsByChapterId.set(chapter.id, []);
    }
    const firstChapteredIndex = book.manuscript.sections.findIndex((section) =>
      Boolean(section.chapterId && chapterById.has(section.chapterId))
    );
    for (const [index, section] of book.manuscript.sections.entries()) {
      if (section.chapterId && sectionsByChapterId.has(section.chapterId)) {
        sectionsByChapterId.get(section.chapterId)!.push(section);
      } else if (firstChapteredIndex >= 0) {
        if (index < firstChapteredIndex) {
          leadingUnchaptered.push(section);
        } else {
          trailingUnchaptered.push(section);
        }
      } else if (isReferencesSectionTitle(section.title)) {
        trailingUnchaptered.push(section);
      } else {
        leadingUnchaptered.push(section);
      }
    }
    orderedSections = [
      ...leadingUnchaptered,
      ...chapters.flatMap(
        (chapter) => sectionsByChapterId.get(chapter.id) ?? []
      ),
      ...trailingUnchaptered
    ];
  }

  const sectionOrderById = new Map(
    orderedSections.map((section, index) => [section.id, index] as const)
  );
  const sectionDocs: WorkspaceDocument[] = [];
  const sectionProjectionById = new Map<string, DraftSectionProjection>();

  for (const section of orderedSections) {
    const order = sectionOrderById.get(section.id) ?? 0;
    const chapterTitle = section.chapterId
      ? chapterById.get(section.chapterId)?.title
      : undefined;
    const briefDoc = createAcademicSectionFileDocument(
      book,
      section,
      order,
      chapterTitle,
      "brief",
      "manuscript"
    );
    const bodyDoc = createAcademicSectionFileDocument(
      book,
      section,
      order,
      chapterTitle,
      "body",
      "manuscript"
    );
    const stateDoc = createAcademicSectionFileDocument(
      book,
      section,
      order,
      chapterTitle,
      "state",
      "manuscript"
    );
    sectionDocs.push(briefDoc, bodyDoc, stateDoc);
    sectionProjectionById.set(section.id, {
      id: section.id,
      get title() {
        return section.title;
      },
      wordCountRequirement: section.wordCountRequirement,
      ...(section.chapterId ? { chapterId: section.chapterId } : {}),
      briefDocumentId: briefDoc.id,
      bodyDocumentId: bodyDoc.id,
      stateDocumentId: stateDoc.id,
      characterStateDocumentId: stateDoc.id
    });
  }

  const buildSectionNode = (
    section: AcademicManuscriptSection,
    siblingIndex: number,
    siblingCount: number
  ): ResourceTreeNode => {
    const projectedSection = sectionProjectionById.get(section.id)!;
    return {
      id: catalogNodeId(
        "book-expert-section",
        book.id,
        "manuscript",
        section.id
      ),
      get label() {
        return section.title;
      },
      icon: "file",
      catalogNodeType: "document",
      stageCategoryId: "draft",
      targetDocumentId: projectedSection.bodyDocumentId,
      ...(projectedSection.briefDocumentId
        ? { briefDocumentId: projectedSection.briefDocumentId }
        : {}),
      ...(projectedSection.stateDocumentId
        ? { stateDocumentId: projectedSection.stateDocumentId }
        : {}),
      characterStateDocumentId: projectedSection.characterStateDocumentId,
      expertSectionId: section.id,
      draftDirectoryId: "manuscript",
      workspaceType: "academic",
      academicZone: "manuscript",
      academicSectionItem: {
        bookId: book.id,
        sectionId: section.id,
        title: section.title,
        wordCountRequirement: section.wordCountRequirement,
        ...(section.chapterId ? { chapterId: section.chapterId } : {}),
        moveUpDisabled: siblingIndex === 0,
        moveDownDisabled: siblingIndex >= siblingCount - 1,
        deletable: totalSections > 1
      }
    };
  };

  let manuscriptChildren: ResourceTreeNode[];
  if (chapters.length === 0) {
    manuscriptChildren = orderedSections.map((section, index) =>
      buildSectionNode(section, index, orderedSections.length)
    );
  } else {
    const unchapteredPool = [...leadingUnchaptered, ...trailingUnchaptered];
    const unchapteredIndexById = new Map(
      unchapteredPool.map((section, index) => [section.id, index] as const)
    );
    const leadingNodes = leadingUnchaptered.map((section) =>
      buildSectionNode(
        section,
        unchapteredIndexById.get(section.id) ?? 0,
        unchapteredPool.length
      )
    );
    const chapterNodes = chapters.map((chapter, chapterIndex) => {
      const chapterSections = sectionsByChapterId.get(chapter.id) ?? [];
      const childNodes = chapterSections.map((section, sectionIndex) =>
        buildSectionNode(section, sectionIndex, chapterSections.length)
      );
      const firstProjected = chapterSections[0]
        ? sectionProjectionById.get(chapterSections[0].id)
        : undefined;
      return {
        id: catalogNodeId("academic-chapter", book.id, chapter.id),
        get label() {
          return chapter.title;
        },
        icon: "folder" as const,
        catalogNodeType: "category" as const,
        workspaceType: "academic" as const,
        academicZone: "manuscript" as const,
        selectableBranch: childNodes.length > 0,
        ...(firstProjected
          ? { targetDocumentId: firstProjected.bodyDocumentId }
          : {}),
        academicCollection: {
          kind: "manuscript-chapter" as const,
          bookId: book.id,
          chapterId: chapter.id,
          chapterTitle: chapter.title
        },
        academicChapterItem: {
          bookId: book.id,
          chapterId: chapter.id,
          title: chapter.title,
          moveUpDisabled: chapterIndex === 0,
          moveDownDisabled: chapterIndex >= chapters.length - 1
        },
        children: childNodes
      };
    });
    const trailingNodes = trailingUnchaptered.map((section) =>
      buildSectionNode(
        section,
        unchapteredIndexById.get(section.id) ?? 0,
        unchapteredPool.length
      )
    );
    manuscriptChildren = [...leadingNodes, ...chapterNodes, ...trailingNodes];
  }

  const draftDirectory: DraftDirectoryProjection = {
    id: draftDirectoryNodeId,
    workspaceId: book.id,
    workspaceType: "academic",
    get title() {
      return academicTreeT("zoneManuscript");
    },
    sections: orderedSections.map((section) =>
      sectionProjectionById.get(section.id)!
    )
  };

  const manuscriptNode: ResourceTreeNode = {
    id: draftDirectoryNodeId,
    get label() {
      return academicTreeT("zoneManuscript");
    },
    icon: "folder",
    catalogNodeType: "category",
    stageCategoryId: "draft",
    selectableBranch: true,
    draftDirectoryId: "manuscript",
    workspaceType: "academic",
    academicZone: "manuscript",
    academicCollection: {
      kind: "manuscript-root",
      bookId: book.id
    },
    children: manuscriptChildren
  };

  return {
    node: {
      id: book.id,
      get label() {
        return book.title;
      },
      icon: "book",
      get badge() {
        return academicTreeT("academicWork");
      },
      get categoryTag() {
        return academicSubtypeLabel(book.subtype);
      },
      workspaceType: "academic",
      academicSubtype: book.subtype,
      citationStyle: book.citationStyle,
      catalogNodeType: "book",
      ...(book.projectRevision === undefined
        ? {}
        : { projectRevision: book.projectRevision }),
      boundMaterialLibraryIds: [...new Set(book.linkedMaterialIds)],
      boundSkillLibraryIds: [...new Set(book.linkedSkillIds)],
      children: [foundationNode, frameworkNode, manuscriptNode]
    },
    documents: [
      thesisDoc,
      terminologyDoc,
      ...cardEntries.map((item) => item.doc),
      ...frameworkEntries.map((item) => item.doc),
      ...sectionDocs
    ],
    draftDirectory
  };
}

registerAcademicBookProjector(createAcademicBookProjection);
