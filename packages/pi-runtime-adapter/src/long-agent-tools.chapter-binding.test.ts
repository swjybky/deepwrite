import {
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
  twoWrittenChaptersIndex
} from "./long-agent-tools.test-support";

describe("chapter primary plot point metadata", () => {
  it.each(["arc_next", null])(
    "proposes binding %s while preserving order and all chapter files",
    async (arcId) => {
      const index = twoWrittenChaptersIndex();
      const committed = committedFixtureIndex();
      index.chapters[0] = committed.chapters[0]!;
      index.ledger = committed.ledger;
      index.plot.arcs.push({
        ...index.plot.arcs[0]!,
        id: "arc_next",
        title: "暗线",
        order: 2
      });
      const original = structuredClone(index);
      const executor = documentExecutor(index);
      const edit = toolByName(longTools({ executor, index }), "edit");
      const params = {
        id: "chapter_one",
        meta: { primary_arc_id: arcId, title: "新的第一章" },
        summary: "调整主剧情点"
      };
      expect(Check(edit.parameters, params)).toBe(true);
      const result = await edit.execute("change-binding", params);
      if (result.details?.kind !== "long-mutation-proposal")
        throw new Error("Expected a mutation proposal");
      expect(result.details.batch.documentWrites).toEqual([]);
      expect(result.details.batch.operations).toEqual([
        {
          type: "chapter.update",
          id: "chapter_one",
          patch: { title: "新的第一章" }
        },
        {
          type: "chapter.move",
          id: "chapter_one",
          toVolumeId: "volume_one",
          toPrimaryArcId: arcId,
          beforeChapterCardId: "chapter_two"
        }
      ]);
      expect(result.details.summary).toContain("主剧情点：主线 →");
      expect(executor.mock.calls.map(([command]) => command.type)).toEqual([
        "long.getWorkspaceIndex"
      ]);
      expect(index).toEqual(original);
      const applied = applyLongWorkspaceOperations(index, {
        ...result.details.batch,
        expectedImpact: previewLongWorkspaceOperations(
          index,
          result.details.batch
        ).confirmation
      }).snapshot;
      expect(applied.plot.chapterCards[0]).toMatchObject({
        id: "chapter_one",
        primaryArcId: arcId,
        narrativeOrder: 1
      });
      expect(applied.plot.chapterCards[1]?.narrativeOrder).toBe(2);
      expect(applied.chapters).toEqual(original.chapters);
      expect(applied.ledger).toEqual(original.ledger);
      const tools = longTools({
        executor: documentExecutor(applied),
        index: applied
      });
      expect(
        resultText(
          await toolByName(tools, "list").execute("list", {
            stage: "plot",
            scope_id: "volume_one"
          })
        )
      ).toContain(`主剧情点：${arcId ?? "未关联"}`);
      const repeated = await toolByName(tools, "edit").execute(
        "repeat",
        params
      );
      expect(repeated.details).toEqual({ kind: "none" });
    }
  );

  it("rejects invalid targets, mixed prose and metadata, and metadata on other entity types", async () => {
    const index = fixtureIndex();
    index.plot.volumes.push({
      id: "volume_two",
      title: "第二卷",
      order: 2,
      summary: ""
    });
    index.plot.arcs.push({
      ...index.plot.arcs[0]!,
      id: "arc_other",
      volumeId: "volume_two",
      title: "异卷"
    });
    const edit = toolByName(
      longTools({ executor: documentExecutor(index) }),
      "edit"
    );
    await expect(
      edit.execute("missing", {
        id: "chapter_one",
        meta: { primary_arc_id: "arc_missing" }
      })
    ).rejects.toThrow("does not exist");
    await expect(
      edit.execute("other-volume", {
        id: "chapter_one",
        meta: { primary_arc_id: "arc_other" }
      })
    ).rejects.toThrow("chapter volume");
    await expect(
      edit.execute("mixed", {
        id: "chapter_one",
        document: "card",
        content: "新章卡",
        meta: { primary_arc_id: null }
      })
    ).rejects.toThrow("分成两次");
    await expect(
      edit.execute("other-target", {
        id: "volume_one",
        meta: { primary_arc_id: null }
      })
    ).rejects.toThrow("meta 只接受");
    expect(
      Check(edit.parameters, {
        id: "chapter_one",
        meta: { primary_arc_id: "volume_one" }
      })
    ).toBe(false);
  });
});
