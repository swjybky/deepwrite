import { describe, expect, it, vi } from "vitest";
import type { ResourceTreeNode } from "../types/workspace";
import {
  canDragCreationBook,
  creationBookDropPosition,
  useCreationBookDrag
} from "./useCreationBookDrag";

describe("creation book drag", () => {
  it("allows only available top-level creation books as drag sources", () => {
    const shortBook: ResourceTreeNode = {
      id: "short-one",
      label: "短篇",
      catalogNodeType: "book"
    };
    const longBook: ResourceTreeNode = {
      id: "long-book:one",
      label: "长篇",
      catalogNodeType: "long-book"
    };
    expect(canDragCreationBook("creation", shortBook)).toBe(true);
    expect(canDragCreationBook("creation", longBook)).toBe(true);
    expect(
      canDragCreationBook("creation", { ...longBook, unavailable: true })
    ).toBe(false);
    expect(canDragCreationBook("skill", shortBook)).toBe(false);
    expect(
      canDragCreationBook("creation", {
        id: "child",
        label: "章节",
        catalogNodeType: "document"
      })
    ).toBe(false);
  });

  it("uses the row midpoint for before and after placement", () => {
    const bounds = { top: 100, height: 40 };
    expect(creationBookDropPosition(101, bounds)).toBe("before");
    expect(creationBookDropPosition(119, bounds)).toBe("before");
    expect(creationBookDropPosition(120, bounds)).toBe("after");
    expect(creationBookDropPosition(139, bounds)).toBe("after");
  });

  it("does not cancel drag starts from skill and material tree entries", () => {
    for (const domain of ["skill", "material"] as const) {
      const preventDefault = vi.fn();
      const drag = useCreationBookDrag(() => domain, vi.fn());

      drag.start({ preventDefault } as unknown as DragEvent, {
        id: `${domain}-library`,
        label: `${domain} library`,
        catalogNodeType: "library"
      });

      expect(preventDefault).not.toHaveBeenCalled();
    }
  });
});
