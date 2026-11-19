import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import type {
  Book,
  CatalogIndexSnapshot,
  CatalogSnapshot,
  DeepWriteApi
} from "@deepwrite/contracts";
import { ref, shallowRef, type Ref, type ShallowRef } from "vue";
import {
  resolveBookWorkspaceId,
  resolvePreferredBookResourceId,
  resolveProjectedResourceTargetDocumentId,
  type CatalogWorkspaceProjection
} from "../data/catalogWorkspace";
import type { AgentConversationController } from "./useAgentConversation";
import type { CatalogProjectionReconcileResult } from "./useCatalogDocumentLoader";
import { longBookIdFromResourceId } from "../types/longWorkspace";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";
import { reconcileCatalogRecoveryDrafts } from "../utils/catalogDraftRecoveryReconciliation";
import { catalogCharacterSelectionFallback } from "../utils/catalogCharacterSelectionFallback";
import { hasDirtyLegacyDraftRecoveries } from "../utils/legacyDraftRecoveryDetection";
import type { LegacyDraftRecoveryMigrationResult } from "../utils/legacyDraftRecovery";

const t = createScopedTranslator(
  "workspace.catalogWorkspaceProjectionCoordinator"
);

type CatalogProjectionApi = Pick<DeepWriteApi["catalog"], "index" | "snapshot">;

export interface CatalogWorkspaceProjectionIndexPort {
  snapshot: Readonly<ShallowRef<CatalogIndexSnapshot | null>>;
  projection: Readonly<ShallowRef<CatalogWorkspaceProjection | null>>;
  ensureSnapshot(
    loader: () => Promise<CatalogIndexSnapshot>
  ): Promise<CatalogWorkspaceProjection>;
}

export interface CatalogWorkspaceProjectionDocumentPort {
  values: ShallowRef<WorkspaceDocument[]>;
  reconcileProjection(
    projection: CatalogWorkspaceProjection
  ): CatalogProjectionReconcileResult;
}

export interface CatalogWorkspaceProjectionNotifications {
  error(message: string): void;
  info(message: string, options?: { duration?: number }): void;
  warning(message: string): void;
}

export interface CatalogWorkspaceProjectionScheduler {
  queueMicrotask(task: () => void): void;
}

export interface CatalogLegacyRecoveryMigratorModule {
  migrateLegacyDraftRecoveries(
    drafts: Readonly<Record<string, EditorDraftState>>,
    snapshot: CatalogSnapshot,
    projection: CatalogWorkspaceProjection
  ): LegacyDraftRecoveryMigrationResult;
}

export interface CatalogWorkspaceProjectionCoordinatorOptions {
  api(): CatalogProjectionApi | undefined;
  index: CatalogWorkspaceProjectionIndexPort;
  documents: CatalogWorkspaceProjectionDocumentPort;
  state: {
    drafts: ShallowRef<Record<string, EditorDraftState>>;
    selectedResourceId: Ref<string>;
    activeCreationResourceId: Ref<string>;
  };
  proposals: {
    all(): readonly AgentConversationController[];
    resume(candidates: readonly AgentConversationController[]): void;
  };
  scheduler: CatalogWorkspaceProjectionScheduler;
  notifications: CatalogWorkspaceProjectionNotifications;
  loadLegacyRecoveryMigrator?(): Promise<CatalogLegacyRecoveryMigratorModule>;
}

interface CatalogSnapshotPair {
  snapshot: CatalogIndexSnapshot;
  projection: CatalogWorkspaceProjection;
}

function diagnosticKey(
  diagnostic: NonNullable<CatalogIndexSnapshot["projectDiagnostics"]>[number]
): string {
  return [diagnostic.projectId, diagnostic.code, diagnostic.message].join(
    "\u0000"
  );
}

function migrationFallback(
  drafts: Readonly<Record<string, EditorDraftState>>
): LegacyDraftRecoveryMigrationResult {
  return {
    drafts: { ...drafts },
    migratedLegacyKeys: [],
    unmappedLegacyKeys: []
  };
}

/**
 * Owns the metadata-index to editor-overlay transaction. Catalog document
 * persistence and library mutations intentionally remain outside this seam.
 */
export function useCatalogWorkspaceProjectionCoordinator(
  options: CatalogWorkspaceProjectionCoordinatorOptions
) {
  const reconciledSnapshot = shallowRef<CatalogIndexSnapshot | null>(null);
  const reconciledProjection = shallowRef<CatalogWorkspaceProjection | null>(
    null
  );
  const reconciliationVersion = ref(0);

  const seenDiagnosticKeys = new Set<string>();
  const warnedUnmappedLegacyRecoveryKeys = new Set<string>();
  const warnedLegacyRecoveryFailureKeys = new Set<string>();

  let recoveredDraftCount = 0;
  let lifecycleGeneration = 0;
  let proposalResumeGeneration = 0;
  let disposed = false;
  let activeLoad: Promise<boolean> | null = null;
  let trailingRefreshRequested = false;
  let runningTrailingRefresh = false;

  const loadLegacyRecoveryMigrator =
    options.loadLegacyRecoveryMigrator ??
    (() => import("../utils/legacyDraftRecovery"));

  function pairIsCurrent(
    pair: CatalogSnapshotPair,
    requestLifecycleGeneration: number
  ): boolean {
    return (
      !disposed &&
      requestLifecycleGeneration === lifecycleGeneration &&
      options.index.snapshot.value === pair.snapshot &&
      options.index.projection.value === pair.projection
    );
  }

  function currentPairIsReconciled(): boolean {
    return (
      !disposed &&
      reconciledSnapshot.value !== null &&
      reconciledSnapshot.value === options.index.snapshot.value &&
      reconciledProjection.value === options.index.projection.value
    );
  }

  function requestTrailingRefresh(): void {
    if (!disposed && activeLoad && !runningTrailingRefresh) {
      trailingRefreshRequested = true;
    }
  }

  function findBook(bookId: string): Book | undefined {
    return options.index.snapshot.value?.books.find(
      (book) => book.id === bookId
    );
  }

  function reportLegacyRecoveryFailure(
    snapshot: CatalogIndexSnapshot,
    message: string
  ): void {
    const key = `${snapshot.revision}\u0000${message}`;
    if (warnedLegacyRecoveryFailureKeys.has(key)) return;
    warnedLegacyRecoveryFailureKeys.add(key);
    options.notifications.warning(message);
  }

  function publishDiagnostics(snapshot: CatalogIndexSnapshot): void {
    const diagnostics = snapshot.projectDiagnostics ?? [];
    const currentKeys = new Set(diagnostics.map(diagnosticKey));
    for (const key of seenDiagnosticKeys) {
      if (!currentKeys.has(key)) seenDiagnosticKeys.delete(key);
    }
    const unseen = diagnostics.filter((diagnostic) => {
      const key = diagnosticKey(diagnostic);
      if (seenDiagnosticKeys.has(key)) return false;
      seenDiagnosticKeys.add(key);
      return true;
    });
    const first = unseen[0];
    if (!first) return;
    options.notifications.warning(
      t("projectCannotCurrentlyBeRead", {
        projectId: first.projectId,
        message: first.message,
        value:
          unseen.length > 1
            ? t("additionalProjects", { value: unseen.length - 1 })
            : ""
      })
    );
  }

  function publishUnmappedLegacyRecoveryWarnings(
    migration: LegacyDraftRecoveryMigrationResult
  ): void {
    const currentKeys = new Set(migration.unmappedLegacyKeys);
    for (const key of warnedUnmappedLegacyRecoveryKeys) {
      if (!currentKeys.has(key)) warnedUnmappedLegacyRecoveryKeys.delete(key);
    }
    const newlyUnmapped = migration.unmappedLegacyKeys.filter(
      (key) => !warnedUnmappedLegacyRecoveryKeys.has(key)
    );
    if (newlyUnmapped.length === 0) return;
    newlyUnmapped.forEach((key) => warnedUnmappedLegacyRecoveryKeys.add(key));
    options.notifications.warning(
      t("theLegacyRecoveryDraftDoesNotMatchTheCurrent", {
        value:
          newlyUnmapped.length > 1
            ? t("inTotal", { length: newlyUnmapped.length })
            : ""
      })
    );
  }

  function selectionExists(
    projection: CatalogWorkspaceProjection,
    resourceId: string
  ): boolean {
    if (
      !resourceId ||
      longBookIdFromResourceId(resourceId) ||
      resourceId.startsWith("mystery-book:") ||
      resourceId.startsWith("mystery-document:")
    )
      return true;
    return projection.index.workspaceDocumentById.has(
      resolveProjectedResourceTargetDocumentId(projection, resourceId)
    );
  }

  function fallbackResourceId(
    projection: CatalogWorkspaceProjection,
    workspaceAnchor: string | undefined,
    documents: readonly WorkspaceDocument[]
  ): string {
    return (
      (workspaceAnchor
        ? resolvePreferredBookResourceId(projection, workspaceAnchor)
        : undefined) ??
      projection.draftDirectories[0]?.id ??
      documents.find((document) => document.domain === "creation")?.id ??
      documents[0]?.id ??
      ""
    );
  }

  function scheduleProposalResume(pair: CatalogSnapshotPair): void {
    const generation = ++proposalResumeGeneration;
    options.scheduler.queueMicrotask(() => {
      if (
        generation !== proposalResumeGeneration ||
        !pairIsCurrent(pair, lifecycleGeneration) ||
        reconciledSnapshot.value !== pair.snapshot ||
        reconciledProjection.value !== pair.projection
      ) {
        return;
      }
      resumeRecoveredAutomaticEditsIfNeeded();
    });
  }

  function applySnapshotPair(
    pair: CatalogSnapshotPair,
    migration: LegacyDraftRecoveryMigrationResult
  ): void {
    const previousProjection = reconciledProjection.value ?? undefined;
    const selectedBeforeCommit = options.state.selectedResourceId.value;
    const activeBeforeCommit = options.state.activeCreationResourceId.value;
    const selectedWorkspaceAnchor = resolveBookWorkspaceId(
      previousProjection,
      selectedBeforeCommit
    );
    const activeWorkspaceAnchor = resolveBookWorkspaceId(
      previousProjection,
      activeBeforeCommit
    );
    const projectedDocuments = pair.projection.index.workspaceDocumentById;
    const nextDrafts = reconcileCatalogRecoveryDrafts(
      migration.drafts,
      projectedDocuments
    );

    const reconciliation = options.documents.reconcileProjection(
      pair.projection
    );
    options.state.drafts.value = nextDrafts;

    let selectedAfterCommit = selectedBeforeCommit;
    if (
      selectedBeforeCommit &&
      !selectionExists(pair.projection, selectedBeforeCommit)
    ) {
      selectedAfterCommit =
        catalogCharacterSelectionFallback(
          previousProjection,
          pair.projection,
          selectedBeforeCommit
        ) ??
        fallbackResourceId(
          pair.projection,
          selectedWorkspaceAnchor,
          reconciliation.documents
        );
      options.state.selectedResourceId.value = selectedAfterCommit;
    }

    if (
      activeBeforeCommit &&
      !selectionExists(pair.projection, activeBeforeCommit)
    ) {
      const selectedTargetId = resolveProjectedResourceTargetDocumentId(
        pair.projection,
        selectedAfterCommit
      );
      options.state.activeCreationResourceId.value =
        catalogCharacterSelectionFallback(
          previousProjection,
          pair.projection,
          activeBeforeCommit
        ) ??
        (activeWorkspaceAnchor
          ? resolvePreferredBookResourceId(
              pair.projection,
              activeWorkspaceAnchor
            )
          : undefined) ??
        (projectedDocuments.get(selectedTargetId)?.domain === "creation"
          ? selectedAfterCommit
          : undefined) ??
        fallbackResourceId(
          pair.projection,
          undefined,
          reconciliation.documents
        );
    }

    recoveredDraftCount = Object.keys(nextDrafts).filter((documentId) =>
      projectedDocuments.has(documentId)
    ).length;
    reconciledSnapshot.value = pair.snapshot;
    reconciledProjection.value = pair.projection;
    reconciliationVersion.value += 1;
    publishDiagnostics(pair.snapshot);
    publishUnmappedLegacyRecoveryWarnings(migration);
    scheduleProposalResume(pair);
  }

  async function loadSnapshotOnce(
    requestLifecycleGeneration: number
  ): Promise<boolean> {
    const api = options.api();
    if (!api || disposed) return false;

    try {
      const projection = await options.index.ensureSnapshot(() => api.index());
      if (disposed || requestLifecycleGeneration !== lifecycleGeneration) {
        return false;
      }
      const snapshot = options.index.snapshot.value;
      if (!snapshot) return false;
      const pair = { snapshot, projection };
      if (!pairIsCurrent(pair, requestLifecycleGeneration)) {
        return currentPairIsReconciled();
      }

      const hasLegacyRecovery = hasDirtyLegacyDraftRecoveries(
        options.state.drafts.value,
        snapshot
      );
      if (
        !hasLegacyRecovery &&
        reconciledSnapshot.value === snapshot &&
        reconciledProjection.value === projection
      ) {
        return true;
      }

      let migration = migrationFallback(options.state.drafts.value);
      if (hasLegacyRecovery) {
        try {
          const recoverySnapshot = await api.snapshot();
          if (!pairIsCurrent(pair, requestLifecycleGeneration)) {
            return currentPairIsReconciled();
          }
          if (recoverySnapshot.revision !== snapshot.revision) {
            requestTrailingRefresh();
            reportLegacyRecoveryFailure(
              snapshot,
              t("theDirectoryVersionChangedWhileMigratingLegacyRecoveryDrafts")
            );
          } else {
            const migrator = await loadLegacyRecoveryMigrator();
            if (!pairIsCurrent(pair, requestLifecycleGeneration)) {
              return currentPairIsReconciled();
            }
            migration = migrator.migrateLegacyDraftRecoveries(
              options.state.drafts.value,
              recoverySnapshot,
              projection
            );
            warnedLegacyRecoveryFailureKeys.clear();
          }
        } catch (error: unknown) {
          if (!pairIsCurrent(pair, requestLifecycleGeneration)) {
            return currentPairIsReconciled();
          }
          reportLegacyRecoveryFailure(
            snapshot,
            error instanceof Error
              ? t("legacyRecoveryDraftsCannotCurrentlyBeMigrated", {
                  message: error.message
                })
              : t("legacyRecoveryDraftsCannotCurrentlyBeMigratedTheOriginal")
          );
        }
      } else {
        warnedLegacyRecoveryFailureKeys.clear();
      }

      if (!pairIsCurrent(pair, requestLifecycleGeneration)) {
        return currentPairIsReconciled();
      }
      applySnapshotPair(pair, migration);
      return true;
    } catch (error: unknown) {
      if (disposed || requestLifecycleGeneration !== lifecycleGeneration) {
        return false;
      }
      options.notifications.error(
        formatError(error, t("failedToLoadMaterialAndSkillLibraries"))
      );
      return false;
    }
  }

  function loadSnapshot(): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    if (activeLoad) {
      if (!runningTrailingRefresh) trailingRefreshRequested = true;
      return activeLoad;
    }

    const requestLifecycleGeneration = lifecycleGeneration;
    const operation = (async () => {
      let result = await loadSnapshotOnce(requestLifecycleGeneration);
      if (
        !disposed &&
        requestLifecycleGeneration === lifecycleGeneration &&
        trailingRefreshRequested
      ) {
        trailingRefreshRequested = false;
        runningTrailingRefresh = true;
        result = await loadSnapshotOnce(requestLifecycleGeneration);
        runningTrailingRefresh = false;
      }
      return result;
    })().finally(() => {
      if (activeLoad === operation) activeLoad = null;
      trailingRefreshRequested = false;
      runningTrailingRefresh = false;
    });
    activeLoad = operation;
    return operation;
  }

  function resumeRecoveredAutomaticEditsIfNeeded(
    candidates: readonly AgentConversationController[] = options.proposals.all()
  ): void {
    if (
      !currentPairIsReconciled() ||
      !candidates.some((conversation) =>
        conversation.messages.value.some((message) =>
          message.editProposals?.some(
            (proposal) =>
              proposal.approvalMode === "auto-approve" &&
              proposal.status === "pending"
          )
        )
      )
    ) {
      return;
    }
    options.proposals.resume(candidates);
  }

  function recordRecoveredDraftCount(count: number): void {
    if (!disposed) recoveredDraftCount = Math.max(0, count);
  }

  function notifyRecoveredDrafts(): void {
    if (disposed || recoveredDraftCount <= 0) return;
    options.notifications.info(
      t("restoredUnsavedDrafts", { recoveredDraftCount: recoveredDraftCount }),
      {
        duration: 1_500
      }
    );
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    lifecycleGeneration += 1;
    proposalResumeGeneration += 1;
    trailingRefreshRequested = false;
    runningTrailingRefresh = false;
    seenDiagnosticKeys.clear();
    warnedUnmappedLegacyRecoveryKeys.clear();
    warnedLegacyRecoveryFailureKeys.clear();
  }

  return {
    findBook,
    loadSnapshot,
    notifyRecoveredDrafts,
    recordRecoveredDraftCount,
    reconciledProjection,
    reconciledSnapshot,
    reconciliationVersion,
    resumeRecoveredAutomaticEditsIfNeeded,
    dispose
  };
}

export type CatalogWorkspaceProjectionCoordinator = ReturnType<
  typeof useCatalogWorkspaceProjectionCoordinator
>;
