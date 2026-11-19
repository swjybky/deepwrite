import { describe, expect, it } from "vitest";
import { WORKSPACE_DIALOG_KINDS } from "./WorkspaceDialogLayer.types";
import typesSource from "./WorkspaceDialogLayer.types.ts?raw";
import source from "./WorkspaceDialogLayer.vue?raw";

describe("WorkspaceDialogLayer boundary", () => {
  it("maps dialog kinds and the template creation variant to mutually exclusive branches", () => {
    const componentsByKind: Record<
      (typeof WORKSPACE_DIALOG_KINDS)[number],
      string
    > = {
      "book-resource": "BookResourceDialog",
      "plot-structure": "PlotStructureDialog",
      "character-item": "CharacterItemDialog",
      "export-short": "ExportShortManuscriptDialog",
      "export-long": "ExportLongManuscriptDialog",
      "library-removal": "LibraryRemovalDialog",
      "create-book": "CreateBookDialog",
      "book-transfer": "BookTransferDialog",
      "continuation-import": "LongContinuationImportDialog",
      "legacy-sync": "LongLegacySyncDialog",
      "long-structure": "LongStructureDialog",
      "create-long-character": "CreateLongCharacterDialog",
      "create-long-worldbuilding-item": "CreateLongWorldbuildingItemDialog",
      "create-long-plot-point": "CreateLongPlotPointDialog",
      "create-long-chapter-card": "CreateLongChapterCardDialog",
      "delete-long-draft": "DeleteLongDraftSectionDialog",
      "delete-long-tree": "DeleteLongDraftSectionDialog",
      "delete-long-ledger-commit": "DeleteLongDraftSectionDialog",
      "create-long-volume": "CreateLongVolumeDialog",
      "long-rename": "LongBookRenameDialog",
      "long-removal": "LongBookRemovalDialog",
      "library-project": "LibraryProjectDialog",
      "external-library-import": "ExternalSkillImportDialog",
      "library-package-import": "ImportLibraryPackageDialog",
      "library-entry-move": "LibraryEntryMoveDialog",
      "library-group": "LibraryGroupDialog",
      "save-conflict": "SaveConflictDialog",
      "create-expert-section": "CreateExpertSectionDialog",
      "delete-expert-section": "DeleteExpertSectionDialog",
      "startup-alert": "StartupAlertDialog"
    };
    expect(WORKSPACE_DIALOG_KINDS).toHaveLength(30);
    expect(new Set(WORKSPACE_DIALOG_KINDS).size).toBe(30);
    for (const kind of WORKSPACE_DIALOG_KINDS) {
      expect(source).toContain(`module.kind === '${kind}'`);
      expect(typesSource).toContain(`kind: "${kind}"`);
      expect(source).toMatch(
        new RegExp(
          `<${componentsByKind[kind]}\\s+[\\s\\S]*?v-(?:else-)?if="module\\.kind === '${kind}'"`,
          "u"
        )
      );
    }
    expect(source.match(/v-if="module\.kind ===/gu)).toHaveLength(1);
    expect(source.match(/v-else-if="module\.kind ===/gu)).toHaveLength(30);
    expect(source).toContain(
      "module.kind === 'create-book' && module.fromTemplate"
    );
    expect(source).toContain("<CreateBookFromTemplateDialog");
  });
});
