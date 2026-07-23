import { describe, expect, it } from "vitest";
import source from "./useAppearance.ts?raw";

describe("useAppearance", () => {
  it("persists appearance through the desktop config API", () => {
    expect(source).toContain("window.deepwrite?.appearance");
    expect(source).toContain("api.save(");
    expect(source).toContain("api.list()");
    expect(source).toContain('LEGACY_STORAGE_KEY = "deepwrite.appearance.v1"');
    expect(source).toContain("clearLegacyStorage()");
  });

  it("migrates legacy localStorage settings when disk config is missing", () => {
    expect(source).toContain("if (!snapshot.persisted)");
    expect(source).toContain("await api.save(legacy.data)");
    expect(source).toContain("hydrateFromDesktop");
  });
});
