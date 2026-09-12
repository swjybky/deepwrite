import {
  longWorldbuildingContentPath,
  longWorldbuildingFileId
} from "@deepwrite/contracts";
import {
  FIXED_NOW,
  createEmptyLongMarkdownFileReference,
  createFixture,
  describe,
  expect,
  it,
  join,
  lstat,
  readFile
} from "./long-project-store.test-support";

describe("LongProjectStore: worldbuilding text-to-list conversion", () => {
  it.each(["", "# 连续性账本\n\n- 第一天：主角抵达港口。\n"])(
    "preserves text in a Windows-compatible list file and reopens it (%j)",
    async (content) => {
      const { projectStore, created } = await createFixture("ledger-to-list");
      const projectDirectory = created.projectDirectory;
      const categoryId = "world_continuity_ledger";
      const sourceFile = createEmptyLongMarkdownFileReference(
        longWorldbuildingFileId(categoryId),
        longWorldbuildingContentPath(categoryId),
        FIXED_NOW
      );
      await projectStore.applyWorkspaceOperations(projectDirectory, {
        batch: {
          updatedAt: FIXED_NOW,
          operations: [
            {
              type: "worldbuilding.create",
              category: {
                id: categoryId,
                title: "连续性账本",
                order: 1,
                format: "text",
                contentAuthority: "markdown",
                file: sourceFile
              }
            }
          ],
          documentWrites: []
        }
      });
      await projectStore.writeDocument(projectDirectory, {
        fileId: sourceFile.id,
        content
      });

      const batch = {
        updatedAt: FIXED_NOW,
        operations: [
          {
            type: "worldbuilding.update" as const,
            id: categoryId,
            patch: { format: "list" as const }
          }
        ],
        documentWrites: []
      };
      const preview = await projectStore.previewWorkspaceOperations(
        projectDirectory,
        batch
      );
      for (const intent of preview.fileIntents) {
        expect(intent.file.path).not.toMatch(/[<>:"\\|?*]/u);
      }
      expect(preview.documentWrites).toEqual([
        expect.objectContaining({ content, mode: "create" })
      ]);

      await projectStore.applyWorkspaceOperations(projectDirectory, {
        batch: { ...batch, expectedImpact: preview.confirmation }
      });
      const reopened = await projectStore.openBook(projectDirectory);
      const category = reopened.book.workspaceIndex.worldbuilding.find(
        ({ id }) => id === categoryId
      );
      if (category?.format !== "list")
        throw new Error("Expected list category.");
      expect(category.title).toBe("连续性账本");
      expect(category.items).toHaveLength(1);
      const item = category.items[0]!;
      expect(item.title).toBe("原文本内容");
      expect(item.file.id).toBe(preview.documentWrites[0]!.fileId);
      await expect(
        readFile(join(projectDirectory, item.file.path), "utf8")
      ).resolves.toBe(content);
      await expect(
        readFile(join(projectDirectory, category.overview!.path), "utf8")
      ).resolves.toBe("");
      await expect(
        lstat(join(projectDirectory, sourceFile.path))
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        lstat(join(projectDirectory, ".deepwrite", "transaction.json"))
      ).rejects.toMatchObject({ code: "ENOENT" });

      const editedContent = `${content}\n- 第二天：主角离开港口。\n`;
      await projectStore.writeDocument(projectDirectory, {
        fileId: item.file.id,
        content: editedContent
      });
      await projectStore.openBook(projectDirectory);
      await expect(
        projectStore.readDocument(projectDirectory, { fileId: item.file.id })
      ).resolves.toMatchObject({ content: editedContent });
    }
  );
});
