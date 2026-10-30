import {
  computed,
  effectScope,
  ref,
  shallowRef,
  watch,
  type ComputedRef
} from "vue";
import type {
  PromptTextAttachment,
  UserPromptAttachment
} from "@deepwrite/contracts";
import { createScopedTranslator } from "../../i18n";
import { formatError, getErrorPayload } from "../../i18n/errors";
import { uiMessage } from "../../ui-feedback";
import type { AgentConversationContext } from "./context";
import { id } from "./shared";

const t = createScopedTranslator("workspace.followUpQueue");
const tSend = createScopedTranslator("workspace.sendMessage");

export const FOLLOW_UP_QUEUE_MAX_ITEMS = 5;

/**
 * A message typed while the agent works. `queued` follows the run as the next
 * turn, `steering` was handed to the run for its next model call, and
 * `sending` is being sent as a new turn.
 */
export interface QueuedComposerMessage {
  id: string;
  content: string;
  attachments: UserPromptAttachment[];
  createdAt: string;
  state: "queued" | "steering" | "sending";
  /** The run a steer went to; unset while it waits for the run id. */
  steerRunId?: string;
  /** The user sent it now: it shows in the conversation, not above the composer. */
  sentNow?: boolean;
}

/** Sends one queued message through the coordinator's ordinary send path. */
export type FollowUpDispatcher = (
  attachments: UserPromptAttachment[]
) => Promise<void>;

/** Read by `sendMessage` while a queued message is being sent. */
export interface QueuedDispatch {
  readonly content: string;
  sent: boolean;
  failed: boolean;
  markSent(): void;
}

interface FollowUpQueueState {
  items: QueuedComposerMessage[];
  paused: boolean;
}

export interface FollowUpQueueController {
  items: ComputedRef<readonly QueuedComposerMessage[]>;
  /** Waiting above the composer for the run to end. */
  waitingItems: ComputedRef<readonly QueuedComposerMessage[]>;
  /** Already sent by the user; shown in the conversation until they land. */
  sentItems: ComputedRef<readonly QueuedComposerMessage[]>;
  paused: ComputedRef<boolean>;
  canQueue: ComputedRef<boolean>;
  /** True when a queued message could start a new turn right now. */
  canSendNow: ComputedRef<boolean>;
  reviewPending: ComputedRef<boolean>;
  /** A queued message is on its way out; the draft is not being sent. */
  dispatching: ComputedRef<boolean>;
  /** Moves the draft into the queue; false when the queue is full. */
  enqueue(attachments: UserPromptAttachment[]): boolean;
  /** Removes a queued message so the composer can take it back. */
  withdraw(itemId: string): QueuedComposerMessage | undefined;
  /** Steers the running agent, or sends now when nothing runs. */
  sendNow(itemId: string): void;
  setDispatcher(dispatcher: FollowUpDispatcher | null): void;
  markDelivered(steerId: string): void;
  /** Unsent texts of the current conversation, for folding into the draft. */
  takeTexts(): string[];
  stop(): void;
}

type FollowUpContext = Pick<
  AgentConversationContext,
  | "options"
  | "sessionId"
  | "draft"
  | "messages"
  | "isBusy"
  | "activeRunId"
  | "hasPendingEditReview"
  | "deferredPersistenceSessions"
  | "queuedDispatch"
>;

function textAttachments(item: QueuedComposerMessage): PromptTextAttachment[] {
  return item.attachments
    .filter(
      (attachment): attachment is PromptTextAttachment =>
        attachment.kind === "text"
    )
    .map((attachment) => ({ ...attachment }));
}

export function createFollowUpQueue(
  ctx: FollowUpContext
): FollowUpQueueController {
  const queues = ref<Record<string, FollowUpQueueState>>({});
  const dispatcher = shallowRef<FollowUpDispatcher | null>(null);
  const dispatching = ref(false);
  const current = computed(() => queues.value[ctx.sessionId.value]);
  const items = computed(() => current.value?.items ?? []);
  const paused = computed(() => current.value?.paused ?? false);
  const canSendNewTurn = computed(
    () =>
      Boolean(ctx.options.api()) &&
      !ctx.isBusy.value &&
      !ctx.hasPendingEditReview.value &&
      !ctx.deferredPersistenceSessions.value.has(ctx.sessionId.value) &&
      dispatcher.value !== null &&
      !dispatching.value
  );

  function queueFor(sessionId: string): FollowUpQueueState {
    return (queues.value[sessionId] ??= { items: [], paused: false });
  }

  function remove(sessionId: string, itemId: string): void {
    const queue = queues.value[sessionId];
    if (!queue) return;
    queue.items = queue.items.filter((item) => item.id !== itemId);
    if (!queue.items.length) delete queues.value[sessionId];
  }

  /** Returns undelivered steers to the front, in their original order. */
  function returnToFront(
    queue: FollowUpQueueState,
    returned: QueuedComposerMessage[]
  ): void {
    const ids = new Set(returned.map((item) => item.id));
    for (const item of returned) {
      item.state = "queued";
      delete item.steerRunId;
    }
    queue.items = [
      ...returned,
      ...queue.items.filter((item) => !ids.has(item.id))
    ];
  }

  function submitSteer(item: QueuedComposerMessage, runId: string): void {
    const api = ctx.options.api();
    const sessionId = ctx.sessionId.value;
    const queue = queues.value[sessionId];
    if (!api || !queue) return;
    item.steerRunId = runId;
    const attachments = textAttachments(item);
    api.session
      .steer({
        sessionId,
        runId,
        steerId: item.id,
        message: item.content,
        ...(attachments.length ? { attachments } : {})
      })
      .catch((error: unknown) => {
        const live = queues.value[sessionId]?.items.find(
          (entry) => entry.id === item.id
        );
        if (live?.state !== "steering" || live.steerRunId !== runId) return;
        returnToFront(queues.value[sessionId]!, [live]);
        // A run that just ended takes it as the next turn instead.
        const code = getErrorPayload(error)?.code;
        if (code === "agent.run_not_active" || code === "agent.steering_closed")
          return;
        delete live.sentNow;
        uiMessage.warning(formatError(error, t("steerFailed")));
      });
  }

  /** Nothing leaves on its own while paused, so everything waits in the queue. */
  function pause(queue: FollowUpQueueState): void {
    queue.paused = true;
    for (const item of queue.items) delete item.sentNow;
  }

  async function dispatch(
    sessionId: string,
    item: QueuedComposerMessage
  ): Promise<void> {
    const send = dispatcher.value;
    if (!send || dispatching.value) return;
    dispatching.value = true;
    item.state = "sending";
    const queued: QueuedDispatch = {
      content: item.content,
      sent: false,
      failed: false,
      markSent() {
        queued.sent = true;
        remove(sessionId, item.id);
      }
    };
    ctx.queuedDispatch = queued;
    try {
      await send(item.attachments.map((attachment) => ({ ...attachment })));
    } catch {
      queued.failed = true;
    } finally {
      if (ctx.queuedDispatch === queued) ctx.queuedDispatch = null;
      dispatching.value = false;
    }
    if (queued.sent && !queued.failed) return;
    // Unsent or rejected: keep the words and wait for the user.
    const queue = queueFor(sessionId);
    if (queued.sent) queue.items.unshift({ ...item, state: "queued" });
    else item.state = "queued";
    pause(queue);
  }

  /** A run ended: return missed steers and decide whether to keep following. */
  function settleRun(runId: string): void {
    const sessionId = ctx.sessionId.value;
    const queue = queues.value[sessionId];
    if (!queue) return;
    const missed = queue.items.filter(
      (item) => item.state === "steering" && item.steerRunId === runId
    );
    if (missed.length) returnToFront(queue, missed);
    const reply = ctx.messages.value.find(
      (message) => message.role === "assistant" && message.runId === runId
    );
    if (reply?.status !== "completed") pause(queue);
  }

  const scope = effectScope(true);
  scope.run(() => {
    watch(
      () => ctx.activeRunId.value,
      (next, previous) => {
        if (previous) settleRun(previous);
        if (!next) return;
        for (const item of items.value) {
          if (item.state === "steering" && !item.steerRunId)
            submitSteer(item, next);
        }
      }
    );
    // Busy without a run (history work, a refused send): nothing to steer.
    watch(
      () => ctx.isBusy.value,
      (busy) => {
        const queue = current.value;
        if (busy || !queue) return;
        const waiting = queue.items.filter(
          (item) => item.state === "steering" && !item.steerRunId
        );
        if (waiting.length) returnToFront(queue, waiting);
      }
    );
    watch(
      () =>
        canSendNewTurn.value &&
        !paused.value &&
        items.value.some((item) => item.state === "queued"),
      (ready) => {
        const next = items.value.find((item) => item.state === "queued");
        if (ready && next) void dispatch(ctx.sessionId.value, next);
      }
    );
  });

  return {
    items,
    waitingItems: computed(() => items.value.filter((item) => !item.sentNow)),
    sentItems: computed(() => items.value.filter((item) => item.sentNow)),
    paused,
    canSendNow: canSendNewTurn,
    reviewPending: computed(() => ctx.hasPendingEditReview.value),
    dispatching: computed(() => dispatching.value),
    canQueue: computed(
      () =>
        Boolean(ctx.options.api()) &&
        ctx.isBusy.value &&
        !ctx.deferredPersistenceSessions.value.has(ctx.sessionId.value)
    ),
    enqueue(attachments) {
      const queue = queueFor(ctx.sessionId.value);
      if (queue.items.length >= FOLLOW_UP_QUEUE_MAX_ITEMS) {
        uiMessage.warning(
          t("queueIsFull", { count: FOLLOW_UP_QUEUE_MAX_ITEMS })
        );
        return false;
      }
      const content =
        ctx.draft.value.trim() ||
        (attachments.length
          ? tSend("pleaseReadAndAnalyzeTheAttachmentsIUploaded")
          : "");
      if (!content) return false;
      queue.items.push({
        id: id("steer"),
        content,
        attachments: attachments.map((attachment) => ({ ...attachment })),
        createdAt: new Date().toISOString(),
        state: "queued"
      });
      ctx.draft.value = "";
      return true;
    },
    withdraw(itemId) {
      const sessionId = ctx.sessionId.value;
      const item = queues.value[sessionId]?.items.find(
        (entry) => entry.id === itemId
      );
      if (item?.state !== "queued") return undefined;
      const taken = { ...item, attachments: [...item.attachments] };
      remove(sessionId, itemId);
      return taken;
    },
    sendNow(itemId) {
      const sessionId = ctx.sessionId.value;
      const queue = queues.value[sessionId];
      const item = queue?.items.find((entry) => entry.id === itemId);
      if (!queue || item?.state !== "queued") return;
      if (!ctx.isBusy.value) {
        if (!canSendNewTurn.value) return;
        queue.paused = false;
        item.sentNow = true;
        void dispatch(sessionId, item);
        return;
      }
      if (item.attachments.some((attachment) => attachment.kind === "image"))
        return;
      item.sentNow = true;
      item.state = "steering";
      const runId = ctx.activeRunId.value;
      if (runId) submitSteer(item, runId);
    },
    setDispatcher(next) {
      dispatcher.value = next;
    },
    markDelivered(steerId) {
      remove(ctx.sessionId.value, steerId);
    },
    takeTexts() {
      const sessionId = ctx.sessionId.value;
      const texts = (queues.value[sessionId]?.items ?? [])
        .filter((item) => item.state !== "sending")
        .map((item) => item.content);
      delete queues.value[sessionId];
      return texts;
    },
    stop() {
      scope.stop();
    }
  };
}
