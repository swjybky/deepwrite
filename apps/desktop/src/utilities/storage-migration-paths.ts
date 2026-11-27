import { open, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isMissing, StorageMigrationError } from "./storage-migration-files";
import { isRecord } from "@deepwrite/shared";

export function containsPath(parent: string, child: string): boolean {
  const suffix = relative(parent, child);
  return (
    suffix === "" ||
    (suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))
  );
}

async function rebase(
  value: unknown,
  source: string,
  target: string
): Promise<unknown> {
  if (typeof value !== "string" || !isAbsolute(value)) return value;
  let canonical = resolve(value);
  try {
    canonical = await realpath(canonical);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  return containsPath(source, canonical)
    ? join(target, relative(source, canonical))
    : value;
}

/** Only schema-owned filesystem fields are rewritten; text and history stay byte-identical. */
export async function rebaseStoragePaths(
  staging: string,
  source: string,
  target: string
): Promise<void> {
  const files = [
    "catalog-registry.json",
    "catalog-registry.json.bak",
    "long-project-registry.json",
    "long-project-registry.json.bak",
    join("config", "workspace-directory.json")
  ];
  for (const name of files) {
    const path = join(staging, name);
    let original: string;
    try {
      original = await readFile(path, "utf8");
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(original);
    } catch {
      throw new StorageMigrationError("存储路径配置损坏，请先修复后再迁移。");
    }
    if (!isRecord(value))
      throw new StorageMigrationError("存储路径配置格式无效。");
    const previous = JSON.stringify(value);
    if (name === join("config", "workspace-directory.json")) {
      if (value.version !== 1 || typeof value.path !== "string") {
        throw new StorageMigrationError("工作目录配置格式无效。");
      }
      value.path = await rebase(value.path, source, target);
    } else {
      if (!Array.isArray(value.projects))
        throw new StorageMigrationError("作品目录注册表格式无效。");
      for (const project of value.projects) {
        if (
          !isRecord(project) ||
          typeof project.projectDirectory !== "string"
        ) {
          throw new StorageMigrationError("作品目录注册表格式无效。");
        }
        project.projectDirectory = await rebase(
          project.projectDirectory,
          source,
          target
        );
        if (name.startsWith("long-project-") && isRecord(project.deletion)) {
          for (const key of [
            "originalProjectDirectory",
            "stagedProjectDirectory"
          ]) {
            project.deletion[key] = await rebase(
              project.deletion[key],
              source,
              target
            );
          }
        }
      }
    }
    if (JSON.stringify(value) !== previous) {
      const output = await open(path, "w");
      try {
        await output.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
        await output.sync();
      } finally {
        await output.close();
      }
    }
  }
}
