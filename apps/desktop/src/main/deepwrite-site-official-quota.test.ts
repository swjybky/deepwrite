import { describe, expect, it } from "vitest";
import {
  deepWriteSiteOfficialQuotaUrl,
  parseDeepWriteSiteOfficialQuota,
  queryDeepWriteSiteOfficialQuota
} from "./deepwrite-site-official-quota";

const QUOTA_URL = "https://gateway.example.test/v1/key/quota";

function quotaResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("DeepWrite site official quota", () => {
  it("builds the key quota URL on the OpenAI gateway", () => {
    expect(deepWriteSiteOfficialQuotaUrl("https://gateway.example.test")).toBe(
      QUOTA_URL
    );
    expect(
      deepWriteSiteOfficialQuotaUrl(
        "https://gateway.example.test/proxy/v1beta/"
      )
    ).toBe("https://gateway.example.test/proxy/v1/key/quota");
  });

  it("parses the authenticated key quota payload in yuan", () => {
    expect(
      parseDeepWriteSiteOfficialQuota(
        {
          object: "api_key_quota",
          currency: "CNY",
          queried_at: "2026-09-01T00:00:00.123456789Z",
          status: "active",
          unlimited: false,
          total: "25",
          used: "7.25",
          remaining: "17.75"
        },
        "2026-09-01T00:00:00.000Z"
      )
    ).toEqual({
      queriedAt: "2026-09-01T00:00:00.123Z",
      remaining: 17.75,
      used: 7.25,
      total: 25,
      unlimited: false
    });
  });

  it("keeps exhausted remaining at zero and omits limits for unlimited keys", () => {
    expect(
      parseDeepWriteSiteOfficialQuota({
        object: "api_key_quota",
        unlimited: false,
        total: "10",
        used: "12",
        remaining: "0"
      })
    ).toMatchObject({ remaining: 0, used: 12, total: 10, unlimited: false });

    expect(
      parseDeepWriteSiteOfficialQuota({
        object: "api_key_quota",
        unlimited: true,
        total: null,
        used: "12.345678",
        remaining: null
      })
    ).toMatchObject({
      remaining: null,
      used: 12.345678,
      total: null,
      unlimited: true
    });
  });

  it("queries /v1/key/quota with the model key and surfaces nested API errors", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const fetcher = async (input: string, init?: RequestInit) => {
      requests.push({
        url: input,
        authorization: new Headers(init?.headers).get("Authorization")
      });
      if (requests.length === 1) {
        return quotaResponse(
          {
            error: {
              code: "invalid_api_key",
              message: "API Key 无效、已停用或已过期"
            }
          },
          401
        );
      }
      return quotaResponse({
        object: "api_key_quota",
        currency: "CNY",
        queried_at: "2026-09-01T00:00:00.000Z",
        status: "active",
        unlimited: false,
        total: "100",
        used: "20",
        remaining: "80"
      });
    };

    await expect(
      queryDeepWriteSiteOfficialQuota(
        "dw_sk_test_only_invalid",
        fetcher,
        QUOTA_URL
      )
    ).rejects.toThrow("API Key 无效、已停用或已过期");

    await expect(
      queryDeepWriteSiteOfficialQuota(
        "dw_sk_test_only_invalid",
        fetcher,
        QUOTA_URL
      )
    ).resolves.toMatchObject({
      remaining: 80,
      used: 20,
      total: 100,
      unlimited: false
    });
    expect(requests).toEqual([
      { url: QUOTA_URL, authorization: "Bearer dw_sk_test_only_invalid" },
      { url: QUOTA_URL, authorization: "Bearer dw_sk_test_only_invalid" }
    ]);
  });
});
