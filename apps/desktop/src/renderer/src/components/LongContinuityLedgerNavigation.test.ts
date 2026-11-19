import { describe, expect, it } from "vitest";
import source from "./LongContinuityLedgerNavigation.vue?raw";
import editorSource from "./LongWorkspaceEditor.vue?raw";
import editorSessionSource from "../composables/useLongEditorDocumentSession.ts?raw";

describe("LongContinuityLedgerNavigation", () => {
  it("owns both configured continuity navigation layouts", () => {
    expect(source).toContain('mode: "top-tabs" | "right-list"');
    expect(source).toContain(`v-if="mode === 'top-tabs'"`);
    expect(source).toContain('class="draft-file-tabs"');
    expect(source).toContain("continuityLedgerFiles");
    expect(source).toContain(
      'class="long-story-plot-pane long-entry-list-pane long-continuity-ledger-list"'
    );
  });

  it("emits file selection without owning reads, writes, or CAS", () => {
    expect(source).toContain("selectFile: [fileId: string]");
    expect(source).toContain("emit('selectFile', file.id)");
    expect(source).not.toContain("LongWorkspaceSelection");
    expect(source).not.toContain("resolveLongWorkspaceApi");
    expect(source).not.toContain("readDocument");
    expect(source).not.toContain("writeDocument");
    expect(source).not.toContain("baseProjectRevision");
  });

  it("keeps active and pending state explicit in both layouts", () => {
    expect(source).toContain(':aria-selected="activeFileId === file.id"');
    expect(source).toContain(':aria-pressed="activeFileId === file.id"');
    expect(
      source.match(/:aria-busy="pendingFileId === file.id"/gu)
    ).toHaveLength(2);
    expect(source).toContain("'is-loading': pendingFileId === file.id");
  });

  it("is wired for top tabs and the right list through a narrow projection", () => {
    expect(editorSource).toContain(
      'import LongContinuityLedgerNavigation from "./LongContinuityLedgerNavigation.vue"'
    );
    expect(
      editorSource.match(/<LongContinuityLedgerNavigation/gu)
    ).toHaveLength(2);
    expect(editorSource).toContain("currentUsesTopContinuityTabs");
    expect(editorSource).toContain("currentUsesRightContinuityList");
    expect(editorSource).toContain("currentContinuityNavigationItems");
    expect(editorSource).toContain('@select-file="selectWorkspaceFile"');
    expect(editorSessionSource).toContain(
      "async function loadWorkspaceDocument("
    );
    expect(editorSessionSource).toContain(
      "async function saveCurrentDocument("
    );
  });
});
