import type { ChatAssistantProjectRef } from "@deepwrite/contracts";
import type { FolderCatalogStore } from "./folder-catalog-store";
import type { LongWorkspaceService } from "./long-workspace-service";

export function createBookProjectResolver(
  requireCatalog: () => Promise<FolderCatalogStore>,
  longs: LongWorkspaceService
): (book: ChatAssistantProjectRef) => Promise<string> {
  return async (book) => {
    if (book.projectType === "long")
      return (await longs.catalog.open(book.projectId)).projectDirectory;
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
