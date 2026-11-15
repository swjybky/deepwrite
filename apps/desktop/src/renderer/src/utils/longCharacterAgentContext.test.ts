import { describe, expect, it } from "vitest";
import type { LongWorkspaceSelection } from "../types/longWorkspace";
import { buildLongCharacterFocusSnapshot } from "./longCharacterAgentContext";

const file = (id: string) => ({
  id: `file_${id}`,
  path: `long/test/${id}.md`,
  updatedAt: "2026-07-30T10:00:00.000Z"
});

function selection(): LongWorkspaceSelection {
  return {
    key: "character-group:protagonist",
    root: "character_design",
    characterGroup: "protagonist",
    characterId: "character_lan",
    title: "林岚",
    breadcrumbs: ["合成书", "人物", "主角", "林岚"],
    files: [
      { role: "core-profile", label: "核心档案", file: file("core") },
      { role: "relationships", label: "人物关系", file: file("relationships") }
    ],
    preferredRole: "core-profile"
  };
}

describe("long character agent context", () => {
  it.each([
    ["file_core", "core_profile", "核心档案"],
    ["file_relationships", "relationships", "人物关系"]
  ])(
    "captures %s as a location without manuscript text",
    (activeFileId, kind, title) => {
      expect(
        buildLongCharacterFocusSnapshot({
          selection: selection(),
          activeFileId
        })
      ).toEqual({
        characterId: "character_lan",
        characterName: "林岚",
        group: "protagonist",
        currentDocument: { kind, title }
      });
    }
  );

  it("captures a secondary document even when the core profile is not in the selection", () => {
    const current = selection();
    current.files.shift();
    expect(
      buildLongCharacterFocusSnapshot({
        selection: current,
        activeFileId: "file_relationships"
      })?.currentDocument.kind
    ).toBe("relationships");
  });

  it("captures the overview location and rejects stale files", () => {
    const current: LongWorkspaceSelection = {
      key: "character-overview",
      root: "character_design",
      title: "概览",
      breadcrumbs: ["合成书", "人物", "概览"],
      files: [{ role: "overview", label: "概览", file: file("overview") }],
      preferredRole: "overview"
    };
    expect(
      buildLongCharacterFocusSnapshot({
        selection: current,
        activeFileId: "file_overview"
      })
    ).toEqual({
      currentDocument: { kind: "overview", title: "概览" }
    });
    expect(
      buildLongCharacterFocusSnapshot({
        selection: current,
        activeFileId: "file_stale"
      })
    ).toBeUndefined();
  });
});
