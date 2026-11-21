import { setAppLanguage, t } from "../i18n";
import { useCatalogDocumentLoader } from "../composables/useCatalogDocumentLoader";
import { useCatalogWorkspaceProjectionCoordinator } from "../composables/useCatalogWorkspaceProjectionCoordinator";
import type { EditorDraftState } from "../types/workspace";
import {
  CatalogIndexSnapshotSchema,
  createDefaultCreativePlotStages,
  type CatalogReadDocumentResult,
  type CatalogIndexSnapshot
} from "@deepwrite/contracts";
import { createPinia, setActivePinia, storeToRefs } from "pinia";
import { computed, effectScope, isReactive, ref, shallowRef } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projectCatalogWorkspaceSpy = vi.hoisted(() => vi.fn());

vi.mock("../data/catalogWorkspace", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../data/catalogWorkspace")>();
  return {
    ...actual,
    projectCatalogWorkspace: (snapshot: CatalogIndexSnapshot) => {
      projectCatalogWorkspaceSpy(snapshot);
      return actual.projectCatalogWorkspace(snapshot);
    }
  };
});

import {
  CatalogDocumentReadInvalidatedError,
  useCatalogIndexStore
} from "./catalogIndexStore";

const NOW = "2026-08-14T02:00:00.000Z";

function fixture(revision = 1, sourceBody = "索引正文"): CatalogIndexSnapshot {
  return CatalogIndexSnapshotSchema.parse({
    schemaVersion: 1,
    revision,
    creativePlotStages: createDefaultCreativePlotStages(),
    updatedAt: NOW,
    books: [],
    materials: [
      {
        id: "material-library",
        title: "测试素材库",
        materialType: "short",
        materialKind: "plot",
        parentGenre: "测试类型",
        subGenre: "测试子类",
        overview: "",
        overviewContentBytes: 12,
        overviewContentStamp: `manifest-v1:12:${NOW}`,
        entries: [
          {
            id: "material-entry",
            stageId: "pacing",
            title: "测试条目",
            body: "",
            contentBytes: new TextEncoder().encode(sourceBody).byteLength,
            contentStamp: `fs-v1:${new TextEncoder().encode(sourceBody).byteLength}:1:1`,
            createdAt: NOW,
            updatedAt: NOW
          }
        ],
        projectRevision: revision,
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    materialGroups: [],
    skills: [],
    skillGroups: []
  });
}

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(reason: unknown): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  setActivePinia(createPinia());
  projectCatalogWorkspaceSpy.mockClear();
});

afterEach(() => setAppLanguage("zh-CN", "zh-CN"));

describe("catalog index store", () => {
  it("changes display language without replacing reconciled projections or interrupting reads and drafts", async () => {
    const store = useCatalogIndexStore();
    const source = fixture();
    const index = vi.fn(async () => source);
    const pending = deferred<CatalogReadDocumentResult>();
    const readDocument = vi.fn(() => pending.promise);
    const loader = useCatalogDocumentLoader({
      catalogIndex: store,
      reader: () => ({ readDocument })
    });
    const refs = storeToRefs(store);
    const drafts = shallowRef<Record<string, EditorDraftState>>({});
    const selectedResourceId = ref("");
    const coordinator = useCatalogWorkspaceProjectionCoordinator({
      api: () => ({ index, snapshot: vi.fn() }),
      index: {
        snapshot: refs.snapshot,
        projection: refs.projection,
        ensureSnapshot: store.ensureSnapshot
      },
      documents: {
        values: loader.documents,
        reconcileProjection: loader.reconcileProjection
      },
      state: { drafts, selectedResourceId, activeCreationResourceId: ref("") },
      proposals: { all: () => [], resume: vi.fn() },
      scheduler: { queueMicrotask: vi.fn() },
      notifications: { error: vi.fn(), warning: vi.fn(), info: vi.fn() }
    });
    await coordinator.loadSnapshot();
    const projection = store.projection;
    const document = loader.documents.value.find(
      (item) => item.catalogEntryId === "material-entry"
    )!;
    selectedResourceId.value = document.id;
    const draft = {
      title: document.title,
      content: "unsaved writing",
      dirty: true
    };
    drafts.value = { [document.id]: draft };
    const sectionLabel = computed(
      () =>
        store.resourceSections.find((section) => section.id === "material")
          ?.label
    );
    const eyebrow = computed(
      () => loader.documentsById.value.get(document.id)?.eyebrow
    );
    const chineseLabel = sectionLabel.value;
    const chineseEyebrow = eyebrow.value;
    const loading = loader.ensureOne(document.id);
    setAppLanguage("en-US", "zh-CN");
    expect(sectionLabel.value).toBe(
      t("workspace.catalogWorkspace.materialLibrary")
    );
    expect(sectionLabel.value).not.toBe(chineseLabel);
    expect(eyebrow.value).not.toBe(chineseEyebrow);
    expect(store.projection).toBe(projection);
    expect(coordinator.reconciledProjection.value).toBe(projection);
    expect(store.snapshot).toBe(source);
    expect(selectedResourceId.value).toBe(document.id);
    expect(drafts.value[document.id]).toBe(draft);
    pending.resolve({
      projectId: "material-library",
      target: "document",
      documentId: "material-entry",
      title: "测试条目",
      content: "saved text",
      contentBytes: 10,
      revision: "v1:10:00000000",
      projectRevision: 1,
      updatedAt: NOW
    });
    expect((await loading).ok).toBe(true);
    expect(readDocument).toHaveBeenCalledTimes(1);
    expect(index).toHaveBeenCalledTimes(1);
    expect(projectCatalogWorkspaceSpy).toHaveBeenCalledTimes(1);
    const hydrated = loader.documentsById.value.get(document.id)!;
    expect(hydrated.content).toBe("saved text");
    setAppLanguage("zh-CN", "en-US");
    expect(eyebrow.value).toBe(chineseEyebrow);
    expect(loader.documentsById.value.get(document.id)).toBe(hydrated);
    expect(drafts.value[document.id]).toBe(draft);
    expect(readDocument).toHaveBeenCalledTimes(1);
    coordinator.dispose();
    loader.dispose();
    store.$dispose();
  });
  it("projects once and publishes the matching shallow snapshot and indexes", () => {
    const store = useCatalogIndexStore();
    const source = fixture();

    const projection = store.applySnapshot(source);

    expect(projectCatalogWorkspaceSpy).toHaveBeenCalledTimes(1);
    expect(projectCatalogWorkspaceSpy).toHaveBeenCalledWith(source);
    expect(store.snapshot).toBe(source);
    expect(store.projection).toBe(projection);
    expect(isReactive(store.snapshot)).toBe(false);
    expect(isReactive(store.projection)).toBe(false);

    const entryDocument = [...store.documentsById.values()].find(
      (document) => document.catalogEntryId === "material-entry"
    );
    expect(entryDocument?.content).toBe("");
    expect(source.materials[0]?.entries[0]).toMatchObject({
      body: "",
      contentBytes: new TextEncoder().encode("索引正文").byteLength
    });
    const resourceId = entryDocument
      ? store.resourceIdByDocumentId.get(entryDocument.id)
      : undefined;
    expect(resourceId).toBeTruthy();
    expect(
      resourceId ? store.resourceNodeById.get(resourceId) : undefined
    ).toBeDefined();
    expect(store.workspaceDocumentById).toBe(store.documentsById);
  });

  it("reuses the projection when the exact same immutable snapshot is applied again", () => {
    const store = useCatalogIndexStore();
    const source = fixture();

    const first = store.applySnapshot(source);
    const second = store.applySnapshot(source);

    expect(second).toBe(first);
    expect(projectCatalogWorkspaceSpy).toHaveBeenCalledTimes(1);
  });

  it("coalesces overlapping snapshot loads into one request and one trailing refresh", async () => {
    const store = useCatalogIndexStore();
    const first = deferred<CatalogIndexSnapshot>();
    const trailing = deferred<CatalogIndexSnapshot>();
    const loader = vi
      .fn<() => Promise<CatalogIndexSnapshot>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(trailing.promise);

    const firstRequest = store.ensureSnapshot(loader);
    const secondRequest = store.ensureSnapshot(loader);
    const thirdRequest = store.ensureSnapshot(loader);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(store.snapshotLoading).toBe(true);

    first.resolve(fixture(1, "第一版"));
    await Promise.resolve();
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(2);

    const duringTrailing = store.ensureSnapshot(loader);
    expect(loader).toHaveBeenCalledTimes(2);
    trailing.resolve(fixture(2, "第二版"));
    await Promise.all([
      firstRequest,
      secondRequest,
      thirdRequest,
      duringTrailing
    ]);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(projectCatalogWorkspaceSpy).toHaveBeenCalledTimes(2);
    expect(store.snapshot?.revision).toBe(2);
    expect(store.snapshotLoading).toBe(false);
  });

  it("resets failed snapshot single-flight state so a later call can retry", async () => {
    const store = useCatalogIndexStore();
    const loader = vi
      .fn<() => Promise<CatalogIndexSnapshot>>()
      .mockRejectedValueOnce(new Error("temporary catalog failure"))
      .mockResolvedValueOnce(fixture(3));

    await expect(store.ensureSnapshot(loader)).rejects.toThrow(
      "temporary catalog failure"
    );
    expect(store.snapshotLoading).toBe(false);

    const retriedProjection = await store.ensureSnapshot(loader);
    expect(retriedProjection).toBe(store.projection);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(store.snapshot?.revision).toBe(3);
  });

  it("keeps an established catalog interactive during a background refresh", async () => {
    const store = useCatalogIndexStore();
    const pendingRefresh = deferred<CatalogIndexSnapshot>();
    store.applySnapshot(fixture(1, "当前目录"));

    const refreshing = store.ensureSnapshot(() => pendingRefresh.promise);
    expect(store.snapshotLoading).toBe(false);

    pendingRefresh.resolve(fixture(2, "刷新目录"));
    await refreshing;
    expect(store.snapshot?.revision).toBe(2);
    expect(store.snapshotLoading).toBe(false);
  });

  it("keeps catalog data and in-flight reads alive across workspace scopes", async () => {
    const previousWorkspace = effectScope();
    const store = previousWorkspace.run(() => useCatalogIndexStore())!;
    const pending = deferred<CatalogIndexSnapshot>();
    store.applySnapshot(fixture(1));
    const refreshing = store.ensureSnapshot(() => pending.promise);
    previousWorkspace.stop();

    const replacementWorkspace = effectScope();
    try {
      const replacement = replacementWorkspace.run(() =>
        useCatalogIndexStore()
      )!;
      expect(replacement).toBe(store);
      expect(replacement.snapshot?.revision).toBe(1);
      pending.resolve(fixture(2));
      await refreshing;
      expect(replacement.snapshot?.revision).toBe(2);
    } finally {
      replacementWorkspace.stop();
      store.$dispose();
    }
  });

  it("deduplicates read-through loads and serves the immutable cached value", async () => {
    const store = useCatalogIndexStore();
    const pending = deferred<{
      readonly id: string;
      readonly content: string;
      readonly revision: number;
    }>();
    const loader = vi.fn(() => pending.promise);

    const first = store.readDocument("document", loader);
    const second = store.readDocument("document", loader);
    expect(loader).toHaveBeenCalledTimes(0);
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);

    const loaded = {
      id: "document",
      content: "按需正文",
      revision: 4
    } as const;
    pending.resolve(loaded);
    expect(await first).toBe(loaded);
    expect(await second).toBe(loaded);
    expect(store.getCachedDocument<typeof loaded>("document")).toBe(loaded);
    expect(await store.readDocument("document", loader)).toBe(loaded);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(store.documentCacheStats().retainedCharacters).toBe(4);
  });

  it("rejects and does not cache a stale document resolved after invalidation", async () => {
    const store = useCatalogIndexStore();
    const invalidatedLoad = deferred<{ readonly content: string }>();
    const invalidatedRequest = store.readDocument(
      "invalidated",
      () => invalidatedLoad.promise
    );
    const invalidatedRejection = expect(
      invalidatedRequest
    ).rejects.toMatchObject({
      name: "CatalogDocumentReadInvalidatedError",
      code: "CATALOG_DOCUMENT_READ_INVALIDATED",
      key: "invalidated"
    });

    store.invalidateDocument("invalidated");
    invalidatedLoad.resolve({ content: "旧正文" });
    await invalidatedRejection;
    expect(store.getCachedDocument("invalidated")).toBeUndefined();
  });

  it("invalidates every old waiter when a refreshing read supersedes it", async () => {
    const store = useCatalogIndexStore();
    const staleLoad = deferred<{ readonly content: string }>();
    const refreshedLoad = deferred<{ readonly content: string }>();
    const loader = vi
      .fn()
      .mockReturnValueOnce(staleLoad.promise)
      .mockReturnValueOnce(refreshedLoad.promise);

    const firstWaiter = store.readDocument("document", loader);
    const secondWaiter = store.readDocument("document", loader);
    const firstRejection = expect(firstWaiter).rejects.toBeInstanceOf(
      CatalogDocumentReadInvalidatedError
    );
    const secondRejection = expect(secondWaiter).rejects.toBeInstanceOf(
      CatalogDocumentReadInvalidatedError
    );
    const refreshedRequest = store.readDocument("document", loader, {
      refresh: true
    });
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(2);

    const staleValue = { content: "旧正文" } as const;
    const refreshedValue = { content: "新正文" } as const;
    staleLoad.resolve(staleValue);
    refreshedLoad.resolve(refreshedValue);

    await Promise.all([firstRejection, secondRejection]);
    expect(await refreshedRequest).toBe(refreshedValue);
    expect(store.getCachedDocument("document")).toBe(refreshedValue);
  });

  it("clears cached documents and invalidates reads still in flight", async () => {
    const store = useCatalogIndexStore();
    const lateLoad = deferred<{ readonly content: string }>();
    const lateRequest = store.readDocument("late", () => lateLoad.promise);
    const lateRejection = expect(lateRequest).rejects.toBeInstanceOf(
      CatalogDocumentReadInvalidatedError
    );

    store.cacheDocument("kept", { content: "缓存正文" });
    expect(store.documentCacheStats().entries).toBe(1);
    store.clearDocumentCache();
    expect(store.documentCacheStats().entries).toBe(0);

    lateLoad.resolve({ content: "过期正文" });
    await lateRejection;
    expect(store.getCachedDocument("late")).toBeUndefined();
  });

  it("clears reusable state and prevents late work from publishing after disposal", async () => {
    const store = useCatalogIndexStore();
    store.applySnapshot(fixture());
    store.cacheDocument("cached", { content: "缓存" });
    store.clear();
    expect(store.snapshot).toBeNull();
    expect(store.projection).toBeNull();
    expect(store.documentsById.size).toBe(0);
    expect(store.documentCacheStats().entries).toBe(0);

    await store.ensureSnapshot(async () => fixture(2));
    const late = deferred<CatalogIndexSnapshot>();
    const lateRequest = store.ensureSnapshot(() => late.promise);
    store.$dispose();
    late.resolve(fixture(3));

    await expect(lateRequest).rejects.toThrow("disposed");
    expect(store.snapshot).toBeNull();
    expect(store.projection).toBeNull();
    await expect(
      store.readDocument("after-dispose", async () => ({ content: "正文" }))
    ).rejects.toThrow("disposed");
  });
});
