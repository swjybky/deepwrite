import { describe, expect, it } from "vitest";
import {
  draftCharacterStateTitle,
  suggestedDraftSectionTitle
} from "./draftFileTitles";

describe("draft file titles", () => {
  it("keeps character-state titles within the catalog limit", () => {
    expect(draftCharacterStateTitle("雨中的门")).toBe("雨中的门 · 状态");
  });

  it("suggests the next unused short-section or script-episode title", () => {
    expect(suggestedDraftSectionTitle("short", [])).toBe("第一节");
    expect(suggestedDraftSectionTitle("short", ["intro"])).toBe("第一节");
    expect(suggestedDraftSectionTitle("short", ["intro", "section-1"])).toBe(
      "第二节"
    );
    expect(
      suggestedDraftSectionTitle("short", ["intro", "section-1", "section-3"])
    ).toBe("第四节");
    expect(
      suggestedDraftSectionTitle("script", ["episode-1", "episode-2"])
    ).toBe("第三集");
  });
});
