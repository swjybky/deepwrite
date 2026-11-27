import type {
  ConversationHistoryChange,
  ConversationHistoryJson
} from "@deepwrite/contracts";
import type { Statements } from "./schema";
import { TextChunks, takeUtf8, type TextSize } from "./text-chunks";

type Primitive = string | number | boolean | null;
export type ValueRef = { bytes: number; chars: number } & (
  { value: Primitive } | { node: number }
);
type Container =
  | { kind: "object"; entries: [string, ValueRef][] }
  | { kind: "array"; entries: ValueRef[] };
type StoredNode = Container | { kind: "text"; size: TextSize };

export interface ModelCallSnapshotStats {
  legacyCallsFound: number;
  estimatedReclaimableBytes: number;
}

export interface StrippedMessageRead {
  value: ConversationHistoryJson;
  strippedCalls: number;
  strippedBytes: number;
  subagentRuns: number;
  toolCalls: number;
  editProposals: number;
  editProposalsWithHunks: number;
  editProposalsWithDiscardSnapshot: number;
}

function isSubagentRunLike(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    ("subagentRunId" in value || "subagentId" in value)
  );
}

function isSubagentRunEntries(entries: readonly [string, ValueRef][]): boolean {
  return entries.some(
    ([key]) => key === "subagentRunId" || key === "subagentId"
  );
}

function stripSnapshotFieldFromValue(
  value: ConversationHistoryJson
): ConversationHistoryJson {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (!("snapshot" in value)) return value;
  const { snapshot: _omitted, ...rest } = value as Record<
    string,
    ConversationHistoryJson
  >;
  return rest;
}

/** Containers and long strings are individually addressable: a delta only visits its ancestor path. */
export class JsonNodes {
  readonly text: TextChunks;
  constructor(private readonly sql: Statements) {
    this.text = new TextChunks(sql);
  }

  appendText(ref: ValueRef, text: string): ValueRef {
    if ("value" in ref && typeof ref.value === "string")
      return this.create(ref.value + text);
    if ("node" in ref) {
      const node = this.node(ref.node);
      if (node.kind === "text")
        return this.save(ref.node, {
          kind: "text",
          size: this.text.append(ref.node, text, node.size)
        });
    }
    throw new Error("Conversation append target is not text.");
  }

  takeField(
    ref: ValueRef,
    key: string
  ): { container: ValueRef; child: ValueRef | undefined } {
    if (!("node" in ref))
      throw new Error("Conversation value is not an object.");
    const node = this.node(ref.node);
    if (node.kind !== "object")
      throw new Error("Conversation value is not an object.");
    const index = node.entries.findIndex(([name]) => name === key);
    if (index < 0) return { container: ref, child: undefined };
    const child = node.entries.splice(index, 1)[0]![1];
    return { container: this.save(ref.node, node), child };
  }

  /** Use only after transferring every child to another persisted owner. */
  releaseContainer(ref: ValueRef): void {
    if (!("node" in ref) || this.node(ref.node).kind === "text")
      throw new Error("Conversation value is not a container.");
    this.sql.get("DELETE FROM nodes WHERE id = ?").run(ref.node);
  }

  node(id: number): StoredNode {
    const row = this.sql
      .get("SELECT kind, value FROM nodes WHERE id = ?")
      .get(id);
    if (!row) throw new Error("Conversation value is missing.");
    return JSON.parse(String(row.value)) as StoredNode;
  }

  private save(id: number, node: StoredNode): ValueRef {
    this.sql
      .get("UPDATE nodes SET kind = ?, value = ? WHERE id = ?")
      .run(node.kind, JSON.stringify(node), id);
    if (node.kind === "text")
      return { node: id, bytes: node.size.bytes, chars: node.size.chars };
    let bytes = 2 + Math.max(0, node.entries.length - 1);
    let chars = bytes;
    for (const entry of node.entries) {
      const value = Array.isArray(entry) ? entry[1] : entry;
      if (Array.isArray(entry)) {
        const key = JSON.stringify(entry[0]);
        bytes += Buffer.byteLength(key) + 1;
        chars += key.length + 1;
      }
      bytes += value.bytes;
      chars += value.chars;
    }
    return { node: id, bytes, chars };
  }

  create(value: ConversationHistoryJson, insideModelCalls = false): ValueRef {
    if (value === null || typeof value !== "object") {
      if (typeof value !== "string" || value.length < 4096) {
        const encoded = JSON.stringify(value);
        return {
          value,
          bytes: Buffer.byteLength(encoded),
          chars: encoded.length
        };
      }
      const id = Number(
        this.sql.get("INSERT INTO nodes(kind) VALUES ('text')").run()
          .lastInsertRowid
      );
      return this.save(id, { kind: "text", size: this.text.create(id, value) });
    }
    const id = Number(
      this.sql.get("INSERT INTO nodes(kind) VALUES ('pending')").run()
        .lastInsertRowid
    );
    if (Array.isArray(value)) {
      return this.save(id, {
        kind: "array",
        entries: value.map((item) => this.create(item, insideModelCalls))
      });
    }
    const isSubagentRun = isSubagentRunLike(value);
    const entries: [string, ValueRef][] = [];
    for (const [key, item] of Object.entries(value)) {
      if (insideModelCalls && key === "snapshot") continue;
      const childInsideModelCalls =
        isSubagentRun && key === "modelCalls" && Array.isArray(item);
      entries.push([key, this.create(item, childInsideModelCalls)]);
    }
    return this.save(id, { kind: "object", entries });
  }

  destroy(ref: ValueRef): void {
    if (!("node" in ref)) return;
    const node = this.node(ref.node);
    if (node.kind === "object")
      node.entries.forEach(([, value]) => this.destroy(value));
    if (node.kind === "array")
      node.entries.forEach((value) => this.destroy(value));
    this.sql.get("DELETE FROM nodes WHERE id = ?").run(ref.node);
  }

  read(ref: ValueRef): ConversationHistoryJson {
    if ("value" in ref) return ref.value;
    const node = this.node(ref.node);
    if (node.kind === "text") return this.text.read(ref.node);
    if (node.kind === "array")
      return node.entries.map((value) => this.read(value));
    return Object.fromEntries(
      node.entries.map(([key, value]) => [key, this.read(value)])
    );
  }

  get(ref: ValueRef, path: readonly (string | number)[]): ValueRef | undefined {
    let current: ValueRef | undefined = ref;
    for (const part of path) {
      if (!current || !("node" in current)) return undefined;
      const node = this.node(current.node);
      current =
        node.kind === "array" && typeof part === "number"
          ? node.entries[part]
          : node.kind === "object" && typeof part === "string"
            ? node.entries.find(([key]) => key === part)?.[1]
            : undefined;
    }
    return current;
  }

  patch(
    ref: ValueRef,
    change: ConversationHistoryChange,
    depth = 0,
    replacement?: ValueRef
  ): ValueRef {
    if (!("node" in ref))
      throw new Error("Conversation patch parent is not a container.");
    const node = this.node(ref.node);
    const key = change.path[depth];
    if (node.kind === "text")
      throw new Error("Conversation patch parent is not a container.");
    const index =
      node.kind === "array" && typeof key === "number"
        ? key
        : node.kind === "object" && typeof key === "string"
          ? node.entries.findIndex(([entry]) => entry === key)
          : -1;
    const child =
      node.kind === "array" ? node.entries[index] : node.entries[index]?.[1];
    const leaf = depth === change.path.length - 1;
    if (!leaf && !child)
      throw new Error("Conversation patch path does not exist.");
    let next: ValueRef | undefined;
    const isModelCallsField =
      leaf &&
      node.kind === "object" &&
      key === "modelCalls" &&
      isSubagentRunEntries(node.entries);
    const isModelCallItem =
      leaf &&
      node.kind === "array" &&
      depth > 0 &&
      change.path[depth - 1] === "modelCalls";
    const isModelCallSnapshotField =
      leaf &&
      node.kind === "object" &&
      key === "snapshot" &&
      depth >= 2 &&
      change.path[depth - 2] === "modelCalls";
    if (!leaf) next = this.patch(child!, change, depth + 1, replacement);
    else if (isModelCallSnapshotField) next = undefined;
    else if (change.op === "set") {
      if (replacement) next = replacement;
      else if (isModelCallsField) next = this.create(change.value, true);
      else if (isModelCallItem)
        next = this.create(stripSnapshotFieldFromValue(change.value), false);
      else next = this.create(change.value);
    } else if (change.op === "append") {
      if (!child) throw new Error("Conversation append target does not exist.");
      next = this.appendText(child, change.text);
    }
    if (
      leaf &&
      child &&
      (!next ||
        !("node" in next) ||
        !("node" in child) ||
        next.node !== child.node)
    )
      this.destroy(child);
    if (node.kind === "array") {
      if (typeof key !== "number" || index < 0 || index > node.entries.length)
        throw new Error("Conversation array index is invalid.");
      if (next) node.entries[index] = next;
      else node.entries.splice(index, 1);
    } else {
      if (typeof key !== "string")
        throw new Error("Conversation object key is invalid.");
      if (next) {
        if (index < 0) node.entries.push([key, next]);
        else node.entries[index] = [key, next];
      } else if (index >= 0) node.entries.splice(index, 1);
    }
    return this.save(ref.node, node);
  }

  /** Move a prepared field without materializing its content or leaving two owners. */
  extractField(ref: ValueRef, key: string): ValueRef {
    if (!("node" in ref))
      throw new Error("Prepared message wrapper is not an object.");
    const node = this.node(ref.node);
    if (node.kind !== "object")
      throw new Error("Prepared message wrapper is not an object.");
    const index = node.entries.findIndex(([name]) => name === key);
    if (index < 0) throw new Error("Prepared message field is missing.");
    const child = node.entries.splice(index, 1)[0]![1];
    this.save(ref.node, node);
    this.destroy(ref);
    return child;
  }

  *jsonParts(ref: ValueRef, offset = 0): Generator<string> {
    if (offset >= ref.chars) return;
    if ("value" in ref) {
      yield JSON.stringify(ref.value).slice(offset);
      return;
    }
    const node = this.node(ref.node);
    if (node.kind === "text") {
      yield* this.text.jsonParts(ref.node, offset);
      return;
    }
    const parts: (string | ValueRef)[] = [node.kind === "array" ? "[" : "{"];
    node.entries.forEach((entry, index) => {
      if (index) parts.push(",");
      if (Array.isArray(entry))
        parts.push(`${JSON.stringify(entry[0])}:`, entry[1]);
      else parts.push(entry);
    });
    parts.push(node.kind === "array" ? "]" : "}");
    for (const part of parts) {
      const length = typeof part === "string" ? part.length : part.chars;
      if (offset >= length) {
        offset -= length;
        continue;
      }
      if (typeof part === "string") yield part.slice(offset);
      else yield* this.jsonParts(part, offset);
      offset = 0;
    }
  }

  jsonRange(
    ref: ValueRef,
    offset: number,
    maxBytes: number
  ): { chunk: string; nextOffset: number | null } {
    let chunk = "";
    let remaining = maxBytes;
    for (const part of this.jsonParts(ref, offset)) {
      const take = takeUtf8(part, remaining);
      chunk += take;
      remaining -= Buffer.byteLength(take);
      if (take.length !== part.length || remaining === 0) break;
    }
    return {
      chunk,
      nextOffset:
        offset + chunk.length < ref.chars ? offset + chunk.length : null
    };
  }

  /** Inspects subagent `modelCalls[].snapshot` refs without touching `chunks`. */
  inspectModelCallSnapshots(): ModelCallSnapshotStats {
    const rows = this.sql
      .get(
        `SELECT value FROM nodes WHERE kind = 'object' AND value LIKE '%"modelCalls"%'`
      )
      .all() as { value: string }[];
    const nodeStmt = this.sql.get("SELECT kind, value FROM nodes WHERE id = ?");
    let legacyCallsFound = 0;
    let estimatedReclaimableBytes = 0;

    for (const row of rows) {
      const parsed = JSON.parse(String(row.value)) as StoredNode;
      if (parsed.kind !== "object" || !isSubagentRunEntries(parsed.entries)) {
        continue;
      }
      const callsRef = parsed.entries.find(([k]) => k === "modelCalls")?.[1];
      if (!callsRef || !("node" in callsRef)) continue;
      const arrayRow = nodeStmt.get(callsRef.node) as
        { kind: string; value: string } | undefined;
      if (!arrayRow) continue;
      const arrayNode = JSON.parse(String(arrayRow.value)) as StoredNode;
      if (arrayNode.kind !== "array") continue;
      for (const callRef of arrayNode.entries) {
        if (!("node" in callRef)) continue;
        const callRow = nodeStmt.get(callRef.node) as
          { kind: string; value: string } | undefined;
        if (!callRow) continue;
        const callNode = JSON.parse(String(callRow.value)) as StoredNode;
        if (callNode.kind !== "object") continue;
        const snapshotRef = callNode.entries.find(
          ([k]) => k === "snapshot"
        )?.[1];
        if (!snapshotRef) continue;
        legacyCallsFound += 1;
        estimatedReclaimableBytes += snapshotRef.bytes;
      }
    }

    return { legacyCallsFound, estimatedReclaimableBytes };
  }

  /**
   * Reconstructs a stored JSON tree while omitting `subagentRuns[].modelCalls[].snapshot`
   * without reading any chunk data referenced by those snapshot subtrees.
   */
  readWithoutModelCallSnapshots(ref: ValueRef): StrippedMessageRead {
    let strippedCalls = 0;
    let strippedBytes = 0;
    let subagentRuns = 0;
    let toolCalls = 0;
    let editProposals = 0;
    let editProposalsWithHunks = 0;
    let editProposalsWithDiscardSnapshot = 0;

    const walk = (
      current: ValueRef,
      keyContext: string | undefined,
      parentRole: "other" | "subagentRun" | "modelCall" | "editProposal"
    ): ConversationHistoryJson => {
      if ("value" in current) return current.value;
      const node = this.node(current.node);
      if (node.kind === "text") return this.text.read(current.node);
      if (node.kind === "array") {
        let itemRole: "other" | "subagentRun" | "modelCall" | "editProposal" =
          "other";
        if (keyContext === "subagentRuns") {
          subagentRuns += node.entries.length;
          itemRole = "subagentRun";
        } else if (keyContext === "toolCalls") {
          toolCalls += node.entries.length;
        } else if (keyContext === "editProposals") {
          editProposals += node.entries.length;
          itemRole = "editProposal";
        } else if (
          keyContext === "modelCalls" &&
          parentRole === "subagentRun"
        ) {
          itemRole = "modelCall";
        }
        return node.entries.map((entry) => walk(entry, undefined, itemRole));
      }

      const nextRole: "other" | "subagentRun" | "modelCall" | "editProposal" =
        isSubagentRunEntries(node.entries)
          ? "subagentRun"
          : parentRole === "editProposal"
            ? "editProposal"
            : parentRole === "modelCall"
              ? "modelCall"
              : "other";

      if (nextRole === "editProposal") {
        const hunksRef = node.entries.find(([k]) => k === "hunks")?.[1];
        if (hunksRef && (!("value" in hunksRef) || hunksRef.value !== null)) {
          editProposalsWithHunks += 1;
        }
        const discardRef = node.entries.find(
          ([k]) => k === "discardSnapshot"
        )?.[1];
        if (
          discardRef &&
          (!("value" in discardRef) || discardRef.value !== null)
        ) {
          editProposalsWithDiscardSnapshot += 1;
        }
      }

      const result: Record<string, ConversationHistoryJson> = {};
      for (const [key, childRef] of node.entries) {
        if (nextRole === "modelCall" && key === "snapshot") {
          strippedCalls += 1;
          strippedBytes += childRef.bytes;
          continue;
        }
        result[key] = walk(childRef, key, nextRole);
      }
      return result;
    };

    const value = walk(ref, undefined, "other");
    return {
      value,
      strippedCalls,
      strippedBytes,
      subagentRuns,
      toolCalls,
      editProposals,
      editProposalsWithHunks,
      editProposalsWithDiscardSnapshot
    };
  }
}
