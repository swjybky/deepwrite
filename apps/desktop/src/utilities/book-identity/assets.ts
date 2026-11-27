import { lstat, readdir } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  BookIdentityRecord,
  BookIdentityRound
} from "@deepwrite/contracts";
import { BOOK_IDENTITY_MAX_COMPOSED_BYTES } from "@deepwrite/contracts";
import {
  writeIdentityFile,
  identityFile,
  isMissing,
  optionalBytes,
  removeOptional,
  secureDirectory
} from "./io";

export function roundAssets(round: BookIdentityRound): string[] {
  if (round.field !== "cover") return [];
  return round.candidates.flatMap((candidate) =>
    candidate.images.flatMap((image) => [
      image.file,
      image.thumb,
      ...(image.composed ? [image.composed.file] : [])
    ])
  );
}

export function referencedAssets(record: BookIdentityRecord): Set<string> {
  return new Set([
    ...record.rounds.flatMap(roundAssets),
    ...(record.adopted.cover ? [record.adopted.cover.file] : [])
  ]);
}

export class AssetTransaction {
  private readonly writes: Array<{ path: string; previous?: Buffer }> = [];
  constructor(
    private readonly directory: string,
    private readonly write = writeIdentityFile
  ) {}

  async put(file: string, bytes: Buffer, exclusive = false): Promise<void> {
    const path = await identityFile(this.directory, file, true);
    const previous = await optionalBytes(
      path,
      BOOK_IDENTITY_MAX_COMPOSED_BYTES
    );
    if (exclusive && previous) throw new Error("封面图片标识已存在。");
    await this.write(path, bytes);
    this.writes.push({ path, ...(previous ? { previous } : {}) });
  }

  async rollback(): Promise<void> {
    const errors: unknown[] = [];
    for (const { path, previous } of this.writes.reverse()) {
      try {
        if (previous) await this.write(path, previous);
        else await removeOptional(path);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "封面文件无法完整回滚。");
  }
}

/** A valid record is required. Keep young files and unknown file names intact. */
export async function cleanOrphanAssets(
  directory: string,
  record: BookIdentityRecord,
  now: number
): Promise<void> {
  const referenced = referencedAssets(record);
  let covers: string;
  try {
    covers = await secureDirectory(
      dirname(await identityFile(directory, "covers/.placeholder"))
    );
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  for (const name of await readdir(covers)) {
    if (!/^[a-zA-Z0-9_-]+(?:\.thumb|\.composed)?\.(?:png|jpg|webp)$/.test(name))
      continue;
    const file = `covers/${name}`;
    if (referenced.has(file)) continue;
    const path = await identityFile(directory, file);
    const info = await lstat(path);
    if (info.mtimeMs < now - 3_600_000) await removeOptional(path);
  }
}

export async function removeAssets(
  directory: string,
  files: Iterable<string>
): Promise<void> {
  for (const file of files)
    await removeOptional(await identityFile(directory, file));
}
