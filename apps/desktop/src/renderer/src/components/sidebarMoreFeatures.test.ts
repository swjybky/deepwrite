import { describe, expect, it } from "vitest";
import {
  MORE_FEATURE_IDS,
  createDefaultMoreFeaturesSettings
} from "@deepwrite/contracts/renderer";
import { configuredMoreFeatures, moreFeatures } from "./sidebarMoreFeatures";

describe("sidebar more features configuration", () => {
  it("covers every configurable feature in the default settings order", () => {
    expect(moreFeatures.map(({ id }) => id)).toEqual(
      MORE_FEATURE_IDS.filter((id) => id !== "agent-team-marketplace")
    );
  });

  it("retains hidden entries for settings and projects the chosen order for navigation", () => {
    const preferences = createDefaultMoreFeaturesSettings()
      .reverse()
      .map((entry) => ({ ...entry, visible: entry.id !== "chat-assistant" }));
    const configured = configuredMoreFeatures(preferences);
    expect(configured).toHaveLength(moreFeatures.length - 1);
    expect(configured.at(-1)).toMatchObject({
      id: "chat-assistant",
      visible: false,
      feature: { id: "chat-assistant" }
    });
    expect(
      configured
        .filter(({ visible }) => visible)
        .map(({ feature }) => feature.id)
    ).toEqual(
      preferences
        .filter(
          ({ visible, id }) =>
            visible && id !== "agent-team-marketplace" && id !== "cloud-backup"
        )
        .map(({ id }) => id)
    );
  });

  it("omits cloud backup even when it was enabled in saved preferences", () => {
    const preferences = [
      { id: "cloud-backup", visible: true },
      { id: "device-sync", visible: true }
    ] as const;
    expect(configuredMoreFeatures([...preferences])).toMatchObject([
      { id: "device-sync", visible: true }
    ]);
  });
  it("merges legacy marketplace visibility into one entry at the first marketplace position", () => {
    for (const skillVisible of [false, true]) {
      for (const teamVisible of [false, true]) {
        const configured = configuredMoreFeatures([
          { id: "agent-team-marketplace", visible: teamVisible },
          { id: "chat-assistant", visible: true },
          { id: "skill-marketplace", visible: skillVisible }
        ]);
        expect(configured.map(({ id }) => id)).toEqual([
          "skill-marketplace",
          "chat-assistant"
        ]);
        expect(configured[0]?.visible).toBe(skillVisible || teamVisible);
      }
    }
  });
});
