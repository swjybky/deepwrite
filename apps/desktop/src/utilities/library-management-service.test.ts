import { vi } from "vitest";
import { LibraryManagementService } from "./library-management-service";
import {
  FolderCatalogStore,
  catalogFixture,
  describe,
  expect,
  it,
  join,
  makeTemporaryRoot
} from "./folder-catalog-store.test-support";
import type { LibraryManagementScope } from "@deepwrite/contracts";
import { LongProjectStore } from "./long-project-store";
const scope: LibraryManagementScope = {
  bookId: "book-existing",
  bookType: "short"
};
async function fixture() {
  const root = await makeTemporaryRoot("deepwrite-library-management-");
  const store = new FolderCatalogStore({
    userDataPath: join(root, "data"),
    initialSnapshot: catalogFixture()
  });
  await store.indexSnapshot();
  const service = new LibraryManagementService(store, { open: vi.fn() });
  return { root, store, service };
}
describe("Core library management scope", () => {
  it("lists bound libraries without loading bodies and loads only a requested library", async () => {
    const { store, service } = await fixture();
    const read = vi.spyOn(store, "readDocument");
    const listed = await service.query({ scope });
    expect(listed.libraries.map((item) => item.libraryId)).toEqual([
      "material-existing",
      "skill-existing"
    ]);
    expect(read).not.toHaveBeenCalled();
    const { workspace } = await service.query({
      scope,
      domain: "skill",
      libraryId: "skill-existing"
    });
    expect(workspace).toMatchObject({
      domain: "skill",
      libraryId: "skill-existing",
      readOnly: false
    });
    expect(workspace?.entries[0]?.content).toBe("保持短句和悬念。");
    expect(
      read.mock.calls.every(([input]) => input.projectId === "skill-existing")
    ).toBe(true);
    expect(workspace?.entries[0]?.documentId).toBe(
      "catalog:skill-entry:skill-existing:skill-entry"
    );
  });
  it("rejects unbound, wrong-domain, deleted and read-only targets at write time", async () => {
    const { store, service } = await fixture();
    const index = await store.indexSnapshot();
    await expect(
      service.query({ scope, domain: "material", libraryId: "skill-existing" })
    ).rejects.toThrow("未绑定");
    await expect(
      service.assertWritable(scope, "skill", "unbound")
    ).rejects.toThrow("解绑");
    vi.spyOn(store, "indexSnapshot").mockResolvedValue({
      ...index,
      skills: index.skills.map((skill) => ({ ...skill, isBuiltin: true }))
    });
    await expect(
      service.assertWritable(scope, "skill", "skill-existing")
    ).rejects.toThrow("只读");
    vi.mocked(store.indexSnapshot).mockResolvedValue({ ...index, skills: [] });
    await expect(
      service.assertWritable(scope, "skill", "skill-existing")
    ).rejects.toThrow("不存在");
    vi.mocked(store.indexSnapshot).mockResolvedValue({
      ...index,
      books: index.books.map((book) => ({
        ...book,
        linkedSkillIdsByKind: { general: [], plot: [], style: [], other: [] }
      }))
    });
    await expect(
      service.assertWritable(scope, "skill", "skill-existing")
    ).rejects.toThrow("解绑");
  });
  it("rejects an unbind that happens while reading the target", async () => {
    const { store, service } = await fixture();
    const index = await store.indexSnapshot();
    const read = store.readDocument.bind(store);
    vi.spyOn(store, "readDocument").mockImplementation(async (input) => {
      const result = await read(input);
      vi.spyOn(store, "indexSnapshot").mockResolvedValue({
        ...index,
        books: []
      });
      return result;
    });
    await expect(
      service.query({ scope, domain: "skill", libraryId: "skill-existing" })
    ).rejects.toThrow("作品不存在");
  });
  it("allows whole-book long bindings regardless of writing-stage read scopes", async () => {
    const { root, store } = await fixture();
    const long = new LongProjectStore();
    const created = await long.createBook(root, {
      id: "longbook_management",
      title: "管理测试",
      genre: "悬疑"
    });
    await long.updateBindings(created.projectDirectory, {
      linkedMaterialIdsByKind: created.summary.linkedMaterialIdsByKind,
      linkedSkillIdsByKind: {
        ...created.summary.linkedSkillIdsByKind,
        general: ["skill-existing"]
      },
      linkedResourceStageScopes: {
        materials: {},
        skills: { "skill-existing": ["character_design"] }
      }
    });
    const service = new LibraryManagementService(store, {
      open: async () => long.openBook(created.projectDirectory)
    });
    const scope = { bookId: created.book.id, bookType: "long" as const };
    expect((await service.query({ scope })).libraries).toHaveLength(1);
    await expect(
      service.assertWritable(scope, "skill", "skill-existing")
    ).resolves.toBeUndefined();
  });
  it("uses the persisted script identity instead of accepting a forged workspace type", async () => {
    const { store, service } = await fixture();
    const index = await store.indexSnapshot();
    const book = index.books[0]!;
    vi.spyOn(store, "indexSnapshot").mockResolvedValue({
      ...index,
      books: [{ ...book, bookType: "script" } as typeof book]
    });
    await expect(service.query({ scope })).rejects.toThrow("作品不存在");
    expect(
      (await service.query({ scope: { ...scope, bookType: "script" } }))
        .libraries
    ).toHaveLength(2);
  });
});
