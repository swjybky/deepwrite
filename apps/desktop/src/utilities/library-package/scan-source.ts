import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { TextDecoder } from "node:util";
import {
  isLibraryPackageTextPath,
  type LibraryPackageSourceFile,
  type LibraryPackageSourceKind,
  type LibraryPackageSourceTree
} from "@deepwrite/contracts";
import { openLegacyZipArchive } from "../legacy-zip";

const MAX_TEXT_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_TEXT_BYTES = 512 * 1024 * 1024;
const MAX_FILES = 20_000;
const MAX_DEPTH = 6;
const IGNORED = new Set([
  "__macosx",
  "thumbs.db",
  "desktop.ini",
  "node_modules"
]);

export interface ScannedLibraryPackageSource {
  tree: LibraryPackageSourceTree;
  /** Changes whenever a scanned path, size or text content changes. */
  fingerprint: string;
}

function ignoredSegment(segment: string): boolean {
  return segment.startsWith(".") || IGNORED.has(segment.toLowerCase());
}

/** UTF-8 (with or without BOM), UTF-16 with BOM, then GB18030; else null. */
export function decodeLibraryText(bytes: Uint8Array): string | null {
  const decode = (encoding: string, value: Uint8Array) =>
    new TextDecoder(encoding, { fatal: true }).decode(value);
  let text: string;
  try {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      text = decode("utf-8", bytes.subarray(3));
    } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      text = decode("utf-16le", bytes.subarray(2));
    } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      text = decode("utf-16be", bytes.subarray(2));
    } else {
      try {
        text = decode("utf-8", bytes);
      } catch {
        text = decode("gb18030", bytes);
      }
    }
  } catch {
    return null;
  }
  if (text.includes("\u0000")) return null;
  return text.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
}

class SourceCollector {
  readonly files: LibraryPackageSourceFile[] = [];
  private readonly seen = new Set<string>();
  private readonly hash = createHash("sha256");
  private textBytes = 0;

  async add(
    rawPath: string,
    size: number,
    load: () => Promise<Uint8Array> | Uint8Array
  ): Promise<void> {
    const path = rawPath.normalize("NFC");
    if (this.seen.has(path)) return;
    this.seen.add(path);
    if (this.files.length >= MAX_FILES) {
      throw new Error("所选来源的文件超过 20,000 个，请选择更具体的文件夹。");
    }
    this.hash.update(`${path}\u0000${size}\u0000`);
    if (!isLibraryPackageTextPath(path)) {
      this.files.push({ path, skip: "unsupported" });
      return;
    }
    if (size > MAX_TEXT_BYTES) {
      this.files.push({ path, skip: "tooLarge" });
      return;
    }
    this.textBytes += size;
    if (this.textBytes > MAX_TOTAL_TEXT_BYTES) {
      throw new Error("所选来源的文本合计超过 512 MB 上限。");
    }
    const bytes = await load();
    this.hash.update(createHash("sha256").update(bytes).digest("hex"));
    const text = decodeLibraryText(bytes);
    this.files.push(
      text === null ? { path, skip: "undecodable" } : { path, text }
    );
  }

  result(rootName: string): ScannedLibraryPackageSource {
    const files = [...this.files].sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    );
    return {
      tree: { rootName: rootName.normalize("NFC"), files },
      fingerprint: this.hash.digest("hex")
    };
  }
}

async function scanZip(
  sourcePath: string
): Promise<ScannedLibraryPackageSource> {
  const archive = await openLegacyZipArchive(sourcePath, "压缩包");
  const collector = new SourceCollector();
  for (const name of archive.entryNames) {
    if (name.split("/").some(ignoredSegment)) continue;
    await collector.add(name, archive.sizeOf(name) ?? 0, () =>
      archive.read(name)!
    );
  }
  return collector.result(basename(sourcePath, extname(sourcePath)));
}

async function scanDirectory(
  sourcePath: string
): Promise<ScannedLibraryPackageSource> {
  const info = await lstat(sourcePath);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("导入来源必须是普通文件夹，不能是符号链接。");
  }
  const root = await realpath(sourcePath);
  const collector = new SourceCollector();
  const walk = async (directory: string, prefix: string, depth: number) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => (left.name < right.name ? -1 : 1));
    for (const entry of entries) {
      if (ignoredSegment(entry.name) || entry.isSymbolicLink()) continue;
      const absolute = join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) await walk(absolute, relative, depth + 1);
      } else if (entry.isFile()) {
        const { size } = await lstat(absolute);
        await collector.add(relative, size, () => readFile(absolute));
      }
    }
  };
  await walk(root, "", 1);
  return collector.result(basename(root));
}

/** Reads a ZIP or folder into the tree `recognizeLibraryPackage` expects. */
export async function scanLibraryPackageSource(
  sourcePath: string,
  sourceKind: LibraryPackageSourceKind
): Promise<ScannedLibraryPackageSource> {
  return sourceKind === "zip"
    ? await scanZip(sourcePath)
    : await scanDirectory(sourcePath);
}
