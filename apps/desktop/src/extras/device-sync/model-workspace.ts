import {
  parseSyncModelEntry,
  syncKey,
  syncModelConfigItem,
  type SyncItem,
  type SyncedModelChange,
  type SyncModelEntry,
  type SyncWorkspacePort
} from "@deepwrite/contracts";

/** Main-owned custom models; keys are read from and written to the local secret store. */
export interface ModelSyncPort {
  listSyncModels(): Promise<SyncModelEntry[]>;
  applySyncedModels(changes: SyncedModelChange[]): Promise<void>;
}

const MODEL_KEY_PREFIX = "model-config:";

function isModelItem(item: SyncItem): boolean {
  return item.kind === "model-config";
}

/** Adds custom model configs to a workspace port that only knows project folders. */
export function withModelConfigSync(
  projects: SyncWorkspacePort,
  models: ModelSyncPort
): SyncWorkspacePort {
  return {
    ...(projects.initialization
      ? {
          initialization: {
            inspect: () => projects.initialization!.inspect(),
            // Models first: a failed project replace then leaves models equal to the remote.
            replace: async (items, metadata, fingerprint, signal) => {
              await models.applySyncedModels(
                items.filter(isModelItem).map((item) => ({
                  id: item.id,
                  next: parseSyncModelEntry(item)
                }))
              );
              await projects.initialization!.replace(
                items.filter((item) => !isModelItem(item)),
                metadata,
                fingerprint,
                signal
              );
            }
          }
        }
      : {}),
    async list() {
      const inventory = await projects.list();
      return {
        items: [
          ...inventory.items,
          ...(await models.listSyncModels()).map(({ model, apiKey }) =>
            syncModelConfigItem(model, apiKey)
          )
        ],
        issues: inventory.issues
      };
    },
    validate: async (item) => {
      if (isModelItem(item)) parseSyncModelEntry(item);
      else await projects.validate(item);
    },
    ...(projects.supportsItem
      ? {
          supportsItem: (item) =>
            isModelItem(item) || projects.supportsItem!(item)
        }
      : {}),
    recover: () => projects.recover(),
    apply: async (key, expected, next) => {
      if (!key.startsWith(MODEL_KEY_PREFIX))
        return projects.apply(key, expected, next);
      const item = next ?? expected;
      if (
        !item ||
        [expected, next].some((entry) => entry && syncKey(entry) !== key)
      )
        throw new Error("同步目标不一致。");
      await models.applySyncedModels([
        {
          id: item.id,
          expected: expected ? parseSyncModelEntry(expected) : null,
          next: next ? parseSyncModelEntry(next) : null
        }
      ]);
    }
  };
}
