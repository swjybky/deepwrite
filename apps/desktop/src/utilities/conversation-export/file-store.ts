import { createHash } from "node:crypto";
import { open, rename, unlink, type FileHandle } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import {
  CONVERSATION_EXPORT_CHUNK_BYTES,
  ConversationExportTokenSchema,
  type ConversationExportFinished,
  type ConversationExportProgress
} from "@deepwrite/contracts";

interface ExportFile {
  filePath: string;
  tempPath: string;
  handle: FileHandle | undefined;
  nextSeq: number;
  bytes: number;
  digests: string[];
  completed: ConversationExportFinished | undefined;
  synced: boolean;
  poisoned: boolean;
  canceled: boolean;
  touchedAt: number;
  pending: Promise<void>;
}
interface FileSystemPort {
  open: typeof open;
  rename: typeof rename;
  unlink: typeof unlink;
}
const defaultFileSystem = { open, rename, unlink };

/** Only Main-authorized destinations enter this registry; chunk requests carry no path. */
export class ConversationExportFileStore {
  private readonly files = new Map<string, ExportFile>();
  private readonly preparing = new Map<string, Promise<ExportFile>>();
  private readonly fileSystem: FileSystemPort;
  private readonly timer: NodeJS.Timeout;
  private closed = false;
  constructor(
    private readonly options: {
      fileSystem?: FileSystemPort;
      now?: () => number;
      idleMs?: number;
    } = {}
  ) {
    this.fileSystem = options.fileSystem ?? defaultFileSystem;
    this.timer = setInterval(() => {
      void this.expire().catch(() => undefined);
    }, 30_000);
    this.timer.unref();
  }
  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
  private progress(file: ExportFile): ConversationExportProgress {
    return { nextSeq: file.nextSeq, bytes: file.bytes };
  }
  private async get(token: string): Promise<ExportFile> {
    const file = this.files.get(token) ?? (await this.preparing.get(token));
    if (!file) throw new Error("导出任务已过期，请重新选择保存位置。");
    file.touchedAt = this.now();
    return file;
  }
  private serial<T>(file: ExportFile, action: () => Promise<T>): Promise<T> {
    const work = file.pending.then(action);
    file.pending = work.then(
      () => undefined,
      () => undefined
    );
    return work;
  }
  async prepare(
    token: string,
    filePath: string
  ): Promise<ConversationExportProgress> {
    ConversationExportTokenSchema.parse({ token });
    if (this.closed || !isAbsolute(filePath) || filePath.includes("\0"))
      throw new Error("无效的导出位置。");
    const preparing = this.preparing.get(token);
    let file =
      this.files.get(token) ?? (preparing ? await preparing : undefined);
    if (!file) {
      const active = [...this.files.values()].filter(
        (entry) => !entry.completed && !entry.canceled
      ).length;
      if (active + this.preparing.size >= 16)
        throw new Error("请完成或取消已有导出任务后重试。");
      const task = (async (): Promise<ExportFile> => {
        const tempPath = join(
          dirname(filePath),
          `.deepwrite-conversation-export-${token}.tmp`
        );
        const handle = await this.fileSystem.open(tempPath, "wx", 0o600);
        const created: ExportFile = {
          filePath,
          tempPath,
          handle,
          nextSeq: 0,
          bytes: 0,
          digests: [],
          completed: undefined,
          synced: false,
          poisoned: false,
          canceled: false,
          touchedAt: this.now(),
          pending: Promise.resolve()
        };
        this.files.set(token, created);
        return created;
      })();
      this.preparing.set(token, task);
      try {
        file = await task;
      } finally {
        this.preparing.delete(token);
      }
    }
    if (file.filePath !== filePath || file.canceled)
      throw new Error("导出授权与保存位置不一致。");
    return this.progress(file);
  }
  async append(
    token: string,
    seq: number,
    text: string
  ): Promise<ConversationExportProgress> {
    const bytes = Buffer.from(text, "utf8");
    if (
      !bytes.length ||
      bytes.length > CONVERSATION_EXPORT_CHUNK_BYTES ||
      !Number.isSafeInteger(seq) ||
      seq < 0
    )
      throw new Error("无效的导出数据块。");
    const file = await this.get(token);
    return this.serial(file, async () => {
      if (file.canceled || file.poisoned)
        throw new Error("导出已取消或写入失败，请重新选择位置导出。");
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (seq < file.nextSeq && file.digests[seq] === digest)
        return this.progress(file);
      if (
        file.canceled ||
        file.completed ||
        file.synced ||
        !file.handle ||
        seq !== file.nextSeq
      )
        throw new Error("导出数据块顺序或内容不一致。");
      try {
        let offset = 0;
        while (offset < bytes.length) {
          const written = await file.handle.write(
            bytes,
            offset,
            bytes.length - offset,
            file.bytes + offset
          );
          if (!written.bytesWritten) throw new Error("无法继续写入导出文件。");
          offset += written.bytesWritten;
        }
      } catch (error) {
        // Never retry a partially written file, even if truncation itself fails.
        file.poisoned = true;
        await file.handle.truncate(file.bytes).catch(() => undefined);
        throw error;
      }
      file.bytes += bytes.length;
      file.nextSeq += 1;
      file.digests.push(digest);
      return this.progress(file);
    });
  }
  async finish(
    token: string,
    seq: number
  ): Promise<ConversationExportFinished> {
    const file = await this.get(token);
    return this.serial(file, async () => {
      if (seq !== file.nextSeq) throw new Error("导出尚有未完成的数据块。");
      if (file.completed) return file.completed;
      if (file.canceled || file.poisoned)
        throw new Error("导出已取消或写入失败，请重新选择位置导出。");
      if (!file.synced) {
        if (!file.handle) throw new Error("导出文件尚未就绪。");
        await file.handle.sync();
        file.synced = true;
      }
      if (file.handle) {
        await file.handle.close().catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "EBADF") throw error;
        });
        file.handle = undefined;
      }
      await this.fileSystem.rename(file.tempPath, file.filePath);
      // Rename is the commit point. Preserve this result even if a later directory fsync is unavailable.
      file.completed = { fileName: basename(file.filePath), bytes: file.bytes };
      let directory: FileHandle | undefined;
      try {
        directory = await this.fileSystem.open(dirname(file.filePath), "r");
        await directory.sync();
      } catch {
        /* Some supported filesystems do not permit directory fsync. */
      } finally {
        await directory?.close();
      }
      return file.completed;
    });
  }
  async cancel(token: string): Promise<void> {
    const file = this.files.get(token) ?? (await this.preparing.get(token));
    if (!file) return;
    await this.serial(file, async () => {
      if (file.completed || file.canceled) return;
      await file.handle?.close();
      file.handle = undefined;
      await this.fileSystem
        .unlink(file.tempPath)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      file.canceled = true;
    });
  }
  async expire(): Promise<void> {
    for (const [token, file] of this.files) {
      if (this.now() - file.touchedAt < (this.options.idleMs ?? 15 * 60_000))
        continue;
      await this.cancel(token);
      this.files.delete(token);
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    await Promise.allSettled(this.preparing.values());
    await Promise.all(
      [...this.files.keys()].map((token) => this.cancel(token))
    );
    this.files.clear();
  }
}
