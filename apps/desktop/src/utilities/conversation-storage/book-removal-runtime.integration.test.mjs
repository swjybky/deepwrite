import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationDatabase } from "./database";
import { LegacyConversationStore } from "./legacy-store";
import {
  disposeLongBookRemovalRuntime,
  disposeShortBookRemovalRuntime
} from "../../renderer/src/composables/book-removal-runtime";
import { conversationHistoryPersistenceKey } from "../../renderer/src/utils/conversationPersistenceKeys";
import {
  longBookConversationKey,
  shortBookConversationKey
} from "../../renderer/src/utils/bookConversationKey";
const databases = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));
describe("stable book identity after unregister", () => {
  it.each(["short", "long"])(
    "reopens the same %s manifest and saves more history after runtime disposal",
    async (kind) => {
      const database = new ConversationDatabase(":memory:");
      databases.push(database);
      const legacy = new LegacyConversationStore(database.database);
      const manifest = { id: "fixture-book" };
      const keyFor = () =>
        conversationHistoryPersistenceKey(
          kind === "long"
            ? longBookConversationKey(manifest.id)
            : shortBookConversationKey(manifest.id)
        );
      const key = keyFor();
      database.commit({
        key,
        sessionId: "session",
        expectedRevision: 0,
        generation: 0,
        sequence: 1,
        batchId: "before-unregister",
        operations: [
          {
            type: "putMessage",
            messageId: "message",
            position: 0,
            value: { role: "user", content: "移出前已确认的正文" }
          }
        ]
      });
      const dispose = vi.fn(async (_bookId, options) => {
        if (options.clearPersistence) legacy.remove(key);
      });
      const remove = (action) =>
        kind === "long"
          ? disposeLongBookRemovalRuntime({
              bookId: manifest.id,
              action,
              workflow: { disposeBookProposalState: vi.fn() },
              conversations: { disposeBookConversations: dispose }
            })
          : disposeShortBookRemovalRuntime({
              bookId: manifest.id,
              action,
              conversations: {
                disposeBook: dispose,
                removeRunPreferences: vi.fn()
              },
              clearEditorState: vi.fn()
            });
      expect(await remove("unregister")).toBeUndefined();
      expect(dispose).toHaveBeenLastCalledWith(manifest.id, {
        clearPersistence: false
      });
      const reopenedKey = keyFor();
      expect(reopenedKey).toBe(key);
      expect(
        database.mergeScopes({ key: reopenedKey, sources: [] }).activeSessionId
      ).toBe("session");
      const state = database.session({
        key: reopenedKey,
        sessionId: "session"
      });
      database.commit({
        key: reopenedKey,
        sessionId: "session",
        expectedRevision: state.revision,
        generation: state.generation,
        sequence: 2,
        batchId: "after-reopen",
        operations: [
          {
            type: "patchMessage",
            messageId: "message",
            changes: [
              { op: "append", path: ["content"], text: "，重新打开后继续保存" }
            ]
          }
        ]
      });
      expect(
        database.messages({ key, sessionId: "session" }).messages[0]?.value
          .content
      ).toBe("移出前已确认的正文，重新打开后继续保存");
      expect(await remove("delete")).toBeUndefined();
      expect(dispose).toHaveBeenLastCalledWith(manifest.id, {
        clearPersistence: true
      });
      expect(() =>
        database.commit({
          key,
          sessionId: "late",
          expectedRevision: 0,
          generation: 0,
          sequence: 1,
          batchId: "stale-after-delete",
          operations: [{ type: "setMetadata", value: {} }]
        })
      ).toThrow("removed");
    }
  );
});
