import { describe, expect, it } from "vitest";
import type { WorkspaceDocument } from "../types/workspace";
import {
  activeAgentDocumentForSelection,
  agentConversationKeyForDocument,
  agentRunScopeForDocument,
  parseAgentRunPreferences
} from "./agentRunPreferences";

function workspaceDocument(
  workspaceId: string | undefined,
  stageId?: WorkspaceDocument["stageId"]
): WorkspaceDocument {
  return {
    id: `${workspaceId ?? "global"}:${stageId ?? "other"}`,
    domain: "creation",
    title: "文稿",
    eyebrow: "创作空间",
    path: ["文稿"],
    content: "",
    ...(workspaceId
      ? { workspaceId, workspaceType: "short" as const, workspaceTitle: "书籍" }
      : {}),
    ...(stageId ? { stageId } : {})
  };
}

describe("agent run preferences", () => {
  it("isolates both staged and uncategorized conversations by book", () => {
    const firstOther = workspaceDocument("book-one");
    const secondOther = workspaceDocument("book-two");
    const firstPlot = workspaceDocument("book-one", "plot_design");

    expect(agentConversationKeyForDocument(firstOther)).toBe("book-one:general");
    expect(agentConversationKeyForDocument(secondOther)).toBe("book-two:general");
    expect(agentConversationKeyForDocument(firstPlot)).toBe("book-one:plot_design");
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
      selectedModelId: "writer",
      thinkingLevel: "high",
      temperature: 0.7,
      approvalMode: "request-approval"
    } as const;

    expect(
      parseAgentRunPreferences(JSON.stringify({ [scope]: preference }))
    ).toEqual({ [scope]: preference });
    expect(
      parseAgentRunPreferences(
        JSON.stringify({ [`${scope}x`]: preference })
      )
    ).toEqual({});
  });

  it("keeps valid project-scoped model, thinking, temperature, and approval choices", () => {
    expect(
      parseAgentRunPreferences(
        JSON.stringify({
          "book:book-one": {
            selectedModelId: "writer",
            thinkingLevel: "high",
            temperature: 1.2,
            approvalMode: "auto-approve"
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
        selectedModelId: "writer",
        thinkingLevel: "high",
        temperature: 1.2,
        approvalMode: "auto-approve"
      },
      "book:book-two": {
        selectedModelId: "plain-writer",
        thinkingLevel: "off",
        temperature: 0.6,
        approvalMode: "request-approval"
      }
    });
  });

  it("drops malformed scopes without discarding valid project preferences", () => {
    expect(
      parseAgentRunPreferences(
        JSON.stringify({
          "book:valid": {
            selectedModelId: "writer",
            thinkingLevel: "custom-depth",
            temperature: 0.7,
            approvalMode: "request-approval"
          },
          "book:bad-temperature": {
            selectedModelId: "writer",
            thinkingLevel: "high",
            temperature: "0.7",
            approvalMode: "request-approval"
          },
          "book:bad-approval": {
            selectedModelId: "writer",
            thinkingLevel: "high",
            temperature: 0.7,
            approvalMode: "always"
          },
          "book:out-of-range-temperature": {
            selectedModelId: "writer",
            thinkingLevel: "high",
            temperature: 2.1,
            approvalMode: "request-approval"
          },
          "book:bad-thinking": {
            selectedModelId: "writer",
            thinkingLevel: "not valid",
            temperature: 0.7,
            approvalMode: "request-approval"
          }
        })
      )
    ).toEqual({
      "book:valid": {
        selectedModelId: "writer",
        thinkingLevel: "custom-depth",
        temperature: 0.7,
        approvalMode: "request-approval"
      }
    });
    expect(parseAgentRunPreferences("not-json")).toEqual({});
  });
});
