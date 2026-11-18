import {
  asCreativeBook,
  describe,
  expect,
  it,
  FolderCatalogStore,
  makeTemporaryRoot,
  join,
  readFile
} from "./folder-catalog-store.test-support";
import { readdir } from "node:fs/promises";
describe("template book creation", () => {
  it.each(["short", "script"] as const)(
    "atomically initializes %s stages, list structure and library bindings",
    async (workspaceType) => {
      const root = await makeTemporaryRoot("deepwrite-book-template-");
      const userDataPath = join(root, "user-data");
      const parent = join(root, "books");
      const store = new FolderCatalogStore({ userDataPath });
      const skill = await store.createLibrary({
        domain: "skill",
        name: "模板技能",
        skillKind: "style",
        parentDirectory: join(root, "skills")
      });
      const material = await store.createLibrary({
        domain: "material",
        name: "模板素材",
        materialKind: "character",
        parentDirectory: join(root, "materials")
      });
      const input = {
        title: "模板作品",
        genre: "其他" as const,
        characterFormat: "list" as const,
        defaultPlotStageIds: ["outline", "plot_design"],
        linkedSkillIdsByKind: { style: [skill.resource.id] },
        linkedMaterialIdsByKind: { character: [material.resource.id] }
      };
      const opened = await (workspaceType === "short"
        ? store.createShortBook(input, parent)
        : store.createScriptBook(input, parent));
      const restarted = new FolderCatalogStore({ userDataPath });
      const snapshot = await restarted.snapshot();
      const book = asCreativeBook(
        snapshot.books.find((item) => item.id === opened.resource.id)
      );
      expect(book.bookType).toBe(workspaceType);
      expect(book.characterStructure).toEqual({ format: "list", items: [] });
      expect(
        book.documents.find((item) => item.id === "character_design")
      ).toMatchObject({ title: "概览", content: "" });
      expect(book.documents.every((item) => item.content === "")).toBe(true);
      expect(
        book.plotStages
          .filter((stage) => stage.enabled)
          .map((stage) => stage.id)
      ).toEqual(["plot_design", "outline"]);
      expect(book.linkedSkillIdsByKind.style).toEqual([skill.resource.id]);
      expect(book.linkedMaterialIdsByKind.character).toEqual([
        material.resource.id
      ]);
      const folders = await readdir(parent);
      const manifest = JSON.parse(
        await readFile(join(parent, folders[0]!, "deepwrite.json"), "utf8")
      );
      expect(manifest.characterStructure).toEqual({
        format: "list",
        items: []
      });
    }
  );
  it.each(["short", "script"] as const)(
    "preserves empty text defaults for ordinary %s creation",
    async (workspaceType) => {
      const root = await makeTemporaryRoot("deepwrite-book-defaults-");
      const store = new FolderCatalogStore({
        userDataPath: join(root, "user-data")
      });
      const input = { title: "普通作品", genre: "其他" as const };
      const opened = await (workspaceType === "short"
        ? store.createShortBook(input)
        : store.createScriptBook(input));
      expect(opened.resource.characterStructure).toEqual({ format: "text" });
      expect(
        opened.resource.documents.every((item) => item.content === "")
      ).toBe(true);
    }
  );
  it("rejects missing stages and libraries before registering or writing a project", async () => {
    const root = await makeTemporaryRoot("deepwrite-template-missing-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const before = await store.snapshot();
    await expect(
      store.createScriptBook({
        title: "无效阶段",
        genre: "其他",
        defaultPlotStageIds: ["removed_stage"]
      })
    ).rejects.toThrow("剧情阶段已失效");
    await expect(
      store.createShortBook({
        title: "无效素材",
        genre: "其他",
        linkedMaterialIdsByKind: { character: ["removed_material"] }
      })
    ).rejects.toThrow("不存在的素材库");
    await expect(
      store.createScriptBook({
        title: "无效技能",
        genre: "其他",
        linkedSkillIdsByKind: { style: ["removed_skill"] }
      })
    ).rejects.toThrow("不存在的技能库");
    expect((await store.snapshot()).books).toEqual(before.books);
  });
});
