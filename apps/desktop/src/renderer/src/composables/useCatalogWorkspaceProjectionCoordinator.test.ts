import type {
  CatalogIndexSnapshot,
  CatalogSnapshot
} from "@deepwrite/contracts";
import { ref, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { CatalogWorkspaceProjection } from "../data/catalogWorkspace";
import type { AgentConversationController } from "./useAgentConversation";
import type {
  EditorDraftState,
  ResourceTreeSection,
  WorkspaceDocument
} from "../types/workspace";
import { legacyBookDraftRecoveryKey } from "../utils/legacyDraftRecoveryDetection";
import {
  useCatalogWorkspaceProjectionCoordinator,
  type CatalogLegacyRecoveryMigratorModule,
  type CatalogWorkspaceProjectionCoordinatorOptions
} from "./useCatalogWorkspaceProjectionCoordinator";

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

function catalogSnapshot(
  revision: number,
  bookIds: readonly string[] = [],
  diagnostics: CatalogIndexSnapshot["projectDiagnostics"] = []
): CatalogIndexSnapshot {
  return {
    schemaVersion: 1,
    revision,
    books: bookIds.map((id) => ({ id })),
    projectDiagnostics: diagnostics
  } as unknown as CatalogIndexSnapshot;
}

function fullCatalogSnapshot(revision: number): CatalogSnapshot {
  return {
    schemaVersion: 1,
    revision,
    books: []
  } as unknown as CatalogSnapshot;
}

function workspaceDocument(
  id: string,
  workspaceId: string,
  content = ""
): WorkspaceDocument {
  return {
    id,
    domain: "creation",
    title: id,
    eyebrow: "短篇 · 正文",
    path: [workspaceId, id],
    content,
    workspaceId,
    workspaceType: "short",
    stageId: "draft",
    catalogContentLoaded: true
  };
}

function projection(
  options: {
    resourceId?: string;
    document?: WorkspaceDocument;
    workspaceId?: string;
  } = {}
): CatalogWorkspaceProjection {
  const document = options.document;
  const resourceId = options.resourceId;
  const workspaceId = options.workspaceId ?? document?.workspaceId;
  const sections: ResourceTreeSection[] = [
    {
      id: "creation",
      label: "创作空间",
      icon: "book",
      nodes:
        resourceId && document
          ? [
              {
                id: resourceId,
                label: document.title,
                targetDocumentId: document.id,
                workspaceType: "short"
              }
            ]
          : []
    }
  ];
  return {
    resourceSections: sections,
    workspaceDocuments: document ? [document] : [],
    draftDirectories: [],
    index: {
      resourceNodeById: new Map(
        resourceId ? [[resourceId, sections[0]!.nodes[0]!]] : []
      ),
      workspaceDocumentById: new Map(document ? [[document.id, document]] : []),
      resourceIdByDocumentId: new Map(
        resourceId && document ? [[document.id, resourceId]] : []
      ),
      resourceTargetDocumentIdById: new Map(
        resourceId && document ? [[resourceId, document.id]] : []
      ),
      draftDirectoryById: new Map(),
      draftDirectoryByWorkspaceId: new Map(),
      preferredResourceIdByWorkspaceId: new Map(
        workspaceId && resourceId ? [[workspaceId, resourceId]] : []
      ),
      workspaceIdByResourceId: new Map(
        workspaceId && resourceId ? [[resourceId, workspaceId]] : []
      )
    }
  };
}

function pendingConversation(): AgentConversationController {
  return {
    messages: ref([
      {
        id: "message-1",
        role: "assistant",
        content: "",
        editProposals: [
          {
            id: "proposal-1",
            runId: "run-1",
            approvalMode: "auto-approve",
            status: "pending"
          }
        ]
      }
    ])
  } as unknown as AgentConversationController;
}

function createHarness(
  options: {
    snapshots?: readonly CatalogIndexSnapshot[];
    projections?: ReadonlyMap<number, CatalogWorkspaceProjection>;
    drafts?: Record<string, EditorDraftState>;
    selectedResourceId?: string;
    activeCreationResourceId?: string;
    conversations?: readonly AgentConversationController[];
    aggregateSnapshots?: readonly CatalogSnapshot[];
    loadMigrator?: () => Promise<CatalogLegacyRecoveryMigratorModule>;
    indexLoader?: CatalogWorkspaceProjectionCoordinatorOptions["index"]["ensureSnapshot"];
    api?: CatalogWorkspaceProjectionCoordinatorOptions["api"];
  } = {}
) {
  const snapshots = [...(options.snapshots ?? [catalogSnapshot(1)])];
  const projections = options.projections ?? new Map([[1, projection()]]);
  const aggregateSnapshots = [...(options.aggregateSnapshots ?? [])];
  const snapshot = shallowRef<CatalogIndexSnapshot | null>(null);
  const projected = shallowRef<CatalogWorkspaceProjection | null>(null);
  const documents = shallowRef<WorkspaceDocument[]>([]);
  const drafts = shallowRef<Record<string, EditorDraftState>>(
    options.drafts ?? {}
  );
  const selectedResourceId = ref(options.selectedResourceId ?? "");
  const activeCreationResourceId = ref(options.activeCreationResourceId ?? "");
  const microtasks: Array<() => void> = [];
  const resume = vi.fn();
  const reconcileProjection = vi.fn((next: CatalogWorkspaceProjection) => {
    documents.value = [...next.workspaceDocuments];
    return {
      documents: documents.value,
      retainedBodyIds: [],
      discardedBodyIds: [],
      removedIds: []
    };
  });
  const index = vi.fn(async () => {
    const next = snapshots.shift();
    if (!next) throw new Error("No queued Catalog index fixture");
    return next;
  });
  const aggregate = vi.fn(async () => {
    const next = aggregateSnapshots.shift();
    if (!next) throw new Error("No queued aggregate Catalog fixture");
    return next;
  });
  const api = options.api ?? (() => ({ index, snapshot: aggregate }));
  const ensureSnapshot =
    options.indexLoader ??
    (async (loader: () => Promise<CatalogIndexSnapshot>) => {
      const next = await loader();
      const nextProjection = projections.get(next.revision);
      if (!nextProjection) {
        throw new Error(`Missing projection fixture ${next.revision}`);
      }
      snapshot.value = next;
      projected.value = nextProjection;
      return nextProjection;
    });
  const notifications = {
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  };
  const coordinator = useCatalogWorkspaceProjectionCoordinator({
    api,
    index: {
      snapshot,
      projection: projected,
      ensureSnapshot
    },
    documents: {
      values: documents,
      reconcileProjection
    },
    state: {
      drafts,
      selectedResourceId,
      activeCreationResourceId
    },
    proposals: {
      all: () => options.conversations ?? [],
      resume
    },
    scheduler: {
      queueMicrotask(task) {
        microtasks.push(task);
      }
    },
    notifications,
    ...(options.loadMigrator
      ? { loadLegacyRecoveryMigrator: options.loadMigrator }
      : {})
  });
  return {
    activeCreationResourceId,
    aggregate,
    coordinator,
    documents,
    drafts,
    flushMicrotasks() {
      while (microtasks.length > 0) microtasks.shift()!();
    },
    index,
    microtasks,
    notifications,
    projected,
    reconcileProjection,
    resume,
    selectedResourceId,
    snapshot
  };
}

describe("useCatalogWorkspaceProjectionCoordinator", () => {
  it("keeps the normal metadata path aggregate-free and preserves an empty selection", async () => {
    const loadMigrator =
      vi.fn<() => Promise<CatalogLegacyRecoveryMigratorModule>>();
    const harness = createHarness({ loadMigrator });

    await expect(harness.coordinator.loadSnapshot()).resolves.toBe(true);

    expect(harness.index).toHaveBeenCalledTimes(1);
    expect(harness.aggregate).not.toHaveBeenCalled();
    expect(loadMigrator).not.toHaveBeenCalled();
    expect(harness.reconcileProjection).toHaveBeenCalledTimes(1);
    expect(harness.selectedResourceId.value).toBe("");
    expect(harness.activeCreationResourceId.value).toBe("");
    expect(harness.coordinator.reconciledProjection.value).toBe(
      harness.projected.value
    );
  });

  it("uses the last reconciled projection to preserve workspace anchors and leaves long resources alone", async () => {
    const oldDocument = workspaceDocument("document-old", "book-1");
    const nextDocument = workspaceDocument("document-next", "book-1");
    const harness = createHarness({
      snapshots: [catalogSnapshot(1), catalogSnapshot(2), catalogSnapshot(3)],
      projections: new Map([
        [
          1,
          projection({
            resourceId: "resource-old",
            document: oldDocument,
            workspaceId: "book-1"
          })
        ],
        [
          2,
          projection({
            resourceId: "resource-next",
            document: nextDocument,
            workspaceId: "book-1"
          })
        ],
        [3, projection()]
      ]),
      selectedResourceId: "resource-old",
      activeCreationResourceId: "resource-old"
    });

    await harness.coordinator.loadSnapshot();
    await harness.coordinator.loadSnapshot();
    expect(harness.selectedResourceId.value).toBe("resource-next");
    expect(harness.activeCreationResourceId.value).toBe("resource-next");

    harness.selectedResourceId.value = "long-book:novel-1:draft:chapter-1";
    await harness.coordinator.loadSnapshot();
    expect(harness.selectedResourceId.value).toBe(
      "long-book:novel-1:draft:chapter-1"
    );
  });

  it.each(["mystery-book:one", "mystery-document:one:role:two:profile"])(
    "preserves an active mystery resource %s when the catalog refreshes",
    async (selectedResourceId) => {
      const harness = createHarness({
        snapshots: [catalogSnapshot(1)],
        projections: new Map([[1, projection()]]),
        selectedResourceId
      });
      await harness.coordinator.loadSnapshot();
      expect(harness.selectedResourceId.value).toBe(selectedResourceId);
    }
  );

  it("loads and applies the legacy migrator only after a matching aggregate snapshot", async () => {
    const legacyKey = legacyBookDraftRecoveryKey("book-1");
    const document = workspaceDocument("document-1", "book-1", "disk");
    const conversation = pendingConversation();
    const migrateLegacyDraftRecoveries = vi.fn(() => ({
      drafts: {
        "document-1": {
          title: "恢复标题",
          content: "恢复正文",
          dirty: true
        }
      },
      migratedLegacyKeys: [legacyKey],
      unmappedLegacyKeys: []
    }));
    const loadMigrator = vi.fn(async () => ({
      migrateLegacyDraftRecoveries
    }));
    const harness = createHarness({
      snapshots: [catalogSnapshot(4, ["book-1"])],
      projections: new Map([
        [
          4,
          projection({
            resourceId: "resource-1",
            document,
            workspaceId: "book-1"
          })
        ]
      ]),
      aggregateSnapshots: [fullCatalogSnapshot(4)],
      drafts: {
        [legacyKey]: {
          title: "旧版恢复稿",
          content: "恢复正文",
          dirty: true
        }
      },
      conversations: [conversation],
      loadMigrator
    });

    await harness.coordinator.loadSnapshot();

    expect(harness.aggregate).toHaveBeenCalledTimes(1);
    expect(loadMigrator).toHaveBeenCalledTimes(1);
    expect(migrateLegacyDraftRecoveries).toHaveBeenCalledTimes(1);
    expect(harness.drafts.value[legacyKey]).toBeUndefined();
    expect(harness.drafts.value["document-1"]?.content).toBe("恢复正文");
    expect(harness.resume).not.toHaveBeenCalled();

    harness.flushMicrotasks();
    expect(harness.resume).toHaveBeenCalledWith([conversation]);
    expect(harness.documents.value).toEqual([document]);
  });

  it("repairs a recovered character overview title without losing unsaved body text", async () => {
    const document = workspaceDocument(
      "character-overview",
      "book-1",
      "磁盘人物正文"
    );
    document.title = "概览";
    document.stageId = "character_design";
    document.characterFileKind = "overview";
    const recovered: EditorDraftState = {
      title: "",
      content: "未保存的人物正文",
      dirty: true,
      recoveryUpdatedAt: "2026-08-18T10:00:00.000Z",
      baseRevision: "base-revision",
      baseProjectRevision: 7
    };
    const harness = createHarness({
      snapshots: [catalogSnapshot(5, ["book-1"])],
      projections: new Map([
        [
          5,
          projection({
            resourceId: "character-overview-resource",
            document,
            workspaceId: "book-1"
          })
        ]
      ]),
      drafts: { "character-overview": recovered }
    });

    await harness.coordinator.loadSnapshot();

    expect(harness.drafts.value["character-overview"]).toEqual({
      ...recovered,
      title: "概览"
    });
  });

  it("coalesces a burst into one load and at most one trailing refresh", async () => {
    const first = deferred<CatalogIndexSnapshot>();
    const trailing = deferred<CatalogIndexSnapshot>();
    const index = vi
      .fn<() => Promise<CatalogIndexSnapshot>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(trailing.promise);
    const harness = createHarness({
      snapshots: [],
      projections: new Map([
        [1, projection()],
        [2, projection()]
      ]),
      api: () => ({ index, snapshot: vi.fn() })
    });

    const firstRequest = harness.coordinator.loadSnapshot();
    const secondRequest = harness.coordinator.loadSnapshot();
    const thirdRequest = harness.coordinator.loadSnapshot();
    expect(secondRequest).toBe(firstRequest);
    expect(thirdRequest).toBe(firstRequest);
    expect(index).toHaveBeenCalledTimes(1);

    first.resolve(catalogSnapshot(1));
    await vi.waitFor(() => expect(index).toHaveBeenCalledTimes(2));
    const duringTrailing = harness.coordinator.loadSnapshot();
    expect(duringTrailing).toBe(firstRequest);
    trailing.resolve(catalogSnapshot(2));
    await firstRequest;

    expect(index).toHaveBeenCalledTimes(2);
    expect(harness.reconcileProjection).toHaveBeenCalledTimes(2);
  });

  it("rejects a stale aggregate pair before loading or publishing the migrator", async () => {
    const legacyKey = legacyBookDraftRecoveryKey("book-1");
    const aggregate = deferred<CatalogSnapshot>();
    const pairOneProjection = projection();
    const pairTwoProjection = projection({
      resourceId: "resource-2",
      document: workspaceDocument("document-2", "book-2")
    });
    const loadMigrator = vi.fn(async () => ({
      migrateLegacyDraftRecoveries: vi.fn()
    }));
    const harness = createHarness({
      snapshots: [catalogSnapshot(1, ["book-1"])],
      projections: new Map([[1, pairOneProjection]]),
      drafts: {
        [legacyKey]: { title: "旧稿", content: "正文", dirty: true }
      },
      api: () => ({
        index: async () => catalogSnapshot(1, ["book-1"]),
        snapshot: () => aggregate.promise
      }),
      loadMigrator
    });

    const loading = harness.coordinator.loadSnapshot();
    await vi.waitFor(() =>
      expect(harness.projected.value).toBe(pairOneProjection)
    );
    harness.snapshot.value = catalogSnapshot(2);
    harness.projected.value = pairTwoProjection;
    aggregate.resolve(fullCatalogSnapshot(1));

    await expect(loading).resolves.toBe(false);
    expect(loadMigrator).not.toHaveBeenCalled();
    expect(harness.reconcileProjection).not.toHaveBeenCalled();
    expect(harness.notifications.warning).not.toHaveBeenCalled();
    expect(harness.resume).not.toHaveBeenCalled();
  });

  it("preserves legacy recovery across a revision mismatch and performs one bounded trailing retry", async () => {
    const legacyKey = legacyBookDraftRecoveryKey("book-1");
    const migrateLegacyDraftRecoveries = vi.fn((drafts) => ({
      drafts: { ...drafts },
      migratedLegacyKeys: [],
      unmappedLegacyKeys: []
    }));
    const loadMigrator = vi.fn(async () => ({
      migrateLegacyDraftRecoveries
    }));
    const harness = createHarness({
      snapshots: [
        catalogSnapshot(1, ["book-1"]),
        catalogSnapshot(2, ["book-1"])
      ],
      projections: new Map([
        [1, projection()],
        [2, projection()]
      ]),
      aggregateSnapshots: [fullCatalogSnapshot(2), fullCatalogSnapshot(2)],
      drafts: {
        [legacyKey]: { title: "旧稿", content: "正文", dirty: true }
      },
      loadMigrator
    });

    await expect(harness.coordinator.loadSnapshot()).resolves.toBe(true);

    expect(harness.index).toHaveBeenCalledTimes(2);
    expect(harness.aggregate).toHaveBeenCalledTimes(2);
    expect(loadMigrator).toHaveBeenCalledTimes(1);
    expect(migrateLegacyDraftRecoveries).toHaveBeenCalledTimes(1);
    expect(harness.drafts.value[legacyKey]).toBeDefined();
    expect(harness.notifications.warning).toHaveBeenCalledTimes(1);
  });

  it("silently invalidates late work and queued proposal resume after disposal", async () => {
    const pendingIndex = deferred<CatalogIndexSnapshot>();
    const index = vi.fn(() => pendingIndex.promise);
    const harness = createHarness({
      snapshots: [],
      projections: new Map([[1, projection()]]),
      api: () => ({ index, snapshot: vi.fn() }),
      conversations: [pendingConversation()]
    });

    const loading = harness.coordinator.loadSnapshot();
    harness.coordinator.dispose();
    pendingIndex.resolve(catalogSnapshot(1));

    await expect(loading).resolves.toBe(false);
    harness.flushMicrotasks();
    expect(harness.reconcileProjection).not.toHaveBeenCalled();
    expect(harness.notifications.error).not.toHaveBeenCalled();
    expect(harness.notifications.warning).not.toHaveBeenCalled();
    expect(harness.resume).not.toHaveBeenCalled();
  });

  it("invalidates an already queued proposal resume when disposed", async () => {
    const harness = createHarness({ conversations: [pendingConversation()] });

    await harness.coordinator.loadSnapshot();
    expect(harness.microtasks).toHaveLength(1);
    harness.coordinator.dispose();
    harness.flushMicrotasks();

    expect(harness.resume).not.toHaveBeenCalled();
  });

  it("returns false without selecting or reporting when the desktop API is absent", async () => {
    const harness = createHarness({ api: () => undefined });

    await expect(harness.coordinator.loadSnapshot()).resolves.toBe(false);

    expect(harness.selectedResourceId.value).toBe("");
    expect(harness.activeCreationResourceId.value).toBe("");
    expect(harness.notifications.error).not.toHaveBeenCalled();
  });

  it("deduplicates diagnostics until they disappear from a committed snapshot", async () => {
    const diagnostic = {
      projectId: "project-test",
      kind: "deepwrite.book",
      code: "unavailable",
      message: "测试目录不可用"
    } as const;
    const harness = createHarness({
      snapshots: [
        catalogSnapshot(1, [], [diagnostic]),
        catalogSnapshot(2, [], [diagnostic]),
        catalogSnapshot(3),
        catalogSnapshot(4, [], [diagnostic])
      ],
      projections: new Map([
        [1, projection()],
        [2, projection()],
        [3, projection()],
        [4, projection()]
      ])
    });

    await harness.coordinator.loadSnapshot();
    await harness.coordinator.loadSnapshot();
    await harness.coordinator.loadSnapshot();
    await harness.coordinator.loadSnapshot();

    expect(harness.notifications.warning).toHaveBeenCalledTimes(2);
  });
});
