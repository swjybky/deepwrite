import { isBuiltinAcademicFrameworkStageId } from "@deepwrite/contracts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { literalUnion } from "../short-agent-tools/schema";
import { findAcademicCardByIdOrCiteKey } from "./read";
import {
  academicProposalNote,
  academicTextResult,
  defineAcademicTool,
  ensureAcademicOverlayFileLoaded,
  syncAcademicSharedStateFromCore,
  type AcademicOverlayFile,
  type AcademicWorkspaceToolSharedState,
  type BuildAcademicWorkspaceToolsInput
} from "./shared";

export const ACADEMIC_DELETE_KINDS = [
  "reference_card",
  "framework_stage",
  "chapter",
  "section"
] as const;

async function readDeletedSnapshot(
  input: BuildAcademicWorkspaceToolsInput,
  file: AcademicOverlayFile,
  signal?: AbortSignal
): Promise<string> {
  if (file.loaded) return file.content;
  if (!input.writingReader) return file.content;
  try {
    const loaded = await ensureAcademicOverlayFileLoaded(input, file, signal);
    return loaded.content;
  } catch {
    return file.content;
  }
}

export function buildAcademicDeleteTool(
  input: BuildAcademicWorkspaceToolsInput,
  sharedState: AcademicWorkspaceToolSharedState
): AgentTool {
  const english = input.promptLocale === "en-US";
  return defineAcademicTool({
    name: "delete",
    label: english ? "Delete academic object" : "删除学术作品对象",
    description: english
      ? "Propose deleting a reference_card, custom framework_stage (builtin stages cannot be deleted), chapter, or section (preserving >= 1 section)."
      : "提交删除文献与证据卡（reference_card）、自定义论证阶段（framework_stage，内置阶段不可删除）、章（chapter，下属小节保留并解除归属）或正文小节（section，全书至少保留 1 节）的提案。",
    parameters: Type.Object({
      kind: literalUnion(ACADEMIC_DELETE_KINDS, {
        description: english
          ? "Object kind to delete."
          : "要删除的对象类型：reference_card、framework_stage、chapter 或 section。"
      }),
      id: Type.String({
        description: english
          ? "Stable target id (or citeKey for reference_card)."
          : "目标对象的稳定 id（reference_card 支持传卡片 id 或 citeKey）。"
      }),
      summary: Type.Optional(
        Type.String({
          description: english
            ? "Optional one-sentence summary (<= 1000 chars)."
            : "可选的一句话改动说明（<= 1000 字）。"
        })
      )
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal) => {
      await syncAcademicSharedStateFromCore(input, sharedState, signal);

      const rawId = (params.id ?? "").trim();
      if (!rawId) {
        throw new Error("id：删除对象必须提供稳定 id。");
      }
      const rawSummary = params.summary?.trim();
      if (rawSummary && rawSummary.length > 1_000) {
        throw new Error(`summary：当前 ${rawSummary.length} 字，上限 1000。`);
      }
      const baseProjectRevision = sharedState.projectRevision;

      if (params.kind === "reference_card") {
        const card = findAcademicCardByIdOrCiteKey(sharedState, rawId);
        if (!card) {
          throw new Error(`未找到文献/证据卡（${rawId}）。`);
        }
        const deletedText = await readDeletedSnapshot(input, card.file, signal);
        sharedState.cards.delete(card.id);
        sharedState.cardOrder = sharedState.cardOrder.filter(
          (id) => id !== card.id
        );
        const summary =
          rawSummary || `删除文献与证据卡「${card.title}」（${card.citeKey}）`;
        return academicTextResult(
          `${summary}。${academicProposalNote(input)}`,
          {
            kind: "academic-workspace-mutation",
            workspaceId: input.workspace.id,
            summary,
            ...(baseProjectRevision !== undefined
              ? { baseProjectRevision }
              : {}),
            target: {
              kind: "reference-card-delete",
              cardId: card.id,
              citeKey: card.citeKey,
              title: card.title,
              deletedText
            }
          }
        );
      }

      if (params.kind === "framework_stage") {
        const stage = sharedState.frameworkStages.get(rawId);
        if (!stage) {
          throw new Error(`未找到论证框架阶段（id=${rawId}）。`);
        }
        if (stage.builtin || isBuiltinAcademicFrameworkStageId(stage.id)) {
          throw new Error(
            `内置论证框架阶段「${stage.title}」（${stage.id}）不可删除；若当前作品无需此阶段，请用 edit(kind="framework_stage", id="${stage.id}", meta={ stage_status: "disabled" }) 停用。`
          );
        }
        if (
          ![...sharedState.frameworkStages.values()].some(
            (other) => other.id !== stage.id && other.enabled
          )
        ) {
          throw new Error(
            "删除后将没有已启用的论证框架阶段，请先启用其他阶段。"
          );
        }
        const deletedText = await readDeletedSnapshot(
          input,
          stage.file,
          signal
        );
        sharedState.frameworkStages.delete(stage.id);
        sharedState.frameworkStageOrder =
          sharedState.frameworkStageOrder.filter((id) => id !== stage.id);
        const summary = rawSummary || `删除自定义论证阶段「${stage.title}」`;
        return academicTextResult(
          `${summary}。${academicProposalNote(input)}`,
          {
            kind: "academic-workspace-mutation",
            workspaceId: input.workspace.id,
            summary,
            ...(baseProjectRevision !== undefined
              ? { baseProjectRevision }
              : {}),
            target: {
              kind: "framework-stage-mutation",
              mutation: {
                type: "delete",
                stageId: stage.id,
                title: stage.title,
                deletedText
              }
            }
          }
        );
      }

      if (params.kind === "chapter") {
        const chapter = sharedState.chapters.get(rawId);
        if (!chapter) {
          throw new Error(`未找到章（id=${rawId}）。`);
        }
        sharedState.chapters.delete(chapter.id);
        sharedState.chapterOrder = sharedState.chapterOrder.filter(
          (id) => id !== chapter.id
        );
        for (const section of sharedState.sections.values()) {
          if (section.chapterId === chapter.id) {
            delete section.chapterId;
          }
        }
        const summary = rawSummary || `删除章「${chapter.title}」`;
        return academicTextResult(
          `${summary}。${academicProposalNote(input)}`,
          {
            kind: "academic-workspace-mutation",
            workspaceId: input.workspace.id,
            summary,
            ...(baseProjectRevision !== undefined
              ? { baseProjectRevision }
              : {}),
            target: {
              kind: "chapter-mutation",
              mutation: {
                type: "delete",
                chapterId: chapter.id,
                title: chapter.title
              }
            }
          }
        );
      }

      const section = sharedState.sections.get(rawId);
      if (!section) {
        throw new Error(`未找到正文小节（id=${rawId}）。`);
      }
      if (sharedState.sectionOrder.length <= 1) {
        throw new Error("学术作品至少须保留 1 个正文小节，无法删除最后一节。");
      }
      const deletedBody = await readDeletedSnapshot(
        input,
        section.body,
        signal
      );
      sharedState.sections.delete(section.id);
      sharedState.sectionOrder = sharedState.sectionOrder.filter(
        (id) => id !== section.id
      );
      const summary = rawSummary || `删除正文小节「${section.title}」`;
      return academicTextResult(`${summary}。${academicProposalNote(input)}`, {
        kind: "academic-workspace-mutation",
        workspaceId: input.workspace.id,
        summary,
        ...(baseProjectRevision !== undefined ? { baseProjectRevision } : {}),
        target: {
          kind: "section-mutation",
          mutation: {
            type: "delete",
            sectionId: section.id,
            title: section.title,
            deletedText: deletedBody
          }
        }
      });
    }
  });
}
