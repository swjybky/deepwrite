import { getErrorPayload } from "../i18n/errors";
import { nextTick, onBeforeUnmount, watch } from "vue";
import { createScopedTranslator } from "../i18n";
import { uiMessage } from "../ui-feedback";
import {
  bookImageInsertionEdit,
  textareaOffsetToMarkdownSource,
  type MarkdownSourceEdit
} from "../utils/bookImageInsertion";
import { useBookImageContext } from "./bookImageContext";
import { richMarkdownEditorAt } from "../utils/richMarkdownBridge";
import {
  registerTextMenuExtension,
  type TextMenuHistory
} from "./nativeTextContextMenu";
import { deepwriteApi } from "../api/deepwrite";

const t = createScopedTranslator("components.bookImages");

export function useBookImageInsertion(options: {
  documentKey(): string;
  content(): string;
  editable(): boolean;
  history: TextMenuHistory;
  applyEdit(edit: MarkdownSourceEdit): void;
}) {
  const context = useBookImageContext();
  let release: (() => void) | undefined;
  function close(): void {
    release?.();
    release = undefined;
  }
  watch(
    () => [
      options.documentKey(),
      options.content(),
      options.editable(),
      context.value
    ],
    close
  );
  onBeforeUnmount(close);

  function handleContextMenu(event: MouseEvent): void {
    close();
    const current = context.value;
    if (!current || !options.editable()) return;
    const snapshot = options.content();
    const documentKey = options.documentKey();
    const target = event.target;
    const preview =
      target instanceof Element
        ? target.closest<HTMLElement>(".editable-markdown-preview")
        : null;
    const input = target instanceof HTMLTextAreaElement ? target : undefined;
    const block =
      target instanceof Element
        ? target.closest<HTMLElement>("[data-src-end]")
        : null;
    const offset = input
      ? textareaOffsetToMarkdownSource(snapshot, input.selectionEnd)
      : ((target instanceof Element
          ? richMarkdownEditorAt(target)?.selection().end
          : undefined) ??
        (block ? Number(block.dataset.srcEnd) : snapshot.length));
    const sameDocument = () =>
      options.documentKey() === documentKey &&
      options.content() === snapshot &&
      options.editable() &&
      context.value?.book.projectType === current.book.projectType &&
      context.value?.book.projectId === current.book.projectId;
    release = registerTextMenuExtension(event, {
      valid: sameDocument,
      history: options.history,
      insertImage: () => {
        void insert();
      }
    });

    async function insert(): Promise<void> {
      try {
        const api = deepwriteApi()?.bookImages;
        if (!api) {
          uiMessage.error(t("failed"));
          return;
        }
        const result = await api.pick({ book: current!.book });
        if (result.status === "cancelled") return;
        if (result.images.length) {
          if (!sameDocument()) uiMessage.warning(t("changed"));
          else {
            const edit = bookImageInsertionEdit(
              snapshot,
              offset,
              result.images
            );
            options.applyEdit(edit);
            await nextTick();
            if (preview?.isConnected && options.documentKey() === documentKey) {
              const caret = edit.start + edit.text.length;
              richMarkdownEditorAt(preview)?.select(caret, caret);
            }
          }
        }
        if (result.rejected.length) {
          const files = result.rejected
            .map(({ name, code }) => {
              const reason =
                code === "book_image.unsupported_format"
                  ? t("unsupported")
                  : code === "book_image.too_large"
                    ? t("tooLarge")
                    : code === "book_image.invalid_dimensions"
                      ? t("dimensions")
                      : t("failed");
              return t("rejectedFile", { name, reason });
            })
            .join(t("rejectedSeparator"));
          uiMessage.warning(t("rejected", { files }));
        }
      } catch (cause) {
        const error = getErrorPayload(cause);
        const message =
          error?.code === "book_image.too_large"
            ? error.message
            : error?.code === "book_image.unsupported_format"
              ? t("unsupported")
              : error?.code === "book_image.invalid_dimensions"
                ? t("dimensions")
                : t("failed");
        uiMessage.error(message);
      }
    }
  }
  return { handleContextMenu };
}
