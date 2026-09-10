import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import {
  syncItemSchema,
  syncRequestSchema,
  syncResponseSchema,
  syncKindSchema
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
        .object({ key: z.string(), title: z.string(), message: z.string() })
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
export const DeviceSyncCatalogRegistrySchema = z
  .object({
    schemaVersion: z.literal(1),
    projects: z.array(
      z
        .object({
          id: z.string(),
          domain: syncKindSchema.exclude(["long-book"]),
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
