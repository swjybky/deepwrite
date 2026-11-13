import {
  createRenderer,
  defineComponent,
  h,
  nextTick,
  reactive,
  type App
} from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatAssistantProjectRef } from "@deepwrite/contracts";
import { provideBookImageContext } from "./bookImageContext";
import {
  registerTextMenuExtension,
  type TextMenuExtension
} from "./nativeTextContextMenu";
import { useBookImageInsertion } from "./useBookImageInsertion";
import { applyMarkdownSourceEdit } from "../utils/bookImageInsertion";
import { uiMessage } from "../ui-feedback";
import { registerRichMarkdownEditor } from "../utils/richMarkdownBridge";

vi.mock("./nativeTextContextMenu", () => ({
  registerTextMenuExtension: vi.fn(() => vi.fn())
}));
vi.mock("../ui-feedback", () => ({
  uiMessage: { warning: vi.fn(), error: vi.fn() }
}));
const renderer = createRenderer({
  patchProp() {},
  insert() {},
  remove() {},
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText() {},
  setElementText() {},
  parentNode: () => null,
  nextSibling: () => null
});
const apps: App[] = [];
class Surface {
  isConnected = true;
  dataset: Record<string, string> = {};
  closest(_selector: string): Surface | null {
    return null;
  }
  querySelector() {
    return null;
  }
}
class Target extends Surface {
  selectionEnd = 1;
}
const pick = vi.fn();

function setup(
  projectType: ChatAssistantProjectRef["projectType"] | undefined = "short"
) {
  const state = reactive({
    book: projectType ? { projectType, projectId: "book-1" } : undefined,
    key: "doc-1",
    content: "前文\n后文",
    editable: true
  });
  const applyEdit = vi.fn((edit) => {
    state.content = applyMarkdownSourceEdit(state.content, edit);
  });
  let handle!: (event: MouseEvent) => void;
  const app = renderer.createApp(
    defineComponent({
      setup() {
        provideBookImageContext(() =>
          state.book ? { book: state.book } : undefined
        );
        return () =>
          h(
            defineComponent({
              setup() {
                handle = useBookImageInsertion({
                  documentKey: () => state.key,
                  content: () => state.content,
                  editable: () => state.editable,
                  history: {
                    canUndo: () => true,
                    canRedo: () => false,
                    undo() {},
                    redo() {}
                  },
                  applyEdit
                }).handleContextMenu;
                return () => null;
              }
            })
          );
      }
    })
  );
  app.mount({});
  apps.push(app);
  function open(target: Surface = new Target()) {
    handle({ target } as unknown as MouseEvent);
  }
  function extension() {
    return vi.mocked(registerTextMenuExtension).mock
      .lastCall![1] as TextMenuExtension;
  }
  return { state, applyEdit, open, extension };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("HTMLTextAreaElement", Target);
  vi.stubGlobal("Element", Surface);
  vi.stubGlobal("window", { deepwrite: { bookImages: { pick } } });
  pick.mockResolvedValue({
    status: "saved",
    images: [{ path: "images/map-12345678.png", alt: "地图" }],
    rejected: []
  });
});
afterEach(() => {
  apps.splice(0).forEach((app) => app.unmount());
  vi.unstubAllGlobals();
});
async function settle() {
  await Promise.resolve();
  await nextTick();
}

describe("book image insertion context", () => {
  it("inserts after the caret's line in a rendered preview without opening a source block", async () => {
    const editor = setup();
    editor.state.content = "前文\n中间\n后文";
    const root = new Surface(),
      target = new Surface();
    target.closest = (selector) =>
      selector === ".editable-markdown-preview" ? root : null;
    root.closest = () => root;
    const select = vi.fn();
    registerRichMarkdownEditor(root as unknown as HTMLElement, {
      selection: () => ({ start: 4, end: 4 }),
      select,
      focus() {},
      hasFocus: () => true
    });
    editor.open(target);
    editor.extension().insertImage!();
    await settle();
    expect(editor.state.content).toBe(
      "前文\n中间\n\n![地图](images/map-12345678.png)\n\n后文"
    );
    const caret = editor.state.content.indexOf("后文");
    expect(select).toHaveBeenCalledWith(caret, caret);
  });
  it.each(["short", "script", "long"] as const)(
    "enables any editable Markdown document in a %s book",
    async (kind) => {
      const editor = setup(kind);
      editor.open();
      editor.extension().insertImage!();
      await settle();
      expect(pick).toHaveBeenCalledWith({
        book: { projectType: kind, projectId: "book-1" }
      });
      expect(editor.state.content).toBe(
        "前文\n\n![地图](images/map-12345678.png)\n\n后文"
      );
      expect(uiMessage.warning).not.toHaveBeenCalled();
    }
  );
  it.each(["material", "skill"])(
    "offers no image action for a %s document without a book context",
    () => {
      const editor = setup(undefined);
      editor.state.book = undefined;
      editor.open();
      expect(registerTextMenuExtension).not.toHaveBeenCalled();
    }
  );
  it("offers no image action while readonly", () => {
    const editor = setup();
    editor.state.editable = false;
    editor.open();
    expect(registerTextMenuExtension).not.toHaveBeenCalled();
  });
  it.each(["content", "key"] as const)(
    "keeps saved images but inserts no reference if document %s changed during selection",
    async (field) => {
      let complete!: (value: unknown) => void;
      pick.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          })
      );
      const editor = setup();
      editor.open();
      editor.extension().insertImage!();
      editor.state[field] = "已变化";
      complete({
        status: "saved",
        images: [{ path: "images/map-12345678.png", alt: "地图" }],
        rejected: []
      });
      await settle();
      expect(editor.applyEdit).not.toHaveBeenCalled();
      expect(uiMessage.warning).toHaveBeenCalledWith(
        expect.stringContaining("文档已变化")
      );
    }
  );
  it("inserts valid files and lists every rejected file with a reason", async () => {
    pick.mockResolvedValueOnce({
      status: "saved",
      images: [{ path: "images/map-12345678.png", alt: "地图" }],
      rejected: [
        { name: "大图.png", code: "book_image.too_large" },
        { name: "动画.gif", code: "book_image.unsupported_format" }
      ]
    });
    const editor = setup();
    editor.open();
    editor.extension().insertImage!();
    await settle();
    expect(editor.applyEdit).toHaveBeenCalledOnce();
    expect(uiMessage.warning).toHaveBeenCalledWith(
      expect.stringContaining("大图.png")
    );
    expect(uiMessage.warning).toHaveBeenCalledWith(
      expect.stringContaining("动画.gif")
    );
  });
  it("does nothing on cancellation", async () => {
    pick.mockResolvedValueOnce({ status: "cancelled" });
    const editor = setup();
    editor.open();
    editor.extension().insertImage!();
    await settle();
    expect(editor.applyEdit).not.toHaveBeenCalled();
    expect(uiMessage.error).not.toHaveBeenCalled();
  });
});
