import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeSyncJson(
  path: string,
  value: string
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(value, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    if ((await readFile(temporary, "utf8")) !== value)
      throw new Error("同步记录读回校验失败。");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
