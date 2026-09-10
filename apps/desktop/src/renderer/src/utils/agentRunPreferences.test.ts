import { describe, expect, it } from "vitest";
import type { WorkspaceDocument } from "../types/workspace";
import {
  AGENT_MODEL_SELECTION_STORAGE_KEY,
  activeAgentDocumentForSelection,
  agentConversationKeyForDocument,
  agentRunScopeForDocument,
  parseAgentModelSelection,
  parseAgentRunPreferences
} from "./agentRunPreferences";

function workspaceDocument(
  workspaceId: string | undefined,
  stageId?: WorkspaceDocument["stageId"],
  workspaceType: "short" | "script" = "short"
): WorkspaceDocument {
  return {
    id: `${workspaceId ?? "global"}:${stageId ?? "other"}`,
    domain: "creation",
    title: "文稿",
    eyebrow: "创作空间",
    path: ["文稿"],
    content: "",
    ...(workspaceId
      ? { workspaceId, workspaceType, workspaceTitle: "书籍" }
      : {}),
    ...(stageId ? { stageId } : {})
  };
}

describe("agent run preferences", () => {
  it("keeps the global model and thinking selection in a dedicated persisted value", () => {
    expect(AGENT_MODEL_SELECTION_STORAGE_KEY).toBe(
      "deepwrite:agent-model-selection:v1"
    );
    expect(
      parseAgentModelSelection(
        JSON.stringify({ selectedModelId: "writer", thinkingLevel: "high" })
      )
    ).toEqual({ selectedModelId: "writer", thinkingLevel: "high" });
    expect(
      parseAgentModelSelection(
        JSON.stringify({
          selectedModelId: "writer",
          thinkingLevel: "high",
          webSearchEnabled: true
        })
      )
    ).toEqual({
      selectedModelId: "writer",
      thinkingLevel: "high",
      webSearchEnabled: true
    });
    expect(
      parseAgentModelSelection(
        JSON.stringify({
          selectedModelId: "writer",
          thinkingLevel: "not valid"
        })
      )
    ).toBeUndefined();
    expect(parseAgentModelSelection("not-json")).toBeUndefined();
  });

  it("shares one conversation across all stages and sections of each book", () => {
    const firstOther = workspaceDocument("book-one");
    const secondOther = workspaceDocument("book-two");
    const firstPlot = workspaceDocument("book-one", "plot_design");
    const shortDraftRoot = {
      ...workspaceDocument("book-one", "draft"),
      shortAgentId: "short" as const
    };
    const scriptDraftRoot = {
      ...workspaceDocument("script-one", "draft", "script"),
      shortAgentId: "script" as const
    };

    expect(agentConversationKeyForDocument(firstOther)).toBe("book-one:chat");
    expect(agentConversationKeyForDocument(secondOther)).toBe("book-two:chat");
    expect(agentConversationKeyForDocument(firstPlot)).toBe("book-one:chat");
    expect(
      agentConversationKeyForDocument(
        workspaceDocument("script-one", "plot_design", "script")
      )
    ).toBe("script-one:chat");
    expect(
      agentConversationKeyForDocument({
        ...shortDraftRoot,
        expertSectionId: "section-1"
      })
    ).toBe(agentConversationKeyForDocument(shortDraftRoot));
    expect(
      agentConversationKeyForDocument({
        ...shortDraftRoot,
        expertSectionId: "section-2"
      })
    ).toBe("book-one:chat");
    expect(
      agentConversationKeyForDocument({
        ...scriptDraftRoot,
        expertSectionId: "episode-1"
      })
    ).toBe(agentConversationKeyForDocument(scriptDraftRoot));
    expect(
      agentConversationKeyForDocument({
        ...scriptDraftRoot,
        expertSectionId: "episode-2"
      })
    ).toBe("script-one:chat");
    expect(
      agentConversationKeyForDocument({
        ...shortDraftRoot,
        workspaceId: "book-two",
        expertSectionId: "section-1"
      })
    ).toBe("book-two:chat");
    for (const stage of [
      "character_design",
      "plot_design",
      "intro_design",
      "plot_refine",
      "outline",
      "draft"
    ]) {
      expect(
        agentConversationKeyForDocument(workspaceDocument("book-one", stage))
      ).toBe("book-one:chat");
      expect(
        agentConversationKeyForDocument(
          workspaceDocument("script-one", stage, "script")
        )
      ).toBe("script-one:chat");
    }
    expect(agentRunScopeForDocument(firstOther)).toBe("book:book-one");
    expect(agentRunScopeForDocument(secondOther)).toBe("book:book-two");
    expect(agentConversationKeyForDocument(workspaceDocument(undefined))).toBe(
      "general"
    );
  });

  it("shares one management conversation inside a library and isolates domains", () => {
    const materialEntry: WorkspaceDocument = {
      id: "material-entry-1",
      domain: "material",
      title: "素材一",
      eyebrow: "素材",
      path: ["素材库", "素材一"],
      content: "",
      libraryId: "shared-library",
      catalogEntryId: "entry-1"
    };
    const secondMaterialEntry: WorkspaceDocument = {
      ...materialEntry,
      id: "material-entry-2",
      catalogEntryId: "entry-2"
    };
    const skillEntry: WorkspaceDocument = {
      ...materialEntry,
      id: "skill-entry-1",
      domain: "skill"
    };

    expect(agentConversationKeyForDocument(materialEntry)).toBe(
      "library:material:shared-library"
    );
    expect(agentConversationKeyForDocument(secondMaterialEntry)).toBe(
      "library:material:shared-library"
    );
    expect(agentConversationKeyForDocument(skillEntry)).toBe(
      "library:skill:shared-library"
    );
    expect(agentRunScopeForDocument(materialEntry)).toBe(
      "library:material:shared-library"
    );
    const activeBookDocument = workspaceDocument("book-one", "outline");
    expect(
      activeAgentDocumentForSelection(materialEntry, activeBookDocument)
    ).toBe(materialEntry);
    expect(
      activeAgentDocumentForSelection(
        workspaceDocument("book-two", "plot_design"),
        activeBookDocument
      )
    ).toBe(activeBookDocument);
  });

  it("accepts the longest valid book-scoped preference key", () => {
    const scope = `book:${"b".repeat(512)}`;
    const preference = {
      temperature: 0.7,
      approvalMode: "request-approval"
    } as const;

    expect(
      parseAgentRunPreferences(JSON.stringify({ [scope]: preference }))
    ).toEqual({
      [scope]: { ...preference, agentTeamMode: "normal" }
    });
    expect(
      parseAgentRunPreferences(JSON.stringify({ [`${scope}x`]: preference }))
    ).toEqual({});
  });

  it("keeps project-scoped temperature, approval and team choices", () => {
    expect(
      parseAgentRunPreferences(
        JSON.stringify({
          "book:book-one": {
            selectedModelId: "writer",
            thinkingLevel: "high",
            temperature: 1.2,
            approvalMode: "auto-approve",
            agentTeamMode: "team"
          },
          "book:book-two": {
            selectedModelId: "plain-writer",
            thinkingLevel: "off",
            temperature: 0.6,
            approvalMode: "request-approval"
          }
        })
      )
    ).toEqual({
      "book:book-one": {
        temperature: 1.2,
        approvalMode: "auto-approve",
        agentTeamMode: "team"
      },
      "book:book-two": {
        temperature: 0.6,
        approvalMode: "request-approval",
        agentTeamMode: "normal"
      }
    });
  });

  it("drops malformed scopes without discarding valid project preferences", () => {
    expect(
      parseAgentRunPreferences(
        JSON.stringify({
          "book:valid": {
            temperature: 0.7,
            approvalMode: "request-approval"
          },
          "book:bad-temperature": {
            temperature: "0.7",
            approvalMode: "request-approval"
          },
          "book:bad-approval": {
            temperature: 0.7,
            approvalMode: "always"
          },
          "book:bad-team-mode": {
            temperature: 0.7,
            approvalMode: "request-approval",
            agentTeamMode: "automatic"
          },
          "book:out-of-range-temperature": {
            temperature: 2.1,
            approvalMode: "request-approval"
          }
        })
      )
    ).toEqual({
      "book:valid": {
        temperature: 0.7,
        approvalMode: "request-approval",
        agentTeamMode: "normal"
      }
    });
    expect(parseAgentRunPreferences("not-json")).toEqual({});
  });
});
