import {
  DeleteCatalogProjectInputSchema,
  type DeleteCatalogProjectInput,
  type DeleteCatalogProjectResult,
  type CatalogLibraryGroup
} from "@deepwrite/contracts";
import { randomHex8 } from "@deepwrite/shared";
import { rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { secureProjectRoot } from "./paths-io";
import type {
  FolderCatalogProjectDomain,
  FolderCatalogRegistry,
  RegistryProject
} from "./registry-types";
import type { OpenFolderCatalogProjectResult } from "./types";

interface ProjectDeletionContext {
  now(): string;
  readProject(
    directory: string,
    domain: FolderCatalogProjectDomain,
    id: string
  ): Promise<OpenFolderCatalogProjectResult>;
  assertBaseRevision(expected: number | undefined, actual: number): void;
  writeRegistry(registry: FolderCatalogRegistry): Promise<void>;
}

function containsDirectory(parent: string, child: string): boolean {
  const offset = relative(parent, child);
  return (
    offset === "" ||
    (!isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`))
  );
}

/** Run under the catalog write queue; publish all removals in one registry commit. */
export async function deleteRegisteredProject(
  registry: FolderCatalogRegistry,
  rawInput: DeleteCatalogProjectInput,
  context: ProjectDeletionContext
): Promise<DeleteCatalogProjectResult> {
  const input = DeleteCatalogProjectInputSchema.parse(rawInput);
  const { projectId, domain } = input;
  const registryDomain =
    domain === "material"
      ? "material-library"
      : domain === "skill"
        ? "skill-library"
        : domain;
  const registration = registry.projects.find(
    (project) => project.id === projectId && project.domain === registryDomain
  );
  if (!registration) return { projectId, domain, deleted: false };

  const opened = await context.readProject(
    registration.projectDirectory,
    registryDomain,
    projectId
  );
  context.assertBaseRevision(input.baseProjectRevision, opened.revision);
  const isGroup = domain === "material-group" || domain === "skill-group";
  const projects: RegistryProject[] = [registration];
  const deletedMemberLibraryIds: string[] = [];
  if (isGroup) {
    const group = opened.resource as CatalogLibraryGroup;
    const memberDomain =
      domain === "material-group" ? "material-library" : "skill-library";
    for (const libraryId of new Set(group.memberIds)) {
      if (!libraryId) continue;
      const member = registry.projects.find(
        (project) => project.id === libraryId && project.domain === memberDomain
      );
      // Unregistered references have no authorized local path to delete.
      if (!member) continue;
      await context.readProject(
        member.projectDirectory,
        memberDomain,
        libraryId
      );
      projects.push(member);
      deletedMemberLibraryIds.push(libraryId);
    }
  }

  // Validate every target before moving anything. A member may live inside the
  // group folder; stage only outer roots so nested projects move together.
  const directories = await Promise.all(
    projects.map((project) => secureProjectRoot(project.projectDirectory))
  );
  const roots = directories.filter(
    (directory, index) =>
      !directories.some(
        (parent, parentIndex) =>
          parentIndex !== index && containsDirectory(parent, directory)
      )
  );
  const removedProjects = new Set(projects);
  for (const project of registry.projects) {
    if (
      !removedProjects.has(project) &&
      roots.some((root) =>
        containsDirectory(root, resolve(project.projectDirectory))
      )
    ) {
      throw new Error("待删除文件夹内还有不属于本次删除范围的已注册项目。");
    }
  }

  const staged: { original: string; temporary: string }[] = [];
  try {
    for (const directory of roots) {
      const temporary = join(
        dirname(directory),
        `.deepwrite-deleting-${randomHex8()}`
      );
      await rename(directory, temporary);
      staged.push({ original: directory, temporary });
    }
    await context.writeRegistry({
      ...registry,
      revision: registry.revision + 1,
      updatedAt: context.now(),
      projects: registry.projects.filter(
        (project) => !removedProjects.has(project)
      )
    });
  } catch (error: unknown) {
    const rollbackErrors: unknown[] = [];
    for (const { original, temporary } of [...staged].reverse()) {
      try {
        await rename(temporary, original);
      } catch (rollbackError: unknown) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "项目删除失败，且无法完整恢复本地文件夹。"
      );
    }
    throw error;
  }

  // The registry has committed. Cleanup failures must not make a retry appear
  // necessary when the projects are already removed from the catalog.
  await Promise.allSettled(
    staged.map(({ temporary }) =>
      rm(temporary, { recursive: true, force: true })
    )
  );
  return {
    projectId,
    domain,
    deleted: true,
    ...(isGroup ? { deletedMemberLibraryIds } : {})
  };
}
