import { describe, expect, it, vi } from "vitest";
import { mergeDeepWriteSiteOfficialQuota } from "./deepwrite-site-quota-merge";

const url = "https://gateway.example.test/v1/key/quota/merge";
const target = "target_test_only_invalid";
const source = "source_test_only_invalid";
const payload = {
  object: "api_key_quota_merge",
  currency: "CNY",
  transferred: "2.125000",
  source_revoked: true,
  quota: {
    object: "api_key_quota",
    currency: "CNY",
    queried_at: "2026-09-09T00:00:00.123456Z",
    status: "active",
    unlimited: false,
    total: "12.125000",
    used: "10",
    remaining: "2.125000",
    expires_at: "2027-01-01T00:00:00Z"
  }
};

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}

describe("new-site quota merge service", () => {
  it("posts only the source body with saved target authentication and preserves transferred precision", async () => {
    const fetcher = vi.fn(async () => response(payload));
    const result = await mergeDeepWriteSiteOfficialQuota(
      target,
      ` ${source} `,
      fetcher,
      url
    );
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        body: JSON.stringify({ source_key: source }),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${target}`
        }
      })
    );
    expect(result).toEqual({
      transferred: "2.125000",
      sourceRevoked: true,
      quota: {
        queriedAt: "2026-09-09T00:00:00.123Z",
        unlimited: false,
        remaining: 2.125,
        used: 10,
        total: 12.125
      }
    });
    expect(JSON.stringify(result)).not.toContain(source);
    expect(JSON.stringify(result)).not.toContain(target);
  });

  it.each(["", " ", target, "x".repeat(1_025)])(
    "rejects invalid source input locally",
    async (key) => {
      const fetcher = vi.fn();
      await expect(
        mergeDeepWriteSiteOfficialQuota(target, key, fetcher, url)
      ).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["invalid_api_key", 401],
    ["invalid_source_key", 400],
    ["same_api_key", 400],
    ["unlimited_key", 400],
    ["source_quota_empty", 400],
    ["key_in_use", 409],
    ["quota_overflow", 400],
    ["invalid_request", 400],
    ["quota_merge_unavailable", 500]
  ])("maps %s without echoing upstream credentials", async (code, status) => {
    const fetcher = vi.fn(async () =>
      response(
        { error: { code, message: `${source} ${target}` } },
        Number(status)
      )
    );
    const error = await mergeDeepWriteSiteOfficialQuota(
      target,
      source,
      fetcher,
      url
    ).catch((error) => error as Error);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain(source);
    expect(String(error)).not.toContain(target);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    { ...payload, source_revoked: false },
    { ...payload, currency: "USD" },
    { ...payload, transferred: "1e5" },
    { ...payload, quota: { ...payload.quota, unlimited: true } },
    { ...payload, quota: { ...payload.quota, total: "NaN" } },
    { ...payload, quota: { ...payload.quota, status: "revoked" } }
  ])(
    "rejects malformed success instead of claiming the transfer succeeded",
    async (body) => {
      await expect(
        mergeDeepWriteSiteOfficialQuota(
          target,
          source,
          async () => response(body),
          url
        )
      ).rejects.toMatchObject({ code: "merge_result_unknown" });
    }
  );

  it("accepts a successful transfer when the target still has overage", async () => {
    const fetcher = vi.fn(async () =>
      response({
        ...payload,
        quota: {
          ...payload.quota,
          status: "exhausted",
          used: "20",
          remaining: "0"
        }
      })
    );
    await expect(
      mergeDeepWriteSiteOfficialQuota(target, source, fetcher, url)
    ).resolves.toMatchObject({
      sourceRevoked: true,
      quota: { remaining: 0, used: 20 }
    });
  });

  it("rejects oversized saved targets before making a merge request", async () => {
    const fetcher = vi.fn();
    await expect(
      mergeDeepWriteSiteOfficialQuota("x".repeat(1_025), source, fetcher, url)
    ).rejects.toMatchObject({ code: "invalid_api_key" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not retry an uncertain network result or expose transport errors", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error(`${target} ${source}`);
    });
    await expect(
      mergeDeepWriteSiteOfficialQuota(target, source, fetcher, url)
    ).rejects.toMatchObject({
      code: "merge_result_unknown",
      message: expect.stringContaining("先刷新")
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("bounds the response and rejects non-JSON bodies safely", async () => {
    for (const response of [
      new Response(source),
      new Response("x".repeat(256 * 1024 + 1))
    ]) {
      await expect(
        mergeDeepWriteSiteOfficialQuota(
          target,
          source,
          async () => response,
          url
        )
      ).rejects.toMatchObject({ code: "merge_result_unknown" });
    }
  });
});
