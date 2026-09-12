import type { AgentEditProposal } from "../../types/conversation";
import { isRecord, nonnegativeInteger } from "./shared";
export function parseStoredDraftSectionCreationTarget(
  value: unknown
): AgentEditProposal["draftSectionCreationTarget"] | undefined {
  if (
    !isRecord(value) ||
    !Array.isArray(value.sections) ||
    value.sections.length === 0
  ) {
    return undefined;
  }
  const sections: Array<{
    title: string;
    wordCountRequirement: string;
    provisionalSectionId: string;
    realSectionId?: string;
    bodyContent?: string;
    characterStateContent?: string;
  }> = [];
  for (const [index, section] of value.sections.entries()) {
    if (
      !isRecord(section) ||
      typeof section.title !== "string" ||
      typeof section.wordCountRequirement !== "string" ||
      (section.bodyContent !== undefined &&
        typeof section.bodyContent !== "string") ||
      (section.characterStateContent !== undefined &&
        typeof section.characterStateContent !== "string") ||
      (section.realSectionId !== undefined &&
        typeof section.realSectionId !== "string")
    ) {
      return undefined;
    }
    sections.push({
      title: section.title,
      wordCountRequirement: section.wordCountRequirement,
      provisionalSectionId:
        typeof section.provisionalSectionId === "string" &&
        section.provisionalSectionId.trim()
          ? section.provisionalSectionId
          : `pending:section:legacy-${index + 1}`,
      ...(typeof section.realSectionId === "string"
        ? { realSectionId: section.realSectionId }
        : {}),
      ...(typeof section.bodyContent === "string"
        ? { bodyContent: section.bodyContent }
        : {}),
      ...(typeof section.characterStateContent === "string"
        ? { characterStateContent: section.characterStateContent }
        : {})
    });
  }
  if (
    value.afterSectionId !== undefined &&
    typeof value.afterSectionId !== "string"
  ) {
    return undefined;
  }
  if (
    value.baseProjectRevision !== undefined &&
    !nonnegativeInteger(value.baseProjectRevision)
  ) {
    return undefined;
  }
  if (
    value.acceptedDirectoryRevision !== undefined &&
    typeof value.acceptedDirectoryRevision !== "string"
  ) {
    return undefined;
  }
  return {
    sections,
    ...(typeof value.afterSectionId === "string"
      ? { afterSectionId: value.afterSectionId }
      : {}),
    ...(typeof value.baseProjectRevision === "number"
      ? { baseProjectRevision: value.baseProjectRevision }
      : {}),
    ...(typeof value.acceptedDirectoryRevision === "string"
      ? { acceptedDirectoryRevision: value.acceptedDirectoryRevision }
      : {})
  };
}
export function parseStoredDraftSectionRenameTarget(
  value: unknown
): AgentEditProposal["draftSectionRenameTarget"] | undefined {
  if (
    !isRecord(value) ||
    typeof value.sectionId !== "string" ||
    !value.sectionId.trim() ||
    typeof value.previousTitle !== "string" ||
    !value.previousTitle.trim() ||
    typeof value.title !== "string" ||
    !value.title.trim()
  ) {
    return undefined;
  }
  if (
    value.baseProjectRevision !== undefined &&
    !nonnegativeInteger(value.baseProjectRevision)
  ) {
    return undefined;
  }
  return {
    sectionId: value.sectionId,
    previousTitle: value.previousTitle,
    title: value.title,
    ...(typeof value.baseProjectRevision === "number"
      ? { baseProjectRevision: value.baseProjectRevision }
      : {})
  };
}
export function parseStoredDraftSectionDeletionTarget(
  value: unknown
): AgentEditProposal["draftSectionDeletionTarget"] | undefined {
  if (
    !isRecord(value) ||
    typeof value.sectionId !== "string" ||
    !value.sectionId.trim() ||
    typeof value.title !== "string" ||
    !value.title.trim()
  ) {
    return undefined;
  }
  if (
    value.baseProjectRevision !== undefined &&
    !nonnegativeInteger(value.baseProjectRevision)
  ) {
    return undefined;
  }
  return {
    sectionId: value.sectionId,
    title: value.title,
    ...(typeof value.baseProjectRevision === "number"
      ? { baseProjectRevision: value.baseProjectRevision }
      : {})
  };
}
