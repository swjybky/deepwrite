import type { AgentEditProposal } from "../../types/conversation";
import type { AgentConversationController } from "../useAgentConversation";
import {
  createShortWorkspaceContentRevision,
  type CharacterStructureMutation
} from "@deepwrite/contracts";
import { agentEditProposalId } from "../../utils/agentEditReview";
import { buildAgentTextDiff } from "../../utils/agentTextDiff";
import { saveCreatedCharacterContent } from "./creation-content";
import type {
  AgentEditReviewRequest,
  ProposalLaneContext,
  WorkspaceEditorMutationEvent
} from "./types";

export function createCharacterStructureLane(ctx: ProposalLaneContext) {
  const {
    api,
    uiMessage,
    catalogBook,
    loadCatalogSnapshot,
    isCatalogConflict,
    liveWorkspaceDocuments,
    setAgentEditWorkspaceAccepting
  } = ctx;

  const queueAgentEdit: ProposalLaneContext["queueAgentEdit"] = (...args) =>
    ctx.queueAgentEdit(...args);

  function findPendingCharacterCreationForProvisional(
    conversation: AgentConversationController,
    runId: string,
    itemId: string
  ): AgentEditProposal | undefined {
    return conversation.listEditProposals(runId).find((proposal) => {
      const mutation = proposal.characterStructureTarget?.mutation;
      return Boolean(
        mutation?.type === "createItem" &&
        mutation.itemId === itemId &&
        (proposal.status === "pending" ||
          proposal.status === "accepting" ||
          proposal.status === "error")
      );
    });
  }

  async function acceptCharacterStructureProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean,
    reserved = false
  ): Promise<void> {
    if (
      (proposal.status === "accepting" && !reserved) ||
      proposal.status === "accepted" ||
      proposal.status === "rejected" ||
      proposal.status === "conflict"
    )
      return;
    const target = proposal.characterStructureTarget;
    const book = catalogBook(proposal.workspaceId);
    const currentApi = api();
    if (!target || !book || !currentApi) {
      const message = "人物结构目标已不可用，无法应用本次变更。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    const createdItemId =
      target.mutation.type === "createItem"
        ? target.mutation.itemId
        : undefined;
    if (target.mutation.type === "createItem" && !createdItemId) {
      const message = "人物创建缺少稳定条目 id，无法完成顺序写入。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic ? "正在自动保存人物结构…" : "正在保存人物结构…"
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    try {
      const updatedBook = await currentApi.catalog.mutateCharacterStructure({
        bookId: proposal.workspaceId,
        // The command schema still requires this legacy field. `force` makes
        // it metadata only, so a missing or stale project revision cannot
        // reject an agent write.
        baseProjectRevision: book.projectRevision ?? 0,
        force: true,
        mutation: target.mutation
      });
      if (
        target.mutation.type === "createItem" &&
        target.initialContent?.trim()
      ) {
        await saveCreatedCharacterContent(currentApi.catalog, {
          bookId: proposal.workspaceId,
          itemId: createdItemId!,
          currentContent:
            updatedBook.documents.find(({ id }) => id === createdItemId)
              ?.content ?? "",
          content: target.initialContent
        });
      }
      await loadCatalogSnapshot();
      if (
        createdItemId &&
        !liveWorkspaceDocuments.value.some(
          (document) =>
            document.workspaceId === proposal.workspaceId &&
            document.catalogDocumentId === createdItemId
        )
      ) {
        throw new Error(
          "人物条目已创建，但刷新工作区后仍无法定位人物文件；请重试以完成正文映射。"
        );
      }
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        ...(updatedBook.projectRevision === undefined
          ? {}
          : {
              discardSnapshot: {
                ...proposal.discardSnapshot,
                appliedProjectRevision: updatedBook.projectRevision
              }
            }),
        statusMessage: automatic
          ? "已自动批准并保存人物结构变更。"
          : "人物结构变更已保存到本地。"
      });
      if (!automatic) uiMessage.success("人物结构变更已保存");
    } catch (error) {
      await loadCatalogSnapshot();
      const message =
        error instanceof Error ? error.message : "人物结构变更保存失败。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: isCatalogConflict(error) ? "conflict" : "error",
        statusMessage: message
      });
      uiMessage.error(message);
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  function stageCharacterStructureProposal(
    event: WorkspaceEditorMutationEvent,
    sourceConversation: AgentConversationController,
    runApprovalMode: NonNullable<AgentEditProposal["approvalMode"]>
  ): boolean {
    const mutationTarget = event.payload.mutationTarget;
    if (mutationTarget?.kind === "character-structure") {
      const book = catalogBook(event.payload.workspaceId);
      if (!book || book.characterStructure.format !== "list") {
        const message = "当前人物结构不是条目样式，本次条目操作未进入审阅。";
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return true;
      }
      const source = mutationTarget.mutation;
      const currentUpdatedItem =
        source.type === "updateItem"
          ? book.characterStructure.items.find(({ id }) => id === source.itemId)
          : undefined;
      const previousItemTitle =
        currentUpdatedItem?.title ??
        (source.type === "updateItem" ? source.previousTitle : undefined);
      const mutation: CharacterStructureMutation =
        source.type === "createItem"
          ? {
              type: "createItem",
              title: source.title,
              itemId: source.provisionalItemId
            }
          : source.type === "updateItem"
            ? { type: "updateItem", itemId: source.itemId, title: source.title }
            : source.type === "moveItem"
              ? {
                  type: "moveItem",
                  itemId: source.itemId,
                  direction: source.direction
                }
              : { type: "deleteItem", itemId: source.itemId };
      const documentId = `character-structure:${event.payload.toolCallId}`;
      const proposalId = agentEditProposalId(
        event.payload.runId,
        event.payload.workspaceId,
        "character_design",
        documentId
      );
      if (sourceConversation.getEditProposal(event.payload.runId, proposalId)) {
        return true;
      }
      const beforeText =
        source.type === "deleteItem"
          ? source.deletedText
          : source.type === "updateItem"
            ? previousItemTitle!
            : "";
      const afterText =
        source.type === "deleteItem"
          ? ""
          : source.type === "updateItem"
            ? source.title
            : source.type === "createItem"
              ? source.title
              : event.payload.text;
      const diff = buildAgentTextDiff(beforeText, afterText);
      const proposal: AgentEditProposal = {
        id: proposalId,
        laneId: proposalId,
        generation: 1,
        approvalMode: runApprovalMode,
        sourceBaseRevision: event.payload.baseRevision,
        runId: event.payload.runId,
        workspaceId: event.payload.workspaceId,
        stageId: "character_design",
        documentId,
        title:
          source.type === "createItem"
            ? `创建人物条目：${source.title}`
            : source.type === "updateItem"
              ? `修改人物名称：${previousItemTitle} → ${source.title}`
              : source.type === "moveItem"
                ? `${source.direction === "up" ? "上移" : "下移"}人物条目：${source.title}`
                : `删除人物条目：${source.title}`,
        summary: event.payload.summary,
        status: "pending",
        baseRevision: event.payload.baseRevision,
        proposedRevision: createShortWorkspaceContentRevision(afterText),
        proposedText: afterText,
        toolCallIds: [event.payload.toolCallId],
        additions: diff.additions,
        deletions: diff.deletions,
        hunks: diff.hunks,
        ...(diff.truncated ? { truncated: true } : {}),
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
        ...(source.type === "updateItem"
          ? {
              discardSnapshot: {
                beforeText: previousItemTitle!,
                beforeTitle: previousItemTitle!
              }
            }
          : {}),
        characterStructureTarget: {
          mutation,
          ...(mutationTarget.initialContent
            ? { initialContent: mutationTarget.initialContent }
            : {})
        }
      };
      sourceConversation.upsertEditProposal(event.payload.runId, proposal);
      if (runApprovalMode === "auto-approve") {
        queueAgentEdit(
          sourceConversation,
          event.payload.sessionId,
          event.payload.runId,
          proposalId,
          true,
          true
        );
      }
      return true;
    }
    return false;
  }

  return {
    findPendingCharacterCreationForProvisional,
    acceptCharacterStructureProposal,
    stageCharacterStructureProposal
  };
}
