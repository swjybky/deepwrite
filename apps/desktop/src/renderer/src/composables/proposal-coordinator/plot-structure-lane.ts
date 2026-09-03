import type {
  Book,
  DeepWriteApi,
  SystemEventEnvelope
} from "@deepwrite/contracts";
import { createShortWorkspaceContentRevision } from "@deepwrite/contracts";
import type { AgentEditProposal } from "../../types/conversation";
import { agentEditProposalId } from "../../utils/agentEditReview";
import { buildAgentTextDiff } from "../../utils/agentTextDiff";
import type { AgentConversationController } from "../useAgentConversation";

type WorkspaceEditorMutationEvent = Extract<
  SystemEventEnvelope,
  { type: "workspace.editor_mutation" }
>;

interface PlotStructureLaneNotifications {
  error(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
}

interface PlotStructureLaneInput {
  api(): DeepWriteApi | undefined;
  catalogBook(bookId: string): Book | undefined;
  loadCatalogSnapshot(): Promise<unknown>;
  isCatalogConflict(error: unknown): boolean;
  isWorkspaceAccepting(workspaceId: string): boolean;
  setWorkspaceAccepting(workspaceId: string, accepting: boolean): void;
  notifications: PlotStructureLaneNotifications;
  queueAgentEdit(
    conversation: AgentConversationController,
    sessionId: string,
    runId: string,
    proposalId: string,
    automatic: boolean,
    scheduleImmediately: boolean
  ): void;
}

export function plotStructureCreationStageId(
  proposalId: string,
  provisionalStageId: string
): string {
  const proposalRevision = createShortWorkspaceContentRevision(proposalId);
  const safeProposalId = proposalId.replace(/[^A-Za-z0-9._:-]/gu, "-");
  return `plot-stage-agent:${proposalRevision}:${safeProposalId.slice(0, 20)}:${safeProposalId.slice(-20)}:${provisionalStageId.slice(-24)}`;
}

export function createPlotStructureProposalLane(input: PlotStructureLaneInput) {
  function stage(
    event: WorkspaceEditorMutationEvent,
    conversation: AgentConversationController,
    approvalMode: NonNullable<AgentEditProposal["approvalMode"]>
  ): boolean {
    const target = event.payload.mutationTarget;
    if (target?.kind !== "plot-structure") return false;
    const book = input.catalogBook(event.payload.workspaceId);
    if (!book) {
      const message = "目标作品已不可用，剧情结构变更未进入审阅。";
      conversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      input.notifications.warning(message);
      return true;
    }
    const mutation = target.mutation;
    const currentStage =
      mutation.type === "update"
        ? book.plotStages.find((stage) => stage.id === mutation.stageId)
        : undefined;
    if (mutation.type === "update" && !currentStage) {
      const message = "目标剧情结构已不存在，本次修改未进入审阅。";
      conversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      input.notifications.warning(message);
      return true;
    }
    const documentId = `plot-structure:${event.payload.toolCallId}`;
    const proposalId = agentEditProposalId(
      event.payload.runId,
      event.payload.workspaceId,
      event.payload.stageId,
      documentId
    );
    if (conversation.getEditProposal(event.payload.runId, proposalId)) {
      return true;
    }
    const beforeText =
      mutation.type === "update"
        ? `${currentStage!.title}\n${currentStage!.description}`
        : "";
    const proposedText =
      mutation.type === "create"
        ? `${mutation.title}\n${mutation.description}${mutation.content ? `\n\n${mutation.content}` : ""}`
        : `${mutation.title}\n${mutation.description}`;
    const diff = buildAgentTextDiff(beforeText, proposedText);
    const proposal: AgentEditProposal = {
      id: proposalId,
      laneId: proposalId,
      generation: 1,
      approvalMode,
      sourceBaseRevision: event.payload.baseRevision,
      runId: event.payload.runId,
      workspaceId: event.payload.workspaceId,
      stageId: event.payload.stageId,
      documentId,
      title:
        mutation.type === "create"
          ? `创建剧情结构：${mutation.title}`
          : `修改剧情结构：${currentStage!.title} → ${mutation.title}`,
      summary: event.payload.summary,
      status: "pending",
      baseRevision: event.payload.baseRevision,
      proposedRevision: createShortWorkspaceContentRevision(proposedText),
      proposedText,
      toolCallIds: [event.payload.toolCallId],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      ...(diff.truncated ? { truncated: true } : {}),
      createdAt: event.timestamp,
      updatedAt: event.timestamp,
      ...(mutation.type === "update"
        ? {
            discardSnapshot: {
              beforeText,
              beforeTitle: currentStage!.title,
              beforeDescription: currentStage!.description
            }
          }
        : {}),
      plotStructureTarget: { mutation }
    };
    conversation.upsertEditProposal(event.payload.runId, proposal);
    if (approvalMode === "auto-approve") {
      input.queueAgentEdit(
        conversation,
        event.payload.sessionId,
        event.payload.runId,
        proposalId,
        true,
        true
      );
    }
    return true;
  }

  async function accept(
    conversation: AgentConversationController,
    request: { runId: string; proposalId: string },
    proposal: AgentEditProposal,
    automatic: boolean,
    reserved = false
  ): Promise<void> {
    if (
      (proposal.status === "accepting" && !reserved) ||
      proposal.status === "accepted" ||
      proposal.status === "rejected" ||
      proposal.status === "conflict"
    ) {
      return;
    }
    const target = proposal.plotStructureTarget;
    const book = input.catalogBook(proposal.workspaceId);
    const api = input.api();
    if (!target || !book || !api) {
      const message = "剧情结构目标已不可用，无法应用本次变更。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      input.notifications.warning(message);
      return;
    }
    if (input.isWorkspaceAccepting(proposal.workspaceId)) {
      const message = automatic
        ? "作品正在保存其他内容，自动创建剧情结构已暂停，请稍后重试。"
        : "同一作品正在保存其他修改，请稍候再接受";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: automatic ? "error" : "pending",
        statusMessage: message
      });
      input.notifications.info(message);
      return;
    }

    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic
        ? "正在自动批准并保存剧情结构…"
        : "正在保存剧情结构…"
    });
    input.setWorkspaceAccepting(proposal.workspaceId, true);
    try {
      const mutation = target.mutation;
      const createdStageId =
        mutation.type === "create"
          ? plotStructureCreationStageId(
              proposal.id,
              mutation.provisionalStageId
            )
          : undefined;
      const updated = await api.catalog.mutatePlotStructure({
        bookId: proposal.workspaceId,
        // The catalog command still requires this legacy field, but force makes
        // the mutation operate on the latest serialized project state.
        baseProjectRevision: book.projectRevision ?? 0,
        force: true,
        mutation:
          mutation.type === "create"
            ? {
                type: "create",
                stageId: createdStageId!,
                title: mutation.title,
                description: mutation.description
              }
            : {
                type: "update",
                stageId: mutation.stageId,
                title: mutation.title,
                description: mutation.description
              }
      });
      if (mutation.type === "create") {
        const createdStage = updated.plotStages.find(
          ({ id }) => id === createdStageId
        );
        const createdDocument = createdStage
          ? updated.documents.find(
              (document) => document.id === createdStage.id
            )
          : undefined;
        if (!createdStage || !createdDocument) {
          throw new Error("剧情结构已创建，但无法定位对应正文文件。");
        }
        const intendedContent = mutation.content.trim() ? mutation.content : "";
        if (
          createdDocument.content.trim() &&
          createdDocument.content !== intendedContent
        ) {
          throw new Error("新建剧情结构正文已有不同内容，未覆盖现有文件。");
        }
        if (createdDocument.content !== intendedContent) {
          await api.catalog.saveDocument({
            bookId: proposal.workspaceId,
            documentId: createdDocument.id,
            content: intendedContent,
            force: true
          });
        }
      }
      await input.loadCatalogSnapshot();
      if (mutation.type === "create") {
        const refreshed = input.catalogBook(proposal.workspaceId);
        const refreshedStage = refreshed?.plotStages.find(
          ({ id }) => id === createdStageId
        );
        const refreshedDocument = refreshed?.documents.find(
          ({ id }) => id === createdStageId
        );
        const intendedContent = mutation.content.trim() ? mutation.content : "";
        if (
          !refreshedStage ||
          !refreshedDocument ||
          refreshedDocument.content !== intendedContent
        ) {
          throw new Error(
            "剧情结构已创建，但刷新工作区后仍无法定位结构正文；请重试以完成正文映射。"
          );
        }
      }
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        ...(updated.projectRevision === undefined
          ? {}
          : {
              discardSnapshot: {
                ...proposal.discardSnapshot,
                appliedProjectRevision: updated.projectRevision
              }
            }),
        statusMessage:
          mutation.type === "create"
            ? automatic
              ? `已自动批准并创建剧情结构“${mutation.title}”，结构正文已一并保存。`
              : `已创建剧情结构“${mutation.title}”，结构正文已一并保存。`
            : automatic
              ? `已自动批准并更新剧情结构“${mutation.title}”。`
              : `已更新剧情结构“${mutation.title}”。`
      });
      if (!automatic) {
        input.notifications.success(
          mutation.type === "create"
            ? `已创建剧情结构“${mutation.title}”`
            : `已更新剧情结构“${mutation.title}”`
        );
      }
    } catch (error: unknown) {
      await input.loadCatalogSnapshot().catch(() => undefined);
      const message =
        error instanceof Error ? error.message : "剧情结构保存失败。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: input.isCatalogConflict(error) ? "conflict" : "error",
        statusMessage: message
      });
      input.notifications.error(message);
    } finally {
      input.setWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  return { stage, accept };
}
