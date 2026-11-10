import type {
  CatalogLegacyImport,
  CreativePlotStage
} from "@deepwrite/contracts";

export const CATALOG_PROJECT_DOMAINS = [
  "book",
  "material-library",
  "material-group",
  "skill-library",
  "skill-group"
] as const;
export type FolderCatalogProjectDomain =
  (typeof CATALOG_PROJECT_DOMAINS)[number];

export interface RegistryProject {
  id: string;
  domain: FolderCatalogProjectDomain;
  projectDirectory: string;
  registeredAt: string;
}

export interface FolderCatalogRegistry {
  schemaVersion: 1;
  libraryOrganization?: import("@deepwrite/contracts").LibraryOrganization;
  revision: number;
  updatedAt: string;
  legacyImport?: CatalogLegacyImport;
  sourceCatalogMigrated: boolean;
  /** Global short/script plot stage definitions (title/description). */
  creativePlotStages: CreativePlotStage[];
  projects: RegistryProject[];
}
