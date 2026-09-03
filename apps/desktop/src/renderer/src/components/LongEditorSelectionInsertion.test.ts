import { describe, expect, it } from "vitest";
import moduleSource from "./LongWorkspaceModule.vue?raw";
import editorSource from "./LongWorkspaceEditor.vue?raw";
import manuscriptSource from "./LongManuscriptEditor.vue?raw";
import menuSource from "./EditorSelectionMenu.vue?raw";
import pendingReferencesSource from "../composables/usePendingEditorReferences.ts?raw";

describe("long editor selection insertion", () => {
  it("offers the shared right-click action from every long-form text editor", () => {
    expect(
      editorSource.match(/@contextmenu="handleEditorContextMenu"/g)
    ).toHaveLength(3);
    expect(
      editorSource.match(/@contextmenu="handlePreviewContextMenu"/g)
    ).toHaveLength(2);
    expect(editorSource).toContain(
      '@preview-contextmenu="handlePreviewContextMenu"'
    );
    expect(manuscriptSource).toContain(
      "@contextmenu=\"emit('contextmenu', $event)\""
    );
    expect(manuscriptSource).toContain(
      "@contextmenu=\"emit('previewContextmenu', $event)\""
    );
    expect(editorSource).toContain("<EditorSelectionMenu");
    expect(menuSource).toContain("插入输入框");
    expect(editorSource).toContain('emit("insertSelection", reference)');
  });

  it("carries long-form selections through the composer and back to the editor", () => {
    expect(moduleSource).toContain(':editor-references="editorReferences"');
    expect(moduleSource).toContain('@insert-selection="insertEditorReference"');
    expect(moduleSource).toContain(
      '@clear-editor-references="clearEditorReferences"'
    );
    expect(moduleSource).toContain(
      '@remove-editor-reference="removeEditorReference"'
    );
    expect(moduleSource).toContain(
      '@locate-editor-reference="locateEditorReference"'
    );
    expect(editorSource).toContain("resolveEditorTextReferenceRange(");
    expect(editorSource).toContain(
      'input.setSelectionRange(range.start, range.end, "forward")'
    );
    expect(pendingReferencesSource).toContain("PROMPT_ATTACHMENT_MAX_ITEMS");
    expect(pendingReferencesSource).toContain("这段正文已经插入输入框");
  });
});
