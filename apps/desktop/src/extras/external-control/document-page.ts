import { EXTERNAL_DEFAULT_PAGE_CHARACTERS } from "@deepwrite/contracts/external-control";

export interface TextPage {
  content: string;
  offset: number;
  totalCharacters: number;
  nextOffset: number | null;
}

/** Counts code points, matching long-form paging, so no page splits a pair. */
export function pageText(
  text: string,
  offset = 0,
  maxCharacters = EXTERNAL_DEFAULT_PAGE_CHARACTERS
): TextPage {
  const characters = Array.from(text);
  const end = offset + maxCharacters;
  return {
    content: characters.slice(offset, end).join(""),
    offset,
    totalCharacters: characters.length,
    nextOffset: end < characters.length ? end : null
  };
}
