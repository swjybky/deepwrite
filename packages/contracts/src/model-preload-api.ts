import type {
  ModelCapacityResult,
  ModelConnectionTestResult,
  ModelConfigInput,
  OfficialModelBalance,
  ModelSettings,
  ModelSettingsInput,
  RemoteModelListInput,
  RemoteModelListResult,
  SiteOfficialQuota
} from "./models";
import type {
  SiteOfficialQuotaMergeInput,
  SiteOfficialQuotaMergeResult
} from "./site-official-models";

export interface ModelPreloadApi {
  list(): Promise<ModelSettings>;
  refreshFree(): Promise<ModelSettings>;
  setFreeModelEnabled(
    modelId: string,
    enabled: boolean
  ): Promise<ModelSettings>;
  refreshOfficial(): Promise<ModelSettings>;
  queryOfficialBalance(): Promise<OfficialModelBalance>;
  saveOfficialToken(apiKey: string): Promise<ModelSettings>;
  clearOfficialToken(): Promise<ModelSettings>;
  saveSiteOfficialToken(apiKey: string): Promise<ModelSettings>;
  clearSiteOfficialToken(): Promise<ModelSettings>;
  refreshSiteOfficial(): Promise<ModelSettings>;
  querySiteOfficialQuota(): Promise<SiteOfficialQuota>;
  mergeSiteOfficialQuota(
    input: SiteOfficialQuotaMergeInput
  ): Promise<SiteOfficialQuotaMergeResult>;
  setSiteOfficialModelEnabled(
    modelId: string,
    enabled: boolean
  ): Promise<ModelSettings>;
  setOfficialModelEnabled(
    modelId: string,
    enabled: boolean
  ): Promise<ModelSettings>;
  save(settings: ModelSettingsInput): Promise<ModelSettings>;
  test(model: ModelConfigInput): Promise<ModelConnectionTestResult>;
  resolveCapacity(model: ModelConfigInput): Promise<ModelCapacityResult>;
  listRemote(input: RemoteModelListInput): Promise<RemoteModelListResult>;
}
