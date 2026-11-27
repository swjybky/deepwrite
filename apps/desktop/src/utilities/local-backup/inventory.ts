import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import {
  AcademicBookSchema,
  BookProjectManifestSchema,
  BookSchema,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  MaterialGroupProjectManifestSchema,
  MaterialLibraryProjectManifestSchema,
  MysteryBookManifestSchema,
  MysteryProjectRegistrySchema,
  SkillGroupProjectManifestSchema,
  SkillLibraryProjectManifestSchema,
  assertLongProjectIndexMetadata,
  createDefaultCreativePlotStages,
  flattenMaterialIdsByKind,
  flattenSkillIdsByKind,
  type CreativePlotStage,
  type LibraryOrganization,
  type LocalBackupInventoryItem,
  type LocalBackupInventorySnapshot,
  type LocalBackupItemKind,
  type LocalBackupWorkSubtype,
  type LongBookSummary,
  type MysteryProjectRegistry
} from "@deepwrite/contracts";
import { isRecord, nowIso } from "@deepwrite/shared";
import {
  isNodeError,
  readJsonIfExists,
  sha256Hex
} from "@deepwrite/shared/node";
import type { FolderCatalogRegistry } from "../folder-catalog-store/registry-types";
import { stripLegacyLongVersionMetadata } from "../long-version-metadata";
import type { LongProjectRegistry } from "../long-project-registration";
import { recoverProjectTransaction } from "../project-transaction";
import { LocalBackupError } from "./errors";

const SKIP_BASENAMES = new Set([
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
  ".draft-recovery.json",
  ".deepwrite"
]);

export interface RegistrySnapshotBundle {
  catalog: FolderCatalogRegistry;
  long: LongProjectRegistry;
  mystery: MysteryProjectRegistry;
}

export interface DiscoveredFileEntry {
  relativePath: string;
  fullPath: string;
  sizeBytes: number;
}

export interface DiscoveredBackupProject {
  key: string;
  kind: LocalBackupItemKind;
  id: string;
  title: string;
  workSubtype?: LocalBackupWorkSubtype;
  projectDirectory: string;
  empty: boolean;
  isUnbound: boolean;
  isBuiltin: boolean;
  linkedMaterialIds: string[];
  linkedSkillIds: string[];
  memberIds?: string[];
  files: DiscoveredFileEntry[];
  rawBytes: number;
}

export function backupItemKey(kind: LocalBackupItemKind, id: string): string {
  return `${kind}:${id}`;
}

function shouldSkipProjectEntryName(name: string): boolean {
  if (SKIP_BASENAMES.has(name)) return true;
  if (name.startsWith(".deepwrite-")) return true;
  if (/^identity\.corrupt-.*\.json$/u.test(name)) return true;
  if (name.endsWith(".tmp") || name.endsWith(".part")) return true;
  return false;
}

export function computeProjectFilesHash(
  files: ReadonlyArray<{ relativePath: string; bytes: Buffer }>
): { hash: string; sizeBytes: number } {
  const sorted = [...files].sort((left, right) =>
    left.relativePath < right.relativePath
      ? -1
      : left.relativePath > right.relativePath
        ? 1
        : 0
  );
  return computeProjectHashFromDigests(
    sorted.map((file) => ({
      relativePath: file.relativePath,
      sizeBytes: file.bytes.byteLength,
      sha256: sha256Hex(file.bytes)
    }))
  );
}

export function computeProjectHashFromDigests(
  files: ReadonlyArray<{
    relativePath: string;
    sizeBytes: number;
    sha256: string;
  }>
): { hash: string; sizeBytes: number } {
  const sorted = [...files].sort((left, right) =>
    left.relativePath < right.relativePath
      ? -1
      : left.relativePath > right.relativePath
        ? 1
        : 0
  );
  const digest = createHash("sha256");
  let sizeBytes = 0;
  for (const file of sorted) {
    sizeBytes += file.sizeBytes;
    digest.update(file.relativePath);
    digest.update("\0");
    digest.update(String(file.sizeBytes));
    digest.update("\0");
    digest.update(file.sha256);
    digest.update("\n");
  }
  return { hash: digest.digest("hex"), sizeBytes };
}

export async function readAllRegistries(
  userDataPath: string
): Promise<RegistrySnapshotBundle> {
  const catalogRaw =
    (await readJsonWithBak(join(userDataPath, "catalog-registry.json"))) ??
    emptyCatalogRegistry();
  const longRaw =
    (await readJsonWithBak(join(userDataPath, "long-project-registry.json"))) ??
    emptyLongRegistry();
  const mysteryRaw = (await readJsonIfExists(
    join(userDataPath, "mystery-projects.json")
  )) ?? {
    version: 1,
    projects: []
  };

  const catalog = normalizeCatalogRegistry(catalogRaw);
  const long = normalizeLongRegistry(longRaw);
  const mystery = MysteryProjectRegistrySchema.parse(mysteryRaw);
  return { catalog, long, mystery };
}

async function readJsonWithBak(path: string): Promise<unknown> {
  try {
    const primary = await readJsonIfExists(path);
    if (primary !== undefined) return primary;
  } catch {
    // Fall back to backup copy when primary JSON is unreadable.
  }
  return await readJsonIfExists(`${path}.bak`);
}

function emptyCatalogRegistry(): FolderCatalogRegistry {
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt: nowIso(),
    sourceCatalogMigrated: false,
    creativePlotStages: createDefaultCreativePlotStages(),
    projects: []
  };
}

function emptyLongRegistry(): LongProjectRegistry {
  return {
    schemaVersion: 2,
    updatedAt: nowIso(),
    projects: []
  };
}

function normalizeCatalogRegistry(raw: unknown): FolderCatalogRegistry {
  if (
    !isRecord(raw) ||
    raw.schemaVersion !== 1 ||
    !Array.isArray(raw.projects)
  ) {
    throw new LocalBackupError(
      "local_backup.operation_failed",
      "作品与资料库注册表格式无效，请先重启应用修复后重试。"
    );
  }
  const projects: FolderCatalogRegistry["projects"] = [];
  for (const item of raw.projects) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.domain !== "string" ||
      typeof item.projectDirectory !== "string" ||
      typeof item.registeredAt !== "string"
    ) {
      continue;
    }
    if (
      item.domain === "book" ||
      item.domain === "material-library" ||
      item.domain === "material-group" ||
      item.domain === "skill-library" ||
      item.domain === "skill-group"
    ) {
      projects.push({
        id: item.id,
        domain: item.domain,
        projectDirectory: resolve(item.projectDirectory),
        registeredAt: item.registeredAt
      });
    }
  }
  return {
    schemaVersion: 1,
    revision: typeof raw.revision === "number" ? raw.revision : 0,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : nowIso(),
    sourceCatalogMigrated: Boolean(raw.sourceCatalogMigrated),
    creativePlotStages: Array.isArray(raw.creativePlotStages)
      ? (raw.creativePlotStages as CreativePlotStage[])
      : createDefaultCreativePlotStages(),
    ...(isRecord(raw.libraryOrganization)
      ? { libraryOrganization: raw.libraryOrganization as LibraryOrganization }
      : {}),
    projects
  };
}

function normalizeLongRegistry(raw: unknown): LongProjectRegistry {
  const stripped = stripLegacyLongVersionMetadata(raw).value;
  if (!isRecord(stripped) || !Array.isArray(stripped.projects)) {
    throw new LocalBackupError(
      "local_backup.operation_failed",
      "长篇作品注册表格式无效，请先修复后重试。"
    );
  }
  const projects: LongProjectRegistry["projects"] = [];
  for (const item of stripped.projects) {
    if (
      !isRecord(item) ||
      typeof item.bookId !== "string" ||
      typeof item.projectDirectory !== "string" ||
      typeof item.registeredAt !== "string"
    ) {
      continue;
    }
    projects.push({
      bookId: item.bookId,
      projectDirectory: resolve(item.projectDirectory),
      registeredAt: item.registeredAt,
      ...(isRecord(item.summary)
        ? { summary: item.summary as LongBookSummary }
        : {}),
      ...(isRecord(item.deletion)
        ? {
            deletion: item.deletion as NonNullable<
              LongProjectRegistry["projects"][number]["deletion"]
            >
          }
        : {})
    });
  }
  return {
    schemaVersion: stripped.schemaVersion === 1 ? 1 : 2,
    updatedAt:
      typeof stripped.updatedAt === "string" ? stripped.updatedAt : nowIso(),
    projects
  };
}

/**
 * Walks a single project folder while skipping temporary/internal artifacts,
 * symlinks, and any nested subdirectories belonging to other registered projects.
 */
export async function collectSafeProjectFiles(
  projectDirectory: string,
  allRegisteredRealRoots: ReadonlySet<string>
): Promise<{
  files: DiscoveredFileEntry[];
  rawBytes: number;
  realRoot: string;
}> {
  const realRoot = await realpath(resolve(projectDirectory));
  const files: DiscoveredFileEntry[] = [];
  let rawBytes = 0;

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldSkipProjectEntryName(entry.name)) continue;
      const fullPath = join(directory, entry.name);
      let info;
      try {
        info = await lstat(fullPath);
      } catch (error: unknown) {
        if (isNodeError(error, "ENOENT")) continue;
        throw error;
      }
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        const realChild = await realpath(fullPath);
        if (realChild !== realRoot && allRegisteredRealRoots.has(realChild)) {
          continue;
        }
        await walk(fullPath);
        continue;
      }
      if (!info.isFile()) continue;
      const relativePath = relative(realRoot, fullPath)
        .split(sep)
        .join("/")
        .normalize("NFC");
      rawBytes += info.size;
      files.push({
        relativePath,
        fullPath,
        sizeBytes: info.size
      });
    }
  }

  await walk(realRoot);
  files.sort((left, right) =>
    left.relativePath < right.relativePath
      ? -1
      : left.relativePath > right.relativePath
        ? 1
        : 0
  );
  return { files, rawBytes, realRoot };
}

export async function hashProjectDirectoryOnDisk(
  projectDirectory: string,
  allRegisteredRealRoots: ReadonlySet<string>
): Promise<{ hash: string; sizeBytes: number; realRoot: string }> {
  const collected = await collectSafeProjectFiles(
    projectDirectory,
    allRegisteredRealRoots
  );
  const digests: Array<{
    relativePath: string;
    sizeBytes: number;
    sha256: string;
  }> = [];
  for (const file of collected.files) {
    const bytes = await readFile(file.fullPath);
    digests.push({
      relativePath: file.relativePath,
      sizeBytes: bytes.byteLength,
      sha256: sha256Hex(bytes)
    });
  }
  const { hash, sizeBytes } = computeProjectHashFromDigests(digests);
  return { hash, sizeBytes, realRoot: collected.realRoot };
}

export async function collectRegisteredRealRoots(
  registries: RegistrySnapshotBundle
): Promise<Set<string>> {
  const roots = new Set<string>();
  const candidates = [
    ...registries.catalog.projects.map((p) => p.projectDirectory),
    ...registries.long.projects
      .filter((p) => !p.deletion)
      .map((p) => p.projectDirectory),
    ...registries.mystery.projects.map((p) => p.projectDirectory)
  ];
  for (const dir of candidates) {
    try {
      const info = await lstat(resolve(dir));
      if (!info.isSymbolicLink() && info.isDirectory()) {
        roots.add(await realpath(resolve(dir)));
      }
    } catch {
      // Missing directories are checked when inspecting individual projects.
    }
  }
  return roots;
}

async function readManifestJson(
  projectRoot: string,
  relPath: string
): Promise<unknown> {
  const text = await readFile(join(projectRoot, relPath), "utf8");
  return JSON.parse(text) as unknown;
}

async function inspectRegisteredProject(options: {
  kind: LocalBackupItemKind;
  id: string;
  projectDirectory: string;
  allRegisteredRealRoots: ReadonlySet<string>;
  unboundIds: ReadonlySet<string>;
  strict: boolean;
}): Promise<DiscoveredBackupProject | null> {
  const {
    kind,
    id,
    projectDirectory,
    allRegisteredRealRoots,
    unboundIds,
    strict
  } = options;
  let rootInfo;
  try {
    rootInfo = await lstat(resolve(projectDirectory));
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT", "ENOTDIR")) {
      if (strict) {
        throw new LocalBackupError(
          "local_backup.inconsistent_project",
          `作品或资料库「${id}」目录不存在，请先检查或移除失效记录后再导出。`
        );
      }
      return null;
    }
    throw error;
  }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new LocalBackupError(
      "local_backup.inconsistent_project",
      `项目「${id}」目录不能是符号链接或非目录节点。`
    );
  }
  if (strict) {
    await recoverProjectTransaction(projectDirectory);
  }
  const { files, rawBytes, realRoot } = await collectSafeProjectFiles(
    projectDirectory,
    allRegisteredRealRoots
  );
  if (!files.some((file) => file.relativePath === "deepwrite.json")) {
    throw new LocalBackupError(
      "local_backup.inconsistent_project",
      `项目「${basename(realRoot)}」缺少 deepwrite.json 清单文件，已中止导出。`
    );
  }

  let rawManifest: unknown;
  try {
    rawManifest = await readManifestJson(realRoot, "deepwrite.json");
  } catch {
    throw new LocalBackupError(
      "local_backup.inconsistent_project",
      `项目「${basename(realRoot)}」的 deepwrite.json 格式损坏，请先修复后再导出。`
    );
  }

  const fallbackTitle =
    isRecord(rawManifest) && typeof rawManifest.title === "string"
      ? rawManifest.title.trim() || id
      : basename(realRoot);

  if (kind === "book") {
    const parsed = BookProjectManifestSchema.safeParse(rawManifest);
    if (!parsed.success || parsed.data.id !== id) {
      throw new LocalBackupError(
        "local_backup.inconsistent_project",
        `作品「${fallbackTitle}」的清单标识与注册表不一致，请先打开修复后再导出。`
      );
    }
    const manifest = parsed.data;
    const workSubtype: LocalBackupWorkSubtype = manifest.bookType;
    const linkedMaterialIds =
      manifest.bookType === "academic"
        ? [...manifest.linkedMaterialIds]
        : flattenMaterialIdsByKind(manifest.linkedMaterialIdsByKind);
    const linkedSkillIds =
      manifest.bookType === "academic"
        ? [...manifest.linkedSkillIds]
        : flattenSkillIdsByKind(manifest.linkedSkillIdsByKind);
    return {
      key: backupItemKey(kind, id),
      kind,
      id,
      title: manifest.title,
      workSubtype,
      projectDirectory: realRoot,
      empty: false,
      isUnbound: false,
      isBuiltin: false,
      linkedMaterialIds,
      linkedSkillIds,
      files,
      rawBytes
    };
  }

  if (kind === "long-book") {
    const strippedManifest = stripLegacyLongVersionMetadata(rawManifest).value;
    const parsedManifest =
      LongProjectManifestSchema.safeParse(strippedManifest);
    if (!parsedManifest.success || parsedManifest.data.id !== id) {
      throw new LocalBackupError(
        "local_backup.inconsistent_project",
        `长篇作品「${fallbackTitle}」的清单标识与注册表不一致，请先打开修复后再导出。`
      );
    }
    let rawIndex: unknown;
    try {
      rawIndex = await readManifestJson(realRoot, "long/index.json");
    } catch {
      throw new LocalBackupError(
        "local_backup.inconsistent_project",
        `长篇作品「${parsedManifest.data.title}」缺少或损坏了 long/index.json，请先修复后再导出。`
      );
    }
    const parsedIndex = LongWorkspaceIndexSnapshotSchema.safeParse(
      stripLegacyLongVersionMetadata(rawIndex).value
    );
    if (!parsedIndex.success) {
      throw new LocalBackupError(
        "local_backup.inconsistent_project",
        `长篇作品「${parsedManifest.data.title}」的工作区索引损坏，请先修复后再导出。`
      );
    }
    try {
      assertLongProjectIndexMetadata(parsedManifest.data, parsedIndex.data);
    } catch {
      throw new LocalBackupError(
        "local_backup.inconsistent_project",
        `长篇作品「${parsedManifest.data.title}」的 deepwrite.json 与 long/index.json 更新时间不一致，请先打开该作品完成收敛后再导出。`
      );
    }
    return {
      key: backupItemKey(kind, id),
      kind,
      id,
      title: parsedManifest.data.title,
      workSubtype: "long",
      projectDirectory: realRoot,
      empty: false,
      isUnbound: false,
      isBuiltin: false,
      linkedMaterialIds: flattenMaterialIdsByKind(
        parsedManifest.data.linkedMaterialIdsByKind
      ),
      linkedSkillIds: flattenSkillIdsByKind(
        parsedManifest.data.linkedSkillIdsByKind
      ),
      files,
      rawBytes
    };
  }

  if (kind === "mystery-book") {
    const parsed = MysteryBookManifestSchema.safeParse(rawManifest);
    if (!parsed.success || parsed.data.id !== id) {
      throw new LocalBackupError(
        "local_backup.inconsistent_project",
        `剧本杀作品「${fallbackTitle}」的清单标识与注册表不一致，请先修复后再导出。`
      );
    }
    return {
      key: backupItemKey(kind, id),
      kind,
      id,
      title: parsed.data.title,
      workSubtype: "mystery",
      projectDirectory: realRoot,
      empty: false,
      isUnbound: false,
      isBuiltin: false,
      linkedMaterialIds: [...parsed.data.linkedMaterialIds],
      linkedSkillIds: [...parsed.data.linkedSkillIds],
      files,
      rawBytes
    };
  }

  if (kind === "material-library") {
    const parsed = MaterialLibraryProjectManifestSchema.safeParse(rawManifest);
    if (!parsed.success || parsed.data.id !== id) {
      throw new LocalBackupError(
        "local_backup.inconsistent_project",
        `素材库「${fallbackTitle}」的清单标识与注册表不一致，请先修复后再导出。`
      );
    }
    return {
      key: backupItemKey(kind, id),
      kind,
      id,
      title: parsed.data.title,
      projectDirectory: realRoot,
      empty: parsed.data.entries.length === 0,
      isUnbound: unboundIds.has(id),
      isBuiltin: false,
      linkedMaterialIds: [],
      linkedSkillIds: [],
      files,
      rawBytes
    };
  }

  if (kind === "skill-library") {
    const parsed = SkillLibraryProjectManifestSchema.safeParse(rawManifest);
    if (!parsed.success || parsed.data.id !== id) {
      throw new LocalBackupError(
        "local_backup.inconsistent_project",
        `技能库「${fallbackTitle}」的清单标识与注册表不一致，请先修复后再导出。`
      );
    }
    return {
      key: backupItemKey(kind, id),
      kind,
      id,
      title: parsed.data.title,
      projectDirectory: realRoot,
      empty: parsed.data.entries.length === 0,
      isUnbound: unboundIds.has(id),
      isBuiltin: parsed.data.isBuiltin,
      linkedMaterialIds: [],
      linkedSkillIds: [],
      files,
      rawBytes
    };
  }

  if (kind === "material-group") {
    const parsed = MaterialGroupProjectManifestSchema.safeParse(rawManifest);
    if (!parsed.success || parsed.data.id !== id) {
      throw new LocalBackupError(
        "local_backup.inconsistent_project",
        `素材分组「${fallbackTitle}」的清单标识与注册表不一致，请先修复后再导出。`
      );
    }
    return {
      key: backupItemKey(kind, id),
      kind,
      id,
      title: parsed.data.title,
      projectDirectory: realRoot,
      empty: parsed.data.memberIds.length === 0,
      isUnbound: false,
      isBuiltin: false,
      linkedMaterialIds: [],
      linkedSkillIds: [],
      memberIds: [...parsed.data.memberIds],
      files,
      rawBytes
    };
  }

  const parsed = SkillGroupProjectManifestSchema.safeParse(rawManifest);
  if (!parsed.success || parsed.data.id !== id) {
    throw new LocalBackupError(
      "local_backup.inconsistent_project",
      `技能分组「${fallbackTitle}」的清单标识与注册表不一致，请先修复后再导出。`
    );
  }
  return {
    key: backupItemKey(kind, id),
    kind,
    id,
    title: parsed.data.title,
    projectDirectory: realRoot,
    empty: parsed.data.memberIds.length === 0,
    isUnbound: false,
    isBuiltin: false,
    linkedMaterialIds: [],
    linkedSkillIds: [],
    memberIds: [...parsed.data.memberIds],
    files,
    rawBytes
  };
}

export async function discoverExportableProjects(
  userDataPath: string,
  options: { strict?: boolean; onlyKeys?: ReadonlySet<string> } = {}
): Promise<{
  registries: RegistrySnapshotBundle;
  projects: DiscoveredBackupProject[];
}> {
  const registries = await readAllRegistries(userDataPath);
  const allRegisteredRealRoots = await collectRegisteredRealRoots(registries);
  const unboundIds = new Set(
    registries.catalog.libraryOrganization?.unboundLibraryIds ?? []
  );
  const strict = options.strict === true;
  const projects: DiscoveredBackupProject[] = [];
  const seenKeys = new Set<string>();

  const candidates: Array<{
    kind: LocalBackupItemKind;
    id: string;
    projectDirectory: string;
  }> = [
    ...registries.catalog.projects.map((entry) => ({
      kind: entry.domain as LocalBackupItemKind,
      id: entry.id,
      projectDirectory: entry.projectDirectory
    })),
    ...registries.long.projects
      .filter((entry) => !entry.deletion)
      .map((entry) => ({
        kind: "long-book" as const,
        id: entry.bookId,
        projectDirectory: entry.projectDirectory
      })),
    ...registries.mystery.projects.map((entry) => ({
      kind: "mystery-book" as const,
      id: entry.bookId,
      projectDirectory: entry.projectDirectory
    }))
  ];

  for (const candidate of candidates) {
    const key = backupItemKey(candidate.kind, candidate.id);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    if (options.onlyKeys && !options.onlyKeys.has(key)) continue;

    const inspected = await inspectRegisteredProject({
      kind: candidate.kind,
      id: candidate.id,
      projectDirectory: candidate.projectDirectory,
      allRegisteredRealRoots,
      unboundIds,
      strict
    });
    if (!inspected) continue;
    if (inspected.isBuiltin) continue;
    if (inspected.isUnbound && inspected.empty) continue;
    projects.push(inspected);
  }

  projects.sort((left, right) => left.key.localeCompare(right.key));
  return { registries, projects };
}

export async function getLocalBackupInventory(
  userDataPath: string
): Promise<LocalBackupInventorySnapshot> {
  const { projects } = await discoverExportableProjects(userDataPath, {
    strict: false
  });
  const items: LocalBackupInventoryItem[] = projects.map((project) => ({
    key: project.key,
    kind: project.kind,
    id: project.id,
    title: project.title,
    ...(project.workSubtype ? { workSubtype: project.workSubtype } : {}),
    sizeBytes: project.rawBytes,
    empty: project.empty,
    ...(project.isUnbound ? { isUnbound: true } : {}),
    linkedMaterialIds: project.linkedMaterialIds,
    linkedSkillIds: project.linkedSkillIds,
    ...(project.memberIds ? { memberIds: project.memberIds } : {})
  }));
  const counts = {
    works: items.filter(
      (item) =>
        item.kind === "book" ||
        item.kind === "long-book" ||
        item.kind === "mystery-book"
    ).length,
    materials: items.filter((item) => item.kind === "material-library").length,
    skills: items.filter((item) => item.kind === "skill-library").length
  };
  return { counts, items };
}

export function validateExistingBookSchemaForBackup(book: unknown): void {
  if (isRecord(book) && book.bookType === "academic") {
    AcademicBookSchema.parse(book);
  } else {
    BookSchema.parse(book);
  }
}
