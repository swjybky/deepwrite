import { describe, expect, it } from "vitest";
import source from "./SidebarResourceList.vue?raw";
import sectionSource from "./TreeSection.vue?raw";
import dragSource from "../composables/useCreationBookDrag.ts?raw";
import orderSource from "../utils/creationResourceOrder.ts?raw";
import workspaceTypeSource from "../types/workspace.ts?raw";

describe("SidebarResourceList creation ordering", () => {
  it("owns persisted creation ordering while keeping pinning separate", () => {
    expect(source).toContain("useCreationResourceOrder");
    expect(source).toContain("creationOrder.orderedSections.value");
    expect(source).toContain("collectPinnedResourceNodes");
    expect(source).toContain("excludePinnedResourceNodes");
    expect(source).toContain('@reorder-creation-book="reorderCreationBook"');
    expect(orderSource).toContain("deepwrite:creation-resource-order");
  });

  it("wires native top-level dragging with before and after insertion feedback", () => {
    expect(sectionSource).toContain(
      ':creation-book-draggable="creationBookDrag.canDrag(node)"'
    );
    expect(sectionSource).toContain('@dragstart="creationBookDrag.start');
    expect(sectionSource).toContain('@dragover="creationBookDrag.over');
    expect(sectionSource).toContain('@drop="creationBookDrag.drop');
    expect(dragSource).toContain("application/x-deepwrite-creation-book");
    expect(workspaceTypeSource).toContain('position: "before" | "after"');
    expect(dragSource).toContain("is-creation-book-drop-before");
    expect(dragSource).toContain("is-creation-book-drop-after");
  });

  it("does not enable ordering on the pinned tree", () => {
    const pinnedTree = source.slice(
      source.indexOf('class="resource-tree pinned-resource-tree"'),
      source.indexOf("<TreeSection")
    );
    expect(pinnedTree).not.toContain("reorderCreationBook");
    expect(pinnedTree).not.toContain("draggable");
  });
});
