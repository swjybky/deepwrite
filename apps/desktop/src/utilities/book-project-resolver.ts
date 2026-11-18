import type { BookImageBookRef } from "@deepwrite/contracts";
import type { FolderCatalogStore } from "./folder-catalog-store";
import type { LongWorkspaceService } from "./long-workspace-service";
import type { MysteryWorkspaceService } from "./mystery-store";

export function createBookProjectResolver(
  requireCatalog: () => Promise<FolderCatalogStore>,
  longs: LongWorkspaceService,
  mysteries?: MysteryWorkspaceService
): (book: BookImageBookRef) => Promise<string> {
  return async (book) => {
    if (book.projectType === "long")
      return (await longs.catalog.open(book.projectId)).projectDirectory;
    if (book.projectType === "mystery") {
      if (!mysteries)
        throw new Error("当前运行上下文不支持解析剧本杀作品目录。");
      return (await mysteries.open({ bookId: book.projectId }))
        .projectDirectory;
    }
    const catalog = await requireCatalog();
    const snapshot = await catalog.indexSnapshot();
    const resource = snapshot.books.find(
      (entry) => entry.id === book.projectId
    );
    if (!resource || resource.bookType !== book.projectType)
      throw new Error("作品不存在或类型不一致。");
    return catalog.managedProjectDirectory(book.projectId);
  };
}
