import { BookImagesResolveInputSchema } from "@deepwrite/contracts";
import type { FolderCatalogStore } from "../folder-catalog-store";
import type { LongWorkspaceService } from "../long-workspace-service";
import type { MysteryWorkspaceService } from "../mystery-store";
import type { UtilityRuntimeOptions } from "../runtime";
import { createBookProjectResolver } from "../book-project-resolver";
import { BookImageStore } from "./store";

export function withBookImageCommands(
  requireCatalog: () => Promise<FolderCatalogStore>,
  longs: LongWorkspaceService,
  handler: NonNullable<UtilityRuntimeOptions["commandHandler"]>,
  mysteries?: MysteryWorkspaceService
): NonNullable<UtilityRuntimeOptions["commandHandler"]> {
  const store = new BookImageStore(
    createBookProjectResolver(requireCatalog, longs, mysteries)
  );
  return async (command, emitEvent, context) => {
    if (
      command.type !== "bookImages.write" &&
      command.type !== "bookImages.resolve"
    )
      return handler(command, emitEvent, context);
    try {
      let payload;
      if (command.type === "bookImages.write")
        payload = await store.write(command.payload);
      else {
        const input = BookImagesResolveInputSchema.parse(command.payload);
        payload = await store.resolve(input.book, input.path);
      }
      return { status: "accepted", requestId: command.id, payload };
    } catch (error) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "book_image.write_failed",
          message: error instanceof Error ? error.message : "图片操作失败。"
        }
      };
    }
  };
}
