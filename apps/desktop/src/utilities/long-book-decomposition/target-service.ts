import { access } from "node:fs/promises";
import { join } from "node:path";
import {
  type LongBookDecompositionJob,
  type LongBookAnalysisChapter
} from "@deepwrite/contracts";
import type { FolderCatalogStore } from "../folder-catalog-store";
import type { LongWorkspaceService } from "../long-workspace-service";
import { readSecureTextFile } from "../long-project-store/io";
import {
  DecompositionJobStateStore,
  type TargetPreparation
} from "./job-state-store";
import { decompositionResourceId } from "./identity";
import { assertDecompositionMaterialCapacity } from "./capacity";
import { appendDecompositionSourceChapters } from "./source-chapters";

const kinds = ["character", "plot", "draft", "other", "gimmick"] as const;
const kindNames = {
  character: "人设",
  plot: "剧情",
  draft: "正文",
  other: "其他",
  gimmick: "梗"
};
export function planDecompositionTarget(
  job: LongBookDecompositionJob,
  paths: TargetPreparation["paths"]
): TargetPreparation {
  return {
    operationId: decompositionResourceId("ldprepare", job.id, "target"),
    bookId:
      job.targetSelection.action === "select" &&
      job.targetSelection.kind === "long"
        ? job.targetSelection.bookId
        : decompositionResourceId("longbook", job.id, "book"),
    groupId:
      job.targetSelection.action === "select" &&
      job.targetSelection.kind === "material-group"
        ? job.targetSelection.groupId
        : decompositionResourceId("material-group", job.id, "group"),
    libraryIds: Object.fromEntries(
      kinds.map((kind) => [
        kind,
        decompositionResourceId("material", job.id, kind)
      ])
    ) as TargetPreparation["libraryIds"],
    paths,
    steps: []
  };
}
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
function uniqueTitle(title: string, used: string[]) {
  let result = title,
    number = 2;
  while (used.includes(result)) result = `${title} (${number++})`;
  return result;
}
export async function prepareDecompositionTarget(
  job: LongBookDecompositionJob,
  state: DecompositionJobStateStore,
  longs: LongWorkspaceService,
  catalog: FolderCatalogStore,
  chapters: readonly LongBookAnalysisChapter[]
): Promise<void> {
  const prep = await state.readPreparation(job.id);
  const title =
    job.targetSelection.action === "create"
      ? job.targetSelection.title
      : job.source.title;
  const step = async (name: string) => {
    if (!prep.steps.includes(name)) {
      prep.steps.push(name);
      await state.savePreparation(job.id, prep);
    }
  };
  if (job.mode === "continuation") {
    if (!prep.steps.includes("created")) {
      if (job.targetSelection.action === "create") {
        const path = await longs.store.findBookDirectory(
          prep.paths.book,
          prep.bookId
        );
        if (path) await longs.openAtPath(path);
        else {
          const created = await longs.store.createBook(prep.paths.book, {
            id: prep.bookId,
            title,
            genre: "其他"
          });
          await longs.openAtPath(created.projectDirectory);
        }
      }
      await step("created");
    }
    const opened = await longs.catalog.open(prep.bookId);
    if (!prep.steps.includes("source-initialized")) {
      await longs.store.transactManaged(
        opened.projectDirectory,
        async (loaded) => {
          const marker = decompositionResourceId(
            "analysis",
            job.id,
            "source-initialized"
          );
          if (loaded.index.writeReceipts?.some(({ id }) => id === marker))
            return { operations: [], result: undefined };
          if (
            loaded.index.chapters.some(
              ({ bodyStatus }) => bodyStatus === "written"
            ) ||
            loaded.index.characters.length ||
            loaded.index.worldbuilding.some((category) =>
              category.format === "list" ? category.items.length : true
            )
          )
            throw new Error("续写目标必须是空长篇。");
          for (const slot of loaded.files.values()) {
            if (slot.kind !== "markdown") continue;
            if (
              (
                await readSecureTextFile(
                  loaded.projectDirectory,
                  slot.reference.path,
                  32 * 1024 * 1024
                )
              ).content.trim()
            )
              throw new Error("续写目标包含用户内容，请选择空长篇。");
          }
          loaded.index.plot.volumes = [];
          loaded.index.plot.arcs = [];
          loaded.index.plot.chapterCards = [];
          loaded.index.chapters = [];
          loaded.index.writeReceipts = [
            ...(loaded.index.writeReceipts ?? []),
            {
              id: marker,
              path: `long/analysis/receipts/${marker}.md`,
              updatedAt: new Date().toISOString()
            }
          ];
          return {
            operations: [
              {
                path: `long/analysis/receipts/${marker}.md`,
                content: prep.operationId,
                expectedSha256: null
              }
            ],
            result: undefined
          };
        }
      );
      await step("source-initialized");
    }
    for (let i = 0; i < chapters.length; i += 200) {
      await longs.store.transactManaged(
        opened.projectDirectory,
        async (loaded) => ({
          operations: appendDecompositionSourceChapters(
            loaded.index,
            chapters.slice(i, i + 200),
            job.id,
            new Date().toISOString()
          ),
          result: undefined
        })
      );
    }
    await step("source-written");
    job.target = {
      kind: "long",
      bookId: prep.bookId,
      baseRevision: 0,
      state: "ready"
    };
  } else {
    let snapshot = await catalog.indexSnapshot();
    const group = snapshot.materialGroups.find(({ id }) => id === prep.groupId);
    if (job.targetSelection.action === "select" && !group)
      throw new Error("目标素材分组不存在。");
    for (const kind of kinds) {
      const selected = group?.members[kind];
      if (selected) {
        const library = snapshot.materials.find(({ id }) => id === selected);
        if (
          !library ||
          library.materialType !== "long" ||
          library.materialKind !== kind
        )
          throw new Error(`分组中的${kindNames[kind]}库必须是兼容的长篇库。`);
        prep.libraryIds[kind] = selected;
        await state.savePreparation(job.id, prep);
      } else if (
        !snapshot.materials.some(({ id }) => id === prep.libraryIds[kind])
      ) {
        const path = join(prep.paths.materials, prep.libraryIds[kind]);
        if (await exists(path)) await catalog.openMaterialProject(path);
        else
          await catalog.createLibrary({
            domain: "material",
            id: prep.libraryIds[kind],
            name: uniqueTitle(
              `${job.source.title}${kindNames[kind]}`,
              snapshot.materials.map(({ title }) => title)
            ),
            libraryType: "long",
            materialKind: kind,
            parentDirectory: prep.paths.materials
          });
      }
      await step(`library:${kind}`);
      snapshot = await catalog.indexSnapshot();
    }
    const current = snapshot.materialGroups.find(
      ({ id }) => id === prep.groupId
    );
    if (current)
      await catalog.updateLibraryGroup({
        domain: "material",
        groupId: prep.groupId,
        members: { ...current.members, ...prep.libraryIds }
      });
    else {
      const path = join(prep.paths.groups, prep.groupId);
      if (await exists(path)) await catalog.openMaterialProject(path);
      else
        await catalog.createLibraryGroup({
          domain: "material",
          id: prep.groupId,
          name: uniqueTitle(
            title,
            snapshot.materialGroups.map(({ title }) => title)
          ),
          members: prep.libraryIds,
          parentDirectory: prep.paths.groups
        });
    }
    await step("group-bound");
    const refreshed = await catalog.indexSnapshot();
    job.target = {
      kind: "material-group",
      groupId: prep.groupId,
      libraryIds: prep.libraryIds,
      baseRevisions: Object.fromEntries(
        refreshed.materials
          .filter(({ id }) => Object.values(prep.libraryIds).includes(id))
          .map(({ id, projectRevision }) => [id, projectRevision ?? 0])
      ),
      state: "ready"
    };
  }
  await assertDecompositionMaterialCapacity(job, catalog);
  job.phase = "read";
  job.status = "idle";
  delete job.lastError;
  await state.save(job);
}
