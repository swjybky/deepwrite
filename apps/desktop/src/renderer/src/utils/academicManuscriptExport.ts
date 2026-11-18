import type {
  AcademicBook,
  AcademicManuscriptExportFormat,
  AcademicManuscriptImageMode,
  CatalogIndexBook,
  ExportAcademicManuscriptInput
} from "@deepwrite/contracts/renderer";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";

export type AcademicExportSourceBook =
  AcademicBook | Extract<CatalogIndexBook, { bookType: "academic" }>;

export interface AcademicManuscriptExportSectionOption {
  id: string;
  title: string;
  bodyCatalogDocumentId: string;
  bodyWorkspaceDocumentId: string | undefined;
  chapterId?: string | undefined;
  chapterTitle?: string | undefined;
  nonEmpty: boolean;
}

export interface AcademicManuscriptExportChapterGroup {
  id: string;
  title: string;
  sections: AcademicManuscriptExportSectionOption[];
}

export interface AcademicManuscriptExportTree {
  hasChapters: boolean;
  leadingSections: AcademicManuscriptExportSectionOption[];
  chapters: AcademicManuscriptExportChapterGroup[];
  trailingSections: AcademicManuscriptExportSectionOption[];
  orderedSections: AcademicManuscriptExportSectionOption[];
  defaultSelectedSectionIds: string[];
}

export interface AcademicManuscriptExportRequest {
  sectionIds: string[];
  includeChapterHeadings: boolean;
  format: AcademicManuscriptExportFormat;
  imageMode: AcademicManuscriptImageMode;
}

function isReferencesSectionTitle(title: string): boolean {
  const normalized = title.trim().toLocaleLowerCase();
  return (
    normalized === "参考文献" ||
    normalized === "references" ||
    normalized === "bibliography"
  );
}

function resolveSectionBodyInfo(
  section: AcademicExportSourceBook["manuscript"]["sections"][number],
  bodyDoc: WorkspaceDocument | undefined,
  editorDrafts: Readonly<Record<string, EditorDraftState>>
): { title: string; nonEmpty: boolean } {
  const liveDraft = bodyDoc ? editorDrafts[bodyDoc.id] : undefined;
  const resolvedTitle =
    liveDraft?.title.trim() || bodyDoc?.title.trim() || section.title;

  if (liveDraft !== undefined) {
    return {
      title: resolvedTitle,
      nonEmpty: liveDraft.content.trim().length > 0
    };
  }
  if (bodyDoc?.catalogContentLoaded) {
    return {
      title: resolvedTitle,
      nonEmpty: bodyDoc.content.trim().length > 0
    };
  }
  const rawBody = section.body as { content: string; contentBytes?: number };
  if (typeof rawBody.contentBytes === "number") {
    return {
      title: resolvedTitle,
      nonEmpty: rawBody.contentBytes > 0
    };
  }
  if (typeof bodyDoc?.catalogContentBytes === "number") {
    return {
      title: resolvedTitle,
      nonEmpty: bodyDoc.catalogContentBytes > 0
    };
  }
  return {
    title: resolvedTitle,
    nonEmpty: rawBody.content.trim().length > 0
  };
}

export function listAcademicManuscriptExportTree(
  book: AcademicExportSourceBook,
  documents: readonly WorkspaceDocument[],
  editorDrafts: Readonly<Record<string, EditorDraftState>>
): AcademicManuscriptExportTree {
  const bodyDocuments = new Map(
    documents
      .filter(
        (doc) =>
          doc.workspaceId === book.id &&
          doc.draftFileKind === "body" &&
          Boolean(doc.catalogDocumentId)
      )
      .map((doc) => [doc.catalogDocumentId!, doc] as const)
  );

  const rawChapters = book.manuscript.chapters;
  const chapterById = new Map(
    rawChapters.map((chapter) => [chapter.id, chapter] as const)
  );

  const toOption = (
    section: AcademicExportSourceBook["manuscript"]["sections"][number]
  ): AcademicManuscriptExportSectionOption => {
    const bodyDoc = bodyDocuments.get(section.body.id);
    const chapter = section.chapterId
      ? chapterById.get(section.chapterId)
      : undefined;
    const { title, nonEmpty } = resolveSectionBodyInfo(
      section,
      bodyDoc,
      editorDrafts
    );
    return {
      id: section.id,
      title,
      bodyCatalogDocumentId: section.body.id,
      bodyWorkspaceDocumentId: bodyDoc?.id,
      ...(chapter
        ? { chapterId: chapter.id, chapterTitle: chapter.title }
        : {}),
      nonEmpty
    };
  };

  if (rawChapters.length === 0) {
    const orderedSections = book.manuscript.sections.map(toOption);
    return {
      hasChapters: false,
      leadingSections: orderedSections,
      chapters: [],
      trailingSections: [],
      orderedSections,
      defaultSelectedSectionIds: orderedSections
        .filter((item) => item.nonEmpty)
        .map((item) => item.id)
    };
  }

  const byChapterId = new Map<string, AcademicManuscriptExportSectionOption[]>(
    rawChapters.map((chapter) => [chapter.id, []])
  );
  const leadingSections: AcademicManuscriptExportSectionOption[] = [];
  const trailingSections: AcademicManuscriptExportSectionOption[] = [];
  const firstChapteredIndex = book.manuscript.sections.findIndex((section) =>
    Boolean(section.chapterId && byChapterId.has(section.chapterId))
  );

  book.manuscript.sections.forEach((section, index) => {
    const option = toOption(section);
    if (section.chapterId && byChapterId.has(section.chapterId)) {
      byChapterId.get(section.chapterId)!.push(option);
    } else if (firstChapteredIndex >= 0) {
      if (index < firstChapteredIndex) leadingSections.push(option);
      else trailingSections.push(option);
    } else if (isReferencesSectionTitle(section.title)) {
      trailingSections.push(option);
    } else {
      leadingSections.push(option);
    }
  });

  const chapters: AcademicManuscriptExportChapterGroup[] = rawChapters.map(
    (chapter) => ({
      id: chapter.id,
      title: chapter.title,
      sections: byChapterId.get(chapter.id) ?? []
    })
  );

  const orderedSections = [
    ...leadingSections,
    ...chapters.flatMap((chapter) => chapter.sections),
    ...trailingSections
  ];

  return {
    hasChapters: true,
    leadingSections,
    chapters,
    trailingSections,
    orderedSections,
    defaultSelectedSectionIds: orderedSections
      .filter((item) => item.nonEmpty)
      .map((item) => item.id)
  };
}

/**
 * Builds the academic manuscript export input in canonical section reading order.
 * Only section `body` documents are exported — `brief` and `state` are never included.
 */
export function createAcademicManuscriptExportInput(
  book: AcademicExportSourceBook,
  documents: readonly WorkspaceDocument[],
  editorDrafts: Readonly<Record<string, EditorDraftState>>,
  request: AcademicManuscriptExportRequest,
  loadedContentsByCatalogId?: ReadonlyMap<string, string>
): ExportAcademicManuscriptInput {
  const tree = listAcademicManuscriptExportTree(book, documents, editorDrafts);
  const selectedIds = new Set(request.sectionIds);
  const bodyDocuments = new Map(
    documents
      .filter(
        (doc) =>
          doc.workspaceId === book.id &&
          doc.draftFileKind === "body" &&
          Boolean(doc.catalogDocumentId)
      )
      .map((doc) => [doc.catalogDocumentId!, doc] as const)
  );
  const sectionById = new Map(
    book.manuscript.sections.map((section) => [section.id, section] as const)
  );

  const items = tree.orderedSections
    .filter((option) => selectedIds.has(option.id))
    .map((option) => {
      const section = sectionById.get(option.id)!;
      const bodyDoc = bodyDocuments.get(section.body.id);
      const liveDraft = bodyDoc ? editorDrafts[bodyDoc.id] : undefined;
      const loadedOverride = loadedContentsByCatalogId?.get(section.body.id);
      const content =
        liveDraft?.content ??
        loadedOverride ??
        (bodyDoc?.catalogContentLoaded ? bodyDoc.content : undefined) ??
        section.body.content;
      return {
        ...(option.chapterId && option.chapterTitle
          ? {
              chapterId: option.chapterId,
              chapterTitle: option.chapterTitle
            }
          : {}),
        sectionTitle: option.title,
        content
      };
    });

  return {
    book: { projectType: "academic", projectId: book.id },
    title: book.title,
    format: request.format,
    includeChapterHeadings: tree.hasChapters && request.includeChapterHeadings,
    ...(request.format === "md" ? { imageMode: request.imageMode } : {}),
    items
  };
}
