import { hydrateLibraryProposalDocument } from "./library-hydration";
import type { ProposalCoordinatorContext } from "../useProposalCoordinator";
import type { AgentConversationController } from "../useAgentConversation";
import type { AgentEditProposal } from "../../types/conversation";
import type { WorkspaceDocument } from "../../types/workspace";
import {
  createShortWorkspaceContentRevision,
  type SystemEventEnvelope
} from "@deepwrite/contracts/renderer";
import {
  agentEditProposalId,
  expectedMutationBaseRevision
} from "../../utils/agentEditReview";
import { buildAgentTextDiff } from "../../utils/agentTextDiff";
import { textEditDiscardSnapshot } from "../../utils/acceptedEditDiscard";
type LibraryEditorMutationEvent = Extract<
  SystemEventEnvelope,
  { type: "library.editor_mutation" }
>;
export function createLibraryProposalStager(
  context: ProposalCoordinatorContext,
  queueAgentEdit: (
    conversation: AgentConversationController,
    sessionId: string,
    runId: string,
    proposalId: string,
    ready: boolean,
    automatic: boolean
  ) => void,
  disposed: () => boolean,
  drainSaves: () => Promise<void> = async () => {}
) {
  const { notifications: uiMessage } = context;
  const { findCatalogLibrary } = context.catalog;
  const {
    liveDocuments: liveWorkspaceDocuments,
    rememberWorkspaceMutationEvent
  } = context.editor;
  const { all: allConversations } = context.conversations;
  let chain: Promise<void> = Promise.resolve();
  async function stage(event: LibraryEditorMutationEvent): Promise<void> {
    if (disposed()) return;
    await drainSaves();
    if (disposed()) return;
    const sourceConversation = allConversations().find((conversation) =>
      conversation.acceptsRunEvent(event.payload.sessionId, event.payload.runId)
    );
    if (!sourceConversation) return;
    if (event.payload.operation === "create" && event.payload.creationId) {
      const payload = event.payload;
      const id = agentEditProposalId(
        payload.runId,
        `library:${payload.domain}:${payload.libraryId}`,
        "library",
        `library-create:${payload.creationId}`
      );
      const previous = sourceConversation.getEditProposal(payload.runId, id);
      if (previous?.status === "accepted" && previous.libraryTarget?.entryId) {
        event = {
          ...event,
          payload: {
            ...payload,
            operation: "edit",
            entryId: previous.libraryTarget.entryId,
            documentId: previous.documentId
          }
        };
      }
    }
    await hydrateLibraryProposalDocument(context, event, disposed);
    if (disposed()) return;
    const runApprovalMode =
      sourceConversation.approvalModeForRun(
        event.payload.sessionId,
        event.payload.runId
      ) ?? "request-approval";

    const library = findCatalogLibrary(
      event.payload.domain,
      event.payload.libraryId
    );
    const libraryReadOnly =
      !library ||
      (event.payload.domain === "skill" &&
        "isBuiltin" in library &&
        library.isBuiltin);
    let target: WorkspaceDocument | undefined;
    if (event.payload.operation === "edit") {
      const editPayload = event.payload;
      target = liveWorkspaceDocuments.value.find(
        (document) =>
          document.id === editPayload.documentId &&
          document.domain === editPayload.domain &&
          document.libraryId === editPayload.libraryId &&
          document.catalogEntryId === editPayload.entryId
      );
    } else if (event.payload.operation === "edit-overview") {
      const overviewPayload = event.payload;
      target = liveWorkspaceDocuments.value.find(
        (document) =>
          document.id === overviewPayload.documentId &&
          document.domain === overviewPayload.domain &&
          document.libraryId === overviewPayload.libraryId &&
          document.catalogLibraryField === "overview"
      );
    }
    if (
      libraryReadOnly ||
      (event.payload.operation !== "create" && (!target || target.readOnly))
    ) {
      const message = "目标资料库或条目不可写，本次智能体变更未进入审阅。";
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      uiMessage.warning(message);
      return;
    }

    const scopeId = `library:${event.payload.domain}:${event.payload.libraryId}`;
    const documentId =
      event.payload.operation !== "create"
        ? event.payload.documentId
        : `library-create:${event.payload.toolCallId}`;
    const proposalId = agentEditProposalId(
      event.payload.runId,
      scopeId,
      "library",
      event.payload.creationId
        ? `library-create:${event.payload.creationId}`
        : documentId
    );
    const previous = sourceConversation.getEditProposal(
      event.payload.runId,
      proposalId
    );
    if (previous?.toolCallIds.includes(event.payload.toolCallId)) return;
    const existing =
      previous?.status === "pending" || previous?.status === "error"
        ? previous
        : undefined;

    const currentText = target?.content ?? "";
    const currentRevision = createShortWorkspaceContentRevision(currentText);
    const expectedBaseRevision = expectedMutationBaseRevision(
      existing,
      currentText
    );
    if (
      event.payload.baseRevision !== expectedBaseRevision ||
      (existing !== undefined && currentRevision !== existing.baseRevision)
    ) {
      const message =
        "资料库内容版本已变化，本次智能体变更未进入审阅，也没有覆盖你的最新编辑。";
      if (existing) {
        sourceConversation.updateEditProposal(event.payload.runId, proposalId, {
          status: "conflict",
          statusMessage: message,
          updatedAt: event.timestamp
        });
      }
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      uiMessage.warning(message);
      return;
    }

    const proposedText = event.payload.text;
    const proposedRevision = createShortWorkspaceContentRevision(proposedText);
    const diff = buildAgentTextDiff(currentText, proposedText);
    const noChanges =
      event.payload.operation !== "create" &&
      proposedRevision === (existing?.baseRevision ?? currentRevision) &&
      event.payload.title === target?.title;
    const proposal: AgentEditProposal = {
      id: proposalId,
      approvalMode: runApprovalMode,
      runId: event.payload.runId,
      workspaceId: scopeId,
      stageId: "library",
      documentId,
      title: event.payload.title,
      summary: event.payload.summary,
      status: noChanges ? "accepted" : "pending",
      baseRevision: existing?.baseRevision ?? event.payload.baseRevision,
      proposedRevision,
      ...(noChanges ? {} : { proposedText }),
      toolCallIds: [
        ...new Set([...(existing?.toolCallIds ?? []), event.payload.toolCallId])
      ],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      ...(diff.truncated ? { truncated: true } : {}),
      ...(noChanges
        ? { statusMessage: "资料库内容没有实际变化，无需保存。" }
        : {}),
      createdAt: existing?.createdAt ?? event.timestamp,
      updatedAt: event.timestamp,
      ...(event.payload.operation === "create"
        ? {}
        : {
            discardSnapshot: textEditDiscardSnapshot(
              existing,
              existing?.status === "pending" || existing?.status === "error",
              currentText,
              target?.title ?? event.payload.title
            )
          }),
      libraryTarget: {
        libraryTitle: library.title,
        ...(event.payload.managementScope
          ? { managementScope: event.payload.managementScope }
          : {}),
        operation: event.payload.operation,
        domain: event.payload.domain,
        libraryId: event.payload.libraryId,
        ...(event.payload.operation === "edit-overview"
          ? {}
          : { stageId: event.payload.stageId }),
        ...(event.payload.baseProjectRevision === undefined
          ? {}
          : { baseProjectRevision: event.payload.baseProjectRevision }),
        ...(event.payload.operation === "edit"
          ? { entryId: event.payload.entryId }
          : {})
      }
    };
    sourceConversation.upsertEditProposal(event.payload.runId, proposal);
    if (!noChanges && runApprovalMode === "auto-approve") {
      queueAgentEdit(
        sourceConversation,
        event.payload.sessionId,
        event.payload.runId,
        proposalId,
        true,
        true
      );
    }
  }

  return (event: LibraryEditorMutationEvent): Promise<void> => {
    if (!rememberWorkspaceMutationEvent(event.id)) return chain;
    chain = chain
      .then(() => stage(event))
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : "资料库变更未能进入审阅。";
        allConversations()
          .find((conversation) =>
            conversation.acceptsRunEvent(
              event.payload.sessionId,
              event.payload.runId
            )
          )
          ?.markToolConflict(
            event.payload.runId,
            event.payload.toolCallId,
            message
          );
        uiMessage.warning(message);
      });
    return chain;
  };
}
