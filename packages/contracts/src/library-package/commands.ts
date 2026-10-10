import { z } from "zod";
import { CatalogLibrarySchema, LibraryTypeSchema } from "../catalog";
import { CatalogIdSchema, CatalogTitleSchema } from "../catalog/kinds";
import { EnvelopeBaseSchema } from "../envelope";
import {
  LIBRARY_PACKAGE_MAX_LIBRARIES,
  LibraryPackageDomainSchema
} from "./manifest";
import { LIBRARY_PACKAGE_NOTES, LIBRARY_PACKAGE_SKIP_REASONS } from "./plan";

const CountSchema = z.number().int().nonnegative();
const PathSchema = z.string().min(1).max(4096);
const PreviewIdSchema = z.string().trim().min(1).max(200);
const KeySchema = z.string().min(1).max(64);

export const LibraryPackageSourceKindSchema = z.enum(["zip", "directory"]);
export type LibraryPackageSourceKind = z.infer<
  typeof LibraryPackageSourceKindSchema
>;

export const LibraryPackageTargetSchema = z
  .object({ type: z.enum(["library", "group"]), id: CatalogIdSchema })
  .strict();

export const ExportLibraryPackageInputSchema = z
  .object({
    domain: LibraryPackageDomainSchema,
    target: LibraryPackageTargetSchema
  })
  .strict();
export type ExportLibraryPackageInput = z.infer<
  typeof ExportLibraryPackageInputSchema
>;

export const ExportLibraryPackageResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("cancelled") }),
  z.object({
    status: z.literal("saved"),
    filePath: PathSchema,
    libraryCount: CountSchema,
    entryCount: CountSchema,
    skippedLibraryCount: CountSchema
  })
]);
export type ExportLibraryPackageResult = z.infer<
  typeof ExportLibraryPackageResultSchema
>;

/** Core → Main: everything one export needs, read without writing. */
export const LibraryPackageExportSourceSchema = z.object({
  domain: LibraryPackageDomainSchema,
  groupTitle: CatalogTitleSchema.nullable(),
  members: z
    .array(
      z.object({
        slot: z.string().max(40).nullable(),
        library: CatalogLibrarySchema.nullable()
      })
    )
    .min(1)
    .max(8)
});

export const ChooseLibraryPackageSourceInputSchema = z
  .object({
    domain: LibraryPackageDomainSchema,
    sourceKind: LibraryPackageSourceKindSchema
  })
  .strict();
export type ChooseLibraryPackageSourceInput = z.infer<
  typeof ChooseLibraryPackageSourceInputSchema
>;

const SkipReasonSchema = z.enum(LIBRARY_PACKAGE_SKIP_REASONS);

export const LibraryPackagePreviewLibrarySchema = z.object({
  key: KeySchema,
  title: CatalogTitleSchema,
  kind: z.string().min(1).max(40),
  kindEditable: z.boolean(),
  libraryType: LibraryTypeSchema,
  entryCount: CountSchema,
  contentBytes: CountSchema,
  /** Entry counts per stage hint; null means "no hint". */
  stageHints: z
    .array(
      z.object({
        hint: z.string().max(120).nullable(),
        count: z.number().int().positive()
      })
    )
    .max(32),
  blocked: z.enum(["bytes"]).nullable()
});
export type LibraryPackagePreviewLibrary = z.infer<
  typeof LibraryPackagePreviewLibrarySchema
>;

export const LibraryPackagePreviewSchema = z.object({
  sourceName: z.string().min(1).max(1024),
  sourceKind: LibraryPackageSourceKindSchema,
  recognition: z.enum(["package", "folder"]),
  domain: LibraryPackageDomainSchema,
  group: z
    .object({ title: CatalogTitleSchema, suggested: z.boolean() })
    .nullable(),
  libraries: z
    .array(LibraryPackagePreviewLibrarySchema)
    .min(1)
    .max(LIBRARY_PACKAGE_MAX_LIBRARIES),
  skipped: z.object({
    unsupported: CountSchema,
    empty: CountSchema,
    tooLarge: CountSchema,
    undecodable: CountSchema,
    missing: CountSchema,
    unassigned: CountSchema,
    limit: CountSchema
  }),
  skippedFiles: z
    .array(z.object({ path: PathSchema, reason: SkipReasonSchema }))
    .max(200),
  notes: z.array(z.enum(LIBRARY_PACKAGE_NOTES)).max(4)
});
export type LibraryPackagePreview = z.infer<typeof LibraryPackagePreviewSchema>;

export const PreviewLibraryPackageAtPathInputSchema = z
  .object({
    sourcePath: PathSchema,
    sourceKind: LibraryPackageSourceKindSchema,
    domain: LibraryPackageDomainSchema
  })
  .strict();
export const PreviewLibraryPackageAtPathResultSchema = z.object({
  preview: LibraryPackagePreviewSchema,
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/u)
});

export const ChooseLibraryPackageSourceResultSchema = z.object({
  previewId: PreviewIdSchema,
  expiresAt: z.string().datetime(),
  preview: LibraryPackagePreviewSchema
});
export type ChooseLibraryPackageSourceResult = z.infer<
  typeof ChooseLibraryPackageSourceResultSchema
>;

export const LibraryPackageImportChoicesSchema = z
  .object({
    libraries: z
      .array(
        z
          .object({
            key: KeySchema,
            include: z.boolean(),
            title: CatalogTitleSchema,
            kind: z.string().min(1).max(40).optional()
          })
          .strict()
      )
      .min(1)
      .max(LIBRARY_PACKAGE_MAX_LIBRARIES),
    createGroup: z.boolean(),
    groupTitle: CatalogTitleSchema.optional()
  })
  .strict();
export type LibraryPackageImportChoices = z.infer<
  typeof LibraryPackageImportChoicesSchema
>;

export const ImportLibraryPackageInputSchema = z
  .object({
    previewId: PreviewIdSchema,
    choices: LibraryPackageImportChoicesSchema
  })
  .strict();
export type ImportLibraryPackageInput = z.infer<
  typeof ImportLibraryPackageInputSchema
>;

export const ImportLibraryPackageAtPathInputSchema = z
  .object({
    sourcePath: PathSchema,
    sourceKind: LibraryPackageSourceKindSchema,
    domain: LibraryPackageDomainSchema,
    expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    choices: LibraryPackageImportChoicesSchema,
    parents: z.object({ library: PathSchema, group: PathSchema }).strict()
  })
  .strict();
export type ImportLibraryPackageAtPathInput = z.infer<
  typeof ImportLibraryPackageAtPathInputSchema
>;

export const ImportLibraryPackageResultSchema = z.object({
  domain: LibraryPackageDomainSchema,
  groupId: CatalogIdSchema.optional(),
  libraryIds: z
    .array(CatalogIdSchema)
    .min(1)
    .max(LIBRARY_PACKAGE_MAX_LIBRARIES),
  entryCount: CountSchema
});
export type ImportLibraryPackageResult = z.infer<
  typeof ImportLibraryPackageResultSchema
>;

export const DiscardLibraryPackagePreviewInputSchema = z
  .object({ previewId: PreviewIdSchema })
  .strict();
export const DiscardLibraryPackagePreviewResultSchema = z.object({
  discarded: z.boolean()
});

const envelope = <T extends string, S extends z.ZodType>(type: T, payload: S) =>
  EnvelopeBaseSchema.extend({ type: z.literal(type), payload });

export const LibraryPackagePublicCommandSchemas = [
  envelope("catalog.exportLibraryPackage", ExportLibraryPackageInputSchema),
  envelope(
    "catalog.chooseLibraryPackageSource",
    ChooseLibraryPackageSourceInputSchema
  ),
  envelope("catalog.importLibraryPackage", ImportLibraryPackageInputSchema),
  envelope(
    "catalog.discardLibraryPackagePreview",
    DiscardLibraryPackagePreviewInputSchema
  )
] as const;

/** Main → Core only; Main rejects these from the Renderer. */
export const LIBRARY_PACKAGE_INTERNAL_COMMAND_TYPES = [
  "catalog.readLibraryPackageSource",
  "catalog.previewLibraryPackageAtPath",
  "catalog.importLibraryPackageAtPath"
] as const;

export const LibraryPackageCommandSchemas = [
  ...LibraryPackagePublicCommandSchemas,
  envelope("catalog.readLibraryPackageSource", ExportLibraryPackageInputSchema),
  envelope(
    "catalog.previewLibraryPackageAtPath",
    PreviewLibraryPackageAtPathInputSchema
  ),
  envelope(
    "catalog.importLibraryPackageAtPath",
    ImportLibraryPackageAtPathInputSchema
  )
] as const;
