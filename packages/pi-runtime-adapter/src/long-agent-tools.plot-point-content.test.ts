import {
  describe,
  documentExecutor,
  expect,
  fixtureIndex,
  it,
  longTools,
  resultText,
  toolByName
} from "./long-agent-tools.test-support";
import type { LongAgentToolDetails } from "./long-agent-tools";

function mutationBatch(details: unknown): LongAgentToolDetails {
  return details as LongAgentToolDetails;
}

describe("unified long-form tools: plot-point content", () => {
  it("tells create that plot-point content is the summary, not a story plot", () => {
    const create = toolByName(
      longTools({ executor: documentExecutor(fixtureIndex()) }),
      "create"
    );
    expect(create.description).toContain("剧情点的 content 写入该剧情点的概要");
    expect(create.description).toContain("不要为此再新建故事情节");
  });

  it("creates a plot point by writing content into summary, not a story plot", async () => {
    const create = toolByName(
      longTools({ executor: documentExecutor(fixtureIndex()) }),
      "create"
    );
    const created = await create.execute("create-arc", {
      kind: "arc",
      meta: { title: "来信", volume_id: "volume_one" },
      content: "因神秘来信触发，主角选择追查，局面被迫公开。",
      summary: "新建剧情点"
    });
    const details = mutationBatch(created.details);
    expect(details).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        operations: [
          {
            type: "arc.create",
            arc: {
              title: "来信",
              volumeId: "volume_one",
              summary: "因神秘来信触发，主角选择追查，局面被迫公开。",
              outline: ""
            }
          }
        ]
      }
    });
    if (details.kind !== "long-mutation-proposal") {
      throw new Error("expected a mutation proposal");
    }
    expect(
      details.batch.operations.some(
        (operation) => operation.type === "storyPlot.create"
      )
    ).toBe(false);
  });

  it("reads and edits the plot-point summary, not the legacy outline", async () => {
    const index = fixtureIndex();
    const arc = index.plot.arcs[0];
    if (!arc) throw new Error("fixture is missing arc_one");
    arc.summary = "主线概要。";
    arc.outline = "不该再作为剧情点正文的遗留细纲。";
    const tools = longTools({ executor: documentExecutor(index), index });
    const read = toolByName(tools, "read");
    const edit = toolByName(tools, "edit");

    const readText = resultText(
      await read.execute("read-arc", { id: "arc_one" })
    );
    expect(readText).toContain("主线概要。");
    expect(readText).not.toContain("不该再作为剧情点正文的遗留细纲。");

    const edited = await edit.execute("edit-arc", {
      id: "arc_one",
      content: "更新后的概要。",
      overwrite_mode: "replace_all",
      summary: "改写剧情点概要"
    });
    expect(mutationBatch(edited.details)).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        operations: [
          {
            type: "arc.update",
            id: "arc_one",
            patch: { summary: "更新后的概要。" }
          }
        ]
      }
    });
  });
});
