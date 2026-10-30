import {
  longWorldbuildingOverviewFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingItemFileId,
  longWorldbuildingItemContentPath,
  type LongBookDecompositionJob,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import type { ProjectTransactionFileOperation } from "../project-transaction";
import { readSecureTextFile } from "../long-project-store/io";
import type { LoadedLongProject } from "../long-project-store/types";
import { decompositionResourceId } from "./identity";
import type { NativeAssetWriter } from "./long-native-assets";

type LongWorldbuildingCategory =
  LongWorkspaceIndexSnapshot["worldbuilding"][number];

/**
 * An empty continuation target takes the profile's categories in place of the
 * new-book defaults (规则、势力……), so unused defaults never linger beside them.
 * The caller has already checked that every category and file is empty.
 */
export async function resetWorldCategoriesToProfile(
  job: LongBookDecompositionJob,
  loaded: LoadedLongProject
): Promise<ProjectTransactionFileOperation[]> {
  const operations: ProjectTransactionFileOperation[] = [];
  for (const category of loaded.index.worldbuilding) {
    const files =
      category.format === "text"
        ? [category.file]
        : [
            ...(category.overview ? [category.overview] : []),
            ...category.items.map(({ file }) => file)
          ];
    for (const { path } of files) {
      try {
        const { sha256 } = await readSecureTextFile(
          loaded.projectDirectory,
          path,
          32 * 1024 * 1024
        );
        operations.push({ action: "delete", path, expectedSha256: sha256 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  const now = new Date().toISOString();
  loaded.index.worldbuilding = job.profile.worldCategories.map(
    ({ id: key, title }, index) => {
      const id = decompositionResourceId("world", job.id, key);
      const overview = {
        id: longWorldbuildingOverviewFileId(id),
        path: longWorldbuildingOverviewContentPath(id),
        updatedAt: now
      };
      operations.push({
        path: overview.path,
        content: "",
        expectedSha256: null
      });
      return {
        id,
        title,
        order: index + 1,
        format: "list" as const,
        contentAuthority: "files" as const,
        overview,
        items: []
      };
    }
  );
  return operations;
}

/**
 * Targets prepared before the reset above still carry the default list
 * categories. Reuse an empty one with the same title instead of adding a
 * duplicate beside it.
 */
function claimWorldCategory(
  job: LongBookDecompositionJob,
  index: LongWorkspaceIndexSnapshot,
  unitId: string,
  key: string,
  title: string
): LongWorldbuildingCategory | undefined {
  const ownedId = decompositionResourceId("world", job.id, key);
  const referenced = (id: string, own: boolean) =>
    Object.entries(job.units).some(
      ([other, unit]) =>
        (other === unitId) === own &&
        unit.outputRefs.some(({ resourceId }) => resourceId === id)
    );
  return (
    index.worldbuilding.find(({ id }) => id === ownedId) ??
    index.worldbuilding.find(({ id }) => referenced(id, true)) ??
    index.worldbuilding.find(
      (category) =>
        category.format === "list" &&
        category.title.trim() === title.trim() &&
        !category.items.length &&
        !referenced(category.id, false)
    )
  );
}
export async function applyWorldCategory(
  job: LongBookDecompositionJob,
  index: LongWorkspaceIndexSnapshot,
  unitId: string,
  key: string,
  title: string,
  content: {
    overview: string;
    items: Array<{ title: string; content: string }>;
  },
  writer: NativeAssetWriter
) {
  const now = new Date().toISOString();
  const ref = (id: string, path: string) => ({ id, path, updatedAt: now });
  let category = claimWorldCategory(job, index, unitId, key, title);
  if (!category) {
    const id = decompositionResourceId("world", job.id, key);
    category = {
      id,
      title,
      order: index.worldbuilding.length + 1,
      format: "list",
      contentAuthority: "files",
      overview: ref(
        longWorldbuildingOverviewFileId(id),
        longWorldbuildingOverviewContentPath(id)
      ),
      items: []
    };
    index.worldbuilding.push(category);
  }
  if (category.format !== "list" || !category.overview)
    throw new Error("世界观目标格式不匹配。");
  const categoryId = category.id;
  await writer.file(category.overview, content.overview);
  for (const [number, item] of content.items.entries()) {
    const id = decompositionResourceId("worlditem", job.id, `${key}:${number}`);
    let object = category.items.find((entry) => entry.id === id);
    if (!object) {
      object = {
        id,
        title: item.title,
        order: category.items.length + 1,
        file: ref(
          longWorldbuildingItemFileId(id),
          longWorldbuildingItemContentPath(categoryId, id)
        )
      };
      category.items.push(object);
    }
    await writer.file(object.file, item.content);
  }
  writer.object(categoryId, category);
}
