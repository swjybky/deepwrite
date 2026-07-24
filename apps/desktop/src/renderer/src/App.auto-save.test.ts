import { describe, expect, it } from "vitest";
import source from "./App.vue?raw";

describe("App editor auto-save integration", () => {
  it("debounces live changes and uses the existing serialized persistence path", () => {
    expect(source).toContain("stageEditorDraft(rawPayload);");
    expect(source).toContain("scheduleEditorAutoSave(rawPayload.id);");
    expect(source).toContain("enqueueEditorSave(() => runEditorAutoSave(documentId))");
    expect(source).toContain("await persistEditorDocument(submittedPayload, false)");
  });

  it("wires the general setting to the editor and resumes recovered dirty drafts", () => {
    expect(source).toContain(':auto-save-enabled="editorAutoSaveEnabled"');
    expect(source).toContain('@update-auto-save="updateEditorAutoSave"');
    expect(source).toContain("scheduleDirtyEditorDraftsForAutoSave();");
    expect(source).toContain("cancelEditorAutoSave();");
  });
});
