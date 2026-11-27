import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LONG_AGENTS_MD,
  LONG_AGENTS_MD_PATH,
  LONG_BOOK_LINE_FILE_ID,
  LONG_CHARACTER_OVERVIEW_FILE_ID,
  LONG_CHARACTER_OVERVIEW_PATH,
  LONG_WORKSPACE_INDEX_PATH,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterContinuityFilePath,
  longChapterCharacterCurrentStateFileId,
  longChapterCharacterHistoryFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  longChapterWorldRevealsFileId,
  longCharacterCoreProfileFileId,
  longCharacterCurrentStateFileId,
  longCharacterFilePath,
  longCharacterHistoryFileId,
  longCharacterRelationshipsFileId,
  createEmptyLongMarkdownFileReference,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  longWorldbuildingFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  serializeLongWorldbuildingMarkdownList,
  type LongForeshadowing
} from "@deepwrite/contracts";
import {
  deriveLongForeshadowingStatus,
  LongProjectStore
} from "./long-project-store";
import { sha256Hex } from "@deepwrite/shared/node";

// This fixture creates real long projects and durable multi-file transactions.
// Give its integration suites a disk budget on slower concurrent CI runners.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const FIXED_NOW = "2026-07-26T12:00:00.000Z";
const MAX_MARKDOWN_BYTES = 32 * 1024 * 1024;
const temporaryRoots: string[] = [];

async function temporaryParent(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-long-project-"));
  temporaryRoots.push(root);
  return root;
}

function store(): LongProjectStore {
  return new LongProjectStore({ now: () => FIXED_NOW });
}

// Legacy-fixture helper only. Production no longer creates or compares file
// revisions, but migration tests still need to construct the retired format.
function createLongFileRevision(content: string | Uint8Array): string {
  const bytes =
    typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return `v2:${bytes.byteLength}:${sha256Hex(bytes)}`;
}

async function createFixture(suffix: string) {
  const parent = await temporaryParent();
  const projectStore = store();
  const created = await projectStore.createBook(parent, {
    id: `longbook_${suffix}`,
    title: `长篇 ${suffix}`,
    genre: "悬疑"
  });
  return { parent, projectStore, created };
}

function firstChapterFiles(
  book: Awaited<ReturnType<LongProjectStore["openBook"]>>["book"]
) {
  const chapter = book.workspaceIndex.chapters[0]!;
  return {
    body: chapter.body,
    card: chapter.card,
    characterState: chapter.characterState,
    handoff: chapter.handoff
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
      })
    )
  );
});

export {
  DEFAULT_LONG_AGENTS_MD,
  FIXED_NOW,
  LONG_AGENTS_MD_PATH,
  LONG_BOOK_LINE_FILE_ID,
  LONG_CHARACTER_OVERVIEW_FILE_ID,
  LONG_CHARACTER_OVERVIEW_PATH,
  LONG_WORKSPACE_INDEX_PATH,
  LongProjectStore,
  MAX_MARKDOWN_BYTES,
  afterEach,
  createEmptyLongMarkdownFileReference,
  createFixture,
  createLongFileRevision,
  deriveLongForeshadowingStatus,
  describe,
  expect,
  firstChapterFiles,
  it,
  join,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterContinuityFilePath,
  longChapterCharacterCurrentStateFileId,
  longChapterCharacterHistoryFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  longChapterWorldRevealsFileId,
  longCharacterCoreProfileFileId,
  longCharacterCurrentStateFileId,
  longCharacterFilePath,
  longCharacterHistoryFileId,
  longCharacterRelationshipsFileId,
  longWorldbuildingFileId,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  lstat,
  mkdir,
  mkdtemp,
  sha256Hex,
  readFile,
  readdir,
  realpath,
  rm,
  serializeLongWorldbuildingMarkdownList,
  store,
  symlink,
  temporaryParent,
  temporaryRoots,
  tmpdir,
  unlink,
  writeFile,
  writeFileSync
};
export type { LongForeshadowing };
