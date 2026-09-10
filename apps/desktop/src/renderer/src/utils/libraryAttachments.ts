import type { CatalogSnapshot, Book } from "@deepwrite/contracts/renderer";
import {
  collectMaterialCandidates,
  collectSkillCandidates
} from "./library-attachments/candidates";
import {
  MAX_LIBRARY_ATTACHMENTS_PER_DOMAIN,
  MAX_LIBRARY_ATTACHMENT_CONTENT_LENGTH,
  capacityDiagnostics,
  protocolLimit,
  truncateContent,
  type AttachedMaterial,
  type AttachedSkill,
  type LibraryAttachmentBindingTarget,
  type LibraryAttachmentBuildResult,
  type BuildLibraryAttachmentsOptions,
  type LibraryAttachmentDiagnostic,
  type OmittedLibraryAttachment
} from "./library-attachments/shared";
export {
  MAX_LIBRARY_ATTACHMENTS_PER_DOMAIN,
  MAX_LIBRARY_ATTACHMENT_CONTENT_LENGTH
} from "./library-attachments/shared";
export type {
  LibraryAttachmentDomain,
  LibraryAttachmentDiagnosticCode,
  LibraryAttachmentDiagnostic,
  OmittedLibraryAttachment,
  BuildLibraryAttachmentsOptions,
  LibraryAttachmentBuildResult,
  LibraryAttachmentBindingTarget
} from "./library-attachments/shared";

/**
 * Resolves a book's by-kind library bindings into protocol-valid runtime
 * attachments. Every omission and content truncation is returned explicitly;
 * callers should surface diagnostics instead of treating a partial result as
 * complete.
 */
export function buildLibraryAttachments(
  snapshot: CatalogSnapshot,
  bookOrId: Book | LibraryAttachmentBindingTarget | string,
  options: BuildLibraryAttachmentsOptions = {}
): LibraryAttachmentBuildResult {
  const bookId = typeof bookOrId === "string" ? bookOrId : bookOrId.id;
  const book =
    typeof bookOrId === "string"
      ? snapshot.books.find((candidate) => candidate.id === bookOrId)
      : bookOrId;
  const diagnostics: LibraryAttachmentDiagnostic[] = [];
  const omittedAttachments: OmittedLibraryAttachment[] = [];
  if (!book) {
    diagnostics.push({
      code: "book-not-found",
      message: `无法为不存在的书籍“${bookId}”构建素材与技能附件。`,
      bookId
    });
    return {
      bookId,
      attachedSkills: [],
      attachedMaterials: [],
      diagnostics,
      omittedAttachments,
      complete: false
    };
  }

  const itemLimit = protocolLimit(
    options.maxItemsPerDomain,
    MAX_LIBRARY_ATTACHMENTS_PER_DOMAIN
  );
  const contentLimit = protocolLimit(
    options.maxContentLength,
    MAX_LIBRARY_ATTACHMENT_CONTENT_LENGTH
  );
  const materialCandidates = capacityDiagnostics(
    collectMaterialCandidates(snapshot, book, diagnostics),
    itemLimit,
    book.id,
    diagnostics,
    omittedAttachments
  );
  const skillCandidates = capacityDiagnostics(
    collectSkillCandidates(snapshot, book, diagnostics),
    itemLimit,
    book.id,
    diagnostics,
    omittedAttachments
  );

  const attachedMaterials: AttachedMaterial[] = materialCandidates.map(
    (candidate) => ({
      id: candidate.attachmentId,
      title: candidate.title,
      content: truncateContent(candidate, contentLimit, book.id, diagnostics),
      metadata: candidate.metadata,
      source: "attached-material",
      kind: candidate.kind
    })
  );
  const attachedSkills: AttachedSkill[] = skillCandidates.map((candidate) => ({
    id: candidate.attachmentId,
    title: candidate.title,
    content: truncateContent(candidate, contentLimit, book.id, diagnostics),
    source: "attached-skill",
    kind: candidate.kind
  }));

  return {
    bookId: book.id,
    attachedSkills,
    attachedMaterials,
    diagnostics,
    omittedAttachments,
    complete: omittedAttachments.length === 0 && diagnostics.length === 0
  };
}
