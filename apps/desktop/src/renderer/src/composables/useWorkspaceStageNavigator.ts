import type { SystemEventEnvelope } from "@deepwrite/contracts";
import type { Ref } from "vue";
import type { WorkspaceDocument } from "../types/workspace";

interface WorkspaceStageConversation {
  acceptsRunEvent(sessionId: string, runId: string): boolean;
}

export function useWorkspaceStageNavigator(options: {
  conversations(): readonly WorkspaceStageConversation[];
  documents: Readonly<Ref<readonly WorkspaceDocument[]>>;
  selectedResourceId: Ref<string>;
  activeCreationResourceId: Ref<string>;
  revealTextPane(): void;
}) {
  return (
    event: Extract<SystemEventEnvelope, { type: "workspace.stage_selection" }>
  ): void => {
    const sourceConversation = options
      .conversations()
      .find((conversation) =>
        conversation.acceptsRunEvent(
          event.payload.sessionId,
          event.payload.runId
        )
      );
    const target = options.documents.value.find(
      (document) =>
        document.workspaceId === event.payload.workspaceId &&
        document.stageId === event.payload.stageId
    );
    if (!sourceConversation || !target) return;
    options.selectedResourceId.value = target.id;
    options.activeCreationResourceId.value = target.id;
    options.revealTextPane();
  };
}
