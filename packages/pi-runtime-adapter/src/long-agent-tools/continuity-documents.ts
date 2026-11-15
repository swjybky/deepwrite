import {
  applyLongWorkspaceOperations,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import type { LongToolContext } from "./context";
import { createContinuityFiles } from "./create-continuity-files";
import { formLongProposal, type LongFileChangeInput } from "./proposals";
import { resolveLongTarget } from "./target";

export interface ContinuityDocuments {
  chapter_end_state: string;
  handoff: string;
  world_reveals?: string;
  characters?: {
    character_id: string;
    current_state: string;
    history: string;
  }[];
}

export async function prepareContinuityDocuments(
  ctx: LongToolContext,
  index: LongWorkspaceIndexSnapshot,
  chapterCardId: string,
  documents: ContinuityDocuments,
  toolCallId: string,
  summary: string,
  foreshadowing: string,
  signal?: AbortSignal
) {
  const timestamp = new Date().toISOString();
  const changes: LongFileChangeInput[] = [];
  const operations: Parameters<
    typeof ctx.rememberProposal
  >[0]["operations"][number][] = [];
  const chapter = index.chapters.find(
    (c) => c.chapterCardId === chapterCardId
  )!;
  const write = async (
    id: string,
    document: string,
    content: string,
    chapter_id?: string
  ) => {
    if (!content.trim() || content.length > 1_000_000)
      throw new Error(`documents.${document} 需要1–1000000字符的非空内容。`);
    const target = resolveLongTarget(index, {
      id,
      document,
      ...(chapter_id ? { chapter_id } : {})
    });
    if (target.addressing !== "document" || target.inlineContent !== undefined)
      throw new Error("连续性写入目标不可用。");
    const live = await ctx.readWholeDocument(target.file, signal);
    if (
      live.content.trim() &&
      ctx.fullyReadDocuments.get(live.file.id)?.content !== live.content
    )
      throw new Error(
        `修改非空连续性文件前须先 read 全文：${id}/${document}。`
      );
    changes.push({
      target,
      operation: "write",
      beforeText: live.content,
      afterText: content,
      file: live.file
    });
  };
  await write(chapterCardId, "character_state", documents.chapter_end_state);
  await write(chapterCardId, "handoff", documents.handoff);
  const create = (
    kind: "continuity_world_reveals" | "continuity_character",
    meta: { character_id?: string; document?: "current_state" },
    content: string
  ) => {
    if (!content.trim() || content.length > 1_000_000)
      throw new Error("连续性文件需要1–1000000字符的非空内容。");
    const created = createContinuityFiles({
      kind,
      meta: { ...meta, chapter_card_id: chapterCardId },
      content,
      index,
      timestamp,
      idSeed: `${ctx.input.runId}:${toolCallId}`
    });
    operations.push(...created.operations);
    changes.push(...created.changes);
    return created;
  };
  if (documents.world_reveals !== undefined) {
    if (chapter.worldReveals)
      await write(chapterCardId, "world_reveals", documents.world_reveals);
    else create("continuity_world_reveals", {}, documents.world_reveals);
  }
  const seen = new Set<string>();
  for (const character of documents.characters ?? []) {
    if (seen.has(character.character_id))
      throw new Error("documents.characters 不能重复人物。");
    seen.add(character.character_id);
    if (
      !character.current_state.trim() ||
      !character.history.trim() ||
      character.current_state.length > 1_000_000 ||
      character.history.length > 1_000_000
    )
      throw new Error(
        "人物当前状态与历史轨迹均须为非空内容，且各不超过1000000字符。"
      );
    if (
      chapter.characterContinuity.some(
        (c) => c.characterId === character.character_id
      )
    ) {
      await write(
        character.character_id,
        "current_state",
        character.current_state,
        chapterCardId
      );
      await write(
        character.character_id,
        "history",
        character.history,
        chapterCardId
      );
    } else {
      const created = create(
        "continuity_character",
        { character_id: character.character_id, document: "current_state" },
        character.current_state
      );
      created.changes[1]!.afterText = character.history;
    }
  }
  if (foreshadowing)
    await write(chapterCardId, "foreshadowing_changes", foreshadowing);
  const result = formLongProposal(ctx, {
    toolCallId,
    changes,
    operations,
    timestamp,
    summary,
    message: "已形成连续性合并提案。",
    index,
    remember: false
  });
  if (result.details.kind !== "long-continuity-file-proposal")
    return { result };
  return {
    result,
    changes,
    timestamp,
    index: applyLongWorkspaceOperations(index, result.details.batch).snapshot
  };
}
