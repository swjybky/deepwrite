import { describe, expect, it } from "vitest";
import { classifyNetworkFailure } from "./network-failure";
import { describeModelNetworkError } from "./model-network-error";

describe("safe transport diagnostics", () => {
  it("prefers a concrete native code over incidental words in outer messages", () => {
    const failure = new Error(
      "request to https://gateway.example.test/timeout",
      {
        cause: { code: "ERR_CERT_DATE_INVALID" }
      }
    );
    expect(classifyNetworkFailure(failure)).toEqual({
      kind: "certificate",
      code: "ERR_CERT_DATE_INVALID"
    });
  });

  it("reads the actual connection failure inside a Node aggregate error", () => {
    const failure = new TypeError("fetch failed", {
      cause: new AggregateError([{ code: "ECONNREFUSED" }])
    });
    expect(classifyNetworkFailure(failure)).toEqual({
      kind: "refused",
      code: "ECONNREFUSED"
    });
  });

  it("stops on cyclic cause chains", () => {
    const failure = { code: "ENOTFOUND", cause: undefined as unknown };
    failure.cause = failure;
    expect(classifyNetworkFailure(failure)).toEqual({
      kind: "dns",
      code: "ENOTFOUND"
    });
  });

  it.each(["127.0.0.1", "::1", "[::1]", "localhost"])(
    "identifies a refused local proxy without exposing its port",
    (host) => {
      const failure = new TypeError("fetch failed", {
        cause: new Error(`connect ECONNREFUSED ${host}:54321`)
      });
      expect(describeModelNetworkError(failure)).toMatchObject({
        kind: "proxy",
        message: expect.stringContaining("无法连接本地网络代理")
      });
      expect(describeModelNetworkError(failure).message).not.toContain("54321");
    }
  );

  it("never exposes unknown codes, raw URLs or credentials", () => {
    const failure = Object.assign(
      new Error("https://gateway.example.test/private?key=invalid-test-key"),
      {
        code: "invalid-test-secret"
      }
    );
    const result = describeModelNetworkError(failure);
    expect(result.kind).toBe("unknown");
    expect(result.message).not.toContain("example.test");
    expect(result.message).not.toContain("invalid-test-key");
    expect(result.message).not.toContain("invalid-test-secret");
  });

  it("retains only the allowlisted certificate code from a detailed native failure", () => {
    const failure = new Error(
      "net::ERR_CERT_DATE_INVALID for https://gateway.example.test/private?key=invalid-test-key"
    );
    expect(describeModelNetworkError(failure)).toEqual({
      kind: "certificate",
      message:
        "模型服务安全证书校验失败，请检查系统时间、网络代理或证书设置。（ERR_CERT_DATE_INVALID）"
    });
  });
});
