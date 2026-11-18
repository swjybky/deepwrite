import { vi } from "vitest";
import {
  FolderCatalogConflictError,
  FolderCatalogStore,
  access,
  describe,
  expect,
  it,
  join,
  makeTemporaryRoot,
  readFile,
  tickingClock,
  writeFile
} from "./folder-catalog-store.test-support";

async function fixture(domain: "material" | "skill") {
  const root = await makeTemporaryRoot("deepwrite-group-deletion-");
  const userDataPath = join(root, "user-data");
  const store = new FolderCatalogStore({ userDataPath, now: tickingClock() });
  const parentDirectory = join(root, "libraries");
  const first = await store.createLibrary(
    domain === "material"
      ? { domain, name: "人物素材", materialKind: "character", parentDirectory }
      : { domain, name: "通用技能", skillKind: "general", parentDirectory }
  );
  const second = await store.createLibrary(
    domain === "material"
      ? { domain, name: "剧情素材", materialKind: "plot", parentDirectory }
      : { domain, name: "剧情技能", skillKind: "plot", parentDirectory }
  );
  const unrelated = await store.createLibrary(
    domain === "material"
      ? { domain, name: "保留素材", materialKind: "other", parentDirectory }
      : { domain, name: "保留技能", skillKind: "other", parentDirectory }
  );
  await store.createLibraryEntry(
    domain === "material"
      ? {
          domain,
          libraryId: first.resource.id,
          title: "人物条目",
          content: "正文素材",
          stageId: "character"
        }
      : {
          domain,
          libraryId: first.resource.id,
          title: "写作方法",
          content: "技能正文",
          stageId: "draft"
        }
  );
  const group = await store.createLibraryGroup(
    domain === "material"
      ? {
          domain,
          name: "待删除分组",
          memberIds: [first.resource.id, second.resource.id],
          parentDirectory: join(root, "groups")
        }
      : {
          domain,
          name: "待删除分组",
          memberIds: [first.resource.id, second.resource.id],
          parentDirectory: join(root, "groups")
        }
  );
  return { root, userDataPath, store, first, second, unrelated, group };
}

describe("FolderCatalogStore group deletion", () => {
  it.each(["material", "skill"] as const)(
    "deletes a %s group and every registered member in one registry commit",
    async (domain) => {
      const { store, userDataPath, group, first, second, unrelated } =
        await fixture(domain);
      const before = await store.snapshot();
      const result = await store.deleteProject({
        domain: `${domain}-group`,
        projectId: group.resource.id,
        baseProjectRevision: 0
      });
      expect(result).toEqual({
        domain: `${domain}-group`,
        projectId: group.resource.id,
        deleted: true,
        deletedMemberLibraryIds: [first.resource.id, second.resource.id]
      });
      for (const project of [group, first, second]) {
        await expect(access(project.projectDirectory)).rejects.toMatchObject({
          code: "ENOENT"
        });
      }
      await expect(access(unrelated.projectDirectory)).resolves.toBeUndefined();
      const restarted = await new FolderCatalogStore({
        userDataPath
      }).snapshot();
      expect(restarted.revision).toBe(before.revision + 1);
      expect(
        domain === "material" ? restarted.materialGroups : restarted.skillGroups
      ).toEqual([]);
      expect(
        (domain === "material" ? restarted.materials : restarted.skills).map(
          ({ id }) => id
        )
      ).toEqual([unrelated.resource.id]);
      await expect(
        store.deleteProject({
          domain: `${domain}-group`,
          projectId: group.resource.id
        })
      ).resolves.toMatchObject({ deleted: false });
    }
  );

  it("restores all staged folders and keeps the registry intact if its commit fails", async () => {
    const { store, group, first, second, unrelated } =
      await fixture("material");
    const registryBefore = await readFile(store.registryPath, "utf8");
    const writer = store as unknown as {
      writeRegistry(registry: unknown): Promise<void>;
    };
    const failure = vi
      .spyOn(writer, "writeRegistry")
      .mockRejectedValueOnce(new Error("模拟注册表写入失败"));
    try {
      await expect(
        store.deleteProject({
          domain: "material-group",
          projectId: group.resource.id
        })
      ).rejects.toThrow("模拟注册表写入失败");
    } finally {
      failure.mockRestore();
    }
    for (const project of [group, first, second, unrelated]) {
      await expect(
        access(join(project.projectDirectory, "deepwrite.json"))
      ).resolves.toBeUndefined();
    }
    expect(await readFile(store.registryPath, "utf8")).toBe(registryBefore);
    expect((await store.snapshot()).materialGroups[0]?.id).toBe(
      group.resource.id
    );
  });

  it("rejects a changed group before moving or deleting any member", async () => {
    const { store, group, first, second } = await fixture("skill");
    await store.updateLibraryGroup({
      domain: "skill",
      groupId: group.resource.id,
      title: "已修改分组",
      memberIds: [first.resource.id, second.resource.id],
      baseProjectRevision: 0
    });
    await expect(
      store.deleteProject({
        domain: "skill-group",
        projectId: group.resource.id,
        baseProjectRevision: 0
      })
    ).rejects.toBeInstanceOf(FolderCatalogConflictError);
    for (const project of [group, first, second]) {
      await expect(access(project.projectDirectory)).resolves.toBeUndefined();
    }
  });

  it("validates every member before starting the deletion", async () => {
    const { store, group, first, second } = await fixture("material");
    await writeFile(
      join(second.projectDirectory, "deepwrite.json"),
      "invalid manifest",
      "utf8"
    );
    const registryBefore = await readFile(store.registryPath, "utf8");
    await expect(
      store.deleteProject({
        domain: "material-group",
        projectId: group.resource.id
      })
    ).rejects.toThrow();
    for (const project of [group, first, second]) {
      await expect(access(project.projectDirectory)).resolves.toBeUndefined();
    }
    expect(await readFile(store.registryPath, "utf8")).toBe(registryBefore);
  });

  it("deletes nested member folders together with their group", async () => {
    const root = await makeTemporaryRoot("deepwrite-nested-group-deletion-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const group = await store.createLibraryGroup({
      domain: "material",
      name: "嵌套分组",
      memberIds: [],
      parentDirectory: root
    });
    const member = await store.createLibrary({
      domain: "material",
      name: "嵌套成员",
      materialKind: "other",
      parentDirectory: group.projectDirectory
    });
    await store.updateLibraryGroup({
      domain: "material",
      groupId: group.resource.id,
      memberIds: [member.resource.id],
      baseProjectRevision: 0
    });
    await expect(
      store.deleteProject({
        domain: "material-group",
        projectId: group.resource.id,
        baseProjectRevision: 1
      })
    ).resolves.toMatchObject({
      deleted: true,
      deletedMemberLibraryIds: [member.resource.id]
    });
    await expect(access(group.projectDirectory)).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect((await store.snapshot()).materials).toEqual([]);
  });

  it("preserves unrelated projects inside a group folder", async () => {
    const { store, group, first } = await fixture("skill");
    const unrelated = await store.createLibrary({
      domain: "material",
      name: "独立项目",
      materialKind: "other",
      parentDirectory: group.projectDirectory
    });
    await expect(
      store.deleteProject({
        domain: "skill-group",
        projectId: group.resource.id
      })
    ).rejects.toThrow("不属于本次删除范围");
    for (const project of [group, first, unrelated]) {
      await expect(access(project.projectDirectory)).resolves.toBeUndefined();
    }
  });

  it("deletes an empty group", async () => {
    const root = await makeTemporaryRoot("deepwrite-empty-group-deletion-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const group = await store.createLibraryGroup({
      domain: "skill",
      name: "空分组",
      memberIds: [],
      parentDirectory: root
    });
    await expect(
      store.deleteProject({
        domain: "skill-group",
        projectId: group.resource.id
      })
    ).resolves.toMatchObject({ deleted: true, deletedMemberLibraryIds: [] });
    await expect(access(group.projectDirectory)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});
