import {
  ACADEMIC_TERMINOLOGY_DOCUMENT_ID,
  ACADEMIC_TERMINOLOGY_TITLE,
  ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID,
  ACADEMIC_THESIS_OVERVIEW_TITLE,
  AcademicWorkspaceRuntimeContextSchema,
  createAcademicCardDocumentId,
  createAcademicSectionDocumentId,
  createShortWorkspaceContentRevision,
  isBuiltinAcademicFrameworkStageId,
  type AcademicActiveTarget,
  type AcademicBook,
  type AcademicWorkspaceRuntimeContext,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts/renderer";
import type { WorkspaceDocument } from "../../types/workspace";

function countNonWhitespaceCharacters(text: string): number {
  return text.replace(/\s+/gu, "").length;
}

function resolveAcademicActiveTarget(
  activeDocument: WorkspaceDocument
): AcademicActiveTarget | undefined {
  const zone = activeDocument.academicZone;
  const kind = activeDocument.academicDocKind;
  if (!zone || !kind) return undefined;
  if (kind === "thesis_overview" || kind === "terminology") {
    return {
      zone,
      kind,
      targetId: kind,
      title: activeDocument.title
    };
  }
  if (kind === "reference_card" && activeDocument.academicCardId) {
    return {
      zone,
      kind,
      targetId: activeDocument.academicCardId,
      title: activeDocument.title
    };
  }
  if (kind === "framework_stage" && activeDocument.stageId) {
    return {
      zone,
      kind,
      targetId: activeDocument.stageId,
      title: activeDocument.title
    };
  }
  if (kind === "section" && activeDocument.expertSectionId) {
    const fileKind =
      activeDocument.draftFileKind === "brief" ||
      activeDocument.draftFileKind === "state"
        ? activeDocument.draftFileKind
        : "body";
    return {
      zone,
      kind,
      targetId: activeDocument.expertSectionId,
      sectionDocument: fileKind,
      title: activeDocument.title
    };
  }
  return undefined;
}

export function buildAcademicWorkspaceContext(
  activeDocument: WorkspaceDocument,
  workspaceDocuments: WorkspaceDocument[],
  academicBook?: AcademicBook,
  agentsMd?: string
): Pick<WorkspaceRuntimeContext, "academicWorkspace"> | undefined {
  if (
    activeDocument.workspaceType !== "academic" ||
    !activeDocument.workspaceId ||
    !activeDocument.workspaceTitle
  ) {
    return undefined;
  }

  const workspaceId = activeDocument.workspaceId;
  const liveDocsByCatalogId = new Map<string, WorkspaceDocument>();
  for (const doc of workspaceDocuments) {
    if (
      doc.workspaceType === "academic" &&
      doc.workspaceId === workspaceId &&
      doc.catalogDocumentId
    ) {
      liveDocsByCatalogId.set(doc.catalogDocumentId, doc);
    }
  }
  if (activeDocument.catalogDocumentId) {
    liveDocsByCatalogId.set(activeDocument.catalogDocumentId, activeDocument);
  }

  const emptyRev = createShortWorkspaceContentRevision("");
  const metricsFor = (id: string, fallbackTitle: string) => {
    const live = liveDocsByCatalogId.get(id);
    const loaded = live?.catalogContentLoaded === true;
    return {
      id,
      title: live?.title || fallbackTitle,
      revision: emptyRev,
      characters: loaded ? countNonWhitespaceCharacters(live!.content) : 0
    };
  };

  const activeTarget = resolveAcademicActiveTarget(activeDocument);

  let rawContext: AcademicWorkspaceRuntimeContext;
  if (academicBook) {
    const bookDocs = new Map(
      academicBook.documents.map((doc) => [doc.id, doc] as const)
    );
    rawContext = {
      id: academicBook.id,
      title: academicBook.title,
      subtype: academicBook.subtype,
      citationStyle: academicBook.citationStyle,
      readSource: "core",
      ...(agentsMd !== undefined ? { agentsMd } : {}),
      ...(academicBook.projectRevision !== undefined
        ? { projectRevision: academicBook.projectRevision }
        : {}),
      foundation: {
        thesisOverview: metricsFor(
          ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID,
          academicBook.foundation.thesisOverview.title
        ),
        terminology: metricsFor(
          ACADEMIC_TERMINOLOGY_DOCUMENT_ID,
          academicBook.foundation.terminology.title
        ),
        cards: academicBook.foundation.cards.map((card) => {
          const live = liveDocsByCatalogId.get(card.document.id);
          return {
            id: card.id,
            citeKey: card.citeKey,
            cardType: card.cardType,
            title: card.title,
            documentId: card.document.id,
            revision: emptyRev,
            characters:
              live?.catalogContentLoaded === true
                ? countNonWhitespaceCharacters(live.content)
                : 0
          };
        })
      },
      frameworkStages: academicBook.frameworkStages.map((stage) => {
        const doc = bookDocs.get(stage.id);
        return {
          id: stage.id,
          title: stage.title,
          description: stage.description,
          enabled: stage.enabled,
          builtin: isBuiltinAcademicFrameworkStageId(stage.id),
          document: metricsFor(stage.id, doc?.title ?? stage.title)
        };
      }),
      manuscript: {
        chapters: academicBook.manuscript.chapters.map((chapter, index) => ({
          id: chapter.id,
          title: chapter.title,
          order: index + 1
        })),
        sections: academicBook.manuscript.sections.map((section, index) => ({
          id: section.id,
          ...(section.chapterId ? { chapterId: section.chapterId } : {}),
          title: section.title,
          wordCountRequirement: section.wordCountRequirement,
          order: index + 1,
          brief: metricsFor(section.brief.id, section.brief.title),
          body: metricsFor(section.body.id, section.body.title),
          state: metricsFor(section.state.id, section.state.title)
        }))
      },
      ...(activeTarget ? { activeTarget } : {})
    };
  } else {
    const academicDocs = workspaceDocuments.filter(
      (doc) =>
        doc.workspaceType === "academic" && doc.workspaceId === workspaceId
    );
    const cardDocs = academicDocs.filter(
      (doc) =>
        doc.academicDocKind === "reference_card" &&
        doc.academicCardId &&
        doc.academicCiteKey
    );
    const stageDocs = academicDocs
      .filter((doc) => doc.academicDocKind === "framework_stage" && doc.stageId)
      .sort(
        (left, right) =>
          (left.plotStageOrder ?? 0) - (right.plotStageOrder ?? 0)
      );
    const chaptersMap = new Map<string, string>();
    const sectionsMap = new Map<
      string,
      {
        id: string;
        chapterId?: string;
        title: string;
        wordCountRequirement: string;
        order: number;
      }
    >();
    for (const doc of academicDocs) {
      if (doc.academicChapterId && doc.academicChapterTitle) {
        chaptersMap.set(doc.academicChapterId, doc.academicChapterTitle);
      }
      if (doc.academicDocKind === "section" && doc.expertSectionId) {
        const existing = sectionsMap.get(doc.expertSectionId) ?? {
          id: doc.expertSectionId,
          ...(doc.academicChapterId
            ? { chapterId: doc.academicChapterId }
            : {}),
          title: doc.title,
          wordCountRequirement: doc.expertWordCountRequirement ?? "",
          order: doc.expertSectionOrder ?? Number.MAX_SAFE_INTEGER
        };
        if (doc.draftFileKind === "body") {
          existing.title = doc.title;
          existing.wordCountRequirement = doc.expertWordCountRequirement ?? "";
        }
        sectionsMap.set(doc.expertSectionId, existing);
      }
    }
    const orderedSections = [...sectionsMap.values()].sort(
      (left, right) => left.order - right.order
    );
    if (!stageDocs.length || !orderedSections.length) return undefined;

    rawContext = {
      id: workspaceId,
      title: activeDocument.workspaceTitle,
      subtype: activeDocument.academicSubtype ?? "empirical_paper",
      citationStyle: activeDocument.citationStyle ?? "gbt7714",
      readSource: "core",
      ...(agentsMd !== undefined ? { agentsMd } : {}),
      ...(activeDocument.catalogProjectRevision !== undefined
        ? { projectRevision: activeDocument.catalogProjectRevision }
        : {}),
      foundation: {
        thesisOverview: metricsFor(
          ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID,
          ACADEMIC_THESIS_OVERVIEW_TITLE
        ),
        terminology: metricsFor(
          ACADEMIC_TERMINOLOGY_DOCUMENT_ID,
          ACADEMIC_TERMINOLOGY_TITLE
        ),
        cards: cardDocs.map((doc) => ({
          id: doc.academicCardId!,
          citeKey: doc.academicCiteKey!,
          cardType: doc.academicCardType ?? "literature",
          title: doc.title,
          documentId:
            doc.catalogDocumentId ??
            createAcademicCardDocumentId(doc.academicCardId!),
          revision: emptyRev,
          characters:
            doc.catalogContentLoaded === true
              ? countNonWhitespaceCharacters(doc.content)
              : 0
        }))
      },
      frameworkStages: stageDocs.map((doc) => ({
        id: doc.stageId!,
        title: doc.title,
        description: doc.plotStageDescription || doc.title,
        enabled: true,
        builtin: isBuiltinAcademicFrameworkStageId(doc.stageId!),
        document: metricsFor(doc.stageId!, doc.title)
      })),
      manuscript: {
        chapters: [...chaptersMap.entries()].map(([id, title], idx) => ({
          id,
          title,
          order: idx + 1
        })),
        sections: orderedSections.map((sec, idx) => ({
          id: sec.id,
          ...(sec.chapterId ? { chapterId: sec.chapterId } : {}),
          title: sec.title,
          wordCountRequirement: sec.wordCountRequirement,
          order: idx + 1,
          brief: metricsFor(
            createAcademicSectionDocumentId(sec.id, "brief"),
            `${sec.title} · 写作指引`
          ),
          body: metricsFor(
            createAcademicSectionDocumentId(sec.id, "body"),
            sec.title
          ),
          state: metricsFor(
            createAcademicSectionDocumentId(sec.id, "state"),
            `${sec.title} · 节末状态`
          )
        }))
      },
      ...(activeTarget ? { activeTarget } : {})
    };
  }

  return {
    academicWorkspace: AcademicWorkspaceRuntimeContextSchema.parse(rawContext)
  };
}
