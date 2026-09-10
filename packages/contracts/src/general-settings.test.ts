import { describe, expect, it } from "vitest";
import {
  GeneralSettingsSchema,
  TextViewModeSchema,
  createDefaultGeneralSettings
} from "./general-settings";

describe("general settings contracts", () => {
  it("keeps edit as the default text view mode", () => {
    expect(createDefaultGeneralSettings().defaultTextViewMode).toBe("edit");
    expect(createDefaultGeneralSettings().useNetworkProxy).toBe(false);
    expect(
      GeneralSettingsSchema.parse({
        permissionMode: "request-approval",
        autoSave: false,
        language: "zh-CN",
        showInMenuBar: false
      })
    ).toMatchObject({
      autoApproveCrossStageOperations: true,
      showContextUsage: true,
      useNetworkProxy: false,
      workspacePaneLayout: "agent-editor",
      defaultTextViewMode: "edit"
    });
  });

  it("enables both automatic approval preferences by default", () => {
    expect(createDefaultGeneralSettings()).toMatchObject({
      permissionMode: "auto-approve",
      autoApproveCrossStageOperations: true
    });
  });

  it("accepts only edit and preview text view modes", () => {
    expect(TextViewModeSchema.parse("preview")).toBe("preview");
    expect(TextViewModeSchema.safeParse("reader").success).toBe(false);
  });
});
