import { describe, expect, it } from "vitest";
import { createDefaultAppearanceSettings } from "@deepwrite/contracts";
import {
  resolveNativeBackgroundColor,
  resolveNativeColorScheme
} from "./native-appearance-chrome";

describe("native-appearance-chrome", () => {
  it("resolves system mode from the OS preference", () => {
    const settings = createDefaultAppearanceSettings();
    expect(resolveNativeColorScheme(settings, true)).toBe("dark");
    expect(resolveNativeColorScheme(settings, false)).toBe("light");
  });

  it("uses the active scheme background for the native window chrome", () => {
    const settings = {
      ...createDefaultAppearanceSettings(),
      mode: "dark" as const,
      dark: {
        ...createDefaultAppearanceSettings().dark,
        background: "#17191C"
      }
    };
    expect(resolveNativeBackgroundColor(settings, false)).toBe("#17191C");
  });
});
