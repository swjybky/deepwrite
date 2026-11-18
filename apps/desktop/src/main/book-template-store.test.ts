import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ShortBookTemplateDraftSchema } from "@deepwrite/contracts";
import { BookTemplateStore } from "./book-template-store";
const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-templates-"));
  roots.push(root);
  return { root, store: new BookTemplateStore(root) };
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
const configuration = ShortBookTemplateDraftSchema.parse({
  name: "默认模板",
  workspaceType: "short",
  genre: "其他",
  characterFormat: "list",
  defaultPlotStageIds: ["plot_design"],
  linkedMaterialIdsByKind: {
    character: [],
    gimmick: [],
    plot: [],
    draft: [],
    other: []
  },
  linkedSkillIdsByKind: { general: [], plot: [], style: [], other: [] }
});
describe("BookTemplateStore", () => {
  it("persists independent short/script templates, edits, and deletions across restarts", async () => {
    const { root, store } = await setup();
    expect(await store.list()).toEqual([]);
    const [short, script] = await Promise.all([
      store.save({ configuration }),
      store.save({
        configuration: { ...configuration, workspaceType: "script" }
      })
    ]);
    expect(short.id).not.toBe(script.id);
    await store.save({
      id: short.id,
      configuration: { ...configuration, name: "新名字" }
    });
    expect(
      (await new BookTemplateStore(root).list()).map(
        (item) => item.configuration.name
      )
    ).toEqual(["新名字", "默认模板"]);
    await store.delete(short.id);
    expect(await new BookTemplateStore(root).list()).toEqual([script]);
    await expect(store.save({ id: short.id, configuration })).rejects.toThrow(
      "已删除"
    );
    expect(await store.list()).toEqual([script]);
  });
  it("does not overwrite corrupt saved data or accept invalid configuration", async () => {
    const { root, store } = await setup();
    await store.save({ configuration });
    const path = join(root, "config", "book-templates.json");
    await writeFile(path, "corrupt", "utf8");
    await expect(store.save({ configuration })).rejects.toThrow(
      "读取新建模板失败"
    );
    expect(await readFile(path, "utf8")).toBe("corrupt");
  });
});
