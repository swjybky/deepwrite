import { effectScope, reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorSelectionInsertion } from "./useEditorSelectionInsertion";
import type { EditorTextReference } from "../types/conversation";
import { registerRichMarkdownEditor } from "../utils/richMarkdownBridge";

const menu = vi.hoisted(() => ({
  openSelectionAction: vi.fn(),
  closeSelectionAction: vi.fn()
}));
vi.mock("./useSelectionInsertionMenu", () => ({
  useSelectionInsertionMenu: () => menu
}));
class Surface {
  closest(): Surface | null {
    return null;
  }
  querySelector() {
    return null;
  }
  contains() {
    return true;
  }
}
class Input extends Surface {
  dataset: Record<string, string> = {};
  selectionStart = 0;
  selectionEnd = 0;
}
const scopes: ReturnType<typeof effectScope>[] = [];
function setup(content: string) {
  const source = reactive({
    resourceId: "book:plot",
    document: {
      id: "plot_design",
      title: "剧情",
      path: ["样书", "剧情"],
      content
    }
  });
  const scope = effectScope();
  scopes.push(scope);
  const handlers = scope.run(() =>
    useEditorSelectionInsertion({
      source: () => ({
        resourceId: source.resourceId,
        document: { ...source.document }
      }),
      insert: vi.fn()
    })
  )!;
  return { source, ...handlers };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("HTMLElement", Surface);
  vi.stubGlobal("HTMLTextAreaElement", Input);
  vi.stubGlobal("getSelection", () => ({ isCollapsed: true, rangeCount: 0 }));
});
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.unstubAllGlobals();
});

describe("editor selection insertion from editable previews", () => {
  it("references the actual rendered selection when the same words occur twice", () => {
    const content = "**粗体**\r\n\r\n**粗体**";
    const editor = setup(content);
    const preview = new Surface();
    const target = new Surface();
    target.closest = () => preview;
    const start = content.lastIndexOf("粗体");
    registerRichMarkdownEditor(preview as unknown as HTMLElement, {
      selection: () => ({ start, end: start + 2 }),
      select() {},
      focus() {},
      hasFocus: () => true
    });
    vi.stubGlobal("getSelection", () => ({
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => ({ commonAncestorContainer: {} }),
      toString: () => "粗体"
    }));
    const event = { target, currentTarget: preview } as unknown as MouseEvent;
    editor.handlePreviewContextMenu(event);
    const reference = menu.openSelectionAction.mock
      .lastCall![0] as EditorTextReference;
    expect(reference).toMatchObject({
      text: "粗体",
      start,
      end: start + 2,
      startLine: 3,
      endLine: 3
    });
    const valid = menu.openSelectionAction.mock.lastCall![3] as () => boolean;
    expect(valid()).toBe(true);
    editor.source.document.content += "已变化";
    expect(valid()).toBe(false);
  });
  it("preserves selected textarea references in ordinary edit mode", () => {
    const content = "第一行\r\n第二行\r\n第三行";
    const editor = setup(content);
    const input = new Input();
    input.selectionStart = 4;
    input.selectionEnd = 7;
    editor.handleEditorContextMenu({
      target: input,
      currentTarget: input
    } as unknown as MouseEvent);
    expect(menu.openSelectionAction.mock.lastCall![0]).toMatchObject({
      text: "第二行",
      start: 5,
      end: 8,
      startLine: 2,
      endLine: 2
    });
  });
  it("keeps static rendered text selections available", () => {
    const editor = setup("**粗体**");
    vi.stubGlobal("getSelection", () => ({
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => ({ commonAncestorContainer: {} }),
      toString: () => "粗体"
    }));
    editor.handlePreviewContextMenu({
      target: new Surface(),
      currentTarget: new Surface()
    } as unknown as MouseEvent);
    expect(menu.openSelectionAction.mock.lastCall![0]).toMatchObject({
      text: "粗体",
      start: 2,
      end: 4
    });
  });
});
