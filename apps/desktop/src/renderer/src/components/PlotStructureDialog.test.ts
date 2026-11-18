import { describe, expect, it } from "vitest";
import source from "./PlotStructureDialog.vue?raw";
import controllerSource from "./usePlotStructureDialog.ts?raw";
import contextPanelSource from "./WritingContextPanel.vue?raw";
import treeSource from "./TreeNodeItem.vue?raw";

const implementationSource = `${source}\n${controllerSource}`;
const visualSource = `${source}\n${contextPanelSource}`;

describe("PlotStructureDialog", () => {
  it("supports dynamic structure CRUD, enable toggles and stable ordering", () => {
    expect(source).toContain("plotStructure");
    expect(implementationSource).toContain('type: "create"');
    expect(implementationSource).toContain('type: "update"');
    expect(implementationSource).toContain('type: "move"');
    expect(implementationSource).toContain('type: "setEnabled"');
    expect(implementationSource).toContain('type: "delete"');
    expect(implementationSource).toContain("isBuiltinCreativePlotStageId");
    expect(source).toContain("namesAndNotesApplyGloballyEnabledStateAndOrder");
    expect(source).toContain(
      "theStableIDRemainsUnchangedAfterRenamingOrReordering"
    );
  });

  it("is available from the short and script book action menu", () => {
    expect(treeSource).toContain("manageStructure");
    expect(treeSource).toContain("openBookAction('manage-structure')");
    expect(treeSource).toContain("hasBookAction");
  });

  it("switches between character and plot management with PopupSelect", () => {
    expect(source).toContain("characterStructure");
    expect(source).toContain("plotStructure");
    expect(source).toContain("<PopupSelect");
    expect(source).toContain(':menu-z-index="2300"');
    expect(source).toContain("entryStyle");
    expect(source).toContain("textStyle");
    expect(implementationSource).toContain('type: "setFormat"');
    expect(source).toContain("conversionPreview");
    expect(source).toContain("orderedCharacterItems");
  });

  it("locks builtin stages and hard-deletes custom stages globally", () => {
    expect(implementationSource).toContain(
      "defaultPlotStructuresCannotBeDeleted"
    );
    expect(source).toContain("deleteGlobally");
    expect(implementationSource).toContain("deleteContent: true");
    expect(implementationSource).toContain(
      "keepAtLeastOneEnabledPlotStructureItem"
    );
    expect(source).toContain("rows.length >= 32");
    expect(implementationSource).toContain("uiMessage.warning");
    expect(source).toContain('role="switch"');
  });

  it("uses a teleported focus-trapped themed compact dialog", () => {
    expect(source).toContain('<Teleport to="body">');
    expect(implementationSource).toContain('event.key !== "Tab"');
    expect(implementationSource).toContain('event.key === "Escape"');
    for (const className of [
      "plot-structure-manager",
      "manager-toolbar",
      "section-tabs",
      "manager-list",
      "manager-row",
      "row-toggle",
      "structure-modal-overlay",
      "structure-modal",
      "modal-actions"
    ]) {
      expect(visualSource).toContain(className);
    }
    for (const token of [
      "--surface-main",
      "--surface-raised",
      "--surface-muted",
      "--theme-line",
      "--theme-line-soft",
      "--text-primary",
      "--text-secondary",
      "--text-tertiary",
      "--accent",
      "--accent-soft"
    ]) {
      expect(visualSource).toContain(`var(${token})`);
    }
    expect(source).toContain(
      '<style scoped src="./plot-structure-dialog.css"></style>'
    );
    expect(contextPanelSource).toContain("@media (max-width: 680px)");
  });

  it("unmounts the parent dialog while exactly one child dialog is active", () => {
    expect(controllerSource).toContain("const activeSubdialog = computed");
    expect(source).toContain(
      "v-if=\"open && book && book.bookType !== 'academic' && !activeSubdialog\""
    );
    expect(source).toContain("activeSubdialog === 'character-format'");
    expect(source).toContain("activeSubdialog === 'form'");
    expect(source).toContain("activeSubdialog === 'delete'");
    expect(source.match(/v-else-if=/g)).toHaveLength(3);
  });

  it("adds a per-book short or screenplay context tab with auto-save", () => {
    expect(source).toContain("activeStructureTab === 'context'");
    expect(source).toContain("shortStoryContext");
    expect(source).toContain("screenplayContext");
    expect(source).toContain("<WritingContextPanel");
    expect(controllerSource).toContain("flushWritingContext");
    expect(contextPanelSource).toContain(
      "unsavedChangesAreSavedAutomaticallyWhenSwitchingTabsOr"
    );
  });
});
