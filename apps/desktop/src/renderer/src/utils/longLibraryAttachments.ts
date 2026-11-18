import {
  MATERIAL_KINDS,
  SKILL_KINDS,
  type LongBookSummary,
  type CatalogSnapshot,
  type LongAgentProfile
} from "@deepwrite/contracts/renderer";
import {
  buildLibraryAttachments,
  type LibraryAttachmentBuildResult
} from "./libraryAttachments";
import type { WorkspaceDocument } from "../types/workspace";

type LongReadableAttachments = Pick<
  LibraryAttachmentBuildResult,
  "attachedSkills" | "attachedMaterials"
>;

export function buildLongLibraryAttachmentsForProfile(
  summary: LongBookSummary,
  snapshot: CatalogSnapshot,
  _profile: LongAgentProfile
): LibraryAttachmentBuildResult {
  return buildLibraryAttachments(snapshot, {
    id: summary.id,
    bookType: "long",
    linkedMaterialIdsByKind: {
      character: [...summary.linkedMaterialIdsByKind.character],
      gimmick: [...summary.linkedMaterialIdsByKind.gimmick],
      plot: [...summary.linkedMaterialIdsByKind.plot],
      draft: [...summary.linkedMaterialIdsByKind.draft],
      other: [...summary.linkedMaterialIdsByKind.other]
    },
    linkedSkillIdsByKind: {
      general: [...summary.linkedSkillIdsByKind.general],
      plot: [...summary.linkedSkillIdsByKind.plot],
      style: [...summary.linkedSkillIdsByKind.style],
      other: [...summary.linkedSkillIdsByKind.other]
    }
  });
}

export function filterLongReadableAttachmentsForProfile(
  attachments: LibraryAttachmentBuildResult,
  _profile: LongAgentProfile
): LongReadableAttachments {
  return {
    attachedSkills: [...attachments.attachedSkills],
    attachedMaterials: [...attachments.attachedMaterials]
  };
}

export function buildLongReadableAttachmentsForProfile(
  summary: LongBookSummary,
  snapshot: CatalogSnapshot | null,
  profile: LongAgentProfile
): LongReadableAttachments {
  if (!snapshot) {
    return {
      attachedSkills: [],
      attachedMaterials: []
    };
  }
  return filterLongReadableAttachmentsForProfile(
    buildLongLibraryAttachmentsForProfile(summary, snapshot, profile),
    profile
  );
}

export function longCatalogContextDocuments(
  summary: LongBookSummary,
  _profile: LongAgentProfile,
  documents: readonly WorkspaceDocument[]
): WorkspaceDocument[] {
  const libraryIds = new Set<string>();
  for (const kind of MATERIAL_KINDS) {
    summary.linkedMaterialIdsByKind[kind].forEach((id) => libraryIds.add(id));
  }
  for (const kind of SKILL_KINDS) {
    summary.linkedSkillIdsByKind[kind].forEach((id) => libraryIds.add(id));
  }
  // Filtering the source array preserves the context ordering used by
  // previous sends; gathering from per-library buckets would reorder it.
  return documents.filter(
    (document) =>
      document.libraryId !== undefined && libraryIds.has(document.libraryId)
  );
}
