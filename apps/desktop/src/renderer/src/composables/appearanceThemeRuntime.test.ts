import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppearanceSettingsSchema,
  createDefaultAppearanceSettings
} from "@deepwrite/contracts/renderer";
import {
  applyAppearanceThemeToDocument,
  sanitizeAppearanceTheme
} from "./appearanceThemeRuntime";

afterEach(() => vi.unstubAllGlobals());

describe("independent manuscript font size", () => {
  it("loads older settings without losing the existing UI size", () => {
    const defaults = createDefaultAppearanceSettings();
    const settings = AppearanceSettingsSchema.parse({
      ...defaults,
      light: { ...defaults.light, uiFontSize: 20, editorFontSize: undefined }
    });
    expect(settings.light.uiFontSize).toBe(20);
    expect(settings.light.editorFontSize).toBe(15);
  });

  it("validates font size bounds and rounds to half pixels", () => {
    const defaults = createDefaultAppearanceSettings();
    for (const value of [9, 41, NaN, Infinity]) {
      expect(
        AppearanceSettingsSchema.safeParse({
          ...defaults,
          light: { ...defaults.light, editorFontSize: value }
        }).success
      ).toBe(false);
      expect(
        sanitizeAppearanceTheme({ editorFontSize: value }, "light")
          .editorFontSize
      ).toBe(15);
    }
    expect(
      sanitizeAppearanceTheme({ editorFontSize: 22.3 }, "light").editorFontSize
    ).toBe(22.5);
  });

  it.each(["light", "dark"] as const)(
    "updates manuscript and UI sizes independently in %s mode",
    (scheme) => {
      const properties = new Map<string, string>();
      vi.stubGlobal("document", {
        documentElement: {
          dataset: {},
          style: {
            setProperty: (key: string, value: string) =>
              properties.set(key, value)
          }
        },
        querySelector: () => null
      });
      const settings = createDefaultAppearanceSettings();
      const input = { ...settings, scheme, theme: settings[scheme] };
      applyAppearanceThemeToDocument(input);
      applyAppearanceThemeToDocument({
        ...input,
        theme: { ...input.theme, editorFontSize: 24 }
      });
      expect(properties.get("--editor-font-size")).toBe("24px");
      expect(properties.get("--ui-font-size")).toBe("14px");
      applyAppearanceThemeToDocument({
        ...input,
        theme: { ...input.theme, editorFontSize: 24, uiFontSize: 20 }
      });
      expect(properties.get("--editor-font-size")).toBe("24px");
      expect(properties.get("--ui-font-size")).toBe("20px");
    }
  );
});
