import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { Statements } from "./schema";
import { appendCompactPrefix, type CompactPrefix } from "./text-preview";

// A UTF-16 chunk is at most 192 KiB in UTF-8; never split a surrogate pair.
const CHUNK_CHARACTERS = 64 * 1024;
type ChunkRow = {
  position: number;
  start: number;
  length: number;
  json_start: number;
  json_length: number;
  json_bytes: number;
  text_bytes: number;
  hash: string;
};
export type TextSize = {
  bytes: number;
  chars: number;
  textBytes: number;
  textChars: number;
  compact: CompactPrefix;
};

function endAtBoundary(text: string, end: number): number {
  const previous = text.charCodeAt(end - 1);
  return end < text.length && previous >= 0xd800 && previous <= 0xdbff
    ? end - 1
    : end;
}

export function takeUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  let low = 0;
  let high = Math.min(text.length, maxBytes);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, middle)) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return text.slice(0, endAtBoundary(text, low));
}

export class TextChunks {
  constructor(private readonly sql: Statements) {}

  private store(text: string): string {
    // UTF-16 preserves lone surrogate code units allowed in JSON strings.
    const bytes = Buffer.from(text, "utf16le");
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (!this.sql.get("SELECT hash FROM chunks WHERE hash = ?").get(hash)) {
      const compressed = deflateRawSync(bytes, { level: 1 });
      const encoded = compressed.length + 32 < bytes.length;
      this.sql
        .get(
          "INSERT INTO chunks(hash, encoding, bytes, data) VALUES (?, ?, ?, ?)"
        )
        .run(hash, encoded ? 1 : 0, bytes.length, encoded ? compressed : bytes);
    }
    return hash;
  }

  private decode(hash: string): string {
    const row = this.sql
      .get("SELECT encoding, bytes, data FROM chunks WHERE hash = ?")
      .get(hash);
    if (!row) throw new Error("Conversation text chunk is missing.");
    const data = row.data as Uint8Array;
    const bytes =
      row.encoding === 1
        ? inflateRawSync(data, { maxOutputLength: Number(row.bytes) })
        : Buffer.from(data);
    if (
      bytes.length !== row.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== hash
    ) {
      throw new Error("Conversation text chunk failed its integrity check.");
    }
    return bytes.toString("utf16le");
  }

  private write(
    node: number,
    text: string,
    position: number,
    start: number,
    jsonStart: number
  ): TextSize {
    const size: TextSize = {
      bytes: 2,
      chars: 2,
      textBytes: 0,
      textChars: 0,
      compact: appendCompactPrefix({ prefix: "", pendingSpace: false }, text)
    };
    for (let offset = 0; offset < text.length; position++) {
      const end = endAtBoundary(
        text,
        Math.min(text.length, offset + CHUNK_CHARACTERS)
      );
      const chunk = text.slice(offset, end);
      const json = JSON.stringify(chunk).slice(1, -1);
      const jsonBytes = Buffer.byteLength(json);
      const textBytes = Buffer.byteLength(chunk);
      this.sql
        .get(
          "INSERT INTO node_chunks(node_id, position, start, length, json_start, json_length, json_bytes, text_bytes, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          node,
          position,
          start + offset,
          chunk.length,
          jsonStart,
          json.length,
          jsonBytes,
          textBytes,
          this.store(chunk)
        );
      jsonStart += json.length;
      size.bytes += jsonBytes;
      size.chars += json.length;
      size.textBytes += textBytes;
      size.textChars += chunk.length;
      offset = end;
    }
    return size;
  }

  create(node: number, text: string): TextSize {
    return this.write(node, text, 0, 0, 0);
  }

  append(node: number, text: string, previous: TextSize): TextSize {
    if (!text) return previous;
    const last = this.sql
      .get(
        "SELECT position, start, length, json_start, json_length, json_bytes, text_bytes, hash FROM node_chunks WHERE node_id = ? ORDER BY position DESC LIMIT 1"
      )
      .get(node) as ChunkRow | undefined;
    if (!last) return this.write(node, text, 0, 0, 0);
    const tail = this.decode(last.hash);
    this.sql
      .get("DELETE FROM node_chunks WHERE node_id = ? AND position = ?")
      .run(node, last.position);
    const added = this.write(
      node,
      tail + text,
      last.position,
      last.start,
      last.json_start
    );
    return {
      bytes: previous.bytes - last.json_bytes + added.bytes - 2,
      chars: previous.chars - last.json_length + added.chars - 2,
      textBytes: previous.textBytes - last.text_bytes + added.textBytes,
      textChars: previous.textChars - last.length + added.textChars,
      compact: appendCompactPrefix(previous.compact, text)
    };
  }

  read(node: number): string {
    const rows = this.sql
      .get("SELECT hash FROM node_chunks WHERE node_id = ? ORDER BY position")
      .all(node);
    return rows.map((row) => this.decode(String(row.hash))).join("");
  }

  *jsonParts(node: number, offset: number): Generator<string> {
    if (offset === 0) yield '"';
    const skip = Math.max(0, offset - 1);
    const rows = this.sql
      .get(
        "SELECT json_start, json_length, hash FROM node_chunks WHERE node_id = ? AND json_start + json_length > ? ORDER BY position"
      )
      .iterate(node, skip);
    for (const row of rows) {
      yield JSON.stringify(this.decode(String(row.hash)))
        .slice(1, -1)
        .slice(Math.max(0, skip - Number(row.json_start)));
    }
    yield '"';
  }

  readRange(
    node: number,
    offset: number,
    maxBytes: number
  ): { text: string; nextOffset: number; done: boolean } {
    const rows = this.sql
      .get(
        "SELECT position, start, length, hash FROM node_chunks WHERE node_id = ? AND start + length > ? ORDER BY position"
      )
      .iterate(node, offset);
    let text = "";
    let remaining = maxBytes;
    for (const row of rows) {
      const decoded = this.decode(String(row.hash));
      const rest = decoded.slice(Math.max(0, offset - Number(row.start)));
      const part = takeUtf8(rest, remaining);
      text += part;
      remaining -= Buffer.byteLength(part);
      if (part.length < rest.length || remaining === 0) break;
    }
    const last = this.sql
      .get(
        "SELECT start + length AS length FROM node_chunks WHERE node_id = ? ORDER BY position DESC LIMIT 1"
      )
      .get(node);
    const nextOffset = offset + text.length;
    return { text, nextOffset, done: nextOffset >= Number(last?.length ?? 0) };
  }
}
