const DRAFT_CHARACTER_STATE_TITLE_SUFFIX = " · 状态";
const CATALOG_TITLE_MAX_LENGTH = 256;

export function draftCharacterStateTitle(sectionTitle: string): string {
  return `${sectionTitle.slice(
    0,
    CATALOG_TITLE_MAX_LENGTH - DRAFT_CHARACTER_STATE_TITLE_SUFFIX.length
  )}${DRAFT_CHARACTER_STATE_TITLE_SUFFIX}`;
}

function chineseSectionNumber(value: number): string {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value <= 10) return value === 10 ? "十" : digits[value]!;
  if (value < 20) return `十${digits[value - 10]}`;
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return `${digits[tens]}十${ones ? digits[ones] : ""}`;
  }
  return String(value);
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
