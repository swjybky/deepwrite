import {
  ATTACHED_CONTEXT_MAX_CONTENT_LENGTH,
  ATTACHED_CONTEXT_MAX_ITEMS,
  type LibraryType,
  type LinkedMaterialIdsByKind,
  type LinkedSkillIdsByKind,
  type MaterialMetadata,
  type MaterialKind,
  type SkillKind,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts/renderer";

export type AttachedSkill = NonNullable<
  WorkspaceRuntimeContext["attachedSkills"]
>[number];
export type AttachedMaterial = NonNullable<
  WorkspaceRuntimeContext["attachedMaterials"]
>[number];

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

/**
 * Long books intentionally live outside the short/script Catalog book union,
 * but use the same library catalog and by-kind binding contract. Passing this
 * narrow shape keeps attachment resolution reusable without registering a
 * long book as a short/script Catalog workspace.
 */
export interface LibraryAttachmentBindingTarget {
  id: string;
  bookType: LibraryType;
  linkedMaterialIdsByKind: LinkedMaterialIdsByKind;
  linkedSkillIdsByKind: LinkedSkillIdsByKind;
}

export interface AttachmentCandidate<TKind extends MaterialKind | SkillKind> {
  domain: LibraryAttachmentDomain;
  libraryId: string;
  entryId: string;
  attachmentId: string;
  title: string;
  content: string;
  metadata?: MaterialMetadata;
  kind: TKind;
}

export function protocolLimit(
  requested: number | undefined,
  maximum: number
): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return maximum;
  }
  return Math.min(maximum, Math.max(0, Math.floor(requested)));
}

export function uniqueAttachmentId(base: string, used: Set<string>): string {
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

export function attachmentTitle(
  libraryTitle: string,
  entryTitle: string,
  entryId: string
): string {
  const combined = `${libraryTitle} · ${entryTitle}`;
  if (combined.length <= 240) return combined;
  const suffix = ` · ${entryId.slice(-12)}`;
  return `${combined.slice(0, Math.max(1, 240 - suffix.length))}${suffix}`;
}

export function truncateContent(
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

export function capacityDiagnostics<TKind extends MaterialKind | SkillKind>(
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
