import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  WorkspaceDirectorySettingsSchema,
  type WorkspaceDirectorySettings
} from "@deepwrite/contracts";
import {
  assertOutsideInstallationDirectory,
  overlapsInstallationDirectory
} from "./installation-directory-guard";
import { isNodeError } from "@deepwrite/shared/node";

interface DiskWorkspaceDirectorySettings {
  version: 1;
  path: string;
}

export class WorkspaceDirectoryStore {
  readonly settingsPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    userDataPath: string,
    private readonly installDirectory?: string
  ) {
    this.settingsPath = join(
      userDataPath,
      "config",
      "workspace-directory.json"
    );
  }

  /**
   * The saved path is re-checked on every read, not only when it is chosen: it
   * may predate the installation-directory rule, or the application may have
   * been moved or reinstalled around it since. A path that now overlaps the
   * installation directory is treated as unset so nothing is ever written there.
   */
  async list(): Promise<WorkspaceDirectorySettings> {
    const persisted = await this.readPersisted();
    return persisted.path && (await this.overlapsInstallation(persisted.path))
      ? { path: null }
      : persisted;
  }

  /** The saved path that `list()` currently refuses to use, if any. */
  async rejectedPath(): Promise<string | null> {
    const { path } = await this.readPersisted();
    return path && (await this.overlapsInstallation(path)) ? path : null;
  }

  private overlapsInstallation(path: string): Promise<boolean> {
    return this.installDirectory
      ? overlapsInstallationDirectory(path, this.installDirectory)
      : Promise.resolve(false);
  }

  private async readPersisted(): Promise<WorkspaceDirectorySettings> {
    await this.writeChain;
    try {
      const raw = JSON.parse(
        await readFile(this.settingsPath, "utf8")
      ) as unknown;
      if (
        !raw ||
        typeof raw !== "object" ||
        Array.isArray(raw) ||
        !("version" in raw) ||
        raw.version !== 1 ||
        !("path" in raw) ||
        typeof raw.path !== "string" ||
        !raw.path.trim()
      ) {
        return { path: null };
      }
      return WorkspaceDirectorySettingsSchema.parse({ path: raw.path });
    } catch (error: unknown) {
      if (isNodeError(error, "ENOENT") || error instanceof SyntaxError) {
        return { path: null };
      }
      throw error;
    }
  }

  async initializeDefault(
    documentsPath: string
  ): Promise<WorkspaceDirectorySettings> {
    const current = await this.list();
    if (current.path) {
      return current;
    }

    const absoluteDefaultPath = resolve(documentsPath, "DeepWriteBooks");
    await mkdir(absoluteDefaultPath, { recursive: true });
    return this.save(await realpath(absoluteDefaultPath));
  }

  async save(rawPath: string): Promise<WorkspaceDirectorySettings> {
    const requestedPath = rawPath.trim();
    if (!requestedPath) {
      throw new Error("工作目录不能为空。");
    }
    let saved: WorkspaceDirectorySettings | undefined;
    const operation = this.writeChain.then(async () => {
      const absolutePath = resolve(requestedPath);
      const info = await lstat(absolutePath);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error("工作目录必须是本地真实文件夹，不能是文件或符号链接。");
      }
      const canonicalPath = await realpath(absolutePath);
      if (this.installDirectory) {
        await assertOutsideInstallationDirectory(
          canonicalPath,
          this.installDirectory,
          "工作目录"
        );
      }
      const disk: DiskWorkspaceDirectorySettings = {
        version: 1,
        path: canonicalPath
      };
      await mkdir(dirname(this.settingsPath), { recursive: true });
      const temporary = `${this.settingsPath}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(temporary, `${JSON.stringify(disk, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600
      });
      await rename(temporary, this.settingsPath);
      saved = WorkspaceDirectorySettingsSchema.parse({ path: canonicalPath });
    });
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
    return saved!;
  }
}
