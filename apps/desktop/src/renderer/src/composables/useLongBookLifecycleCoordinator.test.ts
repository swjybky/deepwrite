import type {
  ExportLongManuscriptInput,
  LongBookSummary,
  LongOpenBookResult,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { computed, ref, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { LongBookResourceNodeActionPayload } from "../types/workspace";
import type { LongWorkspaceRendererApi } from "../types/longWorkspace";
import {
  useLongBookLifecycleCoordinator,
  type LongBookLifecycleCoordinatorOptions
} from "./useLongBookLifecycleCoordinator";

const NOW = "2026-08-14T08:00:00.000Z";
const BOOK_A = "longbook_lifecycle_alpha";
const BOOK_B = "longbook_lifecycle_beta";

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
  reject(error: unknown): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
  }
}

function workspaceIndex(
  bookId = BOOK_A,
  _sequence = 1
): LongWorkspaceIndexSnapshot {
  return {
    bookId,
    updatedAt: NOW,
    worldbuilding: [],
    characters: [],
    characterFiles: [],
    plot: {
      volumes: [],
      arcs: [],
      chapterCards: [],
      storyEvents: []
    },
    chapters: []
  } as unknown as LongWorkspaceIndexSnapshot;
}

function bookSummary(
  bookId = BOOK_A,
  _sequence = 1,
  title = `长篇 ${bookId}`
): LongBookSummary {
  return {
    id: bookId,
    title,
    updatedAt: NOW,
    navigation: {
      bookId,
      updatedAt: NOW,
      worldbuilding: [],
      characterTypes: [],
      characters: [],
      volumes: [],
      arcs: [],
      chapterCards: [],
      counts: {}
    }
  } as unknown as LongBookSummary;
}

function openedBook(
  bookId = BOOK_A,
  sequence = 1,
  title = `长篇 ${bookId}`
): LongOpenBookResult {
  return {
    book: {
      id: bookId,
      title,
      workspaceIndex: workspaceIndex(bookId, sequence)
    },
    summary: bookSummary(bookId, sequence, title)
  } as unknown as LongOpenBookResult;
}

function bookAction(
  action: LongBookResourceNodeActionPayload["action"],
  bookId = BOOK_A,
  label = `长篇 ${bookId}`
): LongBookResourceNodeActionPayload {
  return {
    action,
    node: {
      id: `long-book:${bookId}`,
      label,
      catalogNodeType: "long-book",
      longBookId: bookId,
      workspaceType: "long"
    }
  } as LongBookResourceNodeActionPayload;
}

interface HarnessOverrides {
  readonly activeBookId?: string | null;
  readonly books?: readonly LongBookSummary[];
  readonly api?: Partial<LongWorkspaceRendererApi>;
  readonly session?: Partial<LongBookLifecycleCoordinatorOptions["session"]>;
  readonly workflow?: Partial<LongBookLifecycleCoordinatorOptions["workflow"]>;
  readonly conversations?: Partial<
    LongBookLifecycleCoordinatorOptions["conversations"]
  >;
  readonly catalog?: Partial<LongBookLifecycleCoordinatorOptions["catalog"]>;
  readonly manuscript?: Partial<
    LongBookLifecycleCoordinatorOptions["manuscript"]
  >;
}

function createHarness(overrides: HarnessOverrides = {}) {
  const activeBookId = ref<string | null>(
    overrides.activeBookId === undefined ? BOOK_A : overrides.activeBookId
  );
  const longBooks = shallowRef<readonly LongBookSummary[]>(
    overrides.books ?? [bookSummary()]
  );
  const activeBookSummary = computed(
    () => longBooks.value.find(({ id }) => id === activeBookId.value) ?? null
  );
  const workspace = shallowRef<LongWorkspaceIndexSnapshot | null>(
    activeBookId.value ? workspaceIndex(activeBookId.value) : null
  );
  const api = {
    create: vi.fn(async () => null),
    duplicateBook: vi.fn(async () => openedBook(BOOK_B, 2)),
    chooseLegacySyncSource: vi.fn(async () => null),
    applyLegacySync: vi.fn(),
    importPortable: vi.fn(async () => null),
    chooseContinuationImportSource: vi.fn(async () => null),
    importContinuation: vi.fn(async () => null),
    open: vi.fn(),
    rename: vi.fn(async () => openedBook(BOOK_A, 2, "新名称")),
    updateBindings: vi.fn(async () => openedBook(BOOK_A, 2)),
    openExisting: vi.fn(async () => null),
    getWorkspaceIndex: vi.fn(async ({ bookId }) => ({
      bookId,
      workspaceIndex: workspaceIndex(bookId)
    })),
    readDocument: vi.fn(),
    writeDocument: vi.fn(),
    readAgentsMd: vi.fn(async ({ bookId }) => ({
      bookId,
      content: "# 长篇上下文",
      truncated: false
    })),
    writeAgentsMd: vi.fn(async ({ bookId }) => ({ bookId })),
    previewOperations: vi.fn(),
    applyOperations: vi.fn(),
    writeChapter: vi.fn(),
    commitChapter: vi.fn(),
    unregister: vi.fn(async ({ bookId }) => ({ bookId, removed: true })),
    delete: vi.fn(async ({ bookId }) => ({ bookId, removed: true })),
    list: vi.fn(),
    ...overrides.api
  } as unknown as LongWorkspaceRendererApi;
  const notifications = {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  };
  const state: LongBookLifecycleCoordinatorOptions["state"] = {
    longBooks,
    activeBookId,
    activeBookSummary,
    workspaceIndex: workspace,
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
    bindingsDialogMode: ref(null),
    exportTarget: shallowRef(null),
    bookRenameTarget: shallowRef(null),
    bookRemovalTarget: shallowRef(null),
    createBookDialogOpen: ref(true),
    selectedResourceId: ref("")
  };
  const session = {
    activateOpenedBook: vi.fn((opened: LongOpenBookResult) => {
      activeBookId.value = opened.book.id;
      workspace.value = opened.book.workspaceIndex;
      longBooks.value = [
        ...longBooks.value.filter(({ id }) => id !== opened.summary.id),
        opened.summary
      ];
    }),
    loadAgentSettings: vi.fn(async () => undefined),
    saveActiveEditorChanges: vi.fn(async () => true),
    saveActiveEditorBeforeLeaving: vi.fn(async () => true),
    openBook: vi.fn(async (bookId: string) => {
      activeBookId.value = bookId;
      workspace.value = workspaceIndex(bookId);
    }),
    refreshActiveWorkspace: vi.fn(async () => true),
    clearActiveBook: vi.fn(async (bookId: string) => {
      if (activeBookId.value === bookId) activeBookId.value = null;
    }),
    invalidateWorkspaceRefresh: vi.fn(),
    selectWorkspaceFile: vi.fn(async () => true),
    ...overrides.session
  };
  const workflow = {
    stopBookAgentRuns: vi.fn(async () => undefined),
    quarantineBook: vi.fn(async () => undefined),
    reactivateBook: vi.fn(async () => undefined),
    disposeBookProposalState: vi.fn(async () => undefined),
    ...overrides.workflow
  };
  const conversations = {
    disposeBookConversations: vi.fn(async () => undefined),
    ...overrides.conversations
  };
  const catalog = {
    loadBookList: vi.fn(async () => undefined),
    refreshWorkspaceDirectory: vi.fn(async () => undefined),
    ...overrides.catalog
  };
  const resources = {
    selectBook: vi.fn(async () => undefined),
    showConversation: vi.fn(),
    revealEditor: vi.fn()
  };
  const manuscript = {
    available: vi.fn(() => true),
    createInput: vi.fn(
      async ({ title, sections }) =>
        ({
          title,
          sections: [...sections],
          files: []
        }) as ExportLongManuscriptInput
    ),
    exportLong: vi.fn(async () => ({ status: "cancelled" }) as const),
    ...overrides.manuscript
  };
  const scheduler = { settleUi: vi.fn(async () => undefined) };
  const options: LongBookLifecycleCoordinatorOptions = {
    api: () => api,
    state,
    session,
    workflow,
    conversations,
    catalog,
    resources,
    manuscript,
    scheduler,
    notifications
  };
  return {
    api,
    catalog,
    conversations,
    coordinator: useLongBookLifecycleCoordinator(options),
    manuscript,
    notifications,
    resources,
    session,
    state,
    workflow
  };
}

describe("useLongBookLifecycleCoordinator", () => {
  it("activates a created book and refreshes the book catalog and workspace directory", async () => {
    const events: string[] = [];
    const created = openedBook(BOOK_B, 4, "第二部长篇");
    const test = createHarness({
      api: {
        create: vi.fn(async () => {
          events.push("api");
          return created;
        })
      },
      session: {
        saveActiveEditorBeforeLeaving: vi.fn(async () => {
          events.push("save");
          return true;
        }),
        activateOpenedBook: vi.fn(() => events.push("activate"))
      },
      catalog: {
        loadBookList: vi.fn(async () => {
          events.push("book-list");
        }),
        refreshWorkspaceDirectory: vi.fn(async () => {
          events.push("directory");
        })
      }
    });

    await test.coordinator.createLongBook({ title: "第二部长篇" } as never);

    expect(events).toEqual([
      "save",
      "api",
      "activate",
      "book-list",
      "directory"
    ]);
    expect(test.state.createBookDialogOpen.value).toBe(false);
    expect(test.state.selectedResourceId.value).toBe(`long-book:${BOOK_B}`);
    expect(test.resources.showConversation).toHaveBeenCalledOnce();
    expect(test.resources.revealEditor).toHaveBeenCalledOnce();
    expect(test.notifications.success).toHaveBeenCalledWith(
      "已创建长篇“第二部长篇”"
    );
  });

  it("runs duplicate as single-flight and never releases a foreign book-action pending value", async () => {
    const pendingDuplicate = deferred<LongOpenBookResult>();
    const duplicateBook = vi.fn(() => pendingDuplicate.promise);
    const test = createHarness({ api: { duplicateBook } });

    const first = test.coordinator.handleLongBookAction(
      bookAction("duplicate")
    );
    const second = test.coordinator.handleLongBookAction(
      bookAction("duplicate")
    );
    await flushMicrotasks();

    expect(duplicateBook).toHaveBeenCalledOnce();
    expect(test.state.bookActionPending.value).toBe(true);
    pendingDuplicate.resolve(openedBook(BOOK_B, 2));
    await Promise.all([first, second]);
    expect(test.state.bookActionPending.value).toBe(false);

    test.state.bookActionPending.value = true;
    await test.coordinator.handleLongBookAction(bookAction("duplicate"));
    await test.coordinator.dispose();

    expect(duplicateBook).toHaveBeenCalledOnce();
    expect(test.state.bookActionPending.value).toBe(true);
  });

  it("keeps a later rename target while reconciling an already-issued rename", async () => {
    const pendingRename = deferred<LongOpenBookResult>();
    const rename = vi.fn(() => pendingRename.promise);
    const test = createHarness({
      activeBookId: null,
      books: [bookSummary(BOOK_A), bookSummary(BOOK_B)],
      api: { rename }
    });

    await test.coordinator.handleLongBookAction(
      bookAction("rename", BOOK_A, "旧名称 A")
    );
    const renaming = test.coordinator.renameLongBook("新名称 A");
    await flushMicrotasks();
    expect(rename).toHaveBeenCalledOnce();

    await test.coordinator.handleLongBookAction(
      bookAction("rename", BOOK_B, "旧名称 B")
    );
    const laterTarget = test.state.bookRenameTarget.value;
    pendingRename.resolve(openedBook(BOOK_A, 2, "新名称 A"));
    await renaming;

    expect(test.state.bookRenameTarget.value).toBe(laterTarget);
    expect(
      test.state.longBooks.value.find(({ id }) => id === BOOK_A)?.title
    ).toBe("新名称 A");
    expect(test.notifications.success).not.toHaveBeenCalled();
  });

  it("refreshes an inactive book before renaming it directly", async () => {
    const rename = vi.fn(async () => openedBook(BOOK_A, 8, "权威名称"));
    const test = createHarness({
      activeBookId: null,
      books: [bookSummary(BOOK_A, 1)],
      api: { rename }
    });
    vi.mocked(test.catalog.loadBookList).mockImplementationOnce(async () => {
      test.state.longBooks.value = [bookSummary(BOOK_A, 7)];
    });

    await test.coordinator.handleLongBookAction(bookAction("rename"));
    await test.coordinator.renameLongBook("权威名称");

    expect(rename).toHaveBeenCalledWith({
      bookId: BOOK_A,
      title: "权威名称"
    });
  });

  it("refreshes the active book before updating bindings directly", async () => {
    const updateBindings = vi.fn(async () =>
      openedBook(BOOK_A, 10, "绑定长篇")
    );
    const test = createHarness({ api: { updateBindings } });
    vi.mocked(test.session.refreshActiveWorkspace).mockImplementationOnce(
      async () => {
        test.state.longBooks.value = [bookSummary(BOOK_A, 9)];
        return true;
      }
    );

    await test.coordinator.handleLongBookAction(bookAction("bind-skill"));
    await test.coordinator.updateLongBookBindings({
      linkedMaterialIdsByKind: {} as never,
      linkedSkillIdsByKind: {} as never
    });

    expect(updateBindings).toHaveBeenCalledWith({
      bookId: BOOK_A,
      linkedMaterialIdsByKind: {},
      linkedSkillIdsByKind: {},
      linkedResourceStageScopes: { materials: {}, skills: {} }
    });
    expect(test.state.bindingsDialogMode.value).toBeNull();
  });

  it.each(["delete", "unregister"] as const)(
    "handles %s with ordered cleanup and preserves history only on unregister",
    async (action) => {
      const events: string[] = [];
      const test = createHarness({
        activeBookId: null,
        api: {
          [action]: vi.fn(async ({ bookId }: { bookId: string }) => {
            events.push("api");
            return { bookId, removed: true };
          })
        },
        workflow: {
          stopBookAgentRuns: vi.fn(async () => {
            events.push("stop");
          }),
          quarantineBook: vi.fn(async () => {
            events.push("quarantine");
          }),
          disposeBookProposalState: vi.fn(async () => {
            events.push("workflow-state-dispose");
          })
        },
        conversations: {
          disposeBookConversations: vi.fn(async () => {
            events.push("conversation-dispose");
          })
        },
        session: {
          clearActiveBook: vi.fn(async () => {
            events.push("clear-active");
          })
        },
        catalog: {
          loadBookList: vi.fn(async () => {
            events.push("book-list");
          })
        }
      });

      await test.coordinator.handleLongBookAction(bookAction(action));
      await test.coordinator.confirmLongBookRemoval();

      expect(events).toEqual([
        "stop",
        "quarantine",
        "api",
        "workflow-state-dispose",
        "conversation-dispose",
        "clear-active",
        "book-list"
      ]);
      expect(test.state.longBooks.value).toEqual([]);
      expect(test.state.bookRemovalTarget.value).toBeNull();
      expect(test.conversations.disposeBookConversations).toHaveBeenCalledWith(
        BOOK_A,
        { clearPersistence: action === "delete" }
      );
    }
  );

  it("reactivates a quarantined book when the removal API fails", async () => {
    const events: string[] = [];
    const test = createHarness({
      activeBookId: null,
      api: {
        delete: vi.fn(async () => {
          events.push("api");
          throw new Error("disk denied");
        })
      },
      workflow: {
        stopBookAgentRuns: vi.fn(async () => {
          events.push("stop");
        }),
        quarantineBook: vi.fn(async () => {
          events.push("quarantine");
        }),
        reactivateBook: vi.fn(async () => {
          events.push("reactivate");
        }),
        disposeBookProposalState: vi.fn(async () => {
          events.push("workflow-state-dispose");
        })
      }
    });

    await test.coordinator.handleLongBookAction(bookAction("delete"));
    const target = test.state.bookRemovalTarget.value;
    await test.coordinator.confirmLongBookRemoval();

    expect(events).toEqual(["stop", "quarantine", "api", "reactivate"]);
    expect(test.state.bookRemovalTarget.value).toBe(target);
    expect(test.state.longBooks.value).toHaveLength(1);
    expect(test.notifications.error).toHaveBeenCalledWith("disk denied");
    expect(test.state.bookActionPending.value).toBe(false);
  });

  it("waits for issued removal I/O on dispose, performs durable cleanup, and suppresses late UI publication", async () => {
    const pendingDelete = deferred<{ bookId: string; removed: boolean }>();
    const events: string[] = [];
    const test = createHarness({
      activeBookId: null,
      api: {
        delete: vi.fn(() => {
          events.push("api");
          return pendingDelete.promise;
        })
      },
      workflow: {
        stopBookAgentRuns: vi.fn(async () => {
          events.push("stop");
        }),
        quarantineBook: vi.fn(async () => {
          events.push("quarantine");
        }),
        disposeBookProposalState: vi.fn(async () => {
          events.push("workflow-state-dispose");
        })
      },
      conversations: {
        disposeBookConversations: vi.fn(async () => {
          events.push("conversation-dispose");
        })
      },
      session: {
        clearActiveBook: vi.fn(async () => {
          events.push("clear-active");
        })
      },
      catalog: {
        loadBookList: vi.fn(async () => {
          events.push("book-list");
        })
      }
    });

    await test.coordinator.handleLongBookAction(bookAction("delete"));
    const removal = test.coordinator.confirmLongBookRemoval();
    await flushMicrotasks();
    expect(events).toEqual(["stop", "quarantine", "api"]);

    let disposeSettled = false;
    const disposing = test.coordinator.dispose().then(() => {
      disposeSettled = true;
    });
    await flushMicrotasks();
    expect(disposeSettled).toBe(false);

    pendingDelete.resolve({ bookId: BOOK_A, removed: true });
    await Promise.all([removal, disposing]);

    expect(events).toEqual([
      "stop",
      "quarantine",
      "api",
      "workflow-state-dispose",
      "conversation-dispose"
    ]);
    expect(test.state.longBooks.value).toHaveLength(1);
    expect(test.state.bookRemovalTarget.value).not.toBeNull();
    expect(test.notifications.success).not.toHaveBeenCalled();
    expect(test.state.bookActionPending.value).toBe(false);
  });

  it("does not let an older export completion close or announce a later export target", async () => {
    const pendingExport = deferred<{
      status: "saved";
      directoryPath: string;
      fileCount: number;
    }>();
    const test = createHarness({
      manuscript: { exportLong: vi.fn(() => pendingExport.promise) }
    });

    await test.coordinator.handleLongBookAction(
      bookAction("export", BOOK_A, "导出 A")
    );
    const exporting = test.coordinator.exportLongBookManuscript(["manuscript"]);
    await flushMicrotasks();
    expect(test.manuscript.exportLong).toHaveBeenCalledOnce();

    await test.coordinator.handleLongBookAction(
      bookAction("export", BOOK_B, "导出 B")
    );
    const laterTarget = test.state.exportTarget.value;
    pendingExport.resolve({
      status: "saved",
      directoryPath: "/example.test/export",
      fileCount: 3
    });
    await exporting;

    expect(test.state.exportTarget.value).toBe(laterTarget);
    expect(test.notifications.success).not.toHaveBeenCalled();
    expect(test.state.manuscriptExportPending.value).toBe(false);
  });

  it("loads AGENTS.md when opening structure management and saves it without a structure mutation", async () => {
    const test = createHarness();

    await test.coordinator.handleLongBookAction(bookAction("manage-structure"));

    expect(test.api.readAgentsMd).toHaveBeenCalledWith({ bookId: BOOK_A });
    expect(test.state.structureDialogOpen.value).toBe(true);
    expect(test.state.structureAgentsMd.value).toBe("# 长篇上下文");
    expect(test.state.structureAgentsMdPending.value).toBe(false);

    const completion = {
      succeed: vi.fn(),
      fail: vi.fn(),
      appliedButRefreshFailed: vi.fn()
    };
    await test.coordinator.saveLongAgentsMd("自定义长篇上下文", completion);

    expect(test.api.writeAgentsMd).toHaveBeenCalledWith({
      bookId: BOOK_A,
      content: "自定义长篇上下文"
    });
    expect(test.state.structureAgentsMd.value).toBe("自定义长篇上下文");
    expect(completion.succeed).toHaveBeenCalledOnce();
    expect(completion.fail).not.toHaveBeenCalled();
    expect(test.api.applyOperations).not.toHaveBeenCalled();
  });
});
