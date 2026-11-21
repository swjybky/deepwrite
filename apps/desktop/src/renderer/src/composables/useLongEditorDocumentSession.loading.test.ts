import {
  computed,
  createRenderer,
  defineComponent,
  nextTick,
  reactive,
  ref
} from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LongFileId,
  LongReadDocumentInput,
  LongReadDocumentResult
} from "@deepwrite/contracts";
import {
  useLongEditorDocumentSession,
  type LongDocumentState
} from "./useLongEditorDocumentSession";
import type { LongWorkspaceSelection } from "../types/longWorkspace";

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
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  apps.splice(0).forEach((app) => app.unmount());
  vi.unstubAllGlobals();
});

function selection(key: string, items = 45): LongWorkspaceSelection {
  const files = Array.from({ length: items + 1 }, (_, index) => ({
    role: index === 0 ? ("overview" as const) : ("content" as const),
    label: `${key}-${index}`,
    file: {
      id: `file_${key}_${index}` as LongFileId,
      path: `long/worldbuilding/${key}/${index}.md`,
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  }));
  return {
    key,
    root: "worldbuilding",
    worldbuildingFormat: "list",
    title: key,
    breadcrumbs: [key],
    files,
    preferredRole: "overview",
    worldbuildingItems: files.slice(1).map(({ file }, index) => ({
      id: `${key}_${index}`,
      title: `${key} ${index}`,
      order: index + 1,
      file
    }))
  };
}

async function flush() {
  for (let index = 0; index < 16; index += 1) {
    await nextTick();
    await Promise.resolve();
  }
}

function setupEditor(initial = selection("rules")) {
  const props = reactive({
    bookId: "longbook_test",
    selection: initial,
    autoSaveEnabled: false,
    locked: false
  });
  const activeFileId = ref(initial.files[0]!.file.id);
  const pendingFileId = ref<string | null>(null);
  const emit = vi.fn();
  const documentStates = ref<Record<string, LongDocumentState>>({});
  const pending: Array<{
    input: LongReadDocumentInput;
    resolve: (result: LongReadDocumentResult) => void;
    reject: (error: Error) => void;
  }> = [];
  const readDocument = vi.fn(
    (input: LongReadDocumentInput) =>
      new Promise<LongReadDocumentResult>((resolve, reject) =>
        pending.push({ input, resolve, reject })
      )
  );
  vi.stubGlobal("window", { deepwrite: { long: { readDocument } } });
  let session!: ReturnType<typeof useLongEditorDocumentSession>;
  const app = renderer.createApp(
    defineComponent({
      setup() {
        session = useLongEditorDocumentSession({
          props,
          emit,
          pendingFileId,
          documentStates,
          volumeOutlineDrafts: ref({}),
          plotPointSummaryDrafts: ref({}),
          currentSelectionFile: computed(() =>
            props.selection.files.find(
              ({ file }) => file.id === activeFileId.value
            )
          ),
          currentReadOnly: computed(() => false),
          currentDirty: computed(() => false),
          currentIsStructuredText: computed(() => false),
          currentIsWorldbuildingList: computed(
            () => props.selection.worldbuildingFormat === "list"
          ),
          viewMode: ref("edit"),
          editorInput: ref(null),
          activeWorldbuildingItemId: ref(null),
          activeBookLineVolumeId: ref(null),
          activeBookLineContentTab: ref("outline"),
          activePlotPointTab: ref("summary"),
          activeStoryPlotId: ref(null),
          saveVolumeOutline: async () => true,
          savePlotPointContent: async () => true,
          readRecoveryRecord: () => null,
          clearRecoveryRecordForKey: () => {},
          persistRecoveryForKey: () => {}
        });
        return () => null;
      }
    })
  );
  app.mount({});
  apps.push(app);

  function finish(fileId: string) {
    const index = pending.findIndex((entry) => entry.input.fileId === fileId);
    const job = pending.splice(index, 1)[0]!;
    expect(job).toBeDefined();
    job.resolve({
      bookId: job.input.bookId,
      file: {
        id: job.input.fileId,
        path: `long/worldbuilding/${fileId}.md`,
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      content: fileId,
      offset: 0,
      totalCharacters: fileId.length,
      nextOffset: null
    });
  }
  return {
    app,
    props,
    activeFileId,
    documentStates,
    pendingFileId,
    emit,
    session,
    readDocument,
    pending,
    finish
  };
}

describe("long editor document loading", () => {
  it("publishes chapter context only for the selected, loaded tab", async () => {
    const base = selection("chapter:chapter_one", 1);
    const [body, card] = base.files;
    const editor = setupEditor({
      key: base.key,
      root: "draft",
      chapterCardId: "chapter_one",
      title: "第一章",
      breadcrumbs: [],
      files: [
        { ...body!, role: "body" },
        { ...card!, role: "card" }
      ],
      preferredRole: "body"
    });
    const bodyId = body!.file.id;
    const cardId = card!.file.id;
    await flush();
    expect(editor.emit).toHaveBeenLastCalledWith("contextChange", null);
    editor.finish(bodyId);
    await flush();
    expect(editor.emit).toHaveBeenLastCalledWith("contextChange", {
      bookId: editor.props.bookId,
      fileId: bodyId
    });

    editor.pendingFileId.value = cardId;
    await flush();
    expect(editor.emit).toHaveBeenLastCalledWith("contextChange", null);
    editor.finish(cardId);
    await flush();
    expect(editor.emit).toHaveBeenLastCalledWith("contextChange", null);

    editor.activeFileId.value = cardId;
    editor.pendingFileId.value = null;
    await flush();
    expect(editor.emit).toHaveBeenLastCalledWith("contextChange", {
      bookId: editor.props.bookId,
      fileId: cardId
    });
  });
  it("loads visible content first and bounds speculative reads for a large list", async () => {
    const editor = setupEditor();
    await flush();
    expect(
      editor.readDocument.mock.calls.map(([input]) => input.fileId)
    ).toEqual(["file_rules_0"]);
    editor.finish("file_rules_0");
    await flush();
    expect(editor.pending.map(({ input }) => input.fileId)).toEqual([
      "file_rules_1",
      "file_rules_2"
    ]);
    expect(
      editor.documentStates.value[editor.session.stateKey("file_rules_0")]
        ?.loaded
    ).toBe(true);
  });

  it("prioritizes a clicked late item while two prefetches are in flight", async () => {
    const editor = setupEditor();
    await flush();
    editor.finish("file_rules_0");
    await flush();
    editor.activeFileId.value = "file_rules_40" as LongFileId;
    await flush();
    expect(editor.pending.map(({ input }) => input.fileId)).toEqual([
      "file_rules_1",
      "file_rules_2",
      "file_rules_40"
    ]);
    editor.finish("file_rules_1");
    await flush();
    expect(
      editor.readDocument.mock.calls.map(([input]) => input.fileId)
    ).not.toContain("file_rules_3");
    editor.finish("file_rules_40");
    await flush();
    expect(editor.session.currentState.value?.content).toBe("file_rules_40");
    expect(editor.session.isDocumentSwitchPending.value).toBe(false);
  });

  it("drops unissued reads across rapid category changes without multiplying concurrency", async () => {
    const editor = setupEditor();
    await flush();
    editor.finish("file_rules_0");
    await flush();
    editor.props.selection = selection("history");
    editor.activeFileId.value = "file_history_0" as LongFileId;
    await flush();
    editor.props.selection = selection("terms", 98);
    editor.activeFileId.value = "file_terms_0" as LongFileId;
    await flush();
    expect(editor.pending).toHaveLength(3);
    editor.finish("file_history_0");
    await flush();
    expect(editor.pending.map(({ input }) => input.fileId)).toEqual([
      "file_rules_1",
      "file_rules_2",
      "file_terms_0"
    ]);
    editor.finish("file_terms_0");
    editor.finish("file_rules_1");
    editor.finish("file_rules_2");
    await flush();
    const issued = editor.readDocument.mock.calls.map(
      ([input]) => input.fileId
    );
    expect(issued).not.toContain("file_rules_3");
    expect(issued).not.toContain("file_history_1");
    expect(editor.pending).toHaveLength(2);
    expect(editor.session.currentState.value?.content).toBe("file_terms_0");
  });

  it("puts the latest click ahead of older queued foreground reads", async () => {
    const editor = setupEditor();
    await flush();
    editor.finish("file_rules_0");
    await flush();
    for (const index of [40, 41, 42]) {
      editor.activeFileId.value = `file_rules_${index}` as LongFileId;
      await flush();
    }
    expect(editor.pending.map(({ input }) => input.fileId)).toEqual([
      "file_rules_1",
      "file_rules_2",
      "file_rules_40"
    ]);
    editor.finish("file_rules_40");
    await flush();
    expect(editor.pending.map(({ input }) => input.fileId)).toEqual([
      "file_rules_1",
      "file_rules_2",
      "file_rules_42"
    ]);
    expect(
      editor.readDocument.mock.calls.map(([input]) => input.fileId)
    ).not.toContain("file_rules_41");
  });

  it("shares an in-flight item read with foreground demand and disposes queued work", async () => {
    const editor = setupEditor();
    await flush();
    editor.finish("file_rules_0");
    await flush();
    editor.activeFileId.value = "file_rules_1" as LongFileId;
    await flush();
    expect(
      editor.readDocument.mock.calls.filter(
        ([input]) => input.fileId === "file_rules_1"
      )
    ).toHaveLength(1);
    editor.finish("file_rules_1");
    await flush();
    expect(editor.session.currentState.value?.content).toBe("file_rules_1");
    const count = editor.readDocument.mock.calls.length;
    editor.app.unmount();
    apps.pop();
    editor.pending.slice().forEach(({ input }) => editor.finish(input.fileId));
    await flush();
    expect(editor.readDocument).toHaveBeenCalledTimes(count);
  });
});
