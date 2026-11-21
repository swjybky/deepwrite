import { describe, expect, it } from "vitest";
import type {
  LongBookSummary,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import type { AgentEditProposal } from "../types/conversation";
import {
  longApprovalCandidatesForBatch,
  resolveAgentEditApprovalTarget,
  resolveLongApprovalNavigation,
  resolveLongProposalApprovalTarget
} from "./approvalNavigation";

function proposal(patch: Partial<AgentEditProposal> = {}): AgentEditProposal {
  return {
    id: "proposal_test",
    runId: "run_test",
    workspaceId: "book_test",
    stageId: "draft",
    documentId: "document_test",
    title: "目标文稿",
    summary: "更新目标文稿",
    status: "accepted",
    baseRevision: "revision_before",
    proposedRevision: "revision_after",
    toolCallIds: ["tool_test"],
    additions: 1,
    deletions: 0,
    hunks: [],
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:01.000Z",
    ...patch
  };
}

describe("approval navigation target resolution", () => {
  it("targets ordinary documents and persisted library entries", () => {
    expect(resolveAgentEditApprovalTarget(proposal())).toEqual({
      kind: "document",
      workspaceId: "book_test",
      documentId: "document_test"
    });
    expect(
      resolveAgentEditApprovalTarget(
        proposal({
          stageId: "library",
          documentId: "material-entry:library_test:entry_test",
          libraryTarget: {
            operation: "create",
            domain: "material",
            libraryId: "library_test",
            stageId: "other",
            entryId: "entry_test"
          }
        })
      )
    ).toEqual({
      kind: "library",
      domain: "material",
      libraryId: "library_test",
      entryId: "entry_test",
      documentId: "material-entry:library_test:entry_test"
    });
  });

  it("uses the last created draft section and the parent for deletions", () => {
    expect(
      resolveAgentEditApprovalTarget(
        proposal({
          draftSectionCreationTarget: {
            sections: [
              {
                title: "第一节",
                wordCountRequirement: "",
                provisionalSectionId: "section_first",
                realSectionId: "section_real_first"
              },
              {
                title: "第二节",
                wordCountRequirement: "",
                provisionalSectionId: "section_second",
                realSectionId: "section_real_second"
              }
            ]
          }
        })
      )
    ).toMatchObject({
      kind: "draft-section",
      sectionId: "section_real_second",
      fileKind: "body"
    });
    expect(
      resolveAgentEditApprovalTarget(
        proposal({
          draftSectionDeletionTarget: {
            sectionId: "section_deleted",
            title: "已删除章节"
          }
        })
      )
    ).toEqual({
      kind: "draft-section",
      workspaceId: "book_test",
      fileKind: "body"
    });
  });

  it("targets created short-form character items and their parent after deletion", () => {
    expect(
      resolveAgentEditApprovalTarget(
        proposal({
          characterStructureTarget: {
            mutation: {
              type: "createItem",
              title: "新人物",
              itemId: "character_created"
            }
          }
        })
      )
    ).toEqual({
      kind: "character-item",
      workspaceId: "book_test",
      itemId: "character_created"
    });
    expect(
      resolveAgentEditApprovalTarget(
        proposal({
          characterStructureTarget: {
            mutation: {
              type: "deleteItem",
              itemId: "character_deleted"
            }
          }
        })
      )
    ).toEqual({
      kind: "character-item",
      workspaceId: "book_test"
    });
  });

  it("prefers the core profile for multi-file character cards", () => {
    const target = resolveAgentEditApprovalTarget(
      proposal({
        stageId: "long-character",
        longCharacterTarget: {
          bookId: "long_book",
          batch: {} as LongWorkspaceOperationBatch,
          files: [
            {
              characterId: "character_test",
              characterName: "测试人物",
              document: "relationships",
              fileId: "character_relationships",
              filePath: "characters/test/relationships.md",
              title: "人物关系",
              operation: "write",
              beforeText: "",
              afterText: "关系"
            },
            {
              characterId: "character_test",
              characterName: "测试人物",
              document: "core_profile",
              fileId: "character_core",
              filePath: "characters/test/core.md",
              title: "核心档案",
              operation: "write",
              beforeText: "",
              afterText: "核心"
            }
          ]
        }
      })
    );
    expect(target.kind).toBe("long");
    if (target.kind !== "long") return;
    expect(target.candidates[0]).toEqual({
      kind: "file",
      fileId: "character_core"
    });
  });

  it("prefers document writes as exact file targets before structure fallbacks", () => {
    const candidates = longApprovalCandidatesForBatch({
      updatedAt: "2026-08-14T00:00:00.000Z",
      operations: [
        {
          type: "storyPlot.update",
          id: "story_plot_one",
          patch: { title: "新标题" }
        }
      ],
      documentWrites: [
        {
          proposalId: "proposal_story_plot",
          fileId: "file_story_plot",
          content: "情节",
          mode: "replace",
          updatedAt: "2026-08-14T00:00:00.000Z",
          reason: "写入故事情节"
        }
      ]
    } as LongWorkspaceOperationBatch);
    expect(candidates[0]).toEqual({
      kind: "file",
      fileId: "file_story_plot"
    });
    expect(candidates).toContainEqual({
      kind: "story-plot",
      storyPlotId: "story_plot_one"
    });
  });

  it("orders surviving structure targets before deletion fallbacks", () => {
    const candidates = longApprovalCandidatesForBatch({
      updatedAt: "2026-08-14T00:00:00.000Z",
      operations: [
        { type: "chapter.delete", id: "chapter_deleted" },
        {
          type: "arc.update",
          id: "arc_surviving",
          patch: { title: "新标题" }
        }
      ],
      documentWrites: []
    } as LongWorkspaceOperationBatch);
    expect(candidates[0]).toEqual({
      kind: "arc",
      arcId: "arc_surviving"
    });
    expect(candidates).toContainEqual({ kind: "root", root: "plot_design" });
  });

  it("maps continuity cards to their first file and chapter fallback", () => {
    const item = {
      status: "accepted",
      approvalMode: "request-approval",
      event: {
        id: "event_test",
        type: "long.continuity_file_proposal",
        payload: {
          bookId: "long_book",
          files: [
            {
              fileId: "continuity_file",
              chapterCardId: "chapter_test"
            }
          ]
        }
      }
    } as unknown as LongWorkspaceProposalItem;
    const target = resolveLongProposalApprovalTarget(item);
    expect(target.kind).toBe("long");
    if (target.kind !== "long") return;
    expect(target.candidates.slice(0, 2)).toEqual([
      { kind: "file", fileId: "continuity_file" },
      {
        kind: "chapter-card",
        chapterCardId: "chapter_test",
        view: "continuity"
      }
    ]);
  });

  it("maps ledger finalization cards to the continuity chapter", () => {
    const item = {
      status: "accepted",
      approvalMode: "auto-approve",
      event: {
        id: "event_ledger",
        type: "long.ledger_commit_proposal",
        payload: {
          bookId: "long_book",
          input: { chapterCardId: "chapter_test" }
        }
      }
    } as unknown as LongWorkspaceProposalItem;

    expect(resolveLongProposalApprovalTarget(item)).toEqual({
      kind: "long",
      bookId: "long_book",
      candidates: [
        {
          kind: "chapter-card",
          chapterCardId: "chapter_test",
          view: "continuity"
        },
        { kind: "root", root: "continuity_ledger" }
      ]
    });
  });
});

describe("long approval navigation against the latest index", () => {
  const file = {
    id: "world_item_file",
    path: "world/rules/item.md",
    revision: "revision_world_item"
  };
  const summary = {
    id: "long_book",
    title: "测试长篇",
    navigation: {
      worldbuilding: [],
      characters: [],
      characterTypes: [],
      volumes: [],
      arcs: [],
      chapterCards: []
    }
  } as unknown as LongBookSummary;
  const index = {
    bookLine: {
      id: "book_line",
      path: "plot/book-line.md",
      revision: "revision_book_line"
    },
    characterOverview: null,
    characterTypes: [],
    characters: [],
    characterFiles: [],
    worldbuilding: [
      {
        id: "world_rules",
        title: "规则",
        order: 1,
        format: "list",
        overview: null,
        items: [
          {
            id: "world_item",
            title: "魔法规则",
            order: 1,
            file
          }
        ]
      }
    ],
    chapters: [],
    plot: {
      volumes: [],
      arcs: [],
      chapterCards: [],
      storyPlots: [],
      narrativePlacements: [],
      foreshadowing: []
    },
    ledger: { commits: [] }
  } as unknown as LongWorkspaceIndexSnapshot;

  it("resolves an exact worldbuilding file", () => {
    const resolved = resolveLongApprovalNavigation(
      {
        kind: "long",
        bookId: "long_book",
        candidates: [
          { kind: "file", fileId: file.id },
          { kind: "root", root: "worldbuilding" }
        ]
      },
      summary,
      index
    );
    expect(resolved?.selection.key).toBe("worldbuilding:world_rules");
    expect(resolved?.selection.worldbuildingItemId).toBe("world_item");
    expect(resolved?.selection.preferredFileId).toBe(file.id);
    expect(resolved?.focus).toEqual({ fileId: file.id });
    expect(resolved?.candidateIndex).toBe(0);
  });

  it("falls back to the requested parent when the exact file is gone", () => {
    const resolved = resolveLongApprovalNavigation(
      {
        kind: "long",
        bookId: "long_book",
        candidates: [
          { kind: "file", fileId: "missing_file" },
          { kind: "root", root: "worldbuilding" }
        ]
      },
      summary,
      index
    );
    expect(resolved?.selection.key).toBe("root:worldbuilding");
    expect(resolved?.candidateIndex).toBe(1);
  });

  it("focuses exact character files and keeps the character selected", () => {
    const characterFile = {
      id: "character_core",
      path: "characters/hero/core.md",
      revision: "revision_character_core"
    };
    const characterSummary = {
      ...summary,
      navigation: {
        ...summary.navigation,
        characters: [
          {
            id: "character_hero",
            name: "主角",
            group: "protagonist",
            order: 1
          }
        ]
      }
    } as unknown as LongBookSummary;
    const characterIndex = {
      ...index,
      characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
      characterFiles: [
        {
          characterId: "character_hero",
          coreProfile: characterFile,
          relationships: {
            id: "character_relationships",
            path: "characters/hero/relationships.md",
            revision: "revision_relationships"
          },
          currentState: {
            id: "character_state",
            path: "characters/hero/state.md",
            revision: "revision_state"
          },
          history: {
            id: "character_history",
            path: "characters/hero/history.md",
            revision: "revision_history"
          }
        }
      ]
    } as unknown as LongWorkspaceIndexSnapshot;
    const resolved = resolveLongApprovalNavigation(
      {
        kind: "long",
        bookId: "long_book",
        candidates: [
          { kind: "file", fileId: characterFile.id },
          { kind: "root", root: "character_design" }
        ]
      },
      characterSummary,
      characterIndex
    );
    expect(resolved?.selection.characterId).toBe("character_hero");
    expect(resolved?.selection.preferredFileId).toBe(characterFile.id);
    expect(resolved?.focus).toEqual({ fileId: characterFile.id });

    const staleCharacterSummary = {
      ...characterSummary,
      navigation: {
        ...characterSummary.navigation,
        characters: []
      }
    } as unknown as LongBookSummary;
    const staleResolved = resolveLongApprovalNavigation(
      {
        kind: "long",
        bookId: "long_book",
        candidates: [
          { kind: "file", fileId: characterFile.id },
          { kind: "root", root: "character_design" }
        ]
      },
      staleCharacterSummary,
      {
        ...characterIndex,
        characters: [
          {
            id: "character_hero",
            name: "主角",
            group: "protagonist",
            order: 1
          }
        ]
      } as unknown as LongWorkspaceIndexSnapshot
    );
    expect(staleResolved?.selection.characterId).toBe("character_hero");
    expect(staleResolved?.selection.preferredFileId).toBe(characterFile.id);
  });

  it("focuses chapter body and continuity files in their exact editor tabs", () => {
    const chapterBody = {
      id: "chapter_body",
      path: "draft/chapter.md",
      revision: "revision_chapter_body"
    };
    const handoff = {
      id: "chapter_handoff",
      path: "continuity/handoff.md",
      revision: "revision_handoff"
    };
    const chapterSummary = {
      ...summary,
      navigation: {
        ...summary.navigation,
        volumes: [{ id: "volume_one", title: "第一卷", order: 1 }],
        chapterCards: [
          {
            id: "chapter_one",
            title: "第一章",
            volumeId: "volume_one",
            narrativeOrder: 1
          }
        ]
      }
    } as unknown as LongBookSummary;
    const chapterIndex = {
      ...index,
      chapters: [
        {
          chapterCardId: "chapter_one",
          body: chapterBody,
          card: {
            id: "chapter_card",
            path: "plot/chapter-card.md",
            revision: "revision_chapter_card"
          },
          characterState: {
            id: "chapter_state",
            path: "continuity/state.md",
            revision: "revision_state"
          },
          handoff,
          foreshadowingChanges: {
            id: "chapter_foreshadowing",
            path: "continuity/foreshadowing.md",
            revision: "revision_foreshadowing"
          },
          worldReveals: null,
          characterContinuity: [],
          bodyStatus: "written",
          commitId: null
        }
      ],
      plot: {
        ...index.plot,
        volumes: [{ id: "volume_one", title: "第一卷", order: 1 }],
        chapterCards: [
          {
            id: "chapter_one",
            title: "第一章",
            volumeId: "volume_one",
            narrativeOrder: 1
          }
        ]
      }
    } as unknown as LongWorkspaceIndexSnapshot;
    const draft = resolveLongApprovalNavigation(
      {
        kind: "long",
        bookId: "long_book",
        candidates: [{ kind: "file", fileId: chapterBody.id }]
      },
      chapterSummary,
      chapterIndex
    );
    const continuity = resolveLongApprovalNavigation(
      {
        kind: "long",
        bookId: "long_book",
        candidates: [{ kind: "file", fileId: handoff.id }]
      },
      chapterSummary,
      chapterIndex
    );
    for (const candidate of [
      { kind: "file", fileId: "chapter_card" },
      { kind: "chapter-card", chapterCardId: "chapter_one", view: "card" }
    ] as const) {
      const result = resolveLongApprovalNavigation(
        { kind: "long", bookId: chapterSummary.id, candidates: [candidate] },
        chapterSummary,
        chapterIndex
      );
      expect(result).toMatchObject({
        selection: {
          key: "chapter:chapter_one",
          root: "draft",
          preferredFileId: "chapter_card"
        },
        focus: { fileId: "chapter_card" }
      });
    }
    expect(draft?.selection.key).toBe("chapter:chapter_one");
    expect(draft?.selection.preferredFileId).toBe(chapterBody.id);
    expect(continuity?.selection.key).toBe("continuity:chapter_one");
    expect(continuity?.selection.preferredFileId).toBe(handoff.id);
  });

  it("selects the exact volume for a structure proposal", () => {
    const volumeSummary = {
      ...summary,
      navigation: {
        ...summary.navigation,
        volumes: [{ id: "volume_one", title: "第一卷", order: 1 }]
      }
    } as unknown as LongBookSummary;
    const volumeIndex = {
      ...index,
      plot: {
        ...index.plot,
        volumes: [{ id: "volume_one", title: "第一卷", order: 1 }]
      }
    } as unknown as LongWorkspaceIndexSnapshot;
    const resolved = resolveLongApprovalNavigation(
      {
        kind: "long",
        bookId: "long_book",
        candidates: [{ kind: "volume", volumeId: "volume_one" }]
      },
      volumeSummary,
      volumeIndex
    );
    expect(resolved?.selection.key).toBe("plot-design:book-line");
    expect(resolved?.selection.bookLineVolumeId).toBe("volume_one");
    expect(resolved?.focus).toEqual({ bookLineVolumeId: "volume_one" });
  });

  it("resolves a chapter body from the index when book navigation is stale", () => {
    const chapterBody = {
      id: "chapter_body",
      path: "draft/chapter.md",
      revision: "revision_chapter_body"
    };
    const staleSummary = {
      ...summary,
      navigation: {
        ...summary.navigation,
        volumes: [],
        chapterCards: []
      }
    } as unknown as LongBookSummary;
    const chapterIndex = {
      ...index,
      chapters: [
        {
          chapterCardId: "chapter_one",
          body: chapterBody,
          card: {
            id: "chapter_card",
            path: "plot/chapter-card.md",
            revision: "revision_chapter_card"
          },
          characterState: {
            id: "chapter_state",
            path: "continuity/state.md",
            revision: "revision_state"
          },
          handoff: {
            id: "chapter_handoff",
            path: "continuity/handoff.md",
            revision: "revision_handoff"
          },
          foreshadowingChanges: {
            id: "chapter_foreshadowing",
            path: "continuity/foreshadowing.md",
            revision: "revision_foreshadowing"
          },
          worldReveals: null,
          characterContinuity: [],
          bodyStatus: "written",
          commitId: null
        }
      ],
      plot: {
        ...index.plot,
        volumes: [{ id: "volume_one", title: "第一卷", order: 1 }],
        chapterCards: [
          {
            id: "chapter_one",
            title: "第一章",
            volumeId: "volume_one",
            narrativeOrder: 1
          }
        ]
      }
    } as unknown as LongWorkspaceIndexSnapshot;
    const resolved = resolveLongApprovalNavigation(
      {
        kind: "long",
        bookId: "long_book",
        candidates: [
          { kind: "file", fileId: chapterBody.id },
          { kind: "root", root: "draft" }
        ]
      },
      staleSummary,
      chapterIndex
    );
    expect(resolved?.selection.key).toBe("chapter:chapter_one");
    expect(resolved?.selection.preferredFileId).toBe(chapterBody.id);
    expect(resolved?.candidateIndex).toBe(0);
  });

  it("keeps a worldbuilding category when the exact item is gone", () => {
    const resolved = resolveLongApprovalNavigation(
      {
        kind: "long",
        bookId: "long_book",
        candidates: [
          {
            kind: "worldbuilding",
            categoryId: "world_rules",
            itemId: "missing_item"
          },
          { kind: "root", root: "worldbuilding" }
        ]
      },
      summary,
      index
    );
    expect(resolved?.selection.key).toBe("worldbuilding:world_rules");
    expect(resolved?.selection.worldbuildingItemId).toBeNull();
    expect(resolved?.candidateIndex).toBe(0);
  });
});
