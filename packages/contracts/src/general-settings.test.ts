import { describe, expect, it } from "vitest";
import {
  AppLanguageSchema,
  GeneralSettingsSchema,
  TextViewModeSchema,
  createDefaultGeneralSettings,
  maxTextAttachmentCharactersForBudget
} from "./general-settings";

describe("general settings contracts", () => {
  it("accepts both supported languages and rejects unknown values", () => {
    expect(AppLanguageSchema.parse("en-US")).toBe("en-US");
    expect(AppLanguageSchema.parse("zh-CN")).toBe("zh-CN");
    expect(AppLanguageSchema.parse("auto")).toBe("auto");
    expect(AppLanguageSchema.safeParse("fr-FR").success).toBe(false);
  });
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

  it("leaves task notifications off until the user turns them on", () => {
    expect(createDefaultGeneralSettings().taskNotification).toBe(false);
    const parsed = GeneralSettingsSchema.parse({
      permissionMode: "auto-approve",
      autoSave: true,
      language: "auto",
      showInMenuBar: true
    });
    expect(parsed.taskNotification).toBe(false);
    expect(
      GeneralSettingsSchema.parse({ ...parsed, taskNotification: true })
        .taskNotification
    ).toBe(true);
  });

  it("enables both automatic approval preferences by default", () => {
    expect(createDefaultGeneralSettings()).toMatchObject({
      permissionMode: "auto-approve",
      autoApproveCrossStageOperations: true
    });
  });

  it("defaults the attachment cutoff and rejects values above the message limit", () => {
    const defaults = createDefaultGeneralSettings();
    expect(defaults.textAttachmentMaxCharacters).toBe(100_000);
    expect(maxTextAttachmentCharactersForBudget(64_000)).toBe(57_600);
    expect(maxTextAttachmentCharactersForBudget(160_000)).toBe(144_000);
    expect(maxTextAttachmentCharactersForBudget(400_000)).toBe(200_000);
    expect(
      GeneralSettingsSchema.parse({
        ...defaults,
        contextCompaction: {
          ...defaults.contextCompaction,
          budgetTokens: 256_000
        },
        textAttachmentMaxCharacters: 150_000
      }).textAttachmentMaxCharacters
    ).toBe(150_000);
    expect(
      GeneralSettingsSchema.parse({
        ...defaults,
        contextCompaction: {
          ...defaults.contextCompaction,
          budgetTokens: 64_000
        }
      }).textAttachmentMaxCharacters
    ).toBe(57_600);
    expect(
      GeneralSettingsSchema.parse({
        ...defaults,
        textAttachmentMaxCharacters: 200_000
      }).textAttachmentMaxCharacters
    ).toBe(144_000);
    expect(
      GeneralSettingsSchema.safeParse({
        ...defaults,
        textAttachmentMaxCharacters: 200_001
      }).success
    ).toBe(false);
  });

  it("accepts only edit and preview text view modes", () => {
    expect(TextViewModeSchema.parse("preview")).toBe("preview");
    expect(TextViewModeSchema.safeParse("reader").success).toBe(false);
  });
});
