import {
  EditorState,
  Plugin,
  TextSelection,
  type Transaction
} from "prosemirror-state";
import { EditorView, Decoration, DecorationSet } from "prosemirror-view";
import { tableEditing } from "prosemirror-tables";
import { RichMarkdownSource } from "./source";
import { richMarkdownKeymap } from "./keymap";
import { richMarkdownInputRules } from "./inputRules";
import { imageEditingPlugin } from "./imageEditing";
import { registerRichMarkdownEditor } from "../richMarkdownBridge";
import type { MarkdownSourceEdit } from "../bookImageInsertion";
import { useEditorComposition } from "../../composables/useEditorComposition";

export interface RichMarkdownOptions {
  content: string;
  editable: boolean;
  documentKey?: string | undefined;
  annotateHeadings?: boolean | undefined;
  maxLength?: number | undefined;
  resolveImage?: ((path: string) => string | undefined) | undefined;
  label: string;
  edit(edit: MarkdownSourceEdit): void;
  composing(value: boolean): void;
  undo(): void;
  redo(): void;
  keydown(event: KeyboardEvent): void;
}
function sourceEdit(before: string, after: string): MarkdownSourceEdit {
  let start = 0,
    end = before.length,
    afterEnd = after.length;
  while (start < end && start < afterEnd && before[start] === after[start])
    start += 1;
  while (
    end > start &&
    afterEnd > start &&
    before[end - 1] === after[afterEnd - 1]
  ) {
    end -= 1;
    afterEnd -= 1;
  }
  return { start, end, text: after.slice(start, afterEnd) };
}
export function createRichMarkdownEditor(
  host: HTMLElement,
  root: HTMLElement,
  initial: RichMarkdownOptions
) {
  let options = initial;
  let source = new RichMarkdownSource(
    options.content,
    Boolean(options.resolveImage)
  );
  let content = options.content;
  let pending: {
    type: string;
    timestamp: number;
    selection: { start: number; end: number };
  } | null = null;
  let compositionTimer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  let view: EditorView;
  const composition = useEditorComposition({
    onChange: (value) => options.composing(value)
  });
  function selection() {
    return {
      start: source.offset(view.state.doc, view.state.selection.from),
      end: source.offset(
        view.state.doc,
        view.state.selection.to,
        !view.state.selection.empty
      )
    };
  }
  function commit() {
    if (!options.editable || destroyed) return;
    const next = source.serialize(view.state.doc);
    if (next === content) {
      pending = null;
      return;
    }
    const edit = sourceEdit(content, next);
    const after = selection(),
      input = pending;
    content = next;
    pending = null;
    options.edit({
      ...edit,
      input: {
        inputType: input?.type ?? "",
        timestamp: input?.timestamp ?? performance.now(),
        selectionBefore: input?.selection ?? {
          start: edit.start,
          end: edit.end
        },
        selectionAfter: after
      }
    });
  }
  function remember(type: string, timestamp: number) {
    if (!pending) pending = { type, timestamp, selection: selection() };
  }
  function imageView(node: import("prosemirror-model").Node) {
    const figure = host.ownerDocument.createElement("figure");
    figure.className = "markdown-image";
    figure.contentEditable = "false";
    figure.dataset.imagePath = String(node.attrs.src);
    const image = host.ownerDocument.createElement("img");
    image.alt = String(node.attrs.alt ?? "");
    image.loading = "lazy";
    const url = options.resolveImage?.(String(node.attrs.src));
    if (url) image.src = url;
    figure.append(image);
    return { dom: figure };
  }
  function decorations(current: EditorState) {
    let heading = 0;
    return DecorationSet.create(
      current.doc,
      source.blocks(current.doc).map((block) => {
        const attributes: Record<string, string> = {
          class: "editable-markdown-block",
          "data-src-start": String(block.start),
          "data-src-end": String(block.end)
        };
        if (options.annotateHeadings && block.node.type.name === "heading")
          attributes["data-markdown-heading-index"] = String(heading++);
        return Decoration.node(
          block.position,
          block.position + block.node.nodeSize,
          attributes
        );
      })
    );
  }
  function state(document = source.document) {
    return EditorState.create({
      doc: document,
      plugins: [
        richMarkdownInputRules(),
        ...richMarkdownKeymap({
          undo() {
            pending = null;
            options.undo();
          },
          redo() {
            pending = null;
            options.redo();
          }
        }),
        tableEditing(),
        imageEditingPlugin(),
        new Plugin({
          filterTransaction(transaction) {
            if (!transaction.docChanged) return true;
            if (!options.editable) return false;
            source.track(transaction);
            return (
              options.maxLength === undefined ||
              source.serialize(transaction.doc).length <= options.maxLength
            );
          },
          state: {
            init: (_config, current) => decorations(current),
            apply: (transaction, previous, _old, current) =>
              transaction.docChanged ? decorations(current) : previous
          },
          props: {
            decorations(current) {
              return this.getState(current) as DecorationSet;
            }
          }
        })
      ]
    });
  }
  function dispatch(transaction: Transaction) {
    const result = view.state.applyTransaction(transaction);
    view.updateState(result.state);
    if (
      result.transactions.some((entry) => entry.docChanged) &&
      !composition.isComposing.value
    )
      commit();
  }
  function createView() {
    return new EditorView(host, {
      state: state(),
      editable: () => options.editable,
      attributes: {
        class: "editable-markdown-document",
        "aria-label": options.label,
        spellcheck: "false"
      },
      nodeViews: { image: imageView },
      dispatchTransaction: dispatch,
      handleKeyDown(_view, event) {
        if (event.isComposing || composition.isComposing.value) return false;
        if (event.key === "Enter") remember("insertParagraph", event.timeStamp);
        // History is owned by the parent; do not also invoke its shortcut handler.
        if (
          (event.metaKey || event.ctrlKey) &&
          ["z", "y"].includes(event.key.toLowerCase())
        )
          return false;
        options.keydown(event);
        return event.defaultPrevented;
      },
      handleClick(_view, _position, event) {
        if (
          event.target instanceof Element &&
          event.target.closest("a") &&
          !event.metaKey &&
          !event.ctrlKey
        )
          event.preventDefault();
        return false;
      },
      handleDOMEvents: {
        beforeinput(_view, event) {
          if (!options.editable) {
            event.preventDefault();
            return true;
          }
          if (
            event.inputType === "historyUndo" ||
            event.inputType === "historyRedo"
          ) {
            event.preventDefault();
            pending = null;
            if (event.inputType === "historyUndo") options.undo();
            else options.redo();
            return true;
          }
          remember(event.inputType, event.timeStamp);
          if (event.isComposing) composition.start();
          return false;
        },
        compositionstart(_view, event) {
          remember("", event.timeStamp);
          composition.start();
          return false;
        },
        compositionend() {
          clearTimeout(compositionTimer);
          compositionTimer = setTimeout(() => {
            composition.finish(() => {});
            commit();
          }, 0);
          return false;
        },
        drop(_view, event) {
          if (event.dataTransfer?.files.length) {
            event.preventDefault();
            return true;
          }
          return false;
        }
      },
      handlePaste(_view, event) {
        if (event.clipboardData?.files.length) {
          event.preventDefault();
          return true;
        }
        return false;
      }
    });
  }
  view = createView();
  const release = registerRichMarkdownEditor(root, {
    selection,
    select(start, end, focus = true) {
      const closest = (offset: number) =>
        view.state.doc.resolve(source.position(view.state.doc, offset));
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.between(closest(start), closest(end)))
          .scrollIntoView()
      );
      if (focus) view.focus();
    },
    focus: () => view.focus(),
    hasFocus: () => view.hasFocus()
  });
  return {
    update(next: RichMarkdownOptions) {
      const changedDocument = next.documentKey !== options.documentKey;
      const reset =
        changedDocument ||
        next.content !== content ||
        (!next.editable && composition.isComposing.value);
      options = next;
      if (reset) {
        clearTimeout(compositionTimer);
        composition.reset();
        pending = null;
        const old = view.state.doc;
        source = new RichMarkdownSource(
          next.content,
          Boolean(next.resolveImage)
        );
        content = next.content;
        const document = source.document;
        let nextState = state(document);
        if (!changedDocument && view.hasFocus()) {
          const difference = old.content.findDiffEnd(document.content);
          const position = Math.min(
            document.content.size,
            difference?.b ?? view.state.selection.head
          );
          nextState = nextState.apply(
            nextState.tr.setSelection(
              TextSelection.near(document.resolve(position))
            )
          );
        }
        if (changedDocument) {
          view.destroy();
          view = createView();
        } else view.updateState(nextState);
      }
      view.setProps({
        editable: () => options.editable,
        attributes: {
          class: "editable-markdown-document",
          "aria-label": options.label,
          spellcheck: "false"
        }
      });
    },
    destroy() {
      destroyed = true;
      clearTimeout(compositionTimer);
      composition.reset();
      release();
      view.destroy();
    }
  };
}
