import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref
} from "vue";
import type { ChatMessage } from "../types/conversation";
import { createConversationViewportAnchor } from "./conversationViewportAnchor";

export interface ConversationTurn {
  id: string;
  number: number;
  prompt: string;
  response: string | undefined;
}

interface ConversationTurnNavigatorOptions {
  messages: () => readonly ChatMessage[];
  currentSessionId: () => string;
  scroller: Ref<HTMLElement | undefined>;
  messageList: Ref<HTMLElement | undefined>;
  beforeNavigate: () => void;
  followsTail?: () => boolean;
}

function compactConversationText(
  content: string,
  fallback: string,
  maxLength: number
): string {
  const compact = content
    .slice(0, 2_400)
    .replace(/```[\s\S]*?```/g, " 代码片段 ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " 图片 ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[`*_~>#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const text = compact || fallback;
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function promptFallback(message: ChatMessage): string {
  const attachmentNames = message.attachments
    ?.map((attachment) => attachment.name)
    .filter(Boolean)
    .join("、");
  return attachmentNames ? `附件：${attachmentNames}` : "无文字消息";
}

export function buildConversationTurns(
  messages: readonly ChatMessage[]
): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let pendingTurn: ConversationTurn | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      pendingTurn = {
        id: message.id,
        number: turns.length + 1,
        prompt: compactConversationText(
          message.content,
          promptFallback(message),
          72
        ),
        response: undefined
      };
      turns.push(pendingTurn);
    } else if (
      pendingTurn &&
      message.role === "assistant" &&
      /\S/.test(message.content)
    ) {
      pendingTurn.response = compactConversationText(message.content, "", 132);
      pendingTurn = undefined;
    }
  }
  return turns;
}

export function useConversationTurnNavigator(
  options: ConversationTurnNavigatorOptions
) {
  const activeTurnId = ref<string | null>(null);
  const turns = computed(() => buildConversationTurns(options.messages()));
  let updateFrame: number | undefined;
  let resizeObserver: ResizeObserver | undefined;
  const viewportAnchor = createConversationViewportAnchor({
    container: () => options.scroller.value,
    element: (id) => messageElements.get(id),
    followsTail: () => options.followsTail?.() ?? false,
    onSettled: scheduleActiveTurnUpdate
  });

  const messageElements = new Map<string, HTMLElement>();
  let turnElements: HTMLElement[] = [];

  function rebuildElementIndex(): void {
    messageElements.clear();
    const elements = options.messageList.value?.querySelectorAll<HTMLElement>(
      ".message[data-conversation-message-id]"
    );
    for (const element of elements ?? []) {
      const id = element.dataset.conversationMessageId;
      if (id) messageElements.set(id, element);
    }
    turnElements = turns.value.flatMap((turn) => {
      const element = messageElements.get(turn.id);
      return element ? [element] : [];
    });
  }

  function updateActiveTurn(): void {
    const container = options.scroller.value;
    if (!container || !turnElements.length) {
      activeTurnId.value = null;
      return;
    }
    const focusLine =
      container.getBoundingClientRect().top + container.clientHeight * 0.34;
    // DOM order follows turn order. Read only log(n) positions, using current
    // geometry so font changes and expanded details need no stale height cache.
    let low = 0;
    let high = turnElements.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (turnElements[middle]!.getBoundingClientRect().top <= focusLine)
        low = middle + 1;
      else high = middle;
    }
    const activeElement = turnElements[Math.max(0, low - 1)];
    activeTurnId.value = activeElement?.dataset.conversationMessageId ?? null;
    if (activeElement && activeTurnId.value)
      viewportAnchor.capture(
        activeTurnId.value,
        activeElement.getBoundingClientRect().top -
          container.getBoundingClientRect().top
      );
  }

  function scheduleActiveTurnUpdate(): void {
    if (updateFrame !== undefined) return;
    updateFrame = globalThis.requestAnimationFrame(() => {
      updateFrame = undefined;
      updateActiveTurn();
    });
  }

  function scrollToTurn(messageId: string): void {
    const container = options.scroller.value;
    const element = messageElements.get(messageId);
    if (!container || !element) return;
    viewportAnchor.cancel();
    options.beforeNavigate();
    activeTurnId.value = messageId;
    const targetTop =
      container.scrollTop +
      element.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      22;
    const reduceMotion = globalThis.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const longJump =
      Math.abs(targetTop - container.scrollTop) > container.clientHeight * 3 ||
      !!options.messageList.value?.querySelector?.(
        ".conversation-message-group.is-deferred"
      );
    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: reduceMotion || longJump ? "auto" : "smooth"
    });
  }

  function handleResize(): void {
    viewportAnchor.resize();
    scheduleActiveTurnUpdate();
  }

  async function observeCurrentElements(): Promise<void> {
    await nextTick();
    rebuildElementIndex();
    viewportAnchor.connect();
    resizeObserver?.disconnect();
    if (!resizeObserver) return;
    if (options.scroller.value) resizeObserver.observe(options.scroller.value);
    if (options.messageList.value) {
      resizeObserver.observe(options.messageList.value);
    }
    updateActiveTurn();
  }

  onMounted(() => {
    resizeObserver = new ResizeObserver(handleResize);
    void observeCurrentElements();
  });

  watch(
    () => [
      options.currentSessionId(),
      options.messageList.value,
      options.scroller.value,
      ...options.messages().map((message) => message.id)
    ],
    () => void observeCurrentElements()
  );

  onBeforeUnmount(() => {
    if (updateFrame !== undefined) {
      globalThis.cancelAnimationFrame(updateFrame);
    }
    resizeObserver?.disconnect();
    viewportAnchor.dispose();
  });

  return {
    activeTurnId,
    scheduleActiveTurnUpdate,
    scrollToTurn,
    turns
  };
}
