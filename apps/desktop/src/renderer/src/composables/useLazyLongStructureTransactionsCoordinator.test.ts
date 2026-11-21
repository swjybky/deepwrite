import type {
  LongBookSummary,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import {
  LONG_BOOK_LINE_FILE_ID,
  LongWorkspaceIndexSnapshotSchema
} from "@deepwrite/contracts";
import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  useLazyLongStructureTransactionsCoordinator,
  type LongStructureTransactionsCoordinatorModule
} from "./useLazyLongStructureTransactionsCoordinator";
import type {
  LongStructureTransactionsCoordinator,
  LongStructureTransactionsCoordinatorOptions
} from "./useLongStructureTransactionsCoordinator";

const BOOK_ID = "longbook_lazy_structure";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function flushMicrotasks(turns = 8): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}

function fakeBook(
  id = BOOK_ID,
  categoryIds = ["world_normal", "world_migration-evidence-legacy"]
): LongBookSummary {
  return {
    id,
    title: id,
    navigation: {
      worldbuilding: categoryIds.map((categoryId) => ({ id: categoryId }))
    }
  } as unknown as LongBookSummary;
}

function fakeIndex(): LongWorkspaceIndexSnapshot {
  const updatedAt = "2026-08-14T08:00:00.000Z";
  return LongWorkspaceIndexSnapshotSchema.parse({
    schemaVersion: 1,
    bookId: BOOK_ID,
    updatedAt,
    bookLine: {
      id: LONG_BOOK_LINE_FILE_ID,
      path: "long/plot/book-line.md",
      updatedAt
    },
    worldbuilding: [],
    characters: [],
    characterFiles: [],
    plot: {
      volumes: [],
      arcs: [],
      chapterCards: [],
      storyEvents: [],
      storyPlots: [],
      eventConnections: [],
      narrativePlacements: [],
      foreshadowing: []
    },
    chapters: [],
    ledger: { committedThroughChapterId: null, commits: [] }
  });
}

function createLoadedCoordinator() {
  const raw = {
    longWorldbuildingSyncBookOptions: computed(() => []),
    requestCreateLongDraftSection: vi.fn(async () => undefined),
    handleLongDraftSectionAction: vi.fn(async () => undefined),
    handleCreateLongTreeItem: vi.fn(async () => undefined),
    handleLongTreeItemAction: vi.fn(async () => undefined),
    confirmDeleteLongTreeItem: vi.fn(async () => undefined),
    confirmDeleteLongDraftSection: vi.fn(async () => undefined),
    renameLongCharacter: vi.fn(async () => undefined),
    renameLongStructureTitle: vi.fn(async () => undefined),
    openLongCharacterCreate: vi.fn(),
    openLongWorldbuildingItemCreate: vi.fn(async () => undefined),
    openLongVolumeCreate: vi.fn(async () => undefined),
    openLongPlotPointCreate: vi.fn(async () => undefined),
    saveLongVolumeOutline: vi.fn(async () => undefined),
    saveLongPlotPointContent: vi.fn(async () => undefined),
    createLongVolume: vi.fn(async () => undefined),
    createLongWorldbuildingItem: vi.fn(async () => undefined),
    createLongPlotPoint: vi.fn(async () => undefined),
    createLongChapterCard: vi.fn(async () => undefined),
    handleLongStructureMutation: vi.fn(async () => undefined),
    handleActiveLongStructureMutation: vi.fn(async () => undefined),
    handleLongWorldbuildingSync: vi.fn(async () => undefined),
    deleteActiveLongNavigationStructure: vi.fn(async () => undefined),
    createLongCharacter: vi.fn(async () => undefined),
    closeLongStructureDialog: vi.fn(),
    closeLongCharacterCreate: vi.fn(),
    closeLongWorldbuildingItemCreate: vi.fn(),
    closeLongPlotPointCreate: vi.fn(),
    closeLongChapterCardCreate: vi.fn(),
    closeLongDraftSectionDelete: vi.fn(),
    closeLongTreeItemDelete: vi.fn(),
    closeLongVolumeCreate: vi.fn(),
    drain: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined)
  };
  return {
    raw,
    coordinator: raw as unknown as LongStructureTransactionsCoordinator
  };
}

function createContext(input: { readonly pending?: boolean } = {}) {
  const state = {
    longBooks: ref<readonly LongBookSummary[]>([fakeBook()]),
    activeBookId: ref<string | null>(BOOK_ID),
    activeBookSummary: ref<LongBookSummary | null>(fakeBook()),
    workspaceIndex: ref<LongWorkspaceIndexSnapshot | null>(fakeIndex()),
    selection: ref(null),
    mutationPending: ref(input.pending ?? false),
    structureDialogOpen: ref(true),
    characterCreateTarget: ref<object | null>({ bookId: BOOK_ID }),
    worldbuildingItemCreateTarget: ref<object | null>({
      bookId: BOOK_ID,
      categoryId: "world_factions",
      categoryTitle: "势力"
    }),
    plotPointCreateTarget: ref<object | null>({
      bookId: BOOK_ID,
      volumeId: "volume_a",
      volumeTitle: "第一卷"
    }),
    chapterCardCreateTarget: ref<object | null>({
      bookId: BOOK_ID,
      volumeId: "volume_a",
      volumeTitle: "第一卷",
      arcOptions: [],
      source: "chapter-card"
    }),
    draftSectionDeleteTarget: ref<object | null>({
      bookId: BOOK_ID,
      chapterCardId: "chapter_a",
      volumeId: "volume_a",
      title: "第一章"
    }),
    treeItemDeleteTarget: ref<object | null>({ bookId: BOOK_ID }),
    volumeCreateTarget: ref<{
      readonly bookId: string;
      readonly source: "book-line" | "draft";
    } | null>({
      bookId: BOOK_ID,
      source: "book-line"
    }),
    selectedResourceId: ref("")
  };
  const notifications = {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  };
  const context = {
    api: () => undefined,
    state,
    session: {
      saveActiveEditorChanges: vi.fn(async () => true),
      saveActiveEditorBeforeLeaving: vi.fn(async () => true),
      openBook: vi.fn(async () => undefined),
      refreshActiveWorkspace: vi.fn(async () => true),
      refreshWorkspaceAfterProposal: vi.fn(async () => true),
      selectWorkspaceFile: vi.fn(async () => true),
      editor: ref(null)
    },
    resources: {
      node: vi.fn(() => undefined),
      select: vi.fn(async () => undefined),
      synchronizeSelectedResourceForLayout: vi.fn(),
      revealEditor: vi.fn()
    },
    notifications
  } as unknown as LongStructureTransactionsCoordinatorOptions;
  return { context, notifications, state };
}

function moduleFor(coordinator: LongStructureTransactionsCoordinator) {
  return {
    useLongStructureTransactionsCoordinator: vi.fn(() => coordinator)
  };
}

describe("useLazyLongStructureTransactionsCoordinator", () => {
  it("projects worldbuilding book options synchronously without loading", () => {
    const loadModule =
      vi.fn<() => Promise<LongStructureTransactionsCoordinatorModule>>();
    const test = createContext();
    const lazy = useLazyLongStructureTransactionsCoordinator(
      test.context,
      loadModule
    );

    expect(lazy.longWorldbuildingSyncBookOptions.value).toEqual([
      { id: BOOK_ID, title: BOOK_ID, categoryCount: 1 }
    ]);
    test.state.longBooks.value = [
      fakeBook("longbook_second", ["world_one", "world_two"])
    ];
    expect(lazy.longWorldbuildingSyncBookOptions.value).toEqual([
      { id: "longbook_second", title: "longbook_second", categoryCount: 2 }
    ]);
    expect(loadModule).not.toHaveBeenCalled();
  });

  it("closes every dialog target synchronously without loading and respects pending", () => {
    const loadModule =
      vi.fn<() => Promise<LongStructureTransactionsCoordinatorModule>>();
    const test = createContext();
    const lazy = useLazyLongStructureTransactionsCoordinator(
      test.context,
      loadModule
    );

    lazy.closeLongStructureDialog();
    lazy.closeLongCharacterCreate();
    lazy.closeLongWorldbuildingItemCreate();
    lazy.closeLongPlotPointCreate();
    lazy.closeLongChapterCardCreate();
    lazy.closeLongDraftSectionDelete();
    lazy.closeLongTreeItemDelete();
    lazy.closeLongVolumeCreate();

    expect(test.state.structureDialogOpen.value).toBe(false);
    expect(test.state.characterCreateTarget.value).toBeNull();
    expect(test.state.worldbuildingItemCreateTarget.value).toBeNull();
    expect(test.state.plotPointCreateTarget.value).toBeNull();
    expect(test.state.chapterCardCreateTarget.value).toBeNull();
    expect(test.state.draftSectionDeleteTarget.value).toBeNull();
    expect(test.state.treeItemDeleteTarget.value).toBeNull();
    expect(test.state.volumeCreateTarget.value).toBeNull();
    expect(loadModule).not.toHaveBeenCalled();

    const pending = createContext({ pending: true });
    const pendingLazy = useLazyLongStructureTransactionsCoordinator(
      pending.context,
      loadModule
    );
    pendingLazy.closeLongStructureDialog();
    pendingLazy.closeLongVolumeCreate();
    expect(pending.state.structureDialogOpen.value).toBe(true);
    expect(pending.state.volumeCreateTarget.value).not.toBeNull();
  });

  it("shares one load without globally serializing independent mutations", async () => {
    const loading = deferred<LongStructureTransactionsCoordinatorModule>();
    const loaded = createLoadedCoordinator();
    const firstMutation = deferred<undefined>();
    loaded.raw.saveLongVolumeOutline.mockImplementation(
      () => firstMutation.promise
    );
    const loadModule = vi.fn(() => loading.promise);
    const test = createContext();
    const lazy = useLazyLongStructureTransactionsCoordinator(
      test.context,
      loadModule
    );
    const volumeCompletion = vi.fn();
    const plotCompletion = vi.fn();

    const volumeSave = lazy.saveLongVolumeOutline(
      { volumeId: "volume_a", outline: "卷纲" },
      volumeCompletion
    );
    const plotSave = lazy.saveLongPlotPointContent(
      {
        plotPointId: "plot_a",
        field: "summary",
        content: "剧情点"
      },
      plotCompletion
    );
    expect(loadModule).toHaveBeenCalledOnce();
    loading.resolve(moduleFor(loaded.coordinator));
    await flushMicrotasks();

    expect(loaded.raw.saveLongVolumeOutline).toHaveBeenCalledOnce();
    expect(loaded.raw.saveLongPlotPointContent).toHaveBeenCalledOnce();
    await plotSave;
    firstMutation.resolve(undefined);
    await volumeSave;
  });

  it("cancels a target-bound call when close or a new target wins during load", async () => {
    const firstLoading = deferred<LongStructureTransactionsCoordinatorModule>();
    const firstLoaded = createLoadedCoordinator();
    const first = createContext();
    const firstLazy = useLazyLongStructureTransactionsCoordinator(
      first.context,
      vi.fn(() => firstLoading.promise)
    );
    const creating = firstLazy.createLongVolume({
      title: "第一卷",
      summary: ""
    });
    firstLazy.closeLongVolumeCreate();
    firstLoading.resolve(moduleFor(firstLoaded.coordinator));
    await creating;
    expect(firstLoaded.raw.createLongVolume).not.toHaveBeenCalled();

    const secondLoading =
      deferred<LongStructureTransactionsCoordinatorModule>();
    const secondLoaded = createLoadedCoordinator();
    const second = createContext();
    const secondLazy = useLazyLongStructureTransactionsCoordinator(
      second.context,
      vi.fn(() => secondLoading.promise)
    );
    const staleCreating = secondLazy.createLongVolume({
      title: "旧目标",
      summary: ""
    });
    second.state.volumeCreateTarget.value = {
      bookId: "longbook_new_target",
      source: "book-line"
    };
    secondLoading.resolve(moduleFor(secondLoaded.coordinator));
    await staleCreating;
    expect(secondLoaded.raw.createLongVolume).not.toHaveBeenCalled();
  });

  it("catches failures from void entries and reports them", async () => {
    const loaded = createLoadedCoordinator();
    loaded.raw.requestCreateLongDraftSection.mockRejectedValue(
      new Error("void structure failed")
    );
    const test = createContext();
    const lazy = useLazyLongStructureTransactionsCoordinator(
      test.context,
      async () => moduleFor(loaded.coordinator)
    );

    await expect(
      lazy.requestCreateLongDraftSection({} as never)
    ).resolves.toBeUndefined();

    expect(test.notifications.error).toHaveBeenCalledWith(
      "void structure failed"
    );
  });

  it("retries a failed load and does not let failure block cleanup", async () => {
    const loaded = createLoadedCoordinator();
    const module = moduleFor(loaded.coordinator);
    const loadModule = vi
      .fn<() => Promise<LongStructureTransactionsCoordinatorModule>>()
      .mockRejectedValueOnce(new Error("structure chunk failed"))
      .mockResolvedValueOnce(module);
    const test = createContext();
    const lazy = useLazyLongStructureTransactionsCoordinator(
      test.context,
      loadModule
    );

    await lazy.openLongVolumeCreate();
    expect(test.notifications.error).toHaveBeenCalledWith(
      "structure chunk failed"
    );
    await lazy.openLongPlotPointCreate();
    expect(loadModule).toHaveBeenCalledTimes(2);
    expect(loaded.raw.openLongPlotPointCreate).toHaveBeenCalledOnce();

    await lazy.dispose();
    expect(loaded.raw.dispose).toHaveBeenCalledOnce();
  });

  it("disposes safely when unloaded, loading, or already loaded", async () => {
    const unloadedLoader =
      vi.fn<() => Promise<LongStructureTransactionsCoordinatorModule>>();
    const unloaded = createContext();
    const unloadedLazy = useLazyLongStructureTransactionsCoordinator(
      unloaded.context,
      unloadedLoader
    );
    await unloadedLazy.dispose();
    expect(unloadedLoader).not.toHaveBeenCalled();

    const loadingModule =
      deferred<LongStructureTransactionsCoordinatorModule>();
    const loadingLoaded = createLoadedCoordinator();
    const loadingContext = createContext();
    const loadingLazy = useLazyLongStructureTransactionsCoordinator(
      loadingContext.context,
      vi.fn(() => loadingModule.promise)
    );
    const opening = loadingLazy.openLongVolumeCreate();
    let disposeSettled = false;
    const disposing = loadingLazy.dispose().then(() => {
      disposeSettled = true;
    });
    await flushMicrotasks();
    expect(disposeSettled).toBe(false);
    loadingModule.resolve(moduleFor(loadingLoaded.coordinator));
    await Promise.all([opening, disposing]);
    expect(loadingLoaded.raw.openLongVolumeCreate).not.toHaveBeenCalled();
    expect(loadingLoaded.raw.dispose).toHaveBeenCalledOnce();

    const readyLoaded = createLoadedCoordinator();
    const ready = createContext();
    const readyLazy = useLazyLongStructureTransactionsCoordinator(
      ready.context,
      async () => moduleFor(readyLoaded.coordinator)
    );
    await readyLazy.openLongVolumeCreate();
    await readyLazy.dispose();
    expect(readyLoaded.raw.dispose).toHaveBeenCalledOnce();
  });
});
