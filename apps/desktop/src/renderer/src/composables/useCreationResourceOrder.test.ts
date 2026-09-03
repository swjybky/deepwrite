import { effectScope, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { ResourceTreeSection } from "../types/workspace";
import { CREATION_RESOURCE_ORDER_STORAGE_KEY } from "../utils/creationResourceOrder";
import {
  useCreationResourceOrder,
  type CreationResourceOrderStorage
} from "./useCreationResourceOrder";

function resourceSections(ids: readonly string[]): ResourceTreeSection[] {
  return [
    {
      id: "creation",
      label: "创作空间",
      icon: "book",
      nodes: ids.map((id) => ({
        id,
        label: id,
        icon: "book",
        catalogNodeType: id.startsWith("long-book:") ? "long-book" : "book"
      }))
    }
  ];
}

function memoryStorage(initial?: string): CreationResourceOrderStorage & {
  value(): string | null;
} {
  let stored = initial ?? null;
  return {
    getItem: () => stored,
    setItem: (_key, value) => {
      stored = value;
    },
    value: () => stored
  };
}

describe("useCreationResourceOrder", () => {
  it("seeds progressively loaded book types and then ignores upstream timestamp sorting", async () => {
    const sections = ref<ResourceTreeSection[]>([]);
    const storage = memoryStorage();
    const scope = effectScope();
    const controller = scope.run(() =>
      useCreationResourceOrder({
        sections: () => sections.value,
        storage: () => storage,
        warning: vi.fn()
      })
    )!;

    sections.value = resourceSections(["short-one", "script-one"]);
    await nextTick();
    sections.value = resourceSections([
      "short-one",
      "script-one",
      "long-book:one"
    ]);
    await nextTick();
    expect(controller.order.value).toEqual([
      "short-one",
      "script-one",
      "long-book:one"
    ]);

    sections.value = resourceSections([
      "long-book:one",
      "short-one",
      "script-one"
    ]);
    await nextTick();
    expect(
      controller.orderedSections.value[0]?.nodes.map(({ id }) => id)
    ).toEqual(["short-one", "script-one", "long-book:one"]);
    scope.stop();
  });

  it("persists drag order across restarts and appends new books", async () => {
    const storage = memoryStorage();
    const sections = ref(
      resourceSections(["short-one", "script-one", "long-book:one"])
    );
    const firstScope = effectScope();
    const first = firstScope.run(() =>
      useCreationResourceOrder({
        sections: () => sections.value,
        storage: () => storage,
        warning: vi.fn()
      })
    )!;
    first.reorder({
      sourceId: "long-book:one",
      targetId: "short-one",
      position: "before"
    });
    firstScope.stop();

    const secondScope = effectScope();
    const second = secondScope.run(() =>
      useCreationResourceOrder({
        sections: () => sections.value,
        storage: () => storage,
        warning: vi.fn()
      })
    )!;
    expect(second.order.value).toEqual([
      "long-book:one",
      "short-one",
      "script-one"
    ]);

    sections.value = resourceSections([
      "new-short",
      "short-one",
      "script-one",
      "long-book:one"
    ]);
    await nextTick();
    expect(second.order.value).toEqual([
      "long-book:one",
      "short-one",
      "script-one",
      "new-short"
    ]);
    expect(storage.value()).toBe(JSON.stringify(second.order.value));
    secondScope.stop();
  });

  it("removes a previously visible book so reopening appends it", async () => {
    const sections = ref(resourceSections(["short-one", "long-book:one"]));
    const storage = memoryStorage();
    const scope = effectScope();
    const controller = scope.run(() =>
      useCreationResourceOrder({
        sections: () => sections.value,
        storage: () => storage,
        warning: vi.fn()
      })
    )!;

    sections.value = resourceSections(["long-book:one"]);
    await nextTick();
    expect(controller.order.value).toEqual(["long-book:one"]);
    sections.value = resourceSections(["short-one", "long-book:one"]);
    await nextTick();
    expect(controller.order.value).toEqual(["long-book:one", "short-one"]);
    scope.stop();
  });

  it("keeps in-memory order and warns once when storage is unavailable", async () => {
    const sections = ref(resourceSections(["short-one", "long-book:one"]));
    const warning = vi.fn();
    const scope = effectScope();
    const controller = scope.run(() =>
      useCreationResourceOrder({
        sections: () => sections.value,
        storage: () => ({
          getItem() {
            throw new Error("blocked");
          },
          setItem() {
            throw new Error("blocked");
          }
        }),
        warning
      })
    )!;

    controller.reorder({
      sourceId: "long-book:one",
      targetId: "short-one",
      position: "before"
    });
    sections.value = resourceSections([
      "short-one",
      "long-book:one",
      "script-new"
    ]);
    await nextTick();
    expect(controller.order.value).toEqual([
      "long-book:one",
      "short-one",
      "script-new"
    ]);
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      "作品顺序暂时无法保存，但本次操作仍然有效"
    );
    scope.stop();
  });

  it("repairs malformed storage once resources are available", () => {
    const storage = memoryStorage("not-json");
    const scope = effectScope();
    scope.run(() =>
      useCreationResourceOrder({
        sections: () => resourceSections(["short-one"]),
        storage: () => storage,
        warning: vi.fn()
      })
    );
    expect(storage.value()).toBe(JSON.stringify(["short-one"]));
    expect(JSON.parse(storage.value()!)).toEqual(["short-one"]);
    expect(CREATION_RESOURCE_ORDER_STORAGE_KEY).toBe(
      "deepwrite:creation-resource-order"
    );
    scope.stop();
  });
});
