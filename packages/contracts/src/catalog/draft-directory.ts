import { z } from "zod";

import {
  DraftSectionIdSchema,
  DraftSectionTitleSchema,
  createDefaultExpertDraft,
  createDefaultScriptDraft,
  parseExpertDraftMarkdown,
  type ExpertDraft
} from "../expert-draft";
import {
  CATALOG_DRAFT_DIRECTORY_ID,
  CatalogDocumentSchema,
  CatalogIdSchema,
  CatalogTitleSchema,
  TimestampSchema,
  uniqueIds,
  type CatalogDocument
} from "./kinds";

export function catalogDraftBodyDocumentId(sectionId: string): string {
  return `draft-section:${sectionId}:body`;
}

export function catalogDraftCharacterStateDocumentId(
  sectionId: string
): string {
  return `draft-section:${sectionId}:character-state`;
}

const CATALOG_DRAFT_DOCUMENT_ID_PREFIX = "draft-section:";
const CATALOG_DRAFT_BODY_SUFFIX = ":body";
const CATALOG_DRAFT_CHARACTER_STATE_SUFFIX = ":character-state";

export type CatalogDraftFileKind = "body" | "character-state";

/**
 * Inverse of {@link catalogDraftBodyDocumentId} /
 * {@link catalogDraftCharacterStateDocumentId}. Prefers the longer
 * `:character-state` suffix so section ids that contain `:body` are not
 * mis-parsed.
 */
export function parseCatalogDraftDocumentId(
  documentId: string
): { sectionId: string; fileKind: CatalogDraftFileKind } | undefined {
  if (!documentId.startsWith(CATALOG_DRAFT_DOCUMENT_ID_PREFIX)) {
    return undefined;
  }
  if (documentId.endsWith(CATALOG_DRAFT_CHARACTER_STATE_SUFFIX)) {
    const sectionId = documentId.slice(
      CATALOG_DRAFT_DOCUMENT_ID_PREFIX.length,
      documentId.length - CATALOG_DRAFT_CHARACTER_STATE_SUFFIX.length
    );
    if (
      !sectionId ||
      catalogDraftCharacterStateDocumentId(sectionId) !== documentId
    ) {
      return undefined;
    }
    return { sectionId, fileKind: "character-state" };
  }
  if (documentId.endsWith(CATALOG_DRAFT_BODY_SUFFIX)) {
    const sectionId = documentId.slice(
      CATALOG_DRAFT_DOCUMENT_ID_PREFIX.length,
      documentId.length - CATALOG_DRAFT_BODY_SUFFIX.length
    );
    if (!sectionId || catalogDraftBodyDocumentId(sectionId) !== documentId) {
      return undefined;
    }
    return { sectionId, fileKind: "body" };
  }
  return undefined;
}

export const CatalogDraftSectionSchema = z
  .object({
    id: DraftSectionIdSchema,
    title: DraftSectionTitleSchema,
    wordCountRequirement: z.string().max(1_000),
    body: CatalogDocumentSchema,
    characterState: CatalogDocumentSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .superRefine((section, context) => {
    if (section.body.id !== catalogDraftBodyDocumentId(section.id)) {
      context.addIssue({
        code: "custom",
        path: ["body", "id"],
        message: "Draft body document id must match its canonical section id."
      });
    }
    if (
      section.characterState.id !==
      catalogDraftCharacterStateDocumentId(section.id)
    ) {
      context.addIssue({
        code: "custom",
        path: ["characterState", "id"],
        message:
          "Draft character-state document id must match its canonical section id."
      });
    }
    if (section.body.id === section.characterState.id) {
      context.addIssue({
        code: "custom",
        path: ["characterState", "id"],
        message:
          "Draft body and character-state documents must have distinct ids."
      });
    }
  });
export type CatalogDraftSection = z.infer<typeof CatalogDraftSectionSchema>;

export const DraftSectionCreationOperationSchema = z
  .object({
    operationId: CatalogIdSchema,
    requestHash: z.string().regex(/^[a-f0-9]{64}$/u),
    sections: z
      .array(
        z
          .object({
            clientSectionId: DraftSectionIdSchema,
            sectionId: DraftSectionIdSchema
          })
          .strict()
      )
      .min(1)
      .max(100),
    createdAt: TimestampSchema
  })
  .strict()
  .superRefine((operation, context) => {
    if (
      !uniqueIds(
        operation.sections.map(({ clientSectionId }) => clientSectionId)
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Draft creation client ids cannot contain duplicates."
      });
    }
    if (!uniqueIds(operation.sections.map(({ sectionId }) => sectionId))) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Draft creation section ids cannot contain duplicates."
      });
    }
  });

export const CatalogDraftDirectorySchema = z
  .object({
    id: z.literal(CATALOG_DRAFT_DIRECTORY_ID),
    title: CatalogTitleSchema,
    sections: z.array(CatalogDraftSectionSchema).min(1).max(100),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .superRefine((draft, context) => {
    const sectionIds = draft.sections.map((section) => section.id);
    if (!uniqueIds(sectionIds)) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Draft sections cannot contain duplicate ids."
      });
    }
    const documentIds = draft.sections.flatMap((section) => [
      section.body.id,
      section.characterState.id
    ]);
    if (!uniqueIds(documentIds)) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Draft files cannot contain duplicate document ids."
      });
    }
  });
export type CatalogDraftDirectory = z.infer<typeof CatalogDraftDirectorySchema>;

function catalogDraftDirectoryFromExpertDraft(
  draft: ExpertDraft,
  createdAt: string,
  updatedAt: string,
  title = "正文"
): CatalogDraftDirectory {
  return CatalogDraftDirectorySchema.parse({
    id: CATALOG_DRAFT_DIRECTORY_ID,
    title,
    sections: draft.sections.map((section) => ({
      id: section.id,
      title: section.title,
      wordCountRequirement: section.wordCountRequirement,
      body: {
        id: catalogDraftBodyDocumentId(section.id),
        title: section.title,
        content: section.body,
        createdAt,
        updatedAt
      },
      characterState: {
        id: catalogDraftCharacterStateDocumentId(section.id),
        title: `${section.title} · 状态`,
        content: section.characterState,
        createdAt,
        updatedAt
      },
      createdAt,
      updatedAt
    })),
    createdAt,
    updatedAt
  });
}

export function createCatalogDraftDirectory(
  createdAt: string,
  updatedAt = createdAt
): CatalogDraftDirectory {
  return catalogDraftDirectoryFromExpertDraft(
    createDefaultExpertDraft(),
    createdAt,
    updatedAt
  );
}

export function createScriptCatalogDraftDirectory(
  createdAt: string,
  updatedAt = createdAt
): CatalogDraftDirectory {
  return catalogDraftDirectoryFromExpertDraft(
    createDefaultScriptDraft(),
    createdAt,
    updatedAt,
    "剧集"
  );
}

export function migrateCatalogDraftDocument(
  document: CatalogDocument | undefined,
  fallbackCreatedAt: string,
  fallbackUpdatedAt: string
): CatalogDraftDirectory {
  return catalogDraftDirectoryFromExpertDraft(
    parseExpertDraftMarkdown(document?.content ?? ""),
    document?.createdAt ?? fallbackCreatedAt,
    document?.updatedAt ?? fallbackUpdatedAt
  );
}
