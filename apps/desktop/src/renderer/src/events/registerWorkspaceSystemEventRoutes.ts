import type { SystemEventEnvelope } from "@deepwrite/contracts";
import type { SystemEventCenter } from "./systemEventCenter";

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
  learningImitation: {
    handleEvent(event: SystemEventEnvelope): void;
  };
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
  stageAgentEditProposal(event: EventOf<"workspace.editor_mutation">): void;
  stageLibraryEditProposal(event: EventOf<"library.editor_mutation">): void;
  navigateToWorkspaceStage(event: EventOf<"workspace.stage_selection">): void;
  notifyContextCompacted(event: EventOf<"agent.context_compacted">): void;
  /** A manual `/compact` that produced no summary, with the reason. */
  notifyCompactionFailed(event: EventOf<"agent.compaction_failed">): void;
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
  const disposers = [
    center.subscribeAll((event) => {
      dependencies.learningImitation.handleEvent(event);
    }),
    center.subscribeAll((event) => {
      dependencies.longBookAnalysis.handleEvent(event);
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
      } else {
        void dependencies.handleLongWorkspaceProposal(event).catch((error) => {
          dependencies.onAsyncError(error, event);
        });
      }
    }),
    center.subscribe("workspace.editor_mutation", (event) => {
      dependencies.stageAgentEditProposal(event);
    }),
    center.subscribe("library.editor_mutation", (event) => {
      dependencies.stageLibraryEditProposal(event);
    }),
    center.subscribe("workspace.stage_selection", (event) => {
      dependencies.navigateToWorkspaceStage(event);
    }),
    center.subscribe("agent.context_compacted", (event) => {
      dependencies.notifyContextCompacted(event);
    }),
    center.subscribe("agent.compaction_failed", (event) => {
      dependencies.notifyCompactionFailed(event);
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
    })
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
