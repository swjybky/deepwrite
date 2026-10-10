import { z } from "zod";
import { CATALOG_PROJECT_MAX_CONTENT_ITEMS } from "../catalog/kinds";
import type { LibraryPackageLocale } from "./labels";

export const LIBRARY_PACKAGE_FORMAT = "deepwrite.library-package";
export const LIBRARY_PACKAGE_FORMAT_VERSION = 1;
export const LIBRARY_PACKAGE_MANIFEST_FILE = "deepwrite-package.json";
/** One import may create at most this many libraries. */
export const LIBRARY_PACKAGE_MAX_LIBRARIES = 32;

/** The human-readable guide written next to every library and group. */
export const LIBRARY_PACKAGE_README_FILE: Readonly<
  Record<LibraryPackageLocale, string>
> = { "zh-CN": "_说明.md", "en-US": "_README.md" };

export const LibraryPackageDomainSchema = z.enum(["material", "skill"]);
export type LibraryPackageDomain = z.infer<typeof LibraryPackageDomainSchema>;

/**
 * Read side of `deepwrite-package.json`. Field values are checked one by one
 * during recognition, so a single bad value never discards the whole package;
 * unknown fields are ignored for forward compatibility.
 */
const ManifestEntrySchema = z.object({
  file: z.string().min(1).max(1024),
  title: z.string().max(1024).optional(),
  stageId: z.string().max(120).optional()
});

const ManifestLibrarySchema = z.object({
  key: z.string().min(1).max(64),
  directory: z.string().max(1024),
  title: z.string().max(1024).optional(),
  libraryType: z.string().max(40).optional(),
  materialKind: z.string().max(40).optional(),
  skillKind: z.string().max(40).optional(),
  parentGenre: z.string().max(1024).optional(),
  subGenre: z.string().max(1024).optional(),
  overview: z.string().max(1_000_000).optional(),
  entries: z.array(ManifestEntrySchema).max(CATALOG_PROJECT_MAX_CONTENT_ITEMS)
});

export const LibraryPackageManifestSchema = z.object({
  format: z.literal(LIBRARY_PACKAGE_FORMAT),
  formatVersion: z.number().int().positive(),
  generator: z.string().max(200).optional(),
  exportedAt: z.string().max(64).optional(),
  domain: LibraryPackageDomainSchema,
  group: z
    .object({
      title: z.string().max(1024),
      members: z.record(z.string().max(40), z.string().max(64))
    })
    .optional(),
  libraries: z.array(ManifestLibrarySchema).max(LIBRARY_PACKAGE_MAX_LIBRARIES)
});
export type LibraryPackageManifest = z.infer<
  typeof LibraryPackageManifestSchema
>;
export type LibraryPackageManifestLibrary = z.infer<
  typeof ManifestLibrarySchema
>;
