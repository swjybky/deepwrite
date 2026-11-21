import { createPinia } from "pinia";
import {
  createRenderer,
  createSSRApp,
  defineComponent,
  h,
  nextTick,
  reactive,
  ssrContextKey,
  type App,
  type Component
} from "vue";
import { renderToString } from "vue/server-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LongWorkspaceFileReference,
  LongWriteDocumentResult,
  TextViewMode
} from "@deepwrite/contracts";
import type { LongWorkspaceSelection } from "../types/longWorkspace";
import LongWorkspaceEditor from "./LongWorkspaceEditor.vue";

const renderer = createRenderer({
  patchProp: () => {},
  insert: () => {},
  remove: () => {},
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText: () => {},
  setElementText: () => {},
  parentNode: () => null,
  nextSibling: () => null
});

interface EditorState {
  viewMode: TextViewMode;
  manualSaving: boolean;
  findPanelOpen: boolean;
  searchQuery: string;
  replacementText: string;
  canUndo: boolean;
  currentVisibleContent: string;
  currentSelectionFile?: LongWorkspaceSelection["files"][number];
  selectWorkspaceFile(fileId: string): Promise<void>;
  setViewMode(mode: TextViewMode): void;
  recordProgrammaticChange(
    content: string,
    selection: { start: number; end: number }
  ): void;
  updateCurrentContent(content: string): void;
  saveCurrentDocument(): Promise<void>;
  undo(): void;
  redo(): void;
}

const apps: App[] = [];

function selection(
  fileId = "file-chapter-1",
  readOnly = false
): LongWorkspaceSelection {
  return {
    key: `draft:${fileId}`,
    root: "draft",
    title: "第一章",
    breadcrumbs: ["正文", "第一章"],
    preferredRole: "body",
    files: [
      {
        role: "body",
        label: "正文",
        readOnly,
        file: {
          id: fileId,
          path: `long/chapters/${fileId}/body.md`,
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      }
    ]
  };
}

async function setupEditor(defaultViewMode: TextViewMode = "preview") {
  const props = reactive({
    bookId: "book-1",
    selection: selection(),
    workspaceIndex: null,
    defaultViewMode,
    autoSaveEnabled: true
  });
  let diskContent = "初稿";
  const readDocument = vi.fn(async ({ fileId }: { fileId: string }) => ({
    file: props.selection.files.find(({ file }) => file.id === fileId)!.file,
    content: diskContent,
    offset: 0,
    totalCharacters: diskContent.length,
    nextOffset: null
  }));
  const writeDocument = vi.fn(async ({ content }: { content: string }) => {
    diskContent = content;
    return {
      file: {
        ...props.selection.files[0]!.file,
        updatedAt: "2026-01-01T00:00:01.000Z"
      }
    };
  });
  vi.stubGlobal("window", {
    deepwrite: { long: { readDocument, writeDocument } },
    localStorage: {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => {}
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  });
  vi.stubGlobal("document", {
    documentElement: { classList: { remove: () => {} } }
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect() {}
    }
  );

  function refreshFile(file: LongWorkspaceFileReference): void {
    props.selection = {
      ...props.selection,
      files: props.selection.files.map((entry) => ({ ...entry, file }))
    };
  }

  // Run the real editor setup, including document persistence and navigation
  // watchers; rendering is covered by the browser and existing surface tests.
  const editor = { ...LongWorkspaceEditor, render: () => null } as Component;
  const app = renderer.createApp(
    defineComponent({
      setup: () => () =>
        h(editor, {
          ...props,
          onSaved: (result: LongWriteDocumentResult) => refreshFile(result.file)
        })
    })
  );
  app.use(createPinia());
  app.provide(ssrContextKey, {});
  app.mount({});
  apps.push(app);
  await nextTick();
  await nextTick();
  const { setupState: state } = app._instance!.subTree.component as unknown as {
    setupState: EditorState;
  };
  expect(state.currentVisibleContent).toBe("初稿");

  function edit(content: string): void {
    state.recordProgrammaticChange(content, {
      start: content.length,
      end: content.length
    });
    state.updateCurrentContent(content);
  }

  return { props, state, edit, readDocument, writeDocument, refreshFile };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  apps.splice(0).forEach((app) => app.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("long editor view mode across document refreshes", () => {
  it("keeps preview mode when undoing and redoing an illustration edit", async () => {
    const { state, edit } = await setupEditor();
    edit("初稿\n\n![地图](images/map.png)");
    await nextTick();
    state.undo();
    expect(state.currentVisibleContent).toBe("初稿");
    expect(state.viewMode).toBe("preview");
    state.redo();
    expect(state.currentVisibleContent).toBe("初稿\n\n![地图](images/map.png)");
    expect(state.viewMode).toBe("preview");
  });

  it.each([true, false])(
    "shows the manual save button only when auto-save is off (auto-save: %s)",
    async (autoSaveEnabled) => {
      const { props } = await setupEditor();
      const app = createSSRApp(LongWorkspaceEditor, {
        ...props,
        autoSaveEnabled
      });
      app.use(createPinia());
      const html = await renderToString(app);

      expect(html.includes('class="long-editor-save-button"')).toBe(
        !autoSaveEnabled
      );
    }
  );

  it("keeps manual saving inactive throughout an in-flight auto-save", async () => {
    const { props, state, edit, writeDocument } = await setupEditor();
    let finishSave!: () => void;
    writeDocument.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = () =>
            resolve({ file: { ...props.selection.files[0]!.file } });
        })
    );
    state.setViewMode("edit");
    edit("后台自动保存");
    await nextTick();
    await vi.advanceTimersByTimeAsync(800);

    expect(writeDocument).toHaveBeenCalledOnce();
    expect(state.manualSaving).toBe(false);
    expect(state.viewMode).toBe("edit");
    finishSave();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.manualSaving).toBe(false);
    expect(state.viewMode).toBe("edit");
  });

  it("tracks only the explicit manual save without changing the editor mode", async () => {
    const { props, state, edit, writeDocument } = await setupEditor();
    props.autoSaveEnabled = false;
    let finishSave!: () => void;
    writeDocument.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = () =>
            resolve({ file: { ...props.selection.files[0]!.file } });
        })
    );
    state.setViewMode("edit");
    edit("手动保存正文");
    await nextTick();
    const saving = state.saveCurrentDocument();

    expect(state.manualSaving).toBe(true);
    expect(state.viewMode).toBe("edit");
    finishSave();
    await saving;
    expect(writeDocument).toHaveBeenCalledOnce();
    expect(state.manualSaving).toBe(false);
    expect(state.currentVisibleContent).toBe("手动保存正文");
    expect(state.viewMode).toBe("edit");
  });

  it("clears manual saving on failure and preserves the editable draft", async () => {
    const { props, state, edit, writeDocument } = await setupEditor();
    props.autoSaveEnabled = false;
    writeDocument.mockRejectedValueOnce(new Error("模拟保存失败"));
    state.setViewMode("edit");
    edit("保留未保存的正文");
    await nextTick();
    await state.saveCurrentDocument();

    expect(state.manualSaving).toBe(false);
    expect(state.currentVisibleContent).toBe("保留未保存的正文");
    expect(state.viewMode).toBe("edit");
  });

  it("keeps editing, search and undo after auto-save refreshes the same file", async () => {
    const { state, edit, writeDocument } = await setupEditor();
    expect(state.viewMode).toBe("preview");
    state.setViewMode("edit");
    state.findPanelOpen = true;
    state.searchQuery = "初稿";
    state.replacementText = "修改";
    edit("初稿续写");
    await nextTick();
    await vi.advanceTimersByTimeAsync(800);

    expect(writeDocument).toHaveBeenCalledExactlyOnceWith({
      bookId: "book-1",
      fileId: "file-chapter-1",
      content: "初稿续写"
    });
    expect(state.viewMode).toBe("edit");
    expect(state.findPanelOpen).toBe(true);
    expect(state.searchQuery).toBe("初稿");
    expect(state.replacementText).toBe("修改");
    expect(state.canUndo).toBe(true);
    state.undo();
    expect(state.currentVisibleContent).toBe("初稿");
  });

  it("keeps a manual preview choice after a manual save refresh", async () => {
    const { state, edit, writeDocument } = await setupEditor("edit");
    edit("初稿修改");
    state.setViewMode("preview");
    await state.saveCurrentDocument();
    await nextTick();

    expect(writeDocument).toHaveBeenCalledOnce();
    expect(state.viewMode).toBe("preview");
    expect(state.currentVisibleContent).toBe("初稿修改");
  });

  it("keeps editing when an equivalent selection snapshot replaces the old one", async () => {
    const { props, state } = await setupEditor();
    state.setViewMode("edit");
    props.selection = structuredClone(selection());
    await nextTick();

    expect(state.viewMode).toBe("edit");
  });

  it("retains the selected chapter card across an equivalent index refresh", async () => {
    const { props, state } = await setupEditor();
    const manuscript = selection();
    const card = {
      role: "card" as const,
      label: "章卡",
      file: {
        id: "file-chapter-card",
        path: "long/chapters/chapter_one/card.md",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    };
    props.selection = {
      ...manuscript,
      key: "chapter:chapter_one",
      chapterCardId: "chapter_one",
      files: [card, ...manuscript.files]
    };
    await nextTick();
    expect(state.currentSelectionFile?.role).toBe("body");
    await state.selectWorkspaceFile(card.file.id);
    expect(state.currentSelectionFile?.role).toBe("card");

    props.selection = {
      ...props.selection,
      files: props.selection.files.map((file) => ({
        ...file,
        file: { ...file.file }
      }))
    };
    await nextTick();
    expect(state.currentSelectionFile?.role).toBe("card");
  });

  it("applies the default and clears old editing state when the document changes", async () => {
    const { props, state, edit } = await setupEditor();
    state.setViewMode("edit");
    state.findPanelOpen = true;
    state.searchQuery = "初稿";
    edit("初稿修改");
    props.selection = selection("file-chapter-2");
    await nextTick();

    expect(state.viewMode).toBe("preview");
    expect(state.findPanelOpen).toBe(false);
    expect(state.searchQuery).toBe("");
    expect(state.canUndo).toBe(false);
  });

  it("applies changed defaults and forces preview for a different read-only file", async () => {
    const { props, state } = await setupEditor();
    state.setViewMode("edit");
    props.defaultViewMode = "edit";
    await nextTick();
    state.setViewMode("preview");
    props.defaultViewMode = "preview";
    await nextTick();
    expect(state.viewMode).toBe("preview");

    props.defaultViewMode = "edit";
    await nextTick();
    expect(state.viewMode).toBe("edit");
    props.selection = selection("file-read-only", true);
    await nextTick();
    expect(state.viewMode).toBe("preview");
  });

  it("forces preview if the same document becomes read-only", async () => {
    const { props, state } = await setupEditor("edit");
    props.selection = selection("file-chapter-1", true);
    await nextTick();

    expect(state.viewMode).toBe("preview");
  });
});
