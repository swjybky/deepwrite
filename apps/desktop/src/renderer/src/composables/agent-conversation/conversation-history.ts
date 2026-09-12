import { computed, type Ref } from "vue";
import type {
  ChatMessage,
  ConversationHistoryItem
} from "../../types/conversation";
import type { AgentConversationPersistenceRecord } from "./types";

export function compactConversationText(value: string, limit: number): string {
  // History previews need only a prefix. Do not normalize a multi-MiB reply
  // again on every streamed tail update just to display its first 76 characters.
  let compact = "";
  let space = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (/\s/.test(character)) {
      space = compact.length > 0;
      continue;
    }
    if (space) compact += " ";
    space = false;
    compact += character;
    if (compact.length > limit) return `${compact.slice(0, limit - 1)}…`;
  }
  return compact;
}

function summarizeMessages(messages: readonly ChatMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user");
  let lastVisibleMessage: ChatMessage | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.content.trim()) {
      lastVisibleMessage = message;
      break;
    }
  }
  return {
    title: compactConversationText(
      firstUserMessage?.content ?? "未命名对话",
      42
    ),
    preview: lastVisibleMessage
      ? compactConversationText(lastVisibleMessage.content, 76)
      : undefined,
    messageCount: messages.length,
    turnCount: messages.filter((message) => message.role === "user").length
  };
}

export function historyItemFor(
  conversation: AgentConversationPersistenceRecord,
  currentSessionId: string
): ConversationHistoryItem {
  const summary = summarizeMessages(conversation.messages);
  return {
    ...summary,
    sessionId: conversation.sessionId,
    preview: summary.preview ?? compactConversationText(conversation.draft, 76),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    current: conversation.sessionId === currentSessionId
  };
}

export function createConversationHistory(options: {
  messages: Readonly<Ref<ChatMessage[]>>;
  draft: Readonly<Ref<string>>;
  sessionId: Readonly<Ref<string>>;
  createdAt: Readonly<Ref<string>>;
  updatedAt: Readonly<Ref<string>>;
  storedConversations: Readonly<Ref<AgentConversationPersistenceRecord[]>>;
  remoteHistoryItems?: Readonly<Ref<ConversationHistoryItem[]>>;
}) {
  // Draft and timestamp changes must not scan messages or clone proposal state.
  // Only message fields used by the visible summary invalidate this cache.
  const activeSummary = computed(() =>
    summarizeMessages(options.messages.value)
  );
  const storedHistory = computed(() =>
    options.storedConversations.value
      .filter(
        (conversation) => conversation.sessionId !== options.sessionId.value
      )
      .map((conversation) =>
        historyItemFor(conversation, options.sessionId.value)
      )
  );

  return computed<ConversationHistoryItem[]>(() => {
    const summary = activeSummary.value;
    const byId = new Map(
      (options.remoteHistoryItems?.value ?? []).map((item) => [
        item.sessionId,
        { ...item, current: item.sessionId === options.sessionId.value }
      ])
    );
    for (const item of storedHistory.value) byId.set(item.sessionId, item);
    const history = [...byId.values()].filter(
      (item) =>
        item.sessionId !== options.sessionId.value && item.messageCount > 0
    );
    if (summary.messageCount > 0) {
      history.push({
        ...summary,
        sessionId: options.sessionId.value,
        preview:
          summary.preview ?? compactConversationText(options.draft.value, 76),
        createdAt: options.createdAt.value,
        updatedAt: options.updatedAt.value,
        current: true
      });
    }
    return history.sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    );
  });
}
