import { z } from "zod";
import {
  ModelApiSchema,
  ModelConfigInputSchema,
  ModelContextWindowSchema,
  ModelKindSchema,
  ModelMaxTokensSchema,
  TemperatureOptionsSchema,
  ThinkingLevelOptionsSchema,
  ThinkingLevelSchema,
  ToolSchemaProfileSchema
} from "../model-configuration";
import type { SyncItem } from "./schemas";
import { stableSyncJson } from "./value";

/** Custom model ids only; managed `deepwrite-*` models never travel between devices. */
export const SYNC_MODEL_ID_PATTERN = /^(?!deepwrite-)[A-Za-z0-9_-]{1,120}$/;
export const SYNC_MODEL_FILE = "deepwrite.json";
/** Optional second file of a model item; the only place an API key travels. */
export const SYNC_MODEL_SECRET_FILE = "secret.json";
/** Longer keys are not exported: the model stays local rather than failing the whole sync. */
export const SYNC_MODEL_KEY_MAX_LENGTH = 1_024;

const syncModelObject = z.object({
  id: z.string().regex(SYNC_MODEL_ID_PATTERN),
  label: z.string().trim().min(1).max(120),
  provider: z.string().trim().min(1).max(120),
  modelId: z.string().trim().min(1).max(240),
  requestModelId: z.string().trim().min(1).max(240).optional(),
  supportsDeveloperRole: z.boolean().optional(),
  toolSchemaProfile: ToolSchemaProfileSchema.optional(),
  api: ModelApiSchema,
  baseUrl: z.union([z.literal(""), z.url().max(2_000)]),
  reasoning: z.boolean(),
  defaultThinkingLevel: ThinkingLevelSchema,
  thinkingLevelOptions: ThinkingLevelOptionsSchema,
  temperatureOptions: TemperatureOptionsSchema,
  contextWindow: ModelContextWindowSchema.optional(),
  maxTokens: ModelMaxTokensSchema.optional(),
  modelKind: ModelKindSchema.optional()
});

/** A model's public identity. It is strict so key material can never ride along. */
export const syncModelConfigSchema = syncModelObject
  .strict()
  .refine((model) => ModelConfigInputSchema.safeParse(model).success, {
    message: "Model settings are inconsistent."
  })
  .refine(
    (model) => {
      if (!model.baseUrl) return true;
      try {
        const url = new URL(model.baseUrl);
        return (
          (url.protocol === "https:" || url.protocol === "http:") &&
          !url.username &&
          !url.password
        );
      } catch {
        return false;
      }
    },
    {
      message: "Model endpoints must be HTTP(S) addresses without credentials."
    }
  );
export type SyncModelConfig = z.infer<typeof syncModelConfigSchema>;

const syncModelFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("deepwrite.model-config"),
    model: syncModelConfigSchema
  })
  .strict();

const syncModelSecretSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("deepwrite.model-secret"),
    apiKey: z.string().min(1).max(SYNC_MODEL_KEY_MAX_LENGTH)
  })
  .strict();

/** A model together with its API key, which lives in the item's secret file. */
export interface SyncModelEntry {
  model: SyncModelConfig;
  apiKey?: string;
}

export interface SyncedModelChange {
  id: string;
  /** Omit to skip the local-state check, as first-time initialization does. */
  expected?: SyncModelEntry | null;
  next: SyncModelEntry | null;
}

const SYNC_MODEL_FIELDS = Object.keys(syncModelObject.shape);

/** Keeps only synced fields; API keys, prices and managed-catalog flags are dropped. */
export function toSyncModelConfig(
  model: Readonly<Record<string, unknown>>
): SyncModelConfig {
  return syncModelConfigSchema.parse(
    Object.fromEntries(
      SYNC_MODEL_FIELDS.filter((field) => model[field] !== undefined).map(
        (field) => [field, model[field]]
      )
    )
  );
}

export function isSyncableModelId(id: string): boolean {
  return SYNC_MODEL_ID_PATTERN.test(id);
}

export function syncModelConfigItem(
  model: SyncModelConfig,
  apiKey?: string
): SyncItem {
  return {
    kind: "model-config",
    id: model.id,
    title: model.label,
    files: {
      [SYNC_MODEL_FILE]: stableSyncJson({
        schemaVersion: 1,
        kind: "deepwrite.model-config",
        model
      }),
      ...(apiKey
        ? {
            [SYNC_MODEL_SECRET_FILE]: stableSyncJson({
              schemaVersion: 1,
              kind: "deepwrite.model-secret",
              apiKey
            })
          }
        : {})
    }
  };
}

export function parseSyncModelEntry(item: SyncItem): SyncModelEntry {
  const content = item.files[SYNC_MODEL_FILE];
  const secret = item.files[SYNC_MODEL_SECRET_FILE];
  if (
    item.kind !== "model-config" ||
    content === undefined ||
    Object.keys(item.files).length !== (secret === undefined ? 1 : 2)
  )
    throw new Error("模型配置格式不受支持。");
  const file = syncModelFileSchema.parse(JSON.parse(content));
  if (file.model.id !== item.id) throw new Error("模型配置格式不受支持。");
  return {
    model: file.model,
    ...(secret === undefined
      ? {}
      : { apiKey: syncModelSecretSchema.parse(JSON.parse(secret)).apiKey })
  };
}
