import { describe, expect, it } from "vitest";
import documentSessionSource from "../composables/useLongEditorDocumentSession.ts?raw";
import structureSelectionSource from "../composables/useLongEditorStructureSelection.ts?raw";
import source from "./LongManuscriptNavigation.vue?raw";
import editorSource from "./LongWorkspaceEditor.vue?raw";
import paginationSource from "./longManuscriptNavigationPagination.ts?raw";

describe("LongManuscriptNavigation", () => {
  it("owns chapter navigation for top tabs and the right list", () => {
    expect(source).toContain('mode: "top-tabs" | "right-list"');
    expect(source).toContain(`v-if="mode === 'top-tabs'"`);
    expect(source).toContain(
      'class="section-tabs-bar long-worldbuilding-tabs long-chapter-card-tabs"'
    );
    expect(source).toContain("chapterCards");
    expect(source).toContain("actionMenuId");
    expect(source).toContain("runMenuAction");
    expect(source).toContain("const orderedItems = computed");
    expect(source).toContain("orderLongChapterNavigationItems(props.items)");
    expect(source).toContain('v-for="(chapter, index) in visibleItems"');
    expect(source).toContain("longManuscriptNavigationPageSlice");
    expect(source).toContain("ensureActiveChapterVisible");
    expect(source).toContain("pageOffset.value + index");
    expect(source).toContain("chapterPagination");
    expect(paginationSource).toContain(
      "LONG_MANUSCRIPT_NAVIGATION_PAGE_SIZE = 50"
    );
  });

  it("emits structure intent without applying mutations itself", () => {
    expect(source).toContain(
      "selectChapter: [chapterCardId: LongChapterCardId]"
    );
    expect(source).toContain("createChapter: []");
    expect(source).toContain(
      "deleteChapter: [chapterCardId: LongChapterCardId]"
    );
    expect(source).toContain("reorderChapter:");
    expect(source).not.toContain("LongWorkspaceOperationBatch");
    expect(source).not.toContain("resolveLongWorkspaceApi");
    expect(source).not.toContain("writeDocument");
    expect(source).not.toContain('type: "chapter.reorder"');
  });

  it("keeps navigation wiring in the parent and orchestration in editor composables", () => {
    expect(editorSource.match(/<LongManuscriptNavigation/gu)).toHaveLength(2);
    expect(editorSource).toContain('@delete-chapter="openChapterCardDelete"');
    expect(editorSource).toContain('@reorder-chapter="reorderChapterCard"');
    expect(structureSelectionSource).toContain('type: "chapter.reorder"');
    expect(editorSource).toContain(
      "emitDeleteStructure: (input, completion) => {"
    );
    expect(editorSource).toContain(
      'emit("deleteStructure", input, completion);'
    );
    expect(documentSessionSource).toContain(
      "async function saveCurrentDocument("
    );
  });

  it("closes its own action menu without leaking menu state to the editor", () => {
    expect(source).toContain(
      'window.addEventListener("pointerdown", handleWindowPointerDown, true)'
    );
    expect(source).toContain(
      'window.removeEventListener("pointerdown", handleWindowPointerDown, true)'
    );
    expect(editorSource).not.toContain("chapterCardActionMenuId");
    expect(editorSource).not.toContain("toggleChapterCardActionMenu");
    expect(editorSource).not.toContain("runChapterCardMenuAction");
  });
});
