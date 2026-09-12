import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { Statements } from "./schema";
import type { JsonNodes, ValueRef } from "./json-nodes";
import { JsonStreamParser, type JsonParserState } from "./json-stream-parser";

export type ParsingCursor = {
  phase: "parsing";
  offset: number;
  parser: JsonParserState;
};
export type NormalizingCursor = {
  phase: "normalizing";
  root: ValueRef;
  entry: number;
  session: number;
  message: number;
};
export type MigrationCursor = ParsingCursor | NormalizingCursor;
export type MigrationProgress = (offset: number) => void | Promise<void>;

export async function fileFingerprint(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path))
    hash.update(bytes as Buffer);
  return hash.digest("hex");
}

function completeUtf8End(buffer: Buffer): number {
  let start = buffer.length - 1;
  while (start >= 0 && (buffer[start]! & 0xc0) === 0x80) start--;
  if (start < 0) return buffer.length;
  const lead = buffer[start]!;
  const width = lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4;
  return start + width > buffer.length ? start : buffer.length;
}

export async function parseLegacyFile(
  sql: Statements,
  nodes: JsonNodes,
  path: string,
  cursor: ParsingCursor,
  onProgress?: MigrationProgress
): Promise<NormalizingCursor> {
  const parser = new JsonStreamParser(nodes, cursor.parser);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let offset = cursor.offset;
  let carry = Buffer.alloc(0);
  for await (const raw of createReadStream(path, {
    start: offset,
    highWaterMark: 64 * 1024
  })) {
    const buffer = Buffer.concat([carry, raw as Buffer]);
    const end = completeUtf8End(buffer);
    carry = buffer.subarray(end);
    const text = decoder.decode(buffer.subarray(0, end));
    sql.database.exec("BEGIN IMMEDIATE");
    try {
      parser.feed(text);
      offset += end;
      const next: ParsingCursor = {
        phase: "parsing",
        offset,
        parser: parser.state
      };
      const serialized = JSON.stringify(next);
      if (Buffer.byteLength(serialized) > 4 * 1024 * 1024)
        throw new Error(
          "History parser checkpoint exceeds its byte budget; original data has been preserved."
        );
      sql
        .get("UPDATE migrations SET cursor = ? WHERE source = ?")
        .run(serialized, path);
      sql.database.exec("COMMIT");
    } catch (error) {
      sql.database.exec("ROLLBACK");
      throw error;
    }
    await onProgress?.(offset);
  }
  if (carry.length) decoder.decode(carry); // Reject incomplete UTF-8 before activation.
  sql.database.exec("BEGIN IMMEDIATE");
  try {
    const root = parser.finish();
    const next: NormalizingCursor = {
      phase: "normalizing",
      root,
      entry: 0,
      session: 0,
      message: 0
    };
    sql
      .get(
        "UPDATE migrations SET state = 'normalizing', cursor = ? WHERE source = ?"
      )
      .run(JSON.stringify(next), path);
    sql.database.exec("COMMIT");
    return next;
  } catch (error) {
    sql.database.exec("ROLLBACK");
    throw error;
  }
}
