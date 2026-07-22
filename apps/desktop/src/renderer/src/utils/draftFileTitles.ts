const DRAFT_CHARACTER_STATE_TITLE_SUFFIX = " · 人物状态";
const CATALOG_TITLE_MAX_LENGTH = 256;

export function draftCharacterStateTitle(sectionTitle: string): string {
  return `${sectionTitle.slice(
    0,
    CATALOG_TITLE_MAX_LENGTH - DRAFT_CHARACTER_STATE_TITLE_SUFFIX.length
  )}${DRAFT_CHARACTER_STATE_TITLE_SUFFIX}`;
}
