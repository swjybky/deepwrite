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
import {
  LIBRARY_AGENT_ENTRY_MAX_CHARACTERS,
  type LibraryManagementScope
} from "@deepwrite/contracts";
import { LongProjectStore } from "./long-project-store";
const scope: LibraryManagementScope = {
  bookId: "book-existing",
  bookType: "short"
};
async function fixture(initialSnapshot = catalogFixture()) {
  const root = await makeTemporaryRoot("deepwrite-library-management-");
  const store = new FolderCatalogStore({
    userDataPath: join(root, "data"),
    initialSnapshot
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
    const { directory } = await service.query({
      scope,
      domain: "skill",
      libraryId: "skill-existing",
      request: { kind: "directory" }
    });
    expect(directory).toMatchObject({
      libraryId: "skill-existing",
      readOnly: false
    });
    expect(read).not.toHaveBeenCalled();
    const entryId = directory!.entries[0]!.entryId;
    expect(directory!.entries[0]!.documentId).toBe(
      `catalog:skill-entry:skill-existing:${entryId}`
    );
    const { documents } = await service.query({
      scope,
      domain: "skill",
      libraryId: "skill-existing",
      request: { kind: "read", entryIds: [entryId] }
    });
    expect(documents?.[0]?.content).toBe("保持短句和悬念。");
    expect(
      read.mock.calls.every(([input]) => input.projectId === "skill-existing")
    ).toBe(true);
    const { search } = await service.query({
      scope,
      domain: "skill",
      request: {
        kind: "search",
        query: "悬念",
        maxMatches: 5,
        contextChars: 10
      }
    });
    expect(search?.entries[0]).toMatchObject({
      libraryId: "skill-existing",
      entryId
    });
  });
  it("rejects unbound, wrong-domain, deleted and read-only targets at write time", async () => {
    const { store, service } = await fixture();
    const index = await store.indexSnapshot();
    await expect(
      service.query({
        scope,
        domain: "material",
        libraryId: "skill-existing",
        request: { kind: "directory" }
      })
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
  it("re-resolves the binding on every request", async () => {
    const { store, service } = await fixture();
    const index = await store.indexSnapshot();
    const request = {
      scope,
      domain: "skill" as const,
      libraryId: "skill-existing",
      request: { kind: "directory" as const }
    };
    await expect(service.query(request)).resolves.toBeDefined();
    vi.spyOn(store, "indexSnapshot").mockResolvedValue({ ...index, books: [] });
    await expect(service.query(request)).rejects.toThrow("作品不存在");
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

it("loads a domain library without a work binding and rejects wrong-domain ids", async () => {
  const { store, service } = await fixture();
  const index = await store.indexSnapshot();
  vi.spyOn(store, "indexSnapshot").mockResolvedValue({ ...index, books: [] });
  expect(
    await service.readLibraryAgentLibrary({
      domain: "material",
      libraryId: "material-existing"
    })
  ).toMatchObject({ domain: "material", libraryId: "material-existing" });
  await expect(
    service.readLibraryAgentLibrary({
      domain: "skill",
      libraryId: "material-existing"
    })
  ).rejects.toThrow("不属于本领域");
});

it("reads and searches beyond the old snapshot cap, paginates and detects unbinding during reads", async () => {
  const { store, service } = await fixture();
  const index = await store.indexSnapshot();
  const library = index.materials[0]!;
  const entry = library.entries[0]!;
  const large = {
    ...index,
    materials: [
      {
        ...library,
        entries: Array.from({ length: 600 }, (_, i) => ({
          ...entry,
          id: `entry-${i}`,
          title: `条目${i}`
        }))
      }
    ]
  };
  const snapshot = vi.spyOn(store, "indexSnapshot").mockResolvedValue(large);
  const read = vi.spyOn(store, "readDocument").mockImplementation(
    async (input) =>
      ({
        projectId: input.projectId,
        target: input.target,
        content: `命中 ${input.target === "document" ? input.documentId : "overview"}`,
        revision: "v1:0:00000000",
        projectRevision: library.projectRevision
      }) as Awaited<ReturnType<typeof store.readDocument>>
  );
  const request = { scope, domain: "material" as const, libraryId: library.id };
  const first = await service.query({
    ...request,
    request: { kind: "directory" }
  });
  expect(first.directory?.nextOffset).toBe(512);
  expect(read).not.toHaveBeenCalled();
  const next = await service.query({
    ...request,
    request: { kind: "directory", offset: first.directory!.nextOffset }
  });
  expect(next.directory?.entries.at(-1)?.entryId).toBe("entry-599");
  expect(
    (
      await service.query({
        ...request,
        request: { kind: "read", entryIds: ["entry-599"] }
      })
    ).documents?.[0]?.content
  ).toBe("命中 entry-599");
  const search = {
    kind: "search" as const,
    query: "命中",
    maxMatches: 2,
    contextChars: 10
  };
  const page1 = await service.query({ ...request, request: search });
  const page2 = await service.query({
    ...request,
    request: { ...search, offset: page1.search!.nextOffset }
  });
  expect(page1.search?.entries.map((e) => e.entryId)).toEqual([
    "entry-0",
    "entry-1"
  ]);
  expect(page2.search?.entries.map((e) => e.entryId)).toEqual([
    "entry-2",
    "entry-3"
  ]);
  read.mockImplementationOnce(async (input) => {
    snapshot.mockResolvedValue({ ...large, books: [] });
    return { projectId: input.projectId, content: "刚读取的内容" } as Awaited<
      ReturnType<typeof store.readDocument>
    >;
  });
  await expect(
    service.query({
      ...request,
      request: { kind: "read", entryIds: ["entry-599"] }
    })
  ).rejects.toThrow("作品不存在");
});

it("previews scoped recoverable deletion, restores full content, and rejects stale restore plans", async () => {
  const { store, service } = await fixture();
  const library = (await store.indexSnapshot()).materials[0]!;
  const entry = library.entries[0]!;
  const original = await store.readDocument({
    projectId: library.id,
    target: "document",
    documentId: entry.id
  });
  const { plan } = await service.query({
    scope,
    domain: "material",
    request: {
      kind: "preview-structure",
      requestId: "recoverable-delete",
      operations: [
        {
          action: "archive-entries",
          libraryId: library.id,
          entryIds: [entry.id]
        }
      ]
    }
  });
  expect(plan?.managementScope).toEqual(scope);
  expect((await store.indexSnapshot()).materials[0]!.entries).toHaveLength(
    library.entries.length
  );
  await store.applyLibraryStructure(plan!);
  await store.applyLibraryStructure(plan!); // receipt makes a repeated acceptance idempotent
  expect(
    (await store.indexSnapshot()).materials[0]!.entries.some(
      (item) => item.id === entry.id
    )
  ).toBe(false);
  const restore = await store.previewLibraryStructure({
    domain: "material",
    requestId: "restore",
    operations: [
      {
        action: "restore-entries",
        libraryId: library.id,
        recoveryId: plan!.requestId,
        entryIds: [entry.id]
      }
    ]
  });
  const stale = { ...restore, requestId: "stale-restore" };
  await store.applyLibraryStructure(restore);
  expect(
    (
      await store.readDocument({
        projectId: library.id,
        target: "document",
        documentId: entry.id
      })
    ).content
  ).toBe(original.content);
  await expect(store.applyLibraryStructure(stale)).rejects.toThrow();
});

it("copies complete entries from a read-only bound skill, preserves metadata and replays the accepted batch once", async () => {
  const data = catalogFixture();
  const source = data.skills[0]!;
  const entry = source.entries[0]!;
  source.isBuiltin = true;
  entry.body = "文".repeat(LIBRARY_AGENT_ENTRY_MAX_CHARACTERS) + "\n尾部";
  const target = {
    ...source,
    id: "skill-target",
    title: "我的技能",
    isBuiltin: false,
    entries: []
  };
  data.skills.push(target);
  data.books[0]!.linkedSkillIdsByKind.general.push(target.id);
  const { service, store } = await fixture(data);
  const originalRevision = (await store.indexSnapshot()).skills.find(
    (s) => s.id === source.id
  )!.projectRevision;
  const copy = {
    action: "copy-entries" as const,
    libraryId: source.id,
    entryIds: [entry.id],
    target: { kind: "library" as const, libraryId: target.id }
  };
  const preview = (operations: (typeof copy)[]) =>
    service.query({
      scope,
      domain: "skill",
      request: {
        kind: "preview-structure",
        requestId: "copy-skills",
        operations
      }
    });
  await expect(
    preview([{ ...copy, target: { ...copy.target, libraryId: source.id } }])
  ).rejects.toThrow("只读");
  await expect(
    preview([{ ...copy, target: { ...copy.target, libraryId: "unbound" } }])
  ).rejects.toThrow("未绑定");
  const { plan } = await preview([copy, copy]);
  expect(plan?.summary).toContain(entry.title);
  expect(
    (await store.indexSnapshot()).skills.find((s) => s.id === target.id)
      ?.entries
  ).toHaveLength(0);
  await service.assertStructureTargets(scope, "skill", plan!.operations);
  await store.applyLibraryStructure(plan!);
  await store.applyLibraryStructure(plan!);
  const index = await store.indexSnapshot();
  const originals = index.skills.find((s) => s.id === source.id)!;
  expect(originals.projectRevision).toBe(originalRevision);
  const copies = index.skills.find((s) => s.id === target.id)!.entries;
  expect(originals.entries.map((e) => e.id)).toEqual([entry.id]);
  expect(copies.map((e) => e.title)).toEqual([
    entry.title,
    entry.title + "copy1"
  ]);
  expect(new Set([entry.id, ...copies.map((e) => e.id)]).size).toBe(3);
  for (const e of copies) {
    expect(e).toMatchObject({
      stageId: entry.stageId,
      sourceSkillId: entry.sourceSkillId
    });
    expect(
      (
        await store.readDocument({
          target: "document",
          projectId: target.id,
          documentId: e.id
        })
      ).content
    ).toBe(entry.body);
  }
  vi.spyOn(store, "indexSnapshot").mockResolvedValue({
    ...index,
    skills: [originals]
  });
  await expect(
    service.assertStructureTargets(scope, "skill", plan!.operations)
  ).rejects.toThrow("未绑定");
});
