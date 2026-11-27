import { chineseSectionNumber } from "@deepwrite/contracts";
const DRAFT_CHARACTER_STATE_TITLE_SUFFIX = " · 状态";
const CATALOG_TITLE_MAX_LENGTH = 256;

export function draftCharacterStateTitle(sectionTitle: string): string {
  return `${sectionTitle.slice(
    0,
    CATALOG_TITLE_MAX_LENGTH - DRAFT_CHARACTER_STATE_TITLE_SUFFIX.length
  )}${DRAFT_CHARACTER_STATE_TITLE_SUFFIX}`;
}

export function suggestedDraftSectionTitle(
  workspaceType: "short" | "script",
  sectionIds: readonly string[]
): string {
  const numericPattern =
    workspaceType === "script" ? /^episode-(\d+)$/u : /^section-(\d+)$/u;
  const highest = sectionIds.reduce((value, sectionId) => {
    const numeric = numericPattern.exec(sectionId)?.[1];
    return numeric ? Math.max(value, Number(numeric)) : value;
  }, 0);
  return `第${chineseSectionNumber(highest + 1)}${workspaceType === "script" ? "集" : "节"}`;
}
