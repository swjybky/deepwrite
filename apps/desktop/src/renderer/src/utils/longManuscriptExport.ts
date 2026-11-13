import type {
  DeepWriteApi,
  ExportLongManuscriptInput,
  LongManuscriptExportFile,
  LongManuscriptExportMode,
  LongManuscriptExportSection,
  LongWorkspaceFileReference,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import {
  latestCommittedContinuityChapter,
  longCharacterGroupLabel
} from "../types/longWorkspace";
import { readLongDocumentFullContent } from "./longWorldbuildingSync";

const CHARACTER_FILE_LABELS = {
  coreProfile: "核心档案",
  relationships: "人物关系"
} as const;

export interface LongManuscriptExportRequest {
  readonly mode?: LongManuscriptExportMode;
  readonly sections: readonly LongManuscriptExportSection[];
  readonly manuscriptChapterCardIds: readonly string[];
}

function ordered<T extends { order: number; id: string }>(
  values: readonly T[]
): T[] {
  return [...values].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  );
}

function lines(values: Array<string | null | undefined>): string {
  return `${values.filter((value): value is string => Boolean(value?.trim())).join("\n\n")}\n`;
}

export async function createLongManuscriptExportInput(input: {
  api: DeepWriteApi["long"];
  bookId: string;
  title: string;
  workspace: LongWorkspaceIndexSnapshot;
  sections: readonly LongManuscriptExportSection[];
  manuscriptChapterCardIds?: readonly string[];
}): Promise<ExportLongManuscriptInput> {
  const selected = new Set(input.sections);
  const files: LongManuscriptExportFile[] = [];
  const contentCache = new Map<string, Promise<string>>();
  const read = (file: LongWorkspaceFileReference): Promise<string> => {
    const existing = contentCache.get(file.id);
    if (existing) return existing;
    const pending = readLongDocumentFullContent(
      input.api.readDocument,
      input.bookId,
      file.id
    );
    contentCache.set(file.id, pending);
    return pending;
  };
  const add = async (
    path: string[],
    file: LongWorkspaceFileReference
  ): Promise<void> => {
    files.push({ path, content: await read(file) });
  };
  const addContent = (path: string[], content: string): void => {
    files.push({ path, content });
  };

  if (selected.has("worldbuilding")) {
    for (const category of ordered(input.workspace.worldbuilding)) {
      if (category.format === "text") {
        await add(["世界观", category.title], category.file);
        continue;
      }
      if (category.overview) {
        await add(["世界观", category.title, "概览"], category.overview);
      }
      for (const item of ordered(category.items)) {
        await add(["世界观", category.title, item.title], item.file);
      }
    }
  }

  if (selected.has("characters")) {
    if (input.workspace.characterOverview) {
      await add(["人物", "概览"], input.workspace.characterOverview);
    }
    const fileByCharacter = new Map(
      input.workspace.characterFiles.map((entry) => [entry.characterId, entry])
    );
    for (const character of ordered(input.workspace.characters)) {
      const entry = fileByCharacter.get(character.id);
      if (!entry) continue;
      const base = [
        "人物",
        longCharacterGroupLabel(
          character.group,
          input.workspace.characterTypes
        ),
        character.name
      ];
      for (const key of Object.keys(CHARACTER_FILE_LABELS) as Array<
        keyof typeof CHARACTER_FILE_LABELS
      >) {
        await add([...base, CHARACTER_FILE_LABELS[key]], entry[key]);
      }
      const latest = latestCommittedContinuityChapter(
        input.workspace,
        (chapter) =>
          chapter.characterContinuity.some(
            ({ characterId }) => characterId === character.id
          )
      )?.characterContinuity.find(
        ({ characterId }) => characterId === character.id
      );
      if (latest) {
        await add([...base, "当前状态"], latest.currentState);
        await add([...base, "历史轨迹"], latest.history);
      } else {
        addContent([...base, "当前状态"], "");
        addContent([...base, "历史轨迹"], "");
      }
    }
  }

  const volumeById = new Map(
    input.workspace.plot.volumes.map((value) => [value.id, value])
  );
  const arcById = new Map(
    input.workspace.plot.arcs.map((value) => [value.id, value])
  );
  const cardById = new Map(
    input.workspace.plot.chapterCards.map((value) => [value.id, value])
  );
  const eventById = new Map(
    input.workspace.plot.storyEvents.map((value) => [value.id, value])
  );
  const characterById = new Map(
    input.workspace.characters.map((value) => [value.id, value])
  );
  const chapterFiles = new Map(
    input.workspace.chapters.map((entry) => [entry.chapterCardId, entry])
  );

  if (selected.has("plot")) {
    await add(["剧情", "全书故事线"], input.workspace.bookLine);
    for (const volume of ordered(input.workspace.plot.volumes)) {
      files.push({
        path: ["剧情", volume.title, "卷概览"],
        content: lines([volume.summary])
      });
      for (const arc of ordered(
        input.workspace.plot.arcs.filter(
          (value) => value.volumeId === volume.id
        )
      )) {
        const arcBase = ["剧情", volume.title, arc.title];
        files.push({
          path: [...arcBase, "剧情点概览"],
          content: lines([arc.summary, arc.outline])
        });
        for (const storyPlot of ordered(
          input.workspace.plot.storyPlots.filter(
            (value) => value.arcId === arc.id
          )
        )) {
          await add([...arcBase, "故事情节", storyPlot.title], storyPlot.file);
        }
        const cards = input.workspace.plot.chapterCards
          .filter((value) => value.primaryArcId === arc.id)
          .sort(
            (left, right) =>
              left.narrativeOrder - right.narrativeOrder ||
              left.id.localeCompare(right.id)
          );
        for (const card of cards) {
          const chapter = chapterFiles.get(card.id);
          if (chapter)
            await add([...arcBase, "章节卡", card.title], chapter.card);
        }
      }
    }

    for (const event of [...input.workspace.plot.storyEvents].sort(
      (left, right) =>
        left.storyOrder - right.storyOrder || left.id.localeCompare(right.id)
    )) {
      files.push({
        path: ["剧情", "故事时间线", event.title],
        content: lines([
          `时间：${event.timeLabel || "未设置"}`,
          `地点：${event.location || "未设置"}`,
          `所属剧情点：${
            event.arcIds
              .map((id) => arcById.get(id)?.title)
              .filter(Boolean)
              .join("、") || "未设置"
          }`,
          `相关人物：${
            event.characterIds
              .map((id) => characterById.get(id)?.name)
              .filter(Boolean)
              .join("、") || "未设置"
          }`,
          event.summary
        ])
      });
    }

    if (input.workspace.plot.eventConnections.length) {
      files.push({
        path: ["剧情", "事件关系"],
        content: lines(
          input.workspace.plot.eventConnections.map((connection) => {
            const source =
              eventById.get(connection.sourceEventId)?.title ?? "未知事件";
            const target =
              eventById.get(connection.targetEventId)?.title ?? "未知事件";
            return `${source} → ${target}\n关系：${connection.type}${connection.note ? `\n说明：${connection.note}` : ""}`;
          })
        )
      });
    }

    for (const foreshadowing of input.workspace.plot.foreshadowing) {
      files.push({
        path: ["剧情", "伏笔", foreshadowing.title],
        content: lines([
          `状态：${foreshadowing.status}`,
          `核心问题：${foreshadowing.coreQuestion}`,
          foreshadowing.hiddenTruth
            ? `隐藏真相：${foreshadowing.hiddenTruth}`
            : null,
          `预期读者效果：${foreshadowing.expectedReaderEffect}`,
          ...ordered(foreshadowing.beats).map((beat) => {
            const anchors = [
              beat.volumeId ? volumeById.get(beat.volumeId)?.title : null,
              beat.arcId ? arcById.get(beat.arcId)?.title : null,
              beat.eventId ? eventById.get(beat.eventId)?.title : null,
              beat.chapterCardId
                ? cardById.get(beat.chapterCardId)?.title
                : null,
              beat.plannedScope || null
            ]
              .filter(Boolean)
              .join(" / ");
            return `节点 ${beat.order}（${beat.type}）\n位置：${anchors || "未设置"}\n状态：${beat.status}${beat.note ? `\n说明：${beat.note}` : ""}`;
          })
        ])
      });
    }
  }

  if (selected.has("manuscript")) {
    const volumeOrder = new Map(
      input.workspace.plot.volumes.map((volume) => [volume.id, volume.order])
    );
    const cards = [...input.workspace.plot.chapterCards].sort(
      (left, right) =>
        (volumeOrder.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
          (volumeOrder.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
        left.narrativeOrder - right.narrativeOrder ||
        left.id.localeCompare(right.id)
    );
    const allowed =
      input.manuscriptChapterCardIds === undefined
        ? null
        : new Set(input.manuscriptChapterCardIds);
    for (const card of cards) {
      if (allowed && !allowed.has(card.id)) continue;
      const chapter = chapterFiles.get(card.id);
      if (chapter) await add(["正文", card.title], chapter.body);
    }
  }

  return {
    book: { projectType: "long", projectId: input.bookId },
    title: input.title,
    sections: [...input.sections],
    files
  };
}
