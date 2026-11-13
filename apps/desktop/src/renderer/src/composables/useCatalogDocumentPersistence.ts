import { patchCatalogDocument } from "../utils/patchCatalogDocument";
import { formatError } from "../i18n/errors";
import { getErrorCode } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import {
  createShortWorkspaceContentRevision,
  type Book,
  type CatalogLibrary,
  type CatalogLibraryEntry,
  type DeepWriteApi
} from "@deepwrite/contracts";
import {
  getCurrentInstance,
  provide,
  ref,
  type Ref,
  type ShallowRef
} from "vue";
import {
  CATALOG_DOCUMENT_VERSION_PORT,
  type CatalogDocumentVersionPort
} from "./catalogDocumentVersionPort";
import type {
  CatalogDocumentLoadResult,
  CatalogDocumentTarget,
  CatalogDocumentsLoadResult,
  EnsureCatalogDocumentsOptions,
  InvalidateCatalogDocumentOptions
} from "./useCatalogDocumentLoader";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";
import {
  captureWorkspaceDocumentBaselines,
  rebaseDraftsForMatchingDocuments,
  type WorkspaceDocumentBaseline
} from "../utils/catalogSaveReconciliation";
import { catalogDocumentReadDescriptor } from "../utils/catalogDocumentContent";
import { draftCharacterStateTitle } from "../utils/draftFileTitles";
import {
  normalizeFixedWorkspaceDocumentDraft,
  resolveWorkspaceDocumentTitle
} from "../utils/fixedWorkspaceDocumentTitle";

const t = createScopedTranslator("workspace");

export interface CatalogDocumentPersistenceNotifications {
  error(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
}

export interface CatalogDocumentPersistenceLoaderPort {
  preserveAuthoritativeBodyForNextProjection(
    documentId: string,
    content: string,
    expectedProjectRevision?: number
  ): void;
  ensureLoaded(
    targets?: readonly CatalogDocumentTarget[],
    options?: EnsureCatalogDocumentsOptions
  ): Promise<CatalogDocumentsLoadResult>;
  ensureOne(
    target: CatalogDocumentTarget,
    options?: EnsureCatalogDocumentsOptions
  ): Promise<CatalogDocumentLoadResult>;
  invalidate(
    target: CatalogDocumentTarget,
    options?: InvalidateCatalogDocumentOptions
  ): boolean;
}

export interface CatalogDocumentPersistenceCatalogPort {
  refreshIndex(): Promise<boolean>;
  findBook(bookId: string): Book | undefined;
  findLibrary(
    domain: "material" | "skill",
    libraryId: string
  ): CatalogLibrary | undefined;
}

export interface CatalogDocumentPersistenceOptions {
  api(): DeepWriteApi["catalog"] | undefined;
  documents: ShallowRef<WorkspaceDocument[]>;
  drafts: ShallowRef<Record<string, EditorDraftState>>;
  acceptingWorkspaceIds: Ref<Set<string>>;
  loader: CatalogDocumentPersistenceLoaderPort;
  catalog: CatalogDocumentPersistenceCatalogPort;
  nextRecoveryTimestamp(): string;
  scheduleAutoSave(documentId: string): void;
  notifications: CatalogDocumentPersistenceNotifications;
}

export interface CatalogDocumentPayload {
  id: string;
  title: string;
  content: string;
}

export interface SaveConflictState {
  documentId: string;
  payload: CatalogDocumentPayload;
  diskTitle: string;
  diskContent: string;
}

export interface CatalogDocumentSaveOptions {
  force?: boolean;
  announceSuccess?: boolean;
}

export interface RetryCatalogBookReconciliationOptions {
  /** Skip the global index read when the caller has just refreshed it. */
  catalogAlreadyRefreshed?: boolean;
}

interface PendingBookReconciliation {
  expectedDocuments: ReadonlyMap<string, WorkspaceDocumentBaseline>;
  minimumProjectRevision?: number;
}

export type CatalogDocumentPersistOutcome = "saved" | "retry" | "paused";

/**
 * Owns durable catalog writes and the draft transitions around them. Timers,
 * editor input staging, and proposal write barriers remain outside this
 * boundary so the Shell can coordinate those independent concerns explicitly.
 */
export function useCatalogDocumentPersistence(
  options: CatalogDocumentPersistenceOptions
) {
  const {
    documents,
    drafts: editorDrafts,
    acceptingWorkspaceIds,
    loader,
    catalog,
    nextRecoveryTimestamp,
    scheduleAutoSave,
    notifications: uiMessage
  } = options;
  const savingDocumentIds = ref<Set<string>>(new Set());
  const saveConflict = ref<SaveConflictState | null>(null);
  const saveConflictSubmitting = ref(false);
  const activeOperations = new Set<Promise<unknown>>();
  const pendingBookReconciliations = new Map<
    string,
    PendingBookReconciliation
  >();
  let disposed = false;

  function trackOperation<Value>(
    start: () => Promise<Value>,
    disposedValue: Value
  ): Promise<Value> {
    if (disposed) return Promise.resolve(disposedValue);
    let operation: Promise<Value>;
    try {
      operation = start();
    } catch (error: unknown) {
      operation = Promise.reject(error);
    }
    activeOperations.add(operation);
    void operation.then(
      () => activeOperations.delete(operation),
      () => activeOperations.delete(operation)
    );
    return operation;
  }

  async function drain(): Promise<void> {
    while (activeOperations.size > 0) {
      await Promise.allSettled([...activeOperations]);
    }
  }

  async function dispose(): Promise<void> {
    disposed = true;
    await drain();
    pendingBookReconciliations.clear();
  }

  function scheduleDirtyAutoSaves(excludedDocumentId?: string): void {
    for (const [documentId, draft] of Object.entries(editorDrafts.value)) {
      if (draft.dirty && documentId !== excludedDocumentId) {
        scheduleAutoSave(documentId);
      }
    }
  }

  function api(): DeepWriteApi["catalog"] | undefined {
    return options.api();
  }

  function applyDocumentLocally(
    payload: CatalogDocumentPayload,
    savedProjectRevision?: number,
    submittedPayload = payload
  ): void {
    const index = documents.value.findIndex(
      (document) => document.id === payload.id
    );
    if (index < 0) return;

    const current = documents.value[index]!;
    loader.invalidate(current);
    const projectDocumentIds = new Set(
      documents.value.flatMap((document) => {
        const belongsToProject = current.workspaceId
          ? document.workspaceId === current.workspaceId
          : current.libraryId
            ? document.libraryId === current.libraryId &&
              document.domain === current.domain
            : document.id === current.id;
        return belongsToProject ? [document.id] : [];
      })
    );
    documents.value = documents.value.map((document) => {
      if (!projectDocumentIds.has(document.id)) return document;
      const withProjectRevision =
        savedProjectRevision === undefined
          ? document
          : patchCatalogDocument(document, {
              catalogProjectRevision: savedProjectRevision
            });
      if (document.id === payload.id) {
        if (current.catalogLibraryField === "overview") {
          return patchCatalogDocument(withProjectRevision, {
            content: payload.content,
            catalogContentLoaded: true
          });
        }
        const renamed = payload.title !== current.title;
        return patchCatalogDocument(withProjectRevision, {
          content: payload.content,
          catalogContentLoaded: true,
          ...(renamed
            ? {
                title: payload.title,
                get path() {
                  const path = [...withProjectRevision.path];
                  const titleIndex =
                    document.draftFileKind === "body"
                      ? path.length - 2
                      : path.length - 1;
                  if (titleIndex >= 0) path[titleIndex] = payload.title;
                  return path;
                }
              }
            : {})
        });
      }
      if (
        current.draftFileKind === "body" &&
        document.draftFileKind === "character-state" &&
        document.expertSectionId === current.expertSectionId &&
        payload.title !== current.title
      ) {
        return patchCatalogDocument(withProjectRevision, {
          title: draftCharacterStateTitle(payload.title),
          get path() {
            const path = [...withProjectRevision.path];
            if (path.length >= 2) path[path.length - 2] = payload.title;
            return path;
          }
        });
      }
      return withProjectRevision;
    });

    const currentDraft = editorDrafts.value[payload.id];
    const normalizedCurrentDraft = currentDraft
      ? normalizeFixedWorkspaceDocumentDraft(current, currentDraft)
      : undefined;
    const nextDrafts = { ...editorDrafts.value };
    if (savedProjectRevision !== undefined) {
      for (const documentId of projectDocumentIds) {
        const draft = nextDrafts[documentId];
        if (draft?.dirty) {
          nextDrafts[documentId] = {
            ...draft,
            recoveryUpdatedAt: nextRecoveryTimestamp(),
            baseProjectRevision: savedProjectRevision
          };
        }
      }
    }
    if (current.draftFileKind === "body" && current.expertSectionId) {
      const pairedState = documents.value.find(
        (document) =>
          document.workspaceId === current.workspaceId &&
          document.expertSectionId === current.expertSectionId &&
          document.draftFileKind === "character-state"
      );
      if (pairedState && nextDrafts[pairedState.id]) {
        nextDrafts[pairedState.id] = {
          ...nextDrafts[pairedState.id]!,
          title: draftCharacterStateTitle(payload.title)
        };
      }
    }
    if (
      normalizedCurrentDraft &&
      (normalizedCurrentDraft.title !== submittedPayload.title ||
        normalizedCurrentDraft.content !== submittedPayload.content)
    ) {
      nextDrafts[payload.id] = {
        ...normalizedCurrentDraft,
        ...(current.draftFileKind === "character-state"
          ? { title: payload.title }
          : {}),
        dirty: true,
        recoveryUpdatedAt: nextRecoveryTimestamp(),
        baseRevision: createShortWorkspaceContentRevision(payload.content),
        ...(savedProjectRevision === undefined
          ? {}
          : { baseProjectRevision: savedProjectRevision })
      };
    } else {
      delete nextDrafts[payload.id];
    }
    editorDrafts.value = nextDrafts;
  }

  function applyAcceptedAgentDocumentLocally(
    payload: CatalogDocumentPayload,
    savedProjectRevision: number | undefined,
    draftAtAccept: EditorDraftState | undefined
  ): void {
    const persistedDocument = documents.value.find(
      (document) => document.id === payload.id
    );
    if (persistedDocument && catalogDocumentReadDescriptor(persistedDocument)) {
      loader.preserveAuthoritativeBodyForNextProjection(
        payload.id,
        payload.content,
        savedProjectRevision
      );
    }
    const currentDraft = editorDrafts.value[payload.id];
    if (currentDraft && currentDraft === draftAtAccept) {
      editorDrafts.value = {
        ...editorDrafts.value,
        [payload.id]: {
          ...currentDraft,
          title: payload.title,
          content: payload.content
        }
      };
    }
    applyDocumentLocally(payload, savedProjectRevision);
  }

  async function reconcileBookAfterSuccessfulDocumentSave(
    workspaceId: string,
    reconciliation: PendingBookReconciliation,
    refreshIndex: boolean,
    notifyFailure: boolean
  ): Promise<boolean> {
    const { expectedDocuments, minimumProjectRevision } = reconciliation;
    if (!api()) return false;
    try {
      const currentRevision = catalog.findBook(workspaceId)?.projectRevision;
      const documentIdsToHydrate = new Set(
        documents.value.flatMap((document) =>
          document.workspaceId === workspaceId &&
          (document.catalogContentLoaded !== false ||
            editorDrafts.value[document.id]?.dirty)
            ? [document.id]
            : []
        )
      );
      if (refreshIndex && !(await catalog.refreshIndex())) {
        throw new Error(
          t(
            "catalogDocumentPersistence.theLatestDirectorySnapshotCouldNotBeReadAfter"
          )
        );
      }
      const latestBook = catalog.findBook(workspaceId);
      if (!latestBook) {
        throw new Error(
          t(
            "catalogDocumentPersistence.theSavedBookIsMissingFromTheLatestDirectory"
          )
        );
      }
      const latestRevision = latestBook.projectRevision;
      if (
        minimumProjectRevision !== undefined &&
        (latestRevision === undefined ||
          latestRevision < minimumProjectRevision)
      ) {
        throw new Error(
          t(
            "catalogDocumentPersistence.theDirectoryHasNotReachedTheSavedVersionYet"
          )
        );
      }
      if (
        latestRevision !== undefined &&
        currentRevision !== undefined &&
        latestRevision < currentRevision
      ) {
        throw new Error(
          t(
            "catalogDocumentPersistence.theDirectoryVersionReadAfterSavingMovedBackwards"
          )
        );
      }

      const scopedDocuments = documents.value.filter(
        (document) =>
          document.workspaceId === workspaceId &&
          documentIdsToHydrate.has(document.id)
      );
      const loaded = await loader.ensureLoaded(scopedDocuments);
      if (!loaded.ok) {
        throw new Error(
          t(
            "catalogDocumentPersistence.theLatestManuscriptContentCouldNotBeReadAfter"
          )
        );
      }
      editorDrafts.value = rebaseDraftsForMatchingDocuments(
        editorDrafts.value,
        documents.value,
        workspaceId,
        expectedDocuments,
        catalog.findBook(workspaceId)?.projectRevision,
        nextRecoveryTimestamp()
      );
      if (pendingBookReconciliations.get(workspaceId) === reconciliation) {
        pendingBookReconciliations.delete(workspaceId);
      }
      return true;
    } catch {
      if (notifyFailure) {
        uiMessage.warning(
          t(
            "catalogDocumentPersistence.manuscriptSavedButTheLatestDirectoryVersionHasNot"
          )
        );
      }
      return false;
    }
  }

  function queueBookReconciliation(
    workspaceId: string,
    expectedDocuments: ReadonlyMap<string, WorkspaceDocumentBaseline>,
    minimumProjectRevision?: number
  ): PendingBookReconciliation {
    const pending = pendingBookReconciliations.get(workspaceId);
    const strongestMinimumProjectRevision = [
      pending?.minimumProjectRevision,
      minimumProjectRevision
    ].reduce<number | undefined>(
      (strongest, revision) =>
        revision === undefined
          ? strongest
          : strongest === undefined
            ? revision
            : Math.max(strongest, revision),
      undefined
    );
    const reconciliation: PendingBookReconciliation = {
      expectedDocuments,
      ...(strongestMinimumProjectRevision === undefined
        ? {}
        : { minimumProjectRevision: strongestMinimumProjectRevision })
    };
    pendingBookReconciliations.set(workspaceId, reconciliation);
    return reconciliation;
  }

  async function refreshBookAfterSuccessfulDocumentSave(
    workspaceId: string,
    expectedDocuments: ReadonlyMap<string, WorkspaceDocumentBaseline>,
    minimumProjectRevision?: number
  ): Promise<boolean> {
    const reconciliation = queueBookReconciliation(
      workspaceId,
      expectedDocuments,
      minimumProjectRevision
    );
    return reconcileBookAfterSuccessfulDocumentSave(
      workspaceId,
      reconciliation,
      true,
      true
    );
  }

  async function retryPendingBookReconciliations(
    retryOptions: RetryCatalogBookReconciliationOptions = {}
  ): Promise<boolean> {
    const pending = [...pendingBookReconciliations.entries()];
    if (!pending.length) return true;
    if (
      !retryOptions.catalogAlreadyRefreshed &&
      !(await catalog.refreshIndex())
    ) {
      return false;
    }
    const outcomes = await Promise.all(
      pending.map(([workspaceId, reconciliation]) =>
        reconcileBookAfterSuccessfulDocumentSave(
          workspaceId,
          reconciliation,
          false,
          false
        )
      )
    );
    return outcomes.every(Boolean) && pendingBookReconciliations.size === 0;
  }

  function setDocumentSaving(documentId: string, saving: boolean): void {
    const next = new Set(savingDocumentIds.value);
    if (saving) next.add(documentId);
    else next.delete(documentId);
    savingDocumentIds.value = next;
  }

  async function refreshCatalogAfterLibraryMutation(
    domain: "material" | "skill",
    libraryId: string,
    expectedProjectRevision: number | undefined,
    expectedEntryId?: string
  ): Promise<boolean> {
    const loaded = await catalog.refreshIndex();
    const library = catalog.findLibrary(domain, libraryId);
    const revisionMatches =
      expectedProjectRevision === undefined ||
      (library?.projectRevision !== undefined &&
        library.projectRevision >= expectedProjectRevision);
    const entryMatches =
      expectedEntryId === undefined ||
      library?.entries.some((entry) => entry.id === expectedEntryId) === true;
    if (loaded && library && revisionMatches && entryMatches) return true;
    uiMessage.warning(
      t(
        "catalogDocumentPersistence.libraryChangesSavedToDiskButTheLatestDirectory"
      )
    );
    return false;
  }

  async function applySavedLibraryEntry(
    domain: "material" | "skill",
    libraryId: string,
    saved: CatalogLibraryEntry,
    projectRevision: number | undefined
  ): Promise<number | undefined> {
    const savedDocument = documents.value.find(
      (document) =>
        document.domain === domain &&
        document.libraryId === libraryId &&
        document.catalogEntryId === saved.id
    );
    if (savedDocument) {
      loader.preserveAuthoritativeBodyForNextProjection(
        savedDocument.id,
        saved.body,
        projectRevision
      );
    }
    const synchronized = await refreshCatalogAfterLibraryMutation(
      domain,
      libraryId,
      projectRevision,
      saved.id
    );
    const currentProjectRevision = catalog.findLibrary(
      domain,
      libraryId
    )?.projectRevision;
    if (synchronized) return currentProjectRevision;
    if (currentProjectRevision === undefined) return projectRevision;
    if (projectRevision === undefined) return currentProjectRevision;
    return Math.max(currentProjectRevision, projectRevision);
  }

  async function applyUpdatedCatalogLibrary(
    domain: "material" | "skill",
    updated: CatalogLibrary
  ): Promise<void> {
    const overviewDocument = documents.value.find(
      (document) =>
        document.domain === domain &&
        document.libraryId === updated.id &&
        document.catalogLibraryField === "overview"
    );
    if (overviewDocument) {
      loader.preserveAuthoritativeBodyForNextProjection(
        overviewDocument.id,
        updated.overview,
        updated.projectRevision
      );
    }
    await refreshCatalogAfterLibraryMutation(
      domain,
      updated.id,
      updated.projectRevision
    );
  }

  async function applyCreatedLibraryEntry(
    domain: "material" | "skill",
    libraryId: string,
    created: CatalogLibraryEntry,
    projectRevision: number | undefined
  ): Promise<void> {
    if (
      !(await refreshCatalogAfterLibraryMutation(
        domain,
        libraryId,
        projectRevision,
        created.id
      ))
    ) {
      return;
    }
    const createdDocument = documents.value.find(
      (document) =>
        document.domain === domain &&
        document.libraryId === libraryId &&
        document.catalogEntryId === created.id
    );
    if (!createdDocument) {
      uiMessage.warning(
        t(
          "catalogDocumentPersistence.libraryEntryCreatedButItsDirectoryLocationHasNot"
        )
      );
      return;
    }
    applyDocumentLocally(
      {
        id: createdDocument.id,
        title: created.title,
        content: created.body
      },
      projectRevision
    );
  }

  function restoreDraftAfterSaveFailure(
    document: WorkspaceDocument,
    payload: CatalogDocumentPayload
  ): void {
    const currentDraft = editorDrafts.value[payload.id];
    const normalizedCurrentDraft = currentDraft
      ? normalizeFixedWorkspaceDocumentDraft(document, currentDraft)
      : undefined;
    const newerDraft =
      normalizedCurrentDraft &&
      (normalizedCurrentDraft.title !== payload.title ||
        normalizedCurrentDraft.content !== payload.content)
        ? normalizedCurrentDraft
        : { title: payload.title, content: payload.content };
    editorDrafts.value = {
      ...editorDrafts.value,
      [payload.id]: {
        ...newerDraft,
        dirty: true,
        recoveryUpdatedAt: nextRecoveryTimestamp(),
        baseRevision:
          currentDraft?.baseRevision ??
          createShortWorkspaceContentRevision(document.content),
        ...(currentDraft?.baseProjectRevision !== undefined
          ? { baseProjectRevision: currentDraft.baseProjectRevision }
          : document.catalogProjectRevision === undefined
            ? {}
            : { baseProjectRevision: document.catalogProjectRevision })
      }
    };
  }

  function isCatalogConflict(error: unknown): boolean {
    return getErrorCode(error) === "catalog.conflict";
  }

  async function readLatestCatalogDocument(
    documentId: string
  ): Promise<WorkspaceDocument> {
    if (!api()) throw new Error(t("short.theDesktopFileServiceIsUnavailable"));
    if (!(await catalog.refreshIndex())) {
      throw new Error(
        t(
          "catalogDocumentPersistence.cannotRefreshTheDirectoryIndexTheCurrentDraftRemains"
        )
      );
    }
    const result = await loader.ensureOne(documentId, { refresh: true });
    const document = result.document;
    if (result.ok && document && document.catalogContentLoaded !== false) {
      return document;
    }
    const failure = result.failures[0];
    if (failure?.error instanceof Error) throw failure.error;
    if (failure?.code === "reader-unavailable") {
      throw new Error(t("short.theDesktopFileServiceIsUnavailable"));
    }
    if (failure?.code === "stale-descriptor") {
      throw new Error(
        t(
          "catalogDocumentPersistence.theDiskVersionChangedAgainWhileReadingPleaseTry"
        )
      );
    }
    if (failure?.code === "invalid-result") {
      throw new Error(
        t(
          "catalogDocumentPersistence.theDiskVersionReturnedInvalidContentTheCurrentDraft"
        )
      );
    }
    throw new Error(
      t(
        "catalogDocumentPersistence.theDiskVersionNoLongerExistsTheCurrentDraft"
      )
    );
  }

  async function openSaveConflict(
    document: WorkspaceDocument,
    payload: CatalogDocumentPayload
  ): Promise<void> {
    if (!api()) return;
    try {
      const diskDocument = await readLatestCatalogDocument(document.id);
      const diskTitle = diskDocument.title;
      const diskContent = diskDocument.content;
      if (diskTitle === payload.title && diskContent === payload.content) {
        const nextDrafts = { ...editorDrafts.value };
        const currentDraft = nextDrafts[payload.id];
        const hasNewerDraft = Boolean(
          currentDraft &&
          (currentDraft.title !== payload.title ||
            currentDraft.content !== payload.content)
        );
        if (currentDraft && hasNewerDraft) {
          nextDrafts[payload.id] = {
            ...currentDraft,
            dirty: true,
            recoveryUpdatedAt: nextRecoveryTimestamp(),
            baseRevision: createShortWorkspaceContentRevision(diskContent),
            ...(diskDocument.catalogProjectRevision === undefined
              ? {}
              : {
                  baseProjectRevision: diskDocument.catalogProjectRevision
                })
          };
        } else {
          delete nextDrafts[payload.id];
        }
        editorDrafts.value = nextDrafts;
        uiMessage.info(
          hasNewerDraft
            ? t(
                "catalogDocumentPersistence.earlierEditsAreAlreadyOnDiskYourNewerDraft"
              )
            : t(
                "catalogDocumentPersistence.theDiskVersionAlreadyContainsTheseChangesNoAdditional"
              )
        );
        // The failed save returns `false`, so the outer auto-save runner cannot
        // infer that a newer draft survived this conflict-equivalent outcome.
        // Explicitly restore liveness for B after the disk was found to contain A.
        if (hasNewerDraft) scheduleAutoSave(payload.id);
        return;
      }
      saveConflict.value = {
        documentId: payload.id,
        payload,
        diskTitle,
        diskContent
      };
    } catch (snapshotError: unknown) {
      uiMessage.error(
        formatError(
          snapshotError,
          t(
            "catalogDocumentPersistence.failedToReadTheConflictingDiskVersionTheCurrent"
          )
        )
      );
    }
  }

  async function saveCatalogDocument(
    document: WorkspaceDocument,
    payload: CatalogDocumentPayload,
    saveOptions: CatalogDocumentSaveOptions = {}
  ): Promise<boolean> {
    const currentApi = api();
    const force = saveOptions.force ?? false;
    if (
      !currentApi ||
      !document.workspaceId ||
      !document.catalogDocumentId ||
      savingDocumentIds.value.has(payload.id)
    ) {
      return false;
    }
    setDocumentSaving(payload.id, true);
    try {
      const projectRevision = force
        ? document.catalogProjectRevision
        : (editorDrafts.value[payload.id]?.baseProjectRevision ??
          document.catalogProjectRevision);
      const saved = await currentApi.saveDocument({
        bookId: document.workspaceId,
        documentId: document.catalogDocumentId,
        title: payload.title,
        content: payload.content,
        baseRevision:
          editorDrafts.value[payload.id]?.baseRevision ??
          createShortWorkspaceContentRevision(document.content),
        ...(projectRevision === undefined
          ? {}
          : { baseProjectRevision: projectRevision }),
        ...(force ? { force: true } : {})
      });
      const normalizedPayload = {
        id: payload.id,
        title: saved.title,
        content: saved.content
      };
      loader.preserveAuthoritativeBodyForNextProjection(
        payload.id,
        saved.content,
        saved.projectRevision
      );
      const savedProjectRevision = saved.projectRevision;
      applyDocumentLocally(normalizedPayload, savedProjectRevision, payload);
      if (saveOptions.announceSuccess !== false) {
        uiMessage.success(
          t("catalogDocumentPersistence.manuscriptSavedLocally")
        );
      }
      const expectedDocuments = captureWorkspaceDocumentBaselines(
        documents.value,
        document.workspaceId
      );
      const projectDocumentIds = new Set(
        documents.value.flatMap((candidate) =>
          candidate.workspaceId === document.workspaceId ? [candidate.id] : []
        )
      );
      const hasAnotherDirtyProjectDraft = Object.entries(
        editorDrafts.value
      ).some(
        ([documentId, draft]) =>
          draft.dirty && projectDocumentIds.has(documentId)
      );
      if (
        saveOptions.announceSuccess === false &&
        hasAnotherDirtyProjectDraft
      ) {
        queueBookReconciliation(
          document.workspaceId,
          expectedDocuments,
          savedProjectRevision
        );
      } else {
        await refreshBookAfterSuccessfulDocumentSave(
          document.workspaceId,
          expectedDocuments,
          savedProjectRevision
        );
      }
      return true;
    } catch (error: unknown) {
      restoreDraftAfterSaveFailure(document, payload);
      if (isCatalogConflict(error)) await openSaveConflict(document, payload);
      else {
        uiMessage.error(
          formatError(
            error,
            t("catalogDocumentPersistence.failedToSaveManuscript")
          )
        );
      }
      return false;
    } finally {
      setDocumentSaving(payload.id, false);
    }
  }

  async function saveCatalogLibraryEntry(
    document: WorkspaceDocument,
    payload: CatalogDocumentPayload,
    saveOptions: CatalogDocumentSaveOptions = {}
  ): Promise<boolean> {
    const currentApi = api();
    const force = saveOptions.force ?? false;
    if (
      !currentApi ||
      !document.libraryId ||
      !document.catalogEntryId ||
      (document.domain !== "material" && document.domain !== "skill") ||
      savingDocumentIds.value.has(payload.id)
    ) {
      return false;
    }
    setDocumentSaving(payload.id, true);
    try {
      const projectRevision = force
        ? document.catalogProjectRevision
        : (editorDrafts.value[payload.id]?.baseProjectRevision ??
          document.catalogProjectRevision);
      const saved = await currentApi.saveLibraryEntry({
        domain: document.domain,
        libraryId: document.libraryId,
        entryId: document.catalogEntryId,
        title: payload.title,
        content: payload.content,
        baseRevision:
          editorDrafts.value[payload.id]?.baseRevision ??
          createShortWorkspaceContentRevision(document.content),
        ...(projectRevision === undefined
          ? {}
          : { baseProjectRevision: projectRevision }),
        ...(force ? { force: true } : {})
      });
      const savedProjectRevision =
        projectRevision === undefined ? undefined : projectRevision + 1;
      const synchronizedProjectRevision = await applySavedLibraryEntry(
        document.domain,
        document.libraryId,
        saved,
        savedProjectRevision
      );
      applyDocumentLocally(
        { id: payload.id, title: saved.title, content: saved.body },
        synchronizedProjectRevision,
        payload
      );
      if (saveOptions.announceSuccess !== false) {
        uiMessage.success(
          t("catalogDocumentPersistence.contentSavedToTheLocalFolder", {
            value:
              document.domain === "material"
                ? t("catalogWorkspace.material")
                : t("catalogWorkspace.skill")
          })
        );
      }
      return true;
    } catch (error: unknown) {
      restoreDraftAfterSaveFailure(document, payload);
      if (isCatalogConflict(error)) await openSaveConflict(document, payload);
      else {
        uiMessage.error(
          formatError(
            error,
            t("catalogDocumentPersistence.failedToSaveLibraryContent")
          )
        );
      }
      return false;
    } finally {
      setDocumentSaving(payload.id, false);
    }
  }

  async function saveCatalogLibraryOverview(
    document: WorkspaceDocument,
    payload: CatalogDocumentPayload,
    saveOptions: CatalogDocumentSaveOptions = {}
  ): Promise<boolean> {
    const currentApi = api();
    const force = saveOptions.force ?? false;
    if (
      !currentApi ||
      !document.libraryId ||
      document.catalogLibraryField !== "overview" ||
      (document.domain !== "material" && document.domain !== "skill") ||
      savingDocumentIds.value.has(payload.id)
    ) {
      return false;
    }
    setDocumentSaving(payload.id, true);
    try {
      const projectRevision = force
        ? document.catalogProjectRevision
        : (editorDrafts.value[payload.id]?.baseProjectRevision ??
          document.catalogProjectRevision);
      const updated = await currentApi.updateLibrary({
        domain: document.domain,
        libraryId: document.libraryId,
        overview: payload.content,
        ...(projectRevision === undefined
          ? {}
          : { baseProjectRevision: projectRevision }),
        ...(force ? { force: true } : {})
      });
      await applyUpdatedCatalogLibrary(document.domain, updated);
      applyDocumentLocally(
        {
          id: payload.id,
          title: document.title,
          content: updated.overview
        },
        updated.projectRevision,
        payload
      );
      if (saveOptions.announceSuccess !== false) {
        uiMessage.success(
          t(
            "catalogDocumentPersistence.libraryIntroductionSavedToTheLocalFolder"
          )
        );
      }
      return true;
    } catch (error: unknown) {
      restoreDraftAfterSaveFailure(document, payload);
      if (isCatalogConflict(error)) await openSaveConflict(document, payload);
      else {
        uiMessage.error(
          formatError(
            error,
            t("catalogDocumentPersistence.failedToSaveLibraryIntroduction")
          )
        );
      }
      return false;
    } finally {
      setDocumentSaving(payload.id, false);
    }
  }

  async function persistEditorDocumentWithOutcome(
    payload: CatalogDocumentPayload,
    announceSuccess: boolean
  ): Promise<CatalogDocumentPersistOutcome> {
    if (saveConflict.value) {
      if (announceSuccess) {
        uiMessage.info(
          t(
            "catalogDocumentPersistence.resolveTheCurrentSaveConflictBeforeSavingOtherDocuments"
          )
        );
      }
      return "paused";
    }
    const document = documents.value.find(
      (candidate) => candidate.id === payload.id
    );
    if (!document) return "paused";
    const normalizedPayload = {
      ...payload,
      title: resolveWorkspaceDocumentTitle(document, payload.title)
    };
    if (!normalizedPayload.title.trim()) {
      if (announceSuccess) {
        uiMessage.warning(
          t("catalogDocumentPersistence.enterADocumentTitleBeforeSaving")
        );
      }
      return "paused";
    }
    if (
      document.workspaceId &&
      acceptingWorkspaceIds.value.has(document.workspaceId)
    ) {
      if (announceSuccess) {
        uiMessage.info(
          t(
            "catalogDocumentPersistence.agentEditsForTheSameProjectAreBeingSaved"
          )
        );
      }
      return "retry";
    }
    if (document.catalogDocumentId && document.workspaceId) {
      const saved = await saveCatalogDocument(document, normalizedPayload, {
        announceSuccess
      });
      return saved ? "saved" : saveConflict.value ? "paused" : "retry";
    }
    if (
      document.catalogLibraryField === "overview" &&
      document.libraryId &&
      (document.domain === "material" || document.domain === "skill")
    ) {
      const saved = await saveCatalogLibraryOverview(
        document,
        normalizedPayload,
        { announceSuccess }
      );
      return saved ? "saved" : saveConflict.value ? "paused" : "retry";
    }
    if (
      document.catalogEntryId &&
      document.libraryId &&
      (document.domain === "material" || document.domain === "skill")
    ) {
      const saved = await saveCatalogLibraryEntry(document, normalizedPayload, {
        announceSuccess
      });
      return saved ? "saved" : saveConflict.value ? "paused" : "retry";
    }
    applyDocumentLocally(normalizedPayload);
    return "saved";
  }

  async function persistEditorDocument(
    payload: CatalogDocumentPayload,
    announceSuccess: boolean
  ): Promise<boolean> {
    return (
      (await persistEditorDocumentWithOutcome(payload, announceSuccess)) ===
      "saved"
    );
  }

  function keepSaveConflictDraft(): void {
    const conflictDocumentId = saveConflict.value?.documentId;
    saveConflict.value = null;
    scheduleDirtyAutoSaves(conflictDocumentId);
  }

  async function reloadSaveConflictFromDisk(): Promise<void> {
    const conflict = saveConflict.value;
    if (!conflict || saveConflictSubmitting.value) return;
    const draftAtReload = editorDrafts.value[conflict.documentId];
    saveConflictSubmitting.value = true;
    try {
      await readLatestCatalogDocument(conflict.documentId);
      if (saveConflict.value !== conflict) return;
      if (editorDrafts.value[conflict.documentId] !== draftAtReload) {
        saveConflict.value = null;
        uiMessage.info(
          t(
            "catalogDocumentPersistence.newEditsWereDetectedWhileReadingTheCurrentDraft"
          )
        );
        scheduleDirtyAutoSaves();
        return;
      }
      const nextDrafts = { ...editorDrafts.value };
      delete nextDrafts[conflict.documentId];
      editorDrafts.value = nextDrafts;
      saveConflict.value = null;
      uiMessage.success(t("catalogDocumentPersistence.diskVersionReloaded"));
      scheduleDirtyAutoSaves();
    } catch (error: unknown) {
      uiMessage.error(
        formatError(
          error,
          t("catalogDocumentPersistence.failedToReloadDiskVersion")
        )
      );
    } finally {
      saveConflictSubmitting.value = false;
    }
  }

  async function overwriteSaveConflictOnDisk(): Promise<void> {
    const conflict = saveConflict.value;
    if (!conflict || saveConflictSubmitting.value) return;
    saveConflictSubmitting.value = true;
    try {
      const document = await readLatestCatalogDocument(conflict.documentId);
      if (saveConflict.value !== conflict) return;
      const saved =
        document.catalogDocumentId && document.workspaceId
          ? await saveCatalogDocument(document, conflict.payload, {
              force: true
            })
          : document.catalogLibraryField === "overview" &&
              document.libraryId &&
              (document.domain === "material" || document.domain === "skill")
            ? await saveCatalogLibraryOverview(document, conflict.payload, {
                force: true
              })
            : document.catalogEntryId &&
                document.libraryId &&
                (document.domain === "material" || document.domain === "skill")
              ? await saveCatalogLibraryEntry(document, conflict.payload, {
                  force: true
                })
              : false;
      if (saved) {
        saveConflict.value = null;
        scheduleDirtyAutoSaves();
      }
    } catch (error: unknown) {
      uiMessage.error(
        formatError(
          error,
          t("catalogDocumentPersistence.failedToOverwriteDiskVersion")
        )
      );
    } finally {
      saveConflictSubmitting.value = false;
    }
  }

  const documentVersions: CatalogDocumentVersionPort = {
    async prepare(payload) {
      await drain();
      const document = documents.value.find(({ id }) => id === payload.id);
      if (!document) return false;
      if (
        document.content === payload.content &&
        document.title === payload.title &&
        !editorDrafts.value[payload.id]?.dirty
      )
        return true;
      return trackOperation(() => persistEditorDocument(payload, false), false);
    },
    async apply(id, result) {
      const payload = { id, title: result.title, content: result.content };
      const document = documents.value.find((candidate) => candidate.id === id);
      if (!document?.workspaceId) return;
      applyAcceptedAgentDocumentLocally(
        payload,
        result.projectRevision,
        editorDrafts.value[id]
      );
      await refreshBookAfterSuccessfulDocumentSave(
        document.workspaceId,
        captureWorkspaceDocumentBaselines(
          documents.value,
          document.workspaceId
        ),
        result.projectRevision
      );
    }
  };
  if (getCurrentInstance())
    provide(CATALOG_DOCUMENT_VERSION_PORT, documentVersions);

  return {
    documentVersions,
    savingDocumentIds,
    saveConflict,
    saveConflictSubmitting,
    applyDocumentLocally,
    applyAcceptedAgentDocumentLocally,
    refreshBookAfterSuccessfulDocumentSave: (
      workspaceId: string,
      expectedDocuments: ReadonlyMap<string, WorkspaceDocumentBaseline>,
      minimumProjectRevision?: number
    ) =>
      trackOperation(
        () =>
          refreshBookAfterSuccessfulDocumentSave(
            workspaceId,
            expectedDocuments,
            minimumProjectRevision
          ),
        false
      ),
    retryPendingBookReconciliations: (
      retryOptions?: RetryCatalogBookReconciliationOptions
    ) =>
      trackOperation(
        () => retryPendingBookReconciliations(retryOptions),
        false
      ),
    applySavedLibraryEntry: (
      domain: "material" | "skill",
      libraryId: string,
      saved: CatalogLibraryEntry,
      projectRevision: number | undefined
    ) =>
      trackOperation(
        () => applySavedLibraryEntry(domain, libraryId, saved, projectRevision),
        undefined
      ),
    applyUpdatedCatalogLibrary: (
      domain: "material" | "skill",
      updated: CatalogLibrary
    ) =>
      trackOperation(
        () => applyUpdatedCatalogLibrary(domain, updated),
        undefined
      ),
    applyCreatedLibraryEntry: (
      domain: "material" | "skill",
      libraryId: string,
      created: CatalogLibraryEntry,
      projectRevision: number | undefined
    ) =>
      trackOperation(
        () =>
          applyCreatedLibraryEntry(domain, libraryId, created, projectRevision),
        undefined
      ),
    isCatalogConflict,
    persistEditorDocument: (
      payload: CatalogDocumentPayload,
      announceSuccess: boolean
    ) =>
      trackOperation(
        () => persistEditorDocument(payload, announceSuccess),
        false
      ),
    persistEditorDocumentWithOutcome: (
      payload: CatalogDocumentPayload,
      announceSuccess: boolean
    ) =>
      trackOperation(
        () => persistEditorDocumentWithOutcome(payload, announceSuccess),
        "paused" as const
      ),
    keepSaveConflictDraft,
    reloadSaveConflictFromDisk: () =>
      trackOperation(reloadSaveConflictFromDisk, undefined),
    overwriteSaveConflictOnDisk: () =>
      trackOperation(overwriteSaveConflictOnDisk, undefined),
    drain,
    dispose
  };
}
