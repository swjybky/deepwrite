import { describe, expect, it } from "vitest";
import { expectSourceToContain } from "../../../test-utils/sourceText";
import lazyComponentsSource from "./lazyAppComponents.ts?raw";
import { WORKSPACE_DIALOG_KINDS } from "./WorkspaceDialogLayer.types";
import typesSource from "./WorkspaceDialogLayer.types.ts?raw";
import source from "./WorkspaceDialogLayer.vue?raw";

describe("WorkspaceDialogLayer boundary", () => {
  it("maps every dialog kind to exactly one mutually exclusive branch", () => {
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
      "long-bindings": "LongBookBindingsDialog",
      "long-rename": "LongBookRenameDialog",
      "long-removal": "LongBookRemovalDialog",
      "library-project": "LibraryProjectDialog",
      "external-skill-import": "ExternalSkillImportDialog",
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
    expect(source.match(/v-else-if="module\.kind ===/gu)).toHaveLength(29);
  });

  it("does not instantiate a host or dialog branch without a module", () => {
    expect(source).toContain("module: WorkspaceDialogModule | null");
    expectSourceToContain(source, '<DialogHost v-if="module"');
    expect(source).toContain(':active-dialog="module.kind"');
    expect(source).not.toContain("v-show");
    expect(source).not.toContain("KeepAlive");
  });

  it("keeps the layer and every concrete dialog behind lazy boundaries", () => {
    expect(lazyComponentsSource).toContain(
      '() => import("./WorkspaceDialogLayer.vue")'
    );
    expect(source).toContain('from "./lazyAppComponents"');
    expect(source).not.toMatch(
      /import\s+\w+\s+from\s+"\.\/(?:BookResourceDialog|PlotStructureDialog|LongStructureDialog|CreateBookDialog|SaveConflictDialog)\.vue"/u
    );
  });

  it("forwards multi-argument mutation contracts without dropping completion", () => {
    expect(source).toContain(
      "emit('plotStructureMutation', mutation, completion)"
    );
    expect(source).toContain(
      "emit('characterStructureMutation', mutation, completion)"
    );
    expect(source).toContain(
      "emit('longStructureMutation', batch, completion)"
    );
    expect(source).toContain(
      "emit('syncLongWorldbuilding', payload, completion)"
    );
    expect(source).toContain("emit('saveLongAgentsMd', content, completion)");
    expect(typesSource).toContain(
      "completion: LongStructureMutationCompletion"
    );
    expect(typesSource).toContain("completion: DialogMutationCompletion");
  });

  it("preserves dedicated close events for coordinator-owned dialog state", () => {
    for (const event of [
      "closePlotStructure",
      "closeCharacterItem",
      "closeLongStructure",
      "closeCreateLongCharacter",
      "closeCreateLongWorldbuildingItem",
      "closeCreateLongPlotPoint",
      "closeCreateLongChapterCard",
      "closeDeleteLongDraft",
      "closeDeleteLongTree",
      "closeCreateLongVolume",
      "closeCreateExpertSection",
      "closeDeleteExpertSection"
    ]) {
      expect(source).toContain(`emit('${event}')`);
      expect(typesSource).toContain(`${event}: []`);
    }
  });

  it("contains only typed low-frequency dialog data", () => {
    expect(typesSource).toContain("export type WorkspaceDialogModule =");
    expect(typesSource).toContain("export interface WorkspaceDialogLayerEmits");
    expect(source).not.toMatch(/\bany\b/u);
    expect(typesSource).not.toMatch(/\bany\b/u);
    expect(source).not.toContain("$attrs");
    expect(source).not.toContain("conversationController");
    expect(source).not.toContain("messages.value");
    expect(source).not.toContain("composerDraft");
    expect(source).not.toContain("WritingWorkspaceModule");
    expect(source).not.toContain("LongWorkspaceModule");
  });
});
