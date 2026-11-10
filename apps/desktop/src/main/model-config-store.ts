import { join } from "node:path";
import { withConfigurationLock } from "./configuration-lock";
import {
  ModelConfigInputSchema,
  ModelSettingsInputSchema,
  type AgentProviderRuntimeConfig,
  type SyncedModelChange,
  type SyncModelEntry,
  type ModelConfigInput,
  type ModelSettings,
  type ModelSettingsInput,
  type WebSearchKeyImportModel
} from "@deepwrite/contracts";
import {
  DeepWriteFreeModelCatalogStore,
  type DeepWriteFreeModelCatalog
} from "./deepwrite-free-model-config";
import {
  ModelConfigPersistence,
  type ModelConfigState
} from "./model-config-persistence";
import {
  synchronizeState,
  toPublicSettings,
  withDeepWriteFreeApiKeys,
  type ModelConfigSnapshot
} from "./model-config-state";
import {
  editModelSettings,
  setFreeModelEnabled
} from "./model-config-mutations";
import {
  applySyncedModelChanges,
  customSyncEntries
} from "./model-config-sync";
import {
  decryptModelKey,
  resolveDraftModel,
  resolveSavedModel
} from "./model-config-runtime";

interface FreeModelCatalogReader {
  initialize(): Promise<void>;
  getCatalog(): Promise<DeepWriteFreeModelCatalog>;
  refreshCatalog?(): Promise<DeepWriteFreeModelCatalog>;
}

export interface ModelConfigStoreOptions {
  appVersion?: string;
  freeModelCatalog?: FreeModelCatalogReader;
}

interface CatalogRefreshOptions {
  refreshFree?: boolean;
}

/** A saved model's decrypted key; for Main-internal reuse, never for IPC. */
export interface ModelKeySource {
  id: string;
  label: string;
  apiKey: string;
}

function publicSettings(state: ModelConfigSnapshot): ModelSettings {
  return toPublicSettings(state.settings, state.secrets, state.freeCatalog);
}

export class ModelConfigStore {
  private readonly persistence: ModelConfigPersistence;
  private readonly settingsPath: string;
  private readonly freeModelCatalog: FreeModelCatalogReader;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string, options: ModelConfigStoreOptions = {}) {
    this.settingsPath = join(userDataPath, "config", "models.json");
    this.persistence = new ModelConfigPersistence(userDataPath);
    this.freeModelCatalog =
      options.freeModelCatalog ??
      new DeepWriteFreeModelCatalogStore(
        userDataPath,
        options.appVersion ? { appVersion: options.appVersion } : {}
      );
  }

  async initialize(): Promise<void> {
    await this.freeModelCatalog.initialize();
    await this.update();
  }

  async list(): Promise<ModelSettings> {
    return publicSettings(await this.update());
  }

  async refreshFreeModels(): Promise<ModelSettings> {
    return publicSettings(await this.update({ refreshFree: true }));
  }

  async setFreeModelEnabled(
    modelId: string,
    enabled: boolean
  ): Promise<ModelSettings> {
    return publicSettings(
      await this.update({}, (state) =>
        setFreeModelEnabled(state, modelId, enabled)
      )
    );
  }

  async save(rawInput: ModelSettingsInput): Promise<ModelSettings> {
    const input = ModelSettingsInputSchema.parse(rawInput);
    return publicSettings(
      await this.update({}, (state) => editModelSettings(input, state))
    );
  }

  async listSyncModels(): Promise<SyncModelEntry[]> {
    const { settings, secrets } = await this.update();
    return customSyncEntries(settings.models, secrets);
  }

  async applySyncedModels(changes: SyncedModelChange[]): Promise<void> {
    await this.update({}, (state) => applySyncedModelChanges(state, changes));
  }

  async resolve(
    modelId?: string
  ): Promise<AgentProviderRuntimeConfig | undefined> {
    return resolveSavedModel(await this.update(), modelId);
  }

  async resolveDraft(
    rawModel: ModelConfigInput
  ): Promise<AgentProviderRuntimeConfig> {
    const model = ModelConfigInputSchema.parse(rawModel);
    return resolveDraftModel(model, await this.update());
  }

  async resolveDraftApiKey(input: {
    id?: string;
    apiKey?: string;
    clearApiKey?: boolean;
  }): Promise<string> {
    const provided = input.apiKey?.trim() ?? "";
    if (provided) return provided;
    if (input.clearApiKey || !input.id?.trim()) return "";
    await this.writeChain;
    const { secrets } = await this.persistence.read();
    return decryptModelKey(secrets.encryptedApiKeys[input.id.trim()]);
  }

  /**
   * Saved models that match and hold a readable key. Models whose key cannot
   * be decrypted are left out, as nothing could use them anyway.
   */
  async listKeySources(
    match: (model: WebSearchKeyImportModel) => boolean
  ): Promise<ModelKeySource[]> {
    await this.writeChain;
    const { settings, secrets } = await this.persistence.read();
    const sources: ModelKeySource[] = [];
    for (const model of settings.models) {
      const encrypted = secrets.encryptedApiKeys[model.id];
      if (
        !match({
          id: model.id,
          provider: model.provider,
          baseUrl: model.baseUrl,
          managedBy: model.managedBy,
          hasApiKey: Boolean(encrypted)
        })
      )
        continue;
      try {
        const apiKey = decryptModelKey(encrypted);
        if (apiKey) sources.push({ id: model.id, label: model.label, apiKey });
      } catch {
        continue;
      }
    }
    return sources;
  }

  private async update(
    options: CatalogRefreshOptions = {},
    mutate?: (state: ModelConfigSnapshot) => ModelConfigState
  ): Promise<ModelConfigSnapshot> {
    const operation = this.writeChain.then(async () => {
      const freeCatalog =
        options.refreshFree && this.freeModelCatalog.refreshCatalog
          ? await this.freeModelCatalog.refreshCatalog()
          : await this.freeModelCatalog.getCatalog();
      return withConfigurationLock(this.settingsPath, async () => {
        const stored = await this.persistence.read();
        const prepared: ModelConfigSnapshot = {
          ...stored,
          freeCatalog,
          secrets: withDeepWriteFreeApiKeys(freeCatalog, stored.secrets)
        };
        const requested = mutate ? mutate(prepared) : prepared;
        const [settings, secrets] = synchronizeState(
          requested.settings,
          requested.secrets,
          freeCatalog
        );
        // Every mutation and catalog refresh uses the same atomic commit.
        await this.persistence.write({ settings, secrets });
        return { settings, secrets, freeCatalog };
      });
    });
    // Failed operations must not poison later saves, and may not publish state.
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    return await operation;
  }
}
