import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  CatalogProjectContentPathSchema,
  createShortWorkspaceContentRevision
} from "@deepwrite/contracts";
import { randomHex8 } from "@deepwrite/shared";
import { FolderCatalogConflictError } from "./types";
import { isNodeError } from "@deepwrite/shared/node";

export function sanitizeFileName(
  value: string,
  fallback = "未命名项目"
): string {
  const normalized = value
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/[. ]+$/gu, "")
    .trim();
  const shortened = [...normalized].slice(0, 80).join("");
  return shortened || fallback;
}

export function sanitizePathSegment(value: string): string {
  return sanitizeFileName(value, "content")
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-");
}

export function portableContentPathKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

export async function uniqueRelativeMarkdownPath(
  projectDirectory: string,
  directory: string,
  id: string,
  usedPortableKeys: ReadonlySet<string>
): Promise<string> {
  const occupied = new Set(usedPortableKeys);
  const contentDirectory = resolve(projectDirectory, directory);
  assertContained(projectDirectory, contentDirectory);
  if (await pathExists(contentDirectory)) {
    const actualDirectory = await secureDirectory(
      contentDirectory,
      "content directory"
    );
    assertContained(projectDirectory, actualDirectory);
    for (const name of await readdir(actualDirectory)) {
      occupied.add(portableContentPathKey(`${directory}/${name}`));
    }
  }
  const stem = sanitizePathSegment(id);
  let index = 1;
  let candidate = `${directory}/${stem}.md`;
  while (
    occupied.has(portableContentPathKey(candidate)) ||
    (await pathExists(resolve(projectDirectory, candidate)))
  ) {
    index += 1;
    candidate = `${directory}/${stem}-${index}.md`;
  }
  return CatalogProjectContentPathSchema.parse(candidate);
}

export async function uniqueRelativeMarkdownPathWithSuffix(
  projectDirectory: string,
  directory: string,
  id: string,
  suffix: `.${string}.md`,
  usedPortableKeys: ReadonlySet<string>
): Promise<string> {
  const occupied = new Set(usedPortableKeys);
  const contentDirectory = resolve(projectDirectory, directory);
  assertContained(projectDirectory, contentDirectory);
  if (await pathExists(contentDirectory)) {
    const actualDirectory = await secureDirectory(
      contentDirectory,
      "content directory"
    );
    assertContained(projectDirectory, actualDirectory);
    for (const name of await readdir(actualDirectory)) {
      occupied.add(portableContentPathKey(`${directory}/${name}`));
    }
  }
  const stem = sanitizePathSegment(id);
  let index = 1;
  let candidate = `${directory}/${stem}${suffix}`;
  while (
    occupied.has(portableContentPathKey(candidate)) ||
    (await pathExists(resolve(projectDirectory, candidate)))
  ) {
    index += 1;
    candidate = `${directory}/${stem}-${index}${suffix}`;
  }
  return CatalogProjectContentPathSchema.parse(candidate);
}

export async function availableProjectDirectory(
  parentDirectory: string,
  title: string
): Promise<string> {
  const name = sanitizeFileName(title);
  for (let index = 1; index < 10_000; index += 1) {
    const suffix = index === 1 ? "" : `-${index}`;
    const candidate = join(parentDirectory, `${name}${suffix}`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }
  throw new Error("无法为项目分配不重复的文件夹名称。");
}

export async function secureDirectory(
  path: string,
  label: string
): Promise<string> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`${label} must be a real directory, not a symbolic link.`);
  }
  return await realpath(path);
}

export async function secureProjectRoot(path: string): Promise<string> {
  return await secureDirectory(resolve(path), "project root");
}

export function assertContained(root: string, candidate: string): void {
  const offset = relative(root, candidate);
  if (
    offset === "" ||
    (!offset.startsWith(`..${sep}`) && offset !== ".." && !isAbsolute(offset))
  ) {
    return;
  }
  throw new Error("Project path escapes its project directory.");
}

export async function secureExistingProjectPath(
  projectRoot: string,
  relativePath: string,
  markdown: boolean
): Promise<string> {
  if (markdown) {
    CatalogProjectContentPathSchema.parse(relativePath);
  } else if (
    !relativePath ||
    isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    relativePath.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("Project path must be a normalized relative path.");
  }
  const candidate = resolve(projectRoot, relativePath);
  assertContained(projectRoot, candidate);
  const info = await lstat(candidate);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error("Project files must be regular files, not symbolic links.");
  }
  const actual = await realpath(candidate);
  assertContained(projectRoot, actual);
  return actual;
}

export async function secureWritableProjectPath(
  projectRoot: string,
  relativePath: string
): Promise<string> {
  CatalogProjectContentPathSchema.parse(relativePath);
  const target = resolve(projectRoot, relativePath);
  assertContained(projectRoot, target);
  let currentDirectory = projectRoot;
  for (const segment of relativePath.split("/").slice(0, -1)) {
    const nextDirectory = join(currentDirectory, segment);
    if (!(await pathExists(nextDirectory))) {
      try {
        await mkdir(nextDirectory, { mode: 0o700 });
      } catch (error: unknown) {
        if (!isNodeError(error, "EEXIST")) {
          throw error;
        }
      }
    }
    currentDirectory = await secureDirectory(nextDirectory, "content parent");
    assertContained(projectRoot, currentDirectory);
  }
  if (await pathExists(target)) {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error(
        "Project files must be regular files, not symbolic links."
      );
    }
    assertContained(projectRoot, await realpath(target));
  }
  return target;
}

export async function readProjectMarkdown(
  projectDirectory: string,
  path: string,
  maxBytes: number
): Promise<string> {
  const actual = await secureExistingProjectPath(projectDirectory, path, true);
  return await readRequiredUtf8File(actual, maxBytes, "Markdown file");
}

export async function readOptionalUtf8File(
  path: string,
  maxBytes: number,
  label: string
): Promise<string | undefined> {
  try {
    return await readRequiredUtf8File(path, maxBytes, label);
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

export async function readRequiredUtf8File(
  path: string,
  maxBytes: number,
  label: string
): Promise<string> {
  const directInfo = await lstat(path);
  if (directInfo.isSymbolicLink() || !directInfo.isFile()) {
    throw new Error(`${label} is not a regular file.`);
  }
  const info = await stat(path);
  if (info.size > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes} byte limit.`);
  }
  const bytes = await readFile(path);
  if (bytes.byteLength > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes} byte limit.`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8.`);
  }
}

export function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new Error(
      `JSON 无法解析：${path}（${error instanceof Error ? error.message : "格式错误"}）`
    );
  }
}

export function assertTextByteLength(
  text: string,
  maxBytes: number,
  label: string
): void {
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes} byte limit.`);
  }
}

export function assertJsonByteLength(value: unknown, maxBytes: number): void {
  assertTextByteLength(
    `${JSON.stringify(value, null, 2)}\n`,
    maxBytes,
    "JSON content"
  );
}

export async function commitProjectMarkdownUpdate(
  target: string,
  nextContent: string,
  previousContent: string | undefined,
  manifestPath: string,
  manifest: unknown,
  maxMarkdownBytes: number,
  maxManifestBytes: number
): Promise<void> {
  // Preflight deterministic schema-size failures before touching the user's
  // Markdown, then restore the previous file if the manifest commit itself
  // fails. A different on-disk value means an external editor won the race;
  // leave that value intact and surface a conflict instead of overwriting it.
  assertJsonByteLength(manifest, maxManifestBytes);
  assertTextByteLength(nextContent, maxMarkdownBytes, "Markdown content");
  await writeProjectTextAtomic(target, nextContent);
  try {
    const observed = await readRequiredUtf8File(
      target,
      maxMarkdownBytes,
      "Markdown content"
    );
    if (observed !== nextContent) {
      throw new FolderCatalogConflictError(
        createShortWorkspaceContentRevision(nextContent),
        createShortWorkspaceContentRevision(observed)
      );
    }
    await writeBoundedProjectJson(manifestPath, manifest, maxManifestBytes);
  } catch (error: unknown) {
    try {
      const observed = await readOptionalUtf8File(
        target,
        maxMarkdownBytes,
        "Markdown content"
      );
      if (observed === nextContent) {
        if (previousContent === undefined) {
          await unlinkOptional(target);
        } else {
          await writeProjectTextAtomic(target, previousContent);
        }
      }
    } catch (rollbackError: unknown) {
      throw new AggregateError(
        [error, rollbackError],
        "项目保存失败，且无法自动恢复原 Markdown。"
      );
    }
    throw error;
  }
}

export async function commitProjectFileCreations(
  files: ReadonlyArray<{ target: string; content: string }>,
  manifestPath: string,
  manifest: unknown,
  maxMarkdownBytes: number,
  maxManifestBytes: number
): Promise<void> {
  assertJsonByteLength(manifest, maxManifestBytes);
  for (const file of files) {
    assertTextByteLength(file.content, maxMarkdownBytes, "Markdown content");
    if (await pathExists(file.target)) {
      throw new Error("新的正文小节文件路径已被其他文件占用。");
    }
  }
  const committed: Array<{ target: string; content: string }> = [];
  try {
    for (const file of files) {
      await writeProjectTextAtomic(file.target, file.content);
      committed.push(file);
    }
    await writeBoundedProjectJson(manifestPath, manifest, maxManifestBytes);
  } catch (error: unknown) {
    const rollbackErrors: unknown[] = [];
    for (const file of committed.reverse()) {
      try {
        const observed = await readOptionalUtf8File(
          file.target,
          maxMarkdownBytes,
          "Markdown content"
        );
        if (observed === file.content) {
          await unlinkOptional(file.target);
        }
      } catch (rollbackError: unknown) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "正文小节创建失败，且无法完整清理未提交文件。"
      );
    }
    throw error;
  }
}

export async function writeProjectTextAtomic(
  path: string,
  value: string
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.deepwrite-${randomHex8()}.tmp`);
  try {
    await writeFile(temporary, value, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  } catch (error: unknown) {
    await unlinkOptional(temporary);
    throw error;
  }
}

export async function writeBoundedProjectJson(
  path: string,
  value: unknown,
  maxBytes: number
): Promise<void> {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  assertTextByteLength(serialized, maxBytes, "JSON content");
  await writeProjectTextAtomic(path, serialized);
}

export async function unlinkOptional(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error: unknown) {
    if (!isNodeError(error, "ENOENT")) {
      throw error;
    }
  }
}

export async function removeEmptyOrPartialProject(path: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(path, { recursive: true, force: true });
}

export async function cleanupNewProjectDirectories(
  paths: readonly string[]
): Promise<void> {
  const failures: unknown[] = [];
  for (const path of [...paths].reverse()) {
    try {
      await removeEmptyOrPartialProject(path);
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  if (failures.length) {
    throw new AggregateError(
      failures,
      "新建项目注册失败，且无法完整清理未注册文件夹。"
    );
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}
