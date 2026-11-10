import { getErrorCode } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import { ref, type Ref } from "vue";
import {
  LongMutationProposalEventEnvelopeSchema,
  LongWorkspaceOperationBatchSchema,
  createEnvelope,
  type AgentWriteApprovalMode,
  type LongAgentId,
  type LongContinuityFileChange,
  type LongContinuityFileRole,
  type LongWorkspaceImpactPreview,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceOperationBatch,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import { longWorkspaceOperationsRequireImpactConfirmation } from "@deepwrite/contracts/renderer";
import { createId } from "@deepwrite/shared";
import type { LongWorkspaceRendererApi } from "../types/longWorkspace";
import { createKeyedSerialTaskQueue } from "../utils/keyedSerialTaskQueue";
import { longWorldbuildingFiles } from "../utils/longWorldbuildingFiles";
import {
  longProposalErrorMessage as errorMessage,
  withLongProposalBlockers
} from "./proposal-coordinator/long-proposal-feedback";
import {
  commitLongContinuityFinalization,
  continuityFinalizationKey,
  type LongContinuityFinalizationEvent
} from "./longContinuityFinalization";

const t = createScopedTranslator("workspace");

export type LongWorkspaceProposalEvent = Extract<
  SystemEventEnvelope,
  {
    type:
      | "long.mutation_proposal"
      | "long.worldbuilding_file_proposal"
      | "long.character_file_proposal"
      | "long.continuity_file_proposal"
      | "long.ledger_commit_proposal";
  }
>;

export type LongMutationProposalEvent = Extract<
  LongWorkspaceProposalEvent,
  { type: "long.mutation_proposal" }
>;

export type LongWorldbuildingFileProposalEvent = Extract<
  LongWorkspaceProposalEvent,
  { type: "long.worldbuilding_file_proposal" }
>;

export type LongCharacterFileProposalEvent = Extract<
  LongWorkspaceProposalEvent,
  { type: "long.character_file_proposal" }
>;

export type LongContinuityFileProposalEvent = Extract<
  LongWorkspaceProposalEvent,
  { type: "long.continuity_file_proposal" }
>;

type LongWorkspaceReviewEvent = LongWorkspaceProposalEvent;

type LongContentFileProposalEvent =
  | LongWorldbuildingFileProposalEvent
  | LongCharacterFileProposalEvent
  | LongContinuityFileProposalEvent;

type LongBatchProposalEvent =
  LongMutationProposalEvent | LongContentFileProposalEvent;

function isContentFileProposal(
  event: LongWorkspaceProposalEvent
): event is LongContentFileProposalEvent {
  return (
    event.type === "long.worldbuilding_file_proposal" ||
    event.type === "long.character_file_proposal" ||
    event.type === "long.continuity_file_proposal"
  );
}

function isBatchProposal(
  event: LongWorkspaceProposalEvent
): event is LongBatchProposalEvent {
  return (
    event.type === "long.mutation_proposal" || isContentFileProposal(event)
  );
}

/** Re-previews allowed when the impact changes under an automatic save. */
const AUTOMATIC_IMPACT_RETRIES = 2;

function isLongImpactMismatch(error: unknown): boolean {
  return getErrorCode(error) === "long.operation.impact_mismatch";
}

function continuityFileRoleLabels(): Record<LongContinuityFileRole, string> {
  return {
    foreshadowing_changes: t("longWorkspaceProposals.foreshadowingChanges"),
    world_reveals: t("longWorkspaceResourceTree.worldRevelations"),
    character_current_state: t("longWorkspaceProposals.currentCharacterState"),
    character_history: t("longWorkspaceProposals.characterHistory"),
    chapter_end_state: t("longWorkspaceProposals.chapterEndingState"),
    handoff: t("longWorkspaceProposals.continuationPack")
  };
}

interface LongContinuityFileTarget {
  chapterCardId: string;
  role: LongContinuityFileRole;
  characterId: string | null;
  file: LongWorkspaceFileReference;
}

function continuityFileTitle(
  index: LongWorkspaceIndexSnapshot,
  target: LongContinuityFileTarget
): string {
  const chapter = index.plot.chapterCards.find(
    ({ id }) => id === target.chapterCardId
  );
  if (!chapter) {
    throw new Error(
      t("longWorkspaceProposals.theContinuityProposalRefersToAChapterCardThat")
    );
  }
  const isCharacterRole =
    target.role === "character_current_state" ||
    target.role === "character_history";
  if (isCharacterRole !== (target.characterId !== null)) {
    throw new Error(
      t(
        "longWorkspaceProposals.theContinuityProposalHasAnIncompleteCharacterFileIdentity"
      )
    );
  }
  let characterName: string | null = null;
  if (target.characterId !== null) {
    const character = index.characters.find(
      ({ id }) => id === target.characterId
    );
    if (!character) {
      throw new Error(
        t(
          "longWorkspaceProposals.theContinuityProposalRefersToACharacterThatDoes"
        )
      );
    }
    characterName = character.name;
  }
  return `${chapter.title} / ${
    characterName ? `${characterName} / ` : ""
  }${continuityFileRoleLabels()[target.role]}`;
}

function continuityFileTargets(
  index: LongWorkspaceIndexSnapshot
): Map<string, LongContinuityFileTarget> {
  const targets = new Map<string, LongContinuityFileTarget>();
  const add = (target: LongContinuityFileTarget): void => {
    if (targets.has(target.file.id)) {
      throw new Error(
        t(
          "longWorkspaceProposals.theNovelWorkspaceContainsDuplicateContinuityFileIdentifiers"
        )
      );
    }
    targets.set(target.file.id, target);
  };
  for (const chapter of index.chapters) {
    add({
      chapterCardId: chapter.chapterCardId,
      role: "chapter_end_state",
      characterId: null,
      file: chapter.characterState
    });
    add({
      chapterCardId: chapter.chapterCardId,
      role: "handoff",
      characterId: null,
      file: chapter.handoff
    });
    add({
      chapterCardId: chapter.chapterCardId,
      role: "foreshadowing_changes",
      characterId: null,
      file: chapter.foreshadowingChanges
    });
    if (chapter.worldReveals) {
      add({
        chapterCardId: chapter.chapterCardId,
        role: "world_reveals",
        characterId: null,
        file: chapter.worldReveals
      });
    }
    for (const continuity of chapter.characterContinuity) {
      add({
        chapterCardId: chapter.chapterCardId,
        role: "character_current_state",
        characterId: continuity.characterId,
        file: continuity.currentState
      });
      add({
        chapterCardId: chapter.chapterCardId,
        role: "character_history",
        characterId: continuity.characterId,
        file: continuity.history
      });
    }
  }
  return targets;
}

function createdContinuityFileTarget(
  event: LongContinuityFileProposalEvent,
  fileId: string
): LongContinuityFileTarget | undefined {
  for (const operation of event.payload.batch.operations) {
    if (
      operation.type === "chapterContinuity.worldReveals.create" &&
      operation.file.id === fileId
    ) {
      return {
        chapterCardId: operation.chapterCardId,
        role: "world_reveals",
        characterId: null,
        file: operation.file
      };
    }
    if (operation.type === "chapterContinuity.character.create") {
      if (operation.currentState.id === fileId) {
        return {
          chapterCardId: operation.chapterCardId,
          role: "character_current_state",
          characterId: operation.characterId,
          file: operation.currentState
        };
      }
      if (operation.history.id === fileId) {
        return {
          chapterCardId: operation.chapterCardId,
          role: "character_history",
          characterId: operation.characterId,
          file: operation.history
        };
      }
    }
  }
  return undefined;
}

function assertContinuityFileMetadata(
  index: LongWorkspaceIndexSnapshot,
  change: LongContinuityFileChange,
  target: LongContinuityFileTarget
): void {
  if (
    change.fileId !== target.file.id ||
    change.filePath !== target.file.path ||
    change.chapterCardId !== target.chapterCardId ||
    change.role !== target.role ||
    change.characterId !== target.characterId ||
    change.title !== continuityFileTitle(index, target)
  ) {
    throw new Error(
      t("longWorkspaceProposals.theContinuityProposalSFilePathChapterRoleOr")
    );
  }
}

export type LongWorkspaceProposalStatus =
  "previewing" | "waiting" | "ready" | "submitting" | "error" | "accepted";

export interface LongWorkspaceProposalItem {
  event: LongWorkspaceReviewEvent;
  approvalMode: AgentWriteApprovalMode;
  status: LongWorkspaceProposalStatus;
  preview?: LongWorkspaceImpactPreview;
  effectiveBatch?: LongWorkspaceOperationBatch;
  error?: string;
  errorPhase?: "preview" | "apply";
  errorRetryable?: boolean;
  blockedByError?: boolean;
}

interface LongProposalNotifications {
  success(message: string): void;
  warning(message: string): void;
  error(message: string): void;
}

export interface UseLongWorkspaceProposalsOptions {
  queues?: Ref<Record<string, LongWorkspaceProposalItem[]>>;
  api: () => LongWorkspaceRendererApi | undefined;
  acceptsEvent: (event: LongWorkspaceProposalEvent) => boolean;
  approvalModeForEvent?: (
    event: LongWorkspaceProposalEvent
  ) => AgentWriteApprovalMode | undefined;
  prepareAutoApprove?: (
    event: LongWorkspaceProposalEvent
  ) => void | Promise<void>;
  canFinalizeContinuity?: (
    event: Extract<
      LongWorkspaceProposalEvent,
      { type: "long.ledger_commit_proposal" }
    >
  ) => boolean;
  onContinuityFinalizationFailed?: (
    event: Extract<
      LongWorkspaceProposalEvent,
      { type: "long.ledger_commit_proposal" }
    >,
    message: string
  ) => boolean;
  onApplied?: (event: LongWorkspaceProposalEvent) => void | Promise<void>;
  onRejected?: (event: LongWorkspaceProposalEvent) => void;
  notifications: LongProposalNotifications;
}

export interface EnqueueManualLongMutationInput {
  bookId: string;
  agentId?: LongAgentId;
  batch: LongWorkspaceOperationBatch;
  summary: string;
}

export interface LongWorkspaceProposalController {
  queues: Ref<Record<string, LongWorkspaceProposalItem[]>>;
  itemsForBook(bookId: string | null | undefined): LongWorkspaceProposalItem[];
  activateBook(bookId: string): void;
  discardBook(bookId: string): void;
  quarantineSession(bookId: string, sessionId: string): void;
  handleEvent(event: SystemEventEnvelope): Promise<boolean>;
  enqueueManualMutation(
    input: EnqueueManualLongMutationInput
  ): Promise<LongMutationProposalEvent>;
  retryPreview(bookId: string, eventId: string): Promise<void>;
  approve(bookId: string, eventId: string): Promise<void>;
  reject(bookId: string, eventId: string): boolean;
}

const LONG_PROPOSAL_TYPES = new Set<SystemEventEnvelope["type"]>([
  "long.mutation_proposal",
  "long.worldbuilding_file_proposal",
  "long.character_file_proposal",
  "long.continuity_file_proposal",
  "long.ledger_commit_proposal"
]);

function isLongProposalEvent(
  event: SystemEventEnvelope
): event is LongWorkspaceProposalEvent {
  return LONG_PROPOSAL_TYPES.has(event.type);
}

function isRetryableLongProposalError(error: unknown): boolean {
  const code = getErrorCode(error);
  return (
    !code?.startsWith("long.operation.") && code !== "long.ledger.audit_failed"
  );
}

function ipcSafeJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function useLongWorkspaceProposals(
  options: UseLongWorkspaceProposalsOptions
): LongWorkspaceProposalController {
  const queues =
    options.queues ?? ref<Record<string, LongWorkspaceProposalItem[]>>({});
  const handledEventIds = new Set<string>();
  const handledProposalKeys = new Set<string>();
  const discardedBookIds = new Set<string>();
  const quarantinedSessions = new Set<string>();
  const proposalApprovalQueue = createKeyedSerialTaskQueue<string>();
  const pendingContinuityFinalizations = new Map<
    string,
    LongContinuityFinalizationEvent
  >();
  const continuityFinalizationsInFlight = new Set<string>();

  function sessionKey(bookId: string, sessionId: string): string {
    return `${bookId}\u0000${sessionId}`;
  }

  function proposalKey(event: LongWorkspaceProposalEvent): string {
    return [
      event.type,
      event.payload.bookId,
      event.payload.sessionId,
      event.payload.runId,
      event.payload.toolCallId
    ].join("\u0000");
  }

  function clearContinuityFinalizations(
    matches: (
      event: Extract<
        LongWorkspaceProposalEvent,
        { type: "long.ledger_commit_proposal" }
      >
    ) => boolean
  ): void {
    for (const [key, event] of pendingContinuityFinalizations) {
      if (matches(event)) pendingContinuityFinalizations.delete(key);
    }
  }

  function itemsForBook(
    bookId: string | null | undefined
  ): LongWorkspaceProposalItem[] {
    return bookId ? (queues.value[bookId] ?? []) : [];
  }

  function setBookItems(
    bookId: string,
    items: LongWorkspaceProposalItem[]
  ): void {
    const pending = items.filter(({ status }) => status !== "accepted");
    const accepted = items
      .filter(({ status }) => status === "accepted")
      .slice(-100);
    const retained = [...pending, ...accepted].sort((left, right) =>
      left.event.timestamp.localeCompare(right.event.timestamp)
    );
    const next = { ...queues.value };
    if (retained.length) {
      next[bookId] = withLongProposalBlockers(retained);
    } else {
      delete next[bookId];
    }
    queues.value = next;
  }

  function activateBook(bookId: string): void {
    discardedBookIds.delete(bookId);
  }

  function discardBook(bookId: string): void {
    discardedBookIds.add(bookId);
    clearContinuityFinalizations((event) => event.payload.bookId === bookId);
    setBookItems(bookId, []);
  }

  function quarantineSession(bookId: string, sessionId: string): void {
    quarantinedSessions.add(sessionKey(bookId, sessionId));
    clearContinuityFinalizations(
      (event) =>
        event.payload.bookId === bookId && event.payload.sessionId === sessionId
    );
    while (quarantinedSessions.size > 2_000) {
      const oldest = quarantinedSessions.values().next().value as
        string | undefined;
      if (!oldest) break;
      quarantinedSessions.delete(oldest);
    }
    setBookItems(
      bookId,
      itemsForBook(bookId).filter(
        (item) => item.event.payload.sessionId !== sessionId
      )
    );
  }

  function updateItem(
    bookId: string,
    eventId: string,
    patch: Partial<Omit<LongWorkspaceProposalItem, "event">> & {
      clearError?: boolean;
      clearPreview?: boolean;
    }
  ): void {
    setBookItems(
      bookId,
      itemsForBook(bookId).map((item) => {
        if (item.event.id !== eventId) return item;
        const { clearError, clearPreview, ...values } = patch;
        const next = { ...item, ...values };
        if (clearError) {
          delete next.error;
          delete next.errorPhase;
          delete next.errorRetryable;
        }
        if (clearPreview) {
          delete next.preview;
          delete next.effectiveBatch;
        }
        return next;
      })
    );
  }

  function removeItem(bookId: string, eventId: string): void {
    setBookItems(
      bookId,
      itemsForBook(bookId).filter((item) => item.event.id !== eventId)
    );
  }

  function currentItem(
    bookId: string,
    eventId: string
  ): LongWorkspaceProposalItem | undefined {
    return itemsForBook(bookId).find((item) => item.event.id === eventId);
  }

  function pendingBatchPredecessor(
    item: LongWorkspaceProposalItem
  ): LongWorkspaceProposalItem | undefined {
    const items = itemsForBook(item.event.payload.bookId);
    const currentIndex = items.findIndex(
      ({ event }) => event.id === item.event.id
    );
    if (currentIndex < 0) return undefined;
    return items
      .slice(0, currentIndex)
      .find(
        (candidate) =>
          isBatchProposal(candidate.event) &&
          candidate.event.payload.sessionId === item.event.payload.sessionId &&
          candidate.event.payload.runId === item.event.payload.runId &&
          candidate.status !== "accepted"
      );
  }

  async function previewMutation(
    item: LongWorkspaceProposalItem
  ): Promise<void> {
    if (
      item.event.type !== "long.mutation_proposal" &&
      !isContentFileProposal(item.event)
    )
      return;
    const { event } = item;
    const api = options.api();
    if (!api) {
      updateItem(event.payload.bookId, event.id, {
        status: "error",
        error: t(
          "longConversationCoordinator.theNovelWorkspaceIsNotConnectedInThisEnvironment"
        ),
        errorPhase: "preview",
        errorRetryable: true,
        clearPreview: true
      });
      return;
    }
    updateItem(event.payload.bookId, event.id, {
      status: "previewing",
      clearError: true,
      clearPreview: true
    });
    try {
      const batchPredecessor = pendingBatchPredecessor(item);
      if (batchPredecessor) {
        updateItem(event.payload.bookId, event.id, {
          status: "waiting",
          clearError: true
        });
        return;
      }
      let effectiveBatch = event.payload.batch;
      if (isContentFileProposal(event)) {
        const latest = await api.getWorkspaceIndex({
          bookId: event.payload.bookId
        });
        if (
          latest.bookId !== event.payload.bookId ||
          latest.workspaceIndex.bookId !== event.payload.bookId
        ) {
          throw new Error(
            t(
              "longWorkspaceProposals.theNovelWorkspaceIndexReturnedTheWrongProject"
            )
          );
        }
        const continuityTargets =
          event.type === "long.continuity_file_proposal"
            ? continuityFileTargets(latest.workspaceIndex)
            : null;
        const characterFiles = [
          ...(latest.workspaceIndex.characterOverview
            ? [latest.workspaceIndex.characterOverview]
            : []),
          ...latest.workspaceIndex.characterFiles.flatMap((entry) => [
            entry.coreProfile,
            entry.relationships
          ])
        ];
        const currentFiles = new Map<string, LongWorkspaceFileReference>(
          event.type === "long.worldbuilding_file_proposal"
            ? longWorldbuildingFiles(latest.workspaceIndex.worldbuilding).map(
                (file) => [file.id, file] as const
              )
            : event.type === "long.character_file_proposal"
              ? characterFiles.map((file) => [file.id, file] as const)
              : [...continuityTargets!.values()].map(
                  ({ file }) => [file.id, file] as const
                )
        );
        for (const file of event.payload.files) {
          const current = currentFiles.get(file.fileId);
          if (event.type === "long.continuity_file_proposal") {
            const currentTarget = continuityTargets!.get(file.fileId);
            if (file.operation === "create") {
              if (current || currentTarget) {
                throw new Error(
                  t(
                    "longWorkspaceProposals.theContinuityFileAlreadyExistsAndCannotBeCreated",
                    { fileId: file.fileId }
                  )
                );
              }
              const createdTarget = createdContinuityFileTarget(
                event,
                file.fileId
              );
              if (!createdTarget || file.beforeText !== "") {
                throw new Error(
                  t(
                    "longWorkspaceProposals.theContinuityCreationProposalHasAnInconsistentIdentityOr"
                  )
                );
              }
              assertContinuityFileMetadata(
                latest.workspaceIndex,
                file as LongContinuityFileChange,
                createdTarget
              );
              continue;
            }
            if (!current || !currentTarget) {
              throw new Error(
                t("longWorkspaceProposals.theContinuityFileNoLongerExists", {
                  fileId: file.fileId
                })
              );
            }
            assertContinuityFileMetadata(
              latest.workspaceIndex,
              file as LongContinuityFileChange,
              currentTarget
            );
            continue;
          }
          if (file.operation === "create") {
            if (current) {
              throw new Error(
                t(
                  "longWorkspaceProposals.theTargetFileAlreadyExistsAndCannotBeCreated",
                  { filePath: file.filePath }
                )
              );
            }
          } else if (!current) {
            throw new Error(
              t("longWorkspaceProposals.theTargetFileNoLongerExists", {
                filePath: file.filePath
              })
            );
          }
        }
        const nextOrderByCategory = new Map<string, number>();
        const nextOrderByCharacterGroup = new Map<string, number>();
        effectiveBatch = {
          ...event.payload.batch,
          operations: event.payload.batch.operations.map((operation) => {
            if (operation.type === "worldbuildingItem.create") {
              const category = latest.workspaceIndex.worldbuilding.find(
                ({ id }) => id === operation.categoryId
              );
              if (!category || category.format !== "list") {
                throw new Error(
                  t(
                    "longWorkspaceProposals.theTargetWorldbuildingCategoryNoLongerExistsOrIs"
                  )
                );
              }
              const nextOrder =
                (nextOrderByCategory.get(category.id) ??
                  category.items.length) + 1;
              nextOrderByCategory.set(category.id, nextOrder);
              return {
                ...operation,
                item: { ...operation.item, order: nextOrder }
              };
            }
            if (operation.type === "character.create") {
              const group = operation.character.group;
              const currentCount = latest.workspaceIndex.characters.filter(
                (character) => character.group === group
              ).length;
              const nextOrder =
                (nextOrderByCharacterGroup.get(group) ?? currentCount) + 1;
              nextOrderByCharacterGroup.set(group, nextOrder);
              return {
                ...operation,
                character: { ...operation.character, order: nextOrder }
              };
            }
            return operation;
          })
        };
      }
      const result = await api.previewOperations(
        ipcSafeJson({
          bookId: event.payload.bookId,
          batch: LongWorkspaceOperationBatchSchema.parse(effectiveBatch)
        })
      );
      if (result.bookId !== event.payload.bookId) {
        throw new Error(
          t(
            "longWorkspaceProposals.theStructuralImpactPreviewReturnedTheWrongNovelProject"
          )
        );
      }
      if (!currentItem(event.payload.bookId, event.id)) return;
      updateItem(event.payload.bookId, event.id, {
        status: "ready",
        preview: result.preview,
        effectiveBatch,
        clearError: true
      });
    } catch (error: unknown) {
      if (!currentItem(event.payload.bookId, event.id)) return;
      updateItem(event.payload.bookId, event.id, {
        status: "error",
        error: errorMessage(
          error,
          t("longWorkspaceProposals.failedToPreviewNovelStructuralImpact")
        ),
        errorPhase: "preview",
        errorRetryable: isRetryableLongProposalError(error),
        clearPreview: true
      });
    }
  }

  function rememberEvent(event: LongWorkspaceProposalEvent): boolean {
    const semanticKey = proposalKey(event);
    if (handledEventIds.has(event.id) || handledProposalKeys.has(semanticKey)) {
      return false;
    }
    handledEventIds.add(event.id);
    handledProposalKeys.add(semanticKey);
    while (handledEventIds.size > 2_000) {
      const oldest = handledEventIds.values().next().value as
        string | undefined;
      if (!oldest) break;
      handledEventIds.delete(oldest);
    }
    while (handledProposalKeys.size > 2_000) {
      const oldest = handledProposalKeys.values().next().value as
        string | undefined;
      if (!oldest) break;
      handledProposalKeys.delete(oldest);
    }
    return true;
  }

  function continuityFinalizationHasPendingChanges(
    event: Extract<
      LongWorkspaceProposalEvent,
      { type: "long.ledger_commit_proposal" }
    >
  ): boolean {
    return itemsForBook(event.payload.bookId).some(
      (item) =>
        item.event.payload.sessionId === event.payload.sessionId &&
        item.event.payload.runId === event.payload.runId &&
        item.event.type === "long.continuity_file_proposal" &&
        item.status !== "accepted"
    );
  }

  async function attemptContinuityFinalizations(bookId: string): Promise<void> {
    for (const [key, event] of pendingContinuityFinalizations) {
      if (
        event.payload.bookId !== bookId ||
        continuityFinalizationsInFlight.has(key)
      ) {
        continue;
      }
      if (continuityFinalizationHasPendingChanges(event)) {
        updateItem(bookId, event.id, {
          status: "waiting",
          clearError: true
        });
        continue;
      }
      if (options.canFinalizeContinuity?.(event) === false) {
        pendingContinuityFinalizations.delete(key);
        removeItem(bookId, event.id);
        continue;
      }
      continuityFinalizationsInFlight.add(key);
      updateItem(bookId, event.id, {
        status: "submitting",
        clearError: true
      });
      try {
        const api = options.api();
        if (!api)
          throw new Error(
            t(
              "longConversationCoordinator.theNovelWorkspaceIsNotConnectedInThisEnvironment"
            )
          );
        await commitLongContinuityFinalization(api, event);
      } catch (error: unknown) {
        const message = errorMessage(
          error,
          t("longWorkspaceProposals.failedToArchiveContinuityFiles")
        );
        updateItem(bookId, event.id, {
          status: "error",
          error: message,
          errorPhase: "apply",
          errorRetryable: isRetryableLongProposalError(error)
        });
        if (!options.onContinuityFinalizationFailed?.(event, message)) {
          options.notifications.error(message);
        }
        continue;
      } finally {
        continuityFinalizationsInFlight.delete(key);
      }
      pendingContinuityFinalizations.delete(key);
      updateItem(bookId, event.id, {
        status: "accepted",
        clearError: true
      });
      options.notifications.success(
        t(
          "longWorkspaceProposals.continuityFilesForThisChapterHaveBeenArchived"
        )
      );
      try {
        await options.onApplied?.(event);
      } catch (error: unknown) {
        options.notifications.warning(
          t(
            "longWorkspaceProposals.continuityFilesWereArchivedButTheSubsequentRefreshFailed",
            {
              value: errorMessage(
                error,
                t("longWorkspaceProposals.refreshTheNovelWorkspaceManually")
              )
            }
          )
        );
      }
    }
  }

  async function processAutomaticProposal(
    event: LongWorkspaceReviewEvent,
    previewFirst: boolean
  ): Promise<void> {
    await proposalApprovalQueue.enqueue(event.payload.bookId, async () => {
      let current = currentItem(event.payload.bookId, event.id);
      if (!current) return;
      let prepared = false;
      if (previewFirst && isContentFileProposal(current.event)) {
        try {
          await options.prepareAutoApprove?.(event);
          prepared = true;
        } catch (error: unknown) {
          const message = errorMessage(
            error,
            t(
              "longWorkspaceProposals.thePreSaveCheckForAutomaticNovelFileSaving"
            )
          );
          updateItem(event.payload.bookId, event.id, {
            status: "error",
            error: message,
            clearPreview: true
          });
          options.notifications.error(message);
          return;
        }
      }
      if (
        previewFirst &&
        (current.event.type === "long.mutation_proposal" ||
          isContentFileProposal(current.event))
      ) {
        await previewMutation(current);
        current = currentItem(event.payload.bookId, event.id);
      }
      // Destructive automatic batches are saved too (with a restore point):
      // holding one for review would stall every later item of the run.
      if (!current || current.status !== "ready") return;
      if (!prepared) {
        try {
          await options.prepareAutoApprove?.(event);
        } catch (error: unknown) {
          const message = errorMessage(
            error,
            t(
              "longWorkspaceProposals.thePreSaveCheckForAutomaticNovelProposalSaving"
            )
          );
          updateItem(event.payload.bookId, event.id, {
            status: "error",
            error: message,
            clearPreview: true
          });
          options.notifications.error(message);
          return;
        }
      }
      await approveCurrent(event.payload.bookId, event.id);
    });
  }

  async function enqueueProposalEvent(
    event: LongWorkspaceReviewEvent,
    approvalMode: AgentWriteApprovalMode = options.approvalModeForEvent?.(
      event
    ) ?? "request-approval"
  ): Promise<boolean> {
    if (!rememberEvent(event)) {
      return false;
    }

    const item: LongWorkspaceProposalItem = {
      event,
      approvalMode,
      status:
        event.type === "long.mutation_proposal" || isContentFileProposal(event)
          ? "previewing"
          : "ready"
    };
    setBookItems(event.payload.bookId, [
      ...itemsForBook(event.payload.bookId),
      item
    ]);
    if (approvalMode === "auto-approve") {
      await processAutomaticProposal(event, true);
    } else if (
      event.type === "long.mutation_proposal" ||
      isContentFileProposal(event)
    ) {
      await previewMutation(item);
    }
    return true;
  }

  async function handleEvent(event: SystemEventEnvelope): Promise<boolean> {
    if (
      !isLongProposalEvent(event) ||
      discardedBookIds.has(event.payload.bookId) ||
      quarantinedSessions.has(
        sessionKey(event.payload.bookId, event.payload.sessionId)
      ) ||
      handledEventIds.has(event.id) ||
      handledProposalKeys.has(proposalKey(event)) ||
      !options.acceptsEvent(event)
    ) {
      return false;
    }
    if (event.type === "long.ledger_commit_proposal") {
      if (!rememberEvent(event)) return false;
      const finalizationKey = continuityFinalizationKey(event);
      pendingContinuityFinalizations.set(finalizationKey, event);
      const retainedItems = itemsForBook(event.payload.bookId).filter(
        (item) =>
          item.status === "accepted" ||
          item.event.type !== "long.ledger_commit_proposal" ||
          continuityFinalizationKey(item.event) !== finalizationKey
      );
      setBookItems(event.payload.bookId, [
        ...retainedItems,
        {
          event,
          approvalMode: "auto-approve",
          status: "waiting"
        }
      ]);
      await proposalApprovalQueue.enqueue(event.payload.bookId, () =>
        attemptContinuityFinalizations(event.payload.bookId)
      );
      return true;
    }
    return enqueueProposalEvent(event);
  }

  function createUniqueManualEventId(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const eventId = createId("long_manual_mutation");
      if (!handledEventIds.has(eventId)) {
        return eventId;
      }
    }
    throw new Error(
      t("longWorkspaceProposals.cannotGenerateAUniqueEventIdForTheManual")
    );
  }

  async function enqueueManualMutation(
    input: EnqueueManualLongMutationInput
  ): Promise<LongMutationProposalEvent> {
    const eventId = createUniqueManualEventId();
    const sessionId = createId("long_manual_session");
    const runId = createId("long_manual_run");
    const event = LongMutationProposalEventEnvelopeSchema.parse(
      createEnvelope(
        "long.mutation_proposal",
        {
          sessionId,
          runId,
          toolCallId: createId("long_manual_tool"),
          bookId: input.bookId,
          agentId: input.agentId ?? "long",
          summary: input.summary,
          runtime: {
            provider: "deepwrite",
            model: "manual-structure-manager",
            mode: "local-faux"
          },
          batch: input.batch
        },
        {
          id: eventId,
          context: {
            sessionId,
            runId,
            resourceId: input.bookId
          }
        }
      )
    );
    activateBook(input.bookId);
    if (!(await enqueueProposalEvent(event, "request-approval"))) {
      throw new Error(
        t(
          "longWorkspaceProposals.theManualNovelStructureProposalEventIdConflictsPlease"
        )
      );
    }
    return event;
  }

  async function retryPreview(bookId: string, eventId: string): Promise<void> {
    const item = currentItem(bookId, eventId);
    if (!item || item.status === "previewing" || item.status === "submitting") {
      return;
    }
    if (item.event.type === "long.ledger_commit_proposal") {
      await proposalApprovalQueue.enqueue(bookId, () =>
        attemptContinuityFinalizations(bookId)
      );
      return;
    }
    if (
      item.approvalMode === "auto-approve" &&
      (item.event.type === "long.mutation_proposal" ||
        isContentFileProposal(item.event))
    ) {
      await processAutomaticProposal(item.event, true);
      return;
    }
    await previewMutation(item);
    const current = currentItem(bookId, eventId);
    if (
      current?.approvalMode === "auto-approve" &&
      current.status === "ready"
    ) {
      await processAutomaticProposal(current.event, false);
    }
  }

  /**
   * Automatic items never fall back to manual review: a changed impact is
   * previewed again and retried a bounded number of times, then reported as a
   * retryable failure. Manual items show the refreshed impact for a decision.
   */
  async function approveCurrent(
    bookId: string,
    eventId: string,
    automaticRetries = AUTOMATIC_IMPACT_RETRIES
  ): Promise<void> {
    const item = currentItem(bookId, eventId);
    const api = options.api();
    if (!item || !api || item.status === "submitting") {
      if (!api) {
        options.notifications.warning(
          t(
            "longConversationCoordinator.theNovelWorkspaceIsNotConnectedInThisEnvironment"
          )
        );
      }
      return;
    }
    if (item.event.type === "long.ledger_commit_proposal") {
      await attemptContinuityFinalizations(bookId);
      return;
    }
    if (
      (item.event.type === "long.mutation_proposal" ||
        isContentFileProposal(item.event)) &&
      (item.status !== "ready" || !item.preview)
    ) {
      await previewMutation(item);
      const refreshed = currentItem(bookId, eventId);
      if (refreshed?.status !== "ready" || !refreshed.preview) return;
      if (refreshed.approvalMode === "auto-approve") {
        await approveCurrent(bookId, eventId, automaticRetries);
        return;
      }
      options.notifications.warning(
        t(
          "longWorkspaceProposals.relatedImpactsHaveBeenCheckedReviewTheLatestImpacts"
        )
      );
      return;
    }
    const mutationPreview =
      item.event.type === "long.mutation_proposal" ||
      isContentFileProposal(item.event)
        ? item.preview
        : undefined;
    if (
      item.event.type !== "long.mutation_proposal" &&
      !isContentFileProposal(item.event) &&
      item.status !== "ready" &&
      item.status !== "error"
    ) {
      return;
    }

    updateItem(bookId, eventId, {
      status: "submitting",
      clearError: true
    });
    try {
      if (
        item.event.type === "long.mutation_proposal" ||
        isContentFileProposal(item.event)
      ) {
        const effectiveBatch = item.effectiveBatch ?? item.event.payload.batch;
        const destructive = longWorkspaceOperationsRequireImpactConfirmation(
          effectiveBatch.operations,
          mutationPreview!.confirmation
        );
        await api.applyOperations(
          ipcSafeJson({
            bookId,
            ...(destructive && item.approvalMode === "auto-approve"
              ? { captureRestorePoint: true }
              : {}),
            batch: LongWorkspaceOperationBatchSchema.parse({
              ...effectiveBatch,
              expectedImpact: mutationPreview!.confirmation
            })
          })
        );
      } else {
        throw new Error(
          t(
            "longWorkspaceProposals.chapterProseMustBeSavedThroughAConversationDiff"
          )
        );
      }
    } catch (error: unknown) {
      if (
        (item.event.type === "long.mutation_proposal" ||
          isContentFileProposal(item.event)) &&
        isLongImpactMismatch(error)
      ) {
        await previewMutation(item);
        const refreshed = currentItem(bookId, eventId);
        if (refreshed?.status !== "ready" || !refreshed.preview) return;
        if (refreshed.approvalMode !== "auto-approve") {
          options.notifications.warning(
            t(
              "longWorkspaceProposals.relationshipsOrDeletionImpactsChangedReviewTheLatestImpacts"
            )
          );
          return;
        }
        if (automaticRetries > 0) {
          await approveCurrent(bookId, eventId, automaticRetries - 1);
          return;
        }
        const message = t(
          "longWorkspaceProposals.impactKeptChangingDuringAutomaticSave"
        );
        updateItem(bookId, eventId, {
          status: "error",
          error: message,
          errorPhase: "apply",
          errorRetryable: true
        });
        options.notifications.error(message);
        return;
      }
      updateItem(bookId, eventId, {
        status: "error",
        error: errorMessage(
          error,
          t("longWorkspaceProposals.failedToProcessNovelProposal")
        ),
        errorPhase: "apply",
        errorRetryable: isRetryableLongProposalError(error),
        clearPreview: true
      });
      options.notifications.error(
        errorMessage(
          error,
          t("longWorkspaceProposals.failedToProcessNovelProposal")
        )
      );
      return;
    }

    if (
      item.event.type === "long.mutation_proposal" ||
      isContentFileProposal(item.event)
    ) {
      updateItem(bookId, eventId, {
        status: "accepted",
        clearError: true
      });
    } else {
      removeItem(bookId, eventId);
    }
    options.notifications.success(
      item.event.type === "long.mutation_proposal"
        ? t("longWorkspaceProposals.novelStructureProposalApplied")
        : item.event.type === "long.worldbuilding_file_proposal"
          ? t(
              "longWorkspaceProposals.worldbuildingFileChangesSavedToLocalMarkdown"
            )
          : item.event.type === "long.character_file_proposal"
            ? t(
                "longWorkspaceProposals.characterFileChangesSavedToLocalMarkdown"
              )
            : t(
                "longWorkspaceProposals.chapterContinuityRecordsSavedToLocalMarkdown"
              )
    );
    try {
      await options.onApplied?.(item.event);
    } catch (error: unknown) {
      options.notifications.warning(
        t(
          "longWorkspaceProposals.novelProposalSavedButTheSubsequentRefreshFailed",
          {
            value: errorMessage(
              error,
              t("longWorkspaceProposals.refreshTheNovelWorkspaceManually")
            )
          }
        )
      );
    }
    if (isBatchProposal(item.event)) {
      for (const waiting of itemsForBook(bookId).filter(
        (candidate) =>
          candidate.status === "waiting" && isBatchProposal(candidate.event)
      )) {
        if (waiting.approvalMode === "auto-approve") {
          queueMicrotask(() => {
            void processAutomaticProposal(waiting.event, true);
          });
        } else {
          await previewMutation(waiting);
        }
      }
    }
    await attemptContinuityFinalizations(bookId);
  }

  async function approve(bookId: string, eventId: string): Promise<void> {
    await proposalApprovalQueue.enqueue(bookId, async () => {
      await approveCurrent(bookId, eventId);
    });
  }

  function reject(bookId: string, eventId: string): boolean {
    const item = currentItem(bookId, eventId);
    if (!item || item.status === "submitting" || item.status === "accepted")
      return false;
    if (item.event.type === "long.ledger_commit_proposal") {
      pendingContinuityFinalizations.delete(
        continuityFinalizationKey(item.event)
      );
    }
    if (isContentFileProposal(item.event)) {
      const canceledFinalizations = [
        ...pendingContinuityFinalizations.values()
      ].filter(
        (event) =>
          event.payload.bookId === bookId &&
          event.payload.sessionId === item.event.payload.sessionId
      );
      clearContinuityFinalizations(
        (event) =>
          event.payload.bookId === bookId &&
          event.payload.sessionId === item.event.payload.sessionId
      );
      for (const finalization of canceledFinalizations) {
        updateItem(bookId, finalization.id, {
          status: "error",
          error: t(
            "longWorkspaceProposals.anEarlierContinuityFileProposalWasRejectedThisChapter"
          ),
          errorPhase: "apply",
          errorRetryable: false
        });
      }
    }
    options.onRejected?.(item.event);
    removeItem(bookId, eventId);
    if (isBatchProposal(item.event)) {
      for (const waiting of itemsForBook(bookId).filter(
        (candidate) =>
          candidate.status === "waiting" && isBatchProposal(candidate.event)
      )) {
        queueMicrotask(() => {
          if (waiting.approvalMode === "auto-approve") {
            void processAutomaticProposal(waiting.event, true);
          } else {
            void previewMutation(waiting);
          }
        });
      }
    }
    return true;
  }

  return {
    queues,
    itemsForBook,
    activateBook,
    discardBook,
    quarantineSession,
    handleEvent,
    enqueueManualMutation,
    retryPreview,
    approve,
    reject
  };
}
