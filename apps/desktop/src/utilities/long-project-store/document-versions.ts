import {
  LONG_DOCUMENT_MAX_BYTES,
  LongWriteDocumentResultSchema,
  listLongWorkspaceFiles,
  type LongWriteDocumentResult
} from "@deepwrite/contracts";
import { DocumentVersionStore } from "../document-versions/version-store";
import { DocumentVersionError } from "../document-versions/version-errors";
import { loadIndexedFile } from "./cache";
import { writeDocumentLocked } from "./documents";
import { secureDirectory } from "./io";
import { loadProject } from "./load-project";
import type { LongProjectStoreContext } from "./store-context";

export async function withLongDocumentVersions<T>(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  bookId: string,
  fileId: string,
  operation: (
    versions: DocumentVersionStore,
    content: string,
    save: (
      content: string,
      expectedSha256: string,
      afterCommit: (before: string) => Promise<void>
    ) => Promise<LongWriteDocumentResult>
  ) => Promise<T>
): Promise<T> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    if (
      loaded.book.id !== bookId ||
      loaded.files.get(fileId)?.kind !== "markdown"
    ) {
      throw new DocumentVersionError(
        "version.unavailable",
        "文档不存在或不是作品文本。"
      );
    }
    const expectedUpdatedAt = loaded.files.get(fileId)!.reference.updatedAt;
    const file = await loadIndexedFile(loaded, fileId);
    const versions = new DocumentVersionStore(
      canonical,
      { workspace: "long", bookId, fileId },
      LONG_DOCUMENT_MAX_BYTES,
      ctx.now
    );
    return operation(
      versions,
      file.disk.content,
      async (content, expectedSha256, afterCommit) => {
        const written = await writeDocumentLocked(
          ctx,
          canonical,
          { fileId, content, expectedUpdatedAt },
          { expectedSha256, afterCommit }
        );
        const reference = listLongWorkspaceFiles(
          written.book.workspaceIndex
        ).find(({ file: candidate }) => candidate.id === fileId)?.file;
        return LongWriteDocumentResultSchema.parse({
          bookId,
          file: reference,
          summary: written.summary
        });
      }
    );
  });
}
