import { z } from "zod";
import {
  syncIdSchema,
  syncHashSchema,
  syncPathSchema,
  syncKindSchema,
  syncConfigSchema
} from "./connection-schemas";
export {
  syncIdSchema,
  syncHashSchema,
  syncPathSchema,
  syncKindSchema,
  syncConfigSchema,
  syncJoinCodeSchema
} from "./connection-schemas";

export const syncItemSchema = z
  .object({
    kind: syncKindSchema,
    id: z.string().min(1).max(512),
    title: z.string().min(1).max(512),
    files: z.record(syncPathSchema, z.string())
  })
  .strict();
export const syncClockSchema = z.record(
  syncIdSchema,
  z.number().int().nonnegative()
);
export const syncFileRefSchema = z
  .object({ hash: syncHashSchema, pack: syncHashSchema })
  .strict();
export const syncRevisionSchema = z
  .object({
    kind: syncKindSchema,
    id: z.string().min(1).max(512),
    title: z.string().min(1).max(512),
    clock: syncClockSchema,
    files: z.record(syncPathSchema, syncFileRefSchema).nullable()
  })
  .strict();
export const syncCommitSchema = z
  .object({
    schemaVersion: z.literal(1),
    spaceId: syncIdSchema,
    deviceId: syncIdSchema,
    deviceName: z.string().min(1).max(80),
    sequence: z.number().int().positive(),
    createdAt: z.string().datetime(),
    items: z.record(z.string().max(1024), syncRevisionSchema),
    receipts: z.record(syncIdSchema, syncHashSchema)
  })
  .strict();
export const syncSpaceSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: syncIdSchema,
    name: z.string().min(1).max(80),
    createdAt: z.string().datetime(),
    itemCount: z.number().int().nonnegative().default(0),
    lastUpdatedAt: z.string().datetime().nullable().default(null)
  })
  .strict();
export const syncPackSchema = z
  .object({
    schemaVersion: z.literal(1),
    files: z.record(syncHashSchema, z.string())
  })
  .strict();
export const syncHeadSchema = z
  .object({
    schemaVersion: z.literal(1),
    hash: syncHashSchema,
    sequence: z.number().int().positive()
  })
  .strict();
export const syncBaselineSchema = z
  .object({
    revision: syncRevisionSchema,
    item: syncItemSchema.nullable()
  })
  .strict();
export const syncHistorySchema = z
  .object({
    id: syncIdSchema,
    key: z.string(),
    title: z.string(),
    at: z.string().datetime(),
    description: z.string(),
    item: syncItemSchema.nullable()
  })
  .strict();
export const syncIssueSchema = z
  .object({
    key: z.string(),
    title: z.string(),
    token: z.string(),
    reason: z.enum([
      "conflict",
      "delete",
      "unsupported",
      "busy",
      "failed",
      "first-sync"
    ]),
    message: z.string(),
    paths: z.array(z.string()),
    local: syncItemSchema.nullable(),
    base: syncItemSchema.nullable().optional(),
    versions: z.array(
      z
        .object({
          deviceName: z.string(),
          item: syncItemSchema.nullable(),
          clock: syncClockSchema
        })
        .strict()
    )
  })
  .strict();
export const syncMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    deviceId: syncIdSchema,
    config: syncConfigSchema.nullable(),
    baselines: z.record(z.string(), syncBaselineSchema),
    ancestors: z.record(z.string(), z.array(syncBaselineSchema)).default({}),
    published: syncCommitSchema.nullable(),
    history: z.array(syncHistorySchema),
    lastSuccessAt: z.string().datetime().nullable(),
    firstSyncConfirmed: z.boolean(),
    lastCheckedAt: z.string().datetime().nullable().default(null),
    devices: z
      .array(
        z.object({ hash: syncHashSchema, commit: syncCommitSchema }).strict()
      )
      .default([]),
    pendingIssues: z.array(syncIssueSchema).default([])
  })
  .strict();

export type SyncConfig = z.infer<typeof syncConfigSchema>;
export type SyncKind = z.infer<typeof syncKindSchema>;
export type SyncItem = z.infer<typeof syncItemSchema>;
export type SyncClock = z.infer<typeof syncClockSchema>;
export type SyncRevision = z.infer<typeof syncRevisionSchema>;
export type SyncCommit = z.infer<typeof syncCommitSchema>;
export type SyncSpace = z.infer<typeof syncSpaceSchema>;
export type SyncMetadata = z.infer<typeof syncMetadataSchema>;
export type SyncHistory = z.infer<typeof syncHistorySchema>;
