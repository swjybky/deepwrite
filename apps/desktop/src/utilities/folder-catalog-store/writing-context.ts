import { lstat, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DEFAULT_ACADEMIC_WRITING_CONTEXT,
  DEFAULT_SCRIPT_WRITING_CONTEXT,
  DEFAULT_SHORT_WRITING_CONTEXT,
  WRITING_CONTEXT_MAX_CHARACTERS,
  WRITING_CONTEXT_PATH,
  writingContextCharacterCount,
  type WorkspaceType
} from "@deepwrite/contracts";
import {
  assertContained,
  atomicWriteText,
  isNodeError,
  readRequiredUtf8File,
  secureExistingProjectPath,
  secureProjectRoot
} from "./paths-io";

const MAX_WRITING_CONTEXT_BYTES = WRITING_CONTEXT_MAX_CHARACTERS * 4 + 4;

export type WritingContextBookType = WorkspaceType | "academic";

export function defaultWritingContext(
  workspaceType: WritingContextBookType
): string {
  if (workspaceType === "academic") {
    return DEFAULT_ACADEMIC_WRITING_CONTEXT;
  }
  return workspaceType === "script"
    ? DEFAULT_SCRIPT_WRITING_CONTEXT
    : DEFAULT_SHORT_WRITING_CONTEXT;
}

async function readExistingWritingContext(
  projectDirectory: string
): Promise<string | undefined> {
  try {
    const path = await secureExistingProjectPath(
      projectDirectory,
      WRITING_CONTEXT_PATH,
      false
    );
    return await readRequiredUtf8File(
      path,
      MAX_WRITING_CONTEXT_BYTES,
      "writing context"
    );
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  }
}

async function secureWritingContextTarget(
  projectDirectory: string
): Promise<string> {
  const target = resolve(projectDirectory, WRITING_CONTEXT_PATH);
  assertContained(projectDirectory, target);
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error("Writing context must be a regular file.");
    }
    assertContained(projectDirectory, await realpath(target));
  } catch (error: unknown) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
  return target;
}

export async function readOrCreateWritingContext(
  rawProjectDirectory: string,
  workspaceType: WritingContextBookType
): Promise<{ content: string; truncated: boolean }> {
  const projectDirectory = await secureProjectRoot(rawProjectDirectory);
  const existing = await readExistingWritingContext(projectDirectory);
  if (existing !== undefined) {
    const characters = Array.from(existing);
    if (characters.length <= WRITING_CONTEXT_MAX_CHARACTERS) {
      return { content: existing, truncated: false };
    }
    return {
      content: characters.slice(0, WRITING_CONTEXT_MAX_CHARACTERS).join(""),
      truncated: true
    };
  }

  const content = defaultWritingContext(workspaceType);
  await atomicWriteText(
    await secureWritingContextTarget(projectDirectory),
    content
  );
  return { content, truncated: false };
}

export async function writeWritingContextFile(
  rawProjectDirectory: string,
  content: string
): Promise<void> {
  if (writingContextCharacterCount(content) > WRITING_CONTEXT_MAX_CHARACTERS) {
    throw new Error(
      `作品上下文超过 ${WRITING_CONTEXT_MAX_CHARACTERS} 个字符上限。`
    );
  }
  const projectDirectory = await secureProjectRoot(rawProjectDirectory);
  await atomicWriteText(
    await secureWritingContextTarget(projectDirectory),
    content
  );
}

export async function initializeWritingContextFile(
  rawProjectDirectory: string,
  workspaceType: WritingContextBookType
): Promise<void> {
  await writeWritingContextFile(
    rawProjectDirectory,
    defaultWritingContext(workspaceType)
  );
}
