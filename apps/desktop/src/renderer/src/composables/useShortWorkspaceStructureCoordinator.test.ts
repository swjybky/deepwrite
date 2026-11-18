import type { Book, DeepWriteApi } from "@deepwrite/contracts";
import { ref, shallowRef, type Ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type {
  CatalogWorkspaceProjection,
  DraftDirectoryProjection
} from "../data/catalogWorkspace";
import type {
  DraftFileKind,
  EditorDraftState,
  ResourceTreeNode,
  ResourceTreeSection,
  WorkspaceDocument
} from "../types/workspace";
import { useShortWorkspaceStructureCoordinator } from "./useShortWorkspaceStructureCoordinator";

const NOW = "2026-08-14T00:00:00.000Z";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("condition was not reached");
}

function catalogBook(id: string, projectRevision: number): Book {
  return {
    id,
    title: `作品 ${id}`,
    bookType: "short",
    genre: "other",
    characterStructure: { format: "list", items: [] },
    plotStages: [
      {
        id: "plot-a",
        title: "剧情 A",
        description: "",
        enabled: true,
        order: 0
      },
      {
        id: "plot-b",
        title: "剧情 B",
        description: "",
        enabled: true,
        order: 1
      }
    ],
    draft: { sections: [] },
    linkedMaterialIdsByKind: {},
    linkedSkillIdsByKind: {},
    projectRevision,
    createdAt: NOW,
    updatedAt: NOW
  } as unknown as Book;
}

function workspaceDocument(
  id: string,
  workspaceId = "book-1",
  patch: Partial<WorkspaceDocument> = {}
): WorkspaceDocument {
  return {
    id,
    domain: "creation",
    title: `文档 ${id}`,
    eyebrow: "创作空间",
    path: ["作品", id],
    content: "persisted",
    workspaceId,
    workspaceType: "short",
    stageId: "character_design",
    shortAgentId: "short",
    catalogContentLoaded: true,
    ...patch
  };
}

function draftSection(
  id: string
): DraftDirectoryProjection["sections"][number] {
  return {
    id,
    title: `小节 ${id}`,
    wordCountRequirement: "",
    bodyDocumentId: `${id}:body`,
    characterStateDocumentId: `${id}:character-state`
  };
}

interface HarnessOptions {
  bookRevision?: number;
  documents?: WorkspaceDocument[];
  drafts?: Record<string, EditorDraftState>;
  directory?: DraftDirectoryProjection;
}

function createHarness(options: HarnessOptions = {}) {
  const books = new Map<string, Book>([
    ["book-1", catalogBook("book-1", options.bookRevision ?? 1)]
  ]);
  const directory =
    options.directory ??
    ({
      id: "draft-directory-1",
      workspaceId: "book-1",
      workspaceType: "short",
      title: "正文",
      sections: [draftSection("section-1"), draftSection("section-2")]
    } satisfies DraftDirectoryProjection);
  const defaultDocuments = [
    workspaceDocument("character-overview"),
    workspaceDocument(directory.id, "book-1", {
      stageId: "draft",
      shortAgentId: "short"
    }),
    ...directory.sections.flatMap((section) => [
      workspaceDocument(section.bodyDocumentId, "book-1", {
        stageId: "draft",
        shortAgentId: "short",
        expertSectionId: section.id,
        draftDirectoryId: directory.id,
        draftFileKind: "body"
      }),
      workspaceDocument(section.characterStateDocumentId, "book-1", {
        stageId: "draft",
        shortAgentId: "short",
        expertSectionId: section.id,
        draftDirectoryId: directory.id,
        draftFileKind: "character-state"
      })
    ])
  ];
  const documents = shallowRef(options.documents ?? defaultDocuments);
  const drafts = shallowRef(options.drafts ?? {});
  const projection = ref({
    draftDirectories: [directory]
  } as unknown as CatalogWorkspaceProjection);
  const selectedResourceId = ref(directory.id);
  const activeCreationResourceId = ref(directory.id);
  const selectedExpertSectionIds = ref<Record<string, string>>({
    [directory.id]: directory.sections[0]?.id ?? ""
  });
  const selectedDraftFileKinds = ref<Record<string, DraftFileKind>>({
    [directory.id]: "body"
  });
  const mutationPending = ref(false);
  const savingDocumentIds = ref<ReadonlySet<string>>(new Set());
  const acceptingDocumentIds = ref<ReadonlySet<string>>(new Set());
  const acceptingWorkspaceIds = ref<ReadonlySet<string>>(new Set());
  const saveConflict = ref<{ documentId: string } | null>(null);
  const activeDocument = ref(documents.value[0]!);
  const activeCharacterItemTabs = ref<readonly { id: string; title: string }[]>(
    []
  );
  const activeExpertSectionId = ref<string | undefined>(
    directory.sections[0]?.id
  );
  const conversationEntries = new Map<string, { isBusy: Ref<boolean> }>();
  const resourceNodes = new Map<string, ResourceTreeNode>();
  const draftNode: ResourceTreeNode = {
    id: directory.id,
    label: "正文",
    workspaceType: "short",
    shortAgentId: "short",
    stageCategoryId: "draft",
    children: directory.sections.map((section) => ({
      id: `${directory.id}:${section.id}`,
      label: section.title,
      workspaceType: "short",
      shortAgentId: "short",
      stageCategoryId: "draft",
      expertSectionId: section.id
    }))
  };
  resourceNodes.set(draftNode.id, draftNode);
  for (const child of draftNode.children ?? [])
    resourceNodes.set(child.id, child);
  const resourceSections = ref<readonly ResourceTreeSection[]>([
    { id: "creation", label: "创作", icon: "book", nodes: [draftNode] }
  ]);

  const apiMocks = {
    duplicateProject: vi.fn(),
    mutateCharacterStructure: vi.fn(
      async (
        _input: Parameters<
          DeepWriteApi["catalog"]["mutateCharacterStructure"]
        >[0]
      ) => books.get("book-1")!
    ),
    mutatePlotStructure: vi.fn(async () => books.get("book-1")!),
    createDraftSection: vi.fn(),
    moveDraftSection: vi.fn(),
    deleteDraftSection: vi.fn()
  };
  const refresh = vi.fn(async () => true);
  const persist = vi.fn(async () => true);
  const cancel = vi.fn();
  const drain = vi.fn(async () => undefined);
  const removeConversation = vi.fn();
  const revealCatalogBook = vi.fn(async () => undefined);
  const refreshWorkspaceDirectory = vi.fn(async () => undefined);
  const notifications = {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  };

  const coordinator = useShortWorkspaceStructureCoordinator({
    api: () => apiMocks as unknown as DeepWriteApi["catalog"],
    state: {
      documents,
      drafts,
      mutationPending,
      selectedResourceId,
      activeCreationResourceId,
      selectedExpertSectionIds,
      selectedDraftFileKinds,
      savingDocumentIds,
      acceptingDocumentIds,
      acceptingWorkspaceIds
    },
    catalog: {
      projection,
      findBook: (bookId) => books.get(bookId),
      refresh,
      isConflict: () => false
    },
    saves: {
      conflict: saveConflict,
      drain,
      cancel,
      persist
    },
    resources: {
      sections: resourceSections,
      activeDocument,
      activeCharacterItemTabs,
      activeExpertSectionId,
      documentForResourceId: (resourceId) =>
        documents.value.find(({ id }) => id === resourceId),
      resourceIdForDocumentId: (documentId) => documentId,
      resourceNode: (resourceId) => resourceNodes.get(resourceId),
      draftDirectoryForResourceId: (resourceId) =>
        resourceId === directory.id || resourceId.startsWith(`${directory.id}:`)
          ? directory
          : undefined,
      draftFileDocument: (targetDirectory, sectionId, fileKind) => {
        const section = targetDirectory.sections.find(
          ({ id }) => id === sectionId
        );
        const documentId =
          fileKind === "body"
            ? section?.bodyDocumentId
            : section?.characterStateDocumentId;
        return documents.value.find(({ id }) => id === documentId);
      },
      ensureDocumentLoaded: vi.fn(async (document) => document),
      liveDocument: (document) => {
        const draft = drafts.value[document.id];
        return draft
          ? { ...document, title: draft.title, content: draft.content }
          : document;
      },
      selectResource: vi.fn(async () => undefined),
      revealCatalogBook
    },
    conversations: {
      forKey: (key) => {
        const existing = conversationEntries.get(key);
        if (existing) return existing;
        const created = { isBusy: ref<boolean>(false) };
        conversationEntries.set(key, created);
        return created;
      },
      entries: () => conversationEntries.entries(),
      hasWriteBarrier: () => false,
      remove: removeConversation
    },
    refreshWorkspaceDirectory,
    notifications
  });

  return {
    coordinator,
    books,
    directory,
    documents,
    drafts,
    projection,
    selectedResourceId,
    activeCreationResourceId,
    selectedExpertSectionIds,
    selectedDraftFileKinds,
    mutationPending,
    apiMocks,
    refresh,
    persist,
    cancel,
    drain,
    removeConversation,
    revealCatalogBook,
    notifications,
    draftNode
  };
}

describe("useShortWorkspaceStructureCoordinator", () => {
  it("exposes the shared book-mutation preflight without changing duplicate ownership", async () => {
    const document = workspaceDocument("character-overview");
    const harness = createHarness({
      documents: [document],
      drafts: {
        [document.id]: {
          title: document.title,
          content: "dirty",
          dirty: true,
          baseProjectRevision: 1
        }
      }
    });

    await expect(
      harness.coordinator.prepareBookMutation("book-1")
    ).resolves.toBe(true);
    expect(harness.drain).toHaveBeenCalledOnce();
    expect(harness.persist).toHaveBeenCalledOnce();
    expect(harness.apiMocks.duplicateProject).not.toHaveBeenCalled();
  });

  it("re-reads the authoritative project revision after saving dirty drafts", async () => {
    const document = workspaceDocument("character-overview");
    const harness = createHarness({
      documents: [document],
      drafts: {
        [document.id]: {
          title: document.title,
          content: "dirty",
          dirty: true,
          baseProjectRevision: 1
        }
      }
    });
    harness.persist.mockImplementation(async () => {
      harness.books.set("book-1", catalogBook("book-1", 2));
      return true;
    });
    const completion = { succeed: vi.fn(), fail: vi.fn() };

    await harness.coordinator.mutateCharacterStructure(
      { type: "createItem", title: "人物甲" },
      completion,
      "book-1"
    );

    expect(harness.persist).toHaveBeenCalledOnce();
    expect(harness.apiMocks.mutateCharacterStructure).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: "book-1", baseProjectRevision: 2 })
    );
    expect(completion.succeed).toHaveBeenCalledOnce();
    expect(completion.fail).not.toHaveBeenCalled();
  });

  it("serializes same-book mutations and lets each command observe the preceding revision", async () => {
    const harness = createHarness();
    const firstRelease = deferred<Book>();
    let activeCalls = 0;
    let maximumActiveCalls = 0;
    harness.apiMocks.mutateCharacterStructure.mockImplementation(async () => {
      activeCalls += 1;
      maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
      if (harness.apiMocks.mutateCharacterStructure.mock.calls.length === 1) {
        const result = await firstRelease.promise;
        activeCalls -= 1;
        return result;
      }
      activeCalls -= 1;
      return harness.books.get("book-1")!;
    });
    harness.refresh.mockImplementation(async () => {
      const revision = harness.books.get("book-1")!.projectRevision ?? 1;
      harness.books.set("book-1", catalogBook("book-1", revision + 1));
      return true;
    });

    const first = harness.coordinator.mutateCharacterStructure(
      { type: "createItem", title: "人物甲" },
      { succeed: vi.fn(), fail: vi.fn() },
      "book-1"
    );
    const second = harness.coordinator.mutateCharacterStructure(
      { type: "createItem", title: "人物乙" },
      { succeed: vi.fn(), fail: vi.fn() },
      "book-1"
    );
    await waitFor(
      () => harness.apiMocks.mutateCharacterStructure.mock.calls.length === 1
    );
    expect(harness.mutationPending.value).toBe(true);
    firstRelease.resolve(harness.books.get("book-1")!);
    await Promise.all([first, second]);

    expect(maximumActiveCalls).toBe(1);
    expect(
      harness.apiMocks.mutateCharacterStructure.mock.calls.map(
        ([input]) => input.baseProjectRevision
      )
    ).toEqual([1, 2]);
    expect(harness.mutationPending.value).toBe(false);
  });

  it("does not let an older character submission close a newer dialog target", async () => {
    const harness = createHarness();
    const release = deferred<Book>();
    harness.apiMocks.mutateCharacterStructure.mockReturnValue(release.promise);
    const original = {
      mode: "rename" as const,
      bookId: "book-1",
      itemId: "character-1",
      title: "旧人物"
    };
    harness.coordinator.characterItemDialog.value = original;

    harness.coordinator.submitCharacterItemDialog("新名称");
    await waitFor(
      () => harness.apiMocks.mutateCharacterStructure.mock.calls.length === 1
    );
    const newer = {
      mode: "delete" as const,
      bookId: "book-1",
      itemId: "character-2",
      title: "后来目标"
    };
    harness.coordinator.characterItemDialog.value = newer;
    release.resolve(harness.books.get("book-1")!);
    await harness.coordinator.drain();

    expect(harness.coordinator.characterItemDialog.value).toMatchObject(newer);
  });

  it("does not publish a delayed structure dialog after it was closed", async () => {
    const document = workspaceDocument("character-overview");
    const harness = createHarness({
      documents: [document],
      drafts: {
        [document.id]: {
          title: document.title,
          content: "dirty",
          dirty: true,
          baseProjectRevision: 1
        }
      }
    });
    const release = deferred<boolean>();
    harness.persist.mockReturnValue(release.promise);

    const opening = harness.coordinator.openPlotStructureDialog("book-1");
    await waitFor(() => harness.persist.mock.calls.length === 1);
    harness.coordinator.closePlotStructureDialog();
    release.resolve(true);

    await expect(opening).resolves.toBe(false);
    expect(harness.coordinator.plotStructureBookId.value).toBeNull();
  });

  it("waits for dispatched deletion during dispose, cleans durable state, and suppresses late UI", async () => {
    const harness = createHarness({
      drafts: {
        "section-1:body": {
          title: "正文",
          content: "persisted",
          dirty: false
        },
        "section-1:character-state": {
          title: "人物状态",
          content: "persisted",
          dirty: false
        },
        "section-2:body": {
          title: "保留",
          content: "persisted",
          dirty: false
        }
      }
    });
    const release = deferred<{ deleted: boolean }>();
    harness.apiMocks.deleteDraftSection.mockReturnValue(release.promise);
    harness.coordinator.pendingExpertSectionDeletion.value = {
      workspaceId: "book-1",
      draftDirectoryId: harness.directory.id,
      sectionId: "section-1",
      sectionTitle: "小节 section-1",
      workspaceType: "short",
      hasContent: true
    };

    const removal = harness.coordinator.confirmRemoveExpertSection();
    await waitFor(
      () => harness.apiMocks.deleteDraftSection.mock.calls.length === 1
    );
    const disposal = harness.coordinator.dispose();
    let disposed = false;
    void disposal.then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);
    release.resolve({ deleted: true });
    await Promise.all([removal, disposal]);

    expect(harness.drafts.value["section-1:body"]).toBeUndefined();
    expect(harness.drafts.value["section-1:character-state"]).toBeUndefined();
    expect(harness.drafts.value["section-2:body"]).toBeDefined();
    expect(harness.removeConversation).toHaveBeenCalledTimes(2);
    expect(harness.removeConversation).toHaveBeenCalledWith(
      "book-1:expert_draft_coordinator:section-1",
      { clearPersistence: true }
    );
    expect(harness.removeConversation).toHaveBeenCalledWith(
      "book-1:expert_section_writer:section-1",
      { clearPersistence: true }
    );
    expect(harness.notifications.success).not.toHaveBeenCalled();
    expect(harness.mutationPending.value).toBe(false);
    expect(harness.coordinator.pendingExpertSectionDeletion.value).toBeNull();
  });

  it("enforces draft-section limits before issuing structure I/O", async () => {
    const onlySectionDirectory: DraftDirectoryProjection = {
      id: "draft-directory-1",
      workspaceId: "book-1",
      workspaceType: "short",
      title: "正文",
      sections: [draftSection("only")]
    };
    const single = createHarness({ directory: onlySectionDirectory });
    const onlyNode = single.draftNode.children![0]!;
    single.coordinator.requestRemoveExpertSection(onlyNode);
    expect(single.notifications.warning).toHaveBeenCalledWith(
      "正文至少需要保留一个小节"
    );
    expect(single.coordinator.pendingExpertSectionDeletion.value).toBeNull();

    const fullDirectory: DraftDirectoryProjection = {
      ...onlySectionDirectory,
      sections: Array.from({ length: 100 }, (_, index) =>
        draftSection(`section-${index + 1}`)
      )
    };
    const full = createHarness({ directory: fullDirectory });
    await full.coordinator.addExpertSection(full.draftNode);
    expect(full.notifications.warning).toHaveBeenCalledWith(
      "正文最多支持 100 个小节"
    );
    expect(full.coordinator.pendingExpertSectionCreation.value).toBeNull();
    expect(full.apiMocks.createDraftSection).not.toHaveBeenCalled();
  });
});
