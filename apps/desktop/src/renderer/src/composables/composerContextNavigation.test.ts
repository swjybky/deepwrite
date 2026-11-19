import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createComposerContextNavigation } from "./composerContextNavigation";
import type { ResourceTreeNode, ResourceTreeSection } from "../types/workspace";

function setup() {
  const library: ResourceTreeNode = {
    id: "library",
    label: "测试技能库",
    catalogNodeType: "library",
    children: [{ id: "overview", label: "库介绍" }]
  };
  const sections = ref<ResourceTreeSection[]>([
    {
      id: "creation",
      label: "创作",
      icon: "book",
      nodes: [
        {
          id: "book-a",
          label: "测试短篇",
          catalogNodeType: "book",
          children: [
            {
              id: "character",
              label: "人物",
              selectableBranch: true,
              children: [{ id: "person", label: "角色一" }]
            },
            {
              id: "plot",
              label: "剧情",
              children: [
                { id: "opening", label: "开篇" },
                { id: "ending", label: "结局" }
              ]
            }
          ]
        },
        {
          id: "book-b",
          label: "测试剧本",
          catalogNodeType: "book",
          children: [{ id: "script", label: "剧集" }]
        },
        {
          id: "missing",
          label: "不可用作品",
          catalogNodeType: "long-book",
          unavailable: true
        }
      ]
    },
    {
      id: "skill",
      label: "技能",
      icon: "library",
      nodes: [{ id: "group", label: "分组", children: [library] }, library]
    }
  ]);
  const selectedResourceId = ref("person");
  const selectResource = vi.fn(async (node: ResourceTreeNode) => {
    selectedResourceId.value = node.id;
  });
  const error = vi.fn();
  const navigation = createComposerContextNavigation({
    sections,
    selectedResourceId,
    selectResource,
    error,
    canSelect: (node) =>
      Boolean(node.selectableBranch || !node.children?.length)
  });
  return { navigation, selectedResourceId, selectResource, sections, error };
}
describe("composer context navigation", () => {
  it("lists a mystery book and follows its role and act to the selected document", async () => {
    const h = setup();
    const target = { id: "body-one", label: "人物本正文" };
    h.sections.value[0]!.nodes.push({
      id: "mystery-book:one",
      label: "测试剧本杀",
      catalogNodeType: "mystery-book",
      children: [{ id: "act-one", label: "第一幕", children: [target] }]
    });
    expect(await h.navigation.select("book", "mystery-book:one")).toBe(true);
    expect(h.navigation.currentBook.value?.catalogNodeType).toBe(
      "mystery-book"
    );
    expect(h.navigation.stages.value[0]).toMatchObject({
      id: target.id,
      current: true
    });
  });
  it("collects grouped libraries once and marks the owning book for a nested selection", () => {
    const { navigation } = setup();
    expect(navigation.books.value.map(({ id }) => id)).toEqual([
      "book-a",
      "book-b",
      "missing",
      "library"
    ]);
    expect(navigation.currentBook.value?.id).toBe("book-a");
    expect(
      navigation.books.value.find(({ id }) => id === "missing")?.disabled
    ).toBe(true);
    expect(
      navigation.stages.value.map(({ id, current }) => ({ id, current }))
    ).toEqual([
      { id: "character", current: true },
      { id: "opening", current: false },
      { id: "ending", current: false }
    ]);
    expect(navigation.stages.value[1]?.detail).toBe("剧情");
  });
  it("uses existing navigation and replaces stages after switching books", async () => {
    const { navigation, selectResource } = setup();
    expect(await navigation.select("book", "book-b")).toBe(true);
    expect(selectResource).toHaveBeenCalledWith(
      expect.objectContaining({ id: "script" })
    );
    expect(navigation.stages.value.map(({ id }) => id)).toEqual(["script"]);
    expect(await navigation.select("stage", "ending")).toBe(false);
    expect(await navigation.select("book", "missing")).toBe(false);
    expect(selectResource).toHaveBeenCalledTimes(1);
  });
  it("preserves a nested selection when reselecting its current stage or book", async () => {
    const { navigation, selectedResourceId, selectResource } = setup();
    expect(await navigation.select("stage", "character")).toBe(true);
    expect(await navigation.select("book", "book-a")).toBe(true);
    expect(selectedResourceId.value).toBe("person");
    expect(selectResource).not.toHaveBeenCalled();
  });
  it("keeps the picker open after blocked navigation and reports errors without changing selection", async () => {
    const { navigation, selectResource, error, selectedResourceId } = setup();
    selectResource.mockImplementationOnce(async () => {});
    expect(await navigation.select("book", "book-b")).toBe(false);
    selectResource.mockRejectedValueOnce(new Error("测试读取失败"));
    expect(await navigation.select("stage", "ending")).toBe(false);
    expect(error).toHaveBeenCalledWith("测试读取失败");
    expect(selectedResourceId.value).toBe("person");
    expect(navigation.busy.value).toBe(false);
  });
  it("rejects repeated clicks while navigation is pending", async () => {
    const { navigation, selectResource, selectedResourceId } = setup();
    let finish!: () => void;
    selectResource.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            selectedResourceId.value = "script";
            resolve();
          };
        })
    );
    const first = navigation.select("book", "book-b");
    expect(navigation.busy.value).toBe(true);
    expect(await navigation.select("stage", "ending")).toBe(false);
    finish();
    expect(await first).toBe(true);
    expect(selectResource).toHaveBeenCalledTimes(1);
  });
  it("tracks library contents and removes stale choices when the tree updates", async () => {
    const { navigation, sections } = setup();
    expect(await navigation.select("book", "library")).toBe(true);
    expect(navigation.stages.value.map(({ id }) => id)).toEqual(["overview"]);
    sections.value = [];
    expect(navigation.currentBook.value).toBeUndefined();
    expect(navigation.stages.value).toEqual([]);
    expect(await navigation.select("book", "library")).toBe(false);
  });
});
