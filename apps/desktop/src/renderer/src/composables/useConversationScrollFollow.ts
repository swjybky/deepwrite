import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { LongWorkspaceProposalItem } from "./useLongWorkspaceProposals";
import type { ChatMessage } from "../types/conversation";
import { createTransientScrollbarController } from "../utils/transientScrollbar";
import { lastAssistantMessage } from "../utils/conversationMessageLookup";

const TAIL_FOLLOW_THRESHOLD = 72;

export function useConversationScrollFollow(options: {
  messages: () => ChatMessage[];
  responding: () => boolean;
  currentSessionId?: () => string;
  longProposalItems?: () => readonly LongWorkspaceProposalItem[];
  onScroll?: () => void;
}) {
  const scroller = ref<HTMLElement>();
  const conversationScrollbar = createTransientScrollbarController();
  const followsConversationTail = ref(true);
  const tailFollowLockedForResponse = ref(false);
  let lastConversationScrollTop = 0;
  let scrollFrame: number | undefined;

  function isNearConversationTail(element: HTMLElement): boolean {
    return (
      element.scrollHeight - element.scrollTop - element.clientHeight <=
      TAIL_FOLLOW_THRESHOLD
    );
  }

  function hasActiveConversationResponse(): boolean {
    return (
      options.responding() ||
      options
        .messages()
        .some(
          (message) =>
            message.role === "assistant" && message.status === "streaming"
        )
    );
  }

  function lockConversationTailForCurrentResponse(): void {
    if (!hasActiveConversationResponse()) return;
    tailFollowLockedForResponse.value = true;
    followsConversationTail.value = false;
    if (scrollFrame !== undefined) {
      globalThis.cancelAnimationFrame(scrollFrame);
      scrollFrame = undefined;
    }
  }

  function handleConversationWheel(event: WheelEvent): void {
    if (event.deltaY < 0) lockConversationTailForCurrentResponse();
  }

  function handleConversationScroll(): void {
    const element = scroller.value;
    if (!element) return;
    conversationScrollbar.reveal(element);
    const nextScrollTop = element.scrollTop;
    if (
      hasActiveConversationResponse() &&
      nextScrollTop < lastConversationScrollTop - 1
    ) {
      lockConversationTailForCurrentResponse();
    }
    if (hasActiveConversationResponse()) {
      followsConversationTail.value = !tailFollowLockedForResponse.value;
    } else {
      followsConversationTail.value = isNearConversationTail(element);
    }
    lastConversationScrollTop = nextScrollTop;
    options.onScroll?.();
  }

  function scheduleConversationTailFollow(): void {
    if (!followsConversationTail.value || scrollFrame !== undefined) {
      return;
    }
    scrollFrame = globalThis.requestAnimationFrame(() => {
      scrollFrame = undefined;
      const element = scroller.value;
      if (element && followsConversationTail.value) {
        const tailScrollTop = Math.max(
          0,
          element.scrollHeight - element.clientHeight
        );
        if (Math.abs(element.scrollTop - tailScrollTop) > 1) {
          element.scrollTop = tailScrollTop;
          lastConversationScrollTop = tailScrollTop;
        }
      }
    });
  }

  function resetScrollForSession(): void {
    tailFollowLockedForResponse.value = false;
    followsConversationTail.value = true;
    void nextTick(() => {
      lastConversationScrollTop = scroller.value?.scrollTop ?? 0;
      scheduleConversationTailFollow();
    });
  }

  watch(
    () => {
      const message = options.messages().at(-1);
      return [
        options.messages().length,
        options.responding(),
        message?.id,
        message?.content.length,
        message?.thinking?.length,
        message?.retry
          ? `${message.retry.state}:${message.retry.attempt}:${message.retry.retryAt ?? ""}`
          : "",
        message?.toolCalls
          ?.map(
            (toolCall) =>
              `${toolCall.status}:${toolCall.argumentsText?.length ?? 0}`
          )
          .join(","),
        message?.subagentRuns
          ?.map((run) =>
            [
              run.subagentRunId,
              run.status,
              run.thinking?.length ?? 0,
              run.output?.length ?? 0,
              run.toolCalls
                .map((toolCall) => `${toolCall.id}:${toolCall.status}`)
                .join(";")
            ].join(":")
          )
          .join(","),
        message?.editProposals
          ?.map(
            (proposal) =>
              `${proposal.id}:${proposal.status}:${proposal.updatedAt}`
          )
          .join(","),
        (options.longProposalItems?.() ?? [])
          .map((item) => `${item.event.id}:${item.status}:${item.error ?? ""}`)
          .join(",")
      ].join("|");
    },
    async () => {
      if (!followsConversationTail.value) {
        return;
      }
      await nextTick();
      scheduleConversationTailFollow();
    }
  );

  onMounted(async () => {
    await nextTick();
    lastConversationScrollTop = scroller.value?.scrollTop ?? 0;
    scheduleConversationTailFollow();
  });

  watch(
    () => options.responding(),
    (responding, wasResponding) => {
      if (!responding || wasResponding) return;
      tailFollowLockedForResponse.value = false;
      followsConversationTail.value = true;
      void nextTick(() => {
        scheduleConversationTailFollow();
      });
    }
  );

  watch(
    () => {
      const message = lastAssistantMessage(options.messages());
      return message ? `${message.id}:${message.status ?? "completed"}` : "";
    },
    async (next, previous) => {
      if (
        !tailFollowLockedForResponse.value ||
        !previous.endsWith(":streaming") ||
        next.endsWith(":streaming")
      ) {
        return;
      }
      const element = scroller.value;
      if (!element) return;
      const preservedScrollTop = element.scrollTop;
      await nextTick();
      if (!tailFollowLockedForResponse.value || !scroller.value) return;
      scroller.value.scrollTop = preservedScrollTop;
      lastConversationScrollTop = preservedScrollTop;
    },
    { flush: "pre" }
  );

  watch(() => options.currentSessionId?.(), resetScrollForSession);

  onBeforeUnmount(() => {
    if (scrollFrame !== undefined) globalThis.cancelAnimationFrame(scrollFrame);
    conversationScrollbar.dispose();
  });

  return {
    scroller,
    followsConversationTail,
    tailFollowLockedForResponse,
    lastConversationScrollTop: () => lastConversationScrollTop,
    setLastConversationScrollTop: (value: number) => {
      lastConversationScrollTop = value;
    },
    isNearConversationTail,
    hasActiveConversationResponse,
    lockConversationTailForCurrentResponse,
    handleConversationWheel,
    handleConversationScroll,
    scheduleConversationTailFollow,
    resetScrollForSession
  };
}
