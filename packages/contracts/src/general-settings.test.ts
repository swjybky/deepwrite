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
      autoApproveCrossStageOperations: false,
      showContextUsage: true,
      useNetworkProxy: false,
      workspacePaneLayout: "agent-editor",
      defaultTextViewMode: "edit"
    });
  });

  it("accepts only edit and preview text view modes", () => {
    expect(TextViewModeSchema.parse("preview")).toBe("preview");
    expect(TextViewModeSchema.safeParse("reader").success).toBe(false);
  });
});
