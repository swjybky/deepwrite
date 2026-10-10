import { createCatalogId } from "@deepwrite/shared";
import {
  MaterialLibraryGroupSchema,
  MaterialLibrarySchema,
  SkillLibraryGroupSchema,
  SkillLibrarySchema,
  nextLibraryPackageTitle,
  type LibraryPackageResolvedImport
} from "@deepwrite/contracts";
import type {
  FolderCatalogProjectDomain,
  FolderCatalogResource
} from "./types";

export interface LibraryPackageProjectPlan {
  domain: FolderCatalogProjectDomain;
  parentDirectory: string;
  resource: FolderCatalogResource;
}

export interface LibraryPackageProjects {
  plans: LibraryPackageProjectPlan[];
  libraryIds: string[];
  groupId?: string;
  entryCount: number;
}

/**
 * New, independent projects for one import: fresh ids and timestamps, titles
 * numbered past existing ones, never built-in or linked to a marketplace.
 */
export function buildLibraryPackageProjects(
  resolved: LibraryPackageResolvedImport,
  context: {
    libraryTitles: readonly string[];
    groupTitles: readonly string[];
    parents: { library: string; group: string };
    now: string;
  }
): LibraryPackageProjects {
  const { now } = context;
  const usedTitles = [...context.libraryTitles];
  const material = resolved.domain === "material";
  const plans: LibraryPackageProjectPlan[] = [];
  const libraryIds: string[] = [];
  let entryCount = 0;

  for (const library of resolved.libraries) {
    const title = nextLibraryPackageTitle(library.title, usedTitles);
    usedTitles.push(title);
    const entries = library.entries.map((entry) => ({
      id: createCatalogId(material ? "material-entry" : "skill-entry"),
      stageId: entry.stageId,
      title: entry.title,
      body: entry.content,
      createdAt: now,
      updatedAt: now
    }));
    entryCount += entries.length;
    const resource = material
      ? MaterialLibrarySchema.parse({
          id: createCatalogId("material"),
          title,
          materialType: library.libraryType,
          materialKind: library.kind,
          parentGenre: library.parentGenre,
          subGenre: library.subGenre,
          overview: library.overview,
          entries,
          createdAt: now,
          updatedAt: now
        })
      : SkillLibrarySchema.parse({
          id: createCatalogId("skill"),
          title,
          skillType: library.libraryType,
          skillKind: library.kind,
          overview: library.overview,
          isBuiltin: false,
          entries,
          createdAt: now,
          updatedAt: now
        });
    libraryIds.push(resource.id);
    plans.push({
      domain: material ? "material-library" : "skill-library",
      parentDirectory: context.parents.library,
      resource
    });
  }

  if (!resolved.group) return { plans, libraryIds, entryCount };
  const members = Object.fromEntries(
    resolved.group.slots.map((slot, index) => [slot, libraryIds[index]])
  );
  const group = (
    material ? MaterialLibraryGroupSchema : SkillLibraryGroupSchema
  ).parse({
    id: createCatalogId(material ? "material-group" : "skill-group"),
    title: nextLibraryPackageTitle(resolved.group.title, context.groupTitles),
    members,
    createdAt: now,
    updatedAt: now
  });
  plans.push({
    domain: material ? "material-group" : "skill-group",
    parentDirectory: context.parents.group,
    resource: group
  });
  return { plans, libraryIds, groupId: group.id, entryCount };
}
