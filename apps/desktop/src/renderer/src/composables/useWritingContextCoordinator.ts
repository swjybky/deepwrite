import { createScopedTranslator } from "../i18n";
import type { DeepWriteApi } from "@deepwrite/contracts/renderer";
import { ref, watch, type Ref } from "vue";
import { formatError } from "../i18n/errors";

const t = createScopedTranslator("workspace.writingContextCoordinator");

export interface WritingContextMutationCompletion {
  succeed(): void;
  fail(): void;
}

export interface WritingContextNotifications {
  success(message: string): void;
  error(message: string): void;
}

export interface WritingContextCoordinatorOptions {
  bookId: Readonly<Ref<string | null>>;
  api: () => DeepWriteApi["catalog"] | undefined;
  notifications: WritingContextNotifications;
}

export function useWritingContextCoordinator(
  options: WritingContextCoordinatorOptions
) {
  const content = ref<string | null>(null);
  const loading = ref(false);
  const pending = ref(false);
  let requestEpoch = 0;

  async function load(bookId: string): Promise<void> {
    const api = options.api();
    if (!api) {
      content.value = null;
      return;
    }
    const epoch = ++requestEpoch;
    loading.value = true;
    try {
      const result = await api.readWritingContext({ bookId });
      if (epoch === requestEpoch && options.bookId.value === bookId) {
        content.value = result.content;
      }
    } catch (error: unknown) {
      if (epoch === requestEpoch && options.bookId.value === bookId) {
        content.value = null;
        options.notifications.error(
          formatError(error, t("failedToReadProjectContext"))
        );
      }
    } finally {
      if (epoch === requestEpoch) loading.value = false;
    }
  }

  watch(
    options.bookId,
    (bookId) => {
      requestEpoch += 1;
      content.value = null;
      loading.value = false;
      if (bookId) void load(bookId);
    },
    { immediate: true }
  );

  async function save(
    nextContent: string,
    completion: WritingContextMutationCompletion
  ): Promise<void> {
    const bookId = options.bookId.value;
    const api = options.api();
    if (!bookId || !api || pending.value) {
      completion.fail();
      return;
    }
    pending.value = true;
    try {
      await api.writeWritingContext({ bookId, content: nextContent });
      if (options.bookId.value === bookId) content.value = nextContent;
      options.notifications.success(t("projectContextSaved"));
      completion.succeed();
    } catch (error: unknown) {
      options.notifications.error(
        formatError(error, t("failedToSaveProjectContext"))
      );
      completion.fail();
    } finally {
      pending.value = false;
    }
  }

  return { content, loading, pending, save };
}
