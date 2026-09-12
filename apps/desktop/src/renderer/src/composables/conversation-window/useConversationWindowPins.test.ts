import { effectScope, reactive, shallowRef } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  selectedConversationWindowIds,
  useConversationWindowPins
} from "./useConversationWindowPins";

class Row {
  constructor(readonly dataset: { conversationWindowId: string }) {}
  getAttribute() {
    return this.dataset.conversationWindowId;
  }
  closest() {
    return this;
  }
}
afterEach(() => vi.unstubAllGlobals());

describe("conversation window interaction pins", () => {
  it("retains selected, focused and edited rows independently and releases listeners", async () => {
    vi.stubGlobal("Element", Row);
    const first = new Row({ conversationWindowId: "first" });
    const second = new Row({ conversationWindowId: "second" });
    const selected = new Set<Row>();
    const selection = {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => ({ intersectsNode: (node: Row) => selected.has(node) })
    } as unknown as Selection;
    const document = Object.assign(new EventTarget(), {
      activeElement: null as Row | null,
      getSelection: () => selection
    });
    const container = Object.assign(new EventTarget(), {
      ownerDocument: document,
      querySelectorAll: () => [first, second],
      contains: (node: Row) => node === first || node === second
    });
    const state = reactive({ edits: ["editing"], retained: ["approval"] });
    const scope = effectScope();
    const pins = scope.run(() =>
      useConversationWindowPins({
        container: shallowRef(container as unknown as HTMLElement),
        editingIds: () => state.edits,
        retainedIds: () => state.retained
      })
    )!;
    selected.add(first);
    document.dispatchEvent(new Event("selectionchange"));
    document.activeElement = second;
    container.dispatchEvent(new Event("focusin"));
    expect(new Set(pins.value)).toEqual(
      new Set(["editing", "approval", "first", "second"])
    );
    document.activeElement = null;
    container.dispatchEvent(new Event("focusout"));
    await Promise.resolve();
    expect(pins.value).not.toContain("second");
    selected.clear();
    document.dispatchEvent(new Event("selectionchange"));
    expect(pins.value).toEqual(["editing", "approval"]);
    scope.stop();
    selected.add(first);
    document.dispatchEvent(new Event("selectionchange"));
    expect(pins.value).toEqual(["editing", "approval"]);
  });

  it("does not pretend unmounted rows are part of native selection", () => {
    const container = {
      querySelectorAll: () => [new Row({ conversationWindowId: "mounted" })]
    } as unknown as HTMLElement;
    const selection = {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => ({ intersectsNode: () => true })
    } as unknown as Selection;
    expect(selectedConversationWindowIds(container, selection)).toEqual([
      "mounted"
    ]);
  });
});
