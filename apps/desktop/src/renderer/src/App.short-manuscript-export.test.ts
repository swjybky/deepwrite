import { describe, expect, it } from "vitest";
import appSource from "./WorkspaceShell.vue?raw";
import sidebarSource from "./components/LeftSidebar.vue?raw";
import sectionSource from "./components/TreeSection.vue?raw";
import dialogLayerSource from "./components/WorkspaceDialogLayer.vue?raw";
import lazyLifecycleSource from "./composables/useLazyShortBookLifecycleCoordinator.ts?raw";
import lifecycleSource from "./composables/useShortBookLifecycleCoordinator.ts?raw";
import transactionSource from "./composables/short-manuscript-export-transaction.ts?raw";
import dialogCoordinatorSource from "./composables/useWorkspaceDialogModuleCoordinator.ts?raw";
import exportInputSource from "./utils/shortManuscriptExport.ts?raw";

describe("short manuscript export UI wiring", () => {
  it("forwards the book export action from the tree to the live-manuscript exporter", () => {
    expect(sectionSource).toContain("@export-book");
    expect(sidebarSource).toContain("@export-book");
    expect(appSource).toContain('@export-book="openBookExportDialog"');
    expect(appSource).toContain('@export-short="exportBookManuscript"');
    expect(appSource).toContain("useWorkspaceDialogModuleCoordinator");
    expect(appSource).not.toContain('kind: "export-short"');
    expect(dialogCoordinatorSource).toContain('kind: "export-short"');
    expect(dialogLayerSource).toContain("<ExportShortManuscriptDialog");
    expect(dialogLayerSource).toContain(
      ':workspace-type="module.workspaceType"'
    );
    expect(dialogLayerSource).toContain(
      "@export=\"emit('exportShort', $event)\""
    );
    expect(lazyLifecycleSource).toContain(
      'return import("./useShortBookLifecycleCoordinator")'
    );
    expect(lifecycleSource).toContain("executeShortManuscriptExport({");
    expect(transactionSource).toContain("createShortManuscriptExportInput(");
    expect(transactionSource).toContain("transaction.api.exportShort(input)");
    expect(transactionSource).toContain("createShortManuscriptClipboardText(");
    expect(exportInputSource).toContain("editorDrafts[document.id]");
    expect(appSource).not.toContain("createShortManuscriptExportInput(");
    expect(appSource).not.toContain('from "./utils/shortManuscriptExport"');
  });
});
