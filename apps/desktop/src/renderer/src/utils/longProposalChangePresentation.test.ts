import { describe, expect, it } from "vitest";
import {
  DEFAULT_LONG_CHARACTER_TYPES,
  LONG_BOOK_LINE_FILE_ID,
  LongWorkspaceIndexSnapshotSchema,
  createEmptyLongMarkdownFileReference,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  longCharacterCoreProfileFileId,
  longCharacterFilePath,
  longCharacterRelationshipsFileId,
  previewLongWorkspaceOperations
} from "@deepwrite/contracts/renderer";
import type { AgentEditProposal } from "../types/conversation";
import { proposalAcceptLabel } from "../components/agentEditProposalPresentation";
import { buildAgentTextDiff } from "./agentTextDiff";
import {
  buildLongProposalChangePresentation,
  formatLongImpactSnapshot,
  longProposalRequiresConfirmation
} from "./longProposalChangePresentation";

const NOW = "2026-11-17T08:00:00.000Z";

function buildTestIndex() {
  return LongWorkspaceIndexSnapshotSchema.parse({
    schemaVersion: 1,
    bookId: "longbook_test",
    updatedAt: NOW,
    bookLine: createEmptyLongMarkdownFileReference(
      LONG_BOOK_LINE_FILE_ID,
      "long/story/book-line.md",
      NOW
    ),
    worldbuilding: [],
    characterTypes: DEFAULT_LONG_CHARACTER_TYPES.map((item) => ({ ...item })),
    characters: [
      {
        id: "character_lin",
        name: "林晚",
        group: "protagonist",
        order: 1,
        aliases: ["阿晚"]
      },
      {
        id: "character_shen",
        name: "沈墨",
        group: "major_supporting",
        order: 1,
        aliases: []
      }
    ],
    characterFiles: [
      {
        characterId: "character_lin",
        coreProfile: createEmptyLongMarkdownFileReference(
          longCharacterCoreProfileFileId("character_lin"),
          longCharacterFilePath("character_lin", "core-profile.md"),
          NOW
        ),
        relationships: createEmptyLongMarkdownFileReference(
          longCharacterRelationshipsFileId("character_lin"),
          longCharacterFilePath("character_lin", "relationships.md"),
          NOW
        )
      },
      {
        characterId: "character_shen",
        coreProfile: createEmptyLongMarkdownFileReference(
          longCharacterCoreProfileFileId("character_shen"),
          longCharacterFilePath("character_shen", "core-profile.md"),
          NOW
        ),
        relationships: createEmptyLongMarkdownFileReference(
          longCharacterRelationshipsFileId("character_shen"),
          longCharacterFilePath("character_shen", "relationships.md"),
          NOW
        )
      }
    ],
    plot: {
      volumes: [
        {
          id: "volume_one",
          title: "第一卷：风雨欲来",
          order: 1,
          summary: "卷一摘要"
        },
        {
          id: "volume_two",
          title: "第二卷：山雨满楼",
          order: 2,
          summary: "卷二摘要"
        }
      ],
      arcs: [
        {
          id: "arc_old",
          volumeId: "volume_one",
          title: "暗桩初现",
          order: 1,
          outline: ""
        },
        {
          id: "arc_new",
          volumeId: "volume_one",
          title: "主线初开",
          order: 2,
          outline: ""
        }
      ],
      chapterCards: [
        {
          id: "chapter_one",
          volumeId: "volume_one",
          primaryArcId: "arc_old",
          title: "第一章：夜雨敲窗",
          narrativeOrder: 1
        },
        {
          id: "chapter_two",
          volumeId: "volume_one",
          primaryArcId: "arc_new",
          title: "第二章：孤灯夜话",
          narrativeOrder: 2
        }
      ],
      storyEvents: [
        {
          id: "event_one",
          title: "夜探码头",
          summary: "林晚潜入码头核对账册",
          timeMode: "exact",
          timeLabel: "初春十五夜",
          storyOrder: 1,
          location: "南港三号码头",
          arcIds: ["arc_old"],
          characterIds: ["character_lin"]
        },
        {
          id: "event_two",
          title: "密室对峙",
          summary: "沈墨亮出旧印",
          timeMode: "sequence",
          timeLabel: "",
          storyOrder: 2,
          location: "旧茶楼",
          arcIds: ["arc_new"],
          characterIds: ["character_shen"]
        }
      ],
      storyPlots: [],
      eventConnections: [],
      narrativePlacements: [],
      foreshadowing: [
        {
          id: "foreshadow_one",
          title: "玉佩来历",
          coreQuestion: "残缺玉佩究竟出自谁手？",
          hiddenTruth: "实为先代盐引信物",
          plannedSpan: "cross_volume",
          truthEventId: "event_two",
          expectedReaderEffect: "让读者误以为是普通信物",
          status: "planned",
          beats: [
            {
              id: "beat_one",
              type: "plant",
              order: 1,
              volumeId: "volume_one",
              arcId: "arc_new",
              eventId: "event_two",
              placementId: null,
              chapterCardId: "chapter_two",
              plannedScope: "第二章伏笔",
              note: "火光下露出一角缺口",
              status: "planned",
              commitId: null
            }
          ]
        }
      ]
    },
    chapters: [
      {
        chapterCardId: "chapter_one",
        body: createEmptyLongMarkdownFileReference(
          longChapterBodyFileId("chapter_one"),
          longChapterFilePath("chapter_one", "body.md"),
          NOW
        ),
        card: createEmptyLongMarkdownFileReference(
          longChapterCardFileId("chapter_one"),
          longChapterFilePath("chapter_one", "card.md"),
          NOW
        ),
        characterState: createEmptyLongMarkdownFileReference(
          longChapterCharacterStateFileId("chapter_one"),
          longChapterFilePath("chapter_one", "character-state.md"),
          NOW
        ),
        handoff: createEmptyLongMarkdownFileReference(
          longChapterHandoffFileId("chapter_one"),
          longChapterFilePath("chapter_one", "handoff.md"),
          NOW
        ),
        foreshadowingChanges: createEmptyLongMarkdownFileReference(
          longChapterForeshadowingChangesFileId("chapter_one"),
          longChapterContinuityFilePath(
            "chapter_one",
            "foreshadowing-changes.md"
          ),
          NOW
        ),
        worldReveals: null,
        characterContinuity: [],
        bodyStatus: "empty",
        commitId: "commit_one"
      },
      {
        chapterCardId: "chapter_two",
        body: createEmptyLongMarkdownFileReference(
          longChapterBodyFileId("chapter_two"),
          longChapterFilePath("chapter_two", "body.md"),
          NOW
        ),
        card: createEmptyLongMarkdownFileReference(
          longChapterCardFileId("chapter_two"),
          longChapterFilePath("chapter_two", "card.md"),
          NOW
        ),
        characterState: createEmptyLongMarkdownFileReference(
          longChapterCharacterStateFileId("chapter_two"),
          longChapterFilePath("chapter_two", "character-state.md"),
          NOW
        ),
        handoff: createEmptyLongMarkdownFileReference(
          longChapterHandoffFileId("chapter_two"),
          longChapterFilePath("chapter_two", "handoff.md"),
          NOW
        ),
        foreshadowingChanges: createEmptyLongMarkdownFileReference(
          longChapterForeshadowingChangesFileId("chapter_two"),
          longChapterContinuityFilePath(
            "chapter_two",
            "foreshadowing-changes.md"
          ),
          NOW
        ),
        worldReveals: null,
        characterContinuity: [],
        bodyStatus: "empty",
        commitId: null
      }
    ],
    ledger: {
      committedThroughChapterId: "chapter_one",
      commits: [
        {
          id: "commit_one",
          mode: "structured",
          sequence: 1,
          chapterCardId: "chapter_one",
          committedAt: NOW,
          placementIds: [],
          foreshadowingBeatIds: [],
          recordFile: {
            id: "file_commit_one:ledger",
            path: "long/continuity/commits/commit_one.json",
            updatedAt: NOW
          }
        }
      ],
      projection: {
        throughCommitId: null,
        facts: [],
        knowledge: [],
        openLoops: [],
        latestHandoff: null
      }
    }
  });
}

function basePlotProposal(
  patch: Partial<AgentEditProposal> & {
    target: NonNullable<AgentEditProposal["longPlotDesignTarget"]>;
  }
): AgentEditProposal {
  const { target, ...rest } = patch;
  const content = target.review?.content;
  const diff = content
    ? buildAgentTextDiff(content.beforeText, content.afterText)
    : { additions: 0, deletions: 0, hunks: [], truncated: false };
  return {
    id: "prop_plot",
    runId: "run_plot",
    workspaceId: `long:${target.bookId}`,
    stageId: "long-plot-design",
    documentId: target.review?.targetKey ?? "plot-design",
    title: target.review?.title ?? "第一章：夜雨敲窗 / 章卡",
    summary: "更新剧情",
    status: "pending",
    approvalMode: "request-approval",
    proposedText: content?.afterText ?? "更新剧情",
    toolCallIds: ["tool_plot"],
    additions: diff.additions,
    deletions: diff.deletions,
    hunks: diff.hunks,
    createdAt: NOW,
    updatedAt: NOW,
    longPlotDesignTarget: target,
    ...rest
  };
}

function assertNoProtocolLeak(text: string): void {
  expect(text).not.toContain("{");
  expect(text).not.toContain("}");
  expect(text).not.toContain("structureOperations");
  expect(text).not.toContain("documentWrites");
  expect(text).not.toContain("expectedSha256");
}

describe("longProposalChangePresentation", () => {
  it("renders real prose diff and semantic primary-arc transition for chapter card edits", () => {
    const index = buildTestIndex();
    const cardFileId = longChapterCardFileId("chapter_one");
    const proposal = basePlotProposal({
      target: {
        bookId: "longbook_test",
        batch: {
          updatedAt: NOW,
          operations: [
            {
              type: "chapter.move",
              id: "chapter_one",
              toVolumeId: "volume_one",
              toPrimaryArcId: "arc_new"
            }
          ],
          documentWrites: [
            {
              proposalId: "proposal_card_edit",
              mode: "replace",
              fileId: cardFileId,
              content:
                "## 本章目标\n- 林晚潜入码头拿到账册\n- 留下半块残缺玉佩",
              updatedAt: NOW,
              reason: "补充章卡冲突"
            }
          ]
        },
        review: {
          targetKey: `doc:${cardFileId}`,
          targetKind: "chapter_card",
          targetId: "chapter_one",
          action: "edit",
          title: "第一章：夜雨敲窗 / 章卡",
          content: {
            fileId: cardFileId,
            filePath: longChapterFilePath("chapter_one", "card.md"),
            operation: "write",
            beforeText: "## 本章目标\n- 林晚夜探码头",
            afterText: "## 本章目标\n- 林晚潜入码头拿到账册\n- 留下半块残缺玉佩"
          }
        }
      }
    });

    const presentation = buildLongProposalChangePresentation(proposal, index);
    expect(presentation.hasContentDiff).toBe(true);
    expect(presentation.contentLabel).toBe("章卡正文");
    expect(presentation.rows).toContainEqual({
      label: "主剧情点",
      value: "暗桩初现 → 主线初开"
    });
    expect(longProposalRequiresConfirmation(proposal)).toBe(false);
    expect(proposalAcceptLabel(proposal)).toBe("接受并保存");
    assertNoProtocolLeak(
      [
        presentation.contentLabel,
        ...presentation.rows.map((row) => `${row.label}:${row.value}`)
      ].join("\n")
    );
  });

  it("resolves same-run created volume and arc titles when creating a chapter card", () => {
    const index = buildTestIndex();
    const peerVolume = basePlotProposal({
      id: "prop_vol",
      target: {
        bookId: "longbook_test",
        batch: {
          updatedAt: NOW,
          operations: [
            {
              type: "volume.create",
              volume: {
                id: "volume_new",
                title: "第三卷：风云聚",
                order: 3,
                summary: "北方战事起"
              }
            }
          ],
          documentWrites: []
        }
      }
    });
    const peerArc = basePlotProposal({
      id: "prop_arc",
      target: {
        bookId: "longbook_test",
        batch: {
          updatedAt: NOW,
          operations: [
            {
              type: "arc.create",
              arc: {
                id: "arc_peer",
                volumeId: "volume_new",
                title: "新局起势",
                order: 1,
                outline: ""
              }
            }
          ],
          documentWrites: []
        }
      }
    });
    const cardFileId = longChapterCardFileId("chapter_three");
    const chapterCreate = basePlotProposal({
      id: "prop_chap_new",
      target: {
        bookId: "longbook_test",
        batch: {
          updatedAt: NOW,
          operations: [
            {
              type: "chapter.create",
              chapterCard: {
                id: "chapter_three",
                volumeId: "volume_new",
                primaryArcId: "arc_peer",
                title: "第十二章：北风渡",
                narrativeOrder: 1
              },
              files: {
                chapterCardId: "chapter_three",
                body: createEmptyLongMarkdownFileReference(
                  longChapterBodyFileId("chapter_three"),
                  longChapterFilePath("chapter_three", "body.md"),
                  NOW
                ),
                card: createEmptyLongMarkdownFileReference(
                  cardFileId,
                  longChapterFilePath("chapter_three", "card.md"),
                  NOW
                ),
                characterState: createEmptyLongMarkdownFileReference(
                  longChapterCharacterStateFileId("chapter_three"),
                  longChapterFilePath("chapter_three", "character-state.md"),
                  NOW
                ),
                handoff: createEmptyLongMarkdownFileReference(
                  longChapterHandoffFileId("chapter_three"),
                  longChapterFilePath("chapter_three", "handoff.md"),
                  NOW
                ),
                foreshadowingChanges: createEmptyLongMarkdownFileReference(
                  longChapterForeshadowingChangesFileId("chapter_three"),
                  longChapterContinuityFilePath(
                    "chapter_three",
                    "foreshadowing-changes.md"
                  ),
                  NOW
                ),
                worldReveals: null,
                characterContinuity: [],
                bodyStatus: "empty",
                commitId: null
              }
            }
          ],
          documentWrites: [
            {
              proposalId: "proposal_create_card",
              mode: "create",
              fileId: cardFileId,
              content: "## 开篇钩子\n风雪夜渡口交锋",
              updatedAt: NOW,
              reason: "写入新章卡"
            }
          ]
        },
        review: {
          targetKey: "create:chapter_three",
          targetKind: "chapter_card",
          targetId: "chapter_three",
          action: "create",
          title: "新建章卡 · 第十二章：北风渡",
          content: {
            fileId: cardFileId,
            filePath: longChapterFilePath("chapter_three", "card.md"),
            operation: "create",
            beforeText: "",
            afterText: "## 开篇钩子\n风雪夜渡口交锋"
          }
        }
      }
    });

    const presentation = buildLongProposalChangePresentation(
      chapterCreate,
      index,
      [peerVolume, peerArc, chapterCreate]
    );
    expect(presentation.hasContentDiff).toBe(true);
    expect(presentation.rows).toContainEqual({
      label: "所属分卷",
      value: "第三卷：风云聚"
    });
    expect(presentation.rows).toContainEqual({
      label: "主剧情点",
      value: "新局起势"
    });
    expect(presentation.rows).toContainEqual({
      label: "初始化文件",
      value: "正文、人物状态、交接、伏笔变化（空白模板）"
    });
    assertNoProtocolLeak(
      presentation.rows.map((row) => `${row.label}:${row.value}`).join("\n")
    );
  });

  it("shows added and removed characters and arcs for story event updates", () => {
    const index = buildTestIndex();
    const proposal = basePlotProposal({
      target: {
        bookId: "longbook_test",
        batch: {
          updatedAt: NOW,
          operations: [
            {
              type: "event.update",
              id: "event_one",
              patch: {
                arcIds: ["arc_new"],
                characterIds: ["character_shen"],
                location: "东港仓库",
                timeLabel: "次日黎明"
              }
            }
          ],
          documentWrites: []
        },
        review: {
          targetKey: "entity:event_one",
          targetKind: "story_event",
          targetId: "event_one",
          action: "meta",
          title: "故事事件 · 夜探码头"
        }
      }
    });

    const presentation = buildLongProposalChangePresentation(proposal, index);
    expect(presentation.hasContentDiff).toBe(false);
    expect(presentation.rows).toContainEqual({
      label: "新增剧情点",
      value: "主线初开"
    });
    expect(presentation.rows).toContainEqual({
      label: "移除剧情点",
      value: "暗桩初现",
      tone: "warning"
    });
    expect(presentation.rows).toContainEqual({
      label: "新增人物",
      value: "沈墨"
    });
    expect(presentation.rows).toContainEqual({
      label: "移除人物",
      value: "林晚",
      tone: "warning"
    });
    expect(presentation.rows).toContainEqual({
      label: "地点",
      value: "东港仓库"
    });
  });

  it("formats foreshadowing, placement, and chapter reorder semantically", () => {
    const index = buildTestIndex();
    const threadProp = basePlotProposal({
      target: {
        bookId: "longbook_test",
        batch: {
          updatedAt: NOW,
          operations: [
            {
              type: "foreshadowing.create",
              thread: {
                id: "foreshadow_two",
                title: "旧书批注",
                coreQuestion: "谁在页边留下暗号？",
                hiddenTruth: "已故掌柜",
                plannedSpan: "cross_volume",
                truthEventId: "event_two",
                expectedReaderEffect: "悬疑",
                status: "planned",
                beats: []
              }
            }
          ],
          documentWrites: []
        }
      }
    });
    expect(buildLongProposalChangePresentation(threadProp, index).rows).toEqual(
      [
        { label: "规划跨度", value: "跨卷" },
        { label: "真相事件", value: "密室对峙" }
      ]
    );

    const placementProp = basePlotProposal({
      target: {
        bookId: "longbook_test",
        batch: {
          updatedAt: NOW,
          operations: [
            {
              type: "placement.create",
              placement: {
                id: "placement_one",
                eventId: "event_one",
                chapterCardId: "chapter_two",
                orderInChapter: 1,
                mode: "flashback",
                disclosure: "hint",
                writingPrompt: "用茶杯裂纹切入回忆",
                status: "planned",
                commitId: null
              }
            }
          ],
          documentWrites: []
        }
      }
    });
    expect(
      buildLongProposalChangePresentation(placementProp, index).rows
    ).toEqual([
      { label: "所属章节", value: "第二章：孤灯夜话" },
      { label: "关联事件", value: "夜探码头" },
      { label: "叙事方式", value: "倒叙回溯" },
      { label: "披露程度", value: "隐晦提示" }
    ]);

    const reorderProp = basePlotProposal({
      target: {
        bookId: "longbook_test",
        batch: {
          updatedAt: NOW,
          operations: [
            {
              type: "chapter.reorder",
              volumeId: "volume_one",
              orderedIds: ["chapter_two", "chapter_one"]
            }
          ],
          documentWrites: []
        }
      }
    });
    expect(
      buildLongProposalChangePresentation(reorderProp, index).rows
    ).toEqual([
      { label: "所属分卷", value: "第一卷：风雨欲来" },
      { label: "顺序调整", value: "第二章：孤灯夜话 → 第一章：夜雨敲窗" }
    ]);
  });

  it("highlights deletions, cascaded unlinks, deleted files, and ledger cleanup", () => {
    const index = buildTestIndex();
    const batch: {
      updatedAt: string;
      operations: Array<{ type: "arc.delete"; id: "arc_old" }>;
      documentWrites: [];
    } = {
      updatedAt: NOW,
      operations: [{ type: "arc.delete", id: "arc_old" }],
      documentWrites: []
    };
    const simulated = previewLongWorkspaceOperations(index, batch).confirmation;
    const confirmation = {
      ...simulated,
      fileIntents: [
        {
          action: "delete" as const,
          file: {
            id: "file_arc_old",
            path: "long/plot/arcs/arc_old.md",
            updatedAt: NOW
          },
          reason: "移除失效文档"
        }
      ],
      ledgerRecordEdits: [
        {
          commitId: "commit_one",
          recordFile: {
            id: "file_commit_one:ledger",
            path: "long/continuity/commits/commit_one.json",
            updatedAt: NOW
          },
          removePlacementIds: [],
          removeForeshadowingBeatIds: ["beat_one"],
          reconcileForeshadowingThreadIds: ["foreshadow_one"],
          removeSubjectIds: [],
          removeKnowledgeAudienceIds: [],
          removeFactIds: [],
          removeFactKeys: [],
          removeKnowledgeKeys: [],
          removeOpenLoopIds: []
        }
      ]
    };
    const proposal = basePlotProposal({
      target: {
        bookId: "longbook_test",
        batch: {
          updatedAt: batch.updatedAt,
          operations: [...batch.operations],
          documentWrites: []
        },
        expectedImpact: confirmation,
        review: {
          targetKey: "delete:arc_old",
          targetKind: "arc",
          targetId: "arc_old",
          action: "delete",
          title: "删除剧情点 · 暗桩初现"
        }
      }
    });

    expect(longProposalRequiresConfirmation(proposal)).toBe(true);
    expect(proposalAcceptLabel(proposal)).toBe("确认并保存");

    const presentation = buildLongProposalChangePresentation(proposal, index);
    expect(presentation.hasContentDiff).toBe(false);
    expect(presentation.rows).toContainEqual({
      label: "删除对象",
      value: "剧情点 · 暗桩初现",
      tone: "danger"
    });
    expect(
      presentation.rows.some(
        (row) =>
          row.label === "关联调整" &&
          row.tone === "warning" &&
          row.value.includes("第一章：夜雨敲窗")
      )
    ).toBe(true);
    expect(
      presentation.rows.some(
        (row) =>
          row.label === "删除文件" &&
          row.tone === "danger" &&
          row.value.includes("long/plot/arcs/arc_old.md")
      )
    ).toBe(true);
    expect(
      presentation.rows.some(
        (row) =>
          row.label === "连续性台账" &&
          row.tone === "danger" &&
          row.value.includes("「第一章：夜雨敲窗」归档记录")
      )
    ).toBe(true);
  });

  it("formats entity snapshots without raw JSON for legacy impact details", () => {
    const index = buildTestIndex();
    const formatted = formatLongImpactSnapshot(
      {
        id: "chapter_one",
        title: "第一章：夜雨敲窗",
        volumeId: "volume_one",
        primaryArcId: "arc_new",
        updatedAt: NOW
      },
      index,
      "（无）"
    );
    expect(formatted).toContain("标题：第一章：夜雨敲窗");
    expect(formatted).toContain("所属分卷：第一卷：风雨欲来");
    expect(formatted).toContain("主剧情点：主线初开");
    expect(formatted).not.toContain(NOW);
    assertNoProtocolLeak(formatted);
  });
});
