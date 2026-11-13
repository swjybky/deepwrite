import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, markRaw, nextTick, ref } from "vue";
import { revealTextareaOffset } from "../utils/textareaMirror";
import { useEditorFindReplace } from "./useEditorFindReplace";
import type { RichMarkdownBridge } from "../utils/richMarkdownBridge";

vi.mock("../ui-feedback", () => ({
  uiMessage: { info: vi.fn(), success: vi.fn() }
}));
vi.mock("../utils/textareaMirror", () => ({ revealTextareaOffset: vi.fn() }));

// 你0好1，2世3界4。5他6说7你8好9。10你11好12
const TEXT = "你好，世界。他说你好。你好";
const scopes: ReturnType<typeof effectScope>[] = [];

function key(
  value: string,
  modifiers: Partial<KeyboardEvent> = {}
): KeyboardEvent {
  return {
    key: value,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    preventDefault: vi.fn(),
    ...modifiers
  } as unknown as KeyboardEvent;
}

function setup(preview?: RichMarkdownBridge) {
  const ownerDocument = { activeElement: null as unknown };
  const content = ref(TEXT);
  const editor = {
    ownerDocument,
    selectionStart: 0,
    selectionEnd: 0,
    setSelectionRange: vi.fn((start: number, end: number) => {
      editor.selectionStart = start;
      editor.selectionEnd = end;
    }),
    focus: vi.fn(() => {
      ownerDocument.activeElement = editor;
    }),
    getBoundingClientRect: () => ({ top: 100 })
  };
  const findInput = {
    focus: vi.fn(() => {
      ownerDocument.activeElement = findInput;
    }),
    select: vi.fn()
  };
  const panel = {
    ownerDocument,
    contains: (node: unknown) => node === findInput,
    getBoundingClientRect: () => ({ bottom: 160 })
  };
  const scope = effectScope();
  scopes.push(scope);
  const showEditor = vi.fn();
  const api = scope.run(() =>
    useEditorFindReplace({
      content: () => content.value,
      readOnly: () => false,
      editorInput: () => editor as unknown as HTMLTextAreaElement,
      preview: () => preview,
      showEditor,
      replaceContent: (nextContent) => {
        content.value = nextContent;
      },
      undo: vi.fn(),
      redo: vi.fn()
    })
  )!;
  // DOM elements are never proxied by Vue; keep the stand-ins raw as well.
  api.findInput.value = markRaw(findInput) as unknown as HTMLInputElement;
  api.findPanelElement.value = markRaw(panel) as unknown as HTMLElement;
  return { api, content, editor, findInput, ownerDocument, showEditor };
}

async function settle(): Promise<void> {
  await nextTick();
  await nextTick();
}

async function search(api: ReturnType<typeof setup>["api"], query: string) {
  await api.toggleFindPanel("find");
  api.searchQuery.value = query;
  api.handleFindInput();
  await settle();
}

afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.clearAllMocks();
});

describe("editor find and replace", () => {
  it("searches and replaces in the rendered preview without switching mode or taking focus from the find field", async () => {
    const preview = {
      selection: () => ({ start: 8, end: 8 }),
      select: vi.fn(),
      focus: vi.fn(),
      hasFocus: () => false
    };
    const { api, content, editor, showEditor, findInput, ownerDocument } =
      setup(preview);
    await search(api, "你好");
    expect(showEditor).not.toHaveBeenCalled();
    expect(editor.setSelectionRange).not.toHaveBeenCalled();
    expect(preview.select).toHaveBeenCalledWith(8, 10, false);
    expect(ownerDocument.activeElement).toBe(findInput);
    api.replacementText.value = "您好";
    api.replaceCurrentMatch();
    await settle();
    expect(content.value).toBe("你好，世界。他说您好。你好");
    expect(showEditor).not.toHaveBeenCalled();
    api.dismissFindPanel();
    expect(preview.focus).toHaveBeenCalledOnce();
  });
  it("selects matches without taking focus from the find field", async () => {
    const { api, editor, findInput, ownerDocument } = setup();
    await search(api, "你好");

    expect(editor.setSelectionRange).toHaveBeenCalledWith(0, 2, "forward");
    expect(editor.focus).not.toHaveBeenCalled();
    expect(ownerDocument.activeElement).toBe(findInput);
    expect(vi.mocked(revealTextareaOffset)).toHaveBeenCalledWith(editor, 0, 60);
    expect(api.searchResultLabel.value).toBe("1/3");
  });

  it("clears the active match when the query changes", async () => {
    const { api } = setup();
    await search(api, "你好");
    api.searchQuery.value = "你";
    expect(api.currentMatchIndex.value).toBe(-1);
    expect(api.searchResultLabel.value).toBe("0/3");
  });

  it("continues from the caret after the text is edited in the editor", async () => {
    const { api, content, editor, ownerDocument } = setup();
    await search(api, "你好");

    ownerDocument.activeElement = editor;
    editor.selectionStart = 10;
    content.value = `${TEXT}。`;
    expect(api.searchResultLabel.value).toBe("0/3");

    api.findMatch(1);
    await settle();
    expect(editor.setSelectionRange).toHaveBeenLastCalledWith(
      11,
      13,
      "forward"
    );
    expect(api.searchResultLabel.value).toBe("3/3");
  });

  it("stays open until asked to close and hands focus back to the text", async () => {
    const { api, editor, findInput, ownerDocument } = setup();
    await search(api, "你好");

    ownerDocument.activeElement = editor;
    api.handleEditorKeydown(key("f", { metaKey: true }));
    await settle();
    expect(api.findPanelOpen.value).toBe(true);
    expect(findInput.focus).toHaveBeenCalledTimes(2);

    api.dismissFindPanel();
    expect(api.findPanelOpen.value).toBe(false);
    expect(editor.focus).toHaveBeenCalledOnce();
  });

  it("closes with Escape from the editor", async () => {
    const { api } = setup();
    await api.toggleFindPanel("find");
    const escape = key("Escape");
    api.handleEditorKeydown(escape);
    expect(api.findPanelOpen.value).toBe(false);
    expect(escape.preventDefault).toHaveBeenCalled();
  });

  it("leaves IME keystrokes in the editor alone", async () => {
    const { api } = setup();
    await api.toggleFindPanel("find");
    api.handleEditorKeydown(key("Escape", { isComposing: true }));
    expect(api.findPanelOpen.value).toBe(true);
  });

  it("replaces the current match and moves to the next one", async () => {
    const { api, content, editor } = setup();
    await search(api, "你好");
    api.replacementText.value = "您好";

    api.replaceCurrentMatch();
    await settle();
    expect(content.value).toBe("您好，世界。他说你好。你好");
    expect(editor.setSelectionRange).toHaveBeenLastCalledWith(8, 10, "forward");
    expect(api.searchResultLabel.value).toBe("1/2");
  });
});
