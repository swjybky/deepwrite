// @vitest-environment deepwrite-renderer
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRenderer, defineComponent, h, nextTick, ref } from "vue";
import {
  LongBookAnalysisSourceSchema,
  type DeepWriteApi,
  type LongBookAnalysisSource
} from "@deepwrite/contracts/renderer";
import ChapterEditor from "./ChapterEditor.vue";
import { createLongAnalysisSources } from "./long-analysis-sources";

vi.mock("../../components/AppIcon.vue", () => ({
  default: defineComponent({
    props: { name: String, size: Number },
    render() {
      return h("svg", { "data-icon": this.name });
    }
  })
}));

vi.mock("../../ui-feedback", () => ({
  uiMessage: {
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}));

class FakeEl {
  parent: FakeEl | null = null;
  children: FakeEl[] = [];
  props: Record<string, unknown> = {};
  textContent = "";
  readOnly = false;
  selectionStart = 0;
  focusCalls = 0;

  constructor(readonly tag: string) {}

  get [Symbol.toStringTag](): string {
    return "HTMLElement";
  }

  get tagName(): string {
    return this.tag.toUpperCase();
  }

  focus(): void {
    this.focusCalls += 1;
    setFocusedEl(this);
  }

  scrollIntoView(): void {}

  contains(target: unknown): boolean {
    let cursor = target as FakeEl | null;
    while (cursor) {
      if (cursor === this) return true;
      cursor = cursor.parent;
    }
    return false;
  }

  querySelector(selector: string): FakeEl | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeEl[] {
    const hits: FakeEl[] = [];
    for (const child of this.children) {
      if (matchesSelector(child, selector)) hits.push(child);
      hits.push(...child.querySelectorAll(selector));
    }
    return hits;
  }
}

function matchesSelector(el: FakeEl, selector: string): boolean {
  const classes = String(el.props.class ?? "").split(/\s+/);
  if (selector.startsWith(".")) {
    return selector
      .slice(1)
      .split(".")
      .every((name) => classes.includes(name));
  }
  return el.tag === selector;
}

let activeFakeEl: FakeEl | null = null;
const cleanups: Array<() => void> = [];

function setFocusedEl(el: FakeEl): void {
  activeFakeEl = el;
}

function detachEl(node: FakeEl): void {
  if (!node.parent) return;
  const idx = node.parent.children.indexOf(node);
  if (idx >= 0) node.parent.children.splice(idx, 1);
  node.parent = null;
}

function readElText(el: FakeEl): string {
  return `${el.textContent}${el.children.map(readElText).join("")}`;
}

function mountEditor(initialSource: LongBookAnalysisSource) {
  const body = new FakeEl("body");
  vi.stubGlobal("Node", FakeEl);
  vi.stubGlobal("HTMLInputElement", FakeEl);
  vi.stubGlobal("document", {
    body,
    get activeElement() {
      return activeFakeEl;
    }
  });

  const controller = createLongAnalysisSources({
    api: () => ({}) as unknown as DeepWriteApi,
    isBusy: () => false,
    isDisposed: () => false,
    onChange: vi.fn()
  });
  controller.source.value = initialSource;
  controller.selectChapter(
    initialSource.chapters[1]?.id ?? initialSource.chapters[0]!.id
  );
  const disabled = ref(false);

  const renderer = createRenderer<FakeEl, FakeEl>({
    patchProp: (el, key, _prev, value) => {
      el.props[key] = value;
      if (key === "readonly" || key === "readOnly") {
        el.readOnly = value !== undefined && value !== null && value !== false;
      }
      if (key === "disabled" && Boolean(value) && activeFakeEl === el) {
        activeFakeEl = body;
      }
    },
    insert(el, parent, anchor) {
      detachEl(el);
      el.parent = parent;
      const idx = anchor ? parent.children.indexOf(anchor) : -1;
      parent.children.splice(idx >= 0 ? idx : parent.children.length, 0, el);
    },
    remove: detachEl,
    createElement: (tag) => new FakeEl(tag),
    createText: (text) =>
      Object.assign(new FakeEl("#text"), { textContent: text }),
    createComment: () => new FakeEl("#comment"),
    setText: (el, text) => {
      el.textContent = text;
    },
    setElementText: (el, text) => {
      el.children = [];
      el.textContent = text;
    },
    parentNode: (el) => el.parent,
    nextSibling: (el) => {
      const siblings = el.parent?.children;
      if (!siblings) return null;
      return siblings[siblings.indexOf(el) + 1] ?? null;
    },
    querySelector: (selector) => (selector === "body" ? body : null)
  });

  const root = new FakeEl("div");
  const app = renderer.createApp({
    render: () =>
      h(ChapterEditor, {
        source: controller.source.value!,
        selectedChapterId: controller.selectedChapterId.value,
        canUndo: controller.canUndoChapters.value,
        disabled: disabled.value,
        onSelect: (chapterId: string) => controller.selectChapter(chapterId),
        onUpdate: (chapters, options) =>
          controller.replaceChapters(chapters, options),
        onUndo: () => controller.undoChapters()
      })
  });
  app.mount(root);
  cleanups.push(() => app.unmount());

  return { root, controller, disabled };
}

function sampleSource(): LongBookAnalysisSource {
  return LongBookAnalysisSourceSchema.parse({
    id: "long_book_analysis_source_editor",
    kind: "txt",
    name: "sample-15ch-clean.txt",
    revision: 1,
    diagnostics: [],
    chapters: [
      {
        id: "ch14",
        order: 1,
        title: "第十四章 夜探古宅",
        rawHeading: "第十四章 夜探古宅",
        sourceName: "sample-15ch-clean.txt",
        text: "十四章前段。",
        charCount: 6
      },
      {
        id: "ch15-fake",
        order: 2,
        title: "1 ABCD（原属第十四章中段的正文行）",
        rawHeading: "1. ABCD（原属第十四章中段的正文行）",
        sourceName: "sample-15ch-clean.txt",
        text: "十四章后段。",
        charCount: 6
      },
      {
        id: "ch16",
        order: 3,
        title: "第十五章 黎明破晓",
        rawHeading: "第十五章 黎明破晓",
        sourceName: "sample-15ch-clean.txt",
        text: "十五章正文。",
        charCount: 6
      }
    ]
  });
}

afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  activeFakeEl = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ChapterEditor", () => {
  it("renders visible Undo button, targets merged chapter, and restores selection via Undo button and Ctrl/Cmd+Z", async () => {
    const { root, controller } = mountEditor(sampleSource());
    const undoBtn = () => root.querySelector(".chapter-undo-button")!;
    const mergePrevBtn = () =>
      root
        .querySelectorAll("button")
        .find((el) => readElText(el).includes("并入上一章"))!;
    const section = () => root.querySelector(".chapter-editor")!;
    const previewTextarea = () => root.querySelector("textarea")!;
    const titleInputs = () => root.querySelectorAll("input");

    expect(readElText(undoBtn())).toContain("撤回");
    expect(undoBtn().props.disabled).toBe(true);
    expect(previewTextarea().readOnly).toBe(true);

    // Focus merge button inside editor and merge ch15-fake into ch14.
    mergePrevBtn().focus();
    await (mergePrevBtn().props.onClick as () => Promise<void>)();
    await nextTick();

    expect(controller.source.value?.chapters).toHaveLength(2);
    expect(controller.selectedChapterId.value).toBe("ch14");
    expect(previewTextarea().props.value).toBe(
      "十四章前段。\n1. ABCD（原属第十四章中段的正文行）\n十四章后段。"
    );
    expect(undoBtn().props.disabled).toBe(false);

    // Pressing Meta+Z inside a chapter title input must NOT trigger chapter undo.
    const preventInputUndo = vi.fn();
    (section().props.onKeydown as (event: unknown) => void)({
      key: "z",
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      isComposing: false,
      target: titleInputs()[0],
      preventDefault: preventInputUndo
    });
    await nextTick();
    expect(preventInputUndo).not.toHaveBeenCalled();
    expect(controller.source.value?.chapters).toHaveLength(2);

    // Pressing Ctrl+Z on the readonly preview textarea undoes the merge and restores selection.
    const preventPreviewUndo = vi.fn();
    (section().props.onKeydown as (event: unknown) => void)({
      key: "z",
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      isComposing: false,
      target: previewTextarea(),
      preventDefault: preventPreviewUndo
    });
    await nextTick();
    await nextTick();

    expect(preventPreviewUndo).toHaveBeenCalledOnce();
    expect(controller.source.value?.chapters).toHaveLength(3);
    expect(controller.selectedChapterId.value).toBe("ch15-fake");
    expect(undoBtn().props.disabled).toBe(true);

    // Merge again, then click the visible Undo button and verify focus stays preserved even when button disables.
    mergePrevBtn().focus();
    await (mergePrevBtn().props.onClick as () => Promise<void>)();
    await nextTick();
    expect(controller.source.value?.chapters).toHaveLength(2);
    expect(undoBtn().props.disabled).toBe(false);

    undoBtn().focus();
    await (undoBtn().props.onClick as () => Promise<void>)();
    await nextTick();
    await nextTick();
    expect(controller.source.value?.chapters).toHaveLength(3);
    expect(controller.selectedChapterId.value).toBe("ch15-fake");
    expect(section().contains(activeFakeEl)).toBe(true);
  });

  it("keeps keyboard focus inside the editor when merging chapter 2 into chapter 1 disables the merge button", async () => {
    const twoChapter = LongBookAnalysisSourceSchema.parse({
      ...sampleSource(),
      chapters: sampleSource().chapters.slice(0, 2)
    });
    const { root, controller } = mountEditor(twoChapter);
    const mergePrevBtn = root
      .querySelectorAll("button")
      .find((el) => readElText(el).includes("并入上一章"))!;
    const section = root.querySelector(".chapter-editor")!;

    mergePrevBtn.focus();
    await (mergePrevBtn.props.onClick as () => Promise<void>)();
    await nextTick();

    expect(controller.selectedChapterId.value).toBe("ch14");
    expect(mergePrevBtn.props.disabled).toBe(true);
    expect(section.contains(activeFakeEl)).toBe(true);

    const preventUndo = vi.fn();
    (section.props.onKeydown as (event: unknown) => void)({
      key: "z",
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      isComposing: false,
      target: activeFakeEl,
      preventDefault: preventUndo
    });
    await nextTick();
    expect(preventUndo).toHaveBeenCalledOnce();
    expect(controller.source.value?.chapters).toHaveLength(2);
    expect(controller.selectedChapterId.value).toBe("ch15-fake");
  });
});
