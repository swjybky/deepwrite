import type {
  ModelCapacityResult,
  ModelConnectionTestResult,
  ModelConfigInput,
  ModelSettings,
  ModelSettingsInput,
  ModelTestCancelInput,
  ModelTestCancelResult,
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
  save(settings: ModelSettingsInput): Promise<ModelSettings>;
  test(
    model: ModelConfigInput,
    options?: { requestId?: string }
  ): Promise<ModelConnectionTestResult>;
  cancelTest(input: ModelTestCancelInput): Promise<ModelTestCancelResult>;
  resolveCapacity(model: ModelConfigInput): Promise<ModelCapacityResult>;
  listRemote(input: RemoteModelListInput): Promise<RemoteModelListResult>;
}
