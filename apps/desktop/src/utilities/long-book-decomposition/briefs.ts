import {
  decompositionAssetProse,
  decompositionChaptersPerSubmission,
  decompositionReadingUnitId,
  type DecompositionAsset,
  type DecompositionAssetPart,
  type DecompositionReadingCard,
  type DecompositionRecord,
  type DecompositionRegistry,
  type LongBookAnalysisChapter,
  type LongBookDecompositionJob
} from "@deepwrite/contracts";
import { characterBriefs, domainBriefs } from "./brief-assets";
import {
  chapterDigestSections,
  fitBriefSections,
  type BriefSection
} from "./brief-text";
import {
  readDecompositionCards,
  readDecompositionRegistry
} from "./query-records";
import type { DecompositionRecordsReader } from "./records-reader";
import { emptyDecompositionRegistry } from "./workflow";
import {
  registryItemLine,
  registryMentionItems,
  registryPartItems
} from "./registry-mentions";
import { registryEntryLine, registryMergeInput } from "./registry-merge";

export interface BriefContext {
  job: LongBookDecompositionJob;
  chapters: LongBookAnalysisChapter[];
  cards(): Promise<DecompositionReadingCard[]>;
  registry(): Promise<DecompositionRegistry>;
  record(unitId: string): Promise<DecompositionRecord>;
  /** The saved asset of a finished unit, from its task record. */
  asset(unitId: string): Promise<DecompositionAsset | undefined>;
  /** Review issues that sent a finished unit back for repair. */
  repairs(unitId: string): Promise<string[]>;
  /** Batches staged for an unfinished unit by an earlier attempt. */
  draft(unitId: string): Promise<DecompositionAssetPart | undefined>;
}

export function briefContext(
  job: LongBookDecompositionJob,
  reader: DecompositionRecordsReader,
  chapters: LongBookAnalysisChapter[]
): BriefContext {
  let cards: Promise<DecompositionReadingCard[]> | undefined;
  const record = (unitId: string) => reader.record(job, unitId);
  const asset = async (unitId: string) => {
    if (job.units[unitId]?.status !== "done") return undefined;
    const saved = await record(unitId);
    return saved.data.kind === "asset" ? saved.data.asset : undefined;
  };
  return {
    job,
    chapters,
    cards: () =>
      (cards ??= readDecompositionCards(job, reader).then((list) =>
        [...list].sort(
          (a, b) => (a.chapters[0]?.order ?? 0) - (b.chapters[0]?.order ?? 0)
        )
      )),
    registry: async () =>
      job.units["registry:merge"]?.status === "done"
        ? readDecompositionRegistry(job, reader)
        : emptyDecompositionRegistry(),
    record,
    asset,
    draft: (unitId) => reader.records.draft(job, unitId),
    repairs: async (unitId) => {
      const lines: string[] = [];
      for (const id of Object.keys(job.units))
        if (id.startsWith("review:") && job.units[id]!.status === "done") {
          const saved = await record(id);
          if (saved.data.kind !== "review") continue;
          for (const issue of saved.data.review.issues)
            if (issue.unitId === unitId && issue.resolution === "repair")
              lines.push(
                `${issue.description}（证据：${issue.chapterOrders.map((order) => `第${order}章`).join("、") || "无"}；建议：${issue.suggestion}）`
              );
        }
      return lines;
    }
  };
}

function readerBrief(context: BriefContext, unitId: string): string {
  const { job, chapters } = context;
  const chunk = job.chunks.find(({ id }) => id === unitId);
  if (!chunk) throw new Error("阅读块不存在。");
  const saved: string[] = [];
  const parts: string[] = [];
  for (const chapterId of chunk.chapterIds) {
    const chapter = chapters.find(({ id }) => id === chapterId);
    if (!chapter) throw new Error("阅读块章节不在来源范围内。");
    const readingId = decompositionReadingUnitId(chunk, chapterId);
    const segment = chunk.segment
      ? `｜segmentIndex=${chunk.segment.index}（片段 ${chunk.segment.index + 1}/${chunk.segment.count}）`
      : "";
    if (job.units[readingId]?.status === "done") {
      saved.push(`${readingId}（第 ${chapter.order} 章 ${chapter.title}）`);
      continue;
    }
    const text = chunk.segment
      ? chapter.text.slice(chunk.segment.start, chunk.segment.end)
      : chapter.text;
    parts.push(
      `### ${readingId}｜chapterId=${chapter.id}｜order=${chapter.order}｜title=${chapter.title}${segment}\n${text}`
    );
  }
  // Source text is never trimmed: the chunk plan already sized it.
  return [
    `【阅读块 ${chunk.id}】第 ${chunk.startOrder}–${chunk.endOrder} 章${chunk.volume ? `，${chunk.volume}` : ""}。按章节顺序分批提交，每次不超过 ${decompositionChaptersPerSubmission(job.models.reading)} 章；每章单独保存，先交的章节立即显示为完成。`,
    saved.length ? `已保存，无需再交：${saved.join("、")}` : "",
    ...parts
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function registryBrief(
  context: BriefContext,
  unitId: string
): Promise<BriefSection> {
  const cards = await context.cards();
  if (unitId === "registry:merge") {
    const { registry, candidates } = await registryMergeInput(
      context.job,
      context.record,
      cards
    );
    const entries = new Map(
      [...registry.characters, ...registry.terms].map((entry) => [
        entry.id,
        entry
      ])
    );
    return {
      title: `【名册合并】各分片已由程序合并：正式名相同的条目已合为一条，重复的名字已按出处归属。以下 ${candidates.length} 个候选簇来自不同分片，可能是同一对象；refs 写条目编号，只对确属同一对象的写 groups，未写到的条目保持原样。`,
      lines: candidates.length
        ? candidates.flatMap((cluster, index) => [
            `候选簇 ${index + 1}：`,
            ...cluster.map((id) => registryEntryLine(entries.get(id)!))
          ])
        : ["没有需要判断的候选簇：提交 groups 与 ignored 都为空的计划即可。"]
    };
  }
  const items = registryPartItems(
    context.job,
    registryMentionItems(cards),
    unitId
  );
  return {
    title: `【${unitId} 名字】共 ${items.length} 个编号。groups 只写需要合并为同一对象或需要标明分级、类别的编号；没写到的编号各自成条（人物默认路人），ignored 写不是任何对象的名字。`,
    lines: items.map(registryItemLine)
  };
}

async function chronicleBrief(context: BriefContext, unitId: string) {
  const segment = context.job.chronicleSegments.find(({ id }) => id === unitId);
  if (!segment) throw new Error("编年段不存在。");
  const cards = (await context.cards()).filter(({ chunkId }) =>
    segment.chunkIds.includes(chunkId)
  );
  return chapterDigestSections(cards, `【${unitId} 阅读记录摘要】`);
}

async function plotBrief(context: BriefContext, unitId: string) {
  const segments = context.job.chronicleSegments;
  const sections: BriefSection[] = [];
  for (const { id, volume } of unitId === "plot:opening"
    ? segments.slice(0, 2)
    : segments) {
    const asset = await context.asset(id);
    if (asset)
      sections.push({
        title: `【${id} 编年${volume ? `｜${volume}` : ""}】`,
        lines: [
          unitId === "plot:foreshadowing" && asset.kind === "chronicle"
            ? asset.summary
            : decompositionAssetProse(asset)
        ],
        prose: true
      });
  }
  if (unitId === "plot:foreshadowing")
    sections.push(chapterDigestSections(await context.cards(), "")[2]!);
  if (unitId === "plot:opening")
    sections.push({
      title: "【开篇原文】",
      lines: context.chapters
        .slice(0, 3)
        .map(({ order, title, text }) => `### 第${order}章 ${title}\n${text}`),
      prose: true
    });
  return sections;
}

/** What an earlier attempt already staged, so a retry only adds the rest. */
function stagedSection(unitId: string, draft: DecompositionAssetPart) {
  const titles =
    draft.kind === "world"
      ? draft.items.map(({ title }) => title)
      : draft.kind === "foreshadowing"
        ? draft.lines.map(({ key, title }) => `${key}｜${title}`)
        : draft.kind === "book-line"
          ? draft.volumes.map(({ title }) => title)
          : draft.points.map(
              ({ title, startOrder, endOrder }) =>
                `${title}（${startOrder}–${endOrder}）`
            );
  return {
    title: `【${unitId} 已暂存 ${titles.length} 条】下面这些已保存在暂存区，不要重交；只提交其余条目，最后一批省略 batch_mode 完成本单元。若条目已交齐，补齐必填文字字段并提交空条目列表即可收尾，不要重新生成已暂存内容。`,
    lines: [titles.join("、")]
  };
}

/**
 * Assembles everything one child needs for its units, within the evidence
 * budget, so the child reads it once instead of paging through lookups.
 */
export async function buildDecompositionBrief(
  context: BriefContext,
  unitIds: readonly string[],
  budget: number
): Promise<string> {
  for (const id of unitIds)
    if (!context.job.units[id]) throw new Error(`未知单元：${id}`);
  if (unitIds.some((id) => id.startsWith("chunk:"))) {
    if (unitIds.length !== 1)
      throw new Error("每个通读子任务只能处理一个阅读块。");
    return readerBrief(context, unitIds[0]!);
  }
  const sections: BriefSection[] = [];
  for (const id of unitIds) {
    if (id.startsWith("registry:"))
      sections.push(await registryBrief(context, id));
    else if (id.startsWith("chronicle:"))
      sections.push(...(await chronicleBrief(context, id)));
    else if (id.startsWith("plot:"))
      sections.push(...(await plotBrief(context, id)));
    else if (id.startsWith("character"))
      sections.push(...(await characterBriefs(context, id)));
    else sections.push(...(await domainBriefs(context, id)));
    const repairs = await context.repairs(id);
    if (repairs.length)
      sections.push({ title: `【${id} 审校要求修复】`, lines: repairs });
    const draft = await context.draft(id);
    if (draft) sections.push(stagedSection(id, draft));
  }
  return fitBriefSections(
    sections.filter(({ lines }) => lines.length),
    budget
  );
}
