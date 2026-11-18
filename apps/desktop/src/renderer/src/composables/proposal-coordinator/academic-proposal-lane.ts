import {
  createAcademicCardDocumentId,
  createAcademicSectionDocumentId,
  createShortWorkspaceContentRevision,
  isProvisionalAcademicCardId,
  isProvisionalAcademicChapterId,
  isProvisionalAcademicSectionId,
  isProvisionalAcademicStageId,
  type AcademicMutationTarget,
  type AcademicWorkspaceMutationEventEnvelope
} from "@deepwrite/contracts/renderer";
import { formatError } from "../../i18n/errors";
import type { AgentEditProposal } from "../../types/conversation";
import { textEditDiscardSnapshot } from "../../utils/acceptedEditDiscard";
import {
  agentEditProposalGenerationId,
  latestAgentEditProposalInLane,
  resolveAgentEditProposalGeneration
} from "../../utils/agentEditReview";
import { buildAgentTextDiff } from "../../utils/agentTextDiff";
import type { AgentConversationController } from "../useAgentConversation";
import type { ProposalCoordinatorContext } from "../useProposalCoordinator";
import {
  resolveProposalApprovalMode,
  resolveShortProposalConversation
} from "./event-authorization";
import { shortAgentCheckedDocumentWrite } from "./short-direct-write";
import { conversationVersionOrigin } from "./version-origin";

interface AcademicRunProvisionalMap {
  cards: Map<string, string>;
  stages: Map<string, string>;
  chapters: Map<string, string>;
  sections: Map<string, string>;
}

function projectedAcademicDocId(bookId: string, catalogDocId: string): string {
  return ["catalog", "book-document", bookId, catalogDocId]
    .map((part) => encodeURIComponent(part))
    .join(":");
}

function isAcademicDeletion(target: AcademicMutationTarget): boolean {
  return (
    target.kind === "reference-card-delete" ||
    ("mutation" in target && target.mutation.type === "delete")
  );
}

function renderAcademicMutationPreview(target: AcademicMutationTarget): {
  laneSuffix: string;
  title: string;
  beforeText: string;
  proposedText: string;
  catalogDocumentId?: string;
} {
  switch (target.kind) {
    case "document-edit": {
      const metaHeader = target.cardMeta
        ? [
            target.cardMeta.citeKey
              ? `citeKey: ${target.cardMeta.citeKey}`
              : "",
            target.cardMeta.cardType
              ? `cardType: ${target.cardMeta.cardType}`
              : "",
            target.cardMeta.title ? `title: ${target.cardMeta.title}` : ""
          ]
            .filter(Boolean)
            .join(" | ")
        : "";
      return {
        laneSuffix: `doc:${target.catalogDocumentId}`,
        title: target.title,
        beforeText: target.beforeText,
        proposedText:
          metaHeader && target.text === target.beforeText
            ? `[卡片属性更新] ${metaHeader}\n\n${target.text}`
            : target.text,
        catalogDocumentId: target.catalogDocumentId
      };
    }
    case "reference-card-create": {
      const text = target.cards
        .map((card) =>
          [
            `[${card.citeKey}] ${card.title} (${card.cardType})`,
            card.content || "（初始正文为空）"
          ].join("\n")
        )
        .join("\n\n---\n\n");
      return {
        laneSuffix: `card-create:${target.cards.map((c) => c.provisionalCardId).join(",")}`,
        title:
          target.cards.length === 1
            ? `新建卡片 [${target.cards[0]!.citeKey}] ${target.cards[0]!.title}`
            : `批量新建 ${target.cards.length} 张文献/证据卡`,
        beforeText: "",
        proposedText: text
      };
    }
    case "reference-card-delete":
      return {
        laneSuffix: `card-delete:${target.cardId}`,
        title: `删除卡片 [${target.citeKey}] ${target.title}`,
        beforeText: target.deletedText || `[${target.citeKey}] ${target.title}`,
        proposedText: ""
      };
    case "framework-stage-mutation": {
      const m = target.mutation;
      if (m.type === "create") {
        return {
          laneSuffix: `stage-create:${m.provisionalStageId}`,
          title: `新建论证阶段：${m.title}`,
          beforeText: "",
          proposedText: [`说明：${m.description}`, m.content]
            .filter(Boolean)
            .join("\n\n")
        };
      }
      if (m.type === "update") {
        return {
          laneSuffix: `stage-meta:${m.stageId}`,
          title: `更新论证阶段：${m.title}`,
          beforeText: `${m.previousTitle}\n${m.previousDescription}`,
          proposedText: `${m.title}${m.enabled !== undefined ? `（${m.enabled ? "启用" : "停用"}）` : ""}\n${m.description}`,
          catalogDocumentId: m.stageId
        };
      }
      if (m.type === "move") {
        return {
          laneSuffix: `stage-move:${m.stageId}`,
          title: `移动论证阶段：${m.title}`,
          beforeText: m.title,
          proposedText: `${m.title}（${m.direction === "up" ? "上移" : "下移"}）`,
          catalogDocumentId: m.stageId
        };
      }
      return {
        laneSuffix: `stage-delete:${m.stageId}`,
        title: `删除论证阶段：${m.title}`,
        beforeText: m.deletedText || m.title,
        proposedText: ""
      };
    }
    case "chapter-mutation": {
      const m = target.mutation;
      if (m.type === "create") {
        return {
          laneSuffix: `chapter-create:${m.chapters.map((c) => c.provisionalChapterId).join(",")}`,
          title:
            m.chapters.length === 1
              ? `新建章：${m.chapters[0]!.title}`
              : `批量新建 ${m.chapters.length} 章`,
          beforeText: "",
          proposedText: m.chapters
            .map((c, idx) => `${idx + 1}. ${c.title}`)
            .join("\n")
        };
      }
      if (m.type === "rename") {
        return {
          laneSuffix: `chapter-rename:${m.chapterId}`,
          title: `重命名章：${m.title}`,
          beforeText: m.previousTitle,
          proposedText: m.title
        };
      }
      if (m.type === "move") {
        return {
          laneSuffix: `chapter-move:${m.chapterId}`,
          title: `移动章：${m.title}`,
          beforeText: m.title,
          proposedText: `${m.title}（${m.direction === "up" ? "上移" : "下移"}）`
        };
      }
      return {
        laneSuffix: `chapter-delete:${m.chapterId}`,
        title: `删除章：${m.title}`,
        beforeText: m.title,
        proposedText: "（删除章容器，保留下属小节）"
      };
    }
    case "section-mutation": {
      const m = target.mutation;
      if (m.type === "create") {
        const text = m.sections
          .map((sec, idx) =>
            [
              `${idx + 1}. ${sec.title}${sec.wordCountRequirement ? `（${sec.wordCountRequirement}）` : ""}`,
              sec.briefContent ? `[写作指引]\n${sec.briefContent}` : "",
              sec.bodyContent ? `[正文]\n${sec.bodyContent}` : "",
              sec.stateContent ? `[节末状态]\n${sec.stateContent}` : ""
            ]
              .filter(Boolean)
              .join("\n")
          )
          .join("\n\n---\n\n");
        return {
          laneSuffix: `section-create:${m.sections.map((s) => s.provisionalSectionId).join(",")}`,
          title:
            m.sections.length === 1
              ? `新建小节：${m.sections[0]!.title}`
              : `批量新建 ${m.sections.length} 个小节`,
          beforeText: "",
          proposedText: text
        };
      }
      if (m.type === "update") {
        return {
          laneSuffix: `section-meta:${m.sectionId}`,
          title: `更新小节属性：${m.title}`,
          beforeText: m.previousTitle,
          proposedText: [
            m.title,
            m.wordCountRequirement !== undefined
              ? `字数要求：${m.wordCountRequirement || "未设置"}`
              : "",
            m.direction ? `顺序：${m.direction === "up" ? "上移" : "下移"}` : ""
          ]
            .filter(Boolean)
            .join("\n"),
          catalogDocumentId: createAcademicSectionDocumentId(
            m.sectionId,
            "body"
          )
        };
      }
      return {
        laneSuffix: `section-delete:${m.sectionId}`,
        title: `删除小节：${m.title}`,
        beforeText: m.deletedText || m.title,
        proposedText: ""
      };
    }
  }
}

function provisionalIdsCreatedByTarget(
  target: AcademicMutationTarget
): string[] {
  if (target.kind === "reference-card-create") {
    return target.cards.map((card) => card.provisionalCardId);
  }
  if (
    target.kind === "framework-stage-mutation" &&
    target.mutation.type === "create"
  ) {
    return [target.mutation.provisionalStageId];
  }
  if (target.kind === "chapter-mutation" && target.mutation.type === "create") {
    return target.mutation.chapters.map(
      (chapter) => chapter.provisionalChapterId
    );
  }
  if (target.kind === "section-mutation" && target.mutation.type === "create") {
    return target.mutation.sections.map(
      (section) => section.provisionalSectionId
    );
  }
  return [];
}

function targetReferencesAnyProvisionalId(
  target: AcademicMutationTarget,
  provisionalIds: ReadonlySet<string>
): boolean {
  if (target.kind === "document-edit") {
    return provisionalIds.has(target.targetId);
  }
  if (target.kind === "reference-card-delete") {
    return provisionalIds.has(target.cardId);
  }
  if (
    target.kind === "framework-stage-mutation" &&
    target.mutation.type !== "create"
  ) {
    return provisionalIds.has(target.mutation.stageId);
  }
  if (target.kind === "chapter-mutation" && target.mutation.type !== "create") {
    return provisionalIds.has(target.mutation.chapterId);
  }
  if (target.kind === "section-mutation") {
    if (target.mutation.type === "create") {
      return target.mutation.sections.some(
        (sec) =>
          (typeof sec.chapterId === "string" &&
            provisionalIds.has(sec.chapterId)) ||
          (sec.afterSectionId !== undefined &&
            provisionalIds.has(sec.afterSectionId))
      );
    }
    return (
      provisionalIds.has(target.mutation.sectionId) ||
      (target.mutation.type === "update" &&
        ((typeof target.mutation.chapterId === "string" &&
          provisionalIds.has(target.mutation.chapterId)) ||
          (typeof target.mutation.afterSectionId === "string" &&
            provisionalIds.has(target.mutation.afterSectionId))))
    );
  }
  return false;
}

export function createAcademicProposalLane(
  context: ProposalCoordinatorContext,
  deps: {
    queueAgentEdit(
      conversation: AgentConversationController,
      sessionId: string,
      runId: string,
      proposalId: string,
      automatic: boolean,
      scheduleImmediately: boolean
    ): void;
  }
) {
  const provisionalByRun = new Map<string, AcademicRunProvisionalMap>();

  function getRunMap(runId: string): AcademicRunProvisionalMap {
    let entry = provisionalByRun.get(runId);
    if (!entry) {
      entry = {
        cards: new Map(),
        stages: new Map(),
        chapters: new Map(),
        sections: new Map()
      };
      provisionalByRun.set(runId, entry);
    }
    return entry;
  }

  function stageAcademicWorkspaceProposal(
    event: AcademicWorkspaceMutationEventEnvelope
  ): void {
    if (!context.editor.rememberWorkspaceMutationEvent(event.id)) return;
    const payload = event.payload;
    const conversation = resolveShortProposalConversation(context, event);
    if (!conversation) return;

    const approvalMode = resolveProposalApprovalMode(conversation, event);
    const preview = renderAcademicMutationPreview(payload.target);
    const laneId = `academic:${payload.workspaceId}:${preview.laneSuffix}`;
    const existingProposals = conversation.listEditProposals(payload.runId);
    const latestInLane = latestAgentEditProposalInLane(
      existingProposals,
      laneId
    );
    const generationInfo = resolveAgentEditProposalGeneration(
      laneId,
      payload.target.kind === "document-edit" ? latestInLane : undefined
    );
    const canUpdateLatestInPlace = generationInfo.coalescesExisting;
    const generation = canUpdateLatestInPlace
      ? generationInfo.generation
      : latestInLane
        ? (latestInLane.generation ?? 1) + 1
        : 1;
    const proposalId = canUpdateLatestInPlace
      ? generationInfo.id
      : agentEditProposalGenerationId(laneId, generation);
    const predecessorProposalId =
      !canUpdateLatestInPlace && latestInLane
        ? latestInLane.id
        : generationInfo.predecessorProposalId;

    const diff = buildAgentTextDiff(preview.beforeText, preview.proposedText);
    const documentId = preview.catalogDocumentId
      ? projectedAcademicDocId(payload.workspaceId, preview.catalogDocumentId)
      : `academic-proposal:${payload.workspaceId}:${payload.toolCallId}`;

    const baseRevision =
      payload.target.kind === "document-edit"
        ? payload.target.baseRevision
        : createShortWorkspaceContentRevision(preview.beforeText);
    const proposedRevision = createShortWorkspaceContentRevision(
      preview.proposedText
    );

    conversation.upsertEditProposal(payload.runId, {
      id: proposalId,
      laneId,
      generation,
      ...(predecessorProposalId ? { predecessorProposalId } : {}),
      approvalMode,
      runId: payload.runId,
      workspaceId: payload.workspaceId,
      stageId: "academic",
      documentId,
      title: preview.title,
      summary: payload.summary,
      status: "pending",
      baseRevision,
      proposedRevision,
      proposedText:
        payload.target.kind === "document-edit"
          ? payload.target.text
          : preview.proposedText,
      toolCallIds: [
        ...new Set([
          ...(canUpdateLatestInPlace && latestInLane
            ? latestInLane.toolCallIds
            : []),
          payload.toolCallId
        ])
      ],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      createdAt:
        canUpdateLatestInPlace && latestInLane
          ? latestInLane.createdAt
          : event.timestamp,
      updatedAt: event.timestamp,
      ...(payload.baseProjectRevision === undefined
        ? {}
        : { academicBaseProjectRevision: payload.baseProjectRevision }),
      academicMutationTarget: payload.target
    });

    if (approvalMode === "auto-approve") {
      deps.queueAgentEdit(
        conversation,
        payload.sessionId,
        payload.runId,
        proposalId,
        true,
        !conversation.isBusy.value
      );
    }
  }

  function handleAcademicProposalRejected(
    conversation: AgentConversationController,
    proposal: AgentEditProposal
  ): void {
    const target = proposal.academicMutationTarget;
    if (!target) return;
    const createdIds = provisionalIdsCreatedByTarget(target);
    if (!createdIds.length) return;
    const rejectedSet = new Set(createdIds);
    for (const candidate of conversation.listEditProposals(proposal.runId)) {
      if (
        candidate.id === proposal.id ||
        candidate.status !== "pending" ||
        !candidate.academicMutationTarget
      ) {
        continue;
      }
      if (
        targetReferencesAnyProvisionalId(
          candidate.academicMutationTarget,
          rejectedSet
        )
      ) {
        conversation.updateEditProposal(proposal.runId, candidate.id, {
          status: "conflict",
          proposedText: undefined,
          statusMessage:
            "前置新建对象提案已被拒绝，依赖该临时对象的修改无法应用。"
        });
      }
    }
  }

  async function acceptAcademicWorkspaceProposal(
    conversation: AgentConversationController,
    proposal: AgentEditProposal
  ): Promise<void> {
    const target = proposal.academicMutationTarget;
    const api = context.api();
    if (!target || !api) return;

    const bookId = proposal.workspaceId;
    const baseProjectRevision = proposal.academicBaseProjectRevision;
    if (isAcademicDeletion(target) && baseProjectRevision === undefined) {
      conversation.updateEditProposal(proposal.runId, proposal.id, {
        status: "conflict",
        statusMessage: "删除提案缺少原始作品版本，请基于最新内容重新生成。"
      });
      return;
    }
    const runMap = getRunMap(proposal.runId);
    const resolveCardId = (id: string): string | undefined =>
      isProvisionalAcademicCardId(id) ? runMap.cards.get(id) : id;
    const resolveStageId = (id: string): string | undefined =>
      isProvisionalAcademicStageId(id) ? runMap.stages.get(id) : id;
    const resolveChapterId = (id: string): string | undefined =>
      isProvisionalAcademicChapterId(id) ? runMap.chapters.get(id) : id;
    const resolveSectionId = (id: string): string | undefined =>
      isProvisionalAcademicSectionId(id) ? runMap.sections.get(id) : id;

    context.editor.setWorkspaceAccepting(bookId, true);
    conversation.updateEditProposal(proposal.runId, proposal.id, {
      status: "accepting"
    });

    try {
      const versionOrigin = conversationVersionOrigin(
        conversation,
        proposal.runId,
        proposal.summary
      );
      let nextDocumentId = proposal.documentId;
      let discardSnapshot: AgentEditProposal["discardSnapshot"] | undefined;

      if (target.kind === "document-edit") {
        let realCatalogDocId = target.catalogDocumentId;
        let realCardId: string | undefined;
        let wasProvisional = false;

        if (target.objectKind === "reference_card") {
          wasProvisional = isProvisionalAcademicCardId(target.targetId);
          realCardId = resolveCardId(target.targetId);
          if (!realCardId) {
            throw new Error("请先审阅并接受该文献/证据卡的新建提案。");
          }
          realCatalogDocId = createAcademicCardDocumentId(realCardId);
        } else if (target.objectKind === "framework_stage") {
          wasProvisional = isProvisionalAcademicStageId(target.targetId);
          const realStageId = resolveStageId(target.targetId);
          if (!realStageId) {
            throw new Error("请先审阅并接受该自定义论证阶段的新建提案。");
          }
          realCatalogDocId = realStageId;
        } else if (target.objectKind === "section") {
          wasProvisional = isProvisionalAcademicSectionId(target.targetId);
          const realSectionId = resolveSectionId(target.targetId);
          if (!realSectionId) {
            throw new Error("请先审阅并接受该正文小节的新建提案。");
          }
          realCatalogDocId = createAcademicSectionDocumentId(
            realSectionId,
            target.sectionDocument ?? "body"
          );
        }

        nextDocumentId = projectedAcademicDocId(bookId, realCatalogDocId);
        const currentDraft = context.editor.drafts.value[nextDocumentId];
        const draftAtAccept = currentDraft?.dirty ? undefined : currentDraft;
        if (target.cardMeta && realCardId) {
          await api.catalog.updateAcademicReferenceCard({
            bookId,
            cardId: realCardId,
            ...(target.cardMeta.citeKey
              ? { citeKey: target.cardMeta.citeKey }
              : {}),
            ...(target.cardMeta.cardType
              ? { cardType: target.cardMeta.cardType }
              : {}),
            ...(target.cardMeta.title ? { title: target.cardMeta.title } : {})
          });
        }

        const finalContent =
          proposal.userEditedText ?? proposal.proposedText ?? target.text;
        const saved = await api.catalog.saveDocument(
          wasProvisional
            ? {
                bookId,
                documentId: realCatalogDocId,
                content: finalContent,
                versionOrigin
              }
            : shortAgentCheckedDocumentWrite(
                {
                  bookId,
                  documentId: realCatalogDocId,
                  content: finalContent,
                  versionOrigin
                },
                target.baseRevision
              )
        );
        context.catalog.applyAcceptedDocumentLocally(
          {
            id: nextDocumentId,
            title: target.cardMeta?.title ?? target.title,
            content: finalContent
          },
          saved.projectRevision,
          draftAtAccept
        );
        discardSnapshot = {
          ...textEditDiscardSnapshot(
            proposal,
            false,
            target.beforeText,
            target.title
          ),
          appliedProjectRevision: saved.projectRevision
        };
      } else if (target.kind === "reference-card-create") {
        let lastDocId: string | undefined;
        for (const card of target.cards) {
          const existingMapped = runMap.cards.get(card.provisionalCardId);
          if (existingMapped) {
            lastDocId = createAcademicCardDocumentId(existingMapped);
            continue;
          }
          const created = await api.catalog.createAcademicReferenceCard({
            bookId,
            citeKey: card.citeKey,
            cardType: card.cardType,
            title: card.title,
            content: card.content,
            versionOrigin
          });
          runMap.cards.set(card.provisionalCardId, created.card.id);
          lastDocId = created.card.document.id;
        }
        if (lastDocId) {
          nextDocumentId = projectedAcademicDocId(bookId, lastDocId);
        }
      } else if (target.kind === "reference-card-delete") {
        const realCardId = resolveCardId(target.cardId);
        if (!realCardId) {
          throw new Error("请先审阅并接受该文献/证据卡的新建提案。");
        }
        await api.catalog.deleteAcademicReferenceCard({
          bookId,
          cardId: realCardId,
          baseProjectRevision
        });
      } else if (target.kind === "framework-stage-mutation") {
        const m = target.mutation;
        if (m.type === "create") {
          const existingIds = new Set(
            (context.catalog.catalogBook(bookId)?.bookType === "academic"
              ? (
                  context.catalog.catalogBook(bookId) as Extract<
                    ReturnType<typeof context.catalog.catalogBook>,
                    { bookType: "academic" }
                  >
                ).frameworkStages
              : []
            ).map((stage) => stage.id)
          );
          const updated = await api.catalog.mutateAcademicFramework({
            bookId,
            mutation: {
              type: "create",
              title: m.title,
              description: m.description
            }
          });
          const createdStage =
            updated.frameworkStages.find(
              (stage) => !existingIds.has(stage.id)
            ) ?? updated.frameworkStages.at(-1);
          if (createdStage) {
            runMap.stages.set(m.provisionalStageId, createdStage.id);
            nextDocumentId = projectedAcademicDocId(bookId, createdStage.id);
            if (m.content) {
              await api.catalog.saveDocument({
                bookId,
                documentId: createdStage.id,
                content: m.content,
                versionOrigin
              });
            }
          }
        } else {
          const realStageId = resolveStageId(m.stageId);
          if (!realStageId) {
            throw new Error("请先审阅并接受该论证阶段的新建提案。");
          }
          if (m.type === "update") {
            await api.catalog.mutateAcademicFramework({
              bookId,
              mutation: {
                type: "update",
                stageId: realStageId,
                title: m.title,
                description: m.description
              }
            });
            if (m.enabled !== undefined) {
              await api.catalog.mutateAcademicFramework({
                bookId,
                mutation: {
                  type: "setEnabled",
                  stageId: realStageId,
                  enabled: m.enabled
                }
              });
            }
          } else if (m.type === "move") {
            await api.catalog.mutateAcademicFramework({
              bookId,
              mutation: {
                type: "move",
                stageId: realStageId,
                direction: m.direction
              }
            });
          } else {
            await api.catalog.mutateAcademicFramework({
              bookId,
              baseProjectRevision,
              mutation: {
                type: "delete",
                stageId: realStageId
              }
            });
          }
        }
      } else if (target.kind === "chapter-mutation") {
        const m = target.mutation;
        if (m.type === "create") {
          for (const chapter of m.chapters) {
            if (runMap.chapters.has(chapter.provisionalChapterId)) continue;
            const created = await api.catalog.mutateAcademicManuscript({
              bookId,
              versionOrigin,
              mutation: {
                type: "create-chapter",
                title: chapter.title
              }
            });
            if (created.chapterId) {
              runMap.chapters.set(
                chapter.provisionalChapterId,
                created.chapterId
              );
            }
          }
        } else {
          const realChapterId = resolveChapterId(m.chapterId);
          if (!realChapterId) {
            throw new Error("请先审阅并接受该章的新建提案。");
          }
          if (m.type === "rename") {
            await api.catalog.mutateAcademicManuscript({
              bookId,
              mutation: {
                type: "rename-chapter",
                chapterId: realChapterId,
                title: m.title
              }
            });
          } else if (m.type === "move") {
            await api.catalog.mutateAcademicManuscript({
              bookId,
              mutation: {
                type: "move-chapter",
                chapterId: realChapterId,
                direction: m.direction
              }
            });
          } else {
            await api.catalog.mutateAcademicManuscript({
              bookId,
              baseProjectRevision,
              mutation: {
                type: "delete-chapter",
                chapterId: realChapterId,
                sectionAction: "unassign"
              }
            });
          }
        }
      } else if (target.kind === "section-mutation") {
        const m = target.mutation;
        if (m.type === "create") {
          let lastSectionId: string | undefined;
          for (const sec of m.sections) {
            const existingSecId = runMap.sections.get(sec.provisionalSectionId);
            if (existingSecId) {
              lastSectionId = existingSecId;
              continue;
            }
            const resolvedChapId =
              sec.chapterId === null
                ? null
                : sec.chapterId !== undefined
                  ? resolveChapterId(sec.chapterId)
                  : undefined;
            if (sec.chapterId && resolvedChapId === undefined) {
              throw new Error("请先审阅并接受所属章的新建提案。");
            }
            const resolvedAfterId = sec.afterSectionId
              ? resolveSectionId(sec.afterSectionId)
              : undefined;
            if (sec.afterSectionId && !resolvedAfterId) {
              throw new Error("请先审阅并接受参照前置小节的新建提案。");
            }
            const created = await api.catalog.mutateAcademicManuscript({
              bookId,
              versionOrigin,
              mutation: {
                type: "create-section",
                title: sec.title,
                ...(resolvedChapId !== undefined
                  ? { chapterId: resolvedChapId }
                  : {}),
                ...(resolvedAfterId ? { afterSectionId: resolvedAfterId } : {}),
                wordCountRequirement: sec.wordCountRequirement,
                ...(sec.briefContent !== undefined
                  ? { briefContent: sec.briefContent }
                  : {}),
                ...(sec.bodyContent !== undefined
                  ? { bodyContent: sec.bodyContent }
                  : {}),
                ...(sec.stateContent !== undefined
                  ? { stateContent: sec.stateContent }
                  : {})
              }
            });
            if (created.sectionId) {
              runMap.sections.set(sec.provisionalSectionId, created.sectionId);
              lastSectionId = created.sectionId;
            }
          }
          if (lastSectionId) {
            nextDocumentId = projectedAcademicDocId(
              bookId,
              createAcademicSectionDocumentId(lastSectionId, "body")
            );
          }
        } else if (m.type === "update") {
          const realSectionId = resolveSectionId(m.sectionId);
          if (!realSectionId) {
            throw new Error("请先审阅并接受该小节的新建提案。");
          }
          const resolvedChapId =
            m.chapterId === null
              ? null
              : m.chapterId !== undefined
                ? resolveChapterId(m.chapterId)
                : undefined;
          if (typeof m.chapterId === "string" && !resolvedChapId) {
            throw new Error("请先审阅并接受目标所属章的新建提案。");
          }
          await api.catalog.mutateAcademicManuscript({
            bookId,
            mutation: {
              type: "update-section-meta",
              sectionId: realSectionId,
              title: m.title,
              ...(m.wordCountRequirement !== undefined
                ? { wordCountRequirement: m.wordCountRequirement }
                : {}),
              ...(resolvedChapId !== undefined
                ? { chapterId: resolvedChapId }
                : {})
            }
          });
          if (m.direction || m.afterSectionId !== undefined) {
            const resolvedAfterId =
              m.afterSectionId === null
                ? null
                : m.afterSectionId !== undefined
                  ? resolveSectionId(m.afterSectionId)
                  : undefined;
            if (typeof m.afterSectionId === "string" && !resolvedAfterId) {
              throw new Error("请先审阅并接受目标参照小节的新建提案。");
            }
            await api.catalog.mutateAcademicManuscript({
              bookId,
              mutation: {
                type: "move-section",
                sectionId: realSectionId,
                ...(m.direction ? { direction: m.direction } : {}),
                ...(resolvedAfterId !== undefined
                  ? { afterSectionId: resolvedAfterId }
                  : {})
              }
            });
          }
          nextDocumentId = projectedAcademicDocId(
            bookId,
            createAcademicSectionDocumentId(realSectionId, "body")
          );
        } else {
          const realSectionId = resolveSectionId(m.sectionId);
          if (!realSectionId) {
            throw new Error("请先审阅并接受该小节的新建提案。");
          }
          await api.catalog.mutateAcademicManuscript({
            bookId,
            baseProjectRevision,
            mutation: {
              type: "delete-section",
              sectionId: realSectionId
            }
          });
        }
      }

      await context.catalog.loadSnapshot();
      conversation.updateEditProposal(proposal.runId, proposal.id, {
        status: "accepted",
        documentId: nextDocumentId,
        proposedText: undefined,
        ...(discardSnapshot ? { discardSnapshot } : {}),
        statusMessage: "已保存学术作品修改。"
      });
    } catch (error: unknown) {
      const conflict = context.catalog.isConflict(error);
      const message = formatError(
        error,
        conflict
          ? "文稿已被修改，请核对最新内容后重新审阅。"
          : "保存学术作品修改失败。"
      );
      conversation.updateEditProposal(proposal.runId, proposal.id, {
        status: conflict ? "conflict" : "error",
        statusMessage: message
      });
      context.notifications.error(message);
    } finally {
      context.editor.setWorkspaceAccepting(bookId, false);
    }
  }

  return {
    stageAcademicWorkspaceProposal,
    acceptAcademicWorkspaceProposal,
    handleAcademicProposalRejected
  };
}
