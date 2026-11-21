import { computed, reactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  LONG_BOOK_LINE_FILE_ID,
  applyLongWorkspaceOperations,
  type LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import type {
  LongStructureMutationCompletion,
  LongWorkspaceSelection
} from "../types/longWorkspace";
import { createLongStructureMutationBuilder } from "../types/longStructureMutations";
import { longWorkspaceScaleFixture } from "../utils/longWorkspaceScale.test-support";
import { moveLongEntry, type LongEntryGroup } from "../utils/longEntryReorder";
import { useLongEntryReorder } from "./useLongEntryReorder";

function setup(group: LongEntryGroup = "worldbuilding") {
  let index = longWorkspaceScaleFixture(0).index;
  index.bookLine.id = LONG_BOOK_LINE_FILE_ID;
  let sequence = 0;
  const builder = () =>
    createLongStructureMutationBuilder(index, {
      createId: (prefix) => `${prefix}_reorder_${++sequence}`
    });
  const apply = (batch: LongWorkspaceOperationBatch) => {
    index = applyLongWorkspaceOperations(index, batch).snapshot;
  };
  apply(builder().createCharacterType({ title: "主要人物" }));
  const characterType = index.characterTypes[0]!.id;
  apply(builder().createWorldbuilding({ title: "世界观", format: "list" }));
  const category = index.worldbuilding[0]!;
  for (let i = 0; i < 3; i++) {
    apply(builder().createWorldbuildingItem(category.id, `条目 ${i + 1}`));
    apply(
      builder().createCharacter({ name: `人物 ${i + 1}`, group: characterType })
    );
    apply(builder().createVolume({ title: `分卷 ${i + 2}` }));
    apply(
      builder().createStoryPlot({
        arcId: "arc_one",
        title: `故事情节 ${i + 1}`
      })
    );
  }
  const selection: LongWorkspaceSelection = {
    key: `worldbuilding:${category.id}`,
    root: group === "worldbuilding" ? "worldbuilding" : "plot_design",
    worldbuildingFormat: "list",
    characterGroup: characterType,
    characterTabs: index.characters.map(({ id, name }) => ({
      id,
      label: name
    })),
    plotPointVolumeId: "volume_one",
    plotPointId: "arc_one",
    plotPointTabs: index.plot.arcs.map(({ id, title }) => ({
      id,
      label: title
    })),
    title: "排序测试",
    breadcrumbs: [],
    files: [],
    preferredRole: "content"
  };
  const props = reactive({
    bookId: index.bookId,
    selection,
    workspaceIndex: index,
    locked: false
  });
  const readOnly = computed(() => false);
  const mutate =
    vi.fn<
      (
        _batch: LongWorkspaceOperationBatch,
        _completion: LongStructureMutationCompletion
      ) => void
    >();
  const { binding: order, preview } = useLongEntryReorder({
    props,
    readOnly,
    worldbuildingItems: computed(() => {
      const current = props.workspaceIndex.worldbuilding[0]!;
      return current.format === "list" ? current.items : [];
    }),
    volumes: computed(() => props.workspaceIndex.plot.volumes),
    storyPlots: computed(() => props.workspaceIndex.plot.storyPlots),
    mutate
  });
  return { props, order, mutate, preview };
}

describe("long entry drag reorder", () => {
  it.each([
    ["worldbuilding", "worldbuildingItem.reorder"],
    ["character", "character.reorder"],
    ["volume", "volume.reorder"],
    ["plotPoint", "arc.reorder"],
    ["storyPlot", "storyPlot.reorder"]
  ] as const)(
    "saves a nonadjacent %s move through existing workspace operations",
    (group, type) => {
      const { props, order, mutate } = setup(group);
      const ids = order.value.groups[group]!.ids;
      const moved = moveLongEntry(ids, ids.at(-1)!, ids[0]!, "before");
      order.value.reorder(group, moved);

      expect(mutate).toHaveBeenCalledOnce();
      const [batch] = mutate.mock.calls[0]!;
      expect(batch.operations).toEqual([
        expect.objectContaining({ type, orderedIds: moved })
      ]);
      expect(batch.documentWrites).toEqual([]);
      const saved = applyLongWorkspaceOperations(
        props.workspaceIndex,
        batch
      ).snapshot;
      const values = {
        worldbuilding:
          saved.worldbuilding[0]!.format === "list"
            ? saved.worldbuilding[0]!.items
            : [],
        character: saved.characters,
        volume: saved.plot.volumes,
        plotPoint: saved.plot.arcs,
        storyPlot: saved.plot.storyPlots
      }[group];
      expect(values.map(({ id }) => id)).toEqual(moved);
    }
  );

  it("rejects an overview id, omissions, duplicates and unchanged order", () => {
    const { order, mutate } = setup();
    const ids = [...order.value.groups.worldbuilding!.ids];
    for (const invalid of [
      ["overview", ...ids],
      ids.slice(1),
      [ids[0]!, ids[0]!, ids[2]!],
      ids
    ]) {
      order.value.reorder("worldbuilding", invalid);
    }
    expect(mutate).not.toHaveBeenCalled();
  });

  it("blocks only sorting while saving, restores availability after a failure, and retries", () => {
    const { order, mutate } = setup();
    const moved = [...order.value.groups.worldbuilding!.ids].reverse();
    const handler = order.value.reorder;
    handler("worldbuilding", moved);
    handler("worldbuilding", moved);
    expect(order.value.disabled).toBe(true);
    expect(mutate).toHaveBeenCalledOnce();
    mutate.mock.calls[0]![1].fail("模拟保存失败");
    expect(order.value.disabled).toBe(false);
    order.value.reorder("worldbuilding", moved);
    expect(mutate).toHaveBeenCalledTimes(2);
    mutate.mock.calls[1]![1].succeed();
    expect(order.value.disabled).toBe(false);
  });

  it("disables sorting when the editor is locked", () => {
    const { props, order, mutate } = setup();
    props.locked = true;
    expect(order.value.disabled).toBe(true);
    order.value.reorder(
      "worldbuilding",
      [...order.value.groups.worldbuilding!.ids].reverse()
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it("previews the new order immediately and restores authoritative order on failure", () => {
    const { order, mutate, preview } = setup();
    const items = order.value.groups.worldbuilding!.ids.map((id) => ({ id }));
    const moved = items.map(({ id }) => id).reverse();
    order.value.reorder("worldbuilding", moved);
    expect(preview("worldbuilding", items).map(({ id }) => id)).toEqual(moved);
    expect(items.map(({ id }) => id)).not.toEqual(moved);
    mutate.mock.calls[0]![1].fail();
    expect(preview("worldbuilding", items)).toEqual(items);
  });

  it("never carries a pending order into a different book or collection", () => {
    const { props, order, preview } = setup();
    const items = order.value.groups.worldbuilding!.ids.map((id) => ({ id }));
    order.value.reorder("worldbuilding", items.map(({ id }) => id).reverse());
    props.bookId = "other-book";
    expect(preview("worldbuilding", items)).toEqual(items);
  });
});
