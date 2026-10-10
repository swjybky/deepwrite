import { rename } from "node:fs/promises";
import { basename } from "node:path";
import {
  describe,
  expect,
  it,
  join,
  mkdir,
  readdir,
  realpath,
  store,
  temporaryParent,
  writeFile
} from "./long-project-store.test-support";

describe("LongProjectStore: folder naming", () => {
  it("names new books by title like short books and numbers repeated titles", async () => {
    const parent = await realpath(await temporaryParent());
    const projectStore = store();

    const first = await projectStore.createBook(parent, {
      title: "雪夜/长篇:一",
      genre: "悬疑"
    });
    const second = await projectStore.createBook(parent, {
      title: "雪夜/长篇:一",
      genre: "悬疑"
    });
    const copy = await projectStore.duplicateBook(
      parent,
      first.projectDirectory,
      "雪夜副本"
    );

    expect(first.projectDirectory).toBe(join(parent, "雪夜-长篇-一"));
    expect(second.projectDirectory).toBe(join(parent, "雪夜-长篇-一-2"));
    expect(basename(copy.projectDirectory)).toBe("雪夜副本");
    expect(first.book.title).toBe("雪夜/长篇:一");
    expect((await readdir(parent)).sort()).toEqual(
      ["雪夜-长篇-一", "雪夜-长篇-一-2", "雪夜副本"].sort()
    );
  });

  it("keeps books in id-named folders from older versions working", async () => {
    const parent = await realpath(await temporaryParent());
    const created = await store().createBook(parent, {
      id: "longbook_legacy-folder",
      title: "旧版长篇",
      genre: "悬疑"
    });
    const legacy = join(parent, "longbook_legacy-folder");
    await rename(created.projectDirectory, legacy);

    const projectStore = store();
    const opened = await projectStore.openBook(legacy);
    expect(opened.book.title).toBe("旧版长篇");
    await expect(
      projectStore.findBookDirectory(parent, "longbook_legacy-folder")
    ).resolves.toBe(legacy);
    await expect(
      projectStore.createBook(parent, {
        id: "longbook_legacy-folder",
        title: "另一个标题",
        genre: "悬疑"
      })
    ).rejects.toThrow("长篇项目目录已存在。");
    expect(await readdir(parent)).toEqual(["longbook_legacy-folder"]);
  });

  it("finds title-named books by id and refuses to reuse that id", async () => {
    const parent = await realpath(await temporaryParent());
    const projectStore = store();
    const created = await projectStore.createBook(parent, {
      id: "longbook_title-folder",
      title: "新版长篇",
      genre: "悬疑"
    });
    await mkdir(join(parent, "短篇作品"));
    await writeFile(join(parent, "短篇作品", "deepwrite.json"), "{", "utf8");

    await expect(
      projectStore.findBookDirectory(parent, "longbook_title-folder")
    ).resolves.toBe(created.projectDirectory);
    await expect(
      projectStore.findBookDirectory(parent, "longbook_absent")
    ).resolves.toBeUndefined();
    await expect(
      projectStore.findBookDirectory(join(parent, "missing"), "longbook_absent")
    ).resolves.toBeUndefined();
    await expect(
      projectStore.createBook(parent, {
        id: "longbook_title-folder",
        title: "改名后重建",
        genre: "悬疑"
      })
    ).rejects.toThrow("长篇项目目录已存在。");
    expect((await readdir(parent)).sort()).toEqual(
      ["新版长篇", "短篇作品"].sort()
    );
  });
});
