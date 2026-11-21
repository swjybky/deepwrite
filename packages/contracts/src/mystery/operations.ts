import { z } from "zod";
import {
  CatalogIdSchema,
  CatalogTitleSchema,
  TimestampSchema
} from "../catalog/kinds";
import { DocumentVersionOriginSchema } from "../document-version-origin";
import {
  MYSTERY_DOCUMENT_MAX_CHARACTERS,
  MYSTERY_MAX_ACTS,
  MYSTERY_MAX_CLUE_ROUNDS,
  MYSTERY_MAX_ROLES,
  MYSTERY_MAX_TRUTH_DOCS,
  MysteryBoardSpecSchema,
  MysteryBookManifestSchema,
  MysteryBookSummarySchema,
  MysteryDocumentTargetSchema,
  MysteryIdSchema,
  MysteryRevisionSchema,
  MysteryStageIdSchema,
  MysteryWorkspaceIndexSnapshotSchema,
  isMysteryPlayerVisibleTarget,
  mysteryCharCount,
  mysteryDocumentTargetKey,
  mysteryTextRevision,
  type MysteryBookManifest,
  type MysteryDocumentTarget,
  type MysteryWorkspaceIndexSnapshot
} from "./manifest";

export type MysteryOperationErrorCode =
  | "not_found"
  | "already_exists"
  | "builtin_protected"
  | "minimum_required"
  | "invalid_order"
  | "invalid_target"
  | "document_changed"
  | "restore_conflict"
  | "restore_unavailable";

export class MysteryWorkspaceOperationError extends Error {
  constructor(
    readonly code: MysteryOperationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "MysteryWorkspaceOperationError";
  }
}

export const MysteryReorderAnchorSchema = z
  .object({
    anchorId: MysteryIdSchema,
    position: z.enum(["before", "after"])
  })
  .strict();

export const MysteryOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("boardSpec.update"),
      boardSpec: MysteryBoardSpecSchema.partial()
    })
    .strict(),
  z
    .object({
      type: z.literal("truthDoc.create"),
      doc: z
        .object({
          id: MysteryIdSchema,
          title: CatalogTitleSchema,
          content: z.string().max(MYSTERY_DOCUMENT_MAX_CHARACTERS).optional()
        })
        .strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("truthDoc.updateMeta"),
      docId: MysteryIdSchema,
      title: CatalogTitleSchema.optional(),
      move: z.enum(["up", "down"]).optional(),
      reorder: MysteryReorderAnchorSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("truthDoc.delete"),
      docId: MysteryIdSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("role.create"),
      role: z
        .object({
          id: MysteryIdSchema,
          name: CatalogTitleSchema,
          tag: z.string().trim().max(80).default(""),
          profileContent: z
            .string()
            .max(MYSTERY_DOCUMENT_MAX_CHARACTERS)
            .optional(),
          pitchContent: z
            .string()
            .max(MYSTERY_DOCUMENT_MAX_CHARACTERS)
            .optional()
        })
        .strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("role.updateMeta"),
      roleId: MysteryIdSchema,
      name: CatalogTitleSchema.optional(),
      tag: z.string().trim().max(80).optional(),
      move: z.enum(["up", "down"]).optional(),
      reorder: MysteryReorderAnchorSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("role.delete"),
      roleId: MysteryIdSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("act.create"),
      act: z
        .object({
          id: MysteryIdSchema,
          title: CatalogTitleSchema
        })
        .strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("act.updateMeta"),
      actId: MysteryIdSchema,
      title: CatalogTitleSchema.optional(),
      move: z.enum(["up", "down"]).optional(),
      reorder: MysteryReorderAnchorSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("act.delete"),
      actId: MysteryIdSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("clueRound.create"),
      round: z
        .object({
          id: MysteryIdSchema,
          title: CatalogTitleSchema,
          content: z.string().max(MYSTERY_DOCUMENT_MAX_CHARACTERS).optional()
        })
        .strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("clueRound.updateMeta"),
      roundId: MysteryIdSchema,
      title: CatalogTitleSchema.optional(),
      move: z.enum(["up", "down"]).optional(),
      reorder: MysteryReorderAnchorSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("clueRound.delete"),
      roundId: MysteryIdSchema
    })
    .strict()
]);
export type MysteryOperation = z.infer<typeof MysteryOperationSchema>;

export const MysteryDocumentWriteSchema = z
  .object({
    target: MysteryDocumentTargetSchema,
    content: z.string().max(MYSTERY_DOCUMENT_MAX_CHARACTERS),
    expectedRevision: MysteryRevisionSchema.optional()
  })
  .strict();
export type MysteryDocumentWrite = z.infer<typeof MysteryDocumentWriteSchema>;

export const MysteryOperationBatchSchema = z
  .object({
    operations: z.array(MysteryOperationSchema).max(200),
    documentWrites: z.array(MysteryDocumentWriteSchema).max(200)
  })
  .strict()
  .superRefine((batch, context) => {
    const keys = new Set<string>();
    batch.documentWrites.forEach((write, index) => {
      const key = mysteryDocumentTargetKey(write.target);
      if (keys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["documentWrites", index, "target"],
          message: `Duplicate document write target in batch: ${key}`
        });
      }
      keys.add(key);
    });
  });
export type MysteryOperationBatch = z.infer<typeof MysteryOperationBatchSchema>;

export const MysteryDeletedDocumentSnapshotSchema = z
  .object({
    target: MysteryDocumentTargetSchema,
    content: z.string().max(MYSTERY_DOCUMENT_MAX_CHARACTERS)
  })
  .strict();
export type MysteryDeletedDocumentSnapshot = z.infer<
  typeof MysteryDeletedDocumentSnapshotSchema
>;

export const MysteryRestorePointSchema = z
  .object({
    restoreId: CatalogIdSchema,
    createdAt: TimestampSchema,
    previousRevision: z.number().int().nonnegative(),
    previousManifest: MysteryBookManifestSchema,
    writtenTargetsBefore: z.array(MysteryDeletedDocumentSnapshotSchema),
    deletedDocuments: z.array(MysteryDeletedDocumentSnapshotSchema)
  })
  .strict();
export type MysteryRestorePoint = z.infer<typeof MysteryRestorePointSchema>;

export const MysteryPreviewOperationsResultSchema = z
  .object({
    workspaceIndex: MysteryWorkspaceIndexSnapshotSchema,
    structureChanges: z.array(z.string().max(500))
  })
  .strict();
export type MysteryPreviewOperationsResult = z.infer<
  typeof MysteryPreviewOperationsResultSchema
>;

export const MysteryApplyOperationsResultSchema = z
  .object({
    book: MysteryBookManifestSchema,
    summary: MysteryBookSummarySchema,
    workspaceIndex: MysteryWorkspaceIndexSnapshotSchema,
    restorePoint: MysteryRestorePointSchema.optional()
  })
  .strict();
export type MysteryApplyOperationsResult = z.infer<
  typeof MysteryApplyOperationsResultSchema
>;

export const MysteryRestoreOperationsResultSchema = z
  .object({
    book: MysteryBookManifestSchema,
    summary: MysteryBookSummarySchema,
    workspaceIndex: MysteryWorkspaceIndexSnapshotSchema,
    restoredId: CatalogIdSchema
  })
  .strict();
export type MysteryRestoreOperationsResult = z.infer<
  typeof MysteryRestoreOperationsResultSchema
>;

export const MysterySearchHitSchema = z
  .object({
    target: MysteryDocumentTargetSchema,
    targetKey: z.string().min(1).max(240),
    stage: MysteryStageIdSchema,
    title: z.string().min(1).max(256),
    playerVisible: z.boolean(),
    snippet: z.string().max(400),
    matchCount: z.number().int().positive()
  })
  .strict();
export type MysterySearchHit = z.infer<typeof MysterySearchHitSchema>;

export const MysterySearchInputSchema = z
  .object({
    bookId: CatalogIdSchema,
    query: z.string().trim().min(1).max(300),
    stage: MysteryStageIdSchema.optional(),
    playerVisibleOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).default(30)
  })
  .strict();
export type MysterySearchInput = z.infer<typeof MysterySearchInputSchema>;

export const MysterySearchResultSchema = z
  .object({
    bookId: CatalogIdSchema,
    query: z.string(),
    totalHits: z.number().int().nonnegative(),
    hits: z.array(MysterySearchHitSchema)
  })
  .strict();
export type MysterySearchResult = z.infer<typeof MysterySearchResultSchema>;

export const MYSTERY_EXPORT_FORMATS = ["md", "docx"] as const;
export const MysteryExportFormatSchema = z.enum(MYSTERY_EXPORT_FORMATS);
export type MysteryExportFormat = z.infer<typeof MysteryExportFormatSchema>;

export const MYSTERY_PLAYER_SCRIPT_LAYOUTS = [
  "by-role",
  "by-role-act"
] as const;
export const MysteryPlayerScriptLayoutSchema = z.enum(
  MYSTERY_PLAYER_SCRIPT_LAYOUTS
);
export type MysteryPlayerScriptLayout = z.infer<
  typeof MysteryPlayerScriptLayoutSchema
>;

export const MysteryExportBundleInputSchema = z
  .object({
    bookId: CatalogIdSchema,
    targetDirectory: z.string().trim().min(1).max(2_048).optional(),
    format: MysteryExportFormatSchema.default("md"),
    playerScriptLayout: MysteryPlayerScriptLayoutSchema.default("by-role")
  })
  .strict();
export type MysteryExportBundleInput = z.infer<
  typeof MysteryExportBundleInputSchema
>;

export const MysteryExportBundleResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("cancelled") }).strict(),
  z
    .object({
      status: z.literal("saved"),
      bundleDirectory: z.string().min(1),
      fileCount: z.number().int().positive(),
      missingImages: z.number().int().nonnegative()
    })
    .strict()
]);
export type MysteryExportBundleResult = z.infer<
  typeof MysteryExportBundleResultSchema
>;

export const MysteryWriteDocumentResultSchema = z
  .object({
    bookId: CatalogIdSchema,
    target: MysteryDocumentTargetSchema,
    revision: MysteryRevisionSchema,
    charCount: z.number().int().nonnegative(),
    updatedAt: TimestampSchema,
    summary: MysteryBookSummarySchema
  })
  .strict();
export type MysteryWriteDocumentResult = z.infer<
  typeof MysteryWriteDocumentResultSchema
>;

export const MysteryApplyOperationsInputSchema = z
  .object({
    bookId: CatalogIdSchema,
    expectedBookRevision: z.number().int().nonnegative().optional(),
    batch: MysteryOperationBatchSchema,
    versionOrigin: DocumentVersionOriginSchema.optional()
  })
  .strict();
export type MysteryApplyOperationsInput = z.infer<
  typeof MysteryApplyOperationsInputSchema
>;

function moveOrderedItem<T extends { id: string; order: number }>(
  items: T[],
  id: string,
  direction: "up" | "down",
  label: string
): T[] {
  const sorted = [...items].sort((a, b) => a.order - b.order);
  const index = sorted.findIndex((item) => item.id === id);
  if (index < 0) {
    throw new MysteryWorkspaceOperationError(
      "not_found",
      `${label}不存在：${id}`
    );
  }
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= sorted.length) {
    throw new MysteryWorkspaceOperationError(
      "invalid_order",
      `${label}已经在${direction === "up" ? "最前" : "最后"}位置。`
    );
  }
  const current = sorted[index]!;
  const neighbor = sorted[swapIndex]!;
  sorted[index] = neighbor;
  sorted[swapIndex] = current;
  return sorted.map((item, position) => ({ ...item, order: position + 1 }));
}

function reorderOrderedItem<T extends { id: string; order: number }>(
  items: T[],
  id: string,
  anchorId: string,
  position: "before" | "after",
  label: string
): T[] {
  const sorted = [...items].sort((a, b) => a.order - b.order);
  if (!sorted.some((item) => item.id === id)) {
    throw new MysteryWorkspaceOperationError(
      "not_found",
      `${label}不存在：${id}`
    );
  }
  if (!sorted.some((item) => item.id === anchorId)) {
    throw new MysteryWorkspaceOperationError(
      "not_found",
      `目标${label}不存在：${anchorId}`
    );
  }
  if (id === anchorId) {
    throw new MysteryWorkspaceOperationError(
      "invalid_order",
      `不能相对自身调整${label}顺序。`
    );
  }
  const sourceIndex = sorted.findIndex((item) => item.id === id);
  const [moved] = sorted.splice(sourceIndex, 1);
  const anchorIndex = sorted.findIndex((item) => item.id === anchorId);
  sorted.splice(anchorIndex + (position === "after" ? 1 : 0), 0, moved!);
  return sorted.map((item, idx) => ({ ...item, order: idx + 1 }));
}

function normalizeOrders<T extends { order: number }>(items: T[]): T[] {
  return [...items]
    .sort((a, b) => a.order - b.order)
    .map((item, position) => ({ ...item, order: position + 1 }));
}

export function mysteryDocumentExistsInManifest(
  manifest: Pick<
    MysteryBookManifest,
    "truthDocuments" | "roles" | "acts" | "clueRounds"
  >,
  target: MysteryDocumentTarget
): boolean {
  switch (target.kind) {
    case "agents_md":
    case "character_relations":
    case "public_doc":
    case "dm_manual":
      return true;
    case "truth_doc":
      return manifest.truthDocuments.some((doc) => doc.id === target.docId);
    case "role":
      return manifest.roles.some((role) => role.id === target.roleId);
    case "player_act":
      return (
        manifest.roles.some((role) => role.id === target.roleId) &&
        manifest.acts.some((act) => act.id === target.actId)
      );
    case "clue_round":
      return manifest.clueRounds.some((round) => round.id === target.roundId);
  }
}

export function mysteryDocumentTitle(
  manifest: Pick<
    MysteryBookManifest,
    "truthDocuments" | "roles" | "acts" | "clueRounds"
  >,
  target: MysteryDocumentTarget
): string {
  switch (target.kind) {
    case "agents_md":
      return "剧本杀上下文";
    case "truth_doc":
      return (
        manifest.truthDocuments.find((doc) => doc.id === target.docId)?.title ??
        target.docId
      );
    case "character_relations":
      return "NPC 与人物关系网";
    case "role": {
      const name =
        manifest.roles.find((role) => role.id === target.roleId)?.name ??
        target.roleId;
      return `${name} · ${target.document === "profile" ? "上帝底牌" : "公开选角页"}`;
    }
    case "player_act": {
      const roleName =
        manifest.roles.find((role) => role.id === target.roleId)?.name ??
        target.roleId;
      const actTitle =
        manifest.acts.find((act) => act.id === target.actId)?.title ??
        target.actId;
      return `${roleName} · ${actTitle} · ${target.document === "brief" ? "视角任务卡" : "人物本正文"}`;
    }
    case "clue_round":
      return (
        manifest.clueRounds.find((round) => round.id === target.roundId)
          ?.title ?? target.roundId
      );
    case "public_doc":
      return target.docId === "public_openings"
        ? "公共序幕与地图"
        : "多分支结局";
    case "dm_manual":
      return "DM 主持手册";
  }
}

export interface MysteryPreviewContext {
  manifest: MysteryBookManifest;
  workspaceIndex: MysteryWorkspaceIndexSnapshot;
  structureChanges: string[];
}

export function previewMysteryWorkspaceOperations(
  manifest: MysteryBookManifest,
  workspaceIndex: MysteryWorkspaceIndexSnapshot,
  rawBatch: MysteryOperationBatch
): MysteryPreviewContext {
  const batch = MysteryOperationBatchSchema.parse(rawBatch);
  const nextManifest: MysteryBookManifest = structuredClone(manifest);
  const nextIndex: MysteryWorkspaceIndexSnapshot =
    structuredClone(workspaceIndex);
  const structureChanges: string[] = [];
  const emptyRev = mysteryTextRevision("");

  for (const op of batch.operations) {
    switch (op.type) {
      case "boardSpec.update": {
        const patch = Object.fromEntries(
          Object.entries(op.boardSpec).filter(
            ([, value]) => value !== undefined
          )
        );
        nextManifest.boardSpec = MysteryBoardSpecSchema.parse({
          ...nextManifest.boardSpec,
          ...patch
        });
        structureChanges.push("更新盘面规格");
        break;
      }
      case "truthDoc.create": {
        if (nextManifest.truthDocuments.length >= MYSTERY_MAX_TRUTH_DOCS) {
          throw new MysteryWorkspaceOperationError(
            "invalid_target",
            `真相文档数量不能超过 ${MYSTERY_MAX_TRUTH_DOCS} 篇。`
          );
        }
        if (nextManifest.truthDocuments.some((item) => item.id === op.doc.id)) {
          throw new MysteryWorkspaceOperationError(
            "already_exists",
            `真相文档 id 已存在：${op.doc.id}`
          );
        }
        const order =
          Math.max(0, ...nextManifest.truthDocuments.map((d) => d.order)) + 1;
        const entry = {
          id: op.doc.id,
          title: op.doc.title,
          order,
          builtin: false
        };
        nextManifest.truthDocuments.push(entry);
        const content = op.doc.content ?? "";
        nextIndex.truthDocuments.push({
          ...entry,
          charCount: mysteryCharCount(content),
          revision: mysteryTextRevision(content)
        });
        structureChanges.push(`新建真相设定文档《${op.doc.title}》`);
        break;
      }
      case "truthDoc.updateMeta": {
        const idx = nextManifest.truthDocuments.findIndex(
          (item) => item.id === op.docId
        );
        if (idx < 0) {
          throw new MysteryWorkspaceOperationError(
            "not_found",
            `真相文档不存在：${op.docId}`
          );
        }
        if (op.title !== undefined) {
          if (nextManifest.truthDocuments[idx]!.builtin) {
            throw new MysteryWorkspaceOperationError(
              "builtin_protected",
              "内置真相文档不能重命名。"
            );
          }
          nextManifest.truthDocuments[idx]!.title = op.title;
        }
        if (op.move && op.reorder) {
          throw new MysteryWorkspaceOperationError(
            "invalid_order",
            "不能同时指定方向移动与锚点排序。"
          );
        }
        if (op.move) {
          nextManifest.truthDocuments = moveOrderedItem(
            nextManifest.truthDocuments,
            op.docId,
            op.move,
            "真相文档"
          );
        }
        if (op.reorder) {
          const anchor = nextManifest.truthDocuments.find(
            (item) => item.id === op.reorder!.anchorId
          );
          if (nextManifest.truthDocuments[idx]!.builtin || anchor?.builtin) {
            throw new MysteryWorkspaceOperationError(
              "builtin_protected",
              "内置真相文档顺序固定，不可拖动排序。"
            );
          }
          nextManifest.truthDocuments = reorderOrderedItem(
            nextManifest.truthDocuments,
            op.docId,
            op.reorder.anchorId,
            op.reorder.position,
            "真相文档"
          );
        }
        const statsById = new Map(
          nextIndex.truthDocuments.map((item) => [item.id, item])
        );
        nextIndex.truthDocuments = nextManifest.truthDocuments.map((doc) => ({
          ...doc,
          charCount: statsById.get(doc.id)?.charCount ?? 0,
          revision: statsById.get(doc.id)?.revision ?? emptyRev
        }));
        structureChanges.push(
          `调整真相文档 ${nextManifest.truthDocuments.find((d) => d.id === op.docId)?.title ?? op.docId}`
        );
        break;
      }
      case "truthDoc.delete": {
        const doc = nextManifest.truthDocuments.find(
          (item) => item.id === op.docId
        );
        if (!doc) {
          throw new MysteryWorkspaceOperationError(
            "not_found",
            `真相文档不存在：${op.docId}`
          );
        }
        if (doc.builtin) {
          throw new MysteryWorkspaceOperationError(
            "builtin_protected",
            `内置真相文档「${doc.title}」不可删除。`
          );
        }
        nextManifest.truthDocuments = normalizeOrders(
          nextManifest.truthDocuments.filter((item) => item.id !== op.docId)
        );
        const statsById = new Map(
          nextIndex.truthDocuments.map((item) => [item.id, item])
        );
        nextIndex.truthDocuments = nextManifest.truthDocuments.map((d) => ({
          ...d,
          charCount: statsById.get(d.id)?.charCount ?? 0,
          revision: statsById.get(d.id)?.revision ?? emptyRev
        }));
        structureChanges.push(`删除真相文档《${doc.title}》`);
        break;
      }
      case "role.create": {
        if (nextManifest.roles.length >= MYSTERY_MAX_ROLES) {
          throw new MysteryWorkspaceOperationError(
            "invalid_target",
            `角色数量不能超过 ${MYSTERY_MAX_ROLES} 个。`
          );
        }
        if (nextManifest.roles.some((item) => item.id === op.role.id)) {
          throw new MysteryWorkspaceOperationError(
            "already_exists",
            `角色 id 已存在：${op.role.id}`
          );
        }
        const order =
          Math.max(0, ...nextManifest.roles.map((role) => role.order)) + 1;
        const roleEntry = {
          id: op.role.id,
          name: op.role.name,
          tag: op.role.tag ?? "",
          order
        };
        nextManifest.roles.push(roleEntry);
        const profileText = op.role.profileContent ?? "";
        const pitchText = op.role.pitchContent ?? "";
        nextIndex.roles.push({
          ...roleEntry,
          profileChars: mysteryCharCount(profileText),
          pitchChars: mysteryCharCount(pitchText),
          profileRevision: mysteryTextRevision(profileText),
          pitchRevision: mysteryTextRevision(pitchText)
        });
        for (const act of nextManifest.acts) {
          nextIndex.actMatrix.push({
            roleId: roleEntry.id,
            actId: act.id,
            briefChars: 0,
            bodyChars: 0,
            briefRevision: emptyRev,
            bodyRevision: emptyRev
          });
        }
        structureChanges.push(`新建角色「${op.role.name}」`);
        break;
      }
      case "role.updateMeta": {
        const idx = nextManifest.roles.findIndex(
          (item) => item.id === op.roleId
        );
        if (idx < 0) {
          throw new MysteryWorkspaceOperationError(
            "not_found",
            `角色不存在：${op.roleId}`
          );
        }
        if (op.name !== undefined) nextManifest.roles[idx]!.name = op.name;
        if (op.tag !== undefined) nextManifest.roles[idx]!.tag = op.tag;
        if (op.move && op.reorder) {
          throw new MysteryWorkspaceOperationError(
            "invalid_order",
            "不能同时指定方向移动与锚点排序。"
          );
        }
        if (op.move) {
          nextManifest.roles = moveOrderedItem(
            nextManifest.roles,
            op.roleId,
            op.move,
            "角色"
          );
        }
        if (op.reorder) {
          nextManifest.roles = reorderOrderedItem(
            nextManifest.roles,
            op.roleId,
            op.reorder.anchorId,
            op.reorder.position,
            "角色"
          );
        }
        const roleStatsById = new Map(
          nextIndex.roles.map((item) => [item.id, item])
        );
        nextIndex.roles = nextManifest.roles.map((role) => {
          const prev = roleStatsById.get(role.id);
          return {
            ...role,
            profileChars: prev?.profileChars ?? 0,
            pitchChars: prev?.pitchChars ?? 0,
            profileRevision: prev?.profileRevision ?? emptyRev,
            pitchRevision: prev?.pitchRevision ?? emptyRev
          };
        });
        structureChanges.push(
          `更新角色「${nextManifest.roles.find((r) => r.id === op.roleId)?.name ?? op.roleId}」`
        );
        break;
      }
      case "role.delete": {
        if (nextManifest.roles.length <= 1) {
          throw new MysteryWorkspaceOperationError(
            "minimum_required",
            "至少需要保留 1 名角色。"
          );
        }
        const role = nextManifest.roles.find((item) => item.id === op.roleId);
        if (!role) {
          throw new MysteryWorkspaceOperationError(
            "not_found",
            `角色不存在：${op.roleId}`
          );
        }
        nextManifest.roles = normalizeOrders(
          nextManifest.roles.filter((item) => item.id !== op.roleId)
        );
        const roleStatsById = new Map(
          nextIndex.roles.map((item) => [item.id, item])
        );
        nextIndex.roles = nextManifest.roles.map((r) => ({
          ...r,
          profileChars: roleStatsById.get(r.id)?.profileChars ?? 0,
          pitchChars: roleStatsById.get(r.id)?.pitchChars ?? 0,
          profileRevision: roleStatsById.get(r.id)?.profileRevision ?? emptyRev,
          pitchRevision: roleStatsById.get(r.id)?.pitchRevision ?? emptyRev
        }));
        nextIndex.actMatrix = nextIndex.actMatrix.filter(
          (cell) => cell.roleId !== op.roleId
        );
        structureChanges.push(`删除角色「${role.name}」`);
        break;
      }
      case "act.create": {
        if (nextManifest.acts.length >= MYSTERY_MAX_ACTS) {
          throw new MysteryWorkspaceOperationError(
            "invalid_target",
            `幕次数量不能超过 ${MYSTERY_MAX_ACTS} 幕。`
          );
        }
        if (nextManifest.acts.some((item) => item.id === op.act.id)) {
          throw new MysteryWorkspaceOperationError(
            "already_exists",
            `幕次 id 已存在：${op.act.id}`
          );
        }
        const order =
          Math.max(0, ...nextManifest.acts.map((act) => act.order)) + 1;
        const actEntry = { id: op.act.id, title: op.act.title, order };
        nextManifest.acts.push(actEntry);
        nextIndex.acts = [...nextManifest.acts];
        for (const role of nextManifest.roles) {
          nextIndex.actMatrix.push({
            roleId: role.id,
            actId: actEntry.id,
            briefChars: 0,
            bodyChars: 0,
            briefRevision: emptyRev,
            bodyRevision: emptyRev
          });
        }
        structureChanges.push(`新建幕次「${op.act.title}」`);
        break;
      }
      case "act.updateMeta": {
        const idx = nextManifest.acts.findIndex((item) => item.id === op.actId);
        if (idx < 0) {
          throw new MysteryWorkspaceOperationError(
            "not_found",
            `幕次不存在：${op.actId}`
          );
        }
        if (op.title !== undefined) nextManifest.acts[idx]!.title = op.title;
        if (op.move && op.reorder) {
          throw new MysteryWorkspaceOperationError(
            "invalid_order",
            "不能同时指定方向移动与锚点排序。"
          );
        }
        if (op.move) {
          nextManifest.acts = moveOrderedItem(
            nextManifest.acts,
            op.actId,
            op.move,
            "幕次"
          );
        }
        if (op.reorder) {
          nextManifest.acts = reorderOrderedItem(
            nextManifest.acts,
            op.actId,
            op.reorder.anchorId,
            op.reorder.position,
            "幕次"
          );
        }
        nextIndex.acts = [...nextManifest.acts];
        structureChanges.push(
          `更新幕次「${nextManifest.acts.find((a) => a.id === op.actId)?.title ?? op.actId}」`
        );
        break;
      }
      case "act.delete": {
        if (nextManifest.acts.length <= 1) {
          throw new MysteryWorkspaceOperationError(
            "minimum_required",
            "至少需要保留 1 个幕次。"
          );
        }
        const act = nextManifest.acts.find((item) => item.id === op.actId);
        if (!act) {
          throw new MysteryWorkspaceOperationError(
            "not_found",
            `幕次不存在：${op.actId}`
          );
        }
        nextManifest.acts = normalizeOrders(
          nextManifest.acts.filter((item) => item.id !== op.actId)
        );
        nextIndex.acts = [...nextManifest.acts];
        nextIndex.actMatrix = nextIndex.actMatrix.filter(
          (cell) => cell.actId !== op.actId
        );
        structureChanges.push(`删除幕次「${act.title}」`);
        break;
      }
      case "clueRound.create": {
        if (nextManifest.clueRounds.length >= MYSTERY_MAX_CLUE_ROUNDS) {
          throw new MysteryWorkspaceOperationError(
            "invalid_target",
            `搜证轮次不能超过 ${MYSTERY_MAX_CLUE_ROUNDS} 轮。`
          );
        }
        if (nextManifest.clueRounds.some((item) => item.id === op.round.id)) {
          throw new MysteryWorkspaceOperationError(
            "already_exists",
            `搜证轮次 id 已存在：${op.round.id}`
          );
        }
        const order =
          Math.max(0, ...nextManifest.clueRounds.map((r) => r.order)) + 1;
        const roundEntry = {
          id: op.round.id,
          title: op.round.title,
          order
        };
        nextManifest.clueRounds.push(roundEntry);
        const content = op.round.content ?? "";
        nextIndex.clueRounds.push({
          ...roundEntry,
          charCount: mysteryCharCount(content),
          revision: mysteryTextRevision(content)
        });
        structureChanges.push(`新建搜证轮次「${op.round.title}」`);
        break;
      }
      case "clueRound.updateMeta": {
        const idx = nextManifest.clueRounds.findIndex(
          (item) => item.id === op.roundId
        );
        if (idx < 0) {
          throw new MysteryWorkspaceOperationError(
            "not_found",
            `搜证轮次不存在：${op.roundId}`
          );
        }
        if (op.title !== undefined) {
          nextManifest.clueRounds[idx]!.title = op.title;
        }
        if (op.move && op.reorder) {
          throw new MysteryWorkspaceOperationError(
            "invalid_order",
            "不能同时指定方向移动与锚点排序。"
          );
        }
        if (op.move) {
          nextManifest.clueRounds = moveOrderedItem(
            nextManifest.clueRounds,
            op.roundId,
            op.move,
            "搜证轮次"
          );
        }
        if (op.reorder) {
          nextManifest.clueRounds = reorderOrderedItem(
            nextManifest.clueRounds,
            op.roundId,
            op.reorder.anchorId,
            op.reorder.position,
            "搜证轮次"
          );
        }
        const roundStatsById = new Map(
          nextIndex.clueRounds.map((item) => [item.id, item])
        );
        nextIndex.clueRounds = nextManifest.clueRounds.map((round) => ({
          ...round,
          charCount: roundStatsById.get(round.id)?.charCount ?? 0,
          revision: roundStatsById.get(round.id)?.revision ?? emptyRev
        }));
        structureChanges.push(
          `更新搜证轮次「${nextManifest.clueRounds.find((r) => r.id === op.roundId)?.title ?? op.roundId}」`
        );
        break;
      }
      case "clueRound.delete": {
        const round = nextManifest.clueRounds.find(
          (item) => item.id === op.roundId
        );
        if (!round) {
          throw new MysteryWorkspaceOperationError(
            "not_found",
            `搜证轮次不存在：${op.roundId}`
          );
        }
        nextManifest.clueRounds = normalizeOrders(
          nextManifest.clueRounds.filter((item) => item.id !== op.roundId)
        );
        const roundStatsById = new Map(
          nextIndex.clueRounds.map((item) => [item.id, item])
        );
        nextIndex.clueRounds = nextManifest.clueRounds.map((r) => ({
          ...r,
          charCount: roundStatsById.get(r.id)?.charCount ?? 0,
          revision: roundStatsById.get(r.id)?.revision ?? emptyRev
        }));
        structureChanges.push(`删除搜证轮次「${round.title}」`);
        break;
      }
    }
  }

  for (const write of batch.documentWrites) {
    if (!mysteryDocumentExistsInManifest(nextManifest, write.target)) {
      throw new MysteryWorkspaceOperationError(
        "invalid_target",
        `写入目标不存在：${mysteryDocumentTargetKey(write.target)}`
      );
    }
    const chars = mysteryCharCount(write.content);
    const rev = mysteryTextRevision(write.content);
    const currentRev = findTargetRevision(nextIndex, write.target);
    if (
      write.expectedRevision !== undefined &&
      currentRev !== undefined &&
      currentRev !== write.expectedRevision
    ) {
      throw new MysteryWorkspaceOperationError(
        "document_changed",
        `文档在读取后已被修改：${mysteryDocumentTargetKey(write.target)}`
      );
    }
    applyWriteToIndex(nextIndex, write.target, chars, rev);
  }

  nextIndex.boardSpec = nextManifest.boardSpec;
  nextIndex.title = nextManifest.title;
  nextIndex.genre = nextManifest.genre;
  nextIndex.status = nextManifest.status;

  return {
    manifest: MysteryBookManifestSchema.parse(nextManifest),
    workspaceIndex: MysteryWorkspaceIndexSnapshotSchema.parse(nextIndex),
    structureChanges
  };
}

export function findTargetRevision(
  index: MysteryWorkspaceIndexSnapshot,
  target: MysteryDocumentTarget
): string | undefined {
  switch (target.kind) {
    case "agents_md":
      return index.agentsMdRevision;
    case "truth_doc":
      return index.truthDocuments.find((doc) => doc.id === target.docId)
        ?.revision;
    case "character_relations":
      return index.characterRelations.revision;
    case "role": {
      const role = index.roles.find((item) => item.id === target.roleId);
      return target.document === "profile"
        ? role?.profileRevision
        : role?.pitchRevision;
    }
    case "player_act": {
      const cell = index.actMatrix.find(
        (item) => item.roleId === target.roleId && item.actId === target.actId
      );
      return target.document === "brief"
        ? cell?.briefRevision
        : cell?.bodyRevision;
    }
    case "clue_round":
      return index.clueRounds.find((round) => round.id === target.roundId)
        ?.revision;
    case "public_doc":
      return target.docId === "public_openings"
        ? index.publicOpenings.revision
        : index.endings.revision;
    case "dm_manual":
      return index.dmManual.revision;
  }
}

function applyWriteToIndex(
  index: MysteryWorkspaceIndexSnapshot,
  target: MysteryDocumentTarget,
  charCount: number,
  revision: string
): void {
  switch (target.kind) {
    case "agents_md":
      index.agentsMdChars = charCount;
      index.agentsMdRevision = revision;
      return;
    case "truth_doc": {
      const doc = index.truthDocuments.find((item) => item.id === target.docId);
      if (doc) {
        doc.charCount = charCount;
        doc.revision = revision;
      }
      return;
    }
    case "character_relations":
      index.characterRelations.charCount = charCount;
      index.characterRelations.revision = revision;
      return;
    case "role": {
      const role = index.roles.find((item) => item.id === target.roleId);
      if (role) {
        if (target.document === "profile") {
          role.profileChars = charCount;
          role.profileRevision = revision;
        } else {
          role.pitchChars = charCount;
          role.pitchRevision = revision;
        }
      }
      return;
    }
    case "player_act": {
      const cell = index.actMatrix.find(
        (item) => item.roleId === target.roleId && item.actId === target.actId
      );
      if (cell) {
        if (target.document === "brief") {
          cell.briefChars = charCount;
          cell.briefRevision = revision;
        } else {
          cell.bodyChars = charCount;
          cell.bodyRevision = revision;
        }
      }
      return;
    }
    case "clue_round": {
      const round = index.clueRounds.find((item) => item.id === target.roundId);
      if (round) {
        round.charCount = charCount;
        round.revision = revision;
      }
      return;
    }
    case "public_doc":
      if (target.docId === "public_openings") {
        index.publicOpenings.charCount = charCount;
        index.publicOpenings.revision = revision;
      } else {
        index.endings.charCount = charCount;
        index.endings.revision = revision;
      }
      return;
    case "dm_manual":
      index.dmManual.charCount = charCount;
      index.dmManual.revision = revision;
  }
}

export { isMysteryPlayerVisibleTarget };
