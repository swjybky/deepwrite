import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  WorkspaceDirectorySettingsSchema,
  type WorkspaceDirectorySettings
} from "@deepwrite/contracts";

interface DiskWorkspaceDirectorySettings {
  version: 1;
  path: string;
}
function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export class WorkspaceDirectoryStore {
  readonly settingsPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.settingsPath = join(userDataPath, "config", "workspace-directory.json");
  }

  async list(): Promise<WorkspaceDirectorySettings> {
    await this.writeChain;
    try {
      const raw = JSON.parse(await readFile(this.settingsPath, "utf8")) as unknown;
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
