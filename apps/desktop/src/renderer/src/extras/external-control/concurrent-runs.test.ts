import type { ExternalWindowRequest } from "@deepwrite/contracts";
import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { AgentConversationController } from "../../composables/useAgentConversation";
import { systemEventCenter } from "../../events/systemEventCenter";
import { useExternalControlBridge } from "./useExternalControlBridge";

function channel(id: string) {
  const messages = ref<Record<string, unknown>[]>([]);
  const activeRunId = ref<string | null>(null);
  const busy = ref(false);
  const draft = ref("");
  const sessionId = ref(`session-${id}`);
  const controller = {
    messages,
    activeRunId,
    draft,
    sessionId,
    pendingUserInput: ref(null),
    conversationError: ref(null),
    isBusy: computed(() => busy.value),
    overrideNextApprovalMode: vi.fn(),
    overrideNextAgentTeamMode: vi.fn(),
    newConversation: vi.fn(async () => {
      sessionId.value = `new-${id}`;
      messages.value = [];
    }),
    openConversation: vi.fn(
      async (session: string) => session === sessionId.value
    ),
    stopGeneration: vi.fn(async () => {
      messages.value.at(-1)!.status = "stopped";
      activeRunId.value = null;
      busy.value = false;
      return true;
    })
  } as unknown as AgentConversationController;
  return { controller, messages, draft, activeRunId, busy, sessionId };
}

describe("external runs across books", () => {
  it("serializes setup, runs five books independently, and continues a session", async () => {
    const books = Array.from({ length: 5 }, (_, i) => channel(String(i)));
    let selected = 0;
    const responded = new Map<string, Record<string, unknown>>();
    const opened: string[] = [];
    let unblock!: () => void;
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    let first = true;
    const dispose = useExternalControlBridge({
      api: () =>
        ({
          externalControl: {
            respond: async (r: Record<string, unknown>) => {
              responded.set(String(r.requestId), r);
            }
          }
        }) as never,
      open: async (target) => {
        selected = Number(target.id);
        opened.push(target.id);
        return true;
      },
      conversation: () => books[selected]!.controller,
      conversationsRestored: async () => undefined,
      sendReady: () => true,
      teamAvailable: () => true,
      longEditorHasUnsavedChanges: () => false,
      send: async () => {
        const book = books[selected]!;
        const prompt = book.draft.value;
        book.draft.value = "";
        if (first) {
          first = false;
          await gate;
        }
        const runId = `internal-${selected}-${book.messages.value.length}`;
        book.messages.value.push(
          { id: `user-${runId}`, role: "user", content: prompt },
          {
            id: `reply-${runId}`,
            runId,
            role: "assistant",
            content: `reply-${selected}`,
            status: "streaming"
          }
        );
        book.activeRunId.value = runId;
        book.busy.value = true;
      }
    });
    let sequence = 0;
    const ask = async (payload: ExternalWindowRequest) => {
      const id = `parallel-${++sequence}`;
      systemEventCenter.publish({
        protocolVersion: 1,
        id,
        type: "externalControl.window_request",
        timestamp: new Date().toISOString(),
        context: { correlationId: id },
        payload
      });
      await vi.waitFor(() => expect(responded.has(id)).toBe(true));
      const response = responded.get(id)!;
      expect(response.ok).toBe(true);
      return response.result as {
        runId: string;
        sessionId: string;
        status: string;
        reply: string;
      };
    };
    try {
      const starts = books.map((_, i) =>
        ask({
          action: "start_run",
          target: { kind: "short", id: String(i) },
          message: `book-${i}`,
          newConversation: true
        })
      );
      await vi.waitFor(() => expect(opened).toEqual(["0"]));
      // Draft clearing is not acceptance: another setup must not navigate yet.
      expect(books[0]!.activeRunId.value).toBeNull();
      unblock();
      const runs = await Promise.all(starts);
      expect(opened).toEqual(["0", "1", "2", "3", "4"]);
      expect(books.every((b) => b.busy.value)).toBe(true);
      for (let i = 0; i < runs.length; i++) {
        expect(
          await ask({ action: "run_status", runId: runs[i]!.runId })
        ).toMatchObject({
          status: "running",
          reply: `reply-${i}`,
          sessionId: `new-${i}`,
          workId: String(i)
        });
      }
      await ask({ action: "stop_run", runId: runs[1]!.runId });
      expect(books[1]!.busy.value).toBe(false);
      expect(books[0]!.busy.value).toBe(true);
      const next = await ask({
        action: "start_run",
        target: { kind: "short", id: "1" },
        sessionId: runs[1]!.sessionId,
        message: "下一阶段"
      });
      expect(next.sessionId).toBe(runs[1]!.sessionId);
      expect(books[1]!.controller.newConversation).toHaveBeenCalledTimes(1);
      expect(
        await ask({ action: "run_status", runId: runs[1]!.runId })
      ).toMatchObject({ status: "stopped" });
    } finally {
      unblock();
      dispose();
    }
  });
});
