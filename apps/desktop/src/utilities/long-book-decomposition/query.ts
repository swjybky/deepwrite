export {
  readDecompositionCards,
  readDecompositionRegistry
} from "./query-records";
import {
  readDecompositionCards,
  readDecompositionRegistry
} from "./query-records";
import {
  DECOMPOSITION_QUERY_CHARACTERS,
  decompositionEvidenceBudget,
  decompositionInputBudget,
  type LongBookDecompositionJob,
  type DecompositionQuery,
  type DecompositionQueryResult
} from "@deepwrite/contracts";
import { LongBookAnalysisSourceStore } from "../../extras/agents/sources/long-book-source-store";
import { DecompositionRecordsReader } from "./records-reader";
import { emptyDecompositionRegistry } from "./workflow";
import { registryMentionItems, registryPartItems } from "./registry-mentions";
import { registryMergeInput } from "./registry-merge";
import { sampleDecompositionPassages } from "./passage-sampling";
import { briefContext, buildDecompositionBrief } from "./briefs";

/** Matches per chapter and per lookup; evidence packs carry the bulk. */
const SEARCH_PER_CHAPTER = 3;
const SEARCH_TOTAL = 40;

/**
 * Walk JSON as fragments so a paged query never builds the complete payload
 * string before returning the requested window.
 */
function* jsonFragments(value: unknown): Generator<string> {
  if (value === null) {
    yield "null";
    return;
  }
  if (typeof value === "string") {
    yield JSON.stringify(value);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    yield JSON.stringify(value);
    return;
  }
  if (Array.isArray(value)) {
    yield "[";
    for (const [index, item] of value.entries()) {
      if (index > 0) yield ",";
      yield* jsonFragments(item);
    }
    yield "]";
    return;
  }
  if (typeof value === "object") {
    yield "{";
    for (const [index, [key, item]] of Object.entries(value).entries()) {
      if (index > 0) yield ",";
      yield `${JSON.stringify(key)}:`;
      yield* jsonFragments(item);
    }
    yield "}";
    return;
  }
  yield "null";
}

function pageJsonValue(
  value: unknown,
  cursor: number,
  pageCharacters: number
): { content: string; nextCursor: number | null; totalCharacters: number } {
  const start = Math.max(0, cursor);
  const end = start + pageCharacters;
  let offset = 0;
  let content = "";
  for (const fragment of jsonFragments(value)) {
    const fragmentEnd = offset + fragment.length;
    if (fragmentEnd > start && offset < end) {
      content += fragment.slice(
        Math.max(0, start - offset),
        Math.min(fragment.length, end - offset)
      );
    }
    offset = fragmentEnd;
  }
  return {
    content,
    nextCursor: end < offset ? end : null,
    totalCharacters: offset
  };
}

export async function queryDecomposition(
  job: LongBookDecompositionJob,
  workspaceDirectory: string,
  reader: DecompositionRecordsReader,
  request: DecompositionQuery
): Promise<DecompositionQueryResult> {
  return reader.snapshot(() =>
    querySnapshot(job, workspaceDirectory, reader, request)
  );
}
async function querySnapshot(
  job: LongBookDecompositionJob,
  workspaceDirectory: string,
  reader: DecompositionRecordsReader,
  request: DecompositionQuery
): Promise<DecompositionQueryResult> {
  const store = new LongBookAnalysisSourceStore(workspaceDirectory);
  const needsChapters = [
    "brief",
    "chunkText",
    "searchSource",
    "samplePassages"
  ].includes(request.kind);
  const source = needsChapters
    ? await store.load(job.source.sourceId, job.source.sourceRevision)
    : undefined;
  const identity =
    source ??
    (await store.inspectRevision(
      job.source.sourceId,
      job.source.sourceRevision
    ));
  if (identity.fingerprint !== job.source.fingerprint)
    throw new Error("任务来源指纹不匹配。");
  const range = request.range ?? job.source.range;
  const chapters = (source?.chapters ?? []).filter(
    ({ order }) =>
      order >= range.start &&
      order <= range.end &&
      order >= job.source.range.start &&
      order <= job.source.range.end
  );
  const chunk = request.chunkId
    ? job.chunks.find(({ id }) => id === request.chunkId)
    : undefined;
  let result: unknown;
  if (request.kind === "brief") {
    const content = await buildDecompositionBrief(
      briefContext(job, reader, chapters),
      request.unitIds!,
      decompositionEvidenceBudget(
        job.phase === "read" ? job.models.reading : job.models.integration
      )
    );
    return { content, nextCursor: null, totalCharacters: content.length };
  }
  if (request.kind === "chunkText") {
    if (!chunk && !request.range)
      throw new Error("读取原文需要阅读块或章节范围。");
    result = {
      chunk,
      chapters: chapters
        .filter(({ id }) => !chunk || chunk.chapterIds.includes(id))
        .map((chapter) => ({
          ...chapter,
          ...(chunk?.segment
            ? {
                text: chapter.text.slice(chunk.segment.start, chunk.segment.end)
              }
            : {})
        }))
    };
  } else if (request.kind === "searchSource") {
    if (!request.query) throw new Error("请输入检索关键词。");
    result = chapters
      .flatMap((chapter) => {
        const matches = [
          ...chapter.text.matchAll(
            new RegExp(
              request.query!.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
              "gu"
            )
          )
        ].slice(0, SEARCH_PER_CHAPTER);
        return matches.map((match) => ({
          chapterOrder: chapter.order,
          title: chapter.title,
          offset: match.index,
          text: chapter.text.slice(
            Math.max(0, match.index - 100),
            match.index + request.query!.length + 200
          )
        }));
      })
      .slice(0, SEARCH_TOTAL);
  } else if (request.kind === "status") {
    const segment = job.chronicleSegments.find(
      ({ id }) => id === request.unitId
    );
    const chunks = segment
      ? job.chunks.filter(({ id }) => segment.chunkIds.includes(id))
      : request.unitId?.startsWith("chunk:")
        ? job.chunks.filter(({ id }) => id === request.unitId)
        : job.chunks;
    result = {
      phase: job.phase,
      status: job.status,
      mode: job.mode,
      startOrder: chunks[0]?.startOrder,
      endOrder: chunks.at(-1)?.endOrder,
      unitIds: Object.keys(job.units).filter(
        (id) =>
          !id.startsWith("reading:") &&
          (!request.unitId || id === request.unitId)
      ),
      units: Object.fromEntries(
        Object.entries(job.units)
          .filter(
            ([id]) =>
              !request.unitId ||
              id === request.unitId ||
              job.units[request.unitId]?.dependencies.includes(id)
          )
          .map(([id, unit]) => [
            id,
            { status: unit.status, dependencies: unit.dependencies }
          ])
      ),
      chunks: request.unitId?.startsWith("chunk:")
        ? chunks
        : chunks.map(({ id, startOrder, endOrder, volume }) => ({
            id,
            startOrder,
            endOrder,
            volume
          })),
      assets: Object.keys(job.units).filter(
        (id) =>
          job.units[id]?.phase === "integrate" &&
          job.units[id]?.status === "done"
      )
    };
  } else if (request.kind === "assets") {
    const ids = Object.keys(job.units).filter(
      (id) =>
        job.units[id]?.status === "done" &&
        !id.startsWith("reading:") &&
        !id.startsWith("chunk:") &&
        (!request.unitId || id === request.unitId)
    );
    result = await Promise.all(
      ids.map(async (id) => ({
        ...(await reader.record(job, id)),
        actual: await reader.actualContents(job, id)
      }))
    );
  } else if (request.kind === "registry")
    result =
      job.units["registry:merge"]?.status === "done"
        ? await readDecompositionRegistry(job, reader)
        : emptyDecompositionRegistry();
  else if (request.kind === "samplePassages") {
    result = sampleDecompositionPassages(
      chapters,
      request.strategy,
      request.strategy === "climax"
        ? await readDecompositionCards(job, reader)
        : []
    );
  } else {
    let cards = await readDecompositionCards(job, reader);
    cards = cards.filter(
      (card) =>
        card.chapters.some(
          ({ order }) => order >= range.start && order <= range.end
        ) &&
        (!chunk || card.chunkId === chunk.id)
    );
    if (request.kind === "cards" && request.unitId?.startsWith("chronicle:")) {
      const segment = job.chronicleSegments.find(
        ({ id }) => id === request.unitId
      );
      cards = cards.filter(({ chunkId }) =>
        segment?.chunkIds.includes(chunkId)
      );
    }
    if (request.kind === "cardDigest")
      result = cards.map(({ chunkId, chapters }) => ({
        chunkId,
        chapters: chapters.map(({ chapterId, order, title, summary }) => ({
          chapterId,
          order,
          title,
          summary
        }))
      }));
    else if (request.kind === "styleNotes")
      result = cards.map(({ chunkId, style }) => ({ chunkId, ...style }));
    else if (request.kind === "characterMentions") {
      const registry = await readDecompositionRegistry(job, reader);
      const character = registry.characters.find(
        ({ id }) => id === request.registryId
      );
      if (!character) throw new Error("名册人物不存在。");
      const names = [character.name, ...character.aliases];
      result = cards.flatMap((card) =>
        card.characters
          .filter(({ name }) => names.includes(name))
          .map((entry) => ({ chunkId: card.chunkId, ...entry }))
      );
    } else if (request.kind === "worldMentions")
      result = cards.flatMap((card) =>
        card.world
          .filter(
            ({ categoryId }) =>
              !request.categoryId || categoryId === request.categoryId
          )
          .map((entry) => ({ chunkId: card.chunkId, ...entry }))
      );
    else if (request.kind === "mentions") {
      if (request.unitId === "registry:merge") {
        const merge = await registryMergeInput(
          job,
          (id) => reader.record(job, id),
          cards
        );
        result = { ...merge.registry, candidates: merge.candidates };
      } else {
        const items = registryPartItems(
          job,
          registryMentionItems(cards),
          request.unitId ?? "registry:part:1"
        ).map(({ facts: _facts, aliasChunks: _uses, ...item }) => item);
        result = {
          characters: items.filter(({ domain }) => domain === "character"),
          terms: items.filter(({ domain }) => domain === "term")
        };
      }
    } else result = cards;
  }
  const cursor = request.cursor ?? 0;
  const pageCharacters = Math.min(
    DECOMPOSITION_QUERY_CHARACTERS,
    Math.floor(
      (decompositionInputBudget(
        job.phase === "read" ? job.models.reading : job.models.integration,
        job.profile.systemPrompt.length
      ) /
        1.5) *
        0.7
    )
  );
  return pageJsonValue(result, cursor, pageCharacters);
}
