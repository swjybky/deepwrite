import type {
  ConversationHistoryRecord,
  ConversationHistorySession
} from "@deepwrite/contracts";
import type { JsonNodes, ValueRef } from "./json-nodes";

const SUMMARY_FIELDS = new Set([
  "sessionId",
  "createdAt",
  "updatedAt",
  "title",
  "preview"
]);
type MetadataProjection = Pick<
  ConversationHistorySession,
  "metadata" | "metadataDetails" | "metadataByteLength"
>;

export function metadataProjection(
  nodes: JsonNodes,
  ref: ValueRef | undefined,
  maxBytes: number,
  summaryOnly: boolean
): MetadataProjection {
  if (!ref) return { metadata: {}, metadataDetails: [], metadataByteLength: 2 };
  if (!("node" in ref))
    throw new Error("Conversation metadata is not an object.");
  const node = nodes.node(ref.node);
  if (node.kind !== "object")
    throw new Error("Conversation metadata is not an object.");
  const metadata: ConversationHistoryRecord = {};
  const metadataDetails: NonNullable<
    ConversationHistorySession["metadataDetails"]
  > = [];
  let remaining = Math.max(0, maxBytes - 256);
  for (const [key, child] of node.entries) {
    if ((summaryOnly && !SUMMARY_FIELDS.has(key)) || child.bytes > remaining) {
      const nested = "node" in child ? nodes.node(child.node) : undefined;
      const text = "value" in child && typeof child.value === "string";
      metadataDetails.push({
        path: [key],
        encoding: text || nested?.kind === "text" ? "text" : "json",
        byteLength: text
          ? Buffer.byteLength(child.value as string)
          : nested?.kind === "text"
            ? nested.size.textBytes
            : child.bytes
      });
    } else {
      Object.defineProperty(metadata, key, {
        value: nodes.read(child),
        enumerable: true,
        writable: true,
        configurable: true
      });
      remaining -= child.bytes + Buffer.byteLength(JSON.stringify(key)) + 1;
    }
  }
  const result = { metadata, metadataDetails, metadataByteLength: ref.bytes };
  if (Buffer.byteLength(JSON.stringify(result)) <= maxBytes) return result;
  return {
    metadata: {},
    metadataDetails: [{ path: [], encoding: "json", byteLength: ref.bytes }],
    metadataByteLength: ref.bytes
  };
}
