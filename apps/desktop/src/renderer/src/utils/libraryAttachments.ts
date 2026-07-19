import {
  ATTACHED_CONTEXT_MAX_CONTENT_LENGTH,
  ATTACHED_CONTEXT_MAX_ITEMS,
  MATERIAL_KINDS,
  SKILL_KINDS,
  type CatalogSnapshot,
  type MaterialKind,
  type ShortBook,
  type SkillKind,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import { MATERIAL_STAGE_KINDS } from "../data/catalogWorkspace";

type AttachedSkill = NonNullable<WorkspaceRuntimeContext["attachedSkills"]>[number];
type AttachedMaterial = NonNullable<WorkspaceRuntimeContext["attachedMaterials"]>[number];

export const MAX_LIBRARY_ATTACHMENTS_PER_DOMAIN = ATTACHED_CONTEXT_MAX_ITEMS;
export const MAX_LIBRARY_ATTACHMENT_CONTENT_LENGTH =
  ATTACHED_CONTEXT_MAX_CONTENT_LENGTH;

export type LibraryAttachmentDomain = "skill" | "material";

export type LibraryAttachmentDiagnosticCode =
  | "book-not-found"
  | "library-not-found"
  | "library-kind-mismatch"
  | "duplicate-library-binding"
  | "content-truncated"
  | "capacity-exceeded";

export interface LibraryAttachmentDiagnostic {
  code: LibraryAttachmentDiagnosticCode;
  domain?: LibraryAttachmentDomain;
  message: string;
  bookId: string;
  libraryId?: string;
  entryId?: string;
  expectedKind?: MaterialKind | SkillKind;
  actualKind?: string;
  originalLength?: number;
  includedLength?: number;
}

export interface OmittedLibraryAttachment {
  domain: LibraryAttachmentDomain;
  libraryId: string;
  entryId: string;
  title: string;
  reason: "capacity-exceeded";
}

export interface BuildLibraryAttachmentsOptions {
  /** May lower, but never raise, the protocol's per-domain item limit. */
  maxItemsPerDomain?: number;
  /** May lower, but never raise, the protocol's per-item content limit. */
  maxContentLength?: number;
}

export interface LibraryAttachmentBuildResult {
  bookId: string;
  attachedSkills: AttachedSkill[];
  attachedMaterials: AttachedMaterial[];
  diagnostics: LibraryAttachmentDiagnostic[];
  omittedAttachments: OmittedLibraryAttachment[];
  complete: boolean;
}

interface AttachmentCandidate<TKind extends MaterialKind | SkillKind> {
  domain: LibraryAttachmentDomain;
  libraryId: string;
  entryId: string;
  attachmentId: string;
  title: string;
  content: string;
  kind: TKind;
}

function protocolLimit(requested: number | undefined, maximum: number): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return maximum;
  }
  return Math.min(maximum, Math.max(0, Math.floor(requested)));
}

function uniqueAttachmentId(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let suffix = 2;
  while (used.has(`${base}:${suffix}`)) {
    suffix += 1;
  }
  const value = `${base}:${suffix}`;
  used.add(value);
  return value;
}

function attachmentTitle(libraryTitle: string, entryTitle: string, entryId: string): string {
  const combined = `${libraryTitle} · ${entryTitle}`;
  if (combined.length <= 240) return combined;
  const suffix = ` · ${entryId.slice(-12)}`;
  return `${combined.slice(0, Math.max(1, 240 - suffix.length))}${suffix}`;
}

function truncateContent(
  candidate: AttachmentCandidate<MaterialKind | SkillKind>,
  maxContentLength: number,
  bookId: string,
  diagnostics: LibraryAttachmentDiagnostic[]
): string {
  if (candidate.content.length <= maxContentLength) {
    return candidate.content;
  }
  const marker = `\n\n[DeepWrite：附件内容因 ${maxContentLength.toLocaleString("zh-CN")} 字符上限截断；原文 ${candidate.content.length.toLocaleString("zh-CN")} 字符。]`;
  const content =
    marker.length >= maxContentLength
      ? marker.slice(0, maxContentLength)
      : `${candidate.content.slice(0, maxContentLength - marker.length)}${marker}`;
  diagnostics.push({
    code: "content-truncated",
    domain: candidate.domain,
    message: `“${candidate.title}”超过附件内容上限，已携带显式截断说明。`,
    bookId,
    libraryId: candidate.libraryId,
    entryId: candidate.entryId,
    originalLength: candidate.content.length,
    includedLength: content.length
  });
  return content;
}

function collectMaterialCandidates(
  snapshot: CatalogSnapshot,
  book: ShortBook,
  diagnostics: LibraryAttachmentDiagnostic[]
): AttachmentCandidate<MaterialKind>[] {
  const libraries = new Map(snapshot.materials.map((library) => [library.id, library]));
  const candidates: AttachmentCandidate<MaterialKind>[] = [];
  const usedAttachmentIds = new Set<string>();
  const seenBindings = new Set<string>();

  for (const selectedKind of MATERIAL_KINDS) {
    for (const libraryId of book.linkedMaterialIdsByKind[selectedKind]) {
      const bindingKey = `${selectedKind}:${libraryId}`;
      if (seenBindings.has(bindingKey)) {
        diagnostics.push({
          code: "duplicate-library-binding",
          domain: "material",
          message: `素材库“${libraryId}”在 ${selectedKind} 分类下重复绑定，已只读取一次。`,
          bookId: book.id,
          libraryId,
          expectedKind: selectedKind
        });
        continue;
      }
      seenBindings.add(bindingKey);
      const library = libraries.get(libraryId);
      if (!library) {
        diagnostics.push({
          code: "library-not-found",
          domain: "material",
          message: `绑定的素材库“${libraryId}”不存在。`,
          bookId: book.id,
          libraryId,
          expectedKind: selectedKind
        });
        continue;
      }
      if (library.materialKind !== "mixed" && library.materialKind !== selectedKind) {
        diagnostics.push({
          code: "library-kind-mismatch",
          domain: "material",
          message: `素材库“${library.title}”的用途为 ${library.materialKind}，但书籍将其绑定在 ${selectedKind}。`,
          bookId: book.id,
          libraryId,
          expectedKind: selectedKind,
          actualKind: library.materialKind
        });
      }
      for (const entry of library.entries) {
        const entryKind = MATERIAL_STAGE_KINDS[entry.stageId];
        if (entryKind !== selectedKind || !entry.body.trim()) {
          continue;
        }
        const baseId = `material:${library.id}:${entry.id}`;
        candidates.push({
          domain: "material",
          libraryId: library.id,
          entryId: entry.id,
          attachmentId: uniqueAttachmentId(baseId, usedAttachmentIds),
          title: attachmentTitle(library.title, entry.title, entry.id),
          content: entry.body,
          kind: entryKind
        });
      }
    }
  }
  return candidates;
}

function collectSkillCandidates(
  snapshot: CatalogSnapshot,
  book: ShortBook,
  diagnostics: LibraryAttachmentDiagnostic[]
): AttachmentCandidate<SkillKind>[] {
  const libraries = new Map(snapshot.skills.map((library) => [library.id, library]));
  const candidates: AttachmentCandidate<SkillKind>[] = [];
  const usedAttachmentIds = new Set<string>();
  const seenLibraryKinds = new Map<string, SkillKind>();

  for (const selectedKind of SKILL_KINDS) {
    for (const libraryId of book.linkedSkillIdsByKind[selectedKind]) {
      const previousKind = seenLibraryKinds.get(libraryId);
      if (previousKind) {
        diagnostics.push({
          code: "duplicate-library-binding",
          domain: "skill",
          message: `技能库“${libraryId}”同时绑定在 ${previousKind} 与 ${selectedKind}，已按 ${previousKind} 读取一次。`,
          bookId: book.id,
          libraryId,
          expectedKind: selectedKind,
          actualKind: previousKind
        });
        continue;
      }
      seenLibraryKinds.set(libraryId, selectedKind);
      const library = libraries.get(libraryId);
      if (!library) {
        diagnostics.push({
          code: "library-not-found",
          domain: "skill",
          message: `绑定的技能库“${libraryId}”不存在。`,
          bookId: book.id,
          libraryId,
          expectedKind: selectedKind
        });
        continue;
      }
      if (library.skillKind !== selectedKind) {
        diagnostics.push({
          code: "library-kind-mismatch",
          domain: "skill",
          message: `技能库“${library.title}”的分类为 ${library.skillKind}，但书籍将其绑定在 ${selectedKind}。`,
          bookId: book.id,
          libraryId,
          expectedKind: selectedKind,
          actualKind: library.skillKind
        });
      }
      for (const entry of library.entries) {
        if (!entry.body.trim()) {
          continue;
        }
        const baseId = `skill:${library.id}:${entry.id}`;
        candidates.push({
          domain: "skill",
          libraryId: library.id,
          entryId: entry.id,
          attachmentId: uniqueAttachmentId(baseId, usedAttachmentIds),
          title: attachmentTitle(library.title, entry.title, entry.id),
          content: entry.body,
          kind: library.skillKind
        });
      }
    }
  }
  return candidates;
}

function capacityDiagnostics<TKind extends MaterialKind | SkillKind>(
  candidates: readonly AttachmentCandidate<TKind>[],
  limit: number,
  bookId: string,
  diagnostics: LibraryAttachmentDiagnostic[],
  omittedAttachments: OmittedLibraryAttachment[]
): readonly AttachmentCandidate<TKind>[] {
  const omitted = candidates.slice(limit);
  for (const candidate of omitted) {
    omittedAttachments.push({
      domain: candidate.domain,
      libraryId: candidate.libraryId,
      entryId: candidate.entryId,
      title: candidate.title,
      reason: "capacity-exceeded"
    });
  }
  if (omitted.length) {
    const domain = candidates[0]?.domain;
    diagnostics.push({
      code: "capacity-exceeded",
      ...(domain ? { domain } : {}),
      message: `${domain === "skill" ? "技能" : "素材"}附件超过契约容量 ${limit} 条，另有 ${omitted.length} 条已在 omittedAttachments 中明确列出。`,
      bookId
    });
  }
  return candidates.slice(0, limit);
}

/**
 * Resolves a book's by-kind library bindings into protocol-valid runtime
 * attachments. Every omission and content truncation is returned explicitly;
 * callers should surface diagnostics instead of treating a partial result as
 * complete.
 */
export function buildLibraryAttachments(
  snapshot: CatalogSnapshot,
  bookOrId: ShortBook | string,
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

  const attachedMaterials: AttachedMaterial[] = materialCandidates.map((candidate) => ({
    id: candidate.attachmentId,
    title: candidate.title,
    content: truncateContent(candidate, contentLimit, book.id, diagnostics),
    source: "attached-material",
    kind: candidate.kind
  }));
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
