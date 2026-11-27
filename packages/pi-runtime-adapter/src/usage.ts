import type { AgentUsage } from "@deepwrite/contracts";
import type { Usage } from "@earendil-works/pi-ai";

export function normalizeUsage(
  usage: Usage | undefined
): AgentUsage | undefined {
  if (!usage) return undefined;
  const values = [
    usage.input,
    usage.output,
    usage.cacheRead,
    usage.cacheWrite,
    usage.totalTokens
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    return undefined;
  }
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    totalTokens: usage.totalTokens
  };
}
