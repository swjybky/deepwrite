import { describe, expect, it } from "vitest";
import resourceTreeSource from "../utils/longWorkspaceContinuityTree.ts?raw";
import selectionSource from "../types/longWorkspace.ts?raw";
import ledgerNavigationSource from "./LongContinuityLedgerNavigation.vue?raw";
import source from "./LongWorkspaceEditor.vue?raw";
import structureSource from "../composables/useLongEditorStructureSelection.ts?raw";

describe("LongWorkspaceEditor continuity text-file integration", () => {
  it("uses the ordinary text surface instead of a continuity dashboard", () => {
    expect(source).not.toContain(
      'import LongContinuityWorkspace from "./LongContinuityWorkspace.vue"'
    );
    expect(source).not.toContain("<LongContinuityWorkspace");
    expect(source).toContain("<MarkdownContent");
    expect(source).toContain(`v-if="viewMode === 'edit'"`);
    expect(source).toContain(
      ':readonly="currentReadOnly || isDocumentContentBusy"'
    );
    expect(source).toContain('class="long-document-preview"');
  });

  it("selects ledger entries by file id even when records share a role", () => {
    expect(structureSource).toContain(
      "const activeFileId = ref<string | null>(null)"
    );
    expect(source).toContain("<LongContinuityLedgerNavigation");
    expect(ledgerNavigationSource).toContain(':key="file.id"');
    expect(ledgerNavigationSource).toContain(
      ':aria-selected="activeFileId === file.id"'
    );
    expect(ledgerNavigationSource).toContain(
      "@click=\"emit('selectFile', file.id)\""
    );
    expect(source).toContain('@select-file="selectWorkspaceFile"');
  });

  it("lists only pending chapters and chapter records in the continuity tree", () => {
    expect(resourceTreeSource).toContain('title: "待处理章节"');
    expect(resourceTreeSource).toContain('title: "章节记录"');
    expect(resourceTreeSource).not.toContain('key: "continuity-view:snapshot"');
    expect(resourceTreeSource).not.toContain(
      'key: "continuity-view:execution"'
    );
    expect(resourceTreeSource).not.toContain(
      'key: "continuity-view:knowledge"'
    );
  });

  it("maps ledger navigation to chapter Markdown and never selects record JSON", () => {
    const ledgerStart = selectionSource.indexOf(
      'if (selection.key.startsWith("ledger:"))'
    );
    const ledgerSelection = selectionSource.slice(ledgerStart);
    expect(ledgerStart).toBeGreaterThan(-1);
    expect(ledgerSelection).toContain("createLongContinuitySelection(");
    expect(ledgerSelection).not.toContain("file: commit.recordFile");
  });
});
