import { describe, expect, it } from "vitest";
import source from "./WorkspaceShell.vue?raw";
import featureModulesSource from "./components/WorkspaceFeatureModules.vue?raw";
import autoSaveSource from "./composables/useEditorAutoSaveCoordinator.ts?raw";
import featureHostCoordinatorSource from "./composables/useWorkspaceFeatureHostCoordinator.ts?raw";
import featureHostModuleSource from "./composables/workspaceFeatureHostModule.ts?raw";
import settingsFeatureModuleSource from "./composables/settingsFeatureModule.ts?raw";

const featureHostSource = `${featureHostCoordinatorSource}\n${featureHostModuleSource}\n${settingsFeatureModuleSource}`;

describe("App editor auto-save integration", () => {
  it("debounces live changes and uses the existing serialized persistence path", () => {
    expect(source).toContain("stageEditorDraft(rawPayload);");
    expect(source).toContain("scheduleEditorAutoSave(rawPayload.id);");
    expect(source).toContain("useEditorAutoSaveCoordinator({");
    expect(autoSaveSource).toContain("pendingTaskCount += 1");
    expect(autoSaveSource).toContain("await task();");
    expect(autoSaveSource).toContain("pendingTaskCount -= 1");
    expect(autoSaveSource).toContain("await notifyIdleIfNeeded()");
    expect(autoSaveSource).toContain(
      "await options.persist(submittedPayload, false)"
    );
    expect(source).toContain("manualSavingDocumentIds.value.has(");
    expect(autoSaveSource).toContain("manualSavingDocumentIds");
  });

  it("wires the general setting to the editor and resumes recovered dirty drafts", () => {
    expect(featureHostSource).toContain(
      "autoSaveEnabled: settingsStore.editorAutoSaveEnabled"
    );
    expect(featureModulesSource).toContain(
      ':auto-save-enabled="module.autoSaveEnabled"'
    );
    expect(source).toContain('@update-auto-save="updateEditorAutoSave"');
    expect(source).toContain(
      "scheduleDirtyDraftAutoSave: scheduleDirtyEditorDraftsForAutoSave"
    );
    expect(source).toContain("cancelAutoSave: cancelEditorAutoSave");
  });
});
