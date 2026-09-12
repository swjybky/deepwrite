import type { JsonNodes, ValueRef } from "./json-nodes";

export type CompactPrefix = { prefix: string; pendingSpace: boolean };
const PREFIX_LIMIT = 301;

/** Cache enough normalized text for history and turn labels, including append boundaries. */
export function appendCompactPrefix(
  previous: CompactPrefix,
  text: string
): CompactPrefix {
  if (previous.prefix.length >= PREFIX_LIMIT || !text) return previous;
  const normalized = text.replace(/\s+/g, " ");
  const body = normalized.trim();
  if (!body)
    return { ...previous, pendingSpace: previous.pendingSpace || !!text };
  const space =
    previous.prefix && (previous.pendingSpace || normalized.startsWith(" "))
      ? " "
      : "";
  return {
    prefix: `${previous.prefix}${space}${body}`.slice(0, PREFIX_LIMIT),
    pendingSpace: normalized.endsWith(" ")
  };
}

export function compactLabel(prefix: string, limit: number): string {
  return prefix.length > limit ? `${prefix.slice(0, limit - 1)}…` : prefix;
}

export function textPreview(nodes: JsonNodes, ref?: ValueRef): string {
  if (!ref) return "";
  if ("value" in ref)
    return typeof ref.value === "string"
      ? appendCompactPrefix({ prefix: "", pendingSpace: false }, ref.value)
          .prefix
      : "";
  const node = nodes.node(ref.node);
  return node.kind === "text" ? node.size.compact.prefix : "";
}
