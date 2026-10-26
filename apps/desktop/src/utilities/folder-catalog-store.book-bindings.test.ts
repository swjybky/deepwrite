import type { UpdateBookInput } from "@deepwrite/contracts";
import {
  FolderCatalogConflictError,
  FolderCatalogStore,
  catalogFixture,
  describe,
  expect,
  it,
  join,
  makeTemporaryRoot,
  readFile,
  rm
} from "./folder-catalog-store.test-support";

async function fixture(bookType: "short" | "script" = "short") {
  const root = await makeTemporaryRoot("deepwrite-book-bindings-");
  const userDataPath = join(root, "user-data");
  const store = new FolderCatalogStore({ userDataPath });
  const source = catalogFixture();
  source.books[0]!.bookType = bookType;
  await store.migrateSnapshot(source);
  const registry = JSON.parse(await readFile(store.registryPath, "utf8")) as {
    projects: Array<{ id: string; projectDirectory: string }>;
  };
  const bookDirectory = registry.projects.find(
    ({ id }) => id === "book-existing"
  )!.projectDirectory;
  const materialDirectory = registry.projects.find(
    ({ id }) => id === "material-existing"
  )!.projectDirectory;
  return { store, userDataPath, root, bookDirectory, materialDirectory };
}

describe("FolderCatalogStore book binding recovery", () => {
  it.each(["short", "script"] as const)(
    "updates %s skill bindings after an associated material library was deleted",
    async (bookType) => {
      const { store, userDataPath } = await fixture(bookType);
      await store.deleteProject({
        domain: "material",
        projectId: "material-existing"
      });
      const book = (await store.snapshot()).books[0]!;
      const input = {
        bookId: book.id,
        baseProjectRevision: book.projectRevision,
        linkedSkillIdsByKind: { general: ["skill-existing"] }
      };
      const updated = await store.updateBook(input);
      expect(updated.linkedSkillIdsByKind.general).toEqual(["skill-existing"]);
      expect(updated.linkedMaterialIdsByKind).toEqual(
        book.linkedMaterialIdsByKind
      );
      expect(updated.projectRevision).toBe(book.projectRevision! + 1);
      const restarted = new FolderCatalogStore({ userDataPath });
      expect(
        (await restarted.snapshot()).books[0]!.linkedSkillIdsByKind
      ).toEqual(updated.linkedSkillIdsByKind);
      await expect(restarted.updateBook(input)).rejects.toBeInstanceOf(
        FolderCatalogConflictError
      );
    }
  );

  it.each(["unregister", "external-delete", "group-delete"] as const)(
    "updates skills after material %s without erasing unrelated links",
    async (action) => {
      const { store, materialDirectory } = await fixture();
      if (action === "unregister") {
        await store.unregisterProject({
          domain: "material",
          projectId: "material-existing"
        });
      } else if (action === "external-delete") {
        await rm(materialDirectory, { recursive: true, force: true });
      } else {
        await store.deleteProject({
          domain: "material-group",
          projectId: "material-group-existing"
        });
      }
      const book = (await store.snapshot()).books[0]!;
      const updated = await store.updateBook({
        bookId: book.id,
        baseProjectRevision: book.projectRevision,
        linkedSkillIdsByKind: { general: ["skill-existing"] }
      });
      expect(updated.linkedSkillIdsByKind.general).toEqual(["skill-existing"]);
      expect(updated.linkedMaterialIdsByKind).toEqual(
        book.linkedMaterialIdsByKind
      );
    }
  );

  it("updates material bindings and book metadata despite deleted skill bindings", async () => {
    const { store } = await fixture();
    await store.deleteProject({ domain: "skill", projectId: "skill-existing" });
    const book = (await store.snapshot()).books[0]!;
    const updated = await store.updateBook({
      bookId: book.id,
      baseProjectRevision: book.projectRevision,
      linkedMaterialIdsByKind: { character: ["material-existing"] }
    });
    expect(updated.linkedMaterialIdsByKind.character).toEqual([
      "material-existing"
    ]);
    expect(updated.linkedSkillIdsByKind).toEqual(book.linkedSkillIdsByKind);
    const renamed = await store.updateBook({
      bookId: book.id,
      baseProjectRevision: updated.projectRevision,
      title: "删除资料库后仍可重命名"
    });
    expect(renamed.title).toBe("删除资料库后仍可重命名");
    expect(renamed.linkedSkillIdsByKind).toEqual(book.linkedSkillIdsByKind);
  });

  it("repairs both domains one at a time after deleting their old libraries", async () => {
    const { store, root } = await fixture();
    await store.deleteProject({
      domain: "material",
      projectId: "material-existing"
    });
    await store.deleteProject({ domain: "skill", projectId: "skill-existing" });
    const material = await store.createLibrary({
      domain: "material",
      name: "新人物素材",
      materialKind: "character",
      parentDirectory: root
    });
    const skill = await store.createLibrary({
      domain: "skill",
      name: "新通用技能",
      skillKind: "general",
      parentDirectory: root
    });
    const book = (await store.snapshot()).books[0]!;
    const reboundMaterial = await store.updateBook({
      bookId: book.id,
      baseProjectRevision: book.projectRevision,
      linkedMaterialIdsByKind: { character: [material.resource.id] }
    });
    expect(reboundMaterial.linkedMaterialIdsByKind.character).toEqual([
      material.resource.id
    ]);
    expect(reboundMaterial.linkedSkillIdsByKind).toEqual(
      book.linkedSkillIdsByKind
    );
    const updated = await store.updateBook({
      bookId: book.id,
      baseProjectRevision: reboundMaterial.projectRevision,
      linkedSkillIdsByKind: { general: [skill.resource.id] }
    });
    expect(updated.linkedMaterialIdsByKind).toEqual(
      reboundMaterial.linkedMaterialIdsByKind
    );
    expect(updated.linkedSkillIdsByKind.general).toEqual([skill.resource.id]);
  });

  it.each([
    { linkedMaterialIdsByKind: { character: ["missing-material"] } },
    { linkedSkillIdsByKind: { general: ["missing-skill"] } },
    { linkedMaterialIdsByKind: { plot: ["material-existing"] } },
    { linkedSkillIdsByKind: { other: ["skill-existing"] } }
  ] satisfies Array<Partial<UpdateBookInput>>)(
    "rejects invalid newly submitted bindings without changing durable data: %j",
    async (patch) => {
      const { store, bookDirectory } = await fixture();
      const manifestPath = join(bookDirectory, "deepwrite.json");
      const before = await readFile(manifestPath, "utf8");
      const registryBefore = await readFile(store.registryPath, "utf8");
      const book = (await store.snapshot()).books[0]!;
      await expect(
        store.updateBook({
          ...patch,
          bookId: book.id,
          baseProjectRevision: book.projectRevision
        })
      ).rejects.toThrow(/不存在|不能/u);
      expect(await readFile(manifestPath, "utf8")).toBe(before);
      expect(await readFile(store.registryPath, "utf8")).toBe(registryBefore);
    }
  );
});
