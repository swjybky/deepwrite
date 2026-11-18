import { z } from "zod";
import {
  CATALOG_PROJECT_MAX_CONTENT_ITEMS,
  CatalogIdSchema,
  CatalogTitleSchema,
  TimestampSchema,
  uniqueIds
} from "../catalog/kinds";
import { createShortWorkspaceContentRevision } from "../workspace";

export const MYSTERY_DOCUMENT_MAX_CHARACTERS = 500_000;
export const MYSTERY_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const MYSTERY_AGENTS_MD_MAX_CHARACTERS = 20_000;
export const MYSTERY_MAX_ROLES = 32;
export const MYSTERY_MAX_ACTS = 24;
export const MYSTERY_MAX_CLUE_ROUNDS = 24;
export const MYSTERY_MAX_TRUTH_DOCS = 32;
export const MYSTERY_EXPORT_MAX_CHARACTERS = 64 * 1024 * 1024;

export const MYSTERY_BOOK_GENRES = [
  "硬核推理",
  "情感沉浸",
  "机制阵营",
  "欢乐撕逼",
  "恐怖变格",
  "其他"
] as const;
export const MysteryBookGenreSchema = z.enum(MYSTERY_BOOK_GENRES);
export type MysteryBookGenre = z.infer<typeof MysteryBookGenreSchema>;

export const MYSTERY_NARRATIVE_PERSONS = ["second", "first"] as const;
export const MysteryNarrativePersonSchema = z.enum(MYSTERY_NARRATIVE_PERSONS);
export type MysteryNarrativePerson = z.infer<
  typeof MysteryNarrativePersonSchema
>;

export const MYSTERY_STAGES = [
  "truth",
  "characters",
  "scripts",
  "clues",
  "dm"
] as const;
export const MysteryStageIdSchema = z.enum(MYSTERY_STAGES);
export type MysteryStageId = z.infer<typeof MysteryStageIdSchema>;

export const MYSTERY_BUILTIN_TRUTH_DOC_IDS = [
  "overview",
  "core_truth",
  "timeline_dispatch"
] as const;
export const MysteryBuiltinTruthDocIdSchema = z.enum(
  MYSTERY_BUILTIN_TRUTH_DOC_IDS
);
export type MysteryBuiltinTruthDocId = z.infer<
  typeof MysteryBuiltinTruthDocIdSchema
>;

export const MYSTERY_BUILTIN_TRUTH_DOC_TITLES: Record<
  MysteryBuiltinTruthDocId,
  string
> = {
  overview: "盘面与世界观",
  core_truth: "故事真相与核心设计",
  timeline_dispatch: "全局时间线与信息分流表"
};

export const MysteryIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u, {
    message:
      "Mystery ids may contain only letters, numbers, dots, underscores, and hyphens."
  });
export type MysteryId = z.infer<typeof MysteryIdSchema>;

export const MysteryBookIdSchema = CatalogIdSchema;
export type MysteryBookId = z.infer<typeof MysteryBookIdSchema>;

export const MysteryRevisionSchema = z.string().regex(/^v1:\d+:[0-9a-f]{8}$/u);

export const MysteryBoardSpecSchema = z
  .object({
    playerCount: z.number().int().min(1).max(16).default(6),
    actCountTarget: z.number().int().min(1).max(12).default(3),
    narrativePerson: MysteryNarrativePersonSchema.default("second"),
    summary: z.string().max(2_000).default("")
  })
  .strict();
export type MysteryBoardSpec = z.infer<typeof MysteryBoardSpecSchema>;

export const MysteryTruthDocEntrySchema = z
  .object({
    id: MysteryIdSchema,
    title: CatalogTitleSchema,
    order: z.number().int().positive(),
    builtin: z.boolean()
  })
  .strict();
export type MysteryTruthDocEntry = z.infer<typeof MysteryTruthDocEntrySchema>;

export const MysteryRoleEntrySchema = z
  .object({
    id: MysteryIdSchema,
    name: CatalogTitleSchema,
    tag: z.string().trim().max(80).default(""),
    order: z.number().int().positive()
  })
  .strict();
export type MysteryRoleEntry = z.infer<typeof MysteryRoleEntrySchema>;

export const MysteryActEntrySchema = z
  .object({
    id: MysteryIdSchema,
    title: CatalogTitleSchema,
    order: z.number().int().positive()
  })
  .strict();
export type MysteryActEntry = z.infer<typeof MysteryActEntrySchema>;

export const MysteryClueRoundEntrySchema = z
  .object({
    id: MysteryIdSchema,
    title: CatalogTitleSchema,
    order: z.number().int().positive()
  })
  .strict();
export type MysteryClueRoundEntry = z.infer<typeof MysteryClueRoundEntrySchema>;

const UniqueLibraryIdListSchema = z
  .array(CatalogIdSchema)
  .max(1_000)
  .refine(uniqueIds, {
    message: "Linked library ids cannot contain duplicates."
  });

function validateOrderedEntries<T extends { id: string; order: number }>(
  items: readonly T[],
  label: string,
  path: string[],
  context: z.core.$RefinementCtx<unknown>
): void {
  if (!uniqueIds(items.map((item) => item.id))) {
    context.addIssue({
      code: "custom",
      path,
      message: `${label} ids cannot contain duplicates.`
    });
  }
  if (!uniqueIds(items.map((item) => String(item.order)))) {
    context.addIssue({
      code: "custom",
      path,
      message: `${label} orders cannot contain duplicates.`
    });
  }
}

export const MysteryBookManifestSchema = z
  .object({
    kind: z.literal("deepwrite.mystery-book"),
    schemaVersion: z.literal(1),
    id: MysteryBookIdSchema,
    title: CatalogTitleSchema,
    genre: MysteryBookGenreSchema,
    status: z.enum(["editing", "completed"]),
    boardSpec: MysteryBoardSpecSchema,
    linkedMaterialIds: UniqueLibraryIdListSchema,
    linkedSkillIds: UniqueLibraryIdListSchema,
    truthDocuments: z
      .array(MysteryTruthDocEntrySchema)
      .min(MYSTERY_BUILTIN_TRUTH_DOC_IDS.length)
      .max(MYSTERY_MAX_TRUTH_DOCS),
    roles: z.array(MysteryRoleEntrySchema).min(1).max(MYSTERY_MAX_ROLES),
    acts: z.array(MysteryActEntrySchema).min(1).max(MYSTERY_MAX_ACTS),
    clueRounds: z
      .array(MysteryClueRoundEntrySchema)
      .min(0)
      .max(MYSTERY_MAX_CLUE_ROUNDS),
    revision: z.number().int().nonnegative(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict()
  .superRefine((manifest, context) => {
    validateOrderedEntries(
      manifest.truthDocuments,
      "Truth document",
      ["truthDocuments"],
      context
    );
    validateOrderedEntries(manifest.roles, "Role", ["roles"], context);
    validateOrderedEntries(manifest.acts, "Act", ["acts"], context);
    validateOrderedEntries(
      manifest.clueRounds,
      "Clue round",
      ["clueRounds"],
      context
    );
    for (const builtinId of MYSTERY_BUILTIN_TRUTH_DOC_IDS) {
      const entry = manifest.truthDocuments.find((doc) => doc.id === builtinId);
      if (!entry || !entry.builtin) {
        context.addIssue({
          code: "custom",
          path: ["truthDocuments"],
          message: `Missing built-in truth document: ${builtinId}`
        });
      }
    }
    const contentCount =
      1 +
      manifest.truthDocuments.length +
      1 +
      manifest.roles.length * 2 +
      manifest.roles.length * manifest.acts.length * 2 +
      2 +
      manifest.clueRounds.length +
      1;
    if (contentCount > CATALOG_PROJECT_MAX_CONTENT_ITEMS) {
      context.addIssue({
        code: "custom",
        path: ["roles"],
        message: "Mystery book exceeds maximum content item limit."
      });
    }
  });
export type MysteryBookManifest = z.infer<typeof MysteryBookManifestSchema>;

export const MysteryBookSummarySchema = z
  .object({
    id: MysteryBookIdSchema,
    title: CatalogTitleSchema,
    genre: MysteryBookGenreSchema,
    status: z.enum(["editing", "completed"]),
    boardSpec: MysteryBoardSpecSchema,
    linkedMaterialIds: UniqueLibraryIdListSchema,
    linkedSkillIds: UniqueLibraryIdListSchema,
    roleCount: z.number().int().positive(),
    actCount: z.number().int().positive(),
    clueRoundCount: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();
export type MysteryBookSummary = z.infer<typeof MysteryBookSummarySchema>;

export const MysteryProjectDiagnosticSchema = z
  .object({
    bookId: MysteryBookIdSchema,
    code: z.enum(["unavailable", "invalid"]),
    message: z.string().trim().min(1).max(1_000)
  })
  .strict();
export type MysteryProjectDiagnostic = z.infer<
  typeof MysteryProjectDiagnosticSchema
>;

export const MysteryDocumentStatsSchema = z
  .object({
    charCount: z.number().int().nonnegative(),
    revision: MysteryRevisionSchema,
    updatedAt: TimestampSchema
  })
  .strict();
export type MysteryDocumentStats = z.infer<typeof MysteryDocumentStatsSchema>;

export const MysteryActMatrixCellSchema = z
  .object({
    roleId: MysteryIdSchema,
    actId: MysteryIdSchema,
    briefChars: z.number().int().nonnegative(),
    bodyChars: z.number().int().nonnegative(),
    briefRevision: MysteryRevisionSchema,
    bodyRevision: MysteryRevisionSchema
  })
  .strict();
export type MysteryActMatrixCell = z.infer<typeof MysteryActMatrixCellSchema>;

export const MysteryRoleIndexItemSchema = MysteryRoleEntrySchema.extend({
  profileChars: z.number().int().nonnegative(),
  pitchChars: z.number().int().nonnegative(),
  profileRevision: MysteryRevisionSchema,
  pitchRevision: MysteryRevisionSchema
}).strict();
export type MysteryRoleIndexItem = z.infer<typeof MysteryRoleIndexItemSchema>;

export const MysteryTruthDocIndexItemSchema = MysteryTruthDocEntrySchema.extend(
  {
    charCount: z.number().int().nonnegative(),
    revision: MysteryRevisionSchema
  }
).strict();

export const MysteryClueRoundIndexItemSchema =
  MysteryClueRoundEntrySchema.extend({
    charCount: z.number().int().nonnegative(),
    revision: MysteryRevisionSchema
  }).strict();

export const MysteryWorkspaceIndexSnapshotSchema = z
  .object({
    bookId: MysteryBookIdSchema,
    title: CatalogTitleSchema,
    genre: MysteryBookGenreSchema,
    status: z.enum(["editing", "completed"]),
    boardSpec: MysteryBoardSpecSchema,
    revision: z.number().int().nonnegative(),
    updatedAt: TimestampSchema,
    agentsMdChars: z.number().int().nonnegative(),
    agentsMdRevision: MysteryRevisionSchema,
    truthDocuments: z.array(MysteryTruthDocIndexItemSchema),
    characterRelations: MysteryDocumentStatsSchema,
    roles: z.array(MysteryRoleIndexItemSchema),
    acts: z.array(MysteryActEntrySchema),
    actMatrix: z.array(MysteryActMatrixCellSchema),
    clueRounds: z.array(MysteryClueRoundIndexItemSchema),
    publicOpenings: MysteryDocumentStatsSchema,
    endings: MysteryDocumentStatsSchema,
    dmManual: MysteryDocumentStatsSchema
  })
  .strict();
export type MysteryWorkspaceIndexSnapshot = z.infer<
  typeof MysteryWorkspaceIndexSnapshotSchema
>;

export const MysteryDocumentTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agents_md") }).strict(),
  z.object({ kind: z.literal("truth_doc"), docId: MysteryIdSchema }).strict(),
  z.object({ kind: z.literal("character_relations") }).strict(),
  z
    .object({
      kind: z.literal("role"),
      roleId: MysteryIdSchema,
      document: z.enum(["profile", "pitch"])
    })
    .strict(),
  z
    .object({
      kind: z.literal("player_act"),
      roleId: MysteryIdSchema,
      actId: MysteryIdSchema,
      document: z.enum(["brief", "body"])
    })
    .strict(),
  z
    .object({ kind: z.literal("clue_round"), roundId: MysteryIdSchema })
    .strict(),
  z
    .object({
      kind: z.literal("public_doc"),
      docId: z.enum(["public_openings", "endings"])
    })
    .strict(),
  z.object({ kind: z.literal("dm_manual") }).strict()
]);
export type MysteryDocumentTarget = z.infer<typeof MysteryDocumentTargetSchema>;

export function mysteryDocumentTargetKey(
  target: MysteryDocumentTarget
): string {
  switch (target.kind) {
    case "agents_md":
      return "agents_md";
    case "truth_doc":
      return `truth_doc:${target.docId}`;
    case "character_relations":
      return "character_relations";
    case "role":
      return `role:${target.roleId}:${target.document}`;
    case "player_act":
      return `player_act:${target.roleId}:${target.actId}:${target.document}`;
    case "clue_round":
      return `clue_round:${target.roundId}`;
    case "public_doc":
      return `public_doc:${target.docId}`;
    case "dm_manual":
      return "dm_manual";
  }
}

export function mysteryDocumentRelativePath(
  target: MysteryDocumentTarget
): string {
  switch (target.kind) {
    case "agents_md":
      return "AGENTS.md";
    case "truth_doc":
      return `truth/${target.docId}.md`;
    case "character_relations":
      return "characters/relations.md";
    case "role":
      return `characters/${target.roleId}.${target.document}.md`;
    case "player_act":
      return `scripts/${target.roleId}/${target.actId}.${target.document}.md`;
    case "clue_round":
      return `clues/${target.roundId}.md`;
    case "public_doc":
      return target.docId === "public_openings"
        ? "clues/public-openings.md"
        : "clues/endings.md";
    case "dm_manual":
      return "dm/manual.md";
  }
}

export function mysteryStageForTarget(
  target: MysteryDocumentTarget
): MysteryStageId {
  switch (target.kind) {
    case "agents_md":
    case "truth_doc":
      return "truth";
    case "character_relations":
    case "role":
      return "characters";
    case "player_act":
      return "scripts";
    case "clue_round":
    case "public_doc":
      return "clues";
    case "dm_manual":
      return "dm";
  }
}

export function isMysteryPlayerVisibleTarget(
  target: MysteryDocumentTarget
): boolean {
  switch (target.kind) {
    case "role":
      return target.document === "pitch";
    case "player_act":
      return target.document === "body";
    case "clue_round":
      return true;
    case "public_doc":
      return target.docId === "public_openings";
    default:
      return false;
  }
}

export function createDefaultMysteryTruthDocuments(): MysteryTruthDocEntry[] {
  return MYSTERY_BUILTIN_TRUTH_DOC_IDS.map((id, index) => ({
    id,
    title: MYSTERY_BUILTIN_TRUTH_DOC_TITLES[id],
    order: index + 1,
    builtin: true
  }));
}

export function summarizeMysteryBook(
  manifest: MysteryBookManifest
): MysteryBookSummary {
  return {
    id: manifest.id,
    title: manifest.title,
    genre: manifest.genre,
    status: manifest.status,
    boardSpec: manifest.boardSpec,
    linkedMaterialIds: [...manifest.linkedMaterialIds],
    linkedSkillIds: [...manifest.linkedSkillIds],
    roleCount: manifest.roles.length,
    actCount: manifest.acts.length,
    clueRoundCount: manifest.clueRounds.length,
    revision: manifest.revision,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt
  };
}

export function mysteryTextRevision(content: string): string {
  return createShortWorkspaceContentRevision(content);
}

export function mysteryCharCount(content: string): number {
  let count = 0;
  for (const _char of content) count += 1;
  return count;
}

export function buildEmptyMysteryWorkspaceIndex(
  manifest: MysteryBookManifest
): MysteryWorkspaceIndexSnapshot {
  const emptyStats = (updatedAt: string): MysteryDocumentStats => ({
    charCount: 0,
    revision: mysteryTextRevision(""),
    updatedAt
  });
  const emptyRev = mysteryTextRevision("");
  return {
    bookId: manifest.id,
    title: manifest.title,
    genre: manifest.genre,
    status: manifest.status,
    boardSpec: manifest.boardSpec,
    revision: manifest.revision,
    updatedAt: manifest.updatedAt,
    agentsMdChars: 0,
    agentsMdRevision: emptyRev,
    truthDocuments: [...manifest.truthDocuments]
      .sort((a, b) => a.order - b.order)
      .map((doc) => ({ ...doc, charCount: 0, revision: emptyRev })),
    characterRelations: emptyStats(manifest.updatedAt),
    roles: [...manifest.roles]
      .sort((a, b) => a.order - b.order)
      .map((role) => ({
        ...role,
        profileChars: 0,
        pitchChars: 0,
        profileRevision: emptyRev,
        pitchRevision: emptyRev
      })),
    acts: [...manifest.acts].sort((a, b) => a.order - b.order),
    actMatrix: manifest.roles.flatMap((role) =>
      manifest.acts.map((act) => ({
        roleId: role.id,
        actId: act.id,
        briefChars: 0,
        bodyChars: 0,
        briefRevision: emptyRev,
        bodyRevision: emptyRev
      }))
    ),
    clueRounds: [...manifest.clueRounds]
      .sort((a, b) => a.order - b.order)
      .map((round) => ({ ...round, charCount: 0, revision: emptyRev })),
    publicOpenings: emptyStats(manifest.updatedAt),
    endings: emptyStats(manifest.updatedAt),
    dmManual: emptyStats(manifest.updatedAt)
  };
}

export const MysteryProjectRegistrationSchema = z
  .object({
    bookId: MysteryBookIdSchema,
    projectDirectory: z.string().min(1),
    summary: MysteryBookSummarySchema
  })
  .strict();
export type MysteryProjectRegistration = z.infer<
  typeof MysteryProjectRegistrationSchema
>;

export const MysteryProjectRegistrySchema = z
  .object({
    version: z.literal(1),
    projects: z.array(MysteryProjectRegistrationSchema)
  })
  .strict();
export type MysteryProjectRegistry = z.infer<
  typeof MysteryProjectRegistrySchema
>;
