import type {
  BookProjectDraftSectionManifest,
  DraftSectionChange
} from "@deepwrite/contracts";

/** Apply a reviewed change to the current manifest inside the catalog write lock. */
export function applyDraftSectionChange(
  sections: BookProjectDraftSectionManifest[],
  index: number,
  change: DraftSectionChange,
  conflict: (expected: string, actual: string) => Error
): void {
  const section = sections[index]!;
  const actual =
    change.field === "wordCountRequirement"
      ? section.wordCountRequirement
      : (sections[index - 1]?.id ?? null);
  if (actual !== change.before)
    throw conflict(String(change.before), String(actual));
  if (change.field === "wordCountRequirement") {
    section.wordCountRequirement = change.after;
    return;
  }
  const anchor =
    change.after === null
      ? -1
      : sections.findIndex(({ id }) => id === change.after);
  if ((change.after !== null && anchor < 0) || anchor === index)
    throw conflict(String(change.after), "missing insertion point");
  sections.splice(index, 1);
  sections.splice(anchor < index ? anchor + 1 : anchor, 0, section);
}
