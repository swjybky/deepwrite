import type { DatabaseSync } from "node:sqlite";
import {
  ConversationHistoryJsonSchema,
  RendererStateHistoryMigrationSchema,
  RendererStateKeySchema,
  type RendererStateHistoryMigration,
  type ConversationHistoryJson
} from "@deepwrite/contracts";
import { JsonNodes, type ValueRef } from "./json-nodes";
import { MessageRecords } from "./message-records";
import { Statements } from "./schema";
import { LegacyScopeRecords } from "./legacy-scope-records";
import { ConversationStorageError } from "./errors";
import { jsonEqual } from "./json-equal";

/** Compatibility only: live conversation updates use the bounded history API. */
export class LegacyConversationStore {
  private readonly sql: Statements;
  private readonly nodes: JsonNodes;
  private readonly scopes: LegacyScopeRecords;
  constructor(
    database: DatabaseSync,
    private readonly assertWriter: () => void = () => {}
  ) {
    this.sql = new Statements(database);
    this.nodes = new JsonNodes(this.sql);
    this.scopes = new LegacyScopeRecords(
      this.sql,
      this.nodes,
      new MessageRecords(this.sql, this.nodes)
    );
  }

  load(rawKey: string): ConversationHistoryJson | undefined {
    const key = RendererStateKeySchema.parse(rawKey);
    const row = this.sql
      .get("SELECT value_ref FROM legacy_values WHERE key = ?")
      .get(key);
    return row
      ? this.nodes.read(JSON.parse(String(row.value_ref)) as ValueRef)
      : this.scopes.load(key);
  }

  listHistoryKeys(): string[] {
    return this.sql
      .get(
        "SELECT key FROM legacy_values WHERE key LIKE 'conversation-history:%' UNION SELECT key FROM scopes WHERE removed = 0 ORDER BY key"
      )
      .all()
      .map((row) => String(row.key));
  }

  private transaction<T>(operation: () => T): T {
    this.sql.database.exec("BEGIN IMMEDIATE");
    try {
      this.assertWriter();
      const result = operation();
      this.sql.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.sql.database.exec("ROLLBACK");
      throw error;
    }
  }

  private archive(key: string): void {
    const raw = this.sql
      .get("SELECT value_ref FROM legacy_values WHERE key = ?")
      .get(key);
    if (raw) {
      this.sql
        .get("INSERT INTO legacy_backups(key, value_ref) VALUES (?, ?)")
        .run(key, String(raw.value_ref));
      this.sql.get("DELETE FROM legacy_values WHERE key = ?").run(key);
    }
    this.scopes.archive(key);
  }

  private install(key: string, value: ConversationHistoryJson): void {
    if (
      key.startsWith("conversation-history:") &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Array.isArray(value.conversations)
    )
      this.scopes.install(key, value);
    else
      this.sql
        .get("INSERT INTO legacy_values(key, value_ref) VALUES (?, ?)")
        .run(key, JSON.stringify(this.nodes.create(value)));
  }

  save(rawKey: string, input: unknown): void {
    const key = RendererStateKeySchema.parse(rawKey);
    const value = ConversationHistoryJsonSchema.parse(input);
    this.transaction(() => {
      if (!key.startsWith("conversation-history:")) {
        const old = this.sql
          .get("SELECT value_ref FROM legacy_values WHERE key = ?")
          .get(key);
        if (old) {
          this.nodes.destroy(JSON.parse(String(old.value_ref)) as ValueRef);
          this.sql.get("DELETE FROM legacy_values WHERE key = ?").run(key);
        }
        this.install(key, value);
        return;
      }
      if (
        this.sql.get("SELECT incremental FROM scopes WHERE key = ?").get(key)
          ?.incremental
      )
        throw new ConversationStorageError(
          "legacy_write_conflict",
          "Use an incremental history update or a checked migration to preserve newer conversation data."
        );
      this.archive(key);
      this.install(key, value);
    });
  }

  remove(rawKey: string): void {
    const key = RendererStateKeySchema.parse(rawKey);
    this.transaction(() => {
      if (key.startsWith("conversation-history:")) this.archive(key);
      else {
        const old = this.sql
          .get("SELECT value_ref FROM legacy_values WHERE key = ?")
          .get(key);
        if (old) {
          this.nodes.destroy(JSON.parse(String(old.value_ref)) as ValueRef);
          this.sql.get("DELETE FROM legacy_values WHERE key = ?").run(key);
        }
      }
    });
  }

  migrateHistory(input: RendererStateHistoryMigration): boolean {
    const migration = RendererStateHistoryMigrationSchema.parse(input);
    const value = ConversationHistoryJsonSchema.parse(migration.value);
    return this.transaction(() => {
      const current = this.load(migration.key);
      if (
        (current !== undefined) !== migration.expected.found ||
        (migration.expected.found &&
          !jsonEqual(current, migration.expected.value)) ||
        migration.sources.some((source) => {
          const existing = this.load(source.key);
          return existing === undefined || !jsonEqual(existing, source.value);
        })
      )
        return false;
      this.archive(migration.key);
      for (const source of migration.sources) this.archive(source.key);
      this.install(migration.key, value);
      return true;
    });
  }
}
