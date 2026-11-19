import type {
  CatalogSnapshot,
  LongBookSummary,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceRuntimeContext
} from "@deepwrite/contracts";
import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type {
  ResourceTreeNode,
  ResourceTreeSection,
  WorkspaceDocument
} from "../types/workspace";
import { createResourceTreeLookup } from "../utils/resourceTreeLookup";
import {
  useWorkspaceResourceCoordinator,
  type WorkspaceResourceCatalogPort,
  type WorkspaceResourceCoordinatorOptions,
  type WorkspaceResourceMysteryNavigationPort
} from "./useWorkspaceResourceCoordinator";

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function workspaceDocument(id: string): WorkspaceDocument {
  return {
    id,
    domain: "creation",
    title: id,
    eyebrow: "短篇 · 正文",
    path: ["测试作品", id],
    content: `${id} content`,
    workspaceId: "book-1",
    workspaceType: "short",
    stageId: "draft",
    catalogContentLoaded: true
  };
}

const EMPTY_DOCUMENT: WorkspaceDocument = {
  id: "empty",
  domain: "creation",
  title: "未选择",
  eyebrow: "创作空间",
  path: ["未选择"],
  content: "",
  readOnly: true
};

function loadResult(
  document: WorkspaceDocument,
  documents: readonly WorkspaceDocument[]
) {
  return {
    ok: true,
    requestedIds: [document.id],
    loadedIds: [document.id],
    alreadyLoadedIds: [],
    skippedIds: [],
    retriedIds: [],
    failures: [],
    published: false,
    documents,
    document
  } as const;
}

function createHarness(
  ensureOne?: WorkspaceResourceCatalogPort["loader"]["ensureOne"],
  useCatalogReconciliationGate = false,
  startInLongWorkspace = false,
  mysteryNavigation?: WorkspaceResourceMysteryNavigationPort
) {
  const documents = ref<WorkspaceDocument[]>([
    workspaceDocument("document-a"),
    workspaceDocument("document-b")
  ]);
  const nodes: ResourceTreeNode[] = [
    {
      id: "resource-a",
      label: "资源 A",
      targetDocumentId: "document-a"
    },
    {
      id: "resource-b",
      label: "资源 B",
      targetDocumentId: "document-b"
    }
  ];
  const longNode: ResourceTreeNode = {
    id: "long-detail",
    label: "长篇正文",
    longBookId: "long-book",
    workspaceType: "long"
  };
  const sections = ref<ResourceTreeSection[]>([
    {
      id: "creation",
      label: "创作空间",
      icon: "book",
      nodes: startInLongWorkspace ? [...nodes, longNode] : nodes
    }
  ]);
  const selectedResourceId = ref(startInLongWorkspace ? longNode.id : "");
  const activeCreationResourceId = ref("");
  const rightCollapsed = ref(true);
  const showConversation = vi.fn();
  const catalogProjection =
    ref<WorkspaceResourceCatalogPort["projection"]["value"]>(null);
  const reconciledCatalogProjection =
    ref<WorkspaceResourceCatalogPort["projection"]["value"]>(null);
  const notifications = {
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  };
  const activeLongBookId = ref<string | null>(
    startInLongWorkspace ? longNode.longBookId! : null
  );
  const defaultEnsureOne: WorkspaceResourceCatalogPort["loader"]["ensureOne"] =
    async (target) => {
      const id = typeof target === "string" ? target : target.id;
      const document = documents.value.find((candidate) => candidate.id === id);
      if (!document) {
        return {
          ok: false,
          requestedIds: [id],
          loadedIds: [],
          alreadyLoadedIds: [],
          skippedIds: [],
          retriedIds: [],
          failures: [
            {
              documentId: id,
              code: "document-removed",
              attempts: 0
            }
          ],
          published: false,
          documents: documents.value,
          document: undefined
        };
      }
      return loadResult(document, documents.value);
    };
  const loader: WorkspaceResourceCatalogPort["loader"] = {
    documentsById: computed(
      () => new Map(documents.value.map((document) => [document.id, document]))
    ),
    async ensureLoaded(targets) {
      const requestedIds = (targets ?? documents.value).map((target) =>
        typeof target === "string" ? target : target.id
      );
      return {
        ok: true,
        requestedIds,
        loadedIds: requestedIds,
        alreadyLoadedIds: [],
        skippedIds: [],
        retriedIds: [],
        failures: [],
        published: false,
        documents: documents.value
      };
    },
    ensureOne: ensureOne ?? defaultEnsureOne,
    contextSnapshot(snapshot: CatalogSnapshot | null) {
      return snapshot;
    }
  };
  const options: WorkspaceResourceCoordinatorOptions = {
    state: {
      selectedResourceId,
      activeCreationResourceId,
      selectedExpertSectionIds: ref({}),
      selectedDraftFileKinds: ref({}),
      pendingEditorReferences: ref([]),
      editorReferenceNavigation: ref(),
      documents,
      editorDrafts: ref({})
    },
    catalog: {
      snapshot: ref(null),
      projection: catalogProjection,
      ...(useCatalogReconciliationGate
        ? { reconciledProjection: reconciledCatalogProjection }
        : {}),
      loader,
      findBook: () => undefined
    },
    tree: {
      sections,
      lookup: computed(() => createResourceTreeLookup(sections.value))
    },
    longNavigation: {
      books: ref<LongBookSummary[]>([]),
      activeBookId: activeLongBookId,
      activeBookSummary: ref<LongBookSummary | null>(null),
      workspaceIndex: ref<LongWorkspaceIndexSnapshot | null>(null),
      activeRoot:
        ref<LongWorkspaceRuntimeContext["activeRoot"]>("worldbuilding"),
      workspaceActive: ref(false),
      saveActiveEditorBeforeLeaving: async () => true,
      openBook: async () => undefined,
      selectWorkspaceFile: async () => true,
      deactivateActiveBook: () => {
        activeLongBookId.value = null;
        if (startInLongWorkspace) {
          sections.value = [
            {
              id: "creation",
              label: "创作空间",
              icon: "book",
              nodes
            }
          ];
        }
      }
    },
    ...(mysteryNavigation ? { mysteryNavigation } : {}),
    emptyDocument: EMPTY_DOCUMENT,
    showConversation,
    revealEditor: () => {
      rightCollapsed.value = false;
    },
    notifications
  };
  const coordinator = useWorkspaceResourceCoordinator(options);
  return {
    activeCreationResourceId,
    catalogProjection,
    coordinator,
    documents,
    nodes,
    notifications,
    rightCollapsed,
    reconciledCatalogProjection,
    sections,
    selectedResourceId,
    showConversation
  };
}

describe("useWorkspaceResourceCoordinator", () => {
  it("selects mystery tree documents without reopening the book or losing the selection on refresh", async () => {
    const target = {
      kind: "player_act",
      roleId: "role_one",
      actId: "act_one",
      document: "body"
    } as const;
    const port: WorkspaceResourceMysteryNavigationPort = {
      activeBookId: ref("mystery_tree"),
      openBook: vi.fn(async () => undefined),
      selectStage: vi.fn(),
      selectTarget: vi.fn(async () => true),
      saveActiveEditorBeforeLeaving: vi.fn(async () => true),
      deactivateActiveBook: vi.fn()
    };
    const h = createHarness(undefined, false, false, port);
    const node: ResourceTreeNode = {
      id: "mystery-body",
      label: "人物本正文",
      mysteryBookId: "mystery_tree",
      mysteryTarget: target
    };
    const root: ResourceTreeNode = {
      id: "mystery-book:mystery_tree",
      label: "剧本杀作品",
      mysteryBookId: "mystery_tree",
      children: [node]
    };
    h.sections.value[0]!.nodes.push(root);
    await h.coordinator.selectResource(node);
    expect(port.selectTarget).toHaveBeenCalledWith(target);
    expect(port.openBook).not.toHaveBeenCalled();
    expect(h.selectedResourceId.value).toBe(node.id);
    h.sections.value = h.sections.value.map((section) => ({
      ...section,
      nodes: [...section.nodes]
    }));
    expect(h.selectedResourceId.value).toBe(node.id);
    h.sections.value = h.sections.value.map((section) => ({
      ...section,
      nodes: section.nodes.map((entry) =>
        entry.id === root.id ? { ...entry, children: [] } : entry
      )
    }));
    expect(h.selectedResourceId.value).toBe(root.id);
    h.coordinator.dispose();
  });

  it("keeps an explicit book opening live when a refresh removes only the previous creation anchor", async () => {
    const opening = deferred<void>();
    let current!: () => boolean;
    const port: WorkspaceResourceMysteryNavigationPort = {
      activeBookId: ref(null),
      openBook: vi.fn(async (_id, check) => {
        current = check;
        await opening.promise;
      }),
      selectStage: vi.fn(),
      selectTarget: vi.fn(async () => true),
      saveActiveEditorBeforeLeaving: vi.fn(async () => true),
      deactivateActiveBook: vi.fn()
    };
    const h = createHarness(undefined, false, false, port);
    const root: ResourceTreeNode = {
      id: "mystery-book:fixture",
      label: "作品",
      mysteryBookId: "fixture"
    };
    h.sections.value = h.sections.value.map((section) => ({
      ...section,
      nodes: [...section.nodes, root]
    }));
    h.activeCreationResourceId.value = "old-short-creation-anchor";
    const selected = h.coordinator.selectResource(root);
    await vi.waitFor(() => expect(port.openBook).toHaveBeenCalledOnce());
    h.sections.value = h.sections.value.map((section) => ({
      ...section,
      nodes: [...section.nodes]
    }));
    const requestStillCurrent = current();
    opening.resolve();
    await selected;
    expect(requestStillCurrent).toBe(true);
    expect(h.selectedResourceId.value).toBe(root.id);
    h.coordinator.dispose();
  });

  it("keeps the previous work selected when a mystery book cannot be opened", async () => {
    const port: WorkspaceResourceMysteryNavigationPort = {
      activeBookId: ref(null),
      openBook: vi.fn(async () => {
        throw new Error("unavailable");
      }),
      selectStage: vi.fn(),
      selectTarget: vi.fn(async () => false),
      saveActiveEditorBeforeLeaving: vi.fn(async () => true),
      deactivateActiveBook: vi.fn()
    };
    const h = createHarness(undefined, false, false, port);
    h.selectedResourceId.value = "resource-b";
    await h.coordinator.selectResource({
      id: "mystery-book:missing",
      label: "目标",
      mysteryBookId: "missing"
    });
    expect(h.selectedResourceId.value).toBe("resource-b");
    expect(port.selectTarget).not.toHaveBeenCalled();
    h.coordinator.dispose();
  });

  it("commits a mystery selection only after the requested document loads", async () => {
    const port: WorkspaceResourceMysteryNavigationPort = {
      activeBookId: ref("fixture"),
      openBook: vi.fn(async () => undefined),
      selectStage: vi.fn(),
      selectTarget: vi.fn(async () => false),
      saveActiveEditorBeforeLeaving: vi.fn(async () => true),
      deactivateActiveBook: vi.fn()
    };
    const h = createHarness(undefined, false, false, port);
    h.selectedResourceId.value = "current";
    await h.coordinator.selectResource({
      id: "missing",
      label: "目标",
      mysteryBookId: "fixture",
      mysteryTarget: { kind: "character_relations" }
    });
    expect(port.selectTarget).toHaveBeenCalledOnce();
    expect(h.selectedResourceId.value).toBe("current");
    h.coordinator.dispose();
  });

  it("keeps the mystery document selected if saving before navigation fails", async () => {
    const port: WorkspaceResourceMysteryNavigationPort = {
      activeBookId: ref("mystery_tree"),
      openBook: vi.fn(async () => undefined),
      selectStage: vi.fn(),
      selectTarget: vi.fn(async () => true),
      saveActiveEditorBeforeLeaving: vi.fn(async () => false),
      deactivateActiveBook: vi.fn()
    };
    const h = createHarness(undefined, false, false, port);
    h.selectedResourceId.value = "mystery-current";
    await h.coordinator.selectResource(h.nodes[1]!);
    expect(h.selectedResourceId.value).toBe("mystery-current");
    expect(port.deactivateActiveBook).not.toHaveBeenCalled();
    expect(port.selectTarget).not.toHaveBeenCalled();
    h.coordinator.dispose();
  });

  it("opens the mystery stage overview only after saving the current editor", async () => {
    const save = vi.fn(async () => false);
    const port: WorkspaceResourceMysteryNavigationPort = {
      activeBookId: ref("mystery_tree"),
      openBook: vi.fn(async () => undefined),
      selectStage: vi.fn(),
      selectTarget: vi.fn(async () => true),
      saveActiveEditorBeforeLeaving: save,
      deactivateActiveBook: vi.fn()
    };
    const h = createHarness(undefined, false, false, port);
    const stage: ResourceTreeNode = {
      id: "mystery-stage:mystery_tree:scripts",
      label: "分幕人物本",
      mysteryBookId: "mystery_tree",
      mysteryStage: "scripts"
    };
    h.selectedResourceId.value = "mystery-current";
    await h.coordinator.selectResource(stage);
    expect(port.selectStage).not.toHaveBeenCalled();
    expect(h.selectedResourceId.value).toBe("mystery-current");

    save.mockResolvedValueOnce(true);
    await h.coordinator.selectResource(stage);
    expect(port.selectStage).toHaveBeenCalledExactlyOnceWith("scripts");
    expect(port.selectTarget).not.toHaveBeenCalled();
    expect(h.selectedResourceId.value).toBe(stage.id);
    h.coordinator.dispose();
  });

  it("keeps a short-form selection current when leaving long-form contracts the tree", async () => {
    const harness = createHarness(undefined, false, true);

    await harness.coordinator.selectResource(harness.nodes[1]!);

    expect(harness.selectedResourceId.value).toBe("resource-b");
    expect(harness.activeCreationResourceId.value).toBe("resource-b");
    expect(harness.showConversation).toHaveBeenCalledTimes(1);
  });

  it("publishes only the latest resource selection when body reads settle out of order", async () => {
    const pending = new Map<string, Deferred<ReturnType<typeof loadResult>>>();
    let documents: readonly WorkspaceDocument[] = [];
    const harness = createHarness(async (target) => {
      const document =
        typeof target === "string"
          ? documents.find((candidate) => candidate.id === target)
          : target;
      if (!document) throw new Error("Missing test document");
      const request = deferred<ReturnType<typeof loadResult>>();
      pending.set(document.id, request);
      return request.promise;
    });
    documents = harness.documents.value;

    const selectingA = harness.coordinator.selectResource(harness.nodes[0]!);
    await Promise.resolve();
    const selectingB = harness.coordinator.selectResource(harness.nodes[1]!);
    await Promise.resolve();

    pending
      .get("document-b")!
      .resolve(
        loadResult(harness.documents.value[1]!, harness.documents.value)
      );
    await selectingB;
    pending
      .get("document-a")!
      .resolve(
        loadResult(harness.documents.value[0]!, harness.documents.value)
      );
    await selectingA;

    expect(harness.selectedResourceId.value).toBe("resource-b");
    expect(harness.activeCreationResourceId.value).toBe("resource-b");
    expect(harness.rightCollapsed.value).toBe(false);
    expect(harness.showConversation).toHaveBeenCalledTimes(1);
  });

  it("invalidates pending navigation and stops selection reconciliation on dispose", async () => {
    const pending = deferred<ReturnType<typeof loadResult>>();
    const harness = createHarness(async (target) => {
      const document =
        typeof target === "string"
          ? harness.documents.value.find((candidate) => candidate.id === target)
          : target;
      if (!document) throw new Error("Missing test document");
      return pending.promise;
    });

    const selecting = harness.coordinator.selectResource(harness.nodes[0]!);
    await Promise.resolve();
    harness.coordinator.dispose();
    pending.resolve(
      loadResult(harness.documents.value[0]!, harness.documents.value)
    );
    await selecting;

    expect(harness.selectedResourceId.value).toBe("");
    expect(harness.activeCreationResourceId.value).toBe("");
    expect(harness.showConversation).not.toHaveBeenCalled();

    harness.selectedResourceId.value = "resource-a";
    harness.activeCreationResourceId.value = "resource-a";
    harness.sections.value = [];
    expect(harness.selectedResourceId.value).toBe("resource-a");
    expect(harness.activeCreationResourceId.value).toBe("resource-a");
  });

  it("waits for the matching Catalog document overlay before reconciling a tree change", () => {
    const harness = createHarness(undefined, true);
    harness.selectedResourceId.value = "resource-a";
    harness.activeCreationResourceId.value = "resource-a";
    const nextProjection = {
      resourceSections: [],
      workspaceDocuments: [],
      draftDirectories: [],
      index: {
        resourceNodeById: new Map(),
        workspaceDocumentById: new Map(),
        resourceIdByDocumentId: new Map(),
        resourceTargetDocumentIdById: new Map(),
        draftDirectoryById: new Map(),
        draftDirectoryByWorkspaceId: new Map(),
        preferredResourceIdByWorkspaceId: new Map(),
        workspaceIdByResourceId: new Map()
      }
    } as WorkspaceResourceCatalogPort["projection"]["value"];

    harness.catalogProjection.value = nextProjection;
    harness.sections.value = [
      {
        id: "creation",
        label: "创作空间",
        icon: "book",
        nodes: [harness.nodes[1]!]
      }
    ];

    expect(harness.selectedResourceId.value).toBe("resource-a");
    expect(harness.activeCreationResourceId.value).toBe("resource-a");

    // The Catalog projection coordinator owns the matching selection repair;
    // publishing its gate must not replay the earlier tree against stale docs.
    harness.selectedResourceId.value = "resource-b";
    harness.activeCreationResourceId.value = "resource-b";
    harness.reconciledCatalogProjection.value = nextProjection;
    expect(harness.selectedResourceId.value).toBe("resource-b");
    expect(harness.activeCreationResourceId.value).toBe("resource-b");
  });
});
