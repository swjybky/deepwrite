type MaybePromise = void | Promise<void>;
export interface ConversationDisposalOptions {
  clearPersistence: boolean;
}
type RemovalAction = "remove" | "unregister" | "delete";

/** Unregistering a folder keeps its stable manifest identity and its recoverable history. */
export async function disposeShortBookRemovalRuntime(options: {
  bookId: string;
  action: RemovalAction;
  conversations: {
    disposeBook(
      bookId: string,
      options: ConversationDisposalOptions
    ): MaybePromise;
    removeRunPreferences(scope: string): MaybePromise;
  };
  clearEditorState(): void;
}): Promise<unknown> {
  let error: unknown;
  try {
    await options.conversations.disposeBook(options.bookId, {
      clearPersistence: options.action === "delete"
    });
  } catch (failure: unknown) {
    error = failure;
  }
  try {
    await options.conversations.removeRunPreferences(`book:${options.bookId}`);
  } catch (failure: unknown) {
    error ??= failure;
  }
  options.clearEditorState();
  return error;
}

export async function disposeLongBookRemovalRuntime(options: {
  bookId: string;
  action: RemovalAction;
  workflow: { disposeBookProposalState(bookId: string): MaybePromise };
  conversations: {
    disposeBookConversations(
      bookId: string,
      options: ConversationDisposalOptions
    ): MaybePromise;
  };
}): Promise<unknown> {
  let error: unknown;
  try {
    await options.workflow.disposeBookProposalState(options.bookId);
  } catch (failure: unknown) {
    error = failure;
  }
  try {
    await options.conversations.disposeBookConversations(options.bookId, {
      clearPersistence: options.action === "delete"
    });
  } catch (failure: unknown) {
    error ??= failure;
  }
  return error;
}
