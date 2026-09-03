import {
  SiteOfficialQuotaSchema,
  type SiteOfficialQuota
} from "@deepwrite/contracts";
import { deepWriteSiteOfficialGatewayBaseUrl } from "./deepwrite-site-official-model-config";

const SITE_QUOTA_TIMEOUT_MS = 15_000;
const SITE_QUOTA_MAX_RESPONSE_BYTES = 256 * 1_024;

type SiteQuotaFetcher = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNonnegative(value: unknown): number | undefined {
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) && numeric >= 0
    ? numeric
    : undefined;
}

function queriedAtIso(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(
    /(\.\d{3})\d+(?=Z|[+-]\d{2}:?\d{2}$)/u,
    "$1"
  );
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function remoteErrorMessage(payload: unknown): string {
  if (!isRecord(payload)) return "";
  if (typeof payload.error === "string") {
    return payload.error.trim().slice(0, 200);
  }
  if (isRecord(payload.error) && typeof payload.error.message === "string") {
    return payload.error.message.trim().slice(0, 200);
  }
  return "";
}

export function deepWriteSiteOfficialQuotaUrl(rawBaseUrl?: string): string {
  return `${deepWriteSiteOfficialGatewayBaseUrl("openai-completions", rawBaseUrl)}/key/quota`;
}

export function parseDeepWriteSiteOfficialQuota(
  payload: unknown,
  queriedAt = new Date().toISOString()
): SiteOfficialQuota {
  if (!isRecord(payload) || payload.object !== "api_key_quota") {
    throw new Error("新官方小站额度响应格式无效。");
  }
  const resolvedQueriedAt = queriedAtIso(payload.queried_at, queriedAt);
  const used = finiteNonnegative(payload.used);
  if (used === undefined) {
    throw new Error("新官方小站额度响应中缺少已使用额度。");
  }
  if (payload.unlimited === true) {
    return SiteOfficialQuotaSchema.parse({
      queriedAt: resolvedQueriedAt,
      remaining: null,
      used,
      total: null,
      unlimited: true
    });
  }
  const remaining = finiteNonnegative(payload.remaining);
  const total = finiteNonnegative(payload.total);
  if (remaining === undefined || total === undefined) {
    throw new Error("新官方小站额度响应中缺少剩余额度。");
  }
  return SiteOfficialQuotaSchema.parse({
    queriedAt: resolvedQueriedAt,
    remaining,
    used,
    total,
    unlimited: false
  });
}

export async function queryDeepWriteSiteOfficialQuota(
  apiKey: string,
  fetcher: SiteQuotaFetcher = fetch,
  quotaUrl = deepWriteSiteOfficialQuotaUrl()
): Promise<SiteOfficialQuota> {
  const response = await fetcher(quotaUrl, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(SITE_QUOTA_TIMEOUT_MS),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`
    }
  });
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > SITE_QUOTA_MAX_RESPONSE_BYTES
  ) {
    throw new Error("新官方小站额度响应超过大小限制。");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > SITE_QUOTA_MAX_RESPONSE_BYTES) {
    throw new Error("新官方小站额度响应超过大小限制。");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw new Error("新官方小站额度响应格式无效。");
  }
  if (!response.ok) {
    throw new Error(
      remoteErrorMessage(payload) ||
        `查询新官方小站额度失败（HTTP ${response.status}）。`
    );
  }
  return parseDeepWriteSiteOfficialQuota(payload);
}
