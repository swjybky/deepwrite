import type { LongBookSummary } from "@deepwrite/contracts";
import { lstat, realpath } from "node:fs/promises";
import { resolve } from "node:path";
export interface LongProjectRegistration {
  bookId: string;
  projectDirectory: string;
  registeredAt: string;
  /**
   * Navigation-only metadata used by list(). Version-1 registries did not
   * persist this field; they are hydrated once and rewritten as version 2.
   */
  summary?: LongBookSummary;
  deletion?: {
    originalProjectDirectory: string;
    stagedProjectDirectory: string;
  };
}

export interface LongProjectRegistry {
  schemaVersion: 1 | 2;
  updatedAt: string;
  projects: LongProjectRegistration[];
}

export async function assertAvailableProjectDirectory(
  path: string
): Promise<void> {
  const absolute = resolve(path);
  const details = await lstat(absolute);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error("长篇项目路径必须是非符号链接目录。");
  }
  if ((await realpath(absolute)) !== absolute) {
    throw new Error("长篇项目注册路径不是规范化真实路径。");
  }
}

export async function secureProjectDirectory(path: string): Promise<string> {
  const absolute = resolve(path);
  const details = await lstat(absolute);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error("长篇项目路径必须是非符号链接目录。");
  }
  const canonical = await realpath(absolute);
  return canonical;
}

export function requireRegisteredLongProject(
  registry: LongProjectRegistry,
  bookId: string
): LongProjectRegistration {
  const registration = registry.projects.find(
    (project) => project.bookId === bookId
  );
  if (!registration)
    throw new Error("长篇项目不存在、未注册或已从创作空间移除。");
  if (registration.deletion)
    throw new Error("长篇项目正在永久删除；可重试删除以完成清理。");
  return registration;
}
