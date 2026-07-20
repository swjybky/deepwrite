import { describe, expect, it } from "vitest";
import source from "./SettingsPage.vue?raw";

describe("SettingsPage appearance controls", () => {
  it("lets users replace a font-size value and previews valid input immediately", () => {
    expect(source).toContain('@input="previewFontSize(\'uiFontSize\', $event)"');
    expect(source).toContain('@change="commitFontSize(\'uiFontSize\', $event)"');
    expect(source).not.toContain("restoreEmptyFontSize");
  });

  it("previews valid typed colors and validates incomplete values on commit", () => {
    expect(source).toContain('@input="previewColor(\'background\', $event)"');
    expect(source).toContain('@change="commitColor(\'background\', $event)"');
    expect(source).toContain("appearance.updateTheme(editingScheme.value, { preset: \"custom\" })");
  });
});
