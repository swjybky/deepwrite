import { nextTick, type Ref } from "vue";
import type { UserPromptAttachment } from "@deepwrite/contracts";
import { PROMPT_ATTACHMENT_MAX_ITEMS } from "@deepwrite/contracts/renderer";
import { uiMessage } from "../ui-feedback";
import type { QueuedComposerMessage } from "./agent-conversation/follow-up-queue";

/** Takes a queued message back into the composer so it can be edited. */
export function useComposerQueue(options: {
  draft: () => string;
  emitDraft: (value: string) => void;
  input: Ref<HTMLTextAreaElement | undefined>;
  pendingAttachments: Ref<UserPromptAttachment[]>;
  take: (itemId: string) => QueuedComposerMessage | undefined;
  tooManyAttachments: () => string;
}) {
  function withdraw(item: QueuedComposerMessage): void {
    if (
      options.pendingAttachments.value.length + item.attachments.length >
      PROMPT_ATTACHMENT_MAX_ITEMS
    ) {
      uiMessage.warning(options.tooManyAttachments());
      return;
    }
    const taken = options.take(item.id);
    if (!taken) return;
    options.pendingAttachments.value = [
      ...taken.attachments,
      ...options.pendingAttachments.value
    ];
    const draft = options.draft();
    options.emitDraft(
      draft.trim() ? `${taken.content}\n${draft}` : taken.content
    );
    void nextTick(() => {
      const input = options.input.value;
      if (!input) return;
      input.focus();
      input.setSelectionRange(taken.content.length, taken.content.length);
    });
  }
  return { withdraw };
}
