import {
  FIXED_NOW,
  createEmptyLongMarkdownFileReference,
  createFixture,
  describe,
  expect,
  it,
  join,
  longChapterCharacterContinuityFilePath,
  longChapterCharacterCurrentStateFileId,
  longChapterCharacterHistoryFileId,
  longChapterContinuityFilePath,
  longChapterWorldRevealsFileId,
  longCharacterCoreProfileFileId,
  longCharacterCurrentStateFileId,
  longCharacterFilePath,
  longCharacterHistoryFileId,
  longCharacterRelationshipsFileId,
  readFile
} from "./long-project-store.test-support";

describe("LongProjectStore: continuity file lifecycle", () => {
  it("commits a chapter without adding foreshadowing output when no overview touchpoint applies", async () => {
    const { projectStore, created } = await createFixture(
      "text-file-no-foreshadowing"
    );
    const chapter = created.book.workspaceIndex.chapters[0]!;
    const contents = [
      [chapter.body, "第一章正文没有触及任何已规划伏笔。"],
      [chapter.characterState, "章末状态保持稳定。"],
      [chapter.handoff, "下一章从日常行程继续。"]
    ] as const;
    const written = await projectStore.applyWorkspaceOperations(
      created.projectDirectory,
      {
        batch: {
          updatedAt: FIXED_NOW,
          operations: [],
          documentWrites: contents.map(([reference, content], index) => ({
            proposalId: `proposal_no_foreshadowing_${index}`,
            fileId: reference.id,
            mode: "replace" as const,
            updatedAt: FIXED_NOW,
            content,
            reason: "写入无伏笔章节的连续性文件"
          }))
        }
      }
    );
    const writtenChapter = written.book.workspaceIndex.chapters[0]!;
    const committed = await projectStore.commitChapter(
      created.projectDirectory,
      {
        mode: "text_files",
        chapterCardId: writtenChapter.chapterCardId,
        foreshadowingBeatDecisions: {},
        commitMessage: "归档无既有伏笔触点的章节"
      }
    );

    expect(committed.record.foreshadowingBeatChanges).toEqual([]);
    expect(committed.record.foreshadowingThreadChanges).toEqual([]);
    expect(
      committed.record.continuityFiles.map(({ fileId }) => fileId)
    ).toEqual([writtenChapter.characterState.id, writtenChapter.handoff.id]);
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: writtenChapter.foreshadowingChanges.id
      })
    ).resolves.toMatchObject({ content: "" });

    await expect(
      projectStore.writeDocument(created.projectDirectory, {
        fileId: writtenChapter.characterState.id,
        content: "提交后仍可直接修订章末状态。"
      })
    ).rejects.toThrow("已提交的连续性文件为只读");
  });

  it("protects committed continuity files until the record is deleted", async () => {
    const { projectStore, created } = await createFixture(
      "text-file-continuity"
    );
    const chapterCardId = created.book.workspaceIndex.plot.chapterCards[0]!.id;
    const arcId = created.book.workspaceIndex.plot.arcs[0]!.id;
    const characterId = "character_linlan";
    const characterFiles = {
      characterId,
      coreProfile: createEmptyLongMarkdownFileReference(
        longCharacterCoreProfileFileId(characterId),
        longCharacterFilePath(characterId, "core-profile.md"),
        FIXED_NOW
      ),
      relationships: createEmptyLongMarkdownFileReference(
        longCharacterRelationshipsFileId(characterId),
        longCharacterFilePath(characterId, "relationships.md"),
        FIXED_NOW
      ),
      currentState: createEmptyLongMarkdownFileReference(
        longCharacterCurrentStateFileId(characterId),
        longCharacterFilePath(characterId, "current-state.md"),
        FIXED_NOW
      ),
      history: createEmptyLongMarkdownFileReference(
        longCharacterHistoryFileId(characterId),
        longCharacterFilePath(characterId, "history.md"),
        FIXED_NOW
      )
    };
    const worldReveals = createEmptyLongMarkdownFileReference(
      longChapterWorldRevealsFileId(chapterCardId),
      longChapterContinuityFilePath(chapterCardId, "world-reveals.md"),
      FIXED_NOW
    );
    const characterCurrentState = createEmptyLongMarkdownFileReference(
      longChapterCharacterCurrentStateFileId(chapterCardId, characterId),
      longChapterCharacterContinuityFilePath(
        chapterCardId,
        characterId,
        "current-state.md"
      ),
      FIXED_NOW
    );
    const characterHistory = createEmptyLongMarkdownFileReference(
      longChapterCharacterHistoryFileId(chapterCardId, characterId),
      longChapterCharacterContinuityFilePath(
        chapterCardId,
        characterId,
        "history.md"
      ),
      FIXED_NOW
    );

    const withContinuityFiles = await projectStore.applyWorkspaceOperations(
      created.projectDirectory,
      {
        batch: {
          updatedAt: FIXED_NOW,
          operations: [
            {
              type: "character.create",
              character: {
                id: characterId,
                name: "林岚",
                group: "protagonist",
                order: 1,
                aliases: []
              },
              files: characterFiles
            },
            {
              type: "event.create",
              event: {
                id: "event_text_continuity",
                title: "收到旧信",
                summary: "林岚在雨夜收到无法烧毁的信。",
                timeMode: "sequence",
                timeLabel: "第一天",
                storyOrder: 1,
                location: "林岚家",
                arcIds: [arcId],
                characterIds: [characterId]
              }
            },
            {
              type: "placement.create",
              placement: {
                id: "placement_text_continuity",
                eventId: "event_text_continuity",
                chapterCardId,
                orderInChapter: 1,
                mode: "scene",
                disclosure: "hint",
                writingPrompt: "在雨夜呈现来信。",
                status: "planned",
                commitId: null
              }
            },
            {
              type: "foreshadowing.create",
              thread: {
                id: "foreshadow_text_continuity",
                title: "寄信人身份",
                coreQuestion: "谁寄出了旧信？",
                truthEventId: "event_text_continuity",
                expectedReaderEffect: "产生怀疑。",
                status: "planned",
                beats: [
                  {
                    id: "beat_text_continuity",
                    type: "plant",
                    order: 1,
                    eventId: "event_text_continuity",
                    placementId: "placement_text_continuity",
                    chapterCardId,
                    plannedScope: "",
                    note: "首次出现。",
                    status: "planned",
                    commitId: null
                  }
                ]
              }
            },
            {
              type: "chapterContinuity.worldReveals.create",
              chapterCardId,
              file: worldReveals
            },
            {
              type: "chapterContinuity.character.create",
              chapterCardId,
              characterId,
              currentState: characterCurrentState,
              history: characterHistory
            }
          ],
          documentWrites: []
        }
      }
    );
    const createdChapter = withContinuityFiles.book.workspaceIndex.chapters[0]!;
    expect(createdChapter.worldReveals).toEqual(worldReveals);
    expect(createdChapter.characterContinuity).toEqual([
      {
        characterId,
        currentState: characterCurrentState,
        history: characterHistory
      }
    ]);
    for (const reference of [
      worldReveals,
      characterCurrentState,
      characterHistory
    ]) {
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: reference.id
        })
      ).resolves.toMatchObject({ content: "" });
    }

    const chapterContinuity = createdChapter.characterContinuity[0]!;
    const textDocuments = [
      {
        reference: createdChapter.body,
        content: "雨夜里，林岚收到一封带有旧王朝印记的信。"
      },
      {
        reference: createdChapter.characterState,
        content: "林岚持有旧信，决定追查寄信人。"
      },
      {
        reference: createdChapter.handoff,
        content: "下一章从信封上的旧邮戳继续追查。"
      },
      {
        reference: createdChapter.foreshadowingChanges,
        content: "寄信人身份伏笔已种下，等待后续揭露。"
      },
      {
        reference: createdChapter.worldReveals!,
        content: "旧王朝曾使用带月纹的官方火漆。"
      },
      {
        reference: chapterContinuity.currentState,
        content: "林岚：警觉；持有旧信；目标是确认寄信人。"
      },
      {
        reference: chapterContinuity.history,
        content: "第一章：收到旧信并开始调查。"
      }
    ];
    const written = await projectStore.applyWorkspaceOperations(
      created.projectDirectory,
      {
        batch: {
          updatedAt: FIXED_NOW,
          operations: [],
          documentWrites: textDocuments.map(
            ({ reference, content }, index) => ({
              proposalId: `proposal_continuity_${index}`,
              fileId: reference.id,
              mode: "replace" as const,
              updatedAt: FIXED_NOW,
              content,
              reason: "记录第一章连续性"
            })
          )
        }
      }
    );
    const writtenChapter = written.book.workspaceIndex.chapters[0]!;
    const writtenCharacterContinuity = writtenChapter.characterContinuity[0]!;
    const continuityReferences = [
      writtenChapter.characterState,
      writtenChapter.handoff,
      writtenChapter.foreshadowingChanges,
      writtenChapter.worldReveals!,
      writtenCharacterContinuity.currentState,
      writtenCharacterContinuity.history
    ];
    const commitInput = {
      mode: "text_files" as const,
      chapterCardId,
      foreshadowingBeatDecisions: {
        beat_text_continuity: {
          status: "committed" as const,
          note: "正文写明林岚收到带旧王朝印记与火漆的信。"
        }
      },
      commitMessage: "留存第一章连续性文本"
    };

    await expect(
      projectStore.commitChapter(created.projectDirectory, {
        ...commitInput,
        foreshadowingBeatDecisions: {}
      })
    ).rejects.toThrow(/伏笔触点决策必须完整覆盖/u);
    const projectionBefore = structuredClone(
      written.book.workspaceIndex.ledger.projection
    );
    const globalCharacterFilesBefore =
      written.book.workspaceIndex.characterFiles[0]!;
    const committed = await projectStore.commitChapter(
      created.projectDirectory,
      commitInput
    );
    expect(committed.record).toMatchObject({
      schemaVersion: 4,
      sequence: 1,
      chapterCardId,
      commitMessage: "留存第一章连续性文本",
      placementChanges: [
        {
          placementId: "placement_text_continuity",
          after: {
            status: "committed",
            commitId: committed.record.id
          },
          note: ""
        }
      ],
      foreshadowingBeatChanges: [
        {
          foreshadowingId: "foreshadow_text_continuity",
          beatId: "beat_text_continuity",
          after: {
            status: "committed",
            commitId: committed.record.id
          },
          note: "正文写明林岚收到带旧王朝印记与火漆的信。"
        }
      ],
      foreshadowingThreadChanges: [
        {
          foreshadowingId: "foreshadow_text_continuity",
          after: "open"
        }
      ],
      continuityFiles: continuityReferences.map(({ id, path }) => ({
        fileId: id,
        path
      }))
    });
    const afterCommit = await projectStore.openBook(created.projectDirectory);
    expect(afterCommit.book.workspaceIndex.ledger.projection).toEqual(
      projectionBefore
    );
    expect(afterCommit.book.workspaceIndex.characterFiles[0]).toEqual(
      globalCharacterFilesBefore
    );
    for (const reference of Object.values(globalCharacterFilesBefore).filter(
      (value): value is typeof globalCharacterFilesBefore.coreProfile =>
        typeof value === "object"
    )) {
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: reference.id
        })
      ).resolves.toMatchObject({ content: "" });
    }
    const commitEntry = afterCommit.book.workspaceIndex.ledger.commits[0]!;
    expect(commitEntry.mode).toBe("text_files");
    const rawRecord = await readFile(
      join(created.projectDirectory, commitEntry.recordFile.path),
      "utf8"
    );
    expect(rawRecord).not.toContain("收到旧信并开始调查");
    expect(rawRecord).not.toContain("旧王朝曾使用");

    const committedChapter = afterCommit.book.workspaceIndex.chapters[0]!;
    expect(
      afterCommit.book.workspaceIndex.plot.narrativePlacements[0]
    ).toMatchObject({
      id: "placement_text_continuity",
      status: "committed",
      commitId: committed.record.id
    });
    expect(
      afterCommit.book.workspaceIndex.plot.foreshadowing[0]!.beats[0]
    ).toMatchObject({
      id: "beat_text_continuity",
      status: "committed",
      commitId: committed.record.id
    });
    const refinedBody = "第一章正文（提交后精修措辞）。";
    const refined = await projectStore.writeDocument(created.projectDirectory, {
      fileId: committedChapter.body.id,
      content: refinedBody
    });
    expect(refined.fileId).toBe(committedChapter.body.id);
    expect(refined.book.workspaceIndex.chapters[0]!.commitId).toBe(
      committed.record.id
    );
    const refinedBodyReference = refined.book.workspaceIndex.chapters[0]!.body;
    const agentRefinedBody = "第一章正文（提交后由智能体继续精修措辞）。";
    const agentRefined = await projectStore.applyWorkspaceOperations(
      created.projectDirectory,
      {
        batch: {
          updatedAt: FIXED_NOW,
          operations: [],
          documentWrites: [
            {
              proposalId: "proposal_refine_committed_body",
              fileId: refinedBodyReference.id,
              mode: "replace",
              updatedAt: FIXED_NOW,
              content: agentRefinedBody,
              reason: "精修已提交正文"
            }
          ]
        }
      }
    );
    expect(agentRefined.book.workspaceIndex.chapters[0]!.commitId).toBe(
      committed.record.id
    );
    const refinedCardContent = "章卡内容（提交后精修）。";
    const refinedCard = await projectStore.writeDocument(
      created.projectDirectory,
      {
        fileId: committedChapter.card.id,
        content: refinedCardContent
      }
    );
    expect(refinedCard.fileId).toBe(committedChapter.card.id);
    expect(refinedCard.book.workspaceIndex.chapters[0]!.commitId).toBe(
      committed.record.id
    );

    for (const reference of [
      committedChapter.characterState,
      committedChapter.handoff,
      committedChapter.foreshadowingChanges,
      committedChapter.worldReveals!,
      ...committedChapter.characterContinuity.flatMap((entry) => [
        entry.currentState,
        entry.history
      ])
    ]) {
      await expect(
        projectStore.writeDocument(created.projectDirectory, {
          fileId: reference.id,
          content: "不应写入已提交记录"
        })
      ).rejects.toThrow("已提交的连续性文件为只读");
    }

    for (const mode of ["replace", "append"] as const) {
      await expect(
        projectStore.applyWorkspaceOperations(created.projectDirectory, {
          batch: {
            updatedAt: FIXED_NOW,
            operations: [],
            documentWrites: [
              {
                proposalId: `proposal_blocked_${mode}`,
                fileId: committedChapter.handoff.id,
                mode,
                updatedAt: FIXED_NOW,
                content: "禁止改写已提交接续包",
                reason: "验证连续性提交保护"
              }
            ]
          }
        })
      ).rejects.toThrow("已提交的连续性文件为只读");
    }
    await expect(
      projectStore.writeChapter(created.projectDirectory, {
        chapterCardId,
        body: { content: "不应覆盖正文" },
        characterState: { content: "不应覆盖章末状态" },
        handoff: { content: "不应覆盖接续包" }
      })
    ).rejects.toThrow("已提交的连续性文件为只读");

    const afterEdits = await projectStore.openBook(created.projectDirectory);
    expect(afterEdits.book.workspaceIndex.ledger.commits).toHaveLength(1);
    expect(afterEdits.book.workspaceIndex.chapters[0]!.commitId).toBe(
      committed.record.id
    );
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: committedChapter.body.id
      })
    ).resolves.toMatchObject({ content: agentRefinedBody });
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: committedChapter.card.id
      })
    ).resolves.toMatchObject({ content: refinedCardContent });
    expect(
      afterEdits.book.workspaceIndex.plot.narrativePlacements[0]
    ).toMatchObject({
      id: "placement_text_continuity",
      status: "committed",
      commitId: committed.record.id
    });
    expect(
      afterEdits.book.workspaceIndex.plot.foreshadowing[0]!.beats[0]
    ).toMatchObject({
      id: "beat_text_continuity",
      status: "committed",
      commitId: committed.record.id
    });
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: writtenCharacterContinuity.history.id
      })
    ).resolves.toMatchObject({
      content: "第一章：收到旧信并开始调查。"
    });
    await projectStore.deleteLedgerCommit(created.projectDirectory, {
      commitId: committed.record.id
    });
    for (const reference of continuityReferences) {
      await projectStore.writeDocument(created.projectDirectory, {
        fileId: reference.id,
        content: "删除提交后人工修订连续性内容。"
      });
    }
    const resubmitted = await projectStore.commitChapter(
      created.projectDirectory,
      commitInput
    );
    expect(resubmitted.record.id).not.toBe(committed.record.id);
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: writtenCharacterContinuity.history.id
      })
    ).resolves.toMatchObject({ content: "删除提交后人工修订连续性内容。" });
    await expect(
      projectStore.writeDocument(created.projectDirectory, {
        fileId: writtenChapter.handoff.id,
        content: "重新提交后禁止修改"
      })
    ).rejects.toThrow("已提交的连续性文件为只读");
  }, 10_000);
});
