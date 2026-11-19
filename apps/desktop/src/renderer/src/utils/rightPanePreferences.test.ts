import { describe, expect, it } from "vitest";
import {
  RIGHT_PANE_MAX_WIDTH,
  RIGHT_PANE_PREFERENCES_STORAGE_KEY,
  loadRightPanePreferences,
  parseRightPanePreferences,
  rightPanePreferenceKey,
  saveRightPanePreferences
} from "./rightPanePreferences";

describe("right pane preferences", () => {
  it("isolates widths by book and writing type", () => {
    for (const workspaceType of [
      "short",
      "script",
      "long",
      "academic",
      "mystery"
    ] as const) {
      expect(
        rightPanePreferenceKey({
          domain: "creation",
          workspaceType,
          workspaceId: "book-1"
        })
      ).toBe(`${workspaceType}:book:book-1`);
      expect(
        rightPanePreferenceKey({
          domain: "creation",
          workspaceType,
          workspaceId: "book-2"
        })
      ).toBe(`${workspaceType}:book:book-2`);
    }
  });

  it("rejects malformed or out-of-range stored widths", () => {
    expect(parseRightPanePreferences("not-json")).toEqual({ widths: {} });
    expect(
      parseRightPanePreferences(
        JSON.stringify({ version: 1, widths: { "short:worldbuilding": 200 } })
      )
    ).toEqual({ widths: {} });
    expect(
      parseRightPanePreferences(
        JSON.stringify({ version: 2, widths: { "short:worldbuilding": 480 } })
      )
    ).toEqual({ widths: {} });
    expect(
      parseRightPanePreferences(
        JSON.stringify({
          version: 1,
          widths: { "short:worldbuilding": RIGHT_PANE_MAX_WIDTH + 1 }
        })
      )
    ).toEqual({ widths: {} });
    expect(
      parseRightPanePreferences(
        JSON.stringify({
          version: 1,
          widths: { "short:worldbuilding": RIGHT_PANE_MAX_WIDTH }
        })
      )
    ).toEqual({ widths: { "short:worldbuilding": RIGHT_PANE_MAX_WIDTH } });
  });

  it("does not create preference keys without a creative book", () => {
    expect(
      rightPanePreferenceKey({
        domain: "material",
        workspaceType: "short",
        workspaceId: "book-1"
      })
    ).toBeUndefined();
    expect(
      rightPanePreferenceKey({
        domain: "creation",
        workspaceType: "short"
      })
    ).toBeUndefined();
  });

  it("persists and restores each book width", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };
    const preferences = {
      widths: {
        "short:book:book-1": 430,
        "short:book:book-2": 520,
        "long:book:book-1": 610,
        "script:book:book-1": 470
      }
    };

    expect(saveRightPanePreferences(storage, preferences)).toBe(true);
    expect(values.get(RIGHT_PANE_PREFERENCES_STORAGE_KEY)).toBe(
      JSON.stringify({ version: 1, widths: preferences.widths })
    );
    expect(loadRightPanePreferences(storage)).toEqual(preferences);
  });
});
