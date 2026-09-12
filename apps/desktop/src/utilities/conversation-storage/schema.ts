import { DatabaseSync, type StatementSync } from "node:sqlite";

/** Only the Core-owned storage worker opens this database in production. */
export function openConversationDatabase(path: string): DatabaseSync {
  const database = new DatabaseSync(path);
  try {
    if (
      database
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'"
        )
        .get()
    ) {
      const existing = database
        .prepare("SELECT version FROM schema_version")
        .get();
      if (existing && existing.version !== 1)
        throw new Error("Unsupported conversation database version.");
    }
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version);
      CREATE TABLE IF NOT EXISTS scopes (
        key TEXT PRIMARY KEY, active_session_id TEXT, metadata_ref TEXT, removed INTEGER NOT NULL DEFAULT 0, epoch INTEGER NOT NULL DEFAULT 0, incremental INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sessions (
        scope_key TEXT NOT NULL REFERENCES scopes(key), session_id TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 0,
        sequence INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
        metadata_ref TEXT, updated_at TEXT NOT NULL DEFAULT '', legacy_position INTEGER NOT NULL DEFAULT 0,
        message_count INTEGER NOT NULL DEFAULT 0, message_bytes INTEGER NOT NULL DEFAULT 0, turn_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(scope_key, session_id)
      );
      CREATE INDEX IF NOT EXISTS sessions_recent ON sessions(scope_key, deleted, updated_at DESC, session_id);
      CREATE TABLE IF NOT EXISTS messages (
        scope_key TEXT NOT NULL, session_id TEXT NOT NULL, message_id TEXT NOT NULL,
        position INTEGER NOT NULL, value_ref TEXT NOT NULL,
        byte_length INTEGER NOT NULL, role TEXT NOT NULL, preview TEXT NOT NULL,
        running INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 0, reviewing INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(scope_key, session_id, message_id),
        FOREIGN KEY(scope_key, session_id) REFERENCES sessions(scope_key, session_id)
      );
      CREATE INDEX IF NOT EXISTS messages_position ON messages(scope_key, session_id, position, message_id);
      CREATE INDEX IF NOT EXISTS messages_role_position ON messages(scope_key, session_id, role, position);
      CREATE INDEX IF NOT EXISTS messages_visible_position ON messages(scope_key, session_id, position) WHERE preview != '';
      CREATE INDEX IF NOT EXISTS messages_running ON messages(running) WHERE running = 1;
      CREATE TRIGGER IF NOT EXISTS message_statistics_insert AFTER INSERT ON messages BEGIN
        UPDATE sessions SET message_count = message_count + 1, message_bytes = message_bytes + NEW.byte_length,
          turn_count = turn_count + (NEW.role = 'user') WHERE scope_key = NEW.scope_key AND session_id = NEW.session_id;
      END;
      CREATE TRIGGER IF NOT EXISTS message_statistics_delete AFTER DELETE ON messages BEGIN
        UPDATE sessions SET message_count = message_count - 1, message_bytes = message_bytes - OLD.byte_length,
          turn_count = turn_count - (OLD.role = 'user') WHERE scope_key = OLD.scope_key AND session_id = OLD.session_id;
      END;
      CREATE TRIGGER IF NOT EXISTS message_statistics_update AFTER UPDATE OF scope_key, session_id, byte_length, role ON messages BEGIN
        UPDATE sessions SET message_count = message_count - 1, message_bytes = message_bytes - OLD.byte_length,
          turn_count = turn_count - (OLD.role = 'user') WHERE scope_key = OLD.scope_key AND session_id = OLD.session_id;
        UPDATE sessions SET message_count = message_count + 1, message_bytes = message_bytes + NEW.byte_length,
          turn_count = turn_count + (NEW.role = 'user') WHERE scope_key = NEW.scope_key AND session_id = NEW.session_id;
      END;
      CREATE TABLE IF NOT EXISTS receipts (
        scope_key TEXT NOT NULL, session_id TEXT NOT NULL, batch_id TEXT NOT NULL,
        revision INTEGER NOT NULL, generation INTEGER NOT NULL, sequence INTEGER NOT NULL,
        fingerprint TEXT NOT NULL,
        PRIMARY KEY(scope_key, session_id, batch_id)
      );
      CREATE TABLE IF NOT EXISTS nodes (
        id INTEGER PRIMARY KEY, kind TEXT NOT NULL, value TEXT
      );
      CREATE TABLE IF NOT EXISTS chunks (
        hash TEXT PRIMARY KEY, encoding INTEGER NOT NULL, bytes INTEGER NOT NULL, data BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS node_chunks (
        node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        position INTEGER NOT NULL, start INTEGER NOT NULL, length INTEGER NOT NULL,
        json_start INTEGER NOT NULL, json_length INTEGER NOT NULL,
        json_bytes INTEGER NOT NULL, text_bytes INTEGER NOT NULL,
        hash TEXT NOT NULL REFERENCES chunks(hash), PRIMARY KEY(node_id, position)
      );
      CREATE INDEX IF NOT EXISTS node_chunks_hash ON node_chunks(hash);
      CREATE TABLE IF NOT EXISTS chunk_collection_queue (hash TEXT PRIMARY KEY);
      CREATE TRIGGER IF NOT EXISTS queue_unreferenced_chunk AFTER DELETE ON node_chunks
      BEGIN INSERT OR IGNORE INTO chunk_collection_queue(hash) VALUES (OLD.hash); END;
      CREATE TABLE IF NOT EXISTS runtime_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS migrations (
        source TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, state TEXT NOT NULL,
        cursor TEXT NOT NULL, checked_records INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS legacy_values (key TEXT PRIMARY KEY, value_ref TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS legacy_backups (id INTEGER PRIMARY KEY, key TEXT NOT NULL, value_ref TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS migration_records (
        source TEXT NOT NULL, scope_key TEXT NOT NULL, session_id TEXT NOT NULL,
        message_id TEXT NOT NULL, checksum TEXT NOT NULL,
        PRIMARY KEY(source, scope_key, session_id, message_id)
      );
      CREATE TABLE IF NOT EXISTS stages (
        scope_key TEXT NOT NULL, session_id TEXT NOT NULL, stage_id TEXT NOT NULL,
        message_id TEXT NOT NULL, target TEXT NOT NULL DEFAULT 'message', expected_revision INTEGER NOT NULL,
        generation INTEGER NOT NULL, sequence INTEGER NOT NULL, value_ref TEXT,
        consumed INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(scope_key, session_id, stage_id)
      );
      CREATE TABLE IF NOT EXISTS stage_receipts (
        scope_key TEXT NOT NULL, session_id TEXT NOT NULL, stage_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL, fingerprint TEXT NOT NULL, sequence INTEGER NOT NULL,
        PRIMARY KEY(scope_key, session_id, stage_id, chunk_id)
      );
    `);
    const version = database
      .prepare("SELECT version FROM schema_version")
      .get();
    if (version?.version !== 1)
      throw new Error("Unsupported conversation database version.");
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export class Statements {
  private readonly statements = new Map<string, StatementSync>();
  constructor(readonly database: DatabaseSync) {}
  get(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.database.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }
}
