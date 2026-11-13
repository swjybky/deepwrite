import { describe, expect, it } from "vitest";
import source from "./LongManuscriptEditor.vue?raw";
import editorSource from "./LongWorkspaceEditor.vue?raw";
import documentSessionSource from "../composables/useLongEditorDocumentSession.ts?raw";
import structureSelectionSource from "../composables/useLongEditorStructureSelection.ts?raw";

const editorImplementationSource = [editorSource, documentSessionSource].join(
  "\n"
);

describe("LongManuscriptEditor", () => {
  it("owns the chapter body writing and preview surface", () => {
    expect(source).toContain("chapterManuscriptEditor");
    expect(source).toContain('class="long-document-title-input"');
    expect(source).toContain('class="long-document-editor"');
    expect(source).toContain('class="long-document-preview"');
    expect(source).toContain("<EditableMarkdownPreview");
    expect(source).toContain(':editable="!readOnly && !busy"');
  });

  it("accepts a narrow manuscript projection and emits user intent", () => {
    expect(source).toContain("viewMode: TextViewMode");
    expect(source).toContain('"update:titleDraft": [value: string]');
    expect(source).toContain("titleChange: [event: Event]");
    expect(source).toContain("beforeinput: [event: InputEvent]");
    expect(source).toContain(
      "editorElementChange: [element: HTMLTextAreaElement | null]"
    );
    expect(source).not.toContain("LongWorkspaceSelection");
    expect(source).not.toContain("LongWorkspaceIndexSnapshot");
    expect(source).not.toContain("resolveLongWorkspaceApi");
    expect(source).not.toContain("writeDocument");
  });

  it("is wired only for draft selections while the parent retains persistence", () => {
    expect(editorSource).toContain(
      'import LongManuscriptEditor from "./LongManuscriptEditor.vue"'
    );
    expect(editorSource).toContain("<LongManuscriptEditor");
    expect(editorSource).toContain("selection.root === 'draft'");
    expect(editorSource).toContain('@title-change="saveStructureTitle"');
    expect(editorSource).toContain('@input="handleEditorInput"');
    expect(editorSource).toContain(
      '@editor-element-change="setEditorInputElement"'
    );
    expect(editorImplementationSource).toContain(
      "async function loadWorkspaceDocument("
    );
    expect(editorImplementationSource).toContain(
      "async function saveCurrentDocument("
    );
    expect(editorImplementationSource).toContain("bookId,");
    expect(editorImplementationSource).toContain("fileId: state.file.id");
    expect(editorImplementationSource).toContain("content: submittedContent");
    expect(editorImplementationSource).not.toContain("baseRevision");
    expect(editorImplementationSource).not.toContain("workspaceRevision");
    expect(editorImplementationSource).not.toContain("projectRevision");
  });

  it("keeps the latest text viewport when a save finishes", () => {
    expect(editorImplementationSource).toContain(
      "const viewport = captureCurrentEditorViewport()"
    );
    expect(editorImplementationSource).toContain(
      "completedSaveViewport ?? pendingSaveViewport ?? viewport"
    );
    expect(editorImplementationSource).toContain(
      "const latest = captureCurrentEditorViewport()"
    );
    expect(editorImplementationSource).toContain('{ flush: "pre" }');
    expect(editorImplementationSource).toContain(
      "input.scrollTop = snapshot.scrollTop"
    );
    expect(editorImplementationSource).toContain(
      "currentEditorViewportKey() !== snapshot.documentKey"
    );
    expect(editorImplementationSource).toContain(
      "options.currentSelectionFile.value?.file.updatedAt"
    );
  });

  it("does not flash a read-only background or loading placeholder while refreshing a save", () => {
    expect(source).toContain(`:class="{ 'is-readonly': readOnly }"`);
    expect(source).not.toContain(
      `:class="{ 'is-readonly': readOnly || busy }"`
    );
    expect(editorImplementationSource).toContain("refreshingJustSavedDocument");
    expect(editorImplementationSource).toContain(
      "loaded: dirty || refreshingJustSavedDocument"
    );
    expect(editorSource).toContain("'is-readonly': currentReadOnly");
    expect(editorSource).not.toContain(
      "'is-readonly': currentReadOnly || isDocumentContentBusy"
    );
  });

  it("keeps the textarea mounted when an agent temporarily locks editing", () => {
    expect(source).toContain(`v-if="viewMode === 'edit'"`);
    expect(source).not.toContain(`v-if="viewMode === 'edit' && !readOnly"`);
    expect(source).toContain(':readonly="readOnly || busy"');
    expect(editorSource).toContain(`v-if="viewMode === 'edit'"`);
    expect(editorSource).not.toContain(
      `v-if="viewMode === 'edit' && !currentReadOnly"`
    );
    expect(editorSource).toContain(
      ':readonly="currentReadOnly || isDocumentContentBusy"'
    );
  });

  it("uses the persisted default mode while keeping read-only files in preview", () => {
    expect(editorSource).toContain("defaultViewMode: TextViewMode");
    expect(editorSource).toContain("defaultMode: () => props.defaultViewMode");
    expect(editorSource).toContain(
      "resetToDefault(Boolean(currentSelectionFile.value?.readOnly))"
    );
    expect(editorSource).toContain("() => props.defaultViewMode");
    expect(structureSelectionSource).toContain(
      "options.resetTextViewMode(selectedFile.readOnly)"
    );
  });
});
