import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogSnapshotSchema } from "@deepwrite/contracts";
import { CatalogStore } from "./catalog-store";

const temporaryRoots = new Set<string>();
const legacyTimestamp = "2026-07-17T01:02:03Z";

async function makeTemporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.add(root);
  return root;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function tickingClock(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 6, 18, 10, 0, tick++)).toISOString();
}

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) => rm(root, { recursive: true, force: true }))
  );
  temporaryRoots.clear();
});

describe("CatalogStore", () => {
  it("imports current and legacy library shapes once without importing books", async () => {
    const root = await makeTemporaryRoot("deepwrite-catalog-import-");
    const userDataPath = join(root, "target-user-data");
    const legacyDataRoot = join(root, "legacy", ".data");
    await writeJson(join(legacyDataRoot, "materials.json"), {
      materials: [
        {
          id: "material-current",
          title: "当前人设素材",
          material_type: "short",
          material_kind: "character",
          parent_genre: "悬疑",
          stage_items: {
            character: [
              {
                id: "material-entry-current",
                title: "守夜人",
                body: "总在雨夜出现。",
                created_at: legacyTimestamp,
                updated_at: legacyTimestamp
              }
            ]
          },
          stages: { character: "不应覆盖 stage_items 中的正文" },
          created_at: legacyTimestamp,
          updated_at: legacyTimestamp
        },
        {
          id: "material-legacy",
          title: "旧综合素材",
          material_type: "short",
          parent_genre: "现实情感",
          stages: {
            plot_refine: "# 关键反转\n\n真相在最后一幕揭晓。"
          },
          created_at: legacyTimestamp,
          updated_at: legacyTimestamp
        }
      ]
    });
    await writeJson(join(legacyDataRoot, "skills.json"), {
      skills: [
        {
          id: "official-general-skill-library",
          title: "官方内置通用技能库",
          skill_type: "short",
          skill_kind: "general",
          is_builtin: true,
          stages: {
            plot_design: [
              {
                id: "skill-entry-plot",
                title: "剧情检查",
                body: "检查因果链。",
                created_at: legacyTimestamp,
                updated_at: legacyTimestamp
              }
            ],
            intro_design: "设计开篇钩子。",
            draft: [{ id: "skill-entry-draft", title: "正文", body: "写正文。" }],
            draft_review: [{ id: "skill-entry-review", title: "审阅", body: "审阅正文。" }]
          },
          created_at: legacyTimestamp,
          updated_at: legacyTimestamp
        }
      ]
    });
    await writeJson(join(legacyDataRoot, "preferences.json"), {
      material_library_groups: [
        {
          id: "material-group-1",
          title: "素材分组",
          members: { character: "material-current", plot: "material-legacy" },
          created_at: legacyTimestamp,
          updated_at: legacyTimestamp
        }
      ],
      skill_library_groups: [
        {
          id: "skill-group-1",
          title: "技能分组",
          members: { general: "official-general-skill-library" },
          created_at: legacyTimestamp,
          updated_at: legacyTimestamp
        }
      ]
    });
    await writeJson(join(legacyDataRoot, "books.json"), {
      books: [{ id: "legacy-book", title: "绝不能导入" }]
    });

    const store = new CatalogStore({
      userDataPath,
      legacyDataRoot,
      now: tickingClock()
    });
    const imported = await store.snapshot();

    expect(imported.books).toEqual([]);
    expect(imported.materials).toHaveLength(2);
    expect(imported.skills).toHaveLength(1);
    expect(imported.materialGroups[0]?.id).toBe("material-group-1");
    expect(imported.skillGroups[0]?.id).toBe("skill-group-1");
    expect(imported.legacyImport).toMatchObject({
      sourceRoot: legacyDataRoot,
      materials: 2,
      skills: 1,
      materialGroups: 1,
      skillGroups: 1
    });
    expect(imported.materials[0]?.entries[0]).toMatchObject({
      id: "material-entry-current",
      body: "总在雨夜出现。"
    });
    expect(imported.materials[1]).toMatchObject({
      id: "material-legacy",
      materialKind: "mixed",
      parentGenre: "追妻"
    });
    expect(imported.materials[1]?.entries[0]).toMatchObject({
      stageId: "plot_refine",
      title: "关键反转"
    });
    const skill = imported.skills[0]!;
    expect(skill.id).toBe("official-general-skill-library");
    expect(skill.isBuiltin).toBe(true);
    expect(skill.entries.filter((entry) => entry.stageId === "plot_design")).toHaveLength(2);
    expect(skill.entries.filter((entry) => entry.stageId === "draft")).toHaveLength(2);
    expect(skill.entries.map((entry) => entry.id)).toContain("skill-entry-review");

    const firstCatalogText = await readFile(store.catalogPath, "utf8");
    const legacyMaterials = JSON.parse(
      await readFile(join(legacyDataRoot, "materials.json"), "utf8")
    ) as { materials: unknown[] };
    legacyMaterials.materials.push({
      id: "late-material",
      title: "不应重复导入",
      stages: { character: "late" }
    });
    await writeJson(join(legacyDataRoot, "materials.json"), legacyMaterials);

    const reloaded = await new CatalogStore({
      userDataPath,
      legacyDataRoot,
      now: tickingClock()
    }).snapshot();
    expect(reloaded.materials).toHaveLength(2);
    expect(await readFile(store.catalogPath, "utf8")).toBe(firstCatalogText);
  });

  it("merges runtime and repository catalogs without dropping source-only content", async () => {
    const root = await makeTemporaryRoot("deepwrite-catalog-multi-source-");
    const userDataPath = join(root, "target-user-data");
    const runtimeRoot = join(root, "runtime", ".data");
    const repositoryRoot = join(root, "repository", ".data");
    await writeJson(join(runtimeRoot, "materials.json"), {
      materials: [
        {
          id: "recovered-material-plot",
          title: "追妻文素材-剧情流追妻-剧情",
          material_type: "short",
          material_kind: "plot",
          stages: { pacing: "# 相同正文\n\n正文内容" }
        }
      ]
    });
    await writeJson(join(runtimeRoot, "skills.json"), {
      skills: [
        {
          id: "official-general-skill-library",
          title: "官方内置通用技能库",
          skill_type: "short",
          skill_kind: "general",
          is_builtin: true,
          stages: {
            plot_design: [
              { id: "official-shared", title: "导语", body: "共享技能正文" }
            ]
          }
        }
      ]
    });
    await writeJson(join(runtimeRoot, "preferences.json"), {});

    await writeJson(join(repositoryRoot, "materials.json"), {
      materials: [
        {
          id: "legacy-exact-copy",
          title: "追妻文素材-剧情流追妻",
          material_type: "short",
          stages: { pacing: "# 相同正文\n\n正文内容" }
        },
        {
          id: "legacy-format-variant",
          title: "追妻文素材-剧情流追妻（旧版）",
          material_type: "short",
          stages: { pacing: "# 相同正文\n\n# 相同正文\n\n正文内容" }
        },
        {
          id: "legacy-emotion-material",
          title: "追妻文素材-情绪流素材",
          material_type: "short",
          stages: { gimmick: "只存在于仓库源的素材" }
        }
      ]
    });
    await writeJson(join(repositoryRoot, "skills.json"), {
      skills: [
        {
          id: "official-general-skill-library",
          title: "官方内置通用技能库",
          skill_type: "short",
          skill_kind: "general",
          is_builtin: true,
          stages: {
            draft: [{ id: "official-source-only", title: "正文", body: "源端补充" }]
          }
        },
        {
          id: "legacy-emotion-skill",
          title: "情绪文追妻",
          skill_type: "short",
          stages: {
            plot_design: [
              { id: "legacy-shared", title: "导语", body: "共享技能正文" }
            ],
            outline: [
              { id: "legacy-unique", title: "大纲", body: "只存在于旧技能库" }
            ]
          }
        }
      ]
    });
    await writeJson(join(repositoryRoot, "preferences.json"), {
      material_library_groups: [
        {
          id: "repository-group",
          title: "仓库素材分组",
          members: {
            plot: "legacy-exact-copy",
            gimmick: "legacy-emotion-material"
          }
        }
      ]
    });
    await writeJson(join(repositoryRoot, "books.json"), {
      books: [{ id: "repository-book", title: "仍然不能导入" }]
    });

    const imported = await new CatalogStore({
      userDataPath,
      legacyDataRoots: [runtimeRoot, repositoryRoot],
      now: tickingClock()
    }).snapshot();

    expect(imported.books).toEqual([]);
    expect(imported.materials.map(({ id }) => id)).toEqual([
      "recovered-material-plot",
      "legacy-format-variant",
      "legacy-emotion-material"
    ]);
    expect(imported.materialGroups[0]?.members).toEqual({
      plot: "recovered-material-plot",
      gimmick: "legacy-emotion-material"
    });
    expect(imported.skills.map(({ id }) => id)).toEqual([
      "official-general-skill-library",
      "legacy-emotion-skill"
    ]);
    expect(imported.skills[0]?.entries.map(({ id }) => id)).toEqual([
      "official-shared",
      "official-source-only"
    ]);
    expect(imported.skills[1]?.entries).toHaveLength(2);
    expect(imported.legacyImport).toMatchObject({
      sourceRoot: runtimeRoot,
      sourceRoots: [runtimeRoot, repositoryRoot],
      materials: 3,
      skills: 2,
      materialGroups: 1,
      skillGroups: 0
    });
  });

  it("supplements only missing roots while preserving existing books and documents", async () => {
    const root = await makeTemporaryRoot("deepwrite-catalog-supplement-");
    const userDataPath = join(root, "target-user-data");
    const firstRoot = join(root, "first", ".data");
    const secondRoot = join(root, "second", ".data");
    const existingMaterial = {
      id: "material-existing",
      title: "现有素材",
      material_type: "short",
      material_kind: "character",
      stage_items: {
        character: [
          { id: "entry-existing", title: "现有条目", body: "现有正文" }
        ]
      }
    };
    await writeJson(join(firstRoot, "materials.json"), {
      materials: [existingMaterial]
    });
    await writeJson(join(firstRoot, "skills.json"), { skills: [] });
    await writeJson(join(firstRoot, "preferences.json"), {});
    const firstStore = new CatalogStore({
      userDataPath,
      legacyDataRoot: firstRoot,
      now: tickingClock()
    });
    const book = await firstStore.createShortBook({
      title: "必须保留的短篇",
      genre: "追妻",
      linkedMaterialIdsByKind: { character: ["material-existing"] }
    });
    await firstStore.saveDocument({
      bookId: book.id,
      documentId: "draft",
      content: "必须保留的书稿"
    });

    const legacyCatalog = JSON.parse(
      await readFile(firstStore.catalogPath, "utf8")
    ) as {
      legacyImport?: { sourceRoots?: string[] };
    };
    if (legacyCatalog.legacyImport) {
      delete legacyCatalog.legacyImport.sourceRoots;
    }
    await writeJson(firstStore.catalogPath, legacyCatalog);
    await writeJson(join(firstRoot, "materials.json"), {
      materials: [
        existingMaterial,
        {
          id: "late-first-root",
          title: "已覆盖来源后来新增，不应补拉",
          material_type: "short",
          material_kind: "other",
          stages: { other: "晚到内容" }
        }
      ]
    });
    await writeJson(join(secondRoot, "materials.json"), {
      materials: [
        {
          ...existingMaterial,
          stage_items: {
            character: [
              { id: "entry-existing", title: "冲突条目", body: "不能覆盖现有正文" },
              { id: "entry-source-only", title: "补充条目", body: "缺失来源补充" }
            ]
          }
        },
        {
          id: "material-second-root",
          title: "第二来源素材",
          material_type: "short",
          material_kind: "plot",
          stages: { pacing: "第二来源正文" }
        }
      ]
    });
    await writeJson(join(secondRoot, "skills.json"), {
      skills: [
        {
          id: "skill-second-root",
          title: "第二来源技能",
          skill_type: "short",
          skill_kind: "general",
          stages: { outline: "整理大纲" }
        }
      ]
    });
    await writeJson(join(secondRoot, "preferences.json"), {});

    const supplementedStore = new CatalogStore({
      userDataPath,
      legacyDataRoots: [firstRoot, secondRoot],
      now: tickingClock()
    });
    const supplemented = await supplementedStore.snapshot();
    expect(supplemented.materials.map(({ id }) => id)).toEqual([
      "material-existing",
      "material-second-root"
    ]);
    expect(supplemented.materials[0]?.entries).toMatchObject([
      { id: "entry-existing", body: "现有正文" },
      { id: "entry-source-only", body: "缺失来源补充" }
    ]);
    expect(supplemented.skills.map(({ id }) => id)).toEqual([
      "skill-second-root"
    ]);
    expect(supplemented.books).toHaveLength(1);
    expect(
      supplemented.books[0]?.documents.find(({ id }) => id === "draft")?.content
    ).toBe("必须保留的书稿");
    expect(supplemented.legacyImport).toMatchObject({
      sourceRoot: firstRoot,
      sourceRoots: [firstRoot, secondRoot],
      materials: 2,
      skills: 1
    });

    const supplementedText = await readFile(supplementedStore.catalogPath, "utf8");
    const secondMaterials = JSON.parse(
      await readFile(join(secondRoot, "materials.json"), "utf8")
    ) as { materials: unknown[] };
    secondMaterials.materials.push({
      id: "late-second-root",
      title: "同样不应重复补拉",
      material_type: "short",
      material_kind: "other",
      stages: { other: "更晚内容" }
    });
    await writeJson(join(secondRoot, "materials.json"), secondMaterials);
    const stable = await new CatalogStore({
      userDataPath,
      legacyDataRoots: [firstRoot, secondRoot],
      now: tickingClock()
    }).snapshot();
    expect(stable.materials).toHaveLength(2);
    expect(stable.books[0]?.id).toBe(book.id);
    expect(await readFile(supplementedStore.catalogPath, "utf8")).toBe(
      supplementedText
    );
  });

  it("persists book bindings and documents through atomic catalog updates", async () => {
    const root = await makeTemporaryRoot("deepwrite-catalog-mutations-");
    const userDataPath = join(root, "target-user-data");
    const legacyDataRoot = join(root, "legacy", ".data");
    await writeJson(join(legacyDataRoot, "materials.json"), {
      materials: [
        {
          id: "material-character",
          title: "人物库",
          material_type: "short",
          material_kind: "character",
          stages: { character: "人物" }
        },
        {
          id: "material-long",
          title: "长篇剧情库",
          material_type: "long",
          material_kind: "plot",
          stages: { pacing: "剧情" }
        }
      ]
    });
    await writeJson(join(legacyDataRoot, "skills.json"), {
      skills: [
        {
          id: "skill-general",
          title: "通用技能",
          skill_type: "short",
          skill_kind: "general",
          stages: { outline: "整理大纲" }
        }
      ]
    });
    await writeJson(join(legacyDataRoot, "preferences.json"), {});
    const store = new CatalogStore({
      userDataPath,
      legacyDataRoot,
      now: tickingClock()
    });

    const book = await store.createShortBook({
      title: "第一本短篇",
      genre: "世情",
      linkedMaterialIdsByKind: { character: ["material-character"] },
      linkedSkillIdsByKind: { general: ["skill-general"] }
    });
    expect(book.documents).toHaveLength(6);
    expect(book.linkedMaterialIdsByKind.character).toEqual(["material-character"]);

    const document = await store.saveDocument({
      bookId: book.id,
      documentId: "draft",
      content: "第一章正文"
    });
    expect(document).toMatchObject({ id: "draft", content: "第一章正文" });

    const updated = await store.updateBook({
      bookId: book.id,
      title: "改名后的短篇",
      status: "completed",
      linkedMaterialIdsByKind: {},
      linkedSkillIdsByKind: {}
    });
    expect(updated).toMatchObject({
      title: "改名后的短篇",
      status: "completed"
    });
    expect(updated.linkedMaterialIdsByKind.character).toEqual([]);

    const persisted = await new CatalogStore({
      userDataPath,
      legacyDataRoot,
      now: tickingClock()
    }).snapshot();
    expect(persisted.books[0]?.documents.find(({ id }) => id === "draft")?.content).toBe(
      "第一章正文"
    );
    expect(() => CatalogSnapshotSchema.parse(persisted)).not.toThrow();

    expect(await store.deleteBook({ bookId: book.id })).toEqual({
      bookId: book.id,
      deleted: true
    });
    expect(await store.deleteBook({ bookId: book.id })).toEqual({
      bookId: book.id,
      deleted: false
    });
    expect((await store.snapshot()).books).toEqual([]);
  });

  it("rejects cross-kind and cross-type bindings without changing the catalog", async () => {
    const root = await makeTemporaryRoot("deepwrite-catalog-validation-");
    const userDataPath = join(root, "target-user-data");
    const legacyDataRoot = join(root, "legacy", ".data");
    await writeJson(join(legacyDataRoot, "materials.json"), {
      materials: [
        {
          id: "material-character",
          title: "人物库",
          material_type: "short",
          material_kind: "character",
          stages: { character: "人物" }
        },
        {
          id: "material-long-plot",
          title: "长篇剧情库",
          material_type: "long",
          material_kind: "plot",
          stages: { pacing: "剧情" }
        }
      ]
    });
    await writeJson(join(legacyDataRoot, "skills.json"), { skills: [] });
    await writeJson(join(legacyDataRoot, "preferences.json"), {});
    const store = new CatalogStore({
      userDataPath,
      legacyDataRoot,
      now: tickingClock()
    });
    const before = await store.snapshot();

    await expect(
      store.createShortBook({
        title: "错误分类",
        genre: "其他",
        linkedMaterialIdsByKind: { plot: ["material-character"] }
      })
    ).rejects.toThrow(/不能关联到 plot/u);
    await expect(
      store.createShortBook({
        title: "错误类型",
        genre: "其他",
        linkedMaterialIdsByKind: { plot: ["material-long-plot"] }
      })
    ).rejects.toThrow(/不能关联long素材库/u);

    const after = await store.snapshot();
    expect(after.revision).toBe(before.revision);
    expect(after.books).toEqual([]);
  });

});
