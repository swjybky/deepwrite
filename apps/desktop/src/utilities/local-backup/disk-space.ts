import { statfs } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { formatBytes } from "@deepwrite/shared";
import { isNodeError } from "@deepwrite/shared/node";
import { LocalBackupError } from "./errors";

export interface DiskSpaceStats {
  bavail: number | bigint;
  bsize: number | bigint;
}

export type StatFsFn = (path: string) => Promise<DiskSpaceStats>;

export function requiredExportDiskBytes(rawBytes: number): number {
  return Math.ceil(Math.max(0, rawBytes) * 1.2) + 32 * 1024 * 1024;
}

export function requiredImportDiskBytes(uncompressedBytes: number): number {
  return Math.ceil(Math.max(0, uncompressedBytes) * 1.5) + 64 * 1024 * 1024;
}

async function nearestExistingPath(targetPath: string): Promise<string> {
  let current = resolve(targetPath);
  for (;;) {
    try {
      await statfs(current);
      return current;
    } catch (error: unknown) {
      if (!isNodeError(error, "ENOENT", "ENOTDIR")) {
        return current;
      }
      const parent = dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

export async function readAvailableDiskBytes(
  targetPath: string,
  statfsImpl: StatFsFn = statfs
): Promise<number> {
  const probePath =
    statfsImpl === statfs
      ? await nearestExistingPath(targetPath)
      : resolve(targetPath);
  const stats = await statfsImpl(probePath);
  const bavail = Number(stats.bavail);
  const bsize = Number(stats.bsize);
  if (
    !Number.isFinite(bavail) ||
    !Number.isFinite(bsize) ||
    bavail < 0 ||
    bsize <= 0
  ) {
    return 0;
  }
  const available = Math.floor(bavail * bsize);
  return Number.isFinite(available) ? available : Number.MAX_SAFE_INTEGER;
}

export async function assertSufficientDiskSpace(options: {
  targetPath: string;
  requiredBytes: number;
  purpose: "export" | "import";
  statfsImpl?: StatFsFn;
}): Promise<number> {
  const availableBytes = await readAvailableDiskBytes(
    options.targetPath,
    options.statfsImpl
  );
  if (availableBytes < options.requiredBytes) {
    const label =
      options.purpose === "export" ? "导出目标磁盘" : "工作目录所在磁盘";
    throw new LocalBackupError(
      "local_backup.insufficient_space",
      `${label}可用空间不足：需要约 ${formatBytes(options.requiredBytes)}，当前剩余 ${formatBytes(availableBytes)}。请清理空间后重试。`,
      {
        requiredBytes: options.requiredBytes,
        availableBytes
      }
    );
  }
  return availableBytes;
}
