import { describe, expect, it } from "vitest";
import {
  GeneralSettingsSchema,
  createDefaultGeneralSettings
} from "./general-settings";
import {
  MoreFeaturesSettingsSchema,
  createDefaultMoreFeaturesSettings
} from "./more-features-settings";

describe("more features settings", () => {
  it("shows only the six default features in order, including older settings", () => {
    const { moreFeatures: _, ...legacy } = createDefaultGeneralSettings();
    const defaults = createDefaultMoreFeaturesSettings();
    expect(GeneralSettingsSchema.parse(legacy).moreFeatures).toEqual(defaults);
    expect(
      defaults.filter(({ visible }) => visible).map(({ id }) => id)
    ).toEqual([
      "chat-assistant",
      "skill-marketplace",
      "agent-team-marketplace",
      "short-book-analysis",
      "long-book-analysis",
      "device-sync"
    ]);
    expect(MoreFeaturesSettingsSchema.parse(defaults)).toEqual(defaults);
  });

  it("preserves configured order and hidden features and appends missing features with their defaults", () => {
    const preferences = [
      { id: "device-sync", visible: false },
      { id: "book-identity", visible: true }
    ];
    const parsed = MoreFeaturesSettingsSchema.parse(preferences);
    expect(parsed.slice(0, 2)).toEqual(preferences);
    expect(parsed.slice(2)).toEqual(
      createDefaultMoreFeaturesSettings().filter(
        ({ id }) => id !== "device-sync" && id !== "book-identity"
      )
    );
  });

  it("allows hiding all features and keeps the full configuration available", () => {
    const hidden = createDefaultMoreFeaturesSettings().map((entry) => ({
      ...entry,
      visible: false
    }));
    expect(MoreFeaturesSettingsSchema.parse(hidden)).toEqual(hidden);
  });

  it("rejects duplicates, unknown features and invalid visibility values", () => {
    for (const preferences of [
      [
        { id: "chat-assistant", visible: true },
        { id: "chat-assistant", visible: false }
      ],
      [{ id: "unknown-feature", visible: true }],
      [{ id: "chat-assistant", visible: "false" }]
    ]) {
      expect(MoreFeaturesSettingsSchema.safeParse(preferences).success).toBe(
        false
      );
    }
  });
});
