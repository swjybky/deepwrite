import { LongProjectStore } from "./long-project-store";
import { vi } from "vitest";
import {
  MaterialQueryInputSchema,
  type MaterialReadScope
} from "@deepwrite/contracts";
import { MaterialQueryService } from "./material-query-service";
import {
  FolderCatalogStore,
  catalogFixture,
  describe,
  expect,
  it,
  join,
  makeTemporaryRoot,
  readFile,
  writeFile
} from "./folder-catalog-store.test-support";

const scope: MaterialReadScope = {
  bookId: "book-existing",
  bookType: "short",
  stageId: "character_design",
  kinds: ["character"]
};
const id = "material:material-existing:material-entry";

async function fixture(count = 1) {
  const root = await makeTemporaryRoot("deepwrite-material-query-");
  const snapshot = catalogFixture();
  const first = snapshot.materials[0]!.entries[0]!;
  snapshot.materials[0]!.entries = Array.from({ length: count }, (_, i) => ({
    ...first,
    id: i ? `entry-${i}` : first.id,
    title: `素材${i}`,
    body:
      i % 2
        ? `---\nname: 角色${i}\ndescription: 用于人物设计\n---\n正文${i}`
        : `旧素材正文${i}\n\n末段检索词${i}`
  }));
  const store = new FolderCatalogStore({
    userDataPath: join(root, "data"),
    initialSnapshot: snapshot
  });
  await store.indexSnapshot();
  const read = vi.spyOn(store, "readDocument");
  const service = new MaterialQueryService(store, { open: vi.fn() });
  const query = (input: Record<string, unknown> = {}) =>
    service.query(
      MaterialQueryInputSchema.parse({ scope, mode: "list", ...input })
    );
  return { root, store, read, service, query };
}

describe("Core material catalog and on-demand reads", () => {
  it("honors persisted long-form stage scopes and removes deleted entries from a warm catalog", async () => {
    const { root, store } = await fixture();
    const longStore = new LongProjectStore();
    const created = await longStore.createBook(root, {
      id: "longbook_material_query",
      title: "长篇素材查询",
      genre: "悬疑"
    });
    await longStore.updateBindings(created.projectDirectory, {
      linkedMaterialIdsByKind: {
        ...created.summary.linkedMaterialIdsByKind,
        character: ["material-existing"]
      },
      linkedSkillIdsByKind: created.summary.linkedSkillIdsByKind,
      linkedResourceStageScopes: {
        materials: { "material-existing": ["character_design"] },
        skills: {}
      }
    });
    const service = new MaterialQueryService(store, {
      open: async () => longStore.openBook(created.projectDirectory)
    });
    const query = (stageId: string, mode = "list") =>
      service.query(
        MaterialQueryInputSchema.parse({
          scope: {
            ...scope,
            bookId: created.book.id,
            bookType: "long",
            stageId
          },
          mode,
          entry_id: id
        })
      );
    expect((await query("character_design")).total).toBe(1);
    expect((await query("plot_design", "read")).status).toBe("not_found");
    await store.removeLibraryEntry({
      domain: "material",
      libraryId: "material-existing",
      entryId: "material-entry",
      force: true
    });
    expect((await query("character_design")).total).toBe(0);
    expect((await query("character_design", "read")).status).toBe("not_found");
  });

  it("can resolve a configured name even when another material cannot be opened", async () => {
    const { query, read } = await fixture(2);
    read.mockRejectedValueOnce(new Error("fixture read unavailable"));
    const result = await query({ mode: "read", entry_name: "角色1" });
    expect(result.content).toContain("正文1");
    expect(result.notices).toHaveLength(1);
  });

  it("reports a missing bound library", async () => {
    const { query, store } = await fixture();
    const index = await store.indexSnapshot();
    vi.spyOn(store, "indexSnapshot").mockResolvedValue({
      ...index,
      materials: []
    });
    const result = await query();
    expect(result.total).toBe(0);
    expect(result.notices[0]).toContain("不存在或分类已变化");
  });

  it("indexes legacy and configured entries, then uses the warm metadata cache without opening bodies", async () => {
    const { query, read } = await fixture(3);
    const first = await query();
    expect(first.total).toBe(3);
    expect(first.entries[0]!.metadata.descriptionSource).toBe("excerpt");
    expect(first.entries[1]!.metadata.name).toBe("角色1");
    expect(JSON.stringify(first)).not.toContain("末段检索词");
    read.mockClear();
    expect(await query()).toEqual(first);
    expect(read).not.toHaveBeenCalled();
    const result = await query({ mode: "read", entry_id: id });
    expect(result.content).toContain("末段检索词0");
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({
      target: "document",
      projectId: "material-existing",
      documentId: "material-entry"
    });
  });

  it("paginates beyond the old attachment capacity and keeps full-text search on Core", async () => {
    const { query } = await fixture(70);
    const first = await query({ limit: 64 });
    expect(first.entries).toHaveLength(64);
    expect(first.total).toBe(70);
    expect(first.nextCursor).toBe(64);
    const next = await query({ cursor: first.nextCursor });
    expect(next.entries).toHaveLength(6);
    const selected = next.entries.at(-1)!;
    expect(
      (await query({ mode: "read", entry_id: selected.id })).content
    ).toContain("正文69");
    const search = await query({ mode: "search", query: "末段检索词68" });
    expect(search.entries.map((entry) => entry.entryId)).toEqual(["entry-68"]);
    expect(search.content).toBeUndefined();
    expect(search.entries[0]!.matchSnippet).toContain("末段检索词68");
  });

  it("refreshes cached metadata after external edits and reports changed versions without modifying original files", async () => {
    const { query, root, read } = await fixture();
    const listed = await query();
    const registry = JSON.parse(
      await readFile(join(root, "data", "catalog-registry.json"), "utf8")
    );
    const project = registry.projects.find(
      (entry: { id: string }) => entry.id === "material-existing"
    );
    const manifestPath = join(project.projectDirectory, "deepwrite.json");
    const before = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(before);
    const path = join(project.projectDirectory, manifest.entries[0].path);
    const updated =
      "---\nname: 新名称\ndescription: 新用途\n---\n用户在外部修改的原文";
    await writeFile(path, updated, "utf8");
    read.mockClear();
    expect((await query()).entries[0]!.metadata.name).toBe("新名称");
    expect(read).toHaveBeenCalledTimes(1);
    const result = await query({
      mode: "read",
      entry_id: id,
      expected_revision: listed.entries[0]!.revision
    });
    expect(result.revisionChanged).toBe(true);
    expect(result.content).toBe(updated);
    expect(await readFile(path, "utf8")).toBe(updated);
    expect(await readFile(manifestPath, "utf8")).toBe(before);
  });

  it("rechecks saved bindings and kinds on every read, including an unbind during IO", async () => {
    const { query, store, read } = await fixture();
    await query();
    expect(
      (
        await query({
          mode: "read",
          entry_id: id,
          scope: { ...scope, kinds: ["plot"] }
        })
      ).status
    ).toBe("not_found");
    const originalRead = store.readDocument.bind(store);
    read.mockImplementationOnce(async (input) => {
      const result = await originalRead(input);
      await store.updateBook({
        bookId: scope.bookId,
        linkedMaterialIdsByKind: { character: [] }
      });
      return result;
    });
    expect((await query({ mode: "read", entry_id: id })).status).toBe(
      "not_found"
    );
    expect((await query()).total).toBe(0);
    expect(
      (await query({ mode: "read", entry_id: id })).content
    ).toBeUndefined();
  });
});
