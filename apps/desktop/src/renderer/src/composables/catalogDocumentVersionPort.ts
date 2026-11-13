import type { SaveDocumentResult } from "@deepwrite/contracts";
import type { InjectionKey } from "vue";

export interface CatalogDocumentVersionPayload {
  id: string;
  title: string;
  content: string;
}
export interface CatalogDocumentVersionPort {
  prepare(payload: CatalogDocumentVersionPayload): Promise<boolean>;
  apply(id: string, result: SaveDocumentResult): Promise<void>;
}
export const CATALOG_DOCUMENT_VERSION_PORT: InjectionKey<CatalogDocumentVersionPort> =
  Symbol("catalog-document-versions");
