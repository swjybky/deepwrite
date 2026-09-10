import {
  SiteOfficialQuotaMergeResponseSchema,
  SiteOfficialQuotaMergeResultSchema,
  type SiteOfficialQuotaMergeResult
} from "@deepwrite/contracts";
import {
  deepWriteSiteOfficialQuotaUrl,
  parseDeepWriteSiteOfficialQuota
} from "./deepwrite-site-official-quota";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_api_key: "当前密钥无效、已停用或已过期，请重新配置。",
  invalid_source_key: "来源 Key 无效、已注销或已过期，请检查后重试。",
  same_api_key: "来源 Key 不能与当前密钥相同。",
  unlimited_key: "无限额度密钥不支持额度转入。",
  source_quota_empty: "来源 Key 没有可转入的剩余额度。",
  key_in_use: "密钥正在使用中，请稍后重试。",
  quota_overflow: "转入后额度超过上限，无法合并。",
  invalid_request: "请输入有效的来源 Key。",
  quota_merge_unavailable: "额度转入服务暂不可用，请刷新额度确认结果后再试。",
  target_changed: "当前密钥配置已变化，请刷新额度后重新确认。",
  models_busy: "模型配置正在处理，请稍后重试。",
  merge_result_unknown:
    "未能确认转入结果，请先刷新当前额度。来源 Key 可能已注销，请勿连续重试。"
};

export class SiteQuotaMergeError extends Error {
  constructor(readonly code: string) {
    super(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.merge_result_unknown);
    this.name = "SiteQuotaMergeError";
  }
}

export async function mergeDeepWriteSiteOfficialQuota(
  targetKey: string,
  rawSourceKey: string,
  fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch,
  mergeUrl = `${deepWriteSiteOfficialQuotaUrl()}/merge`
): Promise<SiteOfficialQuotaMergeResult> {
  if (!targetKey || targetKey.length > 1_024)
    throw new SiteQuotaMergeError("invalid_api_key");
  const sourceKey = rawSourceKey.trim();
  if (!sourceKey || sourceKey.length > 1_024) {
    throw new SiteQuotaMergeError("invalid_request");
  }
  if (sourceKey === targetKey) throw new SiteQuotaMergeError("same_api_key");
  try {
    const response = await fetcher(mergeUrl, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${targetKey}`
      },
      body: JSON.stringify({ source_key: sourceKey })
    });
    const limit = 256 * 1_024;
    if (Number(response.headers.get("content-length")) > limit) {
      throw new SiteQuotaMergeError("merge_result_unknown");
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > limit) {
      throw new SiteQuotaMergeError("merge_result_unknown");
    }
    const payload: unknown = JSON.parse(text);
    if (!response.ok) {
      const code = (payload as { error?: { code?: unknown } })?.error?.code;
      // Remote messages and transport errors can contain credentials. Only
      // known codes are allowed across IPC; never return the response body.
      throw new SiteQuotaMergeError(
        typeof code === "string" && Object.hasOwn(ERROR_MESSAGES, code)
          ? code
          : "merge_result_unknown"
      );
    }
    const parsed = SiteOfficialQuotaMergeResponseSchema.parse(payload);
    return SiteOfficialQuotaMergeResultSchema.parse({
      transferred: parsed.transferred,
      sourceRevoked: parsed.source_revoked,
      quota: parseDeepWriteSiteOfficialQuota(parsed.quota)
    });
  } catch (error: unknown) {
    if (error instanceof SiteQuotaMergeError) throw error;
    throw new SiteQuotaMergeError("merge_result_unknown");
  }
}
