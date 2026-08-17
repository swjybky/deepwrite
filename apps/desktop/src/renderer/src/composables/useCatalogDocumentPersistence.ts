import {
  CATALOG_LIBRARY_ENTRY_MAX_CHARACTERS,
  CATALOG_LIBRARY_OVERVIEW_MAX_CHARACTERS,
  createShortWorkspaceContentRevision,
  type Book,
  type CatalogLibrary,
  type CatalogLibraryEntry,
  type DeepWriteApi
} from "@deepwrite/contracts";
import { ref, type Ref, type ShallowRef } from "vue";
import type {
  CatalogDocumentLoadResult,
  CatalogDocumentTarget,
  CatalogDocumentsLoadResult,
  EnsureCatalogDocumentsOptions,
  InvalidateCatalogDocumentOptions
} from "./useCatalogDocumentLoader";
import type {
  EditorDraftState,
  WorkspaceDocument
} from "../types/workspace";
import {
  captureWorkspaceDocumentBaselines,
  rebaseDraftsForMatchingDocuments,
  type WorkspaceDocumentBaseline
} from "../utils/catalogSaveReconciliation";
import { draftCharacterStateTitle } from "../utils/draftFileTitles";

export interface CatalogDocumentPersistenceNotifications {
  error(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
}

export interface CatalogDocumentPersistenceLoaderPort {
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
          : { ...document, catalogProjectRevision: savedProjectRevision };
      if (document.id === payload.id) {
        if (current.catalogLibraryField === "overview") {
          return {
            ...withProjectRevision,
            content: payload.content,
            catalogContentLoaded: true
          };
        }
        const path = [...withProjectRevision.path];
        if (document.draftFileKind === "body" && path.length >= 2) {
          path[path.length - 2] = payload.title;
        } else if (path.length) {
          path[path.length - 1] = payload.title;
        }
        return {
          ...withProjectRevision,
          title: payload.title,
          content: payload.content,
          catalogContentLoaded: true,
          path
        };
      }
      if (
        current.draftFileKind === "body" &&
        document.draftFileKind === "character-state" &&
        document.expertSectionId === current.expertSectionId
      ) {
        const path = [...withProjectRevision.path];
        if (path.length >= 2) path[path.length - 2] = payload.title;
        return {
          ...withProjectRevision,
          title: draftCharacterStateTitle(payload.title),
          path
        };
      }
      return withProjectRevision;
    });

    const currentDraft = editorDrafts.value[payload.id];
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
      currentDraft &&
      (currentDraft.title !== submittedPayload.title ||
        currentDraft.content !== submittedPayload.content)
    ) {
      nextDrafts[payload.id] = {
        ...currentDraft,
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
        throw new Error("保存后未能读取最新目录快照。");
      }
      const latestBook = catalog.findBook(workspaceId);
      if (!latestBook) {
        throw new Error("保存后的书籍没有出现在最新目录快照中。");
      }
      const latestRevision = latestBook.projectRevision;
      if (
        minimumProjectRevision !== undefined &&
        (latestRevision === undefined ||
          latestRevision < minimumProjectRevision)
      ) {
        throw new Error("保存后的目录尚未达到本次写入版本。");
      }
      if (
        latestRevision !== undefined &&
        currentRevision !== undefined &&
        latestRevision < currentRevision
      ) {
        throw new Error("保存后读取到的目录版本发生回退。");
      }

      const scopedDocuments = documents.value.filter(
        (document) =>
          document.workspaceId === workspaceId &&
          documentIdsToHydrate.has(document.id)
      );
      const loaded = await loader.ensureLoaded(scopedDocuments);
      if (!loaded.ok) {
        throw new Error("保存后未能读取最新文稿内容。");
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
          "文稿已保存，但最新目录版本暂未同步；下次聚焦窗口时会自动重试"
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
      "资料库修改已写入磁盘，但最新目录暂未同步；窗口重新聚焦后会自动重试"
    );
    return false;
  }

  async function applySavedLibraryEntry(
    domain: "material" | "skill",
    libraryId: string,
    saved: CatalogLibraryEntry,
    projectRevision: number | undefined
  ): Promise<number | undefined> {
    const synchronized = await refreshCatalogAfterLibraryMutation(
      domain,
      libraryId,
      projectRevision,
      saved.id
    );
    const currentProjectRevision =
      catalog.findLibrary(domain, libraryId)?.projectRevision;
    if (synchronized) return currentProjectRevision;
    if (currentProjectRevision === undefined) return projectRevision;
    if (projectRevision === undefined) return currentProjectRevision;
    return Math.max(currentProjectRevision, projectRevision);
  }

  async function applyUpdatedCatalogLibrary(
    domain: "material" | "skill",
    updated: CatalogLibrary
  ): Promise<void> {
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
        "资料条目已创建，但目录定位暂未同步；窗口重新聚焦后会自动重试"
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
    const newerDraft =
      currentDraft &&
      (currentDraft.title !== payload.title ||
        currentDraft.content !== payload.content)
        ? currentDraft
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
    return (
      error instanceof Error && error.message.startsWith("catalog.conflict:")
    );
  }

  async function readLatestCatalogDocument(
    documentId: string
  ): Promise<WorkspaceDocument> {
    if (!api()) throw new Error("桌面文件服务当前不可用。");
    if (!(await catalog.refreshIndex())) {
      throw new Error("无法刷新目录索引，当前草稿仍保留在恢复区");
    }
    const result = await loader.ensureOne(documentId, { refresh: true });
    const document = result.document;
    if (result.ok && document && document.catalogContentLoaded !== false) {
      return document;
    }
    const failure = result.failures[0];
    if (failure?.error instanceof Error) throw failure.error;
    if (failure?.code === "reader-unavailable") {
      throw new Error("桌面文件服务当前不可用。");
    }
    if (failure?.code === "stale-descriptor") {
      throw new Error("磁盘版本在读取期间再次变化，请重试。");
    }
    if (failure?.code === "invalid-result") {
      throw new Error("磁盘版本返回了无效内容，当前草稿仍保留在恢复区");
    }
    throw new Error("磁盘版本已不存在，当前草稿仍保留在恢复区");
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
            ? "磁盘已包含较早修改；你随后输入的新草稿仍保留"
            : "磁盘版本已经包含当前修改，无需重复保存"
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
        snapshotError instanceof Error
          ? snapshotError.message
          : "读取磁盘冲突版本失败，当前草稿仍保留"
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
    if (!payload.title.trim()) {
      if (saveOptions.announceSuccess !== false) {
        uiMessage.warning("请输入文档标题后再保存");
      }
      return false;
    }
    setDocumentSaving(payload.id, true);
    try {
      const projectRevision = force
        ? document.catalogProjectRevision
        : editorDrafts.value[payload.id]?.baseProjectRevision ??
          document.catalogProjectRevision;
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
      const savedProjectRevision = saved.projectRevision;
      applyDocumentLocally(normalizedPayload, savedProjectRevision, payload);
      if (saveOptions.announceSuccess !== false) {
        uiMessage.success("文稿已保存到本机");
      }
      const expectedDocuments = captureWorkspaceDocumentBaselines(
        documents.value,
        document.workspaceId
      );
      const projectDocumentIds = new Set(
        documents.value.flatMap((candidate) =>
          candidate.workspaceId === document.workspaceId
            ? [candidate.id]
            : []
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
        uiMessage.error(error instanceof Error ? error.message : "保存文稿失败。");
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
    if (payload.content.length > CATALOG_LIBRARY_ENTRY_MAX_CHARACTERS) {
      uiMessage.warning(
        "每个素材库或技能库条目最多 40,000 字，请精简内容后再保存"
      );
      return false;
    }
    if (
      !currentApi ||
      !document.libraryId ||
      !document.catalogEntryId ||
      (document.domain !== "material" && document.domain !== "skill") ||
      savingDocumentIds.value.has(payload.id)
    ) {
      return false;
    }
    if (!payload.title.trim()) {
      if (saveOptions.announceSuccess !== false) {
        uiMessage.warning("请输入条目标题后再保存");
      }
      return false;
    }
    setDocumentSaving(payload.id, true);
    try {
      const projectRevision = force
        ? document.catalogProjectRevision
        : editorDrafts.value[payload.id]?.baseProjectRevision ??
          document.catalogProjectRevision;
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
          `${document.domain === "material" ? "素材" : "技能"}内容已保存到本机文件夹`
        );
      }
      return true;
    } catch (error: unknown) {
      restoreDraftAfterSaveFailure(document, payload);
      if (isCatalogConflict(error)) await openSaveConflict(document, payload);
      else {
        uiMessage.error(
          error instanceof Error ? error.message : "保存资料库内容失败。"
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
    if (payload.content.length > CATALOG_LIBRARY_OVERVIEW_MAX_CHARACTERS) {
      uiMessage.warning(
        "素材库或技能库介绍最多 40,000 字，请精简内容后再保存"
      );
      return false;
    }
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
        : editorDrafts.value[payload.id]?.baseProjectRevision ??
          document.catalogProjectRevision;
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
        uiMessage.success("资料库介绍已保存到本机文件夹");
      }
      return true;
    } catch (error: unknown) {
      restoreDraftAfterSaveFailure(document, payload);
      if (isCatalogConflict(error)) await openSaveConflict(document, payload);
      else {
        uiMessage.error(
          error instanceof Error ? error.message : "保存资料库介绍失败。"
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
        uiMessage.info("请先处理当前保存冲突，再保存其他文稿");
      }
      return "paused";
    }
    const document = documents.value.find(
      (candidate) => candidate.id === payload.id
    );
    if (!document) return "paused";
    if (
      document.workspaceId &&
      acceptingWorkspaceIds.value.has(document.workspaceId)
    ) {
      if (announceSuccess) {
        uiMessage.info("正在保存同一作品的智能体修改，请稍候");
      }
      return "retry";
    }
    if (document.catalogDocumentId && document.workspaceId) {
      const saved = await saveCatalogDocument(document, payload, {
        announceSuccess
      });
      return saved ? "saved" : saveConflict.value ? "paused" : "retry";
    }
    if (
      document.catalogLibraryField === "overview" &&
      document.libraryId &&
      (document.domain === "material" || document.domain === "skill")
    ) {
      const invalid =
        payload.content.length > CATALOG_LIBRARY_OVERVIEW_MAX_CHARACTERS;
      const saved = await saveCatalogLibraryOverview(document, payload, {
        announceSuccess
      });
      return saved
        ? "saved"
        : saveConflict.value || invalid
          ? "paused"
          : "retry";
    }
    if (
      document.catalogEntryId &&
      document.libraryId &&
      (document.domain === "material" || document.domain === "skill")
    ) {
      const invalid =
        payload.content.length > CATALOG_LIBRARY_ENTRY_MAX_CHARACTERS;
      const saved = await saveCatalogLibraryEntry(document, payload, {
        announceSuccess
      });
      return saved
        ? "saved"
        : saveConflict.value || invalid
          ? "paused"
          : "retry";
    }
    applyDocumentLocally(payload);
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
        uiMessage.info("读取期间检测到新的编辑，已保留当前草稿");
        scheduleDirtyAutoSaves();
        return;
      }
      const nextDrafts = { ...editorDrafts.value };
      delete nextDrafts[conflict.documentId];
      editorDrafts.value = nextDrafts;
      saveConflict.value = null;
      uiMessage.success("已重新加载磁盘版本");
      scheduleDirtyAutoSaves();
    } catch (error: unknown) {
      uiMessage.error(
        error instanceof Error ? error.message : "重新加载磁盘版本失败"
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
              (document.domain === "material" ||
                document.domain === "skill")
            ? await saveCatalogLibraryOverview(document, conflict.payload, {
                force: true
              })
            : document.catalogEntryId &&
                document.libraryId &&
                (document.domain === "material" ||
                  document.domain === "skill")
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
        error instanceof Error ? error.message : "覆盖磁盘版本失败"
      );
    } finally {
      saveConflictSubmitting.value = false;
    }
  }

  return {
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
        () =>
          applySavedLibraryEntry(
            domain,
            libraryId,
            saved,
            projectRevision
          ),
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
          applyCreatedLibraryEntry(
            domain,
            libraryId,
            created,
            projectRevision
          ),
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
