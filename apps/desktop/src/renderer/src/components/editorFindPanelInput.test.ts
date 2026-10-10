import { describe, expect, it, vi } from "vitest";
import { createEditorFindPanelInput } from "./editorFindPanelInput";

function setup() {
  const actions = {
    updateQuery: vi.fn(),
    search: vi.fn(),
    findMatch: vi.fn(),
    replaceCurrent: vi.fn()
  };
  return { actions, input: createEditorFindPanelInput(actions) };
}

function inputEvent(value: string, isComposing: boolean): Event {
  return { target: { value }, isComposing } as unknown as Event;
}

function enter(isComposing: boolean, shiftKey = false): KeyboardEvent {
  return {
    isComposing,
    shiftKey,
    preventDefault: vi.fn()
  } as unknown as KeyboardEvent;
}

describe("editor find panel input", () => {
  it("searches once a pinyin composition is committed", () => {
    const { actions, input } = setup();

    input.handleQueryInput(inputEvent("ni", true));
    // Chromium sends the committed text while still composing.
    input.handleQueryInput(inputEvent("你", true));
    expect(actions.updateQuery).toHaveBeenLastCalledWith("你");
    expect(actions.search).not.toHaveBeenCalled();

    input.handleQueryCompositionEnd({
      target: { value: "你" }
    } as unknown as CompositionEvent);
    expect(actions.search).toHaveBeenCalledOnce();

    input.handleQueryInput(inputEvent("你好", false));
    expect(actions.search).toHaveBeenCalledTimes(2);
  });

  it("leaves Enter to the IME while composing", () => {
    const { actions, input } = setup();
    const composing = enter(true);
    input.handleQueryEnter(composing);
    input.handleReplacementEnter(composing);
    expect(composing.preventDefault).not.toHaveBeenCalled();
    expect(actions.findMatch).not.toHaveBeenCalled();
    expect(actions.replaceCurrent).not.toHaveBeenCalled();

    const previous = enter(false, true);
    input.handleQueryEnter(previous);
    expect(previous.preventDefault).toHaveBeenCalled();
    expect(actions.findMatch).toHaveBeenCalledWith(-1);
    input.handleReplacementEnter(enter(false));
    expect(actions.replaceCurrent).toHaveBeenCalledOnce();
  });
});
