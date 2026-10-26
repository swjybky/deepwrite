import { expect, it } from "vitest";
import {
  getModelContentBlockReason,
  isModelQuotaExhausted
} from "./model-provider-errors";

it.each([
  ["Provider stopped with: PROHIBITED_CONTENT", "PROHIBITED_CONTENT"],
  ["503 Provider returned error: PROHIBITED_CONTENT", "PROHIBITED_CONTENT"],
  ['502 {"finishReason":"SAFETY"}', "SAFETY"],
  ["Provider stopped with: BLOCKLIST", "BLOCKLIST"],
  ["Provider stopped with: RECITATION", "RECITATION"],
  ["Provider finish_reason: content_filter", "CONTENT_FILTER"],
  [{ rawStopReason: "SPII", errorMessage: "503 upstream error" }, "SPII"],
  [{ error: { code: "prohibited_content" } }, "PROHIBITED_CONTENT"],
  [new Error("请求失败", { cause: { blockReason: "SAFETY" } }), "SAFETY"]
])("识别内容限制并保留服务端原因：%j", (cause, reason) => {
  expect(getModelContentBlockReason(cause)).toBe(reason);
});

it.each([
  "503 Service Unavailable",
  "Safety settings are not supported",
  "Unable to load blocklist configuration",
  "PROHIBITED_CONTENT_EXTRA",
  "Provider stopped with: OTHER",
  "maximum context length exceeded",
  { content: [{ type: "text", text: "PROHIBITED_CONTENT" }] },
  undefined
])("普通故障与正文中的词语不属于内容拦截：%j", (cause) => {
  expect(getModelContentBlockReason(cause)).toBeUndefined();
});

it("内容限制识别可处理循环包装错误", () => {
  const cause: { cause?: unknown } = {};
  cause.cause = cause;
  expect(getModelContentBlockReason(cause)).toBeUndefined();
});

it.each([
  "429 insufficient_quota",
  "You exceeded your current quota, please check your plan and billing details.",
  "Your credit balance is too low to access this model.",
  "403 该令牌额度已用尽",
  "用户余额不足，请充值后重试。",
  "Monthly usage limit reached",
  { code: "insufficient_quota", message: "请求失败" },
  new Error("请求失败", { cause: { code: "billing_hard_limit_reached" } })
])("识别需要用户处理的模型额度耗尽：%j", (cause) => {
  expect(isModelQuotaExhausted(cause)).toBe(true);
});

it.each([
  "429 Too Many Requests",
  "Rate limit reached for tokens per minute",
  "Quota exceeded for requests per minute",
  "503 Service Unavailable",
  "context window exceeded",
  "模型响应超时",
  undefined
])("临时限速、上下文和网络失败不属于额度耗尽：%j", (cause) => {
  expect(isModelQuotaExhausted(cause)).toBe(false);
});

it("包装错误里的循环引用不会导致递归卡住", () => {
  const cause: { cause?: unknown } = {};
  cause.cause = cause;
  expect(isModelQuotaExhausted(cause)).toBe(false);
});
