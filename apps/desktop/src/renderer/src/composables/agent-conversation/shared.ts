import { createId } from "@deepwrite/shared";
export {
  compactConversationText,
  historyItemFor
} from "./conversation-history";

export const STREAM_PRESENTATION_FALLBACK_MS = 120;

export function id(prefix: string): string {
  return createId(prefix);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function rememberBounded(
  set: Set<string>,
  value: string,
  limit = 2_000
): void {
  set.add(value);
  while (set.size > limit) {
    const oldest = set.values().next().value as string | undefined;
    if (!oldest) {
      return;
    }
    set.delete(oldest);
  }
}
