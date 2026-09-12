import { watch, type WatchSource } from "vue";
import type { TrackedMessages, MessageMutation } from "./message-mutations";

export function watchConversationPersistence(
  messages: TrackedMessages,
  fields: WatchSource[],
  onChange: (mutation?: MessageMutation) => void
): () => void {
  const stopMessages = messages.subscribe(onChange);
  const stopFields = watch(fields, () => onChange(), { flush: "sync" });
  return () => {
    stopMessages();
    stopFields();
  };
}
