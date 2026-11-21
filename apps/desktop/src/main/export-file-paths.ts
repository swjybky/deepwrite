import { access, rename, rm, writeFile } from "node:fs/promises";

export async function availableExportPath(
  basePath: string,
  extension: string,
  collisionError?: string
): Promise<string> {
  const limit = collisionError ? 100_000 : Infinity;
  for (let suffix = 1; suffix < limit; suffix += 1) {
    const candidate =
      suffix === 1
        ? `${basePath}${extension}`
        : `${basePath} (${suffix})${extension}`;
    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error(collisionError);
}

export async function writeExportFileAtomically(
  path: string,
  data: Buffer
): Promise<void> {
  const partial = `${path}.part`;
  try {
    await writeFile(partial, data);
    await rename(partial, path);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}
