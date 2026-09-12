import type { Statements } from "./schema";
import type { JsonNodes } from "./json-nodes";
import type { MessageRecords, MessageRow } from "./message-records";
import { ConversationStorageError } from "./errors";

const INSTANCE_KEY = "mainInstanceId";

/** A new Main instance has no live agent runs. Restarting only its worker must not stop them. */
export class ConversationRuntimeRecovery {
  private instanceId: string | undefined;
  constructor(
    private readonly sql: Statements,
    private readonly nodes: JsonNodes,
    private readonly records: MessageRecords
  ) {}

  claim(instanceId: string): void {
    if (!instanceId) throw new Error("Main instance ID must not be empty.");
    this.sql.database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.sql
        .get("SELECT value FROM runtime_meta WHERE key = ?")
        .get(INSTANCE_KEY);
      if (current?.value !== instanceId) {
        const marker = `mainInstanceSeen:${instanceId}`;
        if (
          this.sql
            .get("SELECT value FROM runtime_meta WHERE key = ?")
            .get(marker)?.value === "retired"
        )
          throw new ConversationStorageError(
            "main_instance_changed",
            "A retired application instance cannot reclaim conversation storage."
          );
        const rows = this.sql
          .get(
            "SELECT scope_key, session_id, message_id, position, value_ref, byte_length FROM messages WHERE running = 1"
          )
          .all() as (MessageRow & { scope_key: string; session_id: string })[];
        const sessions = new Map<string, Set<string>>();
        for (const row of rows) {
          const ref = this.nodes.patch(this.records.ref(row), {
            op: "set",
            path: ["status"],
            value: "stopped"
          });
          this.records.save(
            row.scope_key,
            row.session_id,
            row.message_id,
            row.position,
            ref
          );
          const scope = sessions.get(row.scope_key) ?? new Set<string>();
          scope.add(row.session_id);
          sessions.set(row.scope_key, scope);
        }
        for (const [key, ids] of sessions)
          for (const id of ids)
            this.sql
              .get(
                "UPDATE sessions SET revision = revision + 1 WHERE scope_key = ? AND session_id = ?"
              )
              .run(key, id);
        this.sql
          .get(
            "INSERT INTO runtime_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
          )
          .run(INSTANCE_KEY, instanceId);
        if (current?.value)
          this.sql
            .get(
              "INSERT INTO runtime_meta(key, value) VALUES (?, 'retired') ON CONFLICT(key) DO UPDATE SET value = 'retired'"
            )
            .run(`mainInstanceSeen:${String(current.value)}`);
        this.sql
          .get(
            "INSERT INTO runtime_meta(key, value) VALUES (?, 'active') ON CONFLICT(key) DO UPDATE SET value = 'active'"
          )
          .run(marker);
      }
      this.sql.database.exec("COMMIT");
      this.instanceId = instanceId;
    } catch (error) {
      this.sql.database.exec("ROLLBACK");
      throw error;
    }
  }

  assertWriter(): void {
    if (!this.instanceId) return;
    if (
      this.sql
        .get("SELECT value FROM runtime_meta WHERE key = ?")
        .get(INSTANCE_KEY)?.value !== this.instanceId
    )
      throw new ConversationStorageError(
        "main_instance_changed",
        "A newer application instance owns conversation storage."
      );
  }
}
