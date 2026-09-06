import {
  LONG_WORKSPACE_INDEX_PATH,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  LongWriteChapterInputSchema,
  type LongWriteChapterResult
} from "@deepwrite/contracts";
import { loadIndexedFile } from "./cache";
import { assertMutableChapterDocument } from "./integrity";
import {
  commitLongProjectTransaction,
  secureDirectory,
  serializeJson
} from "./io";
import { loadProject } from "./load-project";
import { firstEmptyChapter } from "./paths";
import type { LongProjectStoreContext } from "./store-context";
import {
  MANIFEST_PATH,
  MAX_LEDGER_RECORD_BYTES,
  type StoreWriteLongChapterInput
} from "./types";

export async function writeChapter(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  rawInput: StoreWriteLongChapterInput
): Promise<LongWriteChapterResult> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    const input = LongWriteChapterInputSchema.parse({
      ...rawInput,
      bookId: loaded.manifest.id
    });
    const entry = loaded.index.chapters.find(
      (candidate) => candidate.chapterCardId === input.chapterCardId
    );
    if (!entry) {
      throw new Error("当前长篇章卡不存在。");
    }
    assertMutableChapterDocument(loaded.index, entry.characterState.id);
    assertMutableChapterDocument(loaded.index, entry.handoff.id);
    const nextChapter = firstEmptyChapter(loaded.index);
    if (
      entry.bodyStatus === "empty" &&
      (!nextChapter || nextChapter.id !== input.chapterCardId)
    ) {
      throw new Error("长篇首次写作不能跨过前面的空白章节。");
    }
    const [bodyFile, characterStateFile, handoffFile] = await Promise.all([
      loadIndexedFile(loaded, entry.body.id),
      loadIndexedFile(loaded, entry.characterState.id),
      loadIndexedFile(loaded, entry.handoff.id)
    ]);
    const writes = [
      {
        file: bodyFile,
        input: input.body
      },
      {
        file: characterStateFile,
        input: input.characterState
      },
      {
        file: handoffFile,
        input: input.handoff
      }
    ];
    const timestamp = ctx.timestamp();
    for (const write of writes) {
      write.file.reference.updatedAt = timestamp;
    }
    entry.bodyStatus = input.body.content.trim() ? "written" : "empty";
    const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
      ...loaded.index,
      updatedAt: timestamp
    });
    const indexContent = serializeJson(nextIndex);
    const nextManifest = LongProjectManifestSchema.parse({
      ...loaded.manifest,
      updatedAt: timestamp,
      workspaceIndexFile: {
        ...loaded.manifest.workspaceIndexFile,
        updatedAt: timestamp
      }
    });
    await commitLongProjectTransaction({
      projectRoot: loaded.projectDirectory,
      operations: [
        ...writes.map((write) => ({
          path: write.file.reference.path,
          content: write.input.content
        })),
        { path: LONG_WORKSPACE_INDEX_PATH, content: indexContent },
        { path: MANIFEST_PATH, content: serializeJson(nextManifest) }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    });
    return {
      bookId: loaded.manifest.id,
      chapterCardId: input.chapterCardId
    };
  });
}
