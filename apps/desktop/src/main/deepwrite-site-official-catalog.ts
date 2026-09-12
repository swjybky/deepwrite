import type { RemoteModelListItem } from "@deepwrite/contracts";
import {
  deepWriteSiteOfficialGatewayBaseUrl,
  type DeepWriteSiteOfficialRemoteCatalog
} from "./deepwrite-site-official-model-config";
import { queryDeepWriteSiteOfficialQuota } from "./deepwrite-site-official-quota";
import {
  RemoteModelListError,
  type ListRemoteModelsInput
} from "./list-remote-models";

interface SiteOfficialCatalogContext {
  listRemoteModels(
    input: ListRemoteModelsInput
  ): Promise<RemoteModelListItem[]>;
  remoteFetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

interface CatalogFailure {
  endpoint: string;
  error: unknown;
}

async function catalogErrorMessage(
  ctx: SiteOfficialCatalogContext,
  apiKey: string,
  failures: CatalogFailure[]
): Promise<string> {
  // Include only fixed endpoint paths and locally generated errors, never the
  // request URL (which can contain the key) or an untrusted response body.
  const details = failures
    .map(({ endpoint, error }) => {
      const reason =
        error instanceof RemoteModelListError
          ? error.httpStatus === undefined
            ? error.message
            : `HTTP ${error.httpStatus}`
          : "请求失败";
      return `${endpoint}：${reason}`;
    })
    .join("；");
  const failureMessage = `新官方小站模型列表校验失败（${details}）。`;
  const authenticationRejected = failures.some(
    ({ error }) =>
      error instanceof RemoteModelListError &&
      (error.httpStatus === 401 || error.httpStatus === 403)
  );
  if (!authenticationRejected) return failureMessage;

  // The gateway also returns 401 for exhausted keys. Its read-only quota
  // endpoint accepts those keys and can distinguish that case reliably.
  try {
    const quota = await queryDeepWriteSiteOfficialQuota(
      apiKey,
      ctx.remoteFetch
    );
    if (!quota.unlimited && quota.remaining === 0) {
      return `当前新官方小站密钥额度已用完，请补充额度后重试。${failureMessage}`;
    }
    return `密钥额度查询成功，但模型列表访问被拒绝，请联系小站管理员检查模型接口权限。${failureMessage}`;
  } catch {
    return `${failureMessage}请确认使用的是新官方小站签发的模型密钥，且未停用、注销或过期。`;
  }
}

export async function loadDeepWriteSiteOfficialCatalog(
  ctx: SiteOfficialCatalogContext,
  apiKey: string
): Promise<DeepWriteSiteOfficialRemoteCatalog> {
  const [models, googleModels] = await Promise.allSettled([
    ctx.listRemoteModels({
      provider: "deepwrite-site",
      api: "openai-completions",
      baseUrl: deepWriteSiteOfficialGatewayBaseUrl("openai-completions"),
      apiKey
    }),
    ctx.listRemoteModels({
      provider: "google",
      api: "google-generative-ai",
      baseUrl: deepWriteSiteOfficialGatewayBaseUrl("google-generative-ai"),
      apiKey
    })
  ]);
  if (models.status === "fulfilled" && googleModels.status === "fulfilled") {
    return { models: models.value, googleModels: googleModels.value };
  }
  const failures: CatalogFailure[] = [];
  if (models.status === "rejected") {
    failures.push({ endpoint: "/v1/models", error: models.reason });
  }
  if (googleModels.status === "rejected") {
    failures.push({ endpoint: "/v1beta/models", error: googleModels.reason });
  }
  throw new Error(await catalogErrorMessage(ctx, apiKey, failures));
}
