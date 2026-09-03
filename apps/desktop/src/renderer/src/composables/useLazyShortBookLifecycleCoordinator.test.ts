import type { DeepWriteApi } from "@deepwrite/contracts";
import { ref, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { ResourceTreeNode } from "../types/workspace";
import {
  useLazyShortBookLifecycleCoordinator,
  type LazyShortBookLifecycleCoordinatorOptions,
  type ShortBookLifecycleModule
} from "./useLazyShortBookLifecycleCoordinator";
import type {
  ShortBookLifecycleCoordinator,
  ShortBookLifecycleCoordinatorOptions
} from "./useShortBookLifecycleCoordinator";

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeCoordinator() {
  return {
    createBook: vi.fn(async () => undefined),
    duplicateBook: vi.fn(async () => undefined),
    manageStructure: vi.fn(async () => undefined),
    renameBook: vi.fn(async () => undefined),
    updateBookBindings: vi.fn(async () => undefined),
    removeBook: vi.fn(async () => undefined),
    deleteBook: vi.fn(async () => undefined),
    exportBookManuscript: vi.fn(async () => undefined),
    drain: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined)
  } satisfies ShortBookLifecycleCoordinator;
}

function fixtureNode(id = "book-1", label = "虚构短篇"): ResourceTreeNode {
  return {
    id,
    label,
    workspaceType: "short",
    projectRevision: 7,
    catalogNodeType: "book",
    boundSkillLibraryIds: ["skill-example"],
    boundMaterialLibraryIds: ["material-example"],
    boundSkillLibraryIdsByKind: {
      general: ["skill-example"],
      plot: [],
      style: [],
      other: []
    },
    boundMaterialLibraryIdsByKind: {
      character: ["material-example"],
      gimmick: [],
      plot: [],
      draft: [],
      other: []
    },
    children: [{ id: `${id}:document`, label: "正文" }]
  };
}

function createOptions() {
  const catalogMutationPending = ref(false);
  const notifications = {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  };
  const options = {
    state: {
      catalogMutationPending,
      createBookDialogOpen: ref(false),
      documents: shallowRef([]),
      drafts: shallowRef({}),
      selectedResourceId: ref(""),
      activeCreationResourceId: ref(""),
      selectedExpertSectionIds: ref({}),
      selectedDraftFileKinds: ref({})
    },
    catalog: {
      api: () => undefined,
      book: () => undefined,
      refresh: async () => true,
      refreshWorkspaceDirectory: async () => undefined,
      isConflict: () => false
    },
    preparation: {
      prepareBookMutation: async () => true
    },
    structure: {
      duplicateBook: async () => undefined,
      openStructure: async () => true
    },
    conversations: {
      stopBookRuns: async () => undefined,
      disposeBook: async () => undefined,
      removeRunPreferences: async () => undefined
    },
    resources: {
      selectPreferredBook: async () => true,
      settleUi: async () => undefined,
      fallbackCreationResourceId: () => ""
    },
    legacy: {
      hasBook: () => false,
      rename: async () => undefined,
      updateBindings: async () => undefined,
      remove: async () => undefined
    },
    manuscript: {
      api: () => undefined as DeepWriteApi["manuscript"] | undefined,
      ensureDocumentsLoaded: async () => true
    },
    clipboard: {
      writeText: async () => undefined
    },
    notifications
  } as LazyShortBookLifecycleCoordinatorOptions;
  return { options, catalogMutationPending, notifications };
}

function immediateModule(
  coordinator: ShortBookLifecycleCoordinator,
  factory = vi.fn(
    (_options: ShortBookLifecycleCoordinatorOptions) => coordinator
  )
) {
  const module: ShortBookLifecycleModule = {
    useShortBookLifecycleCoordinator: factory
  };
  const loader = vi.fn(async () => module);
  return { module, loader, factory };
}

describe("useLazyShortBookLifecycleCoordinator", () => {
  it("owns immutable dialog and export targets synchronously without loading", async () => {
    const { options } = createOptions();
    const loaded = fakeCoordinator();
    const { loader } = immediateModule(loaded);
    const lifecycle = useLazyShortBookLifecycleCoordinator(options, loader);
    const node = fixtureNode();

    await lifecycle.openBookDialog("rename", node);
    const target = lifecycle.activeBook.value;
    expect(loader).not.toHaveBeenCalled();
    expect(target?.bookId).toBe("book-1");
    expect(target?.resourceIds).toEqual(["book-1", "book-1:document"]);
    expect(Object.isFrozen(target)).toBe(true);
    expect(Object.isFrozen(target?.node)).toBe(true);

    node.label = "被外部修改";
    node.projectRevision = 99;
    node.boundSkillLibraryIds!.push("late-skill");
    expect(target?.label).toBe("虚构短篇");
    expect(target?.projectRevision).toBe(7);
    expect(target?.node.boundSkillLibraryIds).toEqual(["skill-example"]);

    lifecycle.closeBookDialog();
    lifecycle.openBookExportDialog(node);
    expect(lifecycle.exportBookTarget.value?.label).toBe("被外部修改");
    lifecycle.closeBookExportDialog();
    expect(loader).not.toHaveBeenCalled();
  });

  it("loads on duplicate, manage, and submit commands and reuses one coordinator", async () => {
    const { options } = createOptions();
    const loaded = fakeCoordinator();
    const { loader, factory } = immediateModule(loaded);
    const lifecycle = useLazyShortBookLifecycleCoordinator(options, loader);

    await lifecycle.openBookDialog("duplicate", fixtureNode());
    expect(loaded.duplicateBook).toHaveBeenCalledTimes(1);
    await lifecycle.openBookDialog("manage-structure", fixtureNode());
    expect(loaded.manageStructure).toHaveBeenCalledTimes(1);
    await lifecycle.openBookDialog("rename", fixtureNode());
    await lifecycle.renameBook({ bookId: "book-1", label: "新名称" });
    expect(loaded.renameBook).toHaveBeenCalledTimes(1);
    lifecycle.openBookExportDialog(fixtureNode());
    await lifecycle.exportBookManuscript("docx");
    expect(loaded.exportBookManuscript).toHaveBeenCalledWith("docx");
    lifecycle.openBookExportDialog(fixtureNode());
    await lifecycle.exportBookManuscript("clipboard");
    expect(loaded.exportBookManuscript).toHaveBeenCalledWith("clipboard");
    expect(loader).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("lets a newer synchronous intent supersede a command waiting for module load", async () => {
    const { options } = createOptions();
    const loaded = fakeCoordinator();
    const pendingModule = deferred<ShortBookLifecycleModule>();
    const loader = vi.fn(() => pendingModule.promise);
    const lifecycle = useLazyShortBookLifecycleCoordinator(options, loader);

    const duplicate = lifecycle.openBookDialog("duplicate", fixtureNode());
    await lifecycle.openBookDialog(
      "rename",
      fixtureNode("book-2", "更新的目标")
    );
    pendingModule.resolve({
      useShortBookLifecycleCoordinator: () => loaded
    });
    await duplicate;

    expect(loaded.duplicateBook).not.toHaveBeenCalled();
    expect(lifecycle.activeBook.value?.bookId).toBe("book-2");
    expect(lifecycle.bookDialogMode.value).toBe("rename");
  });

  it("disposes safely before any module load without causing a load", async () => {
    const { options } = createOptions();
    const loaded = fakeCoordinator();
    const { loader } = immediateModule(loaded);
    const lifecycle = useLazyShortBookLifecycleCoordinator(options, loader);
    await lifecycle.openBookDialog("rename", fixtureNode());

    await Promise.all([lifecycle.dispose(), lifecycle.dispose()]);
    await lifecycle.renameBook({ bookId: "book-1", label: "不会执行" });
    expect(loader).not.toHaveBeenCalled();
    expect(loaded.dispose).not.toHaveBeenCalled();
    expect(lifecycle.activeBook.value).toBeNull();
  });

  it("disposes a coordinator exactly once when disposal happens during load", async () => {
    const { options } = createOptions();
    const loaded = fakeCoordinator();
    const pendingModule = deferred<ShortBookLifecycleModule>();
    const loader = vi.fn(() => pendingModule.promise);
    const lifecycle = useLazyShortBookLifecycleCoordinator(options, loader);
    await lifecycle.openBookDialog("rename", fixtureNode());
    const command = lifecycle.renameBook({ bookId: "book-1", label: "新名称" });
    const disposal = lifecycle.dispose();

    pendingModule.resolve({
      useShortBookLifecycleCoordinator: () => loaded
    });
    await Promise.all([command, disposal, lifecycle.dispose()]);
    expect(loaded.renameBook).not.toHaveBeenCalled();
    expect(loaded.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not throw when a module load rejects while disposal is waiting", async () => {
    const { options, notifications } = createOptions();
    const pendingModule = deferred<ShortBookLifecycleModule>();
    const lifecycle = useLazyShortBookLifecycleCoordinator(
      options,
      () => pendingModule.promise
    );
    await lifecycle.openBookDialog("rename", fixtureNode());
    const command = lifecycle.renameBook({ bookId: "book-1", label: "新名称" });
    const disposal = lifecycle.dispose();
    pendingModule.reject(new Error("example.test module unavailable"));

    await expect(Promise.all([command, disposal])).resolves.toBeDefined();
    expect(notifications.error).not.toHaveBeenCalled();
  });

  it("reports one load failure for concurrent commands and remains disposable", async () => {
    const { options, notifications } = createOptions();
    const loader = vi.fn(async () => {
      throw new Error("example.test load failed");
    });
    const lifecycle = useLazyShortBookLifecycleCoordinator(options, loader);
    await lifecycle.openBookDialog("rename", fixtureNode());

    const first = lifecycle.renameBook({ bookId: "book-1", label: "名称一" });
    const second = lifecycle.renameBook({ bookId: "book-1", label: "名称二" });
    await expect(
      Promise.all([first, second, lifecycle.drain()])
    ).resolves.toBeDefined();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(notifications.error).toHaveBeenCalledTimes(1);
    await expect(lifecycle.dispose()).resolves.toBeUndefined();
  });

  it("keeps the owning dialog target while its shared lane is pending", async () => {
    const { options, catalogMutationPending } = createOptions();
    const loaded = fakeCoordinator();
    const { loader } = immediateModule(loaded);
    const lifecycle = useLazyShortBookLifecycleCoordinator(options, loader);
    await lifecycle.openBookDialog("remove", fixtureNode());
    const target = lifecycle.activeBook.value;
    catalogMutationPending.value = true;

    lifecycle.closeBookDialog();
    expect(lifecycle.activeBook.value).toBe(target);
    expect(lifecycle.bookDialogMode.value).toBe("remove");

    catalogMutationPending.value = false;
    lifecycle.closeBookDialog();
    lifecycle.openBookExportDialog(fixtureNode());
    const exportTarget = lifecycle.exportBookTarget.value;
    lifecycle.manuscriptExportPending.value = true;
    lifecycle.closeBookExportDialog();
    expect(lifecycle.exportBookTarget.value).toBe(exportTarget);
    expect(loader).not.toHaveBeenCalled();
  });
});
