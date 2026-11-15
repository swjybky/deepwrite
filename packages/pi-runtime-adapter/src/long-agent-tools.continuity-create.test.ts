import {
  longChapterWorldRevealsFileId,
  longLedgerCommitFileId
} from "@deepwrite/contracts";
import {
  describe,
  documentExecutor,
  expect,
  fixtureIndex,
  it,
  longChapterCharacterCurrentStateFileId,
  longChapterCharacterHistoryFileId,
  longTools,
  resultText,
  toolByName
} from "./long-agent-tools.test-support";

function continuityTools() {
  const index = fixtureIndex();
  return {
    index,
    tools: longTools({
      executor: documentExecutor(index),
      activeRoot: "continuity_ledger",
      activeChapterCardId: "chapter_one",
      index
    })
  };
}

describe("unified long-form tools: continuity create with content", () => {
  it("writes world-reveals content in the create proposal", async () => {
    const { tools } = continuityTools();
    const created = await toolByName(tools, "create").execute(
      "create-world-reveals",
      {
        kind: "continuity_world_reveals",
        meta: { chapter_card_id: "chapter_one" },
        content: "城门只会在月蚀之夜显形。",
        summary: "写入第六章世界观揭露"
      }
    );

    expect(resultText(created)).not.toContain("先创建空白文档");
    expect(created.details).toMatchObject({
      kind: "long-continuity-file-proposal",
      files: [
        expect.objectContaining({
          operation: "create",
          role: "world_reveals",
          afterText: "城门只会在月蚀之夜显形。"
        })
      ],
      batch: {
        documentWrites: [
          expect.objectContaining({
            mode: "create",
            fileId: longChapterWorldRevealsFileId("chapter_one"),
            content: "城门只会在月蚀之夜显形。"
          })
        ]
      }
    });
  });

  it("writes one character continuity document and leaves the sibling blank", async () => {
    const { tools } = continuityTools();
    const created = await toolByName(tools, "create").execute(
      "create-current-state",
      {
        kind: "continuity_character",
        meta: {
          chapter_card_id: "chapter_one",
          character_id: "character_alice",
          document: "current_state"
        },
        content: "林岚在章末确认旧信来自港务所。",
        summary: "写入林岚当前状态"
      }
    );

    expect(created.details).toMatchObject({
      kind: "long-continuity-file-proposal",
      batch: {
        operations: [
          expect.objectContaining({
            type: "chapterContinuity.character.create"
          })
        ],
        documentWrites: [
          expect.objectContaining({
            mode: "create",
            fileId: longChapterCharacterCurrentStateFileId(
              "chapter_one",
              "character_alice"
            ),
            content: "林岚在章末确认旧信来自港务所。"
          }),
          expect.objectContaining({
            mode: "create",
            fileId: longChapterCharacterHistoryFileId(
              "chapter_one",
              "character_alice"
            ),
            content: ""
          })
        ]
      }
    });
  });

  it("fills the sibling character file in a later create of the same run", async () => {
    const { tools } = continuityTools();
    const create = toolByName(tools, "create");
    await create.execute("create-current-state", {
      kind: "continuity_character",
      meta: {
        chapter_card_id: "chapter_one",
        character_id: "character_alice",
        document: "current_state"
      },
      content: "林岚在章末确认旧信来自港务所。"
    });

    const history = await toolByName(tools, "edit").execute("edit-history", {
      id: "character_alice",
      chapter_id: "chapter_one",
      document: "history",
      content: "林岚在第一章追查到港务所。",
      summary: "写入林岚历史轨迹"
    });

    expect(resultText(history)).toContain("写入");
    expect(history.details).toMatchObject({
      kind: "long-continuity-file-proposal",
      files: [
        expect.objectContaining({
          operation: "write",
          role: "character_history",
          afterText: "林岚在第一章追查到港务所。"
        })
      ],
      batch: {
        operations: [],
        documentWrites: [
          expect.objectContaining({
            mode: "replace",
            fileId: longChapterCharacterHistoryFileId(
              "chapter_one",
              "character_alice"
            ),
            content: "林岚在第一章追查到港务所。"
          })
        ]
      }
    });
  });

  it("lets a later edit see a file created earlier in the same run", async () => {
    const { tools } = continuityTools();
    await toolByName(tools, "create").execute("create-world-reveals", {
      kind: "continuity_world_reveals",
      meta: { chapter_card_id: "chapter_one" },
      content: "城门只会在月蚀之夜显形。"
    });

    const edited = await toolByName(tools, "edit").execute(
      "edit-world-reveals",
      {
        id: "chapter_one",
        document: "world_reveals",
        content: "雾潮期间城门只在月蚀之夜显形。",
        allow_overwrite_existing: true,
        summary: "修订世界观揭露"
      }
    );

    expect(edited.details).toMatchObject({
      kind: "long-continuity-file-proposal",
      files: [
        expect.objectContaining({
          operation: "write",
          afterText: "雾潮期间城门只在月蚀之夜显形。"
        })
      ]
    });
  });

  it("requires document when creating character continuity files", async () => {
    const { tools } = continuityTools();
    await expect(
      toolByName(tools, "create").execute("create-character-missing-document", {
        kind: "continuity_character",
        meta: {
          chapter_card_id: "chapter_one",
          character_id: "character_alice"
        },
        content: "缺少 document。"
      })
    ).rejects.toThrow("kind=continuity_character 缺少 meta.document");
  });

  it("rejects continuity-file creation after the chapter ledger is committed", async () => {
    const index = fixtureIndex();
    index.chapters[0]!.commitId = "commit_existing";
    index.ledger.committedThroughChapterId = "chapter_one";
    index.ledger.commits.push({
      id: "commit_existing",
      mode: "text_files",
      sequence: 1,
      chapterCardId: "chapter_one",
      committedAt: index.updatedAt,
      placementIds: [],
      foreshadowingBeatIds: [],
      recordFile: {
        id: longLedgerCommitFileId("commit_existing"),
        path: "long/ledger/commit-existing.json",
        updatedAt: index.updatedAt
      }
    });
    const tools = longTools({
      executor: documentExecutor(index),
      activeRoot: "continuity_ledger",
      activeChapterCardId: "chapter_one",
      index
    });

    await expect(
      toolByName(tools, "create").execute("create-after-commit", {
        kind: "continuity_world_reveals",
        meta: { chapter_card_id: "chapter_one" },
        content: "不应在提交后创建。"
      })
    ).rejects.toThrow("已提交账本");
  });
});
