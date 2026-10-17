import { secureStorage as safeStorage } from "./secure-storage";
import {
  ModelConfigInputSchema,
  SYNC_MODEL_KEY_MAX_LENGTH,
  syncEqual,
  toSyncModelConfig,
  type SyncedModelChange,
  type SyncModelConfig,
  type SyncModelEntry
} from "@deepwrite/contracts";
import { toDiskModel, type DiskModelConfig } from "./free-model-settings-state";
import type {
  DiskModelSecrets,
  ModelConfigState
} from "./model-config-persistence";
import { decryptModelKey } from "./model-config-runtime";
import type { ModelConfigSnapshot } from "./model-config-state";

const MAX_CUSTOM_MODELS = 100;

/** The synced view of a custom model; anything that cannot sync yields null. */
export function toSyncedModel(
  model: DiskModelConfig | undefined
): SyncModelConfig | null {
  if (!model || model.managedBy) return null;
  try {
    return toSyncModelConfig(model);
  } catch {
    return null;
  }
}

/** A model and its decrypted key; an unreadable key fails the read so it is never mistaken for a removed one. A key too long to sync keeps its model local. */
function toSyncedEntry(
  model: DiskModelConfig | undefined,
  secrets: DiskModelSecrets
): SyncModelEntry | null {
  const synced = toSyncedModel(model);
  if (!synced) return null;
  const apiKey = decryptModelKey(secrets.encryptedApiKeys[synced.id]);
  if (apiKey && apiKey.length > SYNC_MODEL_KEY_MAX_LENGTH) return null;
  return { model: synced, ...(apiKey ? { apiKey } : {}) };
}

export function customSyncEntries(
  models: DiskModelConfig[],
  secrets: DiskModelSecrets
): SyncModelEntry[] {
  return models.flatMap((model) => toSyncedEntry(model, secrets) ?? []);
}

/**
 * Applies synced model changes inside the store's write chain. A model's API
 * key mirrors the synced item: present sets the local key, absent removes it.
 */
export function applySyncedModelChanges(
  { settings, secrets }: ModelConfigSnapshot,
  changes: SyncedModelChange[]
): ModelConfigState {
  const models = [...settings.models];
  const encryptedApiKeys = { ...secrets.encryptedApiKeys };
  for (const change of changes) {
    const index = models.findIndex((model) => model.id === change.id);
    const current = models[index];
    if (current?.managedBy) throw new Error("这个模型由 DeepWrite 托管。");
    if (
      change.expected !== undefined &&
      !syncEqual(toSyncedEntry(current, secrets), change.expected)
    )
      throw new Error("模型配置已在本机修改，请重新同步。");
    if (!change.next) {
      if (index >= 0) models.splice(index, 1);
      delete encryptedApiKeys[change.id];
      continue;
    }
    const next = toDiskModel(ModelConfigInputSchema.parse(change.next.model));
    if (change.next.apiKey) {
      encryptedApiKeys[change.id] = safeStorage
        .encryptString(change.next.apiKey)
        .toString("base64");
    } else delete encryptedApiKeys[change.id];
    if (index >= 0) models[index] = next;
    else models.push(next);
  }
  if (models.filter((model) => !model.managedBy).length > MAX_CUSTOM_MODELS)
    throw new Error("自定义模型数量已达上限，请先删除不用的模型。");
  return {
    settings: { ...settings, models },
    secrets: { version: 1, encryptedApiKeys }
  };
}
