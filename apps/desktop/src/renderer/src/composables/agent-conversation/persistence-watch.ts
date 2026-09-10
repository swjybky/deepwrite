import { watch, type Ref, type WatchSource } from "vue";
import type { ChatMessage } from "../../types/conversation";

export function watchConversationPersistence(
  messages: Ref<ChatMessage[]>,
  fields: WatchSource[],
  onChange: () => void
): () => void {
  // A deep multi-source watcher traverses messages even when only the draft
  // changes. Keep nested message tracking separate from scalar input/settings.
  const stopMessages = watch(messages, onChange, {
    deep: true,
    flush: "sync"
  });
  const stopFields = watch(fields, onChange, { flush: "sync" });
  return () => {
    stopMessages();
    stopFields();
  };
}
