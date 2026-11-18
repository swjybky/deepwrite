import type {
  DeepWriteApi,
  MysteryBookSummary,
  MysteryDocumentTarget
} from "@deepwrite/contracts";
import { effectScope, ref } from "vue";
import { expect, it, vi } from "vitest";
import { useMysteryDocument } from "./useMysteryDocument";

it("keeps typing during a save and uses the returned revision on the next save", async () => {
  vi.useFakeTimers();
  const scope = effectScope();
  type SaveResult = {
    revision: string;
    summary: MysteryBookSummary;
  };
  let resolveFirstWrite!: (value: SaveResult) => void;
  const firstWrite = new Promise<SaveResult>((resolve) => {
    resolveFirstWrite = resolve;
  });
  const summary = { id: "mystery-book-fixture" } as MysteryBookSummary;
  const readDocument = vi.fn(async () => ({ content: "原稿", revision: "r1" }));
  const writeDocument = vi
    .fn()
    .mockReturnValueOnce(firstWrite)
    .mockResolvedValueOnce({ revision: "r3", summary });
  const api = {
    readDocument,
    writeDocument
  } as unknown as DeepWriteApi["mystery"];
  const onError = vi.fn();
  let refresh = async () => {};
  const editor = scope.run(() =>
    useMysteryDocument({
      api: () => api,
      bookId: () => summary.id,
      target: () => ({ kind: "truth_doc", docId: "core_truth" }),
      autoSaveEnabled: () => true,
      refreshBook: () => refresh(),
      onLoadError: onError,
      onSaveError: onError
    })
  )!;
  refresh = async () => {
    await editor.loadDocument();
  };

  try {
    await editor.loadDocument();
    editor.handleContentUpdate("第一次输入");
    const saving = editor.saveDocument();
    editor.handleContentUpdate("第一次输入和后续草稿");
    await vi.advanceTimersByTimeAsync(850);

    resolveFirstWrite({ revision: "r2", summary });
    expect(await saving).toBe(false);
    expect(editor.docContent.value).toBe("第一次输入和后续草稿");
    expect(editor.docDirty.value).toBe(true);
    expect(readDocument).toHaveBeenCalledOnce();
    expect(writeDocument).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(850);
    expect(writeDocument).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        content: "第一次输入和后续草稿",
        expectedRevision: "r2"
      })
    );
    expect(editor.docDirty.value).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  } finally {
    scope.stop();
    vi.useRealTimers();
  }
});

it("pauses automatic writes during composition and drains the latest draft before leaving", async () => {
  vi.useFakeTimers();
  const scope = effectScope();
  const write = vi.fn().mockResolvedValue({ revision: "r2" });
  const api = {
    readAgentsMd: async () => ({ content: "原稿", revision: "r1" }),
    writeAgentsMd: write
  } as unknown as DeepWriteApi["mystery"];
  const automatic = ref(true);
  const editor = scope.run(() =>
    useMysteryDocument({
      api: () => api,
      bookId: () => "fixture",
      target: () => ({ kind: "agents_md" }),
      autoSaveEnabled: () => automatic.value,
      refreshBook: async () => {},
      onLoadError: vi.fn(),
      onSaveError: vi.fn()
    })
  )!;
  try {
    await editor.loadDocument();
    editor.composing.value = true;
    editor.handleContentUpdate("原稿中文");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await editor.flushDocument()).toBe(false);
    expect(write).not.toHaveBeenCalled();
    editor.composing.value = false;
    automatic.value = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).not.toHaveBeenCalled();
    await Promise.all([editor.flushDocument(), editor.flushDocument()]);
    expect(write).toHaveBeenCalledExactlyOnceWith({
      bookId: "fixture",
      content: "原稿中文",
      expectedRevision: "r1"
    });
    expect(editor.docDirty.value).toBe(false);
  } finally {
    scope.stop();
    vi.useRealTimers();
  }
});

it("preserves the current selection and text after a failed read or a conflicting write", async () => {
  const scope = effectScope();
  const initial: MysteryDocumentTarget = {
    kind: "truth_doc",
    docId: "core_truth"
  };
  const target = ref<MysteryDocumentTarget>(initial);
  const read = vi
    .fn()
    .mockResolvedValueOnce({ content: "原稿", revision: "r1" })
    .mockRejectedValueOnce(new Error("read failed"));
  const write = vi.fn().mockRejectedValue(new Error("revision conflict"));
  const api = {
    readDocument: read,
    writeDocument: write
  } as unknown as DeepWriteApi["mystery"];
  const onSaveError = vi.fn(),
    onLoadError = vi.fn();
  const editor = scope.run(() =>
    useMysteryDocument({
      api: () => api,
      bookId: () => "fixture",
      target: () => target.value,
      selectTarget: (next) => {
        target.value = next;
      },
      autoSaveEnabled: () => false,
      refreshBook: async () => {},
      onLoadError,
      onSaveError
    })
  )!;
  try {
    expect(await editor.loadDocument()).toBe(true);
    expect(await editor.loadDocument({ kind: "character_relations" })).toBe(
      false
    );
    expect(target.value).toEqual(initial);
    expect(editor.docContent.value).toBe("原稿");
    editor.handleContentUpdate("本地修改");
    expect(await editor.flushDocument()).toBe(false);
    await editor.loadDocument();
    expect(editor.docContent.value).toBe("本地修改");
    expect(editor.docDirty.value).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
    expect(onLoadError).toHaveBeenCalledOnce();
    expect(onSaveError).toHaveBeenCalledOnce();
  } finally {
    scope.stop();
  }
});

it("only overwrites the disk revision the author reviewed and can reload a later change", async () => {
  const scope = effectScope();
  let disk = { content: "初稿", revision: "r1" };
  const write = vi.fn(
    async ({
      expectedRevision,
      content
    }: {
      expectedRevision: string;
      content: string;
    }) => {
      if (expectedRevision !== disk.revision)
        throw { code: "mystery.conflict", message: "file changed" };
      disk = { content, revision: "written" };
      return disk;
    }
  );
  const api = {
    readDocument: async () => disk,
    writeDocument: write
  } as unknown as DeepWriteApi["mystery"];
  const onSaveError = vi.fn();
  const editor = scope.run(() =>
    useMysteryDocument({
      api: () => api,
      bookId: () => "fixture",
      target: () => ({ kind: "truth_doc", docId: "core_truth" }),
      autoSaveEnabled: () => false,
      refreshBook: async () => {},
      onLoadError: vi.fn(),
      onSaveError
    })
  )!;
  try {
    await editor.loadDocument();
    editor.handleContentUpdate("本地稿");
    disk = { content: "外部稿", revision: "r2" };
    expect(await editor.flushDocument()).toBe(false);
    expect(editor.conflict.value?.content).toBe("外部稿");
    disk = { content: "又一次修改", revision: "r3" };
    await editor.overwriteConflict();
    expect(editor.conflict.value?.content).toBe("又一次修改");
    expect(disk.content).toBe("又一次修改");
    expect(editor.docContent.value).toBe("本地稿");
    await editor.overwriteConflict();
    expect(disk.content).toBe("本地稿");
    expect(editor.docDirty.value).toBe(false);
    editor.handleContentUpdate("另一份草稿");
    disk = { content: "最新磁盘稿", revision: "r4" };
    await editor.flushDocument();
    await editor.reloadConflict();
    expect(editor.conflict.value).toBeNull();
    expect(editor.docContent.value).toBe("最新磁盘稿");
    expect(onSaveError).not.toHaveBeenCalled();
  } finally {
    scope.stop();
  }
});
