import type { LongBookSummary } from "@deepwrite/contracts";
import { computed, ref, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import type {
  LongBookLifecycleCoordinator,
  LongBookLifecycleCoordinatorOptions
} from "./useLongBookLifecycleCoordinator";
import {
  useLazyLongBookLifecycleCoordinator,
  type LongBookLifecycleModuleLoader
} from "./useLazyLongBookLifecycleCoordinator";

const BOOK_ID = "longbook_lazy_lifecycle";

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

function createContext(): LongBookLifecycleCoordinatorOptions {
  const longBooks = shallowRef<readonly LongBookSummary[]>([]);
  const activeBookId = ref<string | null>(null);
  return {
    api: () => undefined,
    state: {
      longBooks,
      activeBookId,
      activeBookSummary: computed(() => null),
      workspaceIndex: shallowRef(null),
      refreshStatus: shallowRef(null),
      mutationPending: ref(false),
      bookActionPending: ref(false),
      manuscriptExportPending: ref(false),
      continuationImportPreview: shallowRef(null),
      legacySyncPreview: shallowRef(null),
      legacySyncResult: shallowRef(null),
      structureDialogOpen: ref(false),
      structureAgentsMd: ref<string | null>(null),
      structureAgentsMdPending: ref(false),
      exportTarget: shallowRef(null),
      bookRenameTarget: shallowRef(null),
      bookRemovalTarget: shallowRef(null),
      createBookDialogOpen: ref(false),
      selectedResourceId: ref("")
    },
    session: {
      activateOpenedBook: vi.fn(),
      loadAgentSettings: vi.fn(),
      saveActiveEditorChanges: vi.fn(async () => true),
      saveActiveEditorBeforeLeaving: vi.fn(async () => true),
      openBook: vi.fn(async () => undefined),
      refreshActiveWorkspace: vi.fn(async () => true),
      clearActiveBook: vi.fn(async () => undefined),
      invalidateWorkspaceRefresh: vi.fn(),
      selectWorkspaceFile: vi.fn(async () => true)
    },
    workflow: {
      stopBookAgentRuns: vi.fn(async () => undefined),
      quarantineBook: vi.fn(),
      reactivateBook: vi.fn(),
      disposeBookProposalState: vi.fn()
    },
    conversations: { disposeBookConversations: vi.fn() },
    catalog: {
      loadBookList: vi.fn(async () => undefined),
      refreshWorkspaceDirectory: vi.fn(async () => undefined)
    },
    resources: {
      selectBook: vi.fn(async () => undefined),
      showConversation: vi.fn(),
      revealEditor: vi.fn()
    },
    manuscript: {
      available: vi.fn(() => false),
      createInput: vi.fn(),
      exportLong: vi.fn()
    },
    scheduler: { settleUi: vi.fn(async () => undefined) },
    notifications: {
      error: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn()
    }
  };
}

function createCoordinatorStub(
  overrides: Partial<LongBookLifecycleCoordinator> = {}
): LongBookLifecycleCoordinator {
  return {
    activateLongBookWorkspace: vi.fn(),
    createLongBook: vi.fn(async () => undefined),
    openExistingLongBook: vi.fn(async () => undefined),
    chooseContinuationImportSource: vi.fn(async () => undefined),
    importPortableLongBook: vi.fn(async () => undefined),
    confirmContinuationImport: vi.fn(async () => undefined),
    closeContinuationImportDialog: vi.fn(),
    handleLongBookAction: vi.fn(async () => undefined),
    closeLegacySyncDialog: vi.fn(),
    confirmLegacySync: vi.fn(async () => undefined),
    closeLongExportDialog: vi.fn(),
    exportLongBookManuscript: vi.fn(async () => undefined),
    closeLongBookRenameDialog: vi.fn(),
    renameLongBook: vi.fn(async () => undefined),
    closeLongBookRemovalDialog: vi.fn(),
    confirmLongBookRemoval: vi.fn(async () => undefined),
    saveLongAgentsMd: vi.fn(async () => undefined),
    drain: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
    ...overrides
  };
}

function action(action: "rename" | "duplicate") {
  return {
    action,
    node: {
      id: `long-book:${BOOK_ID}`,
      label: "懒加载长篇",
      catalogNodeType: "long-book",
      longBookId: BOOK_ID,
      workspaceType: "long"
    }
  } as const;
}

describe("useLazyLongBookLifecycleCoordinator", () => {
  it("does not load for synchronous dialog closes or dispose before first use", async () => {
    const context = createContext();
    context.state.bookRenameTarget.value = {
      bookId: BOOK_ID,
      title: "旧名称"
    };
    const loadModule = vi.fn<LongBookLifecycleModuleLoader>();
    const lazy = useLazyLongBookLifecycleCoordinator(context, loadModule);

    lazy.closeLongBookRenameDialog();
    expect(context.state.bookRenameTarget.value).toBeNull();
    expect(loadModule).not.toHaveBeenCalled();

    await lazy.dispose();
    await lazy.createLongBook({ title: "不会创建" } as never);
    expect(loadModule).not.toHaveBeenCalled();
  });

  it("shares one module load without serializing independent coordinator calls", async () => {
    const moduleLoad = deferred<{
      useLongBookLifecycleCoordinator(): LongBookLifecycleCoordinator;
    }>();
    const firstOperation = deferred<void>();
    const coordinator = createCoordinatorStub({
      createLongBook: vi.fn(() => firstOperation.promise),
      openExistingLongBook: vi.fn(async () => undefined)
    });
    const loadModule = vi.fn(() => moduleLoad.promise);
    const lazy = useLazyLongBookLifecycleCoordinator(
      createContext(),
      loadModule
    );

    const creating = lazy.createLongBook({ title: "懒加载" } as never);
    const opening = lazy.openExistingLongBook();
    expect(loadModule).toHaveBeenCalledOnce();

    moduleLoad.resolve({
      useLongBookLifecycleCoordinator: () => coordinator
    });
    await flushMicrotasks();

    expect(coordinator.createLongBook).toHaveBeenCalledOnce();
    expect(coordinator.openExistingLongBook).toHaveBeenCalledOnce();
    await opening;
    firstOperation.resolve();
    await creating;
  });

  it("reports one shared load failure, retries, and remains disposable", async () => {
    const context = createContext();
    const coordinator = createCoordinatorStub();
    const loadModule = vi
      .fn<LongBookLifecycleModuleLoader>()
      .mockRejectedValueOnce(new Error("example.test chunk unavailable"))
      .mockResolvedValue({
        useLongBookLifecycleCoordinator: () => coordinator
      });
    const lazy = useLazyLongBookLifecycleCoordinator(context, loadModule);

    await expect(
      Promise.all([
        lazy.createLongBook({ title: "首次失败" } as never),
        lazy.openExistingLongBook()
      ])
    ).resolves.toBeDefined();
    expect(loadModule).toHaveBeenCalledTimes(1);
    expect(context.notifications.error).toHaveBeenCalledTimes(1);

    await expect(lazy.openExistingLongBook()).resolves.toBeUndefined();
    expect(loadModule).toHaveBeenCalledTimes(2);
    expect(coordinator.openExistingLongBook).toHaveBeenCalledOnce();
    await expect(lazy.dispose()).resolves.toBeUndefined();
    expect(coordinator.dispose).toHaveBeenCalledOnce();
  });

  it("waits for an in-progress load during dispose and immediately disposes the loaded instance", async () => {
    const moduleLoad = deferred<{
      useLongBookLifecycleCoordinator(): LongBookLifecycleCoordinator;
    }>();
    const coordinator = createCoordinatorStub();
    const lazy = useLazyLongBookLifecycleCoordinator(
      createContext(),
      vi.fn(() => moduleLoad.promise)
    );

    const pendingAction = lazy.createLongBook({ title: "加载中" } as never);
    let disposeSettled = false;
    const disposing = lazy.dispose().then(() => {
      disposeSettled = true;
    });
    await flushMicrotasks();
    expect(disposeSettled).toBe(false);

    moduleLoad.resolve({
      useLongBookLifecycleCoordinator: () => coordinator
    });
    await Promise.all([pendingAction, disposing]);

    expect(coordinator.dispose).toHaveBeenCalledOnce();
    expect(coordinator.createLongBook).not.toHaveBeenCalled();
    await lazy.openExistingLongBook();
    expect(coordinator.openExistingLongBook).not.toHaveBeenCalled();
  });

  it("delegates dispose after load and keeps all later calls as safe no-ops", async () => {
    const coordinator = createCoordinatorStub();
    const lazy = useLazyLongBookLifecycleCoordinator(
      createContext(),
      vi.fn(async () => ({
        useLongBookLifecycleCoordinator: () => coordinator
      }))
    );

    await lazy.openExistingLongBook();
    await lazy.dispose();
    await lazy.openExistingLongBook();
    lazy.closeLegacySyncDialog();

    expect(coordinator.openExistingLongBook).toHaveBeenCalledOnce();
    expect(coordinator.dispose).toHaveBeenCalledOnce();
    expect(coordinator.closeLegacySyncDialog).not.toHaveBeenCalled();
  });

  it("keeps close wrappers synchronous and cancels a dialog action still waiting on the chunk", async () => {
    const context = createContext();
    context.state.bookRenameTarget.value = {
      bookId: BOOK_ID,
      title: "旧目标"
    };
    const moduleLoad = deferred<{
      useLongBookLifecycleCoordinator(): LongBookLifecycleCoordinator;
    }>();
    const coordinator = createCoordinatorStub();
    const lazy = useLazyLongBookLifecycleCoordinator(
      context,
      vi.fn(() => moduleLoad.promise)
    );

    const pendingAction = lazy.handleLongBookAction(action("rename"));
    lazy.closeLongBookRenameDialog();
    expect(context.state.bookRenameTarget.value).toBeNull();

    moduleLoad.resolve({
      useLongBookLifecycleCoordinator: () => coordinator
    });
    await pendingAction;

    expect(coordinator.handleLongBookAction).not.toHaveBeenCalled();
  });
});
