import {
  createCatalogDraftDirectory,
  createDefaultBookPlotStages,
  type Book,
  type DeepWriteApi
} from "@deepwrite/contracts";
import { ref, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import type {
  EditorDraftState,
  ResourceTreeNode,
  WorkspaceDocument
} from "../types/workspace";
import {
  useShortBookLifecycleCoordinator,
  type ShortBookLifecycleTarget
} from "./useShortBookLifecycleCoordinator";

const NOW = "2026-08-14T00:00:00.000Z";

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("condition was not reached");
}

function fixtureBook(
  id = "book-1",
  projectRevision: number | undefined = 4,
  title = "虚构短篇"
): Book {
  const draft = createCatalogDraftDirectory(NOW);
  draft.sections[0]!.body.content = "磁盘正文";
  return {
    id,
    title,
    bookType: "short",
    genre: "其他",
    status: "editing",
    linkedMaterialIdsByKind: {
      character: [],
      gimmick: [],
      plot: [],
      draft: [],
      other: []
    },
    linkedSkillIdsByKind: {
      general: [],
      plot: [],
      style: [],
      other: []
    },
    characterStructure: { format: "text" },
    plotStages: createDefaultBookPlotStages({ allEnabled: true }),
    documents: [],
    draft,
    ...(projectRevision === undefined ? {} : { projectRevision }),
    createdAt: NOW,
    updatedAt: NOW
  } as Book;
}

function fixtureDocument(book: Book): WorkspaceDocument {
  const section = book.draft.sections[0]!;
  return {
    id: "body-1",
    domain: "creation",
    title: section.title,
    eyebrow: "短篇 · 正文",
    path: [book.title, "正文", section.title],
    content: section.body.content,
    workspaceId: book.id,
    workspaceType: "short",
    stageId: "draft",
    expertSectionId: section.id,
    draftDirectoryId: "draft-directory-1",
    draftFileKind: "body",
    catalogDocumentId: section.body.id,
    catalogContentLoaded: true
  };
}

function fixtureTarget(
  patch: Partial<ShortBookLifecycleTarget> = {}
): ShortBookLifecycleTarget {
  const requestId = patch.requestId ?? 1;
  const bookId = patch.bookId ?? "book-1";
  const node: ResourceTreeNode = {
    id: bookId,
    label: patch.label ?? "虚构短篇",
    workspaceType: patch.workspaceType ?? "short",
    ...(("projectRevision" in patch ? patch.projectRevision : 4) === undefined
      ? {}
      : {
          projectRevision:
            "projectRevision" in patch ? patch.projectRevision! : 4
        }),
    unavailable: patch.unavailable ?? false,
    catalogNodeType: "book"
  };
  return Object.freeze({
    requestId,
    bookId,
    label: node.label,
    workspaceType: node.workspaceType === "script" ? "script" : "short",
    projectRevision: node.projectRevision,
    unavailable: node.unavailable === true,
    node: Object.freeze(node),
    resourceIds: Object.freeze([
      bookId,
      `${bookId}:draft`,
      "draft-directory-1",
      "body-1"
    ]),
    ...patch
  });
}

interface HarnessOptions {
  book?: Book | null;
  target?: ShortBookLifecycleTarget;
  mode?: "rename" | "bind-skill" | "bind-material" | "remove" | "delete";
  catalogPending?: boolean;
  refreshResult?: boolean;
  prepareResult?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const initialBook = options.book === undefined ? fixtureBook() : options.book;
  const books = new Map<string, Book>();
  if (initialBook) books.set(initialBook.id, initialBook);
  const target = options.target ?? fixtureTarget();
  const dialogIntent = ref(target.requestId);
  const bookDialogMode = ref<
    "rename" | "bind-skill" | "bind-material" | "remove" | "delete" | null
  >(options.mode ?? "rename");
  const activeBook = shallowRef<ShortBookLifecycleTarget | null>(target);
  const exportBookTarget = shallowRef<ShortBookLifecycleTarget | null>(null);
  const manuscriptExportPending = ref(false);
  const catalogMutationPending = ref(options.catalogPending ?? false);
  const createBookDialogOpen = ref(true);
  const document = initialBook
    ? fixtureDocument(initialBook)
    : fixtureDocument(fixtureBook(target.bookId));
  const documents = shallowRef<WorkspaceDocument[]>([document]);
  const drafts = shallowRef<Record<string, EditorDraftState>>({
    [document.id]: {
      title: "编辑器新标题",
      content: "编辑器实时正文",
      dirty: true
    },
    untouched: { title: "其他草稿", content: "保留", dirty: true }
  });
  const selectedResourceId = ref(document.id);
  const activeCreationResourceId = ref("draft-directory-1");
  const selectedExpertSectionIds = ref<Record<string, string>>({
    "draft-directory-1": "section-1",
    untouched: "other"
  });
  const selectedDraftFileKinds = ref<
    Record<string, "body" | "character-state">
  >({
    "draft-directory-1": "body",
    untouched: "character-state"
  });

  const apiMocks = {
    createShortBook: vi.fn(async () =>
      fixtureBook("created-short", 1, "新短篇")
    ),
    createScriptBook: vi.fn(async () =>
      fixtureBook("created-script", 1, "新剧本")
    ),
    updateBook: vi.fn(async (input: { bookId: string; title?: string }) => {
      const current = books.get(input.bookId) ?? fixtureBook(input.bookId);
      const updated = {
        ...current,
        title: input.title ?? current.title,
        projectRevision: (current.projectRevision ?? 0) + 1
      } as Book;
      books.set(input.bookId, updated);
      return updated;
    }),
    unregisterProject: vi.fn(async () => ({
      domain: "book" as const,
      projectId: target.bookId,
      unregistered: true
    })),
    deleteProject: vi.fn(async () => ({
      domain: "book" as const,
      projectId: target.bookId,
      deleted: true
    }))
  };
  const manuscriptApi = {
    exportShort: vi.fn(async () => ({
      status: "saved" as const,
      filePath: "/tmp/example.test-output.docx"
    }))
  };
  const refresh = vi.fn(async () => options.refreshResult ?? true);
  const refreshWorkspaceDirectory = vi.fn(async () => undefined);
  const prepareBookMutation = vi.fn(async () => options.prepareResult ?? true);
  const duplicateBook = vi.fn(async () => undefined);
  const openStructure = vi.fn(async () => true);
  const stopBookRuns = vi.fn(async () => undefined);
  const disposeBook = vi.fn(async () => undefined);
  const removeRunPreferences = vi.fn(async () => undefined);
  const selectPreferredBook = vi.fn(async () => true);
  const settleUi = vi.fn(async () => undefined);
  const fallbackCreationResourceId = vi.fn(() => "fallback-book:document");
  const legacy = {
    hasBook: vi.fn(() => false),
    rename: vi.fn(async () => undefined),
    updateBindings: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined)
  };
  const ensureDocumentsLoaded = vi.fn(async () => true);
  const writeClipboardText = vi.fn(async (_text: string) => undefined);
  const notifications = {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  };

  const coordinator = useShortBookLifecycleCoordinator({
    state: {
      dialogIntent,
      bookDialogMode,
      activeBook,
      exportBookTarget,
      manuscriptExportPending,
      catalogMutationPending,
      createBookDialogOpen,
      documents,
      drafts,
      selectedResourceId,
      activeCreationResourceId,
      selectedExpertSectionIds,
      selectedDraftFileKinds
    },
    catalog: {
      api: () => apiMocks as unknown as DeepWriteApi["catalog"],
      book: (bookId) => books.get(bookId),
      refresh,
      refreshWorkspaceDirectory,
      isConflict: (error) =>
        error instanceof Error && error.message === "catalog-conflict"
    },
    preparation: { prepareBookMutation },
    structure: { duplicateBook, openStructure },
    conversations: {
      stopBookRuns,
      disposeBook,
      removeRunPreferences
    },
    resources: {
      selectPreferredBook,
      settleUi,
      fallbackCreationResourceId
    },
    legacy,
    manuscript: {
      api: () => manuscriptApi as unknown as DeepWriteApi["manuscript"],
      ensureDocumentsLoaded
    },
    clipboard: { writeText: writeClipboardText },
    notifications
  });

  function showDialog(
    nextTarget: ShortBookLifecycleTarget,
    mode: NonNullable<typeof bookDialogMode.value>
  ): void {
    dialogIntent.value = nextTarget.requestId;
    activeBook.value = nextTarget;
    bookDialogMode.value = mode;
  }

  return {
    coordinator,
    books,
    target,
    dialogIntent,
    bookDialogMode,
    activeBook,
    exportBookTarget,
    manuscriptExportPending,
    catalogMutationPending,
    createBookDialogOpen,
    documents,
    drafts,
    selectedResourceId,
    activeCreationResourceId,
    selectedExpertSectionIds,
    selectedDraftFileKinds,
    apiMocks,
    manuscriptApi,
    refresh,
    refreshWorkspaceDirectory,
    prepareBookMutation,
    duplicateBook,
    openStructure,
    stopBookRuns,
    disposeBook,
    removeRunPreferences,
    selectPreferredBook,
    settleUi,
    fallbackCreationResourceId,
    legacy,
    ensureDocumentsLoaded,
    writeClipboardText,
    notifications,
    showDialog
  };
}

describe("useShortBookLifecycleCoordinator", () => {
  it("prepares dirty state and uses the post-save authoritative revision for rename CAS", async () => {
    const harness = createHarness();
    harness.prepareBookMutation.mockImplementationOnce(async () => {
      harness.books.set("book-1", fixtureBook("book-1", 5));
      return true;
    });

    await harness.coordinator.renameBook({
      bookId: "book-1",
      label: "  新名称  "
    });

    expect(harness.prepareBookMutation).toHaveBeenCalledWith("book-1");
    expect(harness.apiMocks.updateBook).toHaveBeenCalledWith({
      bookId: "book-1",
      baseProjectRevision: 5,
      title: "新名称"
    });
    expect(harness.activeBook.value).toBeNull();
    expect(harness.notifications.success).toHaveBeenCalledTimes(1);
  });

  it("rejects missing or already stale dialog revisions before any CAS write", async () => {
    const missing = createHarness({
      book: fixtureBook("book-1", undefined),
      target: fixtureTarget({ projectRevision: undefined })
    });
    await missing.coordinator.renameBook({ bookId: "book-1", label: "新名称" });
    expect(missing.prepareBookMutation).not.toHaveBeenCalled();
    expect(missing.apiMocks.updateBook).not.toHaveBeenCalled();
    expect(missing.notifications.error).toHaveBeenCalledTimes(1);

    const stale = createHarness({ book: fixtureBook("book-1", 5) });
    await stale.coordinator.renameBook({ bookId: "book-1", label: "新名称" });
    expect(stale.prepareBookMutation).not.toHaveBeenCalled();
    expect(stale.apiMocks.updateBook).not.toHaveBeenCalled();
    expect(stale.notifications.warning).toHaveBeenCalledTimes(1);
  });

  it("keeps a newer binding dialog when an older update completes", async () => {
    const harness = createHarness({ mode: "bind-skill" });
    const update = deferred<Book>();
    harness.apiMocks.updateBook.mockImplementationOnce(() => update.promise);
    const operation = harness.coordinator.updateBookBindings({
      bookId: "book-1",
      domain: "skill",
      linksByKind: {
        general: ["skill-example"],
        plot: [],
        style: [],
        other: []
      }
    });
    await waitFor(() => harness.apiMocks.updateBook.mock.calls.length === 1);

    const newer = fixtureTarget({ requestId: 2, label: "另一目标" });
    harness.showDialog(newer, "bind-material");
    update.resolve(fixtureBook("book-1", 5));
    await operation;

    expect(harness.activeBook.value).toBe(newer);
    expect(harness.bookDialogMode.value).toBe("bind-material");
    expect(harness.notifications.success).not.toHaveBeenCalled();
  });

  it("does not acquire or clear a foreign catalog pending flag", async () => {
    const harness = createHarness({ catalogPending: true });
    await harness.coordinator.renameBook({ bookId: "book-1", label: "新名称" });
    expect(harness.prepareBookMutation).not.toHaveBeenCalled();
    expect(harness.apiMocks.updateBook).not.toHaveBeenCalled();
    expect(harness.catalogMutationPending.value).toBe(true);
  });

  it("single-flights the shared catalog lane", async () => {
    const harness = createHarness();
    const prepare = deferred<boolean>();
    harness.prepareBookMutation.mockImplementationOnce(() => prepare.promise);
    const first = harness.coordinator.renameBook({
      bookId: "book-1",
      label: "第一次"
    });
    const second = harness.coordinator.renameBook({
      bookId: "book-1",
      label: "第二次"
    });
    expect(harness.catalogMutationPending.value).toBe(true);
    prepare.resolve(true);
    await Promise.all([first, second]);
    expect(harness.apiMocks.updateBook).toHaveBeenCalledTimes(1);
    expect(harness.catalogMutationPending.value).toBe(false);
  });

  it("blocks removal when draft preparation fails and preserves local state", async () => {
    const harness = createHarness({ mode: "remove", prepareResult: false });
    await harness.coordinator.removeBook("book-1");
    expect(harness.stopBookRuns).not.toHaveBeenCalled();
    expect(harness.apiMocks.unregisterProject).not.toHaveBeenCalled();
    expect(harness.disposeBook).not.toHaveBeenCalled();
    expect(harness.drafts.value["body-1"]).toBeDefined();
  });

  it("does not issue destructive I/O when a busy controller cannot stop", async () => {
    const harness = createHarness({ mode: "delete" });
    harness.stopBookRuns.mockRejectedValueOnce(new Error("stop rejected"));
    await harness.coordinator.deleteBook("book-1");
    expect(harness.apiMocks.deleteProject).not.toHaveBeenCalled();
    expect(harness.disposeBook).not.toHaveBeenCalled();
    expect(harness.drafts.value["body-1"]).toBeDefined();
    expect(harness.notifications.error).toHaveBeenCalledWith("stop rejected");
  });

  it("keeps drafts and controllers when the destructive API fails", async () => {
    const harness = createHarness({ mode: "remove" });
    harness.apiMocks.unregisterProject.mockRejectedValueOnce(
      new Error("unregister failed")
    );
    await harness.coordinator.removeBook("book-1");
    expect(harness.stopBookRuns).toHaveBeenCalledWith("book-1");
    expect(harness.disposeBook).not.toHaveBeenCalled();
    expect(harness.removeRunPreferences).not.toHaveBeenCalled();
    expect(harness.drafts.value["body-1"]).toBeDefined();
  });

  it("cleans durable runtime state and only compensates unchanged selections", async () => {
    const harness = createHarness({ mode: "delete" });
    const deletion = deferred<{
      domain: "book";
      projectId: string;
      deleted: boolean;
    }>();
    harness.apiMocks.deleteProject.mockImplementationOnce(
      () => deletion.promise
    );
    const operation = harness.coordinator.deleteBook("book-1");
    await waitFor(() => harness.apiMocks.deleteProject.mock.calls.length === 1);
    harness.selectedResourceId.value = "user-selected-other-resource";
    deletion.resolve({ domain: "book", projectId: "book-1", deleted: true });
    await operation;

    expect(harness.disposeBook).toHaveBeenCalledWith("book-1", {
      clearPersistence: true
    });
    expect(harness.removeRunPreferences).toHaveBeenCalledWith("book:book-1");
    expect(harness.drafts.value["body-1"]).toBeUndefined();
    expect(harness.drafts.value.untouched).toBeDefined();
    expect(
      harness.selectedExpertSectionIds.value["draft-directory-1"]
    ).toBeUndefined();
    expect(
      harness.selectedDraftFileKinds.value["draft-directory-1"]
    ).toBeUndefined();
    expect(harness.selectedResourceId.value).toBe(
      "user-selected-other-resource"
    );
    expect(harness.activeCreationResourceId.value).toBe(
      "fallback-book:document"
    );
  });

  it("allows unavailable books to unregister but never to delete", async () => {
    const unavailableTarget = fixtureTarget({ unavailable: true });
    const remove = createHarness({
      book: null,
      target: unavailableTarget,
      mode: "remove"
    });
    await remove.coordinator.removeBook("book-1");
    expect(remove.apiMocks.unregisterProject).toHaveBeenCalledTimes(1);
    expect(remove.apiMocks.deleteProject).not.toHaveBeenCalled();

    const deletion = createHarness({
      book: null,
      target: fixtureTarget({ unavailable: true }),
      mode: "delete"
    });
    await deletion.coordinator.deleteBook("book-1");
    expect(deletion.apiMocks.deleteProject).not.toHaveBeenCalled();
    expect(deletion.notifications.error).toHaveBeenCalledTimes(1);
  });

  it("reports committed removal with failed refresh and blocks destructive retry", async () => {
    const harness = createHarness({ mode: "remove", refreshResult: false });
    await harness.coordinator.removeBook("book-1");
    expect(harness.notifications.warning).toHaveBeenCalledWith(
      expect.stringContaining("作品列表刷新失败")
    );

    const retryTarget = fixtureTarget({ requestId: 2 });
    harness.showDialog(retryTarget, "remove");
    await harness.coordinator.removeBook("book-1");
    expect(harness.apiMocks.unregisterProject).toHaveBeenCalledTimes(1);
    expect(harness.notifications.info).toHaveBeenCalledTimes(1);
  });

  it("finishes cleanup for an issued deletion during dispose and suppresses late UI", async () => {
    const harness = createHarness({ mode: "delete" });
    const deletion = deferred<{
      domain: "book";
      projectId: string;
      deleted: boolean;
    }>();
    harness.apiMocks.deleteProject.mockImplementationOnce(
      () => deletion.promise
    );
    const operation = harness.coordinator.deleteBook("book-1");
    await waitFor(() => harness.apiMocks.deleteProject.mock.calls.length === 1);
    const disposal = harness.coordinator.dispose();
    let disposed = false;
    void disposal.then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);

    deletion.resolve({ domain: "book", projectId: "book-1", deleted: true });
    await Promise.all([operation, disposal]);
    expect(harness.disposeBook).toHaveBeenCalledTimes(1);
    expect(harness.drafts.value["body-1"]).toBeUndefined();
    expect(harness.notifications.success).not.toHaveBeenCalled();
    expect(harness.catalogMutationPending.value).toBe(false);
  });

  it("creates short and script books, refreshes, then selects only current results", async () => {
    const short = createHarness();
    await short.coordinator.createBook({
      workspaceType: "short",
      title: "新短篇",
      genre: "其他",
      linkedMaterialIdsByKind: {},
      linkedSkillIdsByKind: {}
    });
    expect(short.apiMocks.createShortBook).toHaveBeenCalledTimes(1);
    expect(short.selectPreferredBook).toHaveBeenCalledWith("created-short");
    expect(short.createBookDialogOpen.value).toBe(false);

    const script = createHarness({ refreshResult: false });
    await script.coordinator.createBook({
      workspaceType: "script",
      title: "新剧本",
      genre: "其他",
      linkedMaterialIdsByKind: {},
      linkedSkillIdsByKind: {}
    });
    expect(script.apiMocks.createScriptBook).toHaveBeenCalledTimes(1);
    expect(script.selectPreferredBook).not.toHaveBeenCalled();
    expect(script.notifications.warning).toHaveBeenCalledWith(
      expect.stringContaining("作品列表刷新失败")
    );
  });

  it("guards export after hydration and builds saved output from live drafts", async () => {
    const harness = createHarness();
    harness.exportBookTarget.value = harness.target;
    const hydration = deferred<boolean>();
    harness.ensureDocumentsLoaded.mockImplementationOnce(
      () => hydration.promise
    );
    const staleExport = harness.coordinator.exportBookManuscript("docx");
    const newer = fixtureTarget({ requestId: 2, label: "新导出目标" });
    harness.dialogIntent.value = 2;
    harness.exportBookTarget.value = newer;
    hydration.resolve(true);
    await staleExport;
    expect(harness.manuscriptApi.exportShort).not.toHaveBeenCalled();
    expect(harness.exportBookTarget.value).toBe(newer);

    harness.books.set("book-1", fixtureBook("book-1", 4, "实时书名"));
    await harness.coordinator.exportBookManuscript("docx");
    expect(harness.manuscriptApi.exportShort).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "实时书名",
        sections: expect.arrayContaining([
          expect.objectContaining({ content: "编辑器实时正文" })
        ])
      })
    );
    expect(harness.exportBookTarget.value).toBeNull();
  });

  it("copies the hydrated live manuscript without opening a save dialog", async () => {
    const harness = createHarness();
    harness.exportBookTarget.value = harness.target;
    harness.books.set("book-1", fixtureBook("book-1", 4, "实时书名"));

    await harness.coordinator.exportBookManuscript("clipboard");

    expect(harness.writeClipboardText).toHaveBeenCalledWith(
      expect.stringContaining("《实时书名》\n\n编辑器新标题\n\n编辑器实时正文")
    );
    expect(harness.manuscriptApi.exportShort).not.toHaveBeenCalled();
    expect(harness.exportBookTarget.value).toBeNull();
    expect(harness.notifications.success).toHaveBeenCalledWith(
      "已复制“实时书名”的导语和全部小节正文，可直接粘贴"
    );
  });

  it("delegates duplicate and structure commands without stealing their catalog lease", async () => {
    const harness = createHarness();
    await harness.coordinator.duplicateBook(harness.target);
    expect(harness.duplicateBook).toHaveBeenCalledWith(harness.target.node);
    expect(harness.catalogMutationPending.value).toBe(false);

    await harness.coordinator.manageStructure(harness.target);
    expect(harness.openStructure).toHaveBeenCalledWith("book-1");
  });

  it("preserves explicit legacy rename, bindings, and remove fallbacks", async () => {
    const target = fixtureTarget({ projectRevision: undefined });
    const harness = createHarness({ book: null, target, mode: "rename" });
    harness.legacy.hasBook.mockReturnValue(true);
    await harness.coordinator.renameBook({
      bookId: "book-1",
      label: "旧项目新名"
    });
    expect(harness.legacy.rename).toHaveBeenCalledWith(target, "旧项目新名");

    const bindingsTarget = fixtureTarget({
      requestId: 2,
      projectRevision: undefined
    });
    harness.showDialog(bindingsTarget, "bind-material");
    await harness.coordinator.updateBookBindings({
      bookId: "book-1",
      domain: "material",
      linksByKind: {
        character: ["material-example"],
        gimmick: [],
        plot: [],
        draft: [],
        other: []
      }
    });
    expect(harness.legacy.updateBindings).toHaveBeenCalledTimes(1);

    const removeTarget = fixtureTarget({
      requestId: 3,
      projectRevision: undefined
    });
    harness.showDialog(removeTarget, "remove");
    await harness.coordinator.removeBook("book-1");
    expect(harness.legacy.remove).toHaveBeenCalledTimes(1);
  });
});
