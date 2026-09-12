import type {
  ConversationHistoryDetailQuery,
  ConversationHistoryDetailResult,
  ConversationHistoryListQuery,
  ConversationHistoryListResult,
  ConversationHistoryMessagesQuery,
  ConversationHistoryMessagesResult,
  ConversationHistoryMetadataDetailQuery,
  ConversationHistorySessionQuery,
  ConversationHistorySession,
  ConversationHistoryTurnsQuery,
  ConversationHistoryTurnsResult
} from "@deepwrite/contracts";
import type { Statements } from "./schema";
import type { JsonNodes, ValueRef } from "./json-nodes";
import type { MessageRecords, MessageRow } from "./message-records";
import { readDetail } from "./read-detail";
import { metadataProjection } from "./metadata-records";
import { sessionSummary } from "./session-summary";

export class ConversationQueries {
  constructor(
    protected readonly sql: Statements,
    protected readonly nodes: JsonNodes,
    protected readonly records: MessageRecords
  ) {}

  session(
    query: ConversationHistorySessionQuery,
    summaryOnly = false
  ): ConversationHistorySession | null {
    const row = this.sql
      .get(
        "SELECT revision, generation, sequence, deleted, sessions.metadata_ref, message_count, message_bytes, turn_count FROM sessions JOIN scopes ON scopes.key = sessions.scope_key WHERE scope_key = ? AND session_id = ? AND scopes.removed = 0"
      )
      .get(query.key, query.sessionId);
    if (!row) return null;
    const ref = row.metadata_ref
      ? (JSON.parse(String(row.metadata_ref)) as ValueRef)
      : undefined;
    const result: ConversationHistorySession = {
      sessionId: query.sessionId,
      summary: sessionSummary(
        this.sql,
        this.nodes,
        query.key,
        query.sessionId,
        ref,
        Number(row.turn_count)
      ),
      ...metadataProjection(
        this.nodes,
        ref,
        (query.maxBytes ?? 1024 * 1024) - 256,
        summaryOnly
      ),
      revision: Number(row.revision),
      generation: Number(row.generation),
      sequence: Number(row.sequence),
      deleted: Boolean(row.deleted),
      messageCount: Number(row.message_count),
      byteLength: Number(row.message_bytes)
    };
    const maxBytes = query.maxBytes ?? 1024 * 1024;
    if (Buffer.byteLength(JSON.stringify(result)) > maxBytes)
      Object.assign(result, metadataProjection(this.nodes, ref, 0, true));
    if (Buffer.byteLength(JSON.stringify(result)) > maxBytes)
      throw new Error(
        "The page budget is too small for this conversation header."
      );
    return result;
  }

  list(query: ConversationHistoryListQuery): ConversationHistoryListResult {
    if (
      this.sql.get("SELECT removed FROM scopes WHERE key = ?").get(query.key)
        ?.removed
    )
      return { activeSessionId: null, sessions: [], nextSessionId: null };
    const limit = query.limit ?? 50;
    const rows = this.sql
      .get(
        "SELECT session_id FROM sessions WHERE scope_key = ? AND (? = 1 OR deleted = 0) AND session_id > ? ORDER BY session_id LIMIT ?"
      )
      .all(
        query.key,
        query.includeDeleted ? 1 : 0,
        query.afterSessionId ?? "",
        limit + 1
      );
    const scope = this.sql
      .get("SELECT active_session_id FROM scopes WHERE key = ?")
      .get(query.key);
    const sessions: ConversationHistorySession[] = [];
    const activeSessionId = scope?.active_session_id
      ? String(scope.active_session_id)
      : null;
    const maxBytes = query.maxBytes ?? 1024 * 1024;
    let used = 0;
    for (const row of rows.slice(0, limit)) {
      const nextSessionId =
        rows.length > sessions.length + 1 ? String(row.session_id) : null;
      const overhead = Buffer.byteLength(
        JSON.stringify({ activeSessionId, sessions: [], nextSessionId })
      );
      const remaining = maxBytes - overhead - used - (sessions.length ? 1 : 0);
      if (remaining < 1024 && sessions.length) break;
      const session = this.session(
        {
          key: query.key,
          sessionId: String(row.session_id),
          maxBytes: Math.max(1024, Math.min(16 * 1024, remaining))
        },
        true
      )!;
      const bytes = Buffer.byteLength(JSON.stringify(session));
      if (bytes > remaining && sessions.length) break;
      if (bytes > remaining)
        throw new Error(
          "The page budget is too small for this conversation header."
        );
      used += bytes + (sessions.length ? 1 : 0);
      sessions.push(session);
    }
    return {
      activeSessionId,
      sessions,
      nextSessionId:
        rows.length > sessions.length
          ? (sessions.at(-1)?.sessionId ?? null)
          : null
    };
  }

  private version(query: ConversationHistorySessionQuery): {
    revision: number;
    generation: number;
  } {
    const row = this.sql
      .get(
        "SELECT revision, generation FROM sessions JOIN scopes ON scopes.key = sessions.scope_key WHERE scope_key = ? AND session_id = ? AND scopes.removed = 0"
      )
      .get(query.key, query.sessionId);
    if (!row) throw new Error("Conversation session is missing.");
    return {
      revision: Number(row.revision),
      generation: Number(row.generation)
    };
  }

  messages(
    query: ConversationHistoryMessagesQuery
  ): ConversationHistoryMessagesResult {
    const version = this.version(query);
    const limit = query.limit ?? 50;
    const maxBytes = query.maxBytes ?? 1024 * 1024;
    const backward = query.direction === "backward";
    const rows = (
      backward
        ? this.sql
            .get(
              "SELECT message_id, position, value_ref, byte_length FROM messages WHERE scope_key = ? AND session_id = ? AND position < ? ORDER BY position DESC LIMIT ?"
            )
            .all(
              query.key,
              query.sessionId,
              query.afterPosition ?? Number.MAX_SAFE_INTEGER,
              limit + 1
            )
        : this.sql
            .get(
              "SELECT message_id, position, value_ref, byte_length FROM messages WHERE scope_key = ? AND session_id = ? AND position > ? ORDER BY position LIMIT ?"
            )
            .all(
              query.key,
              query.sessionId,
              query.afterPosition ?? -1,
              limit + 1
            )
    ) as MessageRow[];
    const messages: ConversationHistoryMessagesResult["messages"] = [];
    let bytes = 128;
    for (const row of rows.slice(0, limit)) {
      const message = this.records.project(row, maxBytes - bytes);
      const size = Buffer.byteLength(JSON.stringify(message));
      if (size + bytes > maxBytes && messages.length) break;
      if (size + bytes > maxBytes)
        throw new Error(
          "Conversation message metadata exceeds the page budget; read its full detail in chunks."
        );
      messages.push(message);
      bytes += size;
    }
    const nextPosition =
      rows.length > messages.length
        ? (messages.at(-1)?.position ?? null)
        : null;
    if (backward) messages.reverse();
    return { ...version, messages, nextPosition };
  }

  detail(
    query: ConversationHistoryDetailQuery
  ): ConversationHistoryDetailResult {
    const { revision } = this.version(query);
    if (revision !== query.expectedRevision)
      throw new Error(
        "Conversation changed while reading its details; reload the session."
      );
    const row = this.records.find(query.key, query.sessionId, query.messageId);
    if (!row) throw new Error("Conversation message is missing.");
    const value = this.nodes.get(this.records.ref(row), query.path);
    if (!value) throw new Error("Conversation detail is missing.");
    return readDetail(
      this.nodes,
      value,
      revision,
      query.offset,
      query.maxBytes
    );
  }

  metadataDetail(
    query: ConversationHistoryMetadataDetailQuery
  ): ConversationHistoryDetailResult {
    const { revision } = this.version(query);
    if (revision !== query.expectedRevision)
      throw new Error(
        "Conversation changed while reading its metadata; reload the session."
      );
    const row = this.sql
      .get(
        "SELECT metadata_ref FROM sessions WHERE scope_key = ? AND session_id = ?"
      )
      .get(query.key, query.sessionId);
    if (!row?.metadata_ref) {
      if (query.path.length)
        throw new Error("Conversation metadata field is missing.");
      return {
        revision,
        encoding: "json",
        chunk: "{}".slice(query.offset ?? 0),
        nextOffset: null,
        totalBytes: 2
      };
    }
    const value = this.nodes.get(
      JSON.parse(String(row.metadata_ref)) as ValueRef,
      query.path
    );
    if (!value) throw new Error("Conversation metadata field is missing.");
    return readDetail(
      this.nodes,
      value,
      revision,
      query.offset,
      query.maxBytes
    );
  }

  turns(query: ConversationHistoryTurnsQuery): ConversationHistoryTurnsResult {
    const { revision } = this.version(query);
    const limit = query.limit ?? 200;
    const rows = this.sql
      .get(
        "SELECT message_id, position, preview FROM messages WHERE scope_key = ? AND session_id = ? AND role = 'user' AND position > ? ORDER BY position LIMIT ?"
      )
      .all(query.key, query.sessionId, query.afterPosition ?? -1, limit + 1);
    const turns = rows.slice(0, limit).map((row) => ({
      messageId: String(row.message_id),
      position: Number(row.position),
      preview: String(row.preview)
    }));
    return {
      revision,
      turns,
      nextPosition: rows.length > limit ? turns.at(-1)!.position : null
    };
  }
}
