import { parseAgentConversationPersistenceSnapshot as parseExtractedPersistenceSnapshot } from "./agent-conversation/persistence-snapshot";
import {
  createDeferredApi,
  createEditProposal,
  createEmptyLongMarkdownFileReference,
  createEnvelope,
  createMemoryStorage,
  createShortWorkspaceContentRevision,
  describe,
  document,
  eventOptions,
  expect,
  it,
  longCharacterCoreProfileFileId,
  longCharacterFilePath,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  runtime,
  useAgentConversation
} from "./useAgentConversation.test-support";

describe("agent conversation controller: proposal-persistence", () => {
  it("keeps a late evaluation snapshot after the run has already completed", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    controller.draft.value = "补齐评估历史";
    const sessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);
    const runId = "run_late_evaluation_history";
    deferred.resolveAccepted(0, {
      sessionId,
      runId,
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;
    controller.handleEvent(
      createEnvelope(
        "agent.message_completed",
        {
          sessionId,
          runId,
          messageId: `${runId}_assistant`,
          role: "assistant" as const,
          content: "本轮已完成。",
          runtime
        },
        eventOptions(sessionId, runId, "evt_late_eval_completed")
      )
    );
    controller.handleEvent(
      createEnvelope(
        "agent.evaluation_snapshot",
        {
          sessionId,
          runId,
          messageId: `${runId}_assistant`,
          runtime,
          snapshot: {
            schemaVersion: 1 as const,
            capturedAt: "2026-08-15T09:00:00.000Z",
            systemPrompt: "最终系统提示词",
            runtimeContext: {
              kind: "turn-context" as const,
              text: "补齐评估历史"
            },
            tools: [],
            conversationHistory: [
              { role: "user" as const, text: "补齐评估历史" },
              { role: "assistant" as const, text: "本轮已完成。" }
            ]
          }
        },
        eventOptions(sessionId, runId, "evt_late_eval_snapshot")
      )
    );

    expect(controller.messages.value.at(-1)).toMatchObject({
      status: "completed",
      evaluationSnapshot: {
        conversationHistory: [
          { role: "user", text: "补齐评估历史" },
          { role: "assistant", text: "本轮已完成。" }
        ]
      }
    });
    controller.dispose();
  });

  it("still persists conversation history when an evaluation snapshot cannot be cloned", () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-invalid-evaluation-snapshot-test";
    const controller = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    controller.messages.value = [
      {
        id: "user-keep-history",
        role: "user",
        content: "根据第一个大纲规划剧情点",
        createdAt: "2026-08-15T10:00:00.000Z",
        status: "completed"
      },
      {
        id: "assistant-invalid-eval",
        role: "assistant",
        content: "已创建剧情点",
        createdAt: "2026-08-15T10:00:01.000Z",
        status: "stopped",
        evaluationSnapshot: {
          schemaVersion: 1,
          capturedAt: "not-a-timestamp",
          systemPrompt: "系统提示词",
          runtimeContext: { kind: "turn-context", text: "用户消息" },
          tools: [],
          conversationHistory: [{ role: "assistant", text: "", toolName: "" }]
        } as never
      }
    ];
    controller.dispose();

    const restored = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    expect(restored.messages.value.map((message) => message.content)).toEqual([
      "根据第一个大纲规划剧情点",
      "已创建剧情点"
    ]);
    expect(restored.messages.value[1]?.evaluationSnapshot).toBeUndefined();
    restored.dispose({ clearPersistence: true });
  });

  it("clears persisted conversations when a project runtime is disposed", async () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-project-removal-test";
    const controller = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    controller.draft.value = "不应在删除项目后恢复";
    controller.dispose({ clearPersistence: true });
    await Promise.resolve();

    expect(storage.getItem(persistenceKey)).toBeNull();
    const restored = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    expect(restored.draft.value).toBe("");
    expect(restored.messages.value).toEqual([]);
    restored.dispose({ clearPersistence: true });
  });

  it("persists edit proposals and restores interrupted acceptance as pending", () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-edit-proposal-test";
    const controller = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    const interruptedProposal = createEditProposal({
      status: "accepting",
      truncated: true,
      statusMessage: "正在写入",
      laneId: "run_edit_1:short_story_1:draft:body",
      generation: 2,
      approvalMode: "auto-approve",
      predecessorProposalId: "proposal_0",
      sourceBaseRevision: "v1:5:22222222",
      decisionToken: "commit-token-2"
    });
    delete interruptedProposal.proposedText;
    controller.upsertEditProposal("run_edit_1", interruptedProposal);
    controller.dispose();

    const restored = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    expect(restored.getEditProposal("run_edit_1", "proposal_1")).toMatchObject({
      status: "pending",
      truncated: true,
      statusMessage: "正在写入",
      laneId: "run_edit_1:short_story_1:draft:body",
      generation: 2,
      approvalMode: "auto-approve",
      predecessorProposalId: "proposal_0",
      sourceBaseRevision: "v1:5:22222222",
      baseRevision: "v1:4:11111111",
      proposedRevision: "v1:5:22222222",
      decisionToken: "commit-token-2",
      hunks: [
        {
          lines: [
            { type: "deletion", text: "旧句" },
            { type: "addition", text: "新句" },
            { type: "context", text: "保留句" }
          ]
        }
      ]
    });
    expect(
      restored.getEditProposal("run_edit_1", "proposal_1")
    ).not.toHaveProperty("proposedText");
    expect(restored.hasPendingEditReview.value).toBe(true);
    restored.dispose();
  });

  it("rejects non-long persisted proposals without required revisions", () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-short-missing-revisions-test";
    const controller = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    const incompleteProposal = createEditProposal();
    delete incompleteProposal.baseRevision;
    delete incompleteProposal.proposedRevision;
    controller.upsertEditProposal("run_edit_1", incompleteProposal);
    controller.dispose();

    expect(
      parseExtractedPersistenceSnapshot(storage.getItem(persistenceKey))
    ).toBeUndefined();
    const restored = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    expect(
      restored.getEditProposal("run_edit_1", "proposal_1")
    ).toBeUndefined();
    restored.dispose({ clearPersistence: true });
  });

  it("preserves conflict state for persisted non-long proposals", () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-short-conflict-proposal-test";
    const controller = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    controller.upsertEditProposal(
      "run_edit_1",
      createEditProposal({
        status: "conflict",
        statusMessage: "文档版本冲突"
      })
    );
    controller.dispose();

    expect(
      parseExtractedPersistenceSnapshot(storage.getItem(persistenceKey))
        ?.conversations[0]?.messages[0]?.editProposals?.[0]
    ).toMatchObject({
      status: "conflict",
      statusMessage: "文档版本冲突"
    });
    const restored = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    expect(restored.getEditProposal("run_edit_1", "proposal_1")).toMatchObject({
      status: "conflict",
      statusMessage: "文档版本冲突"
    });
    restored.dispose({ clearPersistence: true });
  });

  it("persists safe-discard snapshots for accepted library overview edits", () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-edit-discard-snapshot-test";
    const controller = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    controller.upsertEditProposal(
      "run_edit_1",
      createEditProposal({
        stageId: "library",
        status: "accepted",
        proposedText: undefined,
        libraryTarget: {
          operation: "edit-overview",
          domain: "material",
          libraryId: "library-1"
        },
        discardSnapshot: {
          beforeText: "修改前的简介",
          beforeTitle: "资料库"
        },
        discardState: {
          status: "discarding",
          message: "正在舍弃",
          updatedAt: "2026-08-25T00:00:02.000Z"
        }
      })
    );
    controller.dispose();

    const restored = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    expect(restored.getEditProposal("run_edit_1", "proposal_1")).toMatchObject({
      libraryTarget: {
        operation: "edit-overview",
        domain: "material",
        libraryId: "library-1"
      },
      discardSnapshot: {
        beforeText: "修改前的简介",
        beforeTitle: "资料库"
      },
      discardState: {
        status: "error",
        message: "上次舍弃未确认完成；重试前会重新校验当前版本。"
      }
    });
    restored.dispose();
  });

  it("ignores legacy discard snapshots and states on long-form proposals", () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-long-discard-retirement-test";
    const controller = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    controller.upsertEditProposal(
      "run_edit_1",
      createEditProposal({
        stageId: "long-plot-design",
        workspaceId: "long:longbook_test",
        status: "accepted",
        proposedText: undefined,
        longPlotDesignTarget: {
          bookId: "longbook_test",
          batch: {
            updatedAt: "2026-08-25T00:00:00.000Z",
            operations: [{ type: "worldbuilding.delete", id: "world_rules" }],
            documentWrites: []
          }
        },
        discardSnapshot: {
          beforeText: "旧长篇内容",
          beforeTitle: "旧标题"
        },
        discardState: {
          status: "discarding",
          message: "旧版舍弃中",
          updatedAt: "2026-08-25T00:00:02.000Z"
        }
      })
    );
    controller.dispose();

    const restored = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    const proposal = restored.getEditProposal("run_edit_1", "proposal_1");
    expect(proposal).toMatchObject({
      stageId: "long-plot-design",
      longPlotDesignTarget: { bookId: "longbook_test" }
    });
    expect(proposal).not.toHaveProperty("discardSnapshot");
    expect(proposal).not.toHaveProperty("discardState");
    restored.dispose();
  });

  it("restores legacy long proposals after retiring version metadata", () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-legacy-long-proposal-test";
    const timestamp = "2026-08-25T00:00:00.000Z";
    const impactSummary = {
      createdEntityIds: [],
      updatedEntityIds: [],
      deletedEntityIds: [],
      createdFileIds: [],
      deletedFileIds: [],
      documentWriteProposalIds: ["proposal_legacy_body"]
    };
    const legacyProposal = {
      ...createEditProposal({
        workspaceId: "long:longbook_test",
        stageId: "long-draft",
        documentId: "file_chapter_test:body",
        title: "第一章 / 正文"
      }),
      sourceBaseRevision: 8,
      baseRevision: 8,
      proposedRevision: 9,
      status: "conflict",
      statusMessage:
        "long conflict: stale expected revision; 文稿版本已经变化。",
      longDraftTarget: {
        bookId: "longbook_test",
        baseProjectRevision: 8,
        appliedProjectRevision: 9,
        expectedImpact: impactSummary,
        rollbackSnapshot: { revision: 8 },
        rollbackSnapshots: [{ projectRevision: 8 }],
        longUndoBatch: { baseRevision: 8 },
        batch: {
          baseRevision: 8,
          updatedAt: timestamp,
          operations: [],
          documentWrites: [
            {
              proposalId: "proposal_legacy_body",
              fileId: "file_chapter_test:body",
              content: "新正文",
              mode: "replace",
              expectedRevision: "v2:8:bbbbbbbb",
              nextRevision: "v2:9:cccccccc",
              updatedAt: timestamp,
              reason: "旧版正文写入"
            }
          ],
          expectedImpact: impactSummary,
          reversible: true,
          undoBatch: { baseRevision: 8 },
          before: { revision: 8 },
          fileChanges: [{ nextRevision: "v2:9:cccccccc" }]
        },
        file: {
          chapterCardId: "chapter_test",
          chapterTitle: "第一章",
          fileId: "file_chapter_test:body",
          filePath: "long/chapters/chapter_test/body.md",
          operation: "edit",
          beforeText: "旧正文",
          afterText: "新正文",
          beforeRevision: "v2:8:bbbbbbbb",
          nextRevision: "v2:9:cccccccc",
          rollbackState: { revision: 8 }
        }
      },
      discardSnapshot: {
        beforeText: "旧正文",
        appliedProjectRevision: 9,
        longUndoBatch: { baseRevision: 8 }
      },
      discardState: {
        status: "discarding",
        message: "旧版舍弃中",
        updatedAt: timestamp
      }
    };
    const legacySnapshot = {
      version: 1,
      activeSessionId: "session_legacy_long",
      conversations: [
        {
          sessionId: "session_legacy_long",
          messages: [
            {
              id: "assistant_legacy_long",
              role: "assistant",
              content: "旧版长篇建议",
              createdAt: timestamp,
              runId: "run_edit_1",
              status: "completed",
              editProposals: [legacyProposal]
            }
          ],
          draft: "",
          approvalMode: "request-approval",
          createdAt: timestamp,
          updatedAt: timestamp,
          temperature: 0.7
        }
      ]
    };
    storage.setItem(persistenceKey, legacySnapshot);

    const parsedByExtractedParser =
      parseExtractedPersistenceSnapshot(legacySnapshot);
    const extractedProposal =
      parsedByExtractedParser?.conversations[0]?.messages[0]
        ?.editProposals?.[0];
    expect(extractedProposal).toMatchObject({
      stageId: "long-draft",
      status: "pending",
      longDraftTarget: { bookId: "longbook_test" }
    });
    expect(extractedProposal).not.toHaveProperty("sourceBaseRevision");
    expect(extractedProposal).not.toHaveProperty("baseRevision");
    expect(extractedProposal).not.toHaveProperty("proposedRevision");
    expect(extractedProposal).not.toHaveProperty("discardSnapshot");
    expect(extractedProposal).not.toHaveProperty("discardState");
    expect(extractedProposal).not.toHaveProperty("statusMessage");
    expect(
      extractedProposal?.longDraftTarget?.batch.documentWrites[0]
    ).not.toHaveProperty("expectedRevision");

    const restored = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    const proposal = restored.getEditProposal("run_edit_1", "proposal_1");
    expect(proposal).toMatchObject({
      stageId: "long-draft",
      status: "pending",
      longDraftTarget: {
        bookId: "longbook_test",
        batch: {
          documentWrites: [
            {
              proposalId: "proposal_legacy_body",
              content: "新正文",
              mode: "replace"
            }
          ]
        },
        file: {
          chapterCardId: "chapter_test",
          beforeText: "旧正文",
          afterText: "新正文"
        }
      }
    });
    expect(proposal).not.toHaveProperty("sourceBaseRevision");
    expect(proposal).not.toHaveProperty("baseRevision");
    expect(proposal).not.toHaveProperty("proposedRevision");
    expect(proposal).not.toHaveProperty("discardSnapshot");
    expect(proposal).not.toHaveProperty("discardState");
    expect(proposal).not.toHaveProperty("statusMessage");
    expect(proposal?.longDraftTarget).not.toHaveProperty("baseProjectRevision");
    expect(proposal?.longDraftTarget).not.toHaveProperty(
      "appliedProjectRevision"
    );
    expect(proposal?.longDraftTarget).not.toHaveProperty("expectedImpact");
    expect(proposal?.longDraftTarget).not.toHaveProperty("rollbackSnapshot");
    expect(proposal?.longDraftTarget).not.toHaveProperty("longUndoBatch");
    expect(proposal?.longDraftTarget?.batch).not.toHaveProperty("baseRevision");
    expect(proposal?.longDraftTarget?.batch).not.toHaveProperty(
      "expectedImpact"
    );
    expect(proposal?.longDraftTarget?.batch).not.toHaveProperty("reversible");
    expect(proposal?.longDraftTarget?.batch).not.toHaveProperty("undoBatch");
    expect(proposal?.longDraftTarget?.batch).not.toHaveProperty("before");
    expect(proposal?.longDraftTarget?.batch).not.toHaveProperty("fileChanges");
    expect(
      proposal?.longDraftTarget?.batch.documentWrites[0]
    ).not.toHaveProperty("expectedRevision");
    expect(
      proposal?.longDraftTarget?.batch.documentWrites[0]
    ).not.toHaveProperty("nextRevision");
    expect(proposal?.longDraftTarget?.file).not.toHaveProperty(
      "beforeRevision"
    );
    expect(proposal?.longDraftTarget?.file).not.toHaveProperty("nextRevision");
    expect(proposal?.longDraftTarget?.file).not.toHaveProperty("rollbackState");
    restored.dispose();
  });

  it("persists accepted draft section ids for dependent proposal recovery", () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-draft-section-mapping-test";
    const controller = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    controller.upsertEditProposal(
      "run_edit_1",
      createEditProposal({
        stageId: "draft",
        documentId: "draft-section-creation:proposal_1",
        title: "创建 1 个空白章节",
        status: "accepted",
        proposedText: undefined,
        draftSectionCreationTarget: {
          sections: [
            {
              title: "第一节",
              wordCountRequirement: "1200 字",
              provisionalSectionId: "pending:section:proposal_1:1",
              realSectionId: "section_real_1"
            }
          ],
          baseProjectRevision: 7,
          acceptedDirectoryRevision: "v1:12:1234abcd"
        }
      })
    );
    controller.dispose();

    const restored = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    expect(
      restored.getEditProposal("run_edit_1", "proposal_1")
        ?.draftSectionCreationTarget
    ).toEqual({
      sections: [
        {
          title: "第一节",
          wordCountRequirement: "1200 字",
          provisionalSectionId: "pending:section:proposal_1:1",
          realSectionId: "section_real_1"
        }
      ],
      baseProjectRevision: 7,
      acceptedDirectoryRevision: "v1:12:1234abcd"
    });
    restored.dispose();
  });

  it("persists draft section rename targets for the standard approval card", () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-draft-section-rename-test";
    const controller = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    controller.upsertEditProposal(
      "run_edit_1",
      createEditProposal({
        stageId: "draft",
        documentId: "draft-section-rename:proposal_1",
        title: "修改章节名称：旧名 → 新名",
        status: "pending",
        proposedText: "旧名 → 新名",
        draftSectionRenameTarget: {
          sectionId: "section-1",
          previousTitle: "旧名",
          title: "新名",
          baseProjectRevision: 3
        }
      })
    );
    controller.dispose();

    const restored = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    expect(
      restored.getEditProposal("run_edit_1", "proposal_1")
        ?.draftSectionRenameTarget
    ).toEqual({
      sectionId: "section-1",
      previousTitle: "旧名",
      title: "新名",
      baseProjectRevision: 3
    });
    restored.dispose();
  });

  it("persists draft section deletion targets for the standard approval card", () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-draft-section-deletion-test";
    const controller = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    controller.upsertEditProposal(
      "run_edit_1",
      createEditProposal({
        stageId: "draft",
        documentId: "draft-section-deletion:proposal_1",
        title: "删除章节：旧名",
        status: "pending",
        proposedText: "删除：旧名",
        draftSectionDeletionTarget: {
          sectionId: "section-1",
          title: "旧名",
          baseProjectRevision: 4
        }
      })
    );
    controller.dispose();

    const restored = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    expect(
      restored.getEditProposal("run_edit_1", "proposal_1")
        ?.draftSectionDeletionTarget
    ).toEqual({
      sectionId: "section-1",
      title: "旧名",
      baseProjectRevision: 4
    });
    restored.dispose();
  });

  it("persists long worldbuilding targets for the standard approval card", () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-long-worldbuilding-proposal-test";
    const file = createEmptyLongMarkdownFileReference(
      longWorldbuildingItemFileId("worlditem_memory"),
      longWorldbuildingItemContentPath("world_rules", "worlditem_memory"),
      "2026-07-30T12:00:00.000Z"
    );
    const controller = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    controller.upsertEditProposal(
      "run_edit_1",
      createEditProposal({
        workspaceId: "long:longbook_test",
        stageId: "long-worldbuilding",
        documentId: file.id,
        title: "记忆代价",
        proposedText: "",
        longWorldbuildingTarget: {
          bookId: "longbook_test",
          batch: {
            updatedAt: "2026-07-30T12:00:00.000Z",
            operations: [
              {
                type: "worldbuildingItem.create",
                categoryId: "world_rules",
                item: {
                  id: "worlditem_memory",
                  title: "记忆代价",
                  order: 1,
                  file
                }
              }
            ],
            documentWrites: []
          },
          file: {
            categoryId: "world_rules",
            itemId: "worlditem_memory",
            fileId: file.id,
            filePath: file.path,
            title: "记忆代价",
            operation: "create",
            beforeText: "",
            afterText: ""
          }
        }
      })
    );
    controller.dispose();

    const restored = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    expect(
      restored.getEditProposal("run_edit_1", "proposal_1")
        ?.longWorldbuildingTarget
    ).toMatchObject({
      bookId: "longbook_test",
      file: {
        itemId: "worlditem_memory",
        operation: "create"
      },
      batch: {
        operations: [{ type: "worldbuildingItem.create" }],
        documentWrites: []
      }
    });
    restored.dispose();
  });

  it("persists long character targets for the standard approval card", () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-long-character-proposal-test";
    const file = createEmptyLongMarkdownFileReference(
      longCharacterCoreProfileFileId("character_memory"),
      longCharacterFilePath("character_memory", "core-profile.md"),
      "2026-07-30T12:00:00.000Z"
    );
    const controller = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    controller.upsertEditProposal(
      "run_edit_1",
      createEditProposal({
        workspaceId: "long:longbook_test",
        stageId: "long-character",
        documentId: file.id,
        title: "林岚 / 核心档案",
        proposedText: "新的核心档案",
        longCharacterTarget: {
          bookId: "longbook_test",
          batch: {
            updatedAt: "2026-07-30T12:00:00.000Z",
            operations: [],
            documentWrites: [
              {
                proposalId: "proposal_character_memory",
                fileId: file.id,
                content: "新的核心档案",
                mode: "replace",
                updatedAt: "2026-07-30T12:00:00.000Z",
                reason: "更新人物核心档案"
              }
            ]
          },
          files: [
            {
              characterId: "character_memory",
              characterName: "林岚",
              document: "core_profile",
              fileId: file.id,
              filePath: file.path,
              title: "林岚 / 核心档案",
              operation: "edit",
              beforeText: "旧的核心档案",
              afterText: "新的核心档案"
            }
          ]
        }
      })
    );
    controller.dispose();

    const restored = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    expect(
      restored.getEditProposal("run_edit_1", "proposal_1")?.longCharacterTarget
    ).toMatchObject({
      bookId: "longbook_test",
      files: [
        {
          characterId: "character_memory",
          document: "core_profile",
          operation: "edit"
        }
      ]
    });
    restored.dispose();
  });

  it("persists long plot design targets for the standard approval card", () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-long-plot-design-proposal-test";
    const controller = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    controller.upsertEditProposal(
      "run_edit_1",
      createEditProposal({
        workspaceId: "long:longbook_test",
        stageId: "long-plot-design",
        documentId: "plot-design",
        title: "剧情设计变更",
        proposedText: "创建第二卷",
        longPlotDesignTarget: {
          bookId: "longbook_test",
          batch: {
            updatedAt: "2026-07-30T12:00:00.000Z",
            operations: [
              {
                type: "volume.create",
                volume: {
                  id: "volume_second",
                  title: "第二卷",
                  order: 2,
                  summary: "主角进入北境"
                }
              }
            ],
            documentWrites: []
          }
        }
      })
    );
    controller.dispose();

    const restored = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    expect(
      restored.getEditProposal("run_edit_1", "proposal_1")?.longPlotDesignTarget
    ).toMatchObject({
      bookId: "longbook_test",
      batch: {
        operations: [
          {
            type: "volume.create",
            volume: { id: "volume_second", title: "第二卷" }
          }
        ],
        documentWrites: []
      }
    });
    restored.dispose();
  });

  it("still persists a plot design proposal after accept clears proposedText", () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-long-plot-design-accept-test";
    const controller = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    controller.upsertEditProposal(
      "run_edit_1",
      createEditProposal({
        workspaceId: "long:longbook_test",
        stageId: "long-plot-design",
        documentId: "plot-design",
        title: "剧情设计变更",
        proposedText: "创建第二卷",
        longPlotDesignTarget: {
          bookId: "longbook_test",
          batch: {
            updatedAt: "2026-07-30T12:00:00.000Z",
            operations: [
              {
                type: "volume.create",
                volume: {
                  id: "volume_second",
                  title: "第二卷",
                  order: 2,
                  summary: "主角进入北境"
                }
              }
            ],
            documentWrites: []
          }
        }
      })
    );
    controller.updateEditProposal("run_edit_1", "proposal_1", {
      status: "accepted",
      proposedText: undefined,
      statusMessage: "已自动批准并保存剧情设计；conversion 已完成。"
    });
    expect(
      controller.capturePersistenceSnapshot().conversations[0]?.messages[0]
    ).toMatchObject({
      editProposals: [
        {
          status: "accepted",
          statusMessage: "已自动批准并保存剧情设计；conversion 已完成。",
          longPlotDesignTarget: { bookId: "longbook_test" }
        }
      ]
    });
    controller.dispose();

    const restored = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    expect(restored.getEditProposal("run_edit_1", "proposal_1")).toMatchObject({
      status: "accepted",
      statusMessage: "已自动批准并保存剧情设计；conversion 已完成。",
      longPlotDesignTarget: { bookId: "longbook_test" }
    });
    expect(
      restored.getEditProposal("run_edit_1", "proposal_1")?.proposedText
    ).toBeUndefined();
    restored.dispose();
  });

  it("persists the target metadata required to review a library creation", () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-library-proposal-test";
    const controller = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    controller.upsertEditProposal(
      "run_edit_1",
      createEditProposal({
        workspaceId: "library:material:library-1",
        stageId: "library",
        documentId: "library-create:tool-1",
        title: "人物甲",
        baseRevision: createShortWorkspaceContentRevision(""),
        proposedRevision: createShortWorkspaceContentRevision("人物素材"),
        proposedText: "人物素材",
        libraryTarget: {
          operation: "create",
          domain: "material",
          libraryId: "library-1",
          stageId: "character",
          baseProjectRevision: 3
        }
      })
    );
    controller.dispose();

    const restored = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    expect(restored.getEditProposal("run_edit_1", "proposal_1")).toMatchObject({
      stageId: "library",
      libraryTarget: {
        operation: "create",
        domain: "material",
        libraryId: "library-1",
        stageId: "character",
        baseProjectRevision: 3
      }
    });
    restored.dispose();
  });

  it("persists subagent details and restores interrupted child runs as stopped", () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-subagent-history-test";
    const controller = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    controller.messages.value = [
      {
        id: "assistant-subagent-history",
        role: "assistant",
        content: "",
        createdAt: "2026-07-24T02:00:00.000Z",
        runId: "run_subagent_history",
        status: "completed",
        subagentRuns: [
          {
            parentToolCallId: "spawn_history",
            subagentRunId: "subrun_history",
            subagentId: "researcher",
            name: "资料员",
            task: "检查旧设定",
            status: "running",
            runtime,
            thinking: "正在检查",
            output: "已经找到两条相关设定。",
            summary: "等待父智能体接收。",
            usage: {
              inputTokens: 30,
              outputTokens: 10,
              cacheReadTokens: 2,
              cacheWriteTokens: 0,
              totalTokens: 42
            },
            toolCalls: [
              {
                id: "subtool_history",
                name: "read_workspace_content",
                args: { stage: "outline" },
                status: "running",
                requestedAt: "2026-07-24T02:00:01.000Z"
              }
            ],
            processingSteps: [
              {
                id: "substep_history",
                type: "tool",
                toolCallId: "subtool_history",
                createdAt: "2026-07-24T02:00:01.000Z"
              }
            ],
            startedAt: "2026-07-24T02:00:00.000Z"
          }
        ]
      }
    ];
    controller.dispose();

    const restored = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    expect(restored.messages.value[0]?.subagentRuns?.[0]).toMatchObject({
      subagentRunId: "subrun_history",
      status: "stopped",
      thinking: "正在检查",
      output: "已经找到两条相关设定。",
      summary: "等待父智能体接收。",
      usage: { totalTokens: 42 },
      errorMessage: "应用关闭或对话恢复时，子任务仍在运行。",
      toolCalls: [
        {
          id: "subtool_history",
          status: "error",
          isError: true
        }
      ]
    });
    expect(
      restored.messages.value[0]?.subagentRuns?.[0]?.completedAt
    ).toBeTruthy();
    restored.dispose();
  });
});
