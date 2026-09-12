import { randomUUID } from "node:crypto";
import type {
  ConversationHistoryMergeScopesQuery,
  ConversationHistoryMergeScopesResult
} from "@deepwrite/contracts";
import type { Statements } from "./schema";
import type { JsonNodes, ValueRef } from "./json-nodes";
import { ConversationStorageError } from "./errors";

type Scope = {
  active_session_id: string | null;
  metadata_ref: string | null;
  removed: number;
};
type Session = {
  scope_key: string;
  session_id: string;
  revision: number;
  generation: number;
  sequence: number;
  deleted: number;
  metadata_ref: string | null;
  updated_at: string;
  legacy_position: number;
};
function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

/** Explicit book/stage migration. Ownership moves between normalized rows in one transaction. */
export class ConversationScopeMerger {
  constructor(
    private readonly sql: Statements,
    private readonly nodes: JsonNodes,
    private readonly assertWriter: () => void
  ) {}

  private scope(key: string): Scope | undefined {
    return this.sql
      .get(
        "SELECT active_session_id, metadata_ref, removed FROM scopes WHERE key = ?"
      )
      .get(key) as Scope | undefined;
  }

  private hasActiveWork(key: string, sessionId?: string): boolean {
    return !!this.sql
      .get(
        "SELECT 1 FROM messages WHERE scope_key = ? AND (? IS NULL OR session_id = ?) AND (running = 1 OR reviewing = 1) LIMIT 1"
      )
      .get(key, sessionId ?? null, sessionId ?? null);
  }

  private move(row: Session, key: string, previous?: Session): void {
    this.sql
      .get(
        "INSERT INTO sessions(scope_key, session_id, revision, generation, sequence, deleted, metadata_ref, updated_at, legacy_position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        key,
        row.session_id,
        Math.max(row.revision, previous?.revision ?? 0) + 1,
        Math.max(row.generation, previous?.generation ?? 0) + 1,
        Math.max(row.sequence, previous?.sequence ?? 0),
        row.deleted,
        row.metadata_ref,
        row.updated_at,
        row.legacy_position
      );
    this.sql
      .get(
        "UPDATE messages SET scope_key = ? WHERE scope_key = ? AND session_id = ?"
      )
      .run(key, row.scope_key, row.session_id);
    this.sql
      .get("DELETE FROM sessions WHERE scope_key = ? AND session_id = ?")
      .run(row.scope_key, row.session_id);
  }

  private mergeMetadata(key: string, source: string): void {
    const target = this.scope(key)!;
    const origin = this.scope(source)!;
    if (!origin.metadata_ref) return;
    let targetRef = target.metadata_ref
      ? (JSON.parse(target.metadata_ref) as ValueRef)
      : this.nodes.create({ version: 1 });
    let sourceRef = JSON.parse(origin.metadata_ref) as ValueRef;
    if (!("node" in sourceRef)) return;
    const node = this.nodes.node(sourceRef.node);
    if (node.kind !== "object") return;
    for (const [name] of node.entries) {
      if (name === "activeSessionId" || this.nodes.get(targetRef, [name]))
        continue;
      const detached = this.nodes.takeField(sourceRef, name);
      sourceRef = detached.container;
      targetRef = this.nodes.patch(
        targetRef,
        { op: "set", path: [name], value: null },
        0,
        detached.child
      );
    }
    this.sql
      .get("UPDATE scopes SET metadata_ref = ? WHERE key = ?")
      .run(JSON.stringify(targetRef), key);
    this.sql
      .get("UPDATE scopes SET metadata_ref = ? WHERE key = ?")
      .run(JSON.stringify(sourceRef), source);
  }

  merge(
    query: ConversationHistoryMergeScopesQuery
  ): ConversationHistoryMergeScopesResult {
    this.sql.database.exec("BEGIN IMMEDIATE");
    try {
      this.assertWriter();
      if (this.scope(query.key)?.removed)
        throw new ConversationStorageError(
          "scope_removed",
          "A removed conversation scope cannot be restored by migration."
        );
      if (
        this.sql.get("SELECT 1 FROM legacy_values WHERE key = ?").get(query.key)
      )
        throw new ConversationStorageError(
          "migration_unreadable",
          "The destination history is not normalized; its original data has been preserved."
        );
      this.sql
        .get("INSERT OR IGNORE INTO scopes(key) VALUES (?)")
        .run(query.key);
      const protectedSessions = new Set(
        this.sql
          .get(
            "SELECT session_id FROM sessions WHERE scope_key = ? AND (sequence > 0 OR deleted = 1)"
          )
          .all(query.key)
          .map((row) => String(row.session_id))
      );
      const mergedSources: string[] = [];
      for (const source of new Set(query.sources)) {
        if (source === query.key) continue;
        const origin = this.scope(source);
        if (!origin || origin.removed) continue;
        if (this.hasActiveWork(source))
          throw new ConversationStorageError(
            "session_busy",
            "Finish the source run or in-progress review before migrating its history."
          );
        const rows = this.sql
          .get(
            "SELECT * FROM sessions WHERE scope_key = ? ORDER BY legacy_position, session_id"
          )
          .all(source) as Session[];
        let backup: string | undefined;
        for (const row of rows) {
          const existing = this.sql
            .get(
              "SELECT * FROM sessions WHERE scope_key = ? AND session_id = ?"
            )
            .get(query.key, row.session_id) as Session | undefined;
          // An acknowledged incremental update or deletion outranks an older scope snapshot.
          if (
            existing &&
            (protectedSessions.has(row.session_id) ||
              !(timestamp(row.updated_at) > timestamp(existing.updated_at)))
          )
            continue;
          if (existing) {
            if (this.hasActiveWork(query.key, row.session_id))
              throw new ConversationStorageError(
                "session_busy",
                "Finish the destination run or in-progress review before replacing its history."
              );
            if (!backup) {
              backup = `conversation-backup:${randomUUID()}`;
              this.sql
                .get(
                  "INSERT INTO scopes(key, removed, incremental) VALUES (?, 1, 1)"
                )
                .run(backup);
            }
            this.move(existing, backup);
          }
          this.move(row, query.key, existing);
        }
        this.mergeMetadata(query.key, source);
        this.sql
          .get(
            "UPDATE scopes SET removed = 1, incremental = 1, epoch = epoch + 1 WHERE key = ?"
          )
          .run(source);
        mergedSources.push(source);
      }
      const scope = this.scope(query.key)!;
      const selected =
        scope.active_session_id &&
        this.sql
          .get(
            "SELECT 1 FROM sessions WHERE scope_key = ? AND session_id = ? AND deleted = 0"
          )
          .get(query.key, scope.active_session_id);
      const activeSessionId = selected
        ? scope.active_session_id
        : ((this.sql
            .get(
              "SELECT session_id FROM sessions WHERE scope_key = ? AND deleted = 0 ORDER BY julianday(updated_at) DESC, session_id LIMIT 1"
            )
            .get(query.key)?.session_id as string | undefined) ?? null);
      this.sql
        .get("UPDATE scopes SET active_session_id = ? WHERE key = ?")
        .run(activeSessionId, query.key);
      this.sql.database.exec("COMMIT");
      return { mergedSources, activeSessionId };
    } catch (error) {
      this.sql.database.exec("ROLLBACK");
      throw error;
    }
  }
}
