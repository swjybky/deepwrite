import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERAL_PREFERENCES,
  GENERAL_PREFERENCES_STORAGE_KEY,
  loadGeneralPreferences,
  parseGeneralPreferences,
  saveGeneralPreferences
} from "./generalPreferences";

describe("general preferences", () => {
  it("keeps manual saving as the default and rejects malformed values", () => {
    expect(parseGeneralPreferences(null)).toEqual(DEFAULT_GENERAL_PREFERENCES);
    expect(parseGeneralPreferences("not-json")).toEqual(DEFAULT_GENERAL_PREFERENCES);
    expect(parseGeneralPreferences(JSON.stringify({ version: 2, autoSave: true }))).toEqual(
      DEFAULT_GENERAL_PREFERENCES
    );
  });

  it("persists and reloads the auto-save choice", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };

    expect(saveGeneralPreferences(storage, { autoSave: true })).toBe(true);
    expect(values.get(GENERAL_PREFERENCES_STORAGE_KEY)).toBe(
      JSON.stringify({ version: 1, autoSave: true })
    );
    expect(loadGeneralPreferences(storage)).toEqual({ autoSave: true });
  });

  it("falls back safely when renderer storage is unavailable", () => {
    expect(
      loadGeneralPreferences({
        getItem: () => {
          throw new Error("storage disabled");
        }
      })
    ).toEqual(DEFAULT_GENERAL_PREFERENCES);
    expect(
      saveGeneralPreferences(
        {
          setItem: () => {
            throw new Error("storage full");
          }
        },
        { autoSave: true }
      )
    ).toBe(false);
  });
});
