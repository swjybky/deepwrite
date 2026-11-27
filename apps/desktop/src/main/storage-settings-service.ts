import { constants, type Stats } from "node:fs";
import { access, lstat, mkdir, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  ConversationCompactionStatus,
  StorageDirectoryKind,
  StorageLocation,
  StorageSettingsErrorCode,
  StorageSettingsSnapshot
} from "@deepwrite/contracts";
import type { StorageLocationStore } from "./storage-location-store";
import type { WorkspaceDirectoryStore } from "./workspace-directory-store";
import { overlapsInstallationDirectory } from "./installation-directory-guard";

/** Created inside an occupied folder or drive root so the profile never mixes with existing files. */
export const USER_DATA_FOLDER_NAME = "DeepWriteData";

interface StorageSettingsOptions {
  locations: StorageLocationStore;
  workspace(): WorkspaceDirectoryStore;
  documentsPath(): string;
  installationDirectory(): string;
  chooseDirectory(currentPath: string): Promise<string | undefined>;
  confirmMigration(
    source: string,
    target: string,
    restoreDefault: boolean,
    createsSubfolder: boolean
  ): Promise<boolean>;
  openPath(path: string): Promise<string>;
  busy(): boolean;
  flushRenderer(): Promise<void>;
  restart(): void;
  compaction?: {
    status(): Promise<ConversationCompactionStatus>;
    compact(options?: {
      force?: boolean;
    }): Promise<ConversationCompactionStatus>;
    releaseBackup(): Promise<ConversationCompactionStatus>;
  };
}

/** Carries a stable code across IPC; the message stays a local diagnostic. */
export class StorageSettingsError extends Error {
  constructor(
    readonly code: StorageSettingsErrorCode,
    message: string
  ) {
    super(message);
    this.name = "StorageSettingsError";
  }
}

function contains(parent: string, child: string): boolean {
  const offset = relative(parent, child);
  return (
    offset === "" ||
    (!offset.startsWith(`..${sep}`) && offset !== ".." && !isAbsolute(offset))
  );
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function location(
  path: string,
  defaultPath: string
): Promise<StorageLocation> {
  const canonical = async (value: string) =>
    realpath(value).catch(() => resolve(value));
  return {
    path,
    defaultPath,
    isDefault: (await canonical(path)) === (await canonical(defaultPath))
  };
}

async function optionalEntry(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function realDirectory(path: string, info: Stats): Promise<string> {
  // Windows reports directory junctions as symbolic links as well.
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new StorageSettingsError(
      "storage_settings.invalid_directory",
      "请选择本机真实文件夹，不能使用符号链接或目录联接。"
    );
  try {
    return await realpath(path);
  } catch (error) {
    // Some Windows virtual and cloud-mounted drives cannot report a final path.
    throw new StorageSettingsError(
      "storage_settings.unresolvable_path",
      `无法解析所选文件夹的真实路径：${reason(error)}`
    );
  }
}

/** A missing subfolder is created by the offline migration; an existing one must be empty. */
async function emptySubfolder(path: string): Promise<string> {
  const info = await optionalEntry(path);
  if (!info) return path;
  const directory = await realDirectory(path, info);
  if ((await readdir(directory)).length > 0)
    throw new StorageSettingsError(
      "storage_settings.target_not_empty",
      `所选位置中的 ${USER_DATA_FOLDER_NAME} 文件夹已有文件，已有文件不会被覆盖。`
    );
  return directory;
}

export class StorageSettingsService {
  private changing = false;
  private restarting = false;

  constructor(private readonly options: StorageSettingsOptions) {}

  async get(): Promise<StorageSettingsSnapshot> {
    const { locations } = this.options;
    const defaultWorkspace = join(
      this.options.documentsPath(),
      "DeepWriteBooks"
    );
    const workspace = await this.options.workspace().list();
    const conversationCompaction = this.options.compaction
      ? await this.options.compaction.status().catch(() => undefined)
      : undefined;
    return {
      userData: await location(locations.currentPath, locations.defaultPath),
      workspace: await location(
        workspace.path ?? defaultWorkspace,
        defaultWorkspace
      ),
      ...(conversationCompaction ? { conversationCompaction } : {})
    };
  }

  async getCompactionStatus(): Promise<
    ConversationCompactionStatus | undefined
  > {
    if (!this.options.compaction) return undefined;
    return this.options.compaction.status();
  }

  async compactConversations(options?: {
    force?: boolean;
  }): Promise<ConversationCompactionStatus> {
    if (!this.options.compaction) {
      throw new StorageSettingsError(
        "storage_settings.busy",
        "历史对话整理服务尚未就绪，请稍后重试。"
      );
    }
    this.assertIdle();
    return this.options.compaction.compact(options);
  }

  async releaseConversationBackup(): Promise<ConversationCompactionStatus> {
    if (!this.options.compaction) {
      throw new StorageSettingsError(
        "storage_settings.busy",
        "历史对话整理服务尚未就绪，请稍后重试。"
      );
    }
    if (this.restarting || this.changing) {
      throw new StorageSettingsError(
        "storage_settings.busy",
        "请等待当前存储操作结束后再释放备份。"
      );
    }
    return this.options.compaction.releaseBackup();
  }

  async openDirectory(kind: StorageDirectoryKind): Promise<{ opened: true }> {
    const snapshot = await this.get();
    const error = await this.options.openPath(
      kind === "user-data" ? snapshot.userData.path : snapshot.workspace.path
    );
    if (error)
      throw new StorageSettingsError(
        "storage_settings.open_failed",
        `无法打开存储目录：${error}`
      );
    return { opened: true };
  }

  async resetWorkspaceDirectory() {
    this.assertIdle();
    const path = join(this.options.documentsPath(), "DeepWriteBooks");
    await mkdir(path, { recursive: true });
    return this.options.workspace().save(path);
  }

  chooseUserData() {
    return this.changeUserData(false);
  }

  resetUserData() {
    return this.changeUserData(true);
  }

  cancelRestart(): void {
    if (!this.restarting) return;
    this.options.locations.cancel();
    this.restarting = false;
  }

  get restartPending(): boolean {
    return this.restarting;
  }

  get busy(): boolean {
    return this.changing || this.restarting;
  }

  private assertIdle(): void {
    if (this.restarting || this.changing || this.options.busy()) {
      throw new StorageSettingsError(
        "storage_settings.busy",
        "请等待当前任务或存储操作结束后再更改存储位置。"
      );
    }
  }

  private assertNoRunningTasks(): void {
    if (this.options.busy())
      throw new StorageSettingsError(
        "storage_settings.busy",
        "有任务正在运行，请等待结束后再迁移用户数据。"
      );
  }

  private async assertIndependent(target: string, source: string) {
    if (
      await overlapsInstallationDirectory(
        target,
        this.options.installationDirectory()
      )
    )
      throw new StorageSettingsError(
        "storage_settings.overlaps_installation",
        "用户数据目录不能与应用安装目录相同、位于安装目录内，也不能包含安装目录。"
      );
    if (contains(source, target) || contains(target, source))
      throw new StorageSettingsError(
        "storage_settings.nested_location",
        "新旧用户数据目录不能相同或互相包含，请选择独立文件夹。"
      );
  }

  private async changeUserData(restoreDefault: boolean) {
    this.assertIdle();
    this.changing = true;
    try {
      const { locations } = this.options;
      const requested = restoreDefault
        ? locations.defaultPath
        : await this.options.chooseDirectory(locations.currentPath);
      if (!requested) return { restarting: false };
      if (restoreDefault) await mkdir(requested, { recursive: true });
      const picked = await realDirectory(requested, await lstat(requested));
      const source = await realpath(locations.currentPath);
      if (picked === source) return { restarting: false };
      const defaultPath = await realpath(locations.defaultPath).catch(() =>
        resolve(locations.defaultPath)
      );
      const allowExistingTarget = picked === defaultPath;
      // Drive roots always hold system folders and cannot be renamed into place.
      const createsSubfolder =
        !allowExistingTarget &&
        (dirname(picked) === picked || (await readdir(picked)).length > 0);
      const candidate = createsSubfolder
        ? join(picked, USER_DATA_FOLDER_NAME)
        : picked;
      await this.assertIndependent(candidate, source);
      const target = createsSubfolder
        ? await emptySubfolder(candidate)
        : candidate;
      try {
        await access(
          (await optionalEntry(target)) ? target : picked,
          constants.W_OK
        );
      } catch (error) {
        throw new StorageSettingsError(
          "storage_settings.not_writable",
          `没有所选位置的写入权限：${reason(error)}`
        );
      }
      if (
        !(await this.options.confirmMigration(
          source,
          target,
          allowExistingTarget,
          createsSubfolder
        ))
      )
        return { restarting: false };
      this.assertNoRunningTasks();
      // Failed saves must reject the IPC request before a migration is scheduled.
      try {
        await this.options.flushRenderer();
      } catch (error) {
        throw new StorageSettingsError(
          "storage_settings.save_failed",
          `当前数据尚未保存，已取消迁移：${reason(error)}`
        );
      }
      this.assertNoRunningTasks();
      locations.schedule(target, allowExistingTarget);
      this.restarting = true;
      try {
        this.options.restart();
      } catch (error) {
        this.cancelRestart();
        throw error;
      }
      return { restarting: true };
    } finally {
      this.changing = false;
    }
  }
}
