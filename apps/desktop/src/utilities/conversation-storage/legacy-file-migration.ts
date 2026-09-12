import type { DatabaseSync } from "node:sqlite";
import { Statements } from "./schema";
import { JsonNodes } from "./json-nodes";
import { MessageRecords } from "./message-records";
import {
  fileFingerprint,
  parseLegacyFile,
  type MigrationCursor,
  type MigrationProgress
} from "./migration-reader";
import { MigrationNormalizer } from "./migration-normalizer";

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Must complete before the worker registers request handlers. No old-file writer is retained. */
export async function migrateLegacyFile(
  database: DatabaseSync,
  source: string,
  onProgress?: MigrationProgress
): Promise<void> {
  const sql = new Statements(database);
  const previous = sql
    .get("SELECT fingerprint, state, cursor FROM migrations WHERE source = ?")
    .get(source);
  if (previous?.state === "complete") return;
  let fingerprint: string;
  try {
    fingerprint = await fileFingerprint(source);
  } catch (error) {
    if (!missing(error) || previous) throw error;
    sql
      .get(
        "INSERT INTO migrations(source, fingerprint, state, cursor) VALUES (?, 'absent', 'complete', '{}')"
      )
      .run(source);
    return;
  }
  if (previous && previous.fingerprint !== fingerprint)
    throw new Error(
      "The original history file changed during migration; both copies have been preserved."
    );
  let cursor: MigrationCursor = previous
    ? (JSON.parse(String(previous.cursor)) as MigrationCursor)
    : { phase: "parsing", offset: 0, parser: { frames: [] } };
  if (!previous)
    sql
      .get(
        "INSERT INTO migrations(source, fingerprint, state, cursor) VALUES (?, ?, 'parsing', ?)"
      )
      .run(source, fingerprint, JSON.stringify(cursor));
  const nodes = new JsonNodes(sql);
  if (cursor.phase === "parsing")
    cursor = await parseLegacyFile(sql, nodes, source, cursor, onProgress);
  await new MigrationNormalizer(
    sql,
    nodes,
    new MessageRecords(sql, nodes),
    source,
    cursor
  ).run();
  if ((await fileFingerprint(source)) !== fingerprint)
    throw new Error(
      "The original history file changed during migration; both copies have been preserved."
    );
  database.exec("BEGIN IMMEDIATE");
  try {
    const { container, child } = nodes.takeField(cursor.root, "entries");
    nodes.releaseContainer(child!);
    sql
      .get(
        "UPDATE migrations SET state = 'complete', cursor = ? WHERE source = ?"
      )
      .run(JSON.stringify({ document: container }), source);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
