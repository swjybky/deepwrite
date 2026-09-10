import {
  LongWorkspaceOperationBatchSchema,
  applyLongWorkspaceOperations,
  previewLongWorkspaceOperations
} from "@deepwrite/contracts";
import {
  Check,
  committedFixtureIndex,
  describe,
  documentExecutor,
  expect,
  fixtureIndex,
  it,
  longTools,
  resultText,
  toolByName,
  vi
} from "./long-agent-tools.test-support";

describe("character metadata moves", () => {
  it.each(["minor_supporting", "chartype_observer"])(
    "moves to %s without document writes or lost references",
    async (typeId) => {
      const index = committedFixtureIndex();
      index.characters[0]!.group = "major_supporting";
      index.characterTypes.push({
        id: "chartype_observer",
        title: "观察者",
        order: 5
      });
      const original = structuredClone(index);
      const tools = longTools({
        executor: documentExecutor(index),
        activeRoot: "character_design",
        index
      });
      const edit = toolByName(tools, "edit");
      const params = {
        id: "character_alice",
        meta: { type_id: typeId, name: "林舟", aliases: ["阿舟"] },
        summary: "调整人物定位"
      };
      expect(Check(edit.parameters, params)).toBe(true);
      const result = await edit.execute("move-character", params);
      if (result.details?.kind !== "long-mutation-proposal")
        throw new Error("Expected a mutation proposal");
      expect(
        LongWorkspaceOperationBatchSchema.parse(
          result.details.batch
        ).operations.map(({ type }) => type)
      ).toEqual(["character.update", "character.move"]);
      expect(result.details.batch.documentWrites).toEqual([]);
      expect(result.details.summary).toContain("主要配角 →");
      expect(index).toEqual(original);
      const applied = applyLongWorkspaceOperations(index, {
        ...result.details.batch,
        expectedImpact: previewLongWorkspaceOperations(
          index,
          result.details.batch
        ).confirmation
      }).snapshot;
      expect(applied.characters[0]).toMatchObject({
        id: "character_alice",
        name: "林舟",
        group: typeId,
        aliases: ["阿舟"]
      });
      expect(applied.characterFiles).toEqual(original.characterFiles);
      expect(applied.chapters).toEqual(original.chapters);
      expect(applied.plot).toEqual(original.plot);
      expect(applied.ledger).toEqual(original.ledger);
      const acceptedTools = longTools({
        executor: documentExecutor(applied),
        activeRoot: "character_design",
        index: applied
      });
      const listing = await toolByName(acceptedTools, "list").execute(
        "list-moved",
        { stage: "character", scope_id: typeId }
      );
      expect(resultText(listing)).toContain("character_alice 林舟");
      const read = await toolByName(acceptedTools, "read").execute(
        "read-moved",
        { id: "character_alice", document: "core_profile" }
      );
      expect(resultText(read)).toContain(`type_id: ${typeId}`);
      const repeated = await toolByName(acceptedTools, "edit").execute(
        "move-again",
        params
      );
      expect(repeated.details).toEqual({ kind: "none" });
      expect(resultText(repeated)).toContain("无需修改");
    }
  );

  it("appends after existing members and preserves same-type order", async () => {
    const index = fixtureIndex();
    const tools = longTools({
      executor: documentExecutor(index),
      activeRoot: "character_design"
    });
    const created = await toolByName(tools, "create").execute("create-member", {
      kind: "character",
      meta: { name: "周衡", type_id: "minor_supporting" }
    });
    if (created.details?.kind !== "long-character-file-proposal")
      throw new Error("Expected character creation");
    const withMember = applyLongWorkspaceOperations(
      index,
      created.details.batch
    ).snapshot;
    const moveTools = longTools({
      executor: documentExecutor(withMember),
      activeRoot: "character_design"
    });
    const edit = toolByName(moveTools, "edit");
    const moved = await edit.execute("move", {
      id: "character_alice",
      meta: { type_id: "minor_supporting" },
      summary: "移动"
    });
    expect(moved.details).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        operations: [{ type: "character.move", toGroup: "minor_supporting" }]
      }
    });
    if (moved.details?.kind !== "long-mutation-proposal")
      throw new Error("Expected move");
    const applied = applyLongWorkspaceOperations(withMember, {
      ...moved.details.batch,
      expectedImpact: previewLongWorkspaceOperations(
        withMember,
        moved.details.batch
      ).confirmation
    }).snapshot;
    const acceptedTools = longTools({
      executor: documentExecutor(applied),
      activeRoot: "character_design"
    });
    const listed = resultText(
      await toolByName(acceptedTools, "list").execute("list", {
        stage: "character",
        scope_id: "minor_supporting"
      })
    );
    expect(listed.indexOf("周衡")).toBeLessThan(listed.indexOf("林岚"));
    const same = await toolByName(acceptedTools, "edit").execute("same", {
      id: "character_alice",
      meta: { type_id: "minor_supporting" },
      summary: "重复移动"
    });
    expect(same.details).toEqual({ kind: "none" });
  });

  it("rejects invalid types, non-character targets, mixed prose and chapter-scoped metadata", async () => {
    const edit = toolByName(
      longTools({
        executor: documentExecutor(committedFixtureIndex()),
        activeRoot: "character_design"
      }),
      "edit"
    );
    await expect(
      edit.execute("missing", {
        id: "character_alice",
        meta: { type_id: "chartype_missing" },
        summary: "移动"
      })
    ).rejects.toThrow("不存在");
    await expect(
      edit.execute("wrong-target", {
        id: "volume_one",
        meta: { type_id: "minor_supporting" },
        summary: "移动"
      })
    ).rejects.toThrow("meta 只接受");
    await expect(
      edit.execute("mixed", {
        id: "character_alice",
        document: "core_profile",
        meta: { type_id: "minor_supporting" },
        content: "新正文",
        summary: "移动"
      })
    ).rejects.toThrow("分成两次");
    await expect(
      edit.execute("chapter", {
        id: "character_alice",
        document: "history",
        chapter_id: "chapter_one",
        meta: { type_id: "minor_supporting" },
        summary: "移动"
      })
    ).rejects.toThrow("不支持修改 meta");
    expect(
      Check(edit.parameters, {
        id: "character_alice",
        meta: { type_id: "made_up" },
        summary: "移动"
      })
    ).toBe(false);
  });

  it("honors cancellation before creating a cross-stage move proposal", async () => {
    const requestUserInput = vi.fn(async () => ({
      sessionId: "session_tools",
      runId: "run_tools",
      requestId: "request_cancel",
      answers: [{ id: "cross_stage_write", selectedOptionIds: ["cancel"] }]
    }));
    const tools = longTools({
      executor: documentExecutor(fixtureIndex()),
      activeRoot: "plot_design",
      requestUserInput
    });
    const result = await toolByName(tools, "edit").execute("cancel", {
      id: "character_alice",
      meta: { type_id: "minor_supporting" },
      summary: "移动"
    });
    expect(resultText(result)).toContain("用户取消");
    expect(result.details).not.toMatchObject({
      kind: "long-mutation-proposal"
    });
  });
});
