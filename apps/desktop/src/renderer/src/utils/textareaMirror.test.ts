import { afterEach, describe, expect, it, vi } from "vitest";
import {
  measureTextareaOffsetTop,
  revealTextareaOffset
} from "./textareaMirror";

interface FakeElement {
  style: Record<string, string>;
  textContent: string;
  parent?: FakeElement;
  append(child: FakeElement): void;
  remove(): void;
  readonly offsetTop: number;
}

/** Lays text out at 10 characters per 30px line, like a narrow textarea. */
function setup(scrollTop = 0) {
  const mirrors: FakeElement[] = [];
  const removed: FakeElement[] = [];
  const createElement = (): FakeElement => ({
    style: {},
    textContent: "",
    append(child) {
      child.parent = this;
    },
    remove() {
      removed.push(this);
    },
    get offsetTop() {
      const lines = (this.parent?.textContent ?? "")
        .split("\n")
        .map((line) => Math.max(1, Math.ceil(line.length / 10)));
      return (lines.reduce((sum, count) => sum + count, 0) - 1) * 30;
    }
  });
  const textarea = {
    ownerDocument: {
      createElement,
      body: { append: (element: FakeElement) => mirrors.push(element) }
    },
    value: `${"长".repeat(95)}\n${"段".repeat(40)}`,
    clientWidth: 300,
    clientHeight: 300,
    scrollTop
  };
  vi.stubGlobal("getComputedStyle", () => ({
    lineHeight: "30px",
    paddingTop: "0px"
  }));
  return {
    mirrors,
    removed,
    textarea: textarea as unknown as HTMLTextAreaElement
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("textarea mirror", () => {
  it("measures soft-wrapped lines at the textarea's width", () => {
    const { mirrors, removed, textarea } = setup();
    // One logical line before the offset, but it wraps to ten rendered lines.
    expect(measureTextareaOffsetTop(textarea, 101)).toBe(300);
    expect(mirrors[0]!.style.width).toBe("300px");
    expect(mirrors[0]!.textContent).toBe(textarea.value.slice(0, 101));
    expect(removed).toEqual(mirrors);
  });

  it("keeps the scroll position when the offset is already visible", () => {
    const { textarea } = setup(250);
    revealTextareaOffset(textarea, 101, 40);
    expect(textarea.scrollTop).toBe(250);
  });

  it("scrolls the offset below a floating panel", () => {
    const { textarea } = setup(0);
    revealTextareaOffset(textarea, 101, 60);
    // 300px target, 60px covered, a third of the remaining 240px above it.
    expect(textarea.scrollTop).toBe(160);

    textarea.scrollTop = 290;
    revealTextareaOffset(textarea, 101, 60);
    expect(textarea.scrollTop).toBe(160);
  });
});
