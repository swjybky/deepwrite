export const LONG_MANUSCRIPT_NAVIGATION_PAGE_SIZE = 50;

export function longManuscriptNavigationPageCount(
  itemCount: number,
  pageSize = LONG_MANUSCRIPT_NAVIGATION_PAGE_SIZE
): number {
  return Math.max(1, Math.ceil(itemCount / pageSize));
}

export function longManuscriptNavigationPageForIndex(
  index: number,
  pageSize = LONG_MANUSCRIPT_NAVIGATION_PAGE_SIZE
): number {
  return index < 0 ? 1 : Math.floor(index / pageSize) + 1;
}

export function longManuscriptNavigationPageSlice<T>(
  items: readonly T[],
  page: number,
  pageSize = LONG_MANUSCRIPT_NAVIGATION_PAGE_SIZE
): T[] {
  const safePage = Math.max(1, page);
  return items.slice((safePage - 1) * pageSize, safePage * pageSize);
}
