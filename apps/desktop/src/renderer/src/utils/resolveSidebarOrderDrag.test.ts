import { describe, expect, it, vi } from "vitest";
import type {
  CatalogResourceNodeActionPayload,
  CreationTreeReorderPayload,
  ResourceTreeNode,
  ResourceTreeSection
} from "../types/workspace";
import { resolveSidebarOrderDrag } from "./resolveSidebarOrderDrag";

function node(
  id: string,
  extra: Partial<ResourceTreeNode> = {}
): ResourceTreeNode {
  return {
    id,
    label: id,
    icon: "file",
    ...extra
  };
}

function createHarness(
  sections: ResourceTreeSection[],
  options: {
    pinnedNodes?: ResourceTreeNode[];
    longTreeActionsDisabled?: boolean;
    canReorderMysteryBook?: (bookId: string) => boolean;
  } = {}
) {
  const onReorderLibrary =
    vi.fn<(payload: CatalogResourceNodeActionPayload) => void>();
  const onReorderCreationNode =
    vi.fn<(payload: CreationTreeReorderPayload) => void>();
  const resolve = (id: string) =>
    resolveSidebarOrderDrag(id, {
      sections,
      pinnedNodes: options.pinnedNodes,
      domainForPinnedNode: () => "creation",
      longTreeActionsDisabled: options.longTreeActionsDisabled,
      canReorderMysteryBook: options.canReorderMysteryBook,
      onReorderLibrary,
      onReorderCreationNode
    });
  return { resolve, onReorderLibrary, onReorderCreationNode };
}

describe("resolveSidebarOrderDrag", () => {
  it("resolves material and skill libraries and groups while rejecting entries and no-op drops", () => {
    const libA = node("lib-a", {
      catalogNodeType: "library",
      libraryId: "lib_a",
      children: [node("doc-1", { catalogNodeType: "document" })]
    });
    const libB = node("lib-b", {
      catalogNodeType: "library",
      libraryId: "lib_b"
    });
    const nested1 = node("nested-1", {
      catalogNodeType: "library",
      libraryId: "n_1"
    });
    const nested2 = node("nested-2", {
      catalogNodeType: "library",
      libraryId: "n_2"
    });
    const group = node("grp-1", {
      catalogNodeType: "group",
      groupId: "grp_1",
      children: [nested1, nested2]
    });
    const { resolve, onReorderLibrary } = createHarness([
      {
        id: "material",
        label: "素材库",
        icon: "folder",
        nodes: [libA, libB, group]
      }
    ]);

    expect(resolve("doc-1")).toBeUndefined();
    const topDrag = resolve("lib-a")!;
    expect(topDrag).toBeDefined();
    expect(topDrag.findTarget("nested-1")).toBeUndefined();
    expect(topDrag.findTarget("grp-1")).toBe(group);
    expect(topDrag.canDrop(libB, "before")).toBe(false);
    expect(topDrag.canDrop(libB, "after")).toBe(true);
    expect(topDrag.canDrop(group, "before")).toBe(true);
    topDrag.drop(group, "after");
    expect(onReorderLibrary).toHaveBeenCalledWith({
      domain: "material",
      action: "reorder-library",
      node: libA,
      anchorId: "grp_1",
      position: "after"
    });

    const nestedDrag = resolve("nested-1")!;
    expect(nestedDrag.findTarget("lib-b")).toBeUndefined();
    nestedDrag.drop(nested2, "after");
    expect(onReorderLibrary).toHaveBeenLastCalledWith({
      domain: "material",
      action: "reorder-library",
      node: nested1,
      anchorId: "n_2",
      position: "after"
    });
  });

  it("blocks top-level books and pinned roots while allowing inner children of pinned books", () => {
    const stage1 = node("stage-1", { plotStageId: "stage_1" });
    const stage2 = node("stage-2", { plotStageId: "stage_2" });
    const pinnedShort = node("book-short", {
      catalogNodeType: "book",
      workspaceType: "short",
      children: [
        node("cat-plot", {
          catalogNodeType: "category",
          children: [stage1, stage2]
        })
      ]
    });
    const { resolve, onReorderCreationNode } = createHarness([], {
      pinnedNodes: [pinnedShort]
    });

    expect(resolve("book-short")).toBeUndefined();
    expect(resolve("cat-plot")).toBeUndefined();
    const drag = resolve("stage-1")!;
    expect(drag.canDrop(stage2, "after")).toBe(true);
    drag.drop(stage2, "after");
    expect(onReorderCreationNode).toHaveBeenCalledWith({
      kind: "short-plot-stage",
      bookId: "book-short",
      stageId: "stage_1",
      anchorId: "stage_2",
      position: "after"
    });
  });

  it("resolves short plot, character, and draft section nodes only within eligible siblings", () => {
    const p1 = node("p1", { plotStageId: "plot_1" });
    const p2 = node("p2", { plotStageId: "plot_2" });
    const outline = node("outline", { catalogNodeType: "document" });
    const c1 = node("c1", { characterItemId: "char_1" });
    const c2 = node("c2", { characterItemId: "char_2" });
    const d1 = node("d1", { expertSectionId: "sec_1" });
    const d2 = node("d2", { expertSectionId: "sec_2" });
    const shortBook = node("short-1", {
      catalogNodeType: "book",
      workspaceType: "short",
      children: [
        node("plot-dir", { children: [p1, p2, outline] }),
        node("char-dir", { children: [c1, c2] }),
        node("draft-dir", { children: [d1, d2] })
      ]
    });
    const unpinnedBook = node("short-2", {
      catalogNodeType: "book",
      workspaceType: "short"
    });

    const { resolve, onReorderCreationNode } = createHarness([
      {
        id: "creation",
        label: "创作",
        icon: "book",
        nodes: [shortBook, unpinnedBook]
      }
    ]);

    expect(resolve("short-2")).toBeUndefined();
    const plotDrag = resolve("p1")!;
    expect(plotDrag.findTarget("outline")).toBeUndefined();
    expect(plotDrag.findTarget("c1")).toBeUndefined();
    plotDrag.drop(p2, "after");

    const charDrag = resolve("c2")!;
    expect(charDrag.canDrop(c1, "after")).toBe(false);
    expect(charDrag.canDrop(c1, "before")).toBe(true);
    charDrag.drop(c1, "before");

    const draftDrag = resolve("d1")!;
    draftDrag.drop(d2, "after");

    expect(onReorderCreationNode.mock.calls.map(([p]) => p)).toEqual([
      {
        kind: "short-plot-stage",
        bookId: "short-1",
        stageId: "plot_1",
        anchorId: "plot_2",
        position: "after"
      },
      {
        kind: "short-character-item",
        bookId: "short-1",
        itemId: "char_2",
        anchorId: "char_1",
        position: "before"
      },
      {
        kind: "short-draft-section",
        bookId: "short-1",
        sectionId: "sec_1",
        anchorSectionId: "sec_2",
        position: "after"
      }
    ]);
  });

  it("handles all 7 long creation node types and preserves recorded and migration guards", () => {
    const wbCat1 = node("wb-cat-1", {
      workspaceType: "long",
      longBookId: "long-1",
      longWorldbuildingCategoryId: "cat_1"
    });
    const wbMig = node("wb-mig", {
      workspaceType: "long",
      longBookId: "long-1",
      longWorldbuildingCategoryId: "__migration_evidence__",
      readOnly: true
    });
    const wbCat2 = node("wb-cat-2", {
      workspaceType: "long",
      longBookId: "long-1",
      longWorldbuildingCategoryId: "cat_2"
    });
    const wbItem1 = node("wb-item-1", {
      workspaceType: "long",
      longBookId: "long-1",
      longTreeItem: {
        kind: "worldbuilding-item",
        id: "item_1",
        parentId: "cat_1"
      }
    });
    const wbItem2 = node("wb-item-2", {
      workspaceType: "long",
      longBookId: "long-1",
      longTreeItem: {
        kind: "worldbuilding-item",
        id: "item_2",
        parentId: "cat_1"
      }
    });
    const cg1 = node("cg-1", {
      workspaceType: "long",
      longBookId: "long-1",
      longCharacterGroup: "grp_1",
      children: [
        node("ch-1", {
          workspaceType: "long",
          longBookId: "long-1",
          longTreeItem: {
            kind: "character",
            id: "char_1",
            parentId: "grp_1"
          }
        }),
        node("ch-2", {
          workspaceType: "long",
          longBookId: "long-1",
          longTreeItem: {
            kind: "character",
            id: "char_2",
            parentId: "grp_1"
          }
        })
      ]
    });
    const cg2 = node("cg-2", {
      workspaceType: "long",
      longBookId: "long-1",
      longCharacterGroup: "grp_2"
    });
    const vol1 = node("vol-1", {
      workspaceType: "long",
      longBookId: "long-1",
      longTreeItem: { kind: "volume", id: "vol_1" },
      children: [
        node("pp-1", {
          workspaceType: "long",
          longBookId: "long-1",
          longTreeItem: {
            kind: "plot-point",
            id: "pp_1",
            parentId: "vol_1"
          }
        }),
        node("pp-2", {
          workspaceType: "long",
          longBookId: "long-1",
          longTreeItem: {
            kind: "plot-point",
            id: "pp_2",
            parentId: "vol_1"
          }
        })
      ]
    });
    const volRec = node("vol-rec", {
      workspaceType: "long",
      longBookId: "long-1",
      longTreeItem: { kind: "volume", id: "vol_rec" },
      longVolumeHasRecordedChapters: true
    });
    const vol2 = node("vol-2", {
      workspaceType: "long",
      longBookId: "long-1",
      longTreeItem: { kind: "volume", id: "vol_2" }
    });

    const draftCh1 = node("dch-1", {
      workspaceType: "long",
      longBookId: "long-1",
      longWorkspaceSelection: {
        key: "draft:ch_1",
        root: "draft",
        title: "D1",
        breadcrumbs: [],
        files: [],
        preferredRole: "body",
        chapterCardId: "ch_1"
      }
    });
    const draftChRec = node("dch-rec", {
      workspaceType: "long",
      longBookId: "long-1",
      longDraftChapterRecorded: true,
      longWorkspaceSelection: {
        key: "draft:ch_rec",
        root: "draft",
        title: "DR",
        breadcrumbs: [],
        files: [],
        preferredRole: "body",
        chapterCardId: "ch_rec"
      }
    });
    const draftCh2 = node("dch-2", {
      workspaceType: "long",
      longBookId: "long-1",
      longWorkspaceSelection: {
        key: "draft:ch_2",
        root: "draft",
        title: "D2",
        breadcrumbs: [],
        files: [],
        preferredRole: "body",
        chapterCardId: "ch_2"
      }
    });
    const draftVol = node("dvol-1", {
      workspaceType: "long",
      longBookId: "long-1",
      longDraftVolumeId: "vol_1",
      children: [draftCh1, draftChRec, draftCh2]
    });

    const longBook = node("long-book:long-1", {
      catalogNodeType: "long-book",
      longBookId: "long-1",
      workspaceType: "long",
      children: [
        node("wb-root", {
          workspaceType: "long",
          longBookId: "long-1",
          children: [wbCat1, wbMig, wbCat2, wbItem1, wbItem2]
        }),
        node("char-root", {
          workspaceType: "long",
          longBookId: "long-1",
          children: [cg1, cg2]
        }),
        node("vol-root", {
          workspaceType: "long",
          longBookId: "long-1",
          children: [vol1, volRec, vol2]
        }),
        node("draft-root", {
          workspaceType: "long",
          longBookId: "long-1",
          children: [draftVol]
        })
      ]
    });

    const disabledHarness = createHarness(
      [{ id: "creation", label: "创作", icon: "book", nodes: [longBook] }],
      { longTreeActionsDisabled: true }
    );
    expect(disabledHarness.resolve("wb-cat-1")).toBeUndefined();

    const { resolve, onReorderCreationNode } = createHarness([
      { id: "creation", label: "创作", icon: "book", nodes: [longBook] }
    ]);

    expect(resolve("wb-mig")).toBeUndefined();
    const catDrag = resolve("wb-cat-1")!;
    expect(catDrag.findTarget("wb-mig")).toBeUndefined();
    expect(catDrag.canDrop(wbCat2, "before")).toBe(false);
    expect(catDrag.canDrop(wbCat2, "after")).toBe(true);
    catDrag.drop(wbCat2, "after");

    resolve("wb-item-1")!.drop(wbItem2, "after");
    resolve("cg-1")!.drop(cg2, "after");
    resolve("ch-1")!.drop(cg1.children![1]!, "after");

    expect(resolve("vol-rec")).toBeUndefined();
    const volDrag = resolve("vol-1")!;
    expect(volDrag.canDrop(volRec, "before")).toBe(false);
    expect(volDrag.canDrop(volRec, "after")).toBe(false);
    expect(volDrag.canDrop(vol2, "after")).toBe(false);

    resolve("pp-1")!.drop(vol1.children![1]!, "after");

    expect(resolve("dch-rec")).toBeUndefined();
    const draftDrag = resolve("dch-1")!;
    expect(draftDrag.canDrop(draftChRec, "before")).toBe(false);
    expect(draftDrag.canDrop(draftCh2, "after")).toBe(false);

    const draftVolNode = node("dvol-2", {
      workspaceType: "long",
      longBookId: "long-1",
      longDraftVolumeId: "vol_unrec",
      children: [
        node("d-u1", {
          workspaceType: "long",
          longBookId: "long-1",
          longWorkspaceSelection: {
            key: "draft:u1",
            root: "draft",
            title: "U1",
            breadcrumbs: [],
            files: [],
            preferredRole: "body",
            chapterCardId: "u1"
          }
        }),
        node("d-u2", {
          workspaceType: "long",
          longBookId: "long-1",
          longWorkspaceSelection: {
            key: "draft:u2",
            root: "draft",
            title: "U2",
            breadcrumbs: [],
            files: [],
            preferredRole: "body",
            chapterCardId: "u2"
          }
        })
      ]
    });
    longBook.children![3]!.children!.push(draftVolNode);
    resolve("d-u1")!.drop(draftVolNode.children![1]!, "after");
    resolve("vol-1")!.findTarget("vol-2");

    expect(onReorderCreationNode.mock.calls.map(([p]) => p.kind)).toEqual([
      "long-worldbuilding-category",
      "long-worldbuilding-item",
      "long-character-group",
      "long-character",
      "long-plot-point",
      "long-draft-chapter"
    ]);
  });

  it("handles academic stages/chapters/sections and mystery items with busy/builtin guards", () => {
    const fw1 = node("fw-1", {
      academicFrameworkStageItem: { bookId: "ac-1", stageId: "s1" }
    });
    const fw2 = node("fw-2", {
      academicFrameworkStageItem: { bookId: "ac-1", stageId: "s2" }
    });
    const secLead = node("sec-lead", {
      expertSectionId: "s_lead",
      academicSectionItem: {
        bookId: "ac-1",
        sectionId: "s_lead",
        title: "导语",
        wordCountRequirement: "",
        moveUpDisabled: false,
        moveDownDisabled: false,
        deletable: true
      }
    });
    const ch1 = node("ch-1", {
      academicChapterItem: {
        bookId: "ac-1",
        chapterId: "chap_1",
        title: "第一章",
        moveUpDisabled: false,
        moveDownDisabled: false
      }
    });
    const ch2 = node("ch-2", {
      academicChapterItem: {
        bookId: "ac-1",
        chapterId: "chap_2",
        title: "第二章",
        moveUpDisabled: false,
        moveDownDisabled: false
      }
    });
    const secTrail = node("sec-trail", {
      expertSectionId: "s_trail",
      academicSectionItem: {
        bookId: "ac-1",
        sectionId: "s_trail",
        title: "参考文献",
        wordCountRequirement: "",
        moveUpDisabled: false,
        moveDownDisabled: false,
        deletable: true
      }
    });

    const academicBook = node("ac-1", {
      catalogNodeType: "book",
      workspaceType: "academic",
      children: [
        node("fw-dir", { children: [fw1, fw2] }),
        node("ms-dir", { children: [secLead, ch1, ch2, secTrail] })
      ]
    });

    const tBuiltin = node("t-core");
    const tCustom1 = node("t-1", {
      mysteryItem: { kind: "truth_doc", id: "td_1" } as never
    });
    const tCustom2 = node("t-2", {
      mysteryItem: { kind: "truth_doc", id: "td_2" } as never
    });
    const r1 = node("r-1", {
      mysteryItem: { kind: "role", id: "role_1" } as never
    });
    const r2 = node("r-2", {
      mysteryItem: { kind: "role", id: "role_2" } as never
    });
    const mysteryBook = node("mys-book", {
      catalogNodeType: "mystery-book",
      mysteryBookId: "mys-1",
      workspaceType: "mystery",
      children: [
        node("mys-truth", { children: [tBuiltin, tCustom1, tCustom2] }),
        node("mys-chars", { children: [node("rel"), r1, r2] })
      ]
    });

    const busyMystery = createHarness(
      [
        {
          id: "creation",
          label: "创作",
          icon: "book",
          nodes: [academicBook, mysteryBook]
        }
      ],
      { canReorderMysteryBook: () => false }
    );
    expect(busyMystery.resolve("t-1")).toBeUndefined();

    const { resolve, onReorderCreationNode } = createHarness(
      [
        {
          id: "creation",
          label: "创作",
          icon: "book",
          nodes: [academicBook, mysteryBook]
        }
      ],
      { canReorderMysteryBook: (id) => id === "mys-1" }
    );

    resolve("fw-1")!.drop(fw2, "after");
    resolve("ch-1")!.drop(ch2, "after");
    // Leading unchaptered section across chapters is not a no-op because chapters sit between them
    const secDrag = resolve("sec-lead")!;
    expect(secDrag.findTarget("ch-1")).toBeUndefined();
    expect(secDrag.canDrop(secTrail, "before")).toBe(true);
    secDrag.drop(secTrail, "after");

    expect(resolve("t-core")).toBeUndefined();
    expect(resolve("rel")).toBeUndefined();
    resolve("t-1")!.drop(tCustom2, "after");
    resolve("r-2")!.drop(r1, "before");

    expect(onReorderCreationNode.mock.calls.map(([p]) => p)).toEqual([
      {
        kind: "academic-framework-stage",
        bookId: "ac-1",
        stageId: "s1",
        anchorId: "s2",
        position: "after"
      },
      {
        kind: "academic-chapter",
        bookId: "ac-1",
        chapterId: "chap_1",
        anchorChapterId: "chap_2",
        position: "after"
      },
      {
        kind: "academic-section",
        bookId: "ac-1",
        sectionId: "s_lead",
        anchorSectionId: "s_trail",
        position: "after"
      },
      {
        kind: "mystery-item",
        bookId: "mys-1",
        itemKind: "truth_doc",
        id: "td_1",
        anchorId: "td_2",
        position: "after"
      },
      {
        kind: "mystery-item",
        bookId: "mys-1",
        itemKind: "role",
        id: "role_2",
        anchorId: "role_1",
        position: "before"
      }
    ]);
  });
});
