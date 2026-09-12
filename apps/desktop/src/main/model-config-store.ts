import {
  ModelConfigInputSchema,
  ModelSettingsInputSchema,
  type AgentProviderRuntimeConfig,
  type ModelConfigInput,
  type OfficialModelBalance,
  type ModelSettings,
  type ModelSettingsInput
} from "@deepwrite/contracts";
import {
  DeepWriteFreeModelCatalogStore,
  type DeepWriteFreeModelCatalog
} from "./deepwrite-free-model-config";
import {
  DeepWriteOfficialModelCatalogStore,
  type DeepWriteOfficialModelCatalog
} from "./deepwrite-official-model-config";
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
  changeOfficialToken,
  editModelSettings,
  setFreeModelEnabled,
  setOfficialModelEnabled
} from "./model-config-mutations";
import {
  decryptModelKey,
  officialTokenSuffix,
  resolveDraftModel,
  resolveSavedModel
} from "./model-config-runtime";

interface FreeModelCatalogReader {
  initialize(): Promise<void>;
  getCatalog(): Promise<DeepWriteFreeModelCatalog>;
  refreshCatalog?(): Promise<DeepWriteFreeModelCatalog>;
}

interface OfficialModelCatalogReader {
  initialize(): Promise<void>;
  getCatalog(): Promise<DeepWriteOfficialModelCatalog>;
  refreshCatalog?(): Promise<DeepWriteOfficialModelCatalog>;
  queryBalance?(currentKeySuffix?: string): Promise<OfficialModelBalance>;
}

export interface ModelConfigStoreOptions {
  appVersion?: string;
  freeModelCatalog?: FreeModelCatalogReader;
  officialModelCatalog?: OfficialModelCatalogReader;
}

interface CatalogRefreshOptions {
  refreshFree?: boolean;
  refreshOfficial?: boolean;
}

function publicSettings(state: ModelConfigSnapshot): ModelSettings {
  return toPublicSettings(
    state.settings,
    state.secrets,
    state.freeCatalog,
    state.officialCatalog
  );
}

export class ModelConfigStore {
  private readonly persistence: ModelConfigPersistence;
  private readonly freeModelCatalog: FreeModelCatalogReader;
  private readonly officialModelCatalog: OfficialModelCatalogReader;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string, options: ModelConfigStoreOptions = {}) {
    this.persistence = new ModelConfigPersistence(userDataPath);
    this.freeModelCatalog =
      options.freeModelCatalog ??
      new DeepWriteFreeModelCatalogStore(
        userDataPath,
        options.appVersion ? { appVersion: options.appVersion } : {}
      );
    this.officialModelCatalog =
      options.officialModelCatalog ??
      new DeepWriteOfficialModelCatalogStore(userDataPath);
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.freeModelCatalog.initialize(),
      this.officialModelCatalog.initialize()
    ]);
    await this.update();
  }

  async list(): Promise<ModelSettings> {
    return publicSettings(await this.update());
  }

  async refreshFreeModels(): Promise<ModelSettings> {
    return publicSettings(await this.update({ refreshFree: true }));
  }

  async refreshOfficialModels(): Promise<ModelSettings> {
    return publicSettings(await this.update({ refreshOfficial: true }));
  }

  async queryOfficialBalance(): Promise<OfficialModelBalance> {
    if (!this.officialModelCatalog.queryBalance) {
      throw new Error("当前官方模型配置不支持余额查询。");
    }
    await this.writeChain;
    const { secrets } = await this.persistence.read();
    return this.officialModelCatalog.queryBalance(officialTokenSuffix(secrets));
  }

  async saveOfficialToken(rawApiKey: string): Promise<ModelSettings> {
    const apiKey = rawApiKey.trim();
    if (!apiKey) throw new Error("请输入官方令牌。");
    if (apiKey.length > 16_000) throw new Error("官方令牌长度超过限制。");
    return publicSettings(
      await this.update({}, (state) => changeOfficialToken(state, apiKey))
    );
  }

  async clearOfficialToken(): Promise<ModelSettings> {
    return publicSettings(
      await this.update({}, (state) => changeOfficialToken(state, null))
    );
  }

  async setOfficialModelEnabled(
    modelId: string,
    enabled: boolean
  ): Promise<ModelSettings> {
    return publicSettings(
      await this.update({}, (state) =>
        setOfficialModelEnabled(state, modelId, enabled)
      )
    );
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

  private async update(
    options: CatalogRefreshOptions = {},
    mutate?: (state: ModelConfigSnapshot) => ModelConfigState
  ): Promise<ModelConfigSnapshot> {
    const operation = this.writeChain.then(async () => {
      const [freeCatalog, officialCatalog] = await Promise.all([
        options.refreshFree && this.freeModelCatalog.refreshCatalog
          ? this.freeModelCatalog.refreshCatalog()
          : this.freeModelCatalog.getCatalog(),
        options.refreshOfficial && this.officialModelCatalog.refreshCatalog
          ? this.officialModelCatalog.refreshCatalog()
          : this.officialModelCatalog.getCatalog()
      ]);
      const stored = await this.persistence.read();
      const prepared: ModelConfigSnapshot = {
        ...stored,
        freeCatalog,
        officialCatalog,
        secrets: withDeepWriteFreeApiKeys(freeCatalog, stored.secrets)
      };
      const requested = mutate ? mutate(prepared) : prepared;
      const [settings, secrets] = synchronizeState(
        requested.settings,
        requested.secrets,
        freeCatalog,
        officialCatalog
      );
      // Every mutation and catalog refresh uses the same atomic commit.
      await this.persistence.write({ settings, secrets });
      return { settings, secrets, freeCatalog, officialCatalog };
    });
    // Failed operations must not poison later saves, and may not publish state.
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    return await operation;
  }
}
