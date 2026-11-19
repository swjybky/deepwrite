import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import {
  parseLongForeshadowingBody,
  serializeLongForeshadowingBody,
  type LongMutationReview,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { WRITING_CONTENT_COUNT_DESCRIPTION } from "../writing-content-counts";
import { longCreatedContentTargets } from "./content-counts";
import { defineTool } from "./shared";
import {
  contentParameter,
  createMetaParameter,
  strictObject,
  summaryParameter
} from "./schemas";
import {
  LONG_CREATE_KINDS,
  LONG_STAGE_ROOTS,
  longStageForTarget,
  type LongCreateKind,
  type LongEntityKind
} from "./entity-registry";
import {
  createChapterCard,
  createCharacter,
  createStoryPlot,
  createWorldbuildingItem
} from "./create-file-entities";
import { createContinuityFiles } from "./create-continuity-files";
import { createPlotRecord } from "./create-plot-records";
import {
  resolveWorldbuildingItemTitle,
  type LongCreateInput,
  type LongCreateMeta,
  type LongCreateResult
} from "./create-support";
import { formLongProposal } from "./proposals";
import type { LongToolContext } from "./context";
import { assertCreateMeta, CREATE_META_TABLE } from "./create-meta";

const CREATE_KIND_STAGES: Record<
  LongCreateKind,
  LongEntityKind | "continuity"
> = {
  worldbuilding_item: "worldbuilding_item",
  character: "character",
  volume: "volume",
  arc: "arc",
  story_plot: "story_plot",
  chapter_card: "chapter_card",
  story_event: "story_event",
  event_connection: "event_connection",
  narrative_placement: "narrative_placement",
  foreshadowing: "foreshadowing",
  foreshadowing_beat: "foreshadowing_beat",
  continuity_world_reveals: "continuity",
  continuity_character: "continuity"
};

function buildCreate(input: LongCreateInput): LongCreateResult {
  if (input.kind === "worldbuilding_item") {
    return createWorldbuildingItem(input);
  }
  if (input.kind === "character") return createCharacter(input);
  if (input.kind === "chapter_card") return createChapterCard(input);
  if (input.kind === "story_plot") return createStoryPlot(input);
  if (
    input.kind === "continuity_world_reveals" ||
    input.kind === "continuity_character"
  ) {
    return createContinuityFiles(input);
  }
  return createPlotRecord(input);
}

function normalizeCreateMeta(
  kind: LongCreateKind,
  meta: LongCreateMeta,
  content: string
): LongCreateMeta {
  if (kind !== "worldbuilding_item") return meta;
  const title = resolveWorldbuildingItemTitle(meta.title, content);
  if (title) return { ...meta, title };
  const normalizedMeta = { ...meta };
  delete normalizedMeta.title;
  return normalizedMeta;
}

function createRecordReview(
  kind: LongCreateKind,
  meta: LongCreateMeta,
  content: string,
  index: LongWorkspaceIndexSnapshot,
  createdId: string
): LongMutationReview {
  const eventTitle = (eventId: string | undefined) =>
    index.plot.storyEvents.find((event) => event.id === eventId)?.title ??
    eventId ??
    "";
  const chapterTitle = (chapterCardId: string | undefined) =>
    index.plot.chapterCards.find((card) => card.id === chapterCardId)?.title ??
    chapterCardId ??
    "";
  const threadTitle = (threadId: string | undefined) =>
    index.plot.foreshadowing.find((thread) => thread.id === threadId)?.title ??
    threadId ??
    "";

  let title = "新建对象";
  if (kind === "volume") title = `新建分卷 · ${meta.title ?? createdId}`;
  else if (kind === "arc") title = `新建剧情点 · ${meta.title ?? createdId}`;
  else if (kind === "story_event") {
    title = `新建故事事件 · ${meta.title ?? createdId}`;
  } else if (kind === "event_connection") {
    title = `新建事件连接 · ${eventTitle(meta.source_event_id)} → ${eventTitle(meta.target_event_id)}`;
  } else if (kind === "narrative_placement") {
    title = `新建叙事落点 · ${eventTitle(meta.event_id)} @ ${chapterTitle(meta.chapter_card_id)}`;
  } else if (kind === "foreshadowing") {
    title = `新建伏笔线 · ${meta.title ?? createdId}`;
  } else if (kind === "foreshadowing_beat") {
    title = `新建伏笔触点 · ${threadTitle(meta.foreshadowing_id)}`;
  }

  const hasContent = content.trim().length > 0;
  const afterText =
    hasContent && kind === "foreshadowing"
      ? serializeLongForeshadowingBody(parseLongForeshadowingBody(content))
      : content;

  return {
    targetKey: `create:${createdId}`,
    targetKind: kind as LongMutationReview["targetKind"],
    targetId: createdId,
    action: "create",
    title: title.slice(0, 600),
    ...(hasContent
      ? {
          content: {
            operation: "create",
            beforeText: "",
            afterText
          }
        }
      : {})
  };
}

export function buildCreateTool(ctx: LongToolContext): AgentTool {
  const { writableRoots, loadIndex } = ctx;
  return defineTool({
    name: "create",
    label: "新建对象",
    description:
      "一次新建一个对象，meta 按下表填写，content 是初始正文。剧情点的 content 写入该剧情点的概要，不要为此再新建故事情节；story_plot 写已有剧情点下的场景链。id 与排序由系统生成；世界观分类和人物类型由用户在界面管理。continuity_character.document=current_state|history，content 写入该文档。\n" +
      WRITING_CONTENT_COUNT_DESCRIPTION +
      "\n" +
      CREATE_META_TABLE,
    parameters: strictObject({
      kind: StringEnum(LONG_CREATE_KINDS),
      meta: createMetaParameter,
      content: Type.Optional(contentParameter),
      summary: Type.Optional(summaryParameter)
    }),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      const kind = params.kind as LongCreateKind;
      const content = params.content ?? "";
      const meta = normalizeCreateMeta(kind, params.meta, content);
      assertCreateMeta(kind, meta, ctx.workspace.activeChapterCardId);
      const stageKind = CREATE_KIND_STAGES[kind];
      const stage =
        stageKind === "continuity"
          ? "continuity"
          : longStageForTarget(stageKind);
      if (!writableRoots.has(LONG_STAGE_ROOTS[stage])) {
        throw new Error(`当前智能体无权写入 ${stage} 阶段。`);
      }
      const index = await loadIndex(signal);
      const timestamp = new Date().toISOString();
      const result = buildCreate({
        kind,
        meta,
        content,
        index,
        timestamp,
        idSeed: `${ctx.workspace.bookId}:${ctx.input.runId}:${toolCallId}`,
        ...(ctx.workspace.activeChapterCardId
          ? { activeChapterCardId: ctx.workspace.activeChapterCardId }
          : {})
      });
      const verb = result.action === "write" ? "写入" : "新建";
      const summary = params.summary?.trim() || `${verb}${result.label}`;
      return formLongProposal(ctx, {
        toolCallId,
        changes: result.changes,
        operations: result.operations,
        timestamp,
        summary,
        message: `已形成${verb}${result.label}（${result.createdId}）的提案，等待客户端审阅。`,
        contentTargets: longCreatedContentTargets(result, kind, content),
        ...(result.changes.length === 0
          ? {
              review: createRecordReview(
                kind,
                meta,
                content,
                index,
                result.createdId
              )
            }
          : {}),
        index
      });
    }
  });
}
