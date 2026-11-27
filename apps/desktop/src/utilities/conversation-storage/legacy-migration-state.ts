import type { Statements } from "./schema";
import type { MigrationCursor } from "./migration-reader";
import { recoverFailedLegacyReplays } from "./legacy-replay-recovery";
import { ConversationStorageError } from "./errors";

/** This is one import per database, including after the entire profile moves. */
export const LEGACY_FILE_MIGRATION_ID = "conversation-persistence:v1";

export type MigrationRow = {
  source: string;
  fingerprint: string;
  state: string;
  cursor: string;
  checked_records: number;
};

const fields = "source, fingerprint, state, cursor, checked_records";

function remember(sql: Statements, row: MigrationRow): void {
  if (row.source === LEGACY_FILE_MIGRATION_ID) return;
  // Keep the old path checkpoints as recovery evidence. Only this fixed row
  // receives subsequent progress; no history or parsed content is discarded.
  sql
    .get(
      "INSERT INTO migrations(source, fingerprint, state, cursor, checked_records) VALUES (?, ?, ?, ?, ?) ON CONFLICT(source) DO UPDATE SET fingerprint = excluded.fingerprint, state = excluded.state, cursor = excluded.cursor, checked_records = excluded.checked_records"
    )
    .run(
      LEGACY_FILE_MIGRATION_ID,
      row.fingerprint,
      row.state,
      row.cursor,
      row.checked_records
    );
}

/** A completed import outranks a later, failed replay under a different path. */
export async function restoreCompletedLegacyMigration(
  sql: Statements
): Promise<boolean> {
  const row = sql
    .get(
      `SELECT ${fields} FROM migrations WHERE state = 'complete' ORDER BY (source = ?) DESC, (fingerprint != 'absent') DESC, source LIMIT 1`
    )
    .get(LEGACY_FILE_MIGRATION_ID) as MigrationRow | undefined;
  if (!row) return false;
  sql.database.exec("BEGIN IMMEDIATE");
  try {
    await recoverFailedLegacyReplays(sql, row);
    remember(sql, row);
    sql.database.exec("COMMIT");
  } catch (error) {
    sql.database.exec("ROLLBACK");
    throw error;
  }
  return true;
}

export function hasPendingLegacyMigration(sql: Statements): boolean {
  return Boolean(
    sql
      .get(
        "SELECT 1 FROM migrations WHERE state IN ('parsing', 'normalizing') LIMIT 1"
      )
      .get()
  );
}

function progress(row: MigrationRow): number[] {
  const cursor = JSON.parse(row.cursor) as MigrationCursor;
  return [
    row.checked_records,
    cursor.phase === "normalizing" ? 1 : 0,
    ...(cursor.phase === "normalizing"
      ? [cursor.entry, cursor.session, cursor.message]
      : [cursor.offset]),
    row.source === LEGACY_FILE_MIGRATION_ID ? 1 : 0
  ];
}

/** Resume the furthest committed checkpoint, rather than replaying its messages. */
export function prepareLegacyMigration(
  sql: Statements,
  fingerprint: string
): MigrationCursor {
  const rows = sql
    .get(
      `SELECT ${fields} FROM migrations WHERE state IN ('parsing', 'normalizing')`
    )
    .all() as MigrationRow[];
  if (rows.some((row) => row.fingerprint !== fingerprint))
    throw new ConversationStorageError(
      "migration_changed",
      "The original history file changed during migration; both copies have been preserved."
    );
  const candidates = rows.map((row) => ({ row, progress: progress(row) }));
  candidates.sort((left, right) => {
    for (let index = 0; index < left.progress.length; index++) {
      const difference =
        (right.progress[index] ?? 0) - (left.progress[index] ?? 0);
      if (difference) return difference;
    }
    return 0;
  });
  const previous = candidates[0]?.row;
  if (previous) {
    remember(sql, previous);
    return JSON.parse(previous.cursor) as MigrationCursor;
  }
  const cursor: MigrationCursor = {
    phase: "parsing",
    offset: 0,
    parser: { frames: [] }
  };
  sql
    .get(
      "INSERT INTO migrations(source, fingerprint, state, cursor) VALUES (?, ?, 'parsing', ?)"
    )
    .run(LEGACY_FILE_MIGRATION_ID, fingerprint, JSON.stringify(cursor));
  return cursor;
}
