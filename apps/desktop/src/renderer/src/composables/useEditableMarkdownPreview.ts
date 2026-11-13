import { onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import type { MarkdownSourceEdit } from "../utils/bookImageInsertion";
import type { RichMarkdownOptions } from "../utils/richMarkdown/editor";

interface PreviewEmit {
  (event: "edit", edit: MarkdownSourceEdit): void;
  (event: "compositionChange", composing: boolean): void;
  (event: "undo"): void;
  (event: "redo"): void;
  (event: "keydown", keyboardEvent: KeyboardEvent): void;
}
export interface EditableMarkdownPreviewProps {
  content: string;
  editable: boolean;
  documentKey?: string | undefined;
  resolveImage?: ((path: string) => string | undefined) | undefined;
  annotateHeadings?: boolean;
  maxLength?: number | undefined;
}
export function useEditableMarkdownPreview(
  props: Readonly<EditableMarkdownPreviewProps>,
  emit: PreviewEmit,
  root: Ref<HTMLElement | null>,
  host: Ref<HTMLElement | null>,
  label: () => string
) {
  const ready = ref(false);
  let disposed = false;
  let editor:
    | ReturnType<
        typeof import("../utils/richMarkdown/editor").createRichMarkdownEditor
      >
    | undefined;
  const options = (): RichMarkdownOptions => ({
    ...props,
    label: label(),
    edit: (edit) => emit("edit", edit),
    composing: (value) => emit("compositionChange", value),
    undo: () => emit("undo"),
    redo: () => emit("redo"),
    keydown: (event) => emit("keydown", event)
  });
  onMounted(async () => {
    const { createRichMarkdownEditor } =
      await import("../utils/richMarkdown/editor");
    if (disposed || !host.value || !root.value) return;
    editor = createRichMarkdownEditor(host.value, root.value, options());
    ready.value = true;
  });
  watch(
    () => [
      props.content,
      props.editable,
      props.documentKey,
      props.resolveImage,
      props.annotateHeadings,
      props.maxLength,
      label()
    ],
    () => editor?.update(options()),
    { flush: "post" }
  );
  onBeforeUnmount(() => {
    disposed = true;
    editor?.destroy();
  });
  return { ready };
}
