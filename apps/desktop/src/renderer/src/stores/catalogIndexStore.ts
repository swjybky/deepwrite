import type { CatalogIndexSnapshot } from "@deepwrite/contracts";
import { defineStore } from "pinia";
import { computed, onScopeDispose, ref, shallowRef } from "vue";
import {
  ensureAcademicBookProjectorLoaded,
  projectCatalogWorkspace,
  type CatalogWorkspaceProjection,
  type DraftDirectoryProjection
} from "../data/catalogWorkspace";
import type {
  ResourceTreeNode,
  ResourceTreeSection,
  WorkspaceDocument
} from "../types/workspace";
import {
  createCatalogDocumentLru,
  type CatalogDocumentLruStats,
  type CatalogDocumentLruValue
} from "../utils/catalogDocumentLru";

export type CatalogIndexSnapshotLoader = () => Promise<CatalogIndexSnapshot>;
export type CatalogDocumentLoader<Value extends CatalogDocumentLruValue> =
  () => Promise<Readonly<Value>>;

export interface CatalogDocumentReadOptions {
  /** Ignore the cached value and start a fresh read. */
  refresh?: boolean;
}

/**
 * Signals that an otherwise successful document read was superseded before it
 * could be published. It remains an Error so existing generic error handling
 * stays compatible; callers that treat refresh cancellation as expected can
 * distinguish it with `instanceof`.
 */
export class CatalogDocumentReadInvalidatedError extends Error {
  readonly code = "CATALOG_DOCUMENT_READ_INVALIDATED";

  constructor(readonly key: string) {
    super(`Catalog document read was invalidated: ${key}`);
    this.name = "CatalogDocumentReadInvalidatedError";
  }
}

const EMPTY_RESOURCE_SECTIONS: readonly ResourceTreeSection[] = Object.freeze(
  []
);
const EMPTY_WORKSPACE_DOCUMENTS: readonly WorkspaceDocument[] = Object.freeze(
  []
);
const EMPTY_DRAFT_DIRECTORIES: readonly DraftDirectoryProjection[] =
  Object.freeze([]);
const EMPTY_RESOURCE_NODE_MAP: ReadonlyMap<string, ResourceTreeNode> =
  new Map();
const EMPTY_WORKSPACE_DOCUMENT_MAP: ReadonlyMap<string, WorkspaceDocument> =
  new Map();
const EMPTY_STRING_MAP: ReadonlyMap<string, string> = new Map();
const EMPTY_DRAFT_DIRECTORY_MAP: ReadonlyMap<string, DraftDirectoryProjection> =
  new Map();

function disposedError(): Error {
  return new Error("Catalog index store has been disposed.");
}

function invalidatedError(): Error {
  return new Error("Catalog index load was invalidated.");
}

export const useCatalogIndexStore = defineStore("catalogIndex", () => {
  // Catalog snapshots and projections are immutable aggregate values. Keeping
  // them shallow prevents Vue from proxying every tree node and document body.
  const snapshot = shallowRef<CatalogIndexSnapshot | null>(null);
  const projection = shallowRef<CatalogWorkspaceProjection | null>(null);
  const snapshotLoading = ref(false);

  const documentCache = createCatalogDocumentLru<CatalogDocumentLruValue>();
  const documentLoads = new Map<
    string,
    Promise<Readonly<CatalogDocumentLruValue>>
  >();
  const documentKeyGenerations = new Map<string, number>();

  let disposed = false;
  let lifecycleGeneration = 0;
  let snapshotGeneration = 0;
  let documentGeneration = 0;
  let snapshotLoadPromise: Promise<CatalogWorkspaceProjection> | null = null;
  let snapshotTrailingRefreshRequested = false;

  const resourceSections = computed<readonly ResourceTreeSection[]>(
    () => projection.value?.resourceSections ?? EMPTY_RESOURCE_SECTIONS
  );
  const workspaceDocuments = computed<readonly WorkspaceDocument[]>(
    () => projection.value?.workspaceDocuments ?? EMPTY_WORKSPACE_DOCUMENTS
  );
  const draftDirectories = computed<readonly DraftDirectoryProjection[]>(
    () => projection.value?.draftDirectories ?? EMPTY_DRAFT_DIRECTORIES
  );
  const documentsById = computed<ReadonlyMap<string, WorkspaceDocument>>(
    () =>
      projection.value?.index.workspaceDocumentById ??
      EMPTY_WORKSPACE_DOCUMENT_MAP
  );
  const workspaceDocumentById = documentsById;
  const resourceNodeById = computed<ReadonlyMap<string, ResourceTreeNode>>(
    () => projection.value?.index.resourceNodeById ?? EMPTY_RESOURCE_NODE_MAP
  );
  const resourceIdByDocumentId = computed<ReadonlyMap<string, string>>(
    () => projection.value?.index.resourceIdByDocumentId ?? EMPTY_STRING_MAP
  );
  const resourceTargetDocumentIdById = computed<ReadonlyMap<string, string>>(
    () =>
      projection.value?.index.resourceTargetDocumentIdById ?? EMPTY_STRING_MAP
  );
  const draftDirectoryById = computed<
    ReadonlyMap<string, DraftDirectoryProjection>
  >(
    () =>
      projection.value?.index.draftDirectoryById ?? EMPTY_DRAFT_DIRECTORY_MAP
  );
  const draftDirectoryByWorkspaceId = computed<
    ReadonlyMap<string, DraftDirectoryProjection>
  >(
    () =>
      projection.value?.index.draftDirectoryByWorkspaceId ??
      EMPTY_DRAFT_DIRECTORY_MAP
  );
  const preferredResourceIdByWorkspaceId = computed<
    ReadonlyMap<string, string>
  >(
    () =>
      projection.value?.index.preferredResourceIdByWorkspaceId ??
      EMPTY_STRING_MAP
  );
  const workspaceIdByResourceId = computed<ReadonlyMap<string, string>>(
    () => projection.value?.index.workspaceIdByResourceId ?? EMPTY_STRING_MAP
  );

  function assertActive(): void {
    if (disposed) throw disposedError();
  }

  /** Projects exactly once, then publishes the matching immutable pair. */
  function applySnapshot(
    nextSnapshot: CatalogIndexSnapshot
  ): CatalogWorkspaceProjection {
    assertActive();
    if (snapshot.value === nextSnapshot && projection.value) {
      return projection.value;
    }
    const nextProjection = projectCatalogWorkspace(nextSnapshot);
    snapshot.value = nextSnapshot;
    projection.value = nextProjection;
    return nextProjection;
  }

  function assertSnapshotRequestActive(
    requestLifecycleGeneration: number,
    requestSnapshotGeneration: number
  ): void {
    if (disposed || requestLifecycleGeneration !== lifecycleGeneration) {
      throw disposedError();
    }
    if (requestSnapshotGeneration !== snapshotGeneration) {
      throw invalidatedError();
    }
  }

  async function ensureSnapshot(
    loader: CatalogIndexSnapshotLoader
  ): Promise<CatalogWorkspaceProjection> {
    assertActive();
    if (snapshotLoadPromise) {
      // Any number of overlapping callers coalesce into one additional read.
      // Calls that arrive while that trailing read is already running join it.
      snapshotTrailingRefreshRequested = true;
      return await snapshotLoadPromise;
    }

    const requestLifecycleGeneration = lifecycleGeneration;
    const requestSnapshotGeneration = snapshotGeneration;
    const request = (async () => {
      const firstSnapshot = await loader();
      if (firstSnapshot.books.some((book) => book.bookType === "academic")) {
        await ensureAcademicBookProjectorLoaded();
      }
      assertSnapshotRequestActive(
        requestLifecycleGeneration,
        requestSnapshotGeneration
      );
      let latestProjection = applySnapshot(firstSnapshot);

      if (snapshotTrailingRefreshRequested) {
        snapshotTrailingRefreshRequested = false;
        const trailingSnapshot = await loader();
        if (
          trailingSnapshot.books.some((book) => book.bookType === "academic")
        ) {
          await ensureAcademicBookProjectorLoaded();
        }
        assertSnapshotRequestActive(
          requestLifecycleGeneration,
          requestSnapshotGeneration
        );
        latestProjection = applySnapshot(trailingSnapshot);
      }
      return latestProjection;
    })();
    snapshotLoadPromise = request;
    // Once a usable snapshot exists, later focus-driven refreshes are
    // background reconciliation. They must not make open catalog forms look
    // like their initial data is loading or temporarily disable controls.
    snapshotLoading.value = snapshot.value === null;
    try {
      return await request;
    } finally {
      if (snapshotLoadPromise === request) {
        snapshotLoadPromise = null;
        snapshotTrailingRefreshRequested = false;
        snapshotLoading.value = false;
      }
    }
  }

  function getCachedDocument<Value extends CatalogDocumentLruValue>(
    key: string
  ): Readonly<Value> | undefined {
    return documentCache.get(key) as Readonly<Value> | undefined;
  }

  function nextDocumentKeyGeneration(key: string): number {
    const next = (documentKeyGenerations.get(key) ?? 0) + 1;
    documentKeyGenerations.set(key, next);
    return next;
  }

  function invalidateDocument(key: string): boolean {
    nextDocumentKeyGeneration(key);
    documentLoads.delete(key);
    return documentCache.delete(key);
  }

  function assertDocumentRequestActive(
    key: string,
    requestLifecycleGeneration: number,
    requestDocumentGeneration: number,
    requestKeyGeneration: number
  ): void {
    if (disposed || requestLifecycleGeneration !== lifecycleGeneration) {
      throw disposedError();
    }
    if (
      requestDocumentGeneration !== documentGeneration ||
      requestKeyGeneration !== (documentKeyGenerations.get(key) ?? 0)
    ) {
      throw new CatalogDocumentReadInvalidatedError(key);
    }
  }

  function cacheDocument<Value extends CatalogDocumentLruValue>(
    key: string,
    value: Readonly<Value>
  ): boolean {
    assertActive();
    invalidateDocument(key);
    return documentCache.set(key, value);
  }

  async function readDocument<Value extends CatalogDocumentLruValue>(
    key: string,
    loader: CatalogDocumentLoader<Value>,
    options: CatalogDocumentReadOptions = {}
  ): Promise<Readonly<Value>> {
    assertActive();
    if (options.refresh) {
      invalidateDocument(key);
    } else {
      const cached = getCachedDocument<Value>(key);
      if (cached) return cached;
      const pending = documentLoads.get(key);
      if (pending) return (await pending) as Readonly<Value>;
    }

    const requestLifecycleGeneration = lifecycleGeneration;
    const requestDocumentGeneration = documentGeneration;
    const requestKeyGeneration = documentKeyGenerations.get(key) ?? 0;
    const request = Promise.resolve()
      .then(loader)
      .then((loaded) => {
        assertDocumentRequestActive(
          key,
          requestLifecycleGeneration,
          requestDocumentGeneration,
          requestKeyGeneration
        );
        documentCache.set(key, loaded);
        return loaded;
      })
      .finally(() => {
        if (documentLoads.get(key) === request) {
          documentLoads.delete(key);
        }
      });
    documentLoads.set(key, request);
    return (await request) as Readonly<Value>;
  }

  function clearDocumentCache(): void {
    documentGeneration += 1;
    documentKeyGenerations.clear();
    documentLoads.clear();
    documentCache.clear();
  }

  function documentCacheStats(): Readonly<CatalogDocumentLruStats> {
    return documentCache.stats();
  }

  /** Clears published state and invalidates late async results without disposal. */
  function clear(): void {
    assertActive();
    snapshotGeneration += 1;
    snapshotLoadPromise = null;
    snapshotTrailingRefreshRequested = false;
    snapshotLoading.value = false;
    snapshot.value = null;
    projection.value = null;
    clearDocumentCache();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    lifecycleGeneration += 1;
    snapshotGeneration += 1;
    snapshotLoadPromise = null;
    snapshotTrailingRefreshRequested = false;
    snapshotLoading.value = false;
    snapshot.value = null;
    projection.value = null;
    clearDocumentCache();
  }

  onScopeDispose(dispose);

  return {
    snapshot,
    projection,
    snapshotLoading,
    resourceSections,
    workspaceDocuments,
    draftDirectories,
    documentsById,
    workspaceDocumentById,
    resourceNodeById,
    resourceIdByDocumentId,
    resourceTargetDocumentIdById,
    draftDirectoryById,
    draftDirectoryByWorkspaceId,
    preferredResourceIdByWorkspaceId,
    workspaceIdByResourceId,
    applySnapshot,
    ensureSnapshot,
    getCachedDocument,
    cacheDocument,
    readDocument,
    invalidateDocument,
    clearDocumentCache,
    documentCacheStats,
    clear,
    dispose
  };
});
