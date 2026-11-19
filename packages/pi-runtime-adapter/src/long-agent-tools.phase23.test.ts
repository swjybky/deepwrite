import {
  createLongWorkspaceToolSharedState,
  type LongCommandExecutor
} from "./long-agent-tools";
import { describe, expect, it } from "vitest";
import { validateToolArguments, type JsonObject } from "@earendil-works/pi-ai";
import {
  committedFixtureIndex,
  indexResult,
  longTools,
  twoWrittenChaptersIndex,
  fixtureWorldbuildingIndex,
  documentExecutor,
  toolByName,
  resultText,
  vi,
  profile,
  workspace,
  buildLongWorkspaceTools,
  createLongWorkspaceNavigationSnapshot,
  toRuntimeEvents
} from "./long-agent-tools.test-support";

async function call(
  tools: ReturnType<typeof longTools>,
  name: string,
  args: JsonObject,
  id = name
) {
  const tool = toolByName(tools, name);
  return tool.execute(
    id,
    validateToolArguments(tool, { type: "toolCall", id, name, arguments: args })
  );
}

describe("long phase two and three tools", () => {
  it("validates combined arguments before reading and returns one mapped proposal", async () => {
    const index = twoWrittenChaptersIndex();
    const executor = documentExecutor(index, {
      [index.chapters[0]!.body.id]: "正文"
    });
    const tools = longTools({
      index,
      executor,
      activeChapterCardId: "chapter_one"
    });
    await expect(
      call(tools, "propose_continuity_commit", {
        summary: "归档",
        foreshadowing_touchpoint_decisions: [],
        documents: { chapter_end_state: "状态" }
      })
    ).rejects.toThrow();
    expect(executor).not.toHaveBeenCalled();
    const result = await call(tools, "propose_continuity_commit", {
      summary: "归档",
      foreshadowing_touchpoint_decisions: [],
      documents: {
        chapter_end_state: "状态",
        handoff: "接续",
        world_reveals: "设定",
        characters: [
          {
            character_id: "character_alice",
            current_state: "状态",
            history: "轨迹"
          }
        ]
      }
    });
    expect(result.details).toMatchObject({
      kind: "long-continuity-commit-proposal",
      files: expect.any(Array),
      input: {
        preparation: {
          bodyVersions: [
            {
              fileId: index.chapters[0]!.body.id,
              expectedSha256: expect.stringMatching(/^[a-f0-9]{64}$/)
            }
          ]
        }
      }
    });
    const events = toRuntimeEvents(
      {
        type: "tool_execution_end",
        toolCallId: "combined",
        toolName: "propose_continuity_commit",
        result,
        isError: false
      },
      { runId: "run", sessionId: "session" },
      { provider: "deepwrite", model: "test", mode: "local-faux" },
      "message"
    ).filter((event) => event.type === "long.ledger_commit_proposal");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "long.ledger_commit_proposal",
      payload: { files: expect.any(Array) }
    });
  });
  it("requires explicit full reading before replacing nonempty continuity", async () => {
    const index = twoWrittenChaptersIndex();
    const chapter = index.chapters[0]!;
    const tools = longTools({
      index,
      executor: documentExecutor(index, {
        [chapter.body.id]: "正文",
        [chapter.handoff.id]: "原交接"
      }),
      activeChapterCardId: "chapter_one"
    });
    const args = {
      summary: "归档",
      foreshadowing_touchpoint_decisions: [],
      documents: { chapter_end_state: "状态", handoff: "新交接" }
    };
    await expect(
      call(tools, "propose_continuity_commit", args)
    ).rejects.toThrow("先 read 全文");
    await call(tools, "read", { id: "chapter_one", document: "handoff" });
    expect(
      (await call(tools, "propose_continuity_commit", args)).details.kind
    ).toBe("long-continuity-commit-proposal");
  });

  it("identifies full and ranged reads from an uncommitted archive proposal", async () => {
    const index = twoWrittenChaptersIndex();
    const chapter = index.chapters[0]!;
    const executor = documentExecutor(index, { [chapter.body.id]: "正文" });
    const sharedState = createLongWorkspaceToolSharedState();
    const proposer = longTools({
      index,
      executor,
      sharedState,
      activeChapterCardId: chapter.chapterCardId
    });
    const tools = longTools({ index, executor, sharedState });
    const target = { id: chapter.chapterCardId, document: "handoff" };
    const source = "内容来自本轮连续性归档提案";
    expect(resultText(await call(tools, "read", target))).not.toContain(source);
    const proposal = await call(proposer, "propose_continuity_commit", {
      summary: "归档",
      foreshadowing_touchpoint_decisions: [],
      documents: { chapter_end_state: "状态", handoff: "下一章接续" }
    });
    expect(resultText(proposal)).toContain('view="continuity"');
    expect(resultText(proposal)).toMatch(/本批账本 commit_[a-f0-9]{24}/);
    expect(resultText(await call(tools, "read", target))).toContain(source);
    expect(resultText(await call(tools, "read", target))).toContain(source);
    const excerpt = resultText(
      await call(tools, "read", { ...target, range: "tail", max_chars: 2 })
    );
    expect(excerpt).toContain(source);
    expect(excerpt).toContain("接续");
    const status = resultText(
      await call(tools, "list", {
        scope_id: chapter.chapterCardId,
        view: "continuity"
      })
    );
    expect(status).toContain("未提交");
    expect(index.ledger.commits).toHaveLength(0);
  });

  it.each([{ view: "continuity" }, { stage: "continuity" }])(
    "checks Core again for ledger status with %j",
    async (selector) => {
      let index = twoWrittenChaptersIndex();
      const executor = vi.fn<LongCommandExecutor>(async () =>
        indexResult(index)
      );
      const tools = longTools({ index, executor });
      const args = { scope_id: "chapter_one", ...selector };
      expect(resultText(await call(tools, "list", args))).toContain("未提交");
      index = committedFixtureIndex();
      expect(resultText(await call(tools, "list", args))).toContain(
        "已提交；正文版本未核验；账本 commit_one"
      );
      expect(executor).toHaveBeenCalledTimes(2);
    }
  );

  it("infers list views and retains legacy stage while rejecting conflicting views", async () => {
    const index = fixtureWorldbuildingIndex();
    const tools = longTools({ index, executor: documentExecutor(index) });
    expect(
      resultText(await call(tools, "list", { scope_id: "world_magic" }))
    ).toContain("worlditem_memory");
    expect(
      resultText(await call(tools, "list", { scope_id: "protagonist" }))
    ).toContain("character_alice");
    expect(
      resultText(await call(tools, "list", { scope_id: "volume_one" }))
    ).toContain("chapter_one");
    expect(
      resultText(
        await call(tools, "list", {
          scope_id: "volume_one",
          view: "continuity"
        })
      )
    ).toContain("chapter_one");
    expect(
      resultText(
        await call(tools, "list", { stage: "draft", scope_id: "volume_one" })
      )
    ).toContain("chapter_one");
    await expect(
      call(tools, "list", {
        stage: "plot",
        view: "continuity",
        scope_id: "volume_one"
      })
    ).rejects.toThrow("不能");
  });
  it("reports all missing create metadata together", async () => {
    const index = fixtureWorldbuildingIndex();
    const executor = documentExecutor(index);
    const tools = longTools({ index, executor });
    await expect(
      call(tools, "create", { kind: "narrative_placement", meta: {} })
    ).rejects.toThrow(
      "kind=narrative_placement 缺少 meta.chapter_card_id、meta.event_id、meta.mode、meta.disclosure；可选字段：无"
    );
    expect(executor).not.toHaveBeenCalled();
    expect(toolByName(tools, "create").description).toContain(
      "kind | 必填 meta | 可选 meta"
    );
  });
  it("maps search hits to business ids, forwards cursor, and does not grant edit credentials", async () => {
    const index = fixtureWorldbuildingIndex();
    const chapter = index.chapters[0]!;
    const base = documentExecutor(index, { [chapter.body.id]: "检索内容" });
    const executor = vi.fn<LongCommandExecutor>(async (command) =>
      command.type === "long.search"
        ? {
            status: "accepted",
            requestId: command.id,
            payload: {
              bookId: index.bookId,
              query: command.payload.query,
              scope: command.payload.scope,
              hits: [
                {
                  fileId: chapter.body.id,
                  path: chapter.body.path,
                  root: "draft",
                  title: "第一章",
                  start: 0,
                  end: 2,
                  snippet: "检索内容"
                }
              ],
              nextCursor: "cursor_next"
            }
          }
        : base(command)
    );
    const tools = longTools({ index, executor });
    const text = resultText(
      await call(tools, "search", {
        query: "检索",
        stage: "draft",
        cursor: "cursor_previous"
      })
    );
    expect(text).toContain("id=chapter_one；document=body");
    expect(text).toContain("cursor_next");
    expect(text).not.toContain(chapter.body.id);
    expect(text).not.toContain(chapter.body.path);
    expect(executor.mock.calls[0]![0]).toMatchObject({
      payload: { cursor: "cursor_previous", scope: "draft" }
    });
    expect(
      resultText(
        await call(tools, "edit", {
          id: "chapter_one",
          document: "body",
          content: "替换",
          overwrite_mode: "replace_all"
        })
      )
    ).toContain("完整读取");
  });
  it("rejects invalid or unauthorized searches before calling Core", async () => {
    const index = fixtureWorldbuildingIndex();
    const executor = documentExecutor(index);
    const restricted = profile("long");
    restricted.readAccess.workspaceRoots = ["draft"];
    const context = workspace("long", "draft");
    context.navigation = createLongWorkspaceNavigationSnapshot(index);
    const tools = buildLongWorkspaceTools({
      workspace: context,
      profile: restricted,
      sessionId: "session",
      runId: "run",
      executor
    });
    for (const args of [
      { query: " " },
      { query: "x".repeat(257) },
      { query: "词", stage: "worldbuilding" },
      { query: "词" }
    ])
      await expect(call(tools, "search", args)).rejects.toThrow();
    expect(executor).not.toHaveBeenCalled();
  });
});

describe("review existing continuity batch", () => {
  it("requires complete evidence reads through Pi validation and proposes review without a new commit", async () => {
    const index = twoWrittenChaptersIndex();
    const chapter = index.chapters[0]!;
    const commitId = "commit_review";
    const recordFile = {
      id: "file_commit_review:ledger",
      path: "long/ledger/commit_review.json",
      updatedAt: index.updatedAt
    };
    chapter.commitId = commitId;
    index.ledger.committedThroughChapterId = chapter.chapterCardId;
    index.ledger.commits.push({
      id: commitId,
      mode: "text_files_batch",
      sequence: 1,
      chapterCardId: chapter.chapterCardId,
      chapterCardIds: [chapter.chapterCardId],
      checkpointChapterCardId: chapter.chapterCardId,
      committedAt: index.updatedAt,
      placementIds: [],
      foreshadowingBeatIds: [],
      recordFile
    });
    const record = JSON.stringify({
      schemaVersion: 5,
      id: commitId,
      bookId: index.bookId,
      sequence: 1,
      chapterCardId: chapter.chapterCardId,
      chapterCardIds: [chapter.chapterCardId],
      checkpointChapterCardId: chapter.chapterCardId,
      committedAt: index.updatedAt,
      commitMessage: "原记录",
      committedThroughChapterId: chapter.chapterCardId,
      placementChanges: [],
      foreshadowingBeatChanges: [],
      continuityFiles: [chapter.characterState, chapter.handoff].map((f) => ({
        fileId: f.id,
        path: f.path
      }))
    });
    const baseExecutor = documentExecutor(index, {
      [chapter.body.id]: "当前正文",
      [chapter.characterState.id]: "章末状态",
      [chapter.handoff.id]: "接续"
    });
    const executor: LongCommandExecutor = async (command, signal) =>
      command.type === "long.readDocument" &&
      command.payload.fileId === recordFile.id
        ? {
            status: "accepted",
            requestId: command.id,
            payload: {
              bookId: index.bookId,
              file: recordFile,
              content: record,
              offset: 0,
              totalCharacters: record.length,
              nextOffset: null
            }
          }
        : baseExecutor(command, signal);
    const tools = longTools({ index, executor });
    const args = {
      review_commit_id: commitId,
      summary: "已核对，无事实冲突。",
      foreshadowing_touchpoint_decisions: []
    };
    await expect(
      call(tools, "propose_continuity_commit", args)
    ).rejects.toThrow("完整读取");
    await call(tools, "read", {
      id: chapter.chapterCardId,
      document: "body",
      range: "tail"
    });
    await expect(
      call(tools, "propose_continuity_commit", args)
    ).rejects.toThrow("完整读取");
    for (const document of ["body", "character_state", "handoff"])
      await call(tools, "read", { id: chapter.chapterCardId, document });
    const result = await call(tools, "propose_continuity_commit", args);
    expect(result.details).toMatchObject({
      kind: "long-ledger-commit-proposal",
      input: { review: { commitId }, chapterCardIds: [chapter.chapterCardId] }
    });
    expect(index.ledger.commits).toHaveLength(1);
  });
});

describe("book continuity overview", () => {
  it("accepts book_line and returns executable volume calls", async () => {
    const index = twoWrittenChaptersIndex();
    const tools = longTools({ index, executor: documentExecutor(index) });
    const result = resultText(
      await call(tools, "list", { scope_id: "book_line", view: "continuity" })
    );
    expect(result).toContain("全书连续性概览");
    expect(result).toContain('list(scope_id="volume_one", view="continuity")');
  });
});
