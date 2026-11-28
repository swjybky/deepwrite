import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUILTIN_MATERIAL_BASIC_LONG_DRAFT_ID,
  BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID,
  BUILTIN_MATERIAL_BASIC_LONG_PLOT_ID,
  BUILTIN_MATERIAL_GROUP_BASIC_LONG_ID,
  BUILTIN_SKILL_BASIC_LONG_TEAM_OPS_ID
} from "@deepwrite/contracts";
import { FolderCatalogStore } from "./folder-catalog-store";
import { LibraryManagementService } from "./library-management-service";
import { LongWorkspaceService } from "./long-workspace-service";
import { MaterialQueryService } from "./material-query-service";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-catalog-builtin-"))
  );
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("FolderCatalogStore built-in basic-long libraries", () => {
  it("excludes built-ins by default and exposes them virtually without polluting disk registry", async () => {
    const root = await temporaryRoot();
    const userDataPath = join(root, "user-data");
    await mkdir(userDataPath, { recursive: true });

    const defaultStore = new FolderCatalogStore({ userDataPath });
    const defaultSnapshot = await defaultStore.snapshot();
    expect(defaultSnapshot.materialGroups).toHaveLength(0);
    expect(defaultSnapshot.materials).toHaveLength(0);
    expect(defaultSnapshot.skills).toHaveLength(0);

    const store = new FolderCatalogStore({
      userDataPath,
      includeBuiltinLibraries: true
    });
    const snapshot = await store.snapshot();
    const index = await store.indexSnapshot();

    const group = snapshot.materialGroups.find(
      (item) => item.id === BUILTIN_MATERIAL_GROUP_BASIC_LONG_ID
    );
    expect(group).toMatchObject({
      id: BUILTIN_MATERIAL_GROUP_BASIC_LONG_ID,
      title: "基础长篇",
      isBuiltin: true,
      memberIds: [
        BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID,
        BUILTIN_MATERIAL_BASIC_LONG_DRAFT_ID,
        BUILTIN_MATERIAL_BASIC_LONG_PLOT_ID
      ]
    });

    const naming = snapshot.materials.find(
      (item) => item.id === BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID
    )!;
    const draft = snapshot.materials.find(
      (item) => item.id === BUILTIN_MATERIAL_BASIC_LONG_DRAFT_ID
    )!;
    const plot = snapshot.materials.find(
      (item) => item.id === BUILTIN_MATERIAL_BASIC_LONG_PLOT_ID
    )!;
    expect(naming).toMatchObject({
      isBuiltin: true,
      materialKind: "character"
    });
    expect(draft).toMatchObject({ isBuiltin: true, materialKind: "draft" });
    expect(plot).toMatchObject({ isBuiltin: true, materialKind: "plot" });
    expect(naming.entries).toHaveLength(3);
    expect(draft.entries).toHaveLength(7);
    expect(plot.entries).toHaveLength(6);

    const skill = snapshot.skills.find(
      (item) => item.id === BUILTIN_SKILL_BASIC_LONG_TEAM_OPS_ID
    )!;
    expect(skill).toMatchObject({ isBuiltin: true, skillKind: "general" });
    expect(skill.entries).toHaveLength(1);
    expect(skill.entries[0]!.title).toBe("基础长篇团队操作技能");

    expect(
      index.materials.filter((item) => item.isBuiltin).map((item) => item.id)
    ).toEqual([
      BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID,
      BUILTIN_MATERIAL_BASIC_LONG_DRAFT_ID,
      BUILTIN_MATERIAL_BASIC_LONG_PLOT_ID
    ]);
    expect(
      index.skills.find(
        (item) => item.id === BUILTIN_SKILL_BASIC_LONG_TEAM_OPS_ID
      )?.isBuiltin
    ).toBe(true);

    const registryRaw = await readFile(
      join(userDataPath, "catalog-registry.json"),
      "utf8"
    );
    expect(registryRaw).not.toContain(BUILTIN_MATERIAL_GROUP_BASIC_LONG_ID);
    expect(registryRaw).not.toContain(BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID);
    expect(registryRaw).not.toContain(BUILTIN_SKILL_BASIC_LONG_TEAM_OPS_ID);

    const matOverview = await store.readDocument({
      projectId: BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID,
      target: "overview"
    });
    expect(matOverview.projectId).toBe(BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID);
    expect(typeof matOverview.content).toBe("string");

    const matEntry = await store.readDocument({
      projectId: BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID,
      target: "document",
      documentId: naming.entries[0]!.id
    });
    expect(matEntry.content.length).toBeGreaterThan(0);

    const skillOverview = await store.readDocument({
      projectId: BUILTIN_SKILL_BASIC_LONG_TEAM_OPS_ID,
      target: "overview"
    });
    expect(skillOverview.projectId).toBe(BUILTIN_SKILL_BASIC_LONG_TEAM_OPS_ID);

    const skillEntry = await store.readDocument({
      projectId: BUILTIN_SKILL_BASIC_LONG_TEAM_OPS_ID,
      target: "document",
      documentId: skill.entries[0]!.id
    });
    expect(skillEntry.content.length).toBeGreaterThan(0);

    const libSource = await store.readLibraryPackageSource({
      domain: "material",
      target: { type: "library", id: BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID }
    });
    expect(libSource.groupTitle).toBeNull();
    expect(libSource.members).toHaveLength(1);

    const groupSource = await store.readLibraryPackageSource({
      domain: "material",
      target: { type: "group", id: BUILTIN_MATERIAL_GROUP_BASIC_LONG_ID }
    });
    expect(groupSource.groupTitle).toBe("基础长篇");
    expect(groupSource.members).toHaveLength(3);
  });

  it("exposes built-ins read-only to query & management services while rejecting all mutations", async () => {
    const root = await temporaryRoot();
    const userDataPath = join(root, "user-data");
    const store = new FolderCatalogStore({
      userDataPath,
      includeBuiltinLibraries: true
    });
    const long = new LongWorkspaceService({ userDataPath });
    const materialQuery = new MaterialQueryService(store, long);
    const libraryManagement = new LibraryManagementService(store, long);

    const book = await store.createShortBook(
      {
        title: "关联内置测试",
        genre: "科幻",
        linkedMaterialIdsByKind: {
          character: [BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID],
          gimmick: [],
          plot: [],
          draft: [],
          other: []
        },
        linkedSkillIdsByKind: {
          general: [BUILTIN_SKILL_BASIC_LONG_TEAM_OPS_ID],
          plot: [],
          style: [],
          other: []
        }
      },
      join(root, "books")
    );

    const queried = await materialQuery.query({
      scope: {
        bookType: "short",
        bookId: book.resource.id,
        stageId: "character",
        kinds: ["character"]
      },
      mode: "list",
      limit: 32
    });
    expect(queried.entries.length).toBeGreaterThan(0);

    const managed = await libraryManagement.query({
      scope: { bookType: "short", bookId: book.resource.id }
    });
    expect(
      managed.libraries.find(
        (item) => item.libraryId === BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID
      )?.readOnly
    ).toBe(true);
    expect(
      managed.libraries.find(
        (item) => item.libraryId === BUILTIN_SKILL_BASIC_LONG_TEAM_OPS_ID
      )?.readOnly
    ).toBe(true);
    await expect(
      libraryManagement.assertWritable(
        { bookType: "short", bookId: book.resource.id },
        "material",
        BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID
      )
    ).rejects.toThrow("只读");

    const snapshot = await store.snapshot();
    const naming = snapshot.materials.find(
      (item) => item.id === BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID
    )!;
    const namingEntryDoc = await store.readDocument({
      projectId: naming.id,
      target: "document",
      documentId: naming.entries[0]!.id
    });

    const userMat = await store.createLibrary({
      domain: "material",
      name: "用户自建素材库",
      materialKind: "character",
      parentDirectory: join(root, "materials")
    });
    const userEntry = await store.createLibraryEntry({
      domain: "material",
      libraryId: userMat.resource.id,
      stageId: "character",
      title: "用户条目",
      content: "内容"
    });

    await expect(
      store.updateLibrary({
        domain: "material",
        libraryId: BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID,
        title: "改名"
      })
    ).rejects.toThrow("只读");
    await expect(
      store.updateLibraryGroup({
        domain: "material",
        groupId: BUILTIN_MATERIAL_GROUP_BASIC_LONG_ID,
        title: "改分组名",
        memberIds: [
          BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID,
          BUILTIN_MATERIAL_BASIC_LONG_DRAFT_ID,
          BUILTIN_MATERIAL_BASIC_LONG_PLOT_ID
        ]
      })
    ).rejects.toThrow("只读");
    await expect(
      store.createLibraryGroup({
        domain: "material",
        name: "包含内置的分组",
        memberIds: [BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID],
        parentDirectory: join(root, "material-groups")
      })
    ).rejects.toThrow("内置");
    await expect(
      store.saveLibraryEntry({
        domain: "material",
        libraryId: BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID,
        entryId: naming.entries[0]!.id,
        title: naming.entries[0]!.title,
        content: "篡改内容",
        baseRevision: namingEntryDoc.revision
      })
    ).rejects.toThrow("只读");
    await expect(
      store.createLibraryEntry({
        domain: "skill",
        libraryId: BUILTIN_SKILL_BASIC_LONG_TEAM_OPS_ID,
        stageId: "draft",
        title: "新增内置技能",
        content: "内容"
      })
    ).rejects.toThrow("只读");
    await expect(
      store.importLibraryEntries({
        domain: "material",
        libraryId: BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID,
        entries: [{ title: "导入", content: "内容" }],
        baseProjectRevision: 0
      })
    ).rejects.toThrow("只读");
    await expect(
      store.moveLibraryEntry({
        domain: "material",
        sourceLibraryId: BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID,
        targetLibraryId: userMat.resource.id,
        entryId: naming.entries[0]!.id
      })
    ).rejects.toThrow("只读");
    await expect(
      store.moveLibraryEntry({
        domain: "material",
        sourceLibraryId: userMat.resource.id,
        targetLibraryId: BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID,
        entryId: userEntry.id
      })
    ).rejects.toThrow("只读");
    await expect(
      store.removeLibraryEntry({
        domain: "material",
        libraryId: BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID,
        entryId: naming.entries[0]!.id,
        baseRevision: namingEntryDoc.revision
      })
    ).rejects.toThrow("内置");
    await expect(
      store.unregisterProject({
        domain: "material",
        projectId: BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID
      })
    ).rejects.toThrow("内置");
    await expect(
      store.deleteProject({
        domain: "material-group",
        projectId: BUILTIN_MATERIAL_GROUP_BASIC_LONG_ID
      })
    ).rejects.toThrow("内置");
    await expect(
      store.writeManagedEntry({
        libraryId: BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID,
        entryId: "entry-1",
        title: "AI 写入",
        stageId: "character",
        content: "内容",
        receipt: {
          id: "rec-1",
          jobId: "job-1",
          outputVersion: 1,
          unitId: "unit-1",
          inputRevision: "rev-1",
          savedAt: "2026-11-27T00:00:00.000Z"
        }
      })
    ).rejects.toThrow("只读");
    await expect(
      store.reorderLibrary({
        domain: "material",
        groupId: BUILTIN_MATERIAL_GROUP_BASIC_LONG_ID,
        id: BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID,
        anchorId: BUILTIN_MATERIAL_BASIC_LONG_DRAFT_ID,
        position: "after",
        baseRevision: 0
      })
    ).rejects.toThrow("内置");
    await expect(
      store.previewLibraryStructure({
        domain: "material",
        requestId: "req-builtin-test",
        operations: [
          {
            action: "rename-library",
            id: BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID,
            title: "改名"
          }
        ]
      })
    ).rejects.toThrow("只读");
  });

  it("duplicates built-in group, material library, and skill library into user workspace as editable copies", async () => {
    const root = await temporaryRoot();
    const userDataPath = join(root, "user-data");
    const workspaceDir = join(root, "workspace");
    const targetParents = {
      "material-library": join(workspaceDir, "materials"),
      "material-group": join(workspaceDir, "material-groups"),
      "skill-library": join(workspaceDir, "skills"),
      "skill-group": join(workspaceDir, "skill-groups")
    } as const;

    const store = new FolderCatalogStore({
      userDataPath,
      includeBuiltinLibraries: true
    });

    const copiedGroup = await store.duplicateProject(
      {
        domain: "material-group",
        projectId: BUILTIN_MATERIAL_GROUP_BASIC_LONG_ID
      },
      targetParents
    );
    expect(copiedGroup.copiedMemberLibraryIds).toHaveLength(3);
    expect(
      (await store.projectDirectory(copiedGroup.projectId)).startsWith(
        targetParents["material-group"]
      )
    ).toBe(true);

    const copiedNaming = await store.duplicateProject(
      {
        domain: "material",
        projectId: BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID
      },
      targetParents
    );
    expect(
      (await store.projectDirectory(copiedNaming.projectId)).startsWith(
        targetParents["material-library"]
      )
    ).toBe(true);

    const copiedSkill = await store.duplicateProject(
      {
        domain: "skill",
        projectId: BUILTIN_SKILL_BASIC_LONG_TEAM_OPS_ID
      },
      targetParents
    );
    expect(
      (await store.projectDirectory(copiedSkill.projectId)).startsWith(
        targetParents["skill-library"]
      )
    ).toBe(true);

    const after = await store.snapshot();
    const userGroup = after.materialGroups.find(
      (g) => g.id === copiedGroup.projectId
    )!;
    expect(userGroup.isBuiltin).toBeUndefined();
    expect(userGroup.memberIds).toHaveLength(3);
    for (const memberId of userGroup.memberIds) {
      const lib = after.materials.find((m) => m.id === memberId)!;
      expect(lib.isBuiltin).toBeUndefined();
    }

    const userNaming = after.materials.find(
      (m) => m.id === copiedNaming.projectId
    )!;
    expect(userNaming.isBuiltin).toBeUndefined();
    expect(userNaming.entries).toHaveLength(3);

    const userSkill = after.skills.find((s) => s.id === copiedSkill.projectId)!;
    expect(userSkill.isBuiltin).toBe(false);
    expect(userSkill.entries).toHaveLength(1);

    const renamed = await store.updateLibrary({
      domain: "skill",
      libraryId: copiedSkill.projectId,
      title: "我的长篇技能定制版"
    });
    expect(renamed.title).toBe("我的长篇技能定制版");
    const addedEntry = await store.createLibraryEntry({
      domain: "material",
      libraryId: copiedNaming.projectId,
      stageId: "character",
      title: "新增定制姓名",
      content: "测试定制内容"
    });
    expect(addedEntry.title).toBe("新增定制姓名");

    // Original built-ins remain untouched
    const builtinSkillAfter = after.skills.find(
      (s) => s.id === BUILTIN_SKILL_BASIC_LONG_TEAM_OPS_ID
    )!;
    expect(builtinSkillAfter.isBuiltin).toBe(true);
    expect(builtinSkillAfter.entries).toHaveLength(1);
  });
});
