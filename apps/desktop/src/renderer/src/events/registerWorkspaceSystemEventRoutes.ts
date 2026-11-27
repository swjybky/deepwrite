import type { SystemEventEnvelope } from "@deepwrite/contracts";
import { createScopedTranslator } from "../i18n";
import { dismissUiMessage, uiMessage } from "../ui-feedback";
import { subscribeNotificationBlockedToast } from "./notificationBlockedToast";
import type { SystemEventCenter } from "./systemEventCenter";
import { deepwriteApi } from "../api/deepwrite";

const tStorage = createScopedTranslator("workspace.storageSettings");

type EventOf<Type extends SystemEventEnvelope["type"]> = Extract<
  SystemEventEnvelope,
  { type: Type }
>;

export interface WorkspaceEventConversation {
  handleEvent(event: SystemEventEnvelope): void;
}

export interface QueuedAgentEditRun {
  sessionId: string;
  runId: string;
}

export interface WorkspaceSystemEventRouteDependencies {
  refreshDecompositionTarget?(
    event: EventOf<"decomposition.target_updated">
  ): Promise<void>;
  longBookDecomposition?: { handleEvent(event: SystemEventEnvelope): void };
  revisionAnalysis: { handleEvent(event: SystemEventEnvelope): void };
  shortBookAnalysis: { handleEvent(event: SystemEventEnvelope): void };
  longBookAnalysis: {
    handleEvent(event: SystemEventEnvelope): void;
  };
  subagentAuthoring: {
    handleEvent(event: SystemEventEnvelope): void;
  };
  stageLongPlotDesignEditProposal(
    event: EventOf<"long.mutation_proposal">
  ): void;
  stageLongWorldbuildingEditProposal(
    event: EventOf<"long.worldbuilding_file_proposal">
  ): void;
  stageLongCharacterEditProposal(
    event: EventOf<"long.character_file_proposal">
  ): void;
  stageLongDraftEditProposal(
    event: EventOf<"long.chapter_write_proposal">
  ): void;
  handleLongWorkspaceProposal(event: SystemEventEnvelope): Promise<unknown>;
  handleMysteryMutationProposal?(
    event: EventOf<"mystery.mutation_proposal">
  ): Promise<unknown> | void;
  stageAgentEditProposal(event: EventOf<"workspace.editor_mutation">): void;
  stageAcademicWorkspaceProposal?(
    event: EventOf<"academic.workspace_mutation">
  ): void;
  stageLibraryStructureProposal?(
    event: EventOf<"library.structure_proposal">
  ): void;
  stageLibraryEditProposal(event: EventOf<"library.editor_mutation">): void;
  navigateToWorkspaceStage(event: EventOf<"workspace.stage_selection">): void;
  refreshAfterExternalChange?(): Promise<unknown>;
  allConversations(): readonly WorkspaceEventConversation[];
  scheduleQueuedAgentEdits(
    predicate: (queued: QueuedAgentEditRun) => boolean
  ): void;
  onAsyncError(error: unknown, event: SystemEventEnvelope): void;
}

/**
 * Registers the ordered routes for the renderer's shared system-event stream.
 *
 * Order is intentional: feature modules and proposal staging must observe an
 * event before conversations process terminal events and queued automatic
 * edits are resumed.
 */
export function registerWorkspaceSystemEventRoutes(
  center: SystemEventCenter,
  dependencies: WorkspaceSystemEventRouteDependencies
): () => void {
  let lastCompactionKey = "";
  let compactionToastId = -1;
  let sawActiveCompaction = false;
  const disposers = [
    center.subscribe("rendererState.compactionUpdated", ({ payload }) => {
      const { phase, failureCode, failureDetail } = payload.status;
      if (
        phase === "running" ||
        phase === "verifying" ||
        phase === "swapping"
      ) {
        sawActiveCompaction = true;
        return;
      }
      const key = `${phase}:${failureCode ?? ""}:${failureDetail ?? ""}`;
      if (key === lastCompactionKey) return;
      if (phase === "failed") {
        lastCompactionKey = key;
        dismissUiMessage(compactionToastId);
        compactionToastId = uiMessage.warning(
          failureDetail
            ? tStorage("compactionFailedWithReason", { reason: failureDetail })
            : tStorage("compactionFailed"),
          { duration: 8_000 }
        );
      } else if (phase === "completed_with_backup" && sawActiveCompaction) {
        lastCompactionKey = key;
        sawActiveCompaction = false;
        dismissUiMessage(compactionToastId);
        compactionToastId = uiMessage.success(
          tStorage("compactionCompletedWithBackup"),
          { duration: 6_000 }
        );
      }
    }),
    center.subscribe("decomposition.target_updated", (event) => {
      void dependencies
        .refreshDecompositionTarget?.(event)
        .catch((error) => dependencies.onAsyncError(error, event));
    }),
    center.subscribeAll((event) => {
      dependencies.longBookAnalysis.handleEvent(event);
      dependencies.longBookDecomposition?.handleEvent(event);
      dependencies.shortBookAnalysis.handleEvent(event);
      dependencies.revisionAnalysis.handleEvent(event);
    }),
    center.subscribeAll((event) => {
      dependencies.subagentAuthoring.handleEvent(event);
    }),
    center.subscribeAll((event) => {
      if (event.type === "long.mutation_proposal") {
        dependencies.stageLongPlotDesignEditProposal(event);
      } else if (event.type === "long.worldbuilding_file_proposal") {
        dependencies.stageLongWorldbuildingEditProposal(event);
      } else if (event.type === "long.character_file_proposal") {
        dependencies.stageLongCharacterEditProposal(event);
      } else if (event.type === "long.chapter_write_proposal") {
        dependencies.stageLongDraftEditProposal(event);
      } else if (event.type === "mystery.mutation_proposal") {
        void Promise.resolve(
          dependencies.handleMysteryMutationProposal?.(event)
        ).catch((error) => {
          dependencies.onAsyncError(error, event);
        });
      } else {
        void dependencies.handleLongWorkspaceProposal(event).catch((error) => {
          dependencies.onAsyncError(error, event);
        });
      }
    }),
    center.subscribe("workspace.editor_mutation", (event) => {
      dependencies.stageAgentEditProposal(event);
    }),
    center.subscribe("academic.workspace_mutation", (event) => {
      dependencies.stageAcademicWorkspaceProposal?.(event);
    }),
    center.subscribe("library.structure_proposal", (event) => {
      dependencies.stageLibraryStructureProposal?.(event);
    }),
    center.subscribe("library.editor_mutation", (event) => {
      dependencies.stageLibraryEditProposal(event);
    }),
    center.subscribe("workspace.stage_selection", (event) => {
      dependencies.navigateToWorkspaceStage(event);
    }),
    center.subscribe("externalControl.resource_changed", (event) => {
      if (event.payload.domain === "agent_team") return;
      void dependencies
        .refreshAfterExternalChange?.()
        .catch((error) => dependencies.onAsyncError(error, event));
    }),
    center.subscribeAll((event) => {
      for (const conversation of dependencies.allConversations()) {
        conversation.handleEvent(event);
      }
    }),
    center.subscribeAll((event) => {
      if (
        event.type === "agent.message_completed" ||
        event.type === "agent.error"
      ) {
        dependencies.scheduleQueuedAgentEdits(
          (queued) =>
            queued.sessionId === event.payload.sessionId &&
            queued.runId === event.payload.runId
        );
      }
    }),
    // Independent of the routes above: it only shows a toast.
    subscribeNotificationBlockedToast(center)
  ];
  let disposed = false;

  return () => {
    if (disposed) return;
    disposed = true;
    for (let index = disposers.length - 1; index >= 0; index -= 1) {
      disposers[index]?.();
    }
  };
}

export function startNativeWorkspaceSystemEvents(
  center: SystemEventCenter,
  dependencies: Omit<WorkspaceSystemEventRouteDependencies, "onAsyncError"> &
    Partial<Pick<WorkspaceSystemEventRouteDependencies, "onAsyncError">>
): () => void {
  const removeRoutes = registerWorkspaceSystemEventRoutes(center, {
    ...dependencies,
    onAsyncError:
      dependencies.onAsyncError ??
      ((error) => {
        console.error(
          "DeepWrite long workspace proposal event could not be handled:",
          error
        );
      })
  });
  const removeNative = deepwriteApi()?.events.subscribe((event) => {
    center.publish(event);
  });
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    removeNative?.();
    removeRoutes();
  };
}
