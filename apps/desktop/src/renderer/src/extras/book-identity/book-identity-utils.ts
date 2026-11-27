import type {
  BookIdentityCandidate,
  BookIdentityField,
  ChatAssistantProjectRef
} from "@deepwrite/contracts/renderer";
import { createScopedTranslator } from "../../i18n";
import { deepwriteApi } from "../../api/deepwrite";
export const identityT = createScopedTranslator("extras.bookIdentity");
export const fields: BookIdentityField[] = ["title", "synopsis", "cover"];
export const agentIds = {
  title: "book-title-design",
  synopsis: "book-synopsis-design",
  cover: "book-cover-design"
} as const;
export const countLimits = { title: 20, synopsis: 8, cover: 6 } as const;
export function fieldLabel(field: BookIdentityField) {
  return identityT(`${field}Field`);
}
export function candidateLabel(candidate: BookIdentityCandidate) {
  return "title" in candidate
    ? candidate.title
    : "text" in candidate
      ? candidate.hook || candidate.text.slice(0, 60)
      : candidate.concept;
}
export function coverUrl(
  book: ChatAssistantProjectRef,
  file: string,
  revision?: number
) {
  const url = `deepwrite-cover://asset/${book.projectType}/${encodeURIComponent(book.projectId)}/${file.split("/").map(encodeURIComponent).join("/")}`;
  return revision === undefined ? url : `${url}?revision=${revision}`;
}

export function identityApi() {
  const api = deepwriteApi();
  if (!api) throw new Error(identityT("failed"));
  return api;
}
