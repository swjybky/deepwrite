import { nextTick, type Ref } from "vue";
import {
  LongWorkspaceOperationBatchSchema,
  type LongBookSummary,
  type LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import type { AgentEditProposal } from "../../types/conversation";
import {
  replaceLongBookSummary,
  resolveLongWorkspaceApi
} from "../../types/longWorkspace";
import { findLongWorldbuildingFile } from "../../utils/longWorldbuildingFiles";
import type { AgentConversationController } from "../useAgentConversation";
import type { ProposalCoordinatorNotifications } from "./types";
import {
  holdLongProposalForManualReview,
  isLongImpactMismatch,
  moveLongProposalToManualReview,
  previewLongProposalImpact
} from "./long-impact-approval";
import { refreshSavedLongProposal } from "./refresh-saved-long-proposal";

interface AgentEditReviewRequest {
  runId: string;
  proposalId: string;
  decision: "accept" | "reject";
}
interface WorldbuildingLaneOptions {
  acceptingAgentEditWorkspaceIds: Ref<Set<string>>;
  setAgentEditWorkspaceAccepting(workspaceId: string, accepting: boolean): void;
  activeLongBookId: Ref<string | null>;
  longBooks: Ref<readonly LongBookSummary[]>;
  saveActiveLongEditorChanges(): Promise<boolean>;
  refreshLongProposalWorkspace(bookId: string): Promise<boolean>;
  removeQueuedAgentEdit(
    conversation: AgentConversationController,
    runId: string,
    proposalId: string
  ): void;
  uiMessage: ProposalCoordinatorNotifications;
}

export function createLongWorldbuildingProposalLane(
  options: WorldbuildingLaneOptions
) {
  const {
    acceptingAgentEditWorkspaceIds,
    setAgentEditWorkspaceAccepting,
    activeLongBookId,
    longBooks,
    saveActiveLongEditorChanges,
    refreshLongProposalWorkspace,
    removeQueuedAgentEdit,
    uiMessage
  } = options;
  async function acceptLongWorldbuildingFileProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean
  ): Promise<void> {
    const target = proposal.longWorldbuildingTarget;
    const api = resolveLongWorkspaceApi();
    if (!target || !api) {
      const message = "长篇世界观文件服务当前不可用。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? "检测到本书正在保存其他内容，实时自动落盘已暂停，请稍后重试。"
        : "同一本书正在保存其他修改，请稍候再接受";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: automatic ? "error" : "pending",
        statusMessage: message
      });
      uiMessage.info(message);
      return;
    }

    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage:
        target.file.operation === "create"
          ? automatic
            ? "正在自动批准并创建世界观文件…"
            : "正在创建世界观文件…"
          : automatic
            ? "正在自动批准并保存世界观文件…"
            : "正在保存世界观文件…"
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    let applied = false;
    let attemptedBatch: LongWorkspaceOperationBatch | undefined;
    try {
      if (activeLongBookId.value === target.bookId) {
        await nextTick();
        if (!(await saveActiveLongEditorChanges())) {
          throw new Error("当前长篇编辑内容尚未保存，未覆盖世界观文件。");
        }
      }
      const latest = await api.getWorkspaceIndex({
        bookId: target.bookId
      });
      const currentFile = findLongWorldbuildingFile(
        latest.workspaceIndex.worldbuilding,
        target.file.fileId
      );
      if (target.file.operation === "create") {
        if (currentFile) {
          const message = "世界观目录已存在同一文件，未重复创建。";
          conversation.updateEditProposal(request.runId, request.proposalId, {
            status: "conflict",
            statusMessage: message
          });
          uiMessage.warning(message);
          return;
        }
      } else if (!currentFile) {
        const message = "目标世界观文件已经不存在，无法保存本次修改。";
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "conflict",
          statusMessage: message
        });
        await refreshLongProposalWorkspace(target.bookId);
        uiMessage.warning(message);
        return;
      }

      const batch = target.expectedImpact
        ? LongWorkspaceOperationBatchSchema.parse(target.batch)
        : LongWorkspaceOperationBatchSchema.parse({
            ...target.batch,
            operations: (() => {
              const nextOrderByCategory = new Map<string, number>();
              return target.batch.operations.map((operation) => {
                if (operation.type !== "worldbuildingItem.create") {
                  return operation;
                }
                const category = latest.workspaceIndex.worldbuilding.find(
                  ({ id }) => id === operation.categoryId
                );
                if (!category || category.format !== "list") {
                  throw new Error(
                    "世界观文件的目标分类已不存在或不再是列表型。"
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
              });
            })()
          });
      attemptedBatch = batch;
      let expectedImpact = target.expectedImpact;
      if (!expectedImpact) {
        expectedImpact = await previewLongProposalImpact(
          api,
          target.bookId,
          batch,
          "世界观文件"
        );
      }
      if (
        holdLongProposalForManualReview({
          automatic,
          hadExpectedImpact: Boolean(target.expectedImpact),
          batch,
          confirmation: expectedImpact,
          conversation,
          runId: request.runId,
          proposalId: request.proposalId,
          patch: {
            longWorldbuildingTarget: { ...target, batch, expectedImpact }
          },
          statusMessage:
            "已读取本次文件与关联影响，请核对下方影响后再次确认保存。",
          notificationMessage: "请核对世界观文件及关联影响后再次确认保存",
          removeQueued: removeQueuedAgentEdit,
          notify: uiMessage.info
        })
      ) {
        return;
      }
      const result = await api.applyOperations({
        bookId: target.bookId,
        batch: LongWorkspaceOperationBatchSchema.parse({
          ...batch,
          expectedImpact
        })
      });
      applied = true;
      longBooks.value = replaceLongBookSummary(longBooks.value, result.summary);
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage:
          target.file.operation === "create"
            ? automatic
              ? "已自动批准并创建世界观文件。"
              : "已创建世界观文件并保存到本地 Markdown。"
            : `${automatic ? "已自动批准并" : "已接受并"}保存到本地 Markdown。`
      });
      void refreshSavedLongProposal({
        refresh: () => refreshLongProposalWorkspace(target.bookId),
        warn: uiMessage.warning
      });
      if (!automatic) {
        uiMessage.success(
          target.file.operation === "create"
            ? "已创建世界观文件"
            : "已接受并保存世界观文件"
        );
      }
    } catch (error: unknown) {
      let currentError = error;
      if (
        !applied &&
        target.expectedImpact &&
        attemptedBatch &&
        isLongImpactMismatch(error)
      ) {
        try {
          const expectedImpact = await previewLongProposalImpact(
            api,
            target.bookId,
            attemptedBatch,
            "世界观文件"
          );
          moveLongProposalToManualReview({
            conversation,
            runId: request.runId,
            proposalId: request.proposalId,
            patch: {
              longWorldbuildingTarget: {
                ...target,
                batch: attemptedBatch,
                expectedImpact
              }
            },
            statusMessage:
              "关联影响已变化，已更新下方影响；请重新核对并再次确认保存。",
            notificationMessage: "世界观文件的关联影响已变化，请重新确认",
            removeQueued: removeQueuedAgentEdit,
            notify: uiMessage.warning
          });
          return;
        } catch (previewError: unknown) {
          currentError = previewError;
        }
      }
      const message =
        currentError instanceof Error
          ? currentError.message
          : "保存世界观文件失败，原文件保持不变。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: applied ? "accepted" : "error",
        statusMessage: applied
          ? `世界观文件已经保存，但刷新失败：${message}`
          : message
      });
      if (applied) {
        uiMessage.warning(`世界观文件已经保存，但刷新失败：${message}`);
      } else {
        uiMessage.error(message);
      }
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  return { accept: acceptLongWorldbuildingFileProposal };
}
