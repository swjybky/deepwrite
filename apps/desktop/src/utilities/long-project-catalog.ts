import {
  assertAvailableProjectDirectory,
  secureProjectDirectory,
  requireRegisteredLongProject,
  type LongProjectRegistration,
  type LongProjectRegistry
} from "./long-project-registration";
import {
  LongBookIdSchema,
  LongBookSummarySchema,
  LongListBooksResultSchema,
  LongOpenBookResultSchema,
  type CreateLongBookInput,
  type LongBookSummary,
  type LongListBooksResult,
  type LongOpenBookResult
} from "@deepwrite/contracts";
import { randomHex8 } from "@deepwrite/shared";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { stripLegacyLongVersionMetadata } from "./long-version-metadata";

const REGISTRY_FILE = "long-project-registry.json";
const REGISTRY_BACKUP_FILE = "long-project-registry.json.bak";
const REGISTRY_LOCK_FILE = "long-project-registry.lock";
const MAX_REGISTRY_BYTES = 4 * 1024 * 1024;
export const LONG_PROJECT_CATALOG_MAX_SUMMARY_BYTES = 1024 * 1024;
const REGISTRY_LOCK_TIMEOUT_MS = 10_000;
const REGISTRY_LOCK_RETRY_MS = 20;
const REGISTRY_LOCK_STALE_MS = 60_000;
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;

export interface OpenLongProject {
  projectDirectory: string;
  book: LongOpenBookResult["book"];
  summary: LongBookSummary;
}

export interface LongProjectAccess {
  createBook(
    parentDirectory: string,
    input: CreateLongBookInput
  ): Promise<OpenLongProject>;
  openBook(projectDirectory: string): Promise<OpenLongProject>;
  inspectBook(projectDirectory: string): Promise<{
    bookId: string;
    updatedAt: string;
  }>;
}

export interface LongProjectCatalogOptions {
  userDataPath: string;
  projects: LongProjectAccess;
  now?: () => string;
  removeDirectory?: (path: string) => Promise<void>;
  lockHooks?: {
    beforeStaleUnlink?: () => void | Promise<void>;
  };
}

/**
 * A deliberately independent registry for long-form projects. Keeping it out
 * of FolderCatalogStore means opening a long book can never make the existing
 * short/script snapshot hydrate large chapter bodies.
 */
export class LongProjectCatalog {
  readonly registryPath: string;
  readonly registryBackupPath: string;

  private readonly registryRoot: string;
  private readonly registryLockPath: string;
  private readonly projects: LongProjectAccess;
  private readonly now: () => string;
  private readonly removeDirectory: (path: string) => Promise<void>;
  private readonly lockHooks: LongProjectCatalogOptions["lockHooks"];
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: LongProjectCatalogOptions) {
    const root = options.userDataPath.trim();
    if (!root) {
      throw new Error("LongProjectCatalog requires a user data path.");
    }
    this.registryRoot = resolve(root);
    this.registryPath = join(this.registryRoot, REGISTRY_FILE);
    this.registryBackupPath = join(this.registryRoot, REGISTRY_BACKUP_FILE);
    this.registryLockPath = join(this.registryRoot, REGISTRY_LOCK_FILE);
    this.projects = options.projects;
    this.now = options.now ?? (() => new Date().toISOString());
    this.lockHooks = options.lockHooks;
    this.removeDirectory =
      options.removeDirectory ??
      (async (path) => {
        await rm(path, { recursive: true, force: false });
      });
  }

  async create(
    parentDirectory: string,
    input: CreateLongBookInput
  ): Promise<OpenLongProject> {
    return await this.mutate(async () => {
      const opened = await this.projects.createBook(parentDirectory, input);
      // The newly-created project remains a valid standalone folder and can
      // be opened explicitly later if writing the catalog index fails.
      await this.registerOpened(opened);
      return opened;
    });
  }

  async openAtPath(projectDirectory: string): Promise<OpenLongProject> {
    return await this.mutate(async () => {
      const opened = await this.projects.openBook(projectDirectory);
      await this.registerOpened(opened);
      return opened;
    });
  }

  async open(bookId: string): Promise<OpenLongProject> {
    const id = LongBookIdSchema.parse(bookId);
    return await this.readAfterWrites(async () => {
      const registry = await this.readRegistry();
      const registration = requireRegisteredLongProject(registry, id);
      const opened = await this.projects.openBook(
        registration.projectDirectory
      );
      if (opened.summary.id !== id) {
        throw new Error("长篇项目标识与注册信息不一致。");
      }
      return opened;
    });
  }

  /** Registry-bound maintenance for a book that may fail normal open/recovery. */
  async withProjectDirectory<Result>(
    bookId: string,
    task: (directory: string) => Promise<Result>
  ): Promise<Result> {
    const id = LongBookIdSchema.parse(bookId);
    return await this.mutate(async () => {
      const registration = requireRegisteredLongProject(
        await this.readRegistry(),
        id
      );
      await assertAvailableProjectDirectory(registration.projectDirectory);
      return await task(registration.projectDirectory);
    });
  }

  async updateSummary(
    bookId: string,
    rawSummary: LongBookSummary
  ): Promise<void> {
    const id = LongBookIdSchema.parse(bookId);
    const summary = LongBookSummarySchema.parse(rawSummary);
    if (summary.id !== id) {
      throw new Error("长篇项目摘要标识与注册信息不一致。");
    }
    await this.mutate(async () => {
      const registry = await this.readRegistry();
      const current = registry.projects.find(
        (project) => project.bookId === id
      );
      if (!current || current.deletion) {
        throw new Error("长篇项目不存在、未注册或正在删除。");
      }
      if (
        current.summary &&
        JSON.stringify(current.summary) === JSON.stringify(summary) &&
        registry.schemaVersion === 2
      ) {
        return;
      }
      await this.writeRegistry({
        ...registry,
        schemaVersion: 2,
        updatedAt: this.now(),
        projects: registry.projects.map((project) =>
          project.bookId === id ? { ...project, summary } : project
        )
      });
    });
  }

  async list(): Promise<LongListBooksResult> {
    return await this.readAfterWrites(async () => {
      let registry = await this.readRegistry();
      let registryNeedsMigration = registry.schemaVersion === 1;
      const books: LongBookSummary[] = [];
      const diagnostics: Array<{
        bookId: string;
        code: "unavailable" | "invalid";
        message: string;
      }> = [];
      for (const project of [...registry.projects]) {
        if (!project.deletion) continue;
        try {
          await this.completePendingDeletion(registry, project);
          registry = await this.readRegistry();
        } catch (error: unknown) {
          diagnostics.push({
            bookId: project.bookId,
            code: "unavailable",
            message:
              error instanceof Error
                ? `长篇项目删除清理待自动重试：${error.message}`
                : "长篇项目删除清理待自动重试。"
          });
        }
      }
      for (const project of registry.projects) {
        if (project.deletion) {
          continue;
        }
        try {
          await assertAvailableProjectDirectory(project.projectDirectory);
          let summary = project.summary;
          const inspection = await this.projects.inspectBook(
            project.projectDirectory
          );
          if (inspection.bookId !== project.bookId) {
            throw new Error("长篇项目标识与注册信息不一致。");
          }
          if (summary && summary.updatedAt !== inspection.updatedAt) {
            // A project can be edited by another DeepWrite process. Refresh
            // that one stale summary without making normal list() calls parse
            // every large index.
            const opened = await this.projects.openBook(
              project.projectDirectory
            );
            summary = LongBookSummarySchema.parse(opened.summary);
            project.summary = summary;
            registryNeedsMigration = true;
          }
          if (!summary) {
            // One-time migration for the old path-only registry. This is the
            // only list() path that may parse a full workspace index.
            const opened = await this.projects.openBook(
              project.projectDirectory
            );
            if (opened.summary.id !== project.bookId) {
              throw new Error("长篇项目标识与注册信息不一致。");
            }
            summary = LongBookSummarySchema.parse(opened.summary);
            project.summary = summary;
            registryNeedsMigration = true;
          }
          if (summary.id !== project.bookId) {
            throw new Error("长篇项目摘要标识与注册信息不一致。");
          }
          books.push(LongBookSummarySchema.parse(summary));
        } catch (error: unknown) {
          diagnostics.push({
            bookId: project.bookId,
            code: isMissingPathError(error) ? "unavailable" : "invalid",
            message:
              error instanceof Error ? error.message : "本地长篇项目无法读取。"
          });
        }
      }
      if (
        registryNeedsMigration &&
        registry.projects.every(
          (project) => project.deletion || project.summary
        )
      ) {
        registry = {
          ...registry,
          schemaVersion: 2,
          updatedAt: this.now()
        };
        await this.writeRegistry(registry);
      }
      books.sort((left, right) => {
        const updatedOrder = right.updatedAt.localeCompare(left.updatedAt);
        return updatedOrder || left.id.localeCompare(right.id);
      });
      return LongListBooksResultSchema.parse({
        updatedAt: registry.updatedAt,
        books,
        ...(diagnostics.length ? { diagnostics } : {})
      });
    });
  }

  async unregister(
    bookId: string
  ): Promise<{ bookId: string; removed: boolean }> {
    const id = LongBookIdSchema.parse(bookId);
    return await this.mutate(async () => {
      const registry = await this.readRegistry();
      const projects = registry.projects.filter(
        (project) => project.bookId !== id
      );
      const removed = projects.length !== registry.projects.length;
      if (removed) {
        const registration = registry.projects.find(
          (project) => project.bookId === id
        );
        if (registration?.deletion) {
          throw new Error(
            "长篇项目正在永久删除，不能仅移除登记；请重试永久删除。"
          );
        }
        await this.writeRegistry({
          ...registry,
          updatedAt: this.now(),
          projects
        });
      }
      return { bookId: id, removed };
    });
  }

  async delete(bookId: string): Promise<{ bookId: string; removed: boolean }> {
    const id = LongBookIdSchema.parse(bookId);
    return await this.mutate(async () => {
      const registry = await this.readRegistry();
      const registration = registry.projects.find(
        (project) => project.bookId === id
      );
      if (!registration) {
        return { bookId: id, removed: false };
      }
      if (registration.deletion) {
        return await this.completePendingDeletion(registry, registration);
      }
      const opened = await this.projects.openBook(
        registration.projectDirectory
      );
      if (opened.summary.id !== id) {
        throw new Error("长篇项目标识与注册信息不一致，拒绝删除。");
      }
      const projectDirectory = await secureProjectDirectory(
        opened.projectDirectory
      );
      const parent = dirname(projectDirectory);
      if (
        projectDirectory === parent ||
        basename(projectDirectory).length < 1
      ) {
        throw new Error("拒绝删除不安全的长篇项目目录。");
      }
      const stagedDeletion = join(
        parent,
        `.deepwrite-deleting-long-${id}-${randomHex8()}`
      );
      const pendingRegistration: LongProjectRegistration = {
        ...registration,
        deletion: {
          originalProjectDirectory: projectDirectory,
          stagedProjectDirectory: stagedDeletion
        }
      };
      const pendingRegistry: LongProjectRegistry = {
        ...registry,
        updatedAt: this.now(),
        projects: registry.projects.map((project) =>
          project.bookId === id ? pendingRegistration : project
        )
      };
      // Persist the deletion intent before moving user data. Every subsequent
      // state (not moved, staged, partially removed, already removed) can then
      // be completed by calling delete again after a crash or cleanup failure.
      await this.writeRegistry(pendingRegistry);
      return await this.completePendingDeletion(
        pendingRegistry,
        pendingRegistration
      );
    });
  }

  private async completePendingDeletion(
    registry: LongProjectRegistry,
    registration: LongProjectRegistration
  ): Promise<{ bookId: string; removed: boolean }> {
    const deletion = registration.deletion;
    if (!deletion) {
      throw new Error("长篇项目缺少可恢复的删除状态。");
    }
    const original = deletion.originalProjectDirectory;
    const staged = deletion.stagedProjectDirectory;
    assertSafeDeletionPaths(registration.bookId, original, staged);

    const originalExists = await pathExists(original);
    const stagedExists = await pathExists(staged);
    if (originalExists && stagedExists) {
      throw new Error(
        "长篇删除恢复发现原目录和隔离目录同时存在，拒绝猜测要删除的数据。"
      );
    }
    if (originalExists) {
      const opened = await this.projects.openBook(original);
      if (opened.summary.id !== registration.bookId) {
        throw new Error("长篇项目标识与删除登记不一致，拒绝继续删除。");
      }
      const canonical = await secureProjectDirectory(original);
      if (canonical !== resolve(original)) {
        throw new Error("长篇删除登记的原目录不是规范化真实路径。");
      }
      await rename(original, staged);
    }

    if (await pathExists(staged)) {
      await assertSafeStagedDeletionDirectory(staged);
      await this.removeDirectory(staged);
      if (await pathExists(staged)) {
        throw new Error("长篇项目隔离目录清理未完成，请重试永久删除。");
      }
    }

    await this.writeRegistry({
      ...registry,
      updatedAt: this.now(),
      projects: registry.projects.filter(
        (project) => project.bookId !== registration.bookId
      )
    });
    return { bookId: registration.bookId, removed: true };
  }

  private async registerOpened(opened: OpenLongProject): Promise<void> {
    const parsed = LongOpenBookResultSchema.parse({
      book: opened.book,
      summary: opened.summary
    });
    if (parsed.book.id !== parsed.summary.id) {
      throw new Error("长篇项目完整索引与导航摘要标识不一致。");
    }
    const projectDirectory = await secureProjectDirectory(
      opened.projectDirectory
    );
    const registry = await this.readRegistry();
    const duplicateDirectory = registry.projects.find(
      (project) => resolve(project.projectDirectory) === projectDirectory
    );
    if (duplicateDirectory && duplicateDirectory.bookId !== parsed.summary.id) {
      throw new Error("该目录已经注册为另一个长篇项目。");
    }
    const current = registry.projects.find(
      (project) => project.bookId === parsed.summary.id
    );
    if (current?.deletion) {
      throw new Error("相同长篇项目 ID 正在永久删除；请先重试删除完成清理。");
    }
    if (
      current &&
      resolve(current.projectDirectory) !== projectDirectory &&
      (await pathExists(current.projectDirectory))
    ) {
      throw new Error("相同长篇项目 ID 已在另一个仍然存在的文件夹中注册。");
    }
    if (current && resolve(current.projectDirectory) === projectDirectory) {
      const summary = LongBookSummarySchema.parse(parsed.summary);
      if (
        current.summary &&
        JSON.stringify(current.summary) === JSON.stringify(summary) &&
        registry.schemaVersion === 2
      ) {
        return;
      }
      await this.writeRegistry({
        ...registry,
        schemaVersion: 2,
        updatedAt: this.now(),
        projects: registry.projects.map((project) =>
          project.bookId === summary.id ? { ...project, summary } : project
        )
      });
      return;
    }
    const projects = registry.projects.filter(
      (project) =>
        project.bookId !== parsed.summary.id &&
        resolve(project.projectDirectory) !== projectDirectory
    );
    projects.push({
      bookId: parsed.summary.id,
      projectDirectory,
      registeredAt: this.now(),
      summary: LongBookSummarySchema.parse(parsed.summary)
    });
    await this.writeRegistry({
      ...registry,
      schemaVersion: 2,
      updatedAt: this.now(),
      projects
    });
  }

  private async readRegistry(): Promise<LongProjectRegistry> {
    const primary = await readOptionalText(this.registryPath);
    if (primary !== undefined) {
      try {
        const parsed = parseReadableRegistry(JSON.parse(primary));
        if (parsed.changed) {
          await this.repairRegistryCopiesBestEffort(parsed.registry);
        }
        return parsed.registry;
      } catch {
        // Fall through to the last known-good backup.
      }
    }
    const backup = await readOptionalText(this.registryBackupPath);
    if (backup !== undefined) {
      const parsed = parseReadableRegistry(JSON.parse(backup));
      await this.repairRegistryCopiesBestEffort(parsed.registry);
      return parsed.registry;
    }
    if (primary !== undefined) {
      const corruptPath = `${this.registryPath}.corrupt-${Date.now()}`;
      await rename(this.registryPath, corruptPath).catch(() => undefined);
    }
    const empty: LongProjectRegistry = {
      schemaVersion: 2,
      updatedAt: this.now(),
      projects: []
    };
    await this.writeRegistry(empty);
    return empty;
  }

  private async repairRegistryCopiesBestEffort(
    registry: LongProjectRegistry
  ): Promise<void> {
    await atomicWriteJson(this.registryPath, registry).catch(() => undefined);
    await atomicWriteJson(this.registryBackupPath, registry).catch(
      () => undefined
    );
  }

  private async writeRegistry(registry: LongProjectRegistry): Promise<void> {
    const parsed = parseRegistry(registry);
    await atomicWriteJson(this.registryPath, parsed);
    await atomicWriteJson(this.registryBackupPath, parsed).catch(
      () => undefined
    );
  }

  private async mutate<Result>(
    operation: () => Promise<Result>
  ): Promise<Result> {
    let result: Result | undefined;
    let failure: unknown;
    const pending = this.writeChain.then(async () => {
      try {
        result = await withRegistryLock(
          this.registryRoot,
          this.registryLockPath,
          operation,
          this.lockHooks
        );
      } catch (error: unknown) {
        failure = error;
      }
    });
    this.writeChain = pending.then(
      () => undefined,
      () => undefined
    );
    await pending;
    if (failure !== undefined) throw failure;
    return result!;
  }

  private async readAfterWrites<Result>(
    operation: () => Promise<Result>
  ): Promise<Result> {
    return await this.mutate(operation);
  }
}

function parseReadableRegistry(value: unknown): {
  registry: LongProjectRegistry;
  changed: boolean;
} {
  const stripped = stripLegacyLongVersionMetadata(value);
  return {
    registry: parseRegistry(stripped.value),
    changed: stripped.changed
  };
}

function parseRegistry(value: unknown): LongProjectRegistry {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== 1 && value.schemaVersion !== 2)
  ) {
    throw new Error("不支持的长篇项目注册表版本。");
  }
  if (
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(new Date(value.updatedAt).getTime())
  ) {
    throw new Error("长篇项目注册表更新时间无效。");
  }
  if (!Array.isArray(value.projects)) {
    throw new Error("长篇项目注册表条目无效。");
  }
  const projects = value.projects.map((candidate) => {
    if (!isRecord(candidate)) {
      throw new Error("长篇项目注册表条目必须是对象。");
    }
    const projectDirectory = candidate.projectDirectory;
    const registeredAt = candidate.registeredAt;
    if (typeof projectDirectory !== "string" || !isAbsolute(projectDirectory)) {
      throw new Error("长篇项目目录必须是绝对路径。");
    }
    if (
      typeof registeredAt !== "string" ||
      !Number.isFinite(new Date(registeredAt).getTime())
    ) {
      throw new Error("长篇项目注册时间无效。");
    }
    const bookId = LongBookIdSchema.parse(candidate.bookId);
    const normalizedProjectDirectory = resolve(projectDirectory);
    let deletion: LongProjectRegistration["deletion"];
    if (candidate.deletion !== undefined) {
      if (!isRecord(candidate.deletion)) {
        throw new Error("长篇项目删除状态无效。");
      }
      const originalProjectDirectory =
        candidate.deletion.originalProjectDirectory;
      const stagedProjectDirectory = candidate.deletion.stagedProjectDirectory;
      if (
        typeof originalProjectDirectory !== "string" ||
        !isAbsolute(originalProjectDirectory) ||
        typeof stagedProjectDirectory !== "string" ||
        !isAbsolute(stagedProjectDirectory)
      ) {
        throw new Error("长篇项目删除路径必须是绝对路径。");
      }
      deletion = {
        originalProjectDirectory: resolve(originalProjectDirectory),
        stagedProjectDirectory: resolve(stagedProjectDirectory)
      };
      assertSafeDeletionPaths(
        bookId,
        deletion.originalProjectDirectory,
        deletion.stagedProjectDirectory
      );
      if (deletion.originalProjectDirectory !== normalizedProjectDirectory) {
        throw new Error("长篇项目删除原路径与注册路径不一致。");
      }
    }
    let summary: LongBookSummary | undefined;
    if (candidate.summary !== undefined) {
      summary = LongBookSummarySchema.parse(candidate.summary);
      assertSummarySize(summary);
      if (summary.id !== bookId) {
        throw new Error("长篇项目注册摘要与项目标识不一致。");
      }
    } else if (value.schemaVersion === 2 && !deletion) {
      throw new Error("长篇项目注册表 v2 条目缺少导航摘要。");
    }
    return {
      bookId,
      projectDirectory: normalizedProjectDirectory,
      registeredAt,
      ...(summary ? { summary } : {}),
      ...(deletion ? { deletion } : {})
    };
  });
  if (
    new Set(projects.map((project) => project.bookId)).size !==
      projects.length ||
    new Set(projects.map((project) => project.projectDirectory)).size !==
      projects.length
  ) {
    throw new Error("长篇项目注册表包含重复条目。");
  }
  return {
    schemaVersion: value.schemaVersion,
    updatedAt: value.updatedAt,
    projects
  };
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(content, "utf8") > MAX_REGISTRY_BYTES) {
    throw new Error("长篇项目注册表超过安全大小限制。");
  }
  const parent = dirname(path);
  await ensureSafeRegistryDirectory(parent);
  await assertSafeOptionalRegistryFile(path);
  const temporary = `${path}.${process.pid}.${randomHex8()}.tmp`;
  const handle = await open(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | O_NOFOLLOW,
    0o600
  );
  try {
    await handle.writeFile(content, { encoding: "utf8" });
    await handle.sync();
  } catch (error: unknown) {
    await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  await handle.close();
  try {
    await rename(temporary, path);
    await fsyncDirectory(parent);
  } catch (error: unknown) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readOptionalText(path: string): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | O_NOFOLLOW);
    const details = await handle.stat();
    if (
      !details.isFile() ||
      details.nlink !== 1 ||
      details.size > MAX_REGISTRY_BYTES
    ) {
      throw new Error("长篇项目注册表不是安全的普通文件。");
    }
    return await handle.readFile({ encoding: "utf8" });
  } catch (error: unknown) {
    if (isMissingPathError(error)) return undefined;
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ELOOP" || error.code === "EMLINK")
    ) {
      throw new Error("长篇项目注册表不能是符号链接或硬链接。");
    }
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function ensureSafeRegistryDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const absolute = resolve(path);
  const details = await lstat(absolute);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error("长篇项目注册表目录必须是非符号链接目录。");
  }
  if ((await realpath(absolute)) !== absolute) {
    throw new Error("长篇项目注册表目录不是规范化真实路径。");
  }
}

async function assertSafeOptionalRegistryFile(path: string): Promise<void> {
  try {
    const details = await lstat(path);
    if (!details.isFile() || details.isSymbolicLink() || details.nlink !== 1) {
      throw new Error("长篇项目注册表不能是符号链接或硬链接。");
    }
  } catch (error: unknown) {
    if (isMissingPathError(error)) return;
    throw error;
  }
}

async function fsyncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY);
    await handle.sync();
  } catch (error: unknown) {
    if (!isUnsupportedDirectorySyncError(error)) throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function withRegistryLock<Result>(
  root: string,
  lockPath: string,
  operation: () => Promise<Result>,
  hooks?: LongProjectCatalogOptions["lockHooks"]
): Promise<Result> {
  await ensureSafeRegistryDirectory(root);
  const startedAt = Date.now();
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  const nonce = randomHex8();
  while (!handle) {
    try {
      handle = await open(
        lockPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | O_NOFOLLOW,
        0o600
      );
    } catch (error: unknown) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EEXIST"
      ) {
        throw error;
      }
      const details = await lstat(lockPath).catch((lockError: unknown) => {
        if (isMissingPathError(lockError)) return undefined;
        throw lockError;
      });
      if (
        details &&
        (!details.isFile() || details.isSymbolicLink() || details.nlink !== 1)
      ) {
        throw new Error("长篇项目注册表锁文件不安全。");
      }
      if (details && Date.now() - details.mtimeMs > REGISTRY_LOCK_STALE_MS) {
        const owner = await readRegistryLockOwner(lockPath);
        if (!owner || !isProcessAlive(owner.pid)) {
          await hooks?.beforeStaleUnlink?.();
          const current = await lstat(lockPath).catch((lockError: unknown) => {
            if (isMissingPathError(lockError)) return undefined;
            throw lockError;
          });
          const currentOwner = current
            ? await readRegistryLockOwner(lockPath)
            : undefined;
          if (!current) continue;
          if (
            current.dev === details.dev &&
            current.ino === details.ino &&
            currentOwner?.nonce === owner?.nonce
          ) {
            await rm(lockPath, { force: false });
            await fsyncDirectory(root);
            continue;
          }
        }
      }
      if (Date.now() - startedAt >= REGISTRY_LOCK_TIMEOUT_MS) {
        throw new Error("等待长篇项目注册表跨进程锁超时。");
      }
      await new Promise<void>((resolveDelay) => {
        setTimeout(resolveDelay, REGISTRY_LOCK_RETRY_MS);
      });
    }
  }
  const acquired = await handle.stat();
  try {
    await handle.writeFile(
      `${JSON.stringify({
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
        nonce
      })}\n`,
      "utf8"
    );
    await handle.sync();
    return await operation();
  } finally {
    await handle.close().catch(() => undefined);
    const current = await lstat(lockPath).catch((error: unknown) => {
      if (isMissingPathError(error)) return undefined;
      throw error;
    });
    const currentOwner = current
      ? await readRegistryLockOwner(lockPath)
      : undefined;
    if (
      current &&
      current.dev === acquired.dev &&
      current.ino === acquired.ino &&
      currentOwner?.nonce === nonce
    ) {
      await rm(lockPath, { force: false });
      await fsyncDirectory(root);
    }
  }
}

async function readRegistryLockOwner(
  path: string
): Promise<{ pid: number; nonce: string } | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | O_NOFOLLOW);
    const details = await handle.stat();
    if (
      !details.isFile() ||
      details.nlink !== 1 ||
      details.size < 2 ||
      details.size > 4_096
    ) {
      return undefined;
    }
    const value = JSON.parse(
      await handle.readFile({ encoding: "utf8" })
    ) as unknown;
    if (
      !isRecord(value) ||
      !Number.isSafeInteger(value.pid) ||
      (value.pid as number) <= 0 ||
      typeof value.nonce !== "string" ||
      !/^[0-9a-f]{8}$/u.test(value.nonce)
    ) {
      return undefined;
    }
    return { pid: value.pid as number, nonce: value.nonce };
  } catch (error: unknown) {
    if (isMissingPathError(error)) return undefined;
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return !(
      error instanceof Error &&
      "code" in error &&
      (error.code === "ESRCH" || error.code === "EINVAL")
    );
  }
}

function isUnsupportedDirectorySyncError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EPERM" ||
      error.code === "EISDIR" ||
      error.code === "EINVAL" ||
      error.code === "ENOTSUP")
  );
}

function assertSummarySize(summary: LongBookSummary): void {
  if (
    Buffer.byteLength(JSON.stringify(summary), "utf8") >
    LONG_PROJECT_CATALOG_MAX_SUMMARY_BYTES
  ) {
    throw new Error("长篇项目导航摘要超过 1 MiB 安全上限。");
  }
}

function assertSafeDeletionPaths(
  bookId: string,
  originalProjectDirectory: string,
  stagedProjectDirectory: string
): void {
  const original = resolve(originalProjectDirectory);
  const staged = resolve(stagedProjectDirectory);
  if (
    original === dirname(original) ||
    basename(original).length < 1 ||
    dirname(original) !== dirname(staged) ||
    !new RegExp(
      `^\\.deepwrite-deleting-long-${escapeRegExp(bookId)}-[0-9a-f]{8}$`,
      "u"
    ).test(basename(staged))
  ) {
    throw new Error("长篇项目删除隔离路径不安全。");
  }
}

async function assertSafeStagedDeletionDirectory(path: string): Promise<void> {
  const details = await lstat(path);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error("长篇项目删除隔离目标必须是真实目录。");
  }
  if ((await realpath(path)) !== resolve(path)) {
    throw new Error("长篇项目删除隔离目标不是规范化真实路径。");
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error: unknown) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
