import type {
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";

type MutationModule = typeof import("../../types/longStructureMutations");

export interface LongNavigationDeleteInput {
  kind: "character" | "volume" | "plotPoint" | "chapterCard";
  id: string;
  title: string;
}

export interface LongNavigationDeletion {
  batch: LongWorkspaceOperationBatch;
  label: string;
  title: string;
}

function longNavigationDeletePreviewKey(
  bookId: string,
  input: Pick<LongNavigationDeleteInput, "kind" | "id">
): string {
  return `${bookId}\0${input.kind}\0${input.id}`;
}

export function createLongNavigationDeletePreviewTimes() {
  const times = new Map<string, string>();
  const requests = new Map<string, number>();
  let nextRequest = 0;
  return {
    begin(
      bookId: string,
      input: Pick<LongNavigationDeleteInput, "kind" | "id">
    ): number {
      const request = ++nextRequest;
      requests.set(longNavigationDeletePreviewKey(bookId, input), request);
      return request;
    },
    remember(
      bookId: string,
      input: Pick<LongNavigationDeleteInput, "kind" | "id">,
      updatedAt: string,
      request: number
    ): void {
      const key = longNavigationDeletePreviewKey(bookId, input);
      if (requests.get(key) !== request) return;
      times.set(key, updatedAt);
    },
    timestampFor(
      bookId: string,
      input: Pick<LongNavigationDeleteInput, "kind" | "id">
    ): string | undefined {
      return times.get(longNavigationDeletePreviewKey(bookId, input));
    },
    clear(
      bookId: string,
      input: Pick<LongNavigationDeleteInput, "kind" | "id">
    ): void {
      const key = longNavigationDeletePreviewKey(bookId, input);
      times.delete(key);
      requests.delete(key);
    }
  };
}

export async function buildLongNavigationDeleteBatch(
  loadLongStructureMutationModule: () => Promise<MutationModule>,
  index: LongWorkspaceIndexSnapshot,
  input: LongNavigationDeleteInput,
  updatedAt?: string
): Promise<LongNavigationDeletion> {
  const { createLongStructureMutationBuilder } =
    await loadLongStructureMutationModule();
  const builder = createLongStructureMutationBuilder(
    index,
    updatedAt ? { now: () => updatedAt } : undefined
  );
  if (input.kind === "character") {
    const target = index.characters.find(({ id }) => id === input.id);
    if (!target) throw new Error("该人物已不存在，请刷新后重试。");
    return {
      batch: builder.deleteCharacter(target.id),
      label: "人物",
      title: target.name
    };
  }
  if (input.kind === "volume") {
    const target = index.plot.volumes.find(({ id }) => id === input.id);
    if (!target) throw new Error("该分卷已不存在，请刷新后重试。");
    return {
      batch: builder.deleteVolume(target.id),
      label: "分卷",
      title: target.title
    };
  }
  if (input.kind === "plotPoint") {
    const target = index.plot.arcs.find(({ id }) => id === input.id);
    if (!target) throw new Error("该剧情点已不存在，请刷新后重试。");
    return {
      batch: builder.deleteArc(target.id),
      label: "剧情点",
      title: target.title
    };
  }
  const target = index.plot.chapterCards.find(({ id }) => id === input.id);
  if (!target) throw new Error("该章卡已不存在，请刷新后重试。");
  return {
    batch: builder.deleteChapter(target.id),
    label: "章卡",
    title: target.title
  };
}
