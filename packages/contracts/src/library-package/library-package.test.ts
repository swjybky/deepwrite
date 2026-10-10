import { describe, expect, it } from "vitest";
import type { MaterialLibrary, SkillLibrary } from "../catalog";
import {
  LIBRARY_PACKAGE_MANIFEST_FILE,
  LibraryPackageError,
  assignLibraryPackageGroup,
  buildLibraryPackageFiles,
  nextLibraryPackageTitle,
  previewLibraryPackage,
  recognizeLibraryPackage,
  resolveLibraryPackageImport,
  safePackageName,
  stripSharedNumberPrefixes,
  type LibraryPackageExportSource,
  type LibraryPackagePlan,
  type LibraryPackageSourceFile
} from "./index";

const NOW = "2026-10-09T08:00:00.000Z";
const OPTIONS = {
  locale: "zh-CN" as const,
  generator: "DeepWrite 0.0.0-test",
  exportedAt: NOW
};

function materialLibrary(
  overrides: Partial<MaterialLibrary> = {}
): MaterialLibrary {
  return {
    id: "material-1",
    title: "都市爽文人设",
    materialType: "short",
    materialKind: "character",
    parentGenre: "都市",
    subGenre: "追妻",
    overview: "霸总与千金的人设集合。",
    entries: [
      {
        id: "e1",
        stageId: "character",
        title: "霸总男主",
        body: "# 霸总\n\n- 冷面\n- 护短\n",
        createdAt: NOW,
        updatedAt: NOW
      },
      {
        id: "e2",
        stageId: "character",
        title: "落魄千金",
        body: "家道中落，\r\n仍有傲骨。",
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function plotLibrary(): MaterialLibrary {
  return materialLibrary({
    id: "material-2",
    title: "都市爽文剧情",
    materialKind: "plot",
    overview: "",
    entries: [
      ["pacing", "退婚开局"],
      ["plot_refine", "身份反转细化"],
      ["intro", "前十秒钩子"],
      ["pacing", "打脸高潮"]
    ].map(([stageId, title], index) => ({
      id: `p${index}`,
      stageId: stageId as MaterialLibrary["entries"][number]["stageId"],
      title: title!,
      body: `${title} 的正文`,
      createdAt: NOW,
      updatedAt: NOW
    }))
  });
}

function asTree(source: LibraryPackageExportSource) {
  const layout = buildLibraryPackageFiles(source, OPTIONS);
  const files: LibraryPackageSourceFile[] = layout.files.map((file) => ({
    path: file.path,
    text: file.content
  }));
  return { layout, tree: { rootName: `${layout.rootName}.zip`, files } };
}

function importAll(plan: LibraryPackagePlan, createGroup: boolean) {
  return resolveLibraryPackageImport(plan, {
    libraries: plan.libraries.map(({ key, title }) => ({
      key,
      include: true,
      title
    })),
    createGroup
  });
}

describe("library package names", () => {
  it("keeps names portable across Windows, macOS and Linux", () => {
    expect(safePackageName('a/b:c*?"<>|', 40, "x")).toBe("a b c");
    expect(safePackageName("CON", 40, "x")).toBe("CON_");
    expect(safePackageName("  ...  ", 40, "未命名")).toBe("未命名");
    expect(safePackageName("一二三四五", 3, "x")).toBe("一二三");
  });

  it("strips number prefixes only when the whole folder has them", () => {
    expect(stripSharedNumberPrefixes(["01 甲", "02 乙"])).toEqual(["甲", "乙"]);
    expect(stripSharedNumberPrefixes(["1984 年的雨", "后记"])).toEqual([
      "1984 年的雨",
      "后记"
    ]);
  });

  it("numbers duplicate titles", () => {
    expect(nextLibraryPackageTitle("人设", ["人设", "人设 (2)"])).toBe(
      "人设 (3)"
    );
    expect(nextLibraryPackageTitle("新库", ["人设"])).toBe("新库");
  });
});

describe("buildLibraryPackageFiles", () => {
  it("flattens a single-stage library and numbers entries in order", () => {
    const { layout } = asTree({
      domain: "material",
      groupTitle: null,
      members: [{ slot: null, library: materialLibrary() }]
    });
    expect(layout.rootName).toBe("都市爽文人设");
    expect(layout.files.map(({ path }) => path)).toEqual([
      "都市爽文人设/_说明.md",
      "都市爽文人设/01 霸总男主.md",
      "都市爽文人设/02 落魄千金.md",
      `都市爽文人设/${LIBRARY_PACKAGE_MANIFEST_FILE}`
    ]);
    const readme = layout.files[0]!.content;
    expect(readme).toContain("- 类型：人设素材库 · 短篇");
    expect(readme).toContain("- 题材：都市 / 追妻");
    expect(readme).toContain("[霸总男主](<01 霸总男主.md>)");
    expect(layout.files[2]!.content).toBe("家道中落，\r\n仍有傲骨。");
  });

  it("puts multi-stage entries into stage folders", () => {
    const { layout } = asTree({
      domain: "material",
      groupTitle: null,
      members: [{ slot: null, library: plotLibrary() }]
    });
    expect(layout.files.map(({ path }) => path)).toEqual([
      "都市爽文剧情/_说明.md",
      "都市爽文剧情/剧情设计/01 退婚开局.md",
      "都市爽文剧情/剧情设计/02 打脸高潮.md",
      "都市爽文剧情/导语设计/01 前十秒钩子.md",
      "都市爽文剧情/剧情细化/01 身份反转细化.md",
      `都市爽文剧情/${LIBRARY_PACKAGE_MANIFEST_FILE}`
    ]);
    expect(layout.files[0]!.content).toContain("### 导语设计");
  });
});

describe("library package round trip", () => {
  it("restores a group exactly from its exported package", () => {
    const mixed = materialLibrary({
      id: "material-3",
      title: "杂项",
      materialKind: "mixed",
      entries: []
    });
    const source: LibraryPackageExportSource = {
      domain: "material",
      groupTitle: "都市爽文素材组",
      members: [
        { slot: "character", library: materialLibrary() },
        { slot: "plot", library: plotLibrary() },
        { slot: "gimmick", library: null },
        { slot: "draft", library: mixed }
      ]
    };
    const { layout, tree } = asTree(source);
    expect(layout.skippedLibraryCount).toBe(1);
    expect(layout.files[0]!.content).toContain("梗素材库（库文件夹不可用");

    const plan = recognizeLibraryPackage(tree, "skill");
    expect(plan.recognition).toBe("package");
    expect(plan.domain).toBe("material");
    expect(plan.skippedFiles).toEqual([]);
    const imported = importAll(plan, true);
    expect(imported.group).toEqual({
      title: "都市爽文素材组",
      slots: ["character", "plot", "draft"]
    });
    const original = [materialLibrary(), plotLibrary(), mixed];
    imported.libraries.forEach((library, index) => {
      const expected = original[index]!;
      expect(library).toMatchObject({
        title: expected.title,
        kind: expected.materialKind,
        libraryType: expected.materialType,
        parentGenre: expected.parentGenre,
        subGenre: expected.subGenre,
        overview: expected.overview
      });
      expect(library.entries).toEqual(
        expected.entries.map(({ title, stageId, body }) => ({
          title,
          stageId,
          content: body
        }))
      );
    });
  });

  it("restores skill libraries", () => {
    const skill: SkillLibrary = {
      id: "skill-1",
      title: "文风技能",
      skillType: "long",
      skillKind: "style",
      overview: "",
      isBuiltin: true,
      entries: [
        {
          id: "s1",
          stageId: "draft",
          title: "白描",
          body: "---\nname: 白描\n---\n正文",
          createdAt: NOW,
          updatedAt: NOW
        }
      ],
      createdAt: NOW,
      updatedAt: NOW
    };
    const { tree } = asTree({
      domain: "skill",
      groupTitle: null,
      members: [{ slot: null, library: skill }]
    });
    const imported = importAll(
      recognizeLibraryPackage(tree, "material"),
      false
    );
    expect(imported.domain).toBe("skill");
    expect(imported.libraries[0]).toMatchObject({
      title: "文风技能",
      kind: "style",
      libraryType: "long",
      entries: [
        { title: "白描", stageId: "draft", content: skill.entries[0]!.body }
      ]
    });
  });

  it("keeps edits made in other apps", () => {
    const { tree } = asTree({
      domain: "material",
      groupTitle: null,
      members: [{ slot: null, library: plotLibrary() }]
    });
    const files = tree.files
      .filter(({ path }) => !path.endsWith("02 打脸高潮.md"))
      .map((file) =>
        file.path.endsWith("01 退婚开局.md")
          ? { ...file, text: "改过的正文" }
          : file
      );
    files.push(
      { path: "都市爽文剧情/剧情细化/新增细纲.md", text: "新增" },
      { path: "都市爽文剧情/附件.docx", skip: "unsupported" }
    );
    const plan = recognizeLibraryPackage({ ...tree, files }, "material");
    const imported = importAll(plan, false).libraries[0]!;
    expect(
      imported.entries.map(({ title, stageId }) => [title, stageId])
    ).toEqual([
      ["退婚开局", "pacing"],
      ["身份反转细化", "plot_refine"],
      ["前十秒钩子", "intro"],
      ["新增细纲", "plot_refine"]
    ]);
    expect(imported.entries[0]!.content).toBe("改过的正文");
    expect(
      previewLibraryPackage(plan, {
        sourceName: "x.zip",
        sourceKind: "zip"
      }).skipped
    ).toMatchObject({ missing: 1, unsupported: 1 });
  });

  it("rejects packages from a newer format and falls back on broken manifests", () => {
    const manifest = (text: string): LibraryPackageSourceFile[] => [
      { path: LIBRARY_PACKAGE_MANIFEST_FILE, text },
      { path: "01 甲.md", text: "甲" }
    ];
    expect(() =>
      recognizeLibraryPackage(
        {
          rootName: "包",
          files: manifest(
            JSON.stringify({
              format: "deepwrite.library-package",
              formatVersion: 99,
              domain: "material",
              libraries: []
            })
          )
        },
        "material"
      )
    ).toThrow(LibraryPackageError);
    const plan = recognizeLibraryPackage(
      { rootName: "包", files: manifest("{broken") },
      "material"
    );
    expect(plan.recognition).toBe("folder");
    expect(plan.notes).toEqual(["manifestUnreadable"]);
    expect(plan.libraries[0]!.entries[0]!.title).toBe("甲");
  });
});

describe("folder recognition", () => {
  it("reads one library per top-level folder and suggests a group", () => {
    const plan = recognizeLibraryPackage(
      {
        rootName: "我的资料",
        files: [
          { path: "我的资料/_说明.md", text: "# 我的资料" },
          { path: "我的资料/角色设定/01 林凡.md", text: "主角" },
          { path: "我的资料/角色设定/02 苏晴.txt", text: "女主" },
          { path: "我的资料/剧情大纲/细纲/第一卷.md", text: "细纲" },
          { path: "我的资料/剧情大纲/开篇/钩子.md", text: "钩子" },
          { path: "我的资料/剧情大纲/1984 年的雨.md", text: "雨" },
          { path: "我的资料/封面.png", skip: "unsupported" }
        ]
      },
      "material"
    );
    expect(plan.recognition).toBe("folder");
    expect(plan.group).toEqual({ title: "我的资料", suggested: true });
    // zh-CN natural order: 角 (jiǎo) before 剧 (jù).
    expect(plan.libraries.map(({ title, kind }) => [title, kind])).toEqual([
      ["角色设定", "character"],
      ["剧情大纲", "plot"]
    ]);
    const imported = importAll(plan, true);
    expect(imported.group?.slots).toEqual(["character", "plot"]);
    expect(
      imported.libraries[1]!.entries.map(({ title, stageId }) => [
        title,
        stageId
      ])
    ).toEqual([
      ["1984 年的雨", "pacing"],
      ["钩子", "intro"],
      ["第一卷", "plot_refine"]
    ]);
    expect(imported.libraries[0]!.entries.map(({ title }) => title)).toEqual([
      "林凡",
      "苏晴"
    ]);
    expect(plan.skippedFiles).toEqual([
      { path: "封面.png", reason: "unsupported" }
    ]);
  });

  it("treats a folder with text files at its root as one library", () => {
    const plan = recognizeLibraryPackage(
      {
        rootName: "杂记",
        files: [
          { path: "灵感.md", text: "a" },
          { path: "人设/阿明.md", text: "b" }
        ]
      },
      "material"
    );
    expect(plan.group).toBeNull();
    const library = importAll(plan, false).libraries[0]!;
    expect(library.kind).toBe("mixed");
    expect(
      library.entries.map(({ title, stageId }) => [title, stageId])
    ).toEqual([
      ["灵感", "other"],
      ["阿明", "character"]
    ]);
  });

  it("refuses to group two libraries of the same kind", () => {
    expect(assignLibraryPackageGroup("material", ["plot", "plot"])).toEqual({
      problem: "duplicateKind"
    });
    expect(assignLibraryPackageGroup("material", ["mixed", "plot"])).toEqual({
      slots: ["other", "plot"]
    });
    expect(assignLibraryPackageGroup("skill", ["general", "style"])).toEqual({
      slots: ["general", "style"]
    });
    expect(() =>
      recognizeLibraryPackage({ rootName: "空", files: [] }, "material")
    ).toThrow("没有找到可导入");
  });
});
