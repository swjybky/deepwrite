import { z } from "zod";

import {
  LinkedMaterialIdsByKindSchema,
  LinkedSkillIdsByKindSchema
} from "../catalog";
import {
  LONG_WORKSPACE_INDEX_FILE_ID,
  LONG_WORKSPACE_INDEX_PATH,
  LongBookIdSchema,
  LongJsonFileReferenceSchema,
  LongProjectManifestSchemaVersionSchema,
  LongWorkspaceSchemaVersionSchema
} from "./ids";
import {
  LongWorkspaceIndexSnapshotSchema,
  type LongWorkspaceIndexSnapshot
} from "./index-validation";
import {
  createLongWorkspaceNavigationSnapshot,
  LongWorkspaceNavigationSnapshotSchema
} from "./navigation";
import {
  LONG_WORKSPACE_ROOTS,
  LongWorkspaceRootSchema,
  type LongWorkspaceRoot
} from "./agents";
import { LongTimestampSchema, LongTitleSchema } from "./primitives";

const LongResourceStageListSchema = z
  .array(LongWorkspaceRootSchema)
  .min(1)
  .max(LONG_WORKSPACE_ROOTS.length)
  .superRefine((roots, context) => {
    const seen = new Set<LongWorkspaceRoot>();
    roots.forEach((root, index) => {
      if (seen.has(root)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `Duplicate long resource stage: ${root}`
        });
      }
      seen.add(root);
    });
  });

const LongResourceStageScopeMapSchema = z.record(
  z.string().trim().min(1).max(512),
  LongResourceStageListSchema
);

/**
 * Legacy per-library stage overrides, retained only for manifest compatibility.
 * Resource loading no longer uses stages.
 */
export const LongLinkedResourceStageScopesSchema = z
  .object({
    materials: LongResourceStageScopeMapSchema,
    skills: LongResourceStageScopeMapSchema
  })
  .strict();
export type LongLinkedResourceStageScopes = z.infer<
  typeof LongLinkedResourceStageScopesSchema
>;

export const EMPTY_LONG_LINKED_RESOURCE_STAGE_SCOPES = {
  materials: {},
  skills: {}
} as const satisfies LongLinkedResourceStageScopes;

const LongBookSharedShape = {
  id: LongBookIdSchema,
  title: LongTitleSchema,
  bookType: z.literal("long"),
  genre: z.string().trim().min(1).max(120),
  status: z.enum(["editing", "completed"]),
  linkedMaterialIdsByKind: LinkedMaterialIdsByKindSchema,
  linkedSkillIdsByKind: LinkedSkillIdsByKindSchema,
  linkedResourceStageScopes: LongLinkedResourceStageScopesSchema.optional(),
  createdAt: LongTimestampSchema,
  updatedAt: LongTimestampSchema
} as const;

export const LongBookSchema = z
  .object({
    schemaVersion: LongWorkspaceSchemaVersionSchema,
    ...LongBookSharedShape,
    workspaceIndex: LongWorkspaceIndexSnapshotSchema
  })
  .strict()
  .superRefine((book, context) => {
    if (book.workspaceIndex.bookId !== book.id) {
      context.addIssue({
        code: "custom",
        path: ["workspaceIndex", "bookId"],
        message: "Long book and workspace index ids must match."
      });
    }
    if (book.updatedAt !== book.workspaceIndex.updatedAt) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "Long book and workspace index update timestamps must match."
      });
    }
  });
export type LongBook = z.infer<typeof LongBookSchema>;

export const LongBookMetadataSchema = z
  .object({
    schemaVersion: LongWorkspaceSchemaVersionSchema,
    kind: z.literal("deepwrite.long-book"),
    ...LongBookSharedShape
  })
  .strict();
export type LongBookMetadata = z.infer<typeof LongBookMetadataSchema>;

export const LongBookSummarySchema = LongBookMetadataSchema.extend({
  navigation: LongWorkspaceNavigationSnapshotSchema
}).superRefine((book, context) => {
  if (book.navigation.bookId !== book.id) {
    context.addIssue({
      code: "custom",
      path: ["navigation", "bookId"],
      message: "Long book summary and navigation ids must match."
    });
  }
  if (book.updatedAt !== book.navigation.updatedAt) {
    context.addIssue({
      code: "custom",
      path: ["updatedAt"],
      message: "Long book summary and navigation update timestamps must match."
    });
  }
});
export type LongBookSummary = z.infer<typeof LongBookSummarySchema>;

export function createLongBookMetadata(book: LongBook): LongBookMetadata {
  return LongBookMetadataSchema.parse({
    schemaVersion: book.schemaVersion,
    kind: "deepwrite.long-book",
    id: book.id,
    title: book.title,
    bookType: book.bookType,
    genre: book.genre,
    status: book.status,
    linkedMaterialIdsByKind: book.linkedMaterialIdsByKind,
    linkedSkillIdsByKind: book.linkedSkillIdsByKind,
    linkedResourceStageScopes: book.linkedResourceStageScopes,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt
  });
}

export function createLongBookSummary(book: LongBook): LongBookSummary {
  return LongBookSummarySchema.parse({
    ...createLongBookMetadata(book),
    navigation: createLongWorkspaceNavigationSnapshot(book.workspaceIndex)
  });
}

export const LongWorkspaceIndexFileReferenceSchema =
  LongJsonFileReferenceSchema.superRefine((file, context) => {
    if (file.id !== LONG_WORKSPACE_INDEX_FILE_ID) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: `Long workspace index id must be ${LONG_WORKSPACE_INDEX_FILE_ID}.`
      });
    }
    if (file.path !== LONG_WORKSPACE_INDEX_PATH) {
      context.addIssue({
        code: "custom",
        path: ["path"],
        message: `Long workspace index path must be ${LONG_WORKSPACE_INDEX_PATH}.`
      });
    }
  });
export type LongWorkspaceIndexFileReference = z.infer<
  typeof LongWorkspaceIndexFileReferenceSchema
>;

/**
 * The physical long-book manifest stays intentionally small. Structure and
 * file indexes live in `long/index.json`; chapter body content stays in the
 * indexed Markdown files.
 */
export const LongProjectManifestSchema = z
  .object({
    schemaVersion: LongProjectManifestSchemaVersionSchema,
    kind: z.literal("deepwrite.long-book"),
    ...LongBookSharedShape,
    workspaceIndexFile: LongWorkspaceIndexFileReferenceSchema
  })
  .strict();
export type LongProjectManifest = z.infer<typeof LongProjectManifestSchema>;

/** Disk loading and sync must accept the same manifest/index revision pair. */
export function assertLongProjectIndexMetadata(
  manifest: Pick<
    LongProjectManifest,
    "id" | "updatedAt" | "workspaceIndexFile"
  >,
  index: Pick<LongWorkspaceIndexSnapshot, "bookId" | "updatedAt">
): void {
  if (manifest.id !== index.bookId)
    throw new Error("长篇 manifest 与工作区索引的 book id 不一致。");
  if (
    manifest.updatedAt !== index.updatedAt ||
    manifest.workspaceIndexFile.updatedAt !== index.updatedAt
  )
    throw new Error("长篇 manifest 与工作区索引的更新时间不一致。");
}
