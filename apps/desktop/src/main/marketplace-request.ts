import type { MarketplaceFetcher } from "./marketplace-client-options";
import { readLimitedResponse } from "./marketplace-http";
import { describeMarketplaceNetworkError } from "./marketplace-network-error";
import {
  asRecord,
  requiredString,
  MarketplaceClientError
} from "./marketplace-response";
export type MarketplaceRequestOptions = {
  authenticated: boolean | "optional";
  body?: unknown;
  /** Replaces the default timeout for requests that carry images. */
  timeoutMs?: number;
};
const MARKETPLACE_REQUEST_TIMEOUT_MS = 12_000;
const ACCOUNT_ERRORS: Record<string, string> = {
  invalid_credentials: "用户名或密码不正确",
  invalid_email: "请填写有效的邮箱地址。",
  invalid_email_code: "验证码错误或已过期，请重新获取。",
  email_send_limited: "验证码发送过于频繁，请稍后重试。",
  email_service_unavailable: "邮件服务暂不可用，请稍后重试。",
  email_delivery_failed: "邮件发送失败，请检查邮箱后重试。",
  email_taken: "该邮箱已被其他账号使用。",
  email_already_verified: "当前账号已完成邮箱验证。",
  username_or_email_taken: "用户名或邮箱已被使用。",
  invalid_login: "用户名或密码错误。"
};
function accountErrorMessage(
  code: string,
  message: string,
  path: string,
  status: number
): string {
  return Object.hasOwn(ACCOUNT_ERRORS, code)
    ? (ACCOUNT_ERRORS[code] ?? "请求失败。")
    : path.includes("/auth/") ||
        path.endsWith("/email") ||
        path.endsWith("/email-code")
      ? `账号请求失败（${status}），请稍后重试。`
      : message || `技能广场请求失败（${status}）。`;
}
export async function requestMarketplace(
  context: {
    baseUrl: string;
    fetcher: MarketplaceFetcher;
    onUnauthorized(): Promise<void>;
  },
  method: string,
  path: string,
  options: MarketplaceRequestOptions,
  headers: Headers,
  requestedToken: string | undefined
): Promise<unknown> {
  let response: Response;
  try {
    response = await context.fetcher(`${context.baseUrl}${path}`, {
      method,
      cache: "no-store",
      signal: AbortSignal.timeout(
        options.timeoutMs ?? MARKETPLACE_REQUEST_TIMEOUT_MS
      ),
      headers,
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {})
    });
  } catch (error: unknown) {
    const failure = describeMarketplaceNetworkError(error);
    throw new MarketplaceClientError(
      "marketplace.network_error",
      failure.message,
      undefined,
      { cause: error }
    );
  }
  const text = await readLimitedResponse(response);
  let payload: unknown;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new MarketplaceClientError(
        "marketplace.invalid_response",
        "技能广场返回了无效 JSON。",
        response.status
      );
    }
  }
  if (response.status === 401) {
    const envelope =
      typeof payload === "object" && payload !== null && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    const rawError = envelope.error;
    const error =
      typeof rawError === "object" &&
      rawError !== null &&
      !Array.isArray(rawError)
        ? (rawError as Record<string, unknown>)
        : {};
    if (options.authenticated === false) {
      throw new MarketplaceClientError(
        requiredString(error, "code") || "marketplace.unauthorized",
        accountErrorMessage(
          requiredString(error, "code"),
          requiredString(error, "message"),
          path,
          response.status
        ),
        401
      );
    }
    if (requestedToken) {
      await context.onUnauthorized();
    }
    throw new MarketplaceClientError(
      "marketplace.unauthorized",
      "技能广场登录已失效，请重新登录。",
      401
    );
  }
  if (!response.ok) {
    const envelope = payload ? asRecord(payload, "错误信息") : {};
    const rawError = envelope.error;
    const error =
      typeof rawError === "object" &&
      rawError !== null &&
      !Array.isArray(rawError)
        ? (rawError as Record<string, unknown>)
        : {};
    throw new MarketplaceClientError(
      requiredString(error, "code") || `marketplace.http_${response.status}`,
      accountErrorMessage(
        requiredString(error, "code"),
        requiredString(error, "message"),
        path,
        response.status
      ),
      response.status
    );
  }
  if (response.status === 204) return undefined;
  const envelope = asRecord(payload, "响应");
  if (!("data" in envelope)) {
    throw new MarketplaceClientError(
      "marketplace.invalid_response",
      "技能广场响应缺少 data 字段。",
      response.status
    );
  }
  return envelope.data;
}
