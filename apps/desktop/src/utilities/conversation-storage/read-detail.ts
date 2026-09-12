import type { ConversationHistoryDetailResult } from "@deepwrite/contracts";
import type { JsonNodes, ValueRef } from "./json-nodes";
import { takeUtf8 } from "./text-chunks";

export function readDetail(
  nodes: JsonNodes,
  value: ValueRef,
  revision: number,
  offset = 0,
  maxBytes = 1024 * 1024
): ConversationHistoryDetailResult {
  if ("value" in value && typeof value.value === "string") {
    const chunk = takeUtf8(value.value.slice(offset), maxBytes);
    return {
      revision,
      encoding: "text",
      chunk,
      nextOffset:
        offset + chunk.length < value.value.length
          ? offset + chunk.length
          : null,
      totalBytes: Buffer.byteLength(value.value)
    };
  }
  if ("node" in value) {
    const node = nodes.node(value.node);
    if (node.kind === "text") {
      const part = nodes.text.readRange(value.node, offset, maxBytes);
      return {
        revision,
        encoding: "text",
        chunk: part.text,
        nextOffset: part.done ? null : part.nextOffset,
        totalBytes: node.size.textBytes
      };
    }
  }
  return {
    revision,
    encoding: "json",
    ...nodes.jsonRange(value, offset, maxBytes),
    totalBytes: value.bytes
  };
}
