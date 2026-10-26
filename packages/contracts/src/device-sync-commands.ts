import { syncDisplayTextSchema } from "./device-sync/display-text";
import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import {
  syncItemSchema,
  syncRequestSchema,
  syncResponseSchema,
  syncKindSchema,
  syncIdSchema,
  syncHashSchema,
  syncPathSchema,
  syncMetadataSchema
} from "./device-sync";

export const DEVICE_SYNC_IPC_CHANNEL = "deepwrite:device-sync";
export const DeviceSyncRequestEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("deviceSync.request"),
  payload: syncRequestSchema
});
export const DeviceSyncWorkspaceCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("deviceSync.workspace"),
    payload: z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("list") }).strict(),
      z.object({ operation: z.literal("recover") }).strict(),
      z.object({ operation: z.literal("inspect-initialization") }).strict(),
      z
        .object({
          operation: z.literal("replace-initialization"),
          token: syncIdSchema,
          items: z.array(syncItemSchema).min(1),
          expectedFingerprint: syncHashSchema,
          workspaceDirectory: z.string()
        })
        .strict(),
      z
        .object({ operation: z.literal("validate"), item: syncItemSchema })
        .strict(),
      z
        .object({
          operation: z.literal("apply"),
          key: z.string(),
          expected: syncItemSchema.nullable(),
          next: syncItemSchema.nullable(),
          workspaceDirectory: z.string()
        })
        .strict()
    ])
  });
export type DeviceSyncWorkspaceRequest = z.infer<
  typeof DeviceSyncWorkspaceCommandEnvelopeSchema
>["payload"];
export const DeviceSyncInventorySchema = z
  .object({
    items: z.array(syncItemSchema),
    issues: z.array(
      z
        .object({
          key: z.string(),
          title: z.string(),
          message: z.string(),
          messageText: syncDisplayTextSchema.optional()
        })
        .strict()
    )
  })
  .strict();

export const DeviceSyncSecretSchema = z
  .object({ schemaVersion: z.literal(1), encrypted: z.string() })
  .strict();
export const DeviceSyncIntentSchema = z
  .object({
    schemaVersion: z.literal(1),
    key: z.string(),
    root: z.string(),
    item: syncItemSchema.nullable(),
    previous: syncItemSchema.nullable(),
    removal: z.string().nullable()
  })
  .strict();
export type DeviceSyncIntent = z.infer<typeof DeviceSyncIntentSchema>;
export const DeviceSyncValidationFailureDetailsSchema = z
  .object({ paths: z.array(syncPathSchema) })
  .strict();
export const DeviceSyncCatalogRegistrySchema = z
  .object({
    schemaVersion: z.literal(1),
    projects: z.array(
      z
        .object({
          id: z.string(),
          domain: syncKindSchema.exclude(["long-book", "model-config"]),
          projectDirectory: z.string()
        })
        .passthrough()
    )
  })
  .passthrough();
export const DeviceSyncLongRegistrySchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    projects: z.array(
      z
        .object({
          bookId: z.string(),
          projectDirectory: z.string(),
          deletion: z.unknown().optional()
        })
        .passthrough()
    )
  })
  .passthrough();
export const DeviceSyncTitleSchema = z
  .object({ title: z.string() })
  .passthrough();

export const DeviceSyncIpcResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: syncResponseSchema }).strict(),
  z.object({ ok: z.literal(false), message: z.string() }).strict()
]);

export const DeviceSyncInitializationReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    token: syncIdSchema,
    recoveryDirectory: z.string()
  })
  .strict();
export const DeviceSyncInitializationInspectionSchema = z
  .object({
    fingerprint: syncHashSchema,
    itemCount: z.number().int().nonnegative(),
    lastToken: syncIdSchema.nullable()
  })
  .strict();
export const DeviceSyncInitializationMetadataIntentSchema = z
  .object({
    schemaVersion: z.literal(1),
    token: syncIdSchema,
    metadata: syncMetadataSchema
  })
  .strict();
