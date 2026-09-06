import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum, Type } from "@earendil-works/pi-ai";
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
import { confirmCrossStageWrite, crossStageWriteCancelled } from "./user-input";

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

export function buildCreateTool(ctx: LongToolContext): AgentTool {
  const { writableRoots, loadIndex } = ctx;
  return defineTool({
    name: "create",
    label: "新建对象",
    description:
      "一次新建一个对象：kind 决定类型，meta 只放必要的标题与关系字段，content 是该对象的正文，创建时即可直接写入。创建 worldbuilding_item 时，meta.category_id 与 meta.title 都必须提供；即使 content 已含同名 Markdown 标题，也不能省略 meta.title。剧情点的 content 写入该剧情点的概要，不要为此再新建故事情节；故事情节用 kind=story_plot，只写该剧情点下的场景链。排序与 id 由系统生成，不要自己指定。世界观分类与人物类型这类容器不能新建，请提示用户在界面上操作。连续性文件同样在 create 时携带正文：continuity_world_reveals 的 content 即世界观揭露；continuity_character 必须提供 meta.character_id 与 meta.document=current_state|history，content 写入该文档。",
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
      const stageKind = CREATE_KIND_STAGES[kind];
      const stage =
        stageKind === "continuity"
          ? "continuity"
          : longStageForTarget(stageKind);
      if (!writableRoots.has(LONG_STAGE_ROOTS[stage])) {
        throw new Error(`当前智能体无权写入 ${stage} 阶段。`);
      }
      const decision = await confirmCrossStageWrite(ctx, {
        toolCallId,
        targetStage: stage,
        targetTitle:
          typeof meta.title === "string"
            ? meta.title
            : typeof meta.name === "string"
              ? meta.name
              : kind,
        operationLabel: "新建",
        signal
      });
      if (decision === "cancel") return crossStageWriteCancelled(ctx, stage);
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
        index
      });
    }
  });
}
