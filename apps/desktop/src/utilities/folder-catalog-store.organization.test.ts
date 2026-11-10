import {
  FolderCatalogStore,
  makeTemporaryRoot,
  join,
  describe,
  it,
  expect,
  readFile,
  writeFile
} from "./folder-catalog-store.test-support";
import { planLibraryStructure } from "./folder-catalog-store/structure-plan";
import { commitProjectTransaction } from "./project-transaction";

describe("library organization", () => {
  it("persists unbound entries, reuses their container, and protects that container", async () => {
    const root = await makeTemporaryRoot("deepwrite-unbound-");
    const store = new FolderCatalogStore({ userDataPath: root });
    const first = await store.createUnboundEntry({
      domain: "material",
      title: "零散人设",
      content: "正文",
      libraryType: "short",
      stageId: "character"
    });
    const second = await store.createUnboundEntry({
      domain: "material",
      title: "零散情节",
      content: "情节",
      libraryType: "short",
      stageId: "pacing"
    });
    expect(first.libraryId).toBe(second.libraryId);
    const snapshot = await new FolderCatalogStore({
      userDataPath: root
    }).snapshot();
    expect(snapshot.materials[0]).toMatchObject({
      isUnbound: true,
      materialKind: "mixed",
      entries: [{ body: "正文" }, { body: "情节" }]
    });
    await expect(
      store.updateLibrary({
        domain: "material",
        libraryId: first.libraryId,
        title: "伪装"
      })
    ).rejects.toThrow("收纳区");
    await expect(
      store.unregisterProject({
        domain: "material",
        projectId: first.libraryId
      })
    ).rejects.toThrow("收纳区");
  });

  it("keeps ordering across restart and rejects stale or cross-level reorder", async () => {
    const root = await makeTemporaryRoot("deepwrite-library-order-");
    const store = new FolderCatalogStore({ userDataPath: root });
    const a = (
      await store.createLibrary({
        domain: "skill",
        name: "甲",
        skillKind: "general"
      })
    ).resource;
    const b = (
      await store.createLibrary({
        domain: "skill",
        name: "乙",
        skillKind: "plot"
      })
    ).resource;
    await store.reorderLibrary({
      domain: "skill",
      id: b.id,
      anchorId: a.id,
      position: "before",
      baseRevision: 0
    });
    expect(
      (await new FolderCatalogStore({ userDataPath: root }).indexSnapshot())
        .libraryOrganization?.skill
    ).toEqual([b.id, a.id]);
    await expect(
      store.reorderLibrary({
        domain: "skill",
        id: a.id,
        anchorId: b.id,
        position: "before",
        baseRevision: 0
      })
    ).rejects.toThrow("版本");
    await expect(
      store.reorderLibrary({
        domain: "material",
        id: a.id,
        anchorId: b.id,
        position: "before",
        baseRevision: 1
      })
    ).rejects.toThrow("排序目标");
  });

  it("previews without writing, commits a dependent batch once, and moves entries without changing identity", async () => {
    const root = await makeTemporaryRoot("deepwrite-library-plan-");
    const store = new FolderCatalogStore({ userDataPath: root });
    const loose = await store.createUnboundEntry({
      domain: "skill",
      title: "技巧",
      content: "保留正文",
      libraryType: "short",
      stageId: "draft"
    });
    const plan = await store.previewLibraryStructure({
      domain: "skill",
      requestId: "request-one",
      operations: [
        {
          action: "create-library",
          ref: "new",
          title: "归档",
          kind: "general",
          libraryType: "short"
        },
        {
          action: "move-entries",
          libraryId: loose.libraryId,
          entryIds: [loose.entryId],
          target: { kind: "library", libraryId: "new" }
        },
        {
          action: "create-group",
          ref: "group",
          title: "写作方法",
          members: { general: "new" }
        }
      ]
    });
    expect((await store.snapshot()).skills).toHaveLength(1);
    await store.applyLibraryStructure(plan);
    await store.applyLibraryStructure(plan);
    const snapshot = await new FolderCatalogStore({
      userDataPath: root
    }).snapshot();
    expect(snapshot.skills).toHaveLength(2);
    expect(
      snapshot.skills.find((library) => library.isUnbound)?.entries
    ).toEqual([]);
    expect(
      snapshot.skills.find((library) => library.title === "归档")?.entries[0]
    ).toMatchObject({ id: loose.entryId, body: "保留正文" });
    expect(snapshot.skillGroups).toHaveLength(1);
  });

  it("rejects stale plans and validates the entire batch before any mutation", async () => {
    const root = await makeTemporaryRoot("deepwrite-library-conflict-");
    const store = new FolderCatalogStore({ userDataPath: root });
    const a = (
      await store.createLibrary({
        domain: "material",
        name: "人物",
        materialKind: "character"
      })
    ).resource;
    const plan = await store.previewLibraryStructure({
      domain: "material",
      requestId: "stale",
      operations: [{ action: "rename-library", id: a.id, title: "新名称" }]
    });
    await store.updateLibrary({
      domain: "material",
      libraryId: a.id,
      title: "外部修改",
      baseProjectRevision: 0
    });
    await expect(store.applyLibraryStructure(plan)).rejects.toThrow("已更新");
    await expect(
      store.previewLibraryStructure({
        domain: "material",
        requestId: "invalid",
        operations: [
          { action: "rename-library", id: a.id, title: "不应写入" },
          { action: "delete-library", id: "missing" }
        ]
      })
    ).rejects.toThrow("不存在");
    expect((await store.snapshot()).materials[0]?.title).toBe("外部修改");
  });

  it("resolves an old entry address after multiple moves and deletes entries without keeping recovery copies", async () => {
    const root = await makeTemporaryRoot("deepwrite-library-delete-");
    const store = new FolderCatalogStore({ userDataPath: root });
    const a = (
      await store.createLibrary({
        domain: "skill",
        name: "原库",
        skillKind: "general"
      })
    ).resource;
    const b = (
      await store.createLibrary({
        domain: "skill",
        name: "目标库",
        skillKind: "general"
      })
    ).resource;
    const entry = await store.createLibraryEntry({
      domain: "skill",
      libraryId: a.id,
      title: "方法",
      content: "不丢失的正文",
      stageId: "draft"
    });
    const move = await store.previewLibraryStructure({
      domain: "skill",
      requestId: "move",
      operations: [
        {
          action: "move-entries",
          libraryId: a.id,
          entryIds: [entry.id],
          target: { kind: "library", libraryId: b.id }
        }
      ]
    });
    await store.applyLibraryStructure(move);
    expect(
      (
        await store.readDocument({
          projectId: a.id,
          target: "document",
          documentId: entry.id
        })
      ).content
    ).toBe("不丢失的正文");
    const back = await store.previewLibraryStructure({
      domain: "skill",
      requestId: "move-back",
      operations: [
        {
          action: "move-entries",
          libraryId: b.id,
          entryIds: [entry.id],
          target: { kind: "library", libraryId: a.id }
        }
      ]
    });
    await store.applyLibraryStructure(back);
    expect(
      (
        await store.readDocument({
          projectId: b.id,
          target: "document",
          documentId: entry.id
        })
      ).content
    ).toBe("不丢失的正文");
    const registration = JSON.parse(
      await readFile(store.registryPath, "utf8")
    ).projects.find((item: { id: string }) => item.id === a.id);
    const manifestPath = join(registration.projectDirectory, "deepwrite.json");
    const before = JSON.parse(await readFile(manifestPath, "utf8"));
    const entryPath = join(
      registration.projectDirectory,
      before.entries[0].path
    );
    await store.removeLibraryEntry({
      domain: "skill",
      libraryId: a.id,
      entryId: entry.id
    });
    const snapshot = await new FolderCatalogStore({
      userDataPath: root
    }).snapshot();
    expect(
      snapshot.skills.find((library) => library.id === a.id)?.entries
    ).toEqual([]);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.entries).toEqual([]);
    await expect(readFile(entryPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(root, "library-entry-recycle"))
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      store.readDocument({
        projectId: a.id,
        target: "document",
        documentId: entry.id
      })
    ).rejects.toThrow();
  });

  it("opens old registries while dropping retired recovery metadata", async () => {
    const root = await makeTemporaryRoot("deepwrite-library-legacy-");
    const store = new FolderCatalogStore({ userDataPath: root });
    const entry = await store.createUnboundEntry({
      domain: "skill",
      title: "方法",
      content: "正文",
      libraryType: "short",
      stageId: "draft"
    });
    const registry = JSON.parse(await readFile(store.registryPath, "utf8"));
    registry.libraryOrganization.recycledEntries = [
      { id: "a".repeat(64), title: "旧条目" }
    ];
    await writeFile(store.registryPath, JSON.stringify(registry));
    const reopened = new FolderCatalogStore({ userDataPath: root });
    const snapshot = await reopened.snapshot();
    expect(snapshot.libraryOrganization).not.toHaveProperty("recycledEntries");
    expect(snapshot.skills[0]?.entries[0]).toMatchObject({
      id: entry.entryId,
      body: "正文"
    });
    await reopened.removeLibraryEntry({
      domain: "skill",
      libraryId: entry.libraryId,
      entryId: entry.entryId
    });
    expect(
      JSON.parse(await readFile(store.registryPath, "utf8")).libraryOrganization
    ).not.toHaveProperty("recycledEntries");
  });

  it("keeps members on dissolve and refuses mutations of built-in libraries", async () => {
    const root = await makeTemporaryRoot("deepwrite-library-groups-");
    const store = new FolderCatalogStore({ userDataPath: root });
    const a = (
      await store.createLibrary({
        domain: "skill",
        name: "库",
        skillKind: "general"
      })
    ).resource;
    const group = (
      await store.createLibraryGroup({
        domain: "skill",
        name: "组",
        members: { general: a.id }
      })
    ).resource;
    const plan = await store.previewLibraryStructure({
      domain: "skill",
      requestId: "dissolve",
      operations: [{ action: "dissolve-group", id: group.id }]
    });
    await store.applyLibraryStructure(plan);
    expect(
      (await store.snapshot()).skills.map((library) => library.id)
    ).toContain(a.id);
    expect((await store.snapshot()).skillGroups).toEqual([]);
    const manifestPath = join(
      await store.projectDirectory(a.id),
      "deepwrite.json"
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, isBuiltin: true })
    );
    await expect(
      store.previewLibraryStructure({
        domain: "skill",
        requestId: "readonly",
        operations: [{ action: "delete-library", id: a.id }]
      })
    ).rejects.toThrow("只读");
  });

  it("creates loose entries through a reviewed batch and safely moves an entry twice in one batch", async () => {
    const root = await makeTemporaryRoot("deepwrite-library-batch-");
    const store = new FolderCatalogStore({ userDataPath: root });
    const loose = await store.previewLibraryStructure({
      domain: "skill",
      requestId: "loose",
      operations: [
        {
          action: "create-unbound-entry",
          ref: "entry",
          title: "临时方法",
          content: "正文",
          libraryType: "short",
          stageId: "draft"
        }
      ]
    });
    expect((await store.snapshot()).skills).toHaveLength(0);
    await store.applyLibraryStructure(loose);
    const source = (await store.snapshot()).skills[0]!;
    const entry = source.entries[0]!;
    const target = (
      await store.createLibrary({
        domain: "skill",
        name: "归档",
        skillKind: "general"
      })
    ).resource;
    await store.moveLibraryEntry({
      domain: "skill",
      sourceLibraryId: source.id,
      targetLibraryId: target.id,
      entryId: entry.id
    });
    const plan = await store.previewLibraryStructure({
      domain: "skill",
      requestId: "roundtrip",
      operations: [
        {
          action: "move-entries",
          libraryId: target.id,
          entryIds: [entry.id],
          target: { kind: "library", libraryId: source.id }
        },
        {
          action: "move-entries",
          libraryId: source.id,
          entryIds: [entry.id],
          target: { kind: "library", libraryId: target.id }
        }
      ]
    });
    await store.applyLibraryStructure(plan);
    expect(
      (await store.snapshot()).skills.find((item) => item.id === target.id)
        ?.entries
    ).toEqual([expect.objectContaining({ id: entry.id, body: "正文" })]);
  });

  it("rejects a batch that would exceed the configured registry read limit before writing", async () => {
    const root = await makeTemporaryRoot("deepwrite-library-limit-");
    const initial = new FolderCatalogStore({ userDataPath: root });
    await initial.snapshot();
    const size = (await readFile(initial.registryPath)).byteLength;
    const store = new FolderCatalogStore({
      userDataPath: root,
      maxManifestBytes: size + 512
    });
    await expect(
      store.previewLibraryStructure({
        domain: "skill",
        requestId: "limit",
        operations: Array.from({ length: 12 }, (_, i) => ({
          action: "create-library" as const,
          ref: `library-${i}`,
          title: `方法库 ${i}`,
          kind: "general" as const,
          libraryType: "short" as const
        }))
      })
    ).rejects.toThrow("byte limit");
    expect((await store.snapshot()).skills).toEqual([]);
  });

  it("recovers a batch interrupted after its first project commit before exposing a snapshot", async () => {
    const root = await makeTemporaryRoot("deepwrite-library-recover-");
    const store = new FolderCatalogStore({ userDataPath: root });
    const a = (
      await store.createLibrary({
        domain: "skill",
        name: "甲",
        skillKind: "general"
      })
    ).resource;
    const b = (
      await store.createLibrary({
        domain: "skill",
        name: "乙",
        skillKind: "general"
      })
    ).resource;
    const registry = JSON.parse(await readFile(store.registryPath, "utf8"));
    const prepared = await planLibraryStructure(
      {
        domain: "skill",
        requestId: "recover",
        operations: [
          { action: "rename-library", id: a.id, title: "甲改" },
          { action: "rename-library", id: b.id, title: "乙改" }
        ]
      },
      {
        registry,
        registryPath: store.registryPath,
        defaultProjectParents: store.defaultProjectParents,
        now: new Date().toISOString()
      }
    );
    await writeFile(
      join(root, "library-structure-transaction.json"),
      JSON.stringify({ version: 1, roots: prepared.roots })
    );
    await commitProjectTransaction({
      projectRoot: prepared.roots[0]!.root,
      operations: prepared.roots[0]!.files
    });
    expect(
      (
        await new FolderCatalogStore({ userDataPath: root }).snapshot()
      ).skills.map((item) => item.title)
    ).toEqual(["甲改", "乙改"]);
  });
});
