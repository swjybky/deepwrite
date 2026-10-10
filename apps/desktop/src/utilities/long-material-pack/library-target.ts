import { access } from "node:fs/promises";
import { join } from "node:path";
import {
  LONG_MATERIAL_KINDS,
  LONG_MATERIAL_LIBRARY_NAMES,
  type CatalogIndexSnapshot,
  type LongMaterialLibraryIds,
  type MaterialKind
} from "@deepwrite/contracts";
import type { FolderCatalogStore } from "../folder-catalog-store";
import { decompositionResourceId } from "../long-book-decomposition/identity";

export interface LongMaterialTarget {
  groupId: string;
  groupTitle: string;
  libraryIds: LongMaterialLibraryIds;
  libraryTitles: Record<MaterialKind, string>;
  /** Libraries this call had to create; their entries are all new. */
  created: Set<string>;
}

export interface LongMaterialTargetPaths {
  materials: string;
  groups: string;
}

/** Ids are derived from the pack, so a retried preparation finds its own. */
export function plannedLibraryIds(packId: string): LongMaterialLibraryIds {
  return Object.fromEntries(
    LONG_MATERIAL_KINDS.map((kind) => [
      kind,
      decompositionResourceId("material", packId, `library:${kind}`)
    ])
  ) as LongMaterialLibraryIds;
}

export function plannedGroupId(packId: string): string {
  return decompositionResourceId("material-group", packId, "group");
}

function uniqueTitle(title: string, used: readonly string[]) {
  let result = title;
  for (let number = 2; used.includes(result); number++)
    result = `${title} (${number})`;
  return result;
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Titles as the catalog currently shows them; users may have renamed them. */
export function targetTitles(
  snapshot: CatalogIndexSnapshot,
  libraryIds: LongMaterialLibraryIds,
  bookTitle: string
): Record<MaterialKind, string> {
  return Object.fromEntries(
    LONG_MATERIAL_KINDS.map((kind) => [
      kind,
      snapshot.materials.find(({ id }) => id === libraryIds[kind])?.title ??
        `《${bookTitle}》${LONG_MATERIAL_LIBRARY_NAMES[kind]}`
    ])
  ) as Record<MaterialKind, string>;
}

/**
 * Creates the group and its five long libraries, or re-creates a library
 * that went missing. A library whose kind changed is never written to.
 */
export async function prepareLongMaterialTarget(
  catalog: FolderCatalogStore,
  input: {
    packId: string;
    bookTitle: string;
    groupTitle: string;
    groupId?: string;
    libraryIds?: LongMaterialLibraryIds;
    paths: LongMaterialTargetPaths;
  }
): Promise<LongMaterialTarget> {
  const libraryIds = input.libraryIds ?? plannedLibraryIds(input.packId);
  const groupId = input.groupId ?? plannedGroupId(input.packId);
  let snapshot = await catalog.indexSnapshot();
  const created = new Set<string>();
  for (const kind of LONG_MATERIAL_KINDS) {
    const library = snapshot.materials.find(
      ({ id }) => id === libraryIds[kind]
    );
    if (library) {
      if (library.materialType !== "long" || library.materialKind !== kind)
        throw new Error(
          `分组中的${LONG_MATERIAL_LIBRARY_NAMES[kind]}库类型已变化，请另建新分组。`
        );
      continue;
    }
    const path = join(input.paths.materials, libraryIds[kind]);
    created.add(libraryIds[kind]);
    if (await exists(path)) await catalog.openMaterialProject(path);
    else
      await catalog.createLibrary({
        domain: "material",
        id: libraryIds[kind],
        name: uniqueTitle(
          `《${input.bookTitle}》${LONG_MATERIAL_LIBRARY_NAMES[kind]}`,
          snapshot.materials.map(({ title }) => title)
        ),
        libraryType: "long",
        materialKind: kind,
        parentDirectory: input.paths.materials
      });
    snapshot = await catalog.indexSnapshot();
  }
  let group = snapshot.materialGroups.find(({ id }) => id === groupId);
  if (!group) {
    const path = join(input.paths.groups, groupId);
    if (await exists(path)) await catalog.openMaterialProject(path);
    else
      await catalog.createLibraryGroup({
        domain: "material",
        id: groupId,
        name: uniqueTitle(
          input.groupTitle,
          snapshot.materialGroups.map(({ title }) => title)
        ),
        members: libraryIds,
        parentDirectory: input.paths.groups
      });
    snapshot = await catalog.indexSnapshot();
    group = snapshot.materialGroups.find(({ id }) => id === groupId);
  }
  if (!group) throw new Error("素材分组创建失败，请重试。");
  if (
    LONG_MATERIAL_KINDS.some((kind) => group.members[kind] !== libraryIds[kind])
  ) {
    await catalog.updateLibraryGroup({
      domain: "material",
      groupId,
      members: { ...group.members, ...libraryIds }
    });
    snapshot = await catalog.indexSnapshot();
  }
  return {
    groupId,
    groupTitle: group.title,
    libraryIds,
    libraryTitles: targetTitles(snapshot, libraryIds, input.bookTitle),
    created
  };
}
