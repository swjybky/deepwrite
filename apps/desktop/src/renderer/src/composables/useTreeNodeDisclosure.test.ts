import { effectScope, nextTick, ref, shallowRef } from "vue";
import { describe, expect, it } from "vitest";
import type { ResourceTreeNode } from "../types/workspace";
import { useTreeNodeDisclosure } from "./useTreeNodeDisclosure";

describe("useTreeNodeDisclosure", () => {
  it.each([false, true])(
    "preserves explicit book disclosure when selecting another work (manually opened %s)",
    async (manual) => {
      const selection = ref("outside");
      const scope = effectScope();
      const { open } = scope.run(() =>
        useTreeNodeDisclosure(
          () => ({
            id: "short",
            catalogNodeType: "book",
            label: "短篇",
            children: [{ id: "short-text", label: "正文" }]
          }),
          () => selection.value
        )
      )!;
      if (manual) open.value = true;
      selection.value = "short-text";
      await nextTick();
      expect(open.value).toBe(true);
      selection.value = "mystery-document:other:truth_doc:core_truth";
      await nextTick();
      expect(open.value).toBe(manual);
      scope.stop();
    }
  );

  it("keeps a book collapsed when its row is selected from an active descendant", async () => {
    const selectedId = ref("document");
    const scope = effectScope();
    const { open } = scope.run(() =>
      useTreeNodeDisclosure(
        () => ({
          id: "book",
          label: "作品",
          selectableBranch: true,
          children: [{ id: "document", label: "正文" }]
        }),
        () => selectedId.value
      )
    )!;
    expect(open.value).toBe(true);
    open.value = false;
    selectedId.value = "book";
    await nextTick();
    expect(open.value).toBe(false);
    selectedId.value = "other-book";
    await nextTick();
    selectedId.value = "book";
    await nextTick();
    expect(open.value).toBe(true);
    scope.stop();
  });

  it.each(["character-b", "characters"])(
    "keeps a manually collapsed directory closed after deletion selects %s",
    async (fallback) => {
      const node = shallowRef<ResourceTreeNode>({
        id: "characters",
        label: "人物",
        selectableBranch: true,
        children: [
          { id: "character-a", label: "人物甲" },
          { id: "character-b", label: "人物乙" }
        ]
      });
      const selectedId = ref("character-a");
      const scope = effectScope();
      try {
        const { open } = scope.run(() =>
          useTreeNodeDisclosure(
            () => node.value,
            () => selectedId.value
          )
        )!;
        expect(open.value).toBe(true);
        open.value = false;
        node.value = { ...node.value, children: [node.value.children![1]!] };
        // The index store publishes the new tree before selection reconciliation.
        await nextTick();
        selectedId.value = fallback;
        await nextTick();
        expect(open.value).toBe(false);

        selectedId.value = "other-resource";
        await nextTick();
        selectedId.value = fallback;
        await nextTick();
        expect(open.value).toBe(true);
      } finally {
        scope.stop();
      }
    }
  );

  it("keeps a manually collapsed selected book closed when its tree refreshes", async () => {
    const node = shallowRef<ResourceTreeNode>({
      id: "long-book",
      label: "长篇",
      selectableBranch: true,
      children: [{ id: "chapter-1", label: "第一章" }]
    });
    const selectedId = ref("long-book");
    const scope = effectScope();
    const { open } = scope.run(() =>
      useTreeNodeDisclosure(
        () => node.value,
        () => selectedId.value
      )
    )!;

    expect(open.value).toBe(true);
    open.value = false;
    node.value = {
      ...node.value,
      children: [{ id: "chapter-1", label: "第一章（已刷新）" }]
    };
    await nextTick();
    expect(open.value).toBe(false);

    node.value = {
      ...node.value,
      children: [...node.value.children!, { id: "chapter-2", label: "第二章" }]
    };
    await nextTick();
    expect(open.value).toBe(false);

    selectedId.value = "short-document";
    await nextTick();
    expect(open.value).toBe(false);

    selectedId.value = "long-book";
    await nextTick();
    expect(open.value).toBe(true);
    scope.stop();
  });

  it("reveals a selected descendant when it appears or the selection changes", async () => {
    const node = shallowRef<ResourceTreeNode>({
      id: "book",
      label: "作品",
      children: [{ id: "other", label: "其他" }]
    });
    const selectedId = ref("chapter-1");
    const scope = effectScope();
    const { open } = scope.run(() =>
      useTreeNodeDisclosure(
        () => node.value,
        () => selectedId.value
      )
    )!;

    expect(open.value).toBe(false);
    node.value = {
      ...node.value,
      children: [
        {
          id: "volume",
          label: "卷",
          children: [{ id: "chapter-1", label: "第一章" }]
        },
        { id: "chapter-2", label: "第二章" }
      ]
    };
    await nextTick();
    expect(open.value).toBe(true);

    open.value = false;
    selectedId.value = "chapter-2";
    await nextTick();
    expect(open.value).toBe(true);
    scope.stop();
  });

  it("reveals a manually collapsed selection when returning from another feature", async () => {
    const selectedId = ref("characters");
    const selectionActive = ref(true);
    const scope = effectScope();
    const { open } = scope.run(() =>
      useTreeNodeDisclosure(
        () => ({
          id: "book",
          label: "作品",
          children: [{ id: "characters", label: "人物" }]
        }),
        () => selectedId.value,
        { selectionActive }
      )
    )!;

    expect(open.value).toBe(true);
    open.value = false;
    selectionActive.value = false;
    await nextTick();
    expect(open.value).toBe(false);
    selectionActive.value = true;
    await nextTick();
    expect(open.value).toBe(true);
    scope.stop();
  });

  it("keeps resource sections initially expanded and reveals a newly selected descendant", async () => {
    const selectedId = ref("");
    const scope = effectScope();
    const { open } = scope.run(() =>
      useTreeNodeDisclosure(
        () => ({
          id: "creation",
          label: "创作空间",
          children: [
            {
              id: "book",
              label: "作品",
              children: [{ id: "characters", label: "人物" }]
            }
          ]
        }),
        () => selectedId.value,
        { initialOpen: true }
      )
    )!;

    expect(open.value).toBe(true);
    open.value = false;
    selectedId.value = "characters";
    await nextTick();
    expect(open.value).toBe(true);
    scope.stop();
  });
});
