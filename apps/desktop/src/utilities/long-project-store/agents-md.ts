import {
  DEFAULT_LONG_AGENTS_MD,
  LONG_AGENTS_MD_MAX_CHARACTERS,
  LONG_AGENTS_MD_PATH
} from "@deepwrite/contracts";
import { readSecureTextFile } from "./io";
import { MAX_AGENTS_MD_BYTES, type SecureTextFile } from "./types";
import { isNodeError } from "@deepwrite/shared/node";

export function sliceAgentsMdContent(content: string): {
  content: string;
  truncated: boolean;
} {
  const characters = Array.from(content);
  if (characters.length <= LONG_AGENTS_MD_MAX_CHARACTERS) {
    return { content, truncated: false };
  }
  return {
    content: characters.slice(0, LONG_AGENTS_MD_MAX_CHARACTERS).join(""),
    truncated: true
  };
}

export function normalizeAgentsMdContent(content: string): string {
  return sliceAgentsMdContent(content).content;
}

export async function tryReadAgentsMdFile(
  projectDirectory: string
): Promise<SecureTextFile | null> {
  try {
    return await readSecureTextFile(
      projectDirectory,
      LONG_AGENTS_MD_PATH,
      MAX_AGENTS_MD_BYTES
    );
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return null;
    throw error;
  }
}

export async function readAgentsMdContentOrDefault(
  projectDirectory: string
): Promise<string> {
  const existing = await tryReadAgentsMdFile(projectDirectory);
  return existing
    ? sliceAgentsMdContent(existing.content).content
    : DEFAULT_LONG_AGENTS_MD;
}
