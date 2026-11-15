import { applyLongWorkspaceOperations } from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import {
  createLongWorkspaceToolSharedState,
  type LongAgentToolDetails
} from "./long-agent-tools";
import {
  documentExecutor,
  fixtureWorldbuildingIndex,
  longTools,
  resultText,
  toolByName
} from "./long-agent-tools.test-support";

function createdId(result: {
  content: unknown;
  details: LongAgentToolDetails;
}): string {
  const details = result.details;
  if (
    details.kind === "none" ||
    details.kind === "long-ledger-commit-proposal" ||
    details.kind === "long-continuity-commit-proposal"
  ) {
    throw new Error(
      `Expected a creation proposal: ${JSON.stringify(result.content)}`
    );
  }
  const operation = details.batch.operations[0];
  const entity =
    operation &&
    Object.values(operation).find(
      (value): value is { id: string } =>
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        typeof value.id === "string"
    );
  if (!entity) throw new Error("Missing created entity id");
  return entity.id;
}

function harness() {
  const index = fixtureWorldbuildingIndex();
  const executor = documentExecutor(index);
  const sharedState = createLongWorkspaceToolSharedState();
  const tools = () =>
    longTools({
      executor,
      sharedState,
      index
    });
  return { index, executor, sharedState, parent: tools(), child: tools() };
}

const CONTENT = "供后续子智能体读取的交接正文。";
const CASES = [
  {
    kind: "character",
    meta: { name: "交接人物", type_id: "major_supporting" },
    document: "core_profile"
  },
  {
    kind: "worldbuilding_item",
    meta: { title: "交接设定", category_id: "world_magic" }
  },
  { kind: "volume", meta: { title: "交接分卷" } },
  { kind: "arc", meta: { title: "交接剧情点", volume_id: "volume_one" } },
  { kind: "story_plot", meta: { title: "交接故事", arc_id: "arc_one" } },
  {
    kind: "chapter_card",
    meta: { title: "交接章节", volume_id: "volume_one" },
    document: "card"
  },
  { kind: "story_event", meta: { title: "交接事件" } },
  {
    kind: "foreshadowing",
    meta: { title: "交接伏笔" },
    content: `## 核心问题\n\n${CONTENT}`
  }
] as const;

describe("long workspace creation handoffs before Core saves proposals", () => {
  it.each(CASES)(
    "shares new $kind with an already-running reader",
    async (fixture) => {
      const { parent, child, executor, index } = harness();
      const original = JSON.stringify(index);
      // Prime the child's independent Core-index cache before the sibling creates.
      await toolByName(child, "read").execute("prime-index", {
        id: "book_line"
      });
      const result = await toolByName(parent, "create").execute("create", {
        kind: fixture.kind,
        meta: fixture.meta,
        content: "content" in fixture ? fixture.content : CONTENT
      });
      const id = createdId(result);
      const read = await toolByName(child, "read").execute("read-created", {
        id,
        ...("document" in fixture ? { document: fixture.document } : {})
      });
      expect(resultText(read)).toContain(CONTENT);
      if (
        fixture.kind === "character" ||
        fixture.kind === "worldbuilding_item"
      ) {
        const list = await toolByName(child, "list").execute("find-created", {
          stage: fixture.kind === "character" ? "character" : "worldbuilding",
          scope_id:
            fixture.kind === "character" ? "major_supporting" : "world_magic"
        });
        expect(resultText(list)).toContain(id);
      }
      expect(
        executor.mock.calls.filter(
          ([command]) => command.type === "long.getWorkspaceIndex"
        )
      ).toHaveLength(3);
      expect(JSON.stringify(index)).toBe(original);
    }
  );

  it("lets later creates reference pending volumes, arcs, events and foreshadowing", async () => {
    const { parent, child } = harness();
    const create = toolByName(parent, "create");
    const make = async (
      key: string,
      kind: string,
      meta: Record<string, unknown>
    ) => {
      const result = await create.execute(key, {
        kind,
        meta,
        content: CONTENT
      });
      const id = createdId(result);
      return id;
    };
    const volume = await make("volume", "volume", { title: "新增分卷" });
    const arc = await make("arc", "arc", {
      title: "新增剧情点",
      volume_id: volume
    });
    const first = await make("event-one", "story_event", {
      title: "新增事件一",
      arc_ids: [arc]
    });
    const second = await make("event-two", "story_event", {
      title: "新增事件二",
      arc_ids: [arc]
    });
    const connection = await make("connection", "event_connection", {
      source_event_id: first,
      target_event_id: second,
      type: "causes"
    });
    const placement = await make("placement", "narrative_placement", {
      event_id: first,
      chapter_card_id: "chapter_one",
      mode: "scene",
      disclosure: "hint"
    });
    const thread = await make("foreshadowing", "foreshadowing", {
      title: "新增伏笔线"
    });
    const beat = await make("beat", "foreshadowing_beat", {
      foreshadowing_id: thread,
      type: "plant",
      event_id: first
    });
    for (const id of [
      volume,
      arc,
      first,
      second,
      connection,
      placement,
      beat
    ]) {
      const result = await toolByName(child, "read").execute(`read-${id}`, {
        id
      });
      expect(resultText(result)).toContain(CONTENT);
    }
  });

  it("shares secondary empty character and chapter documents without querying absent Core files", async () => {
    const { parent, child, executor } = harness();
    const create = toolByName(parent, "create");
    const character = createdId(
      await create.execute("character", {
        kind: "character",
        meta: { name: "新人物", type_id: "major_supporting" },
        content: CONTENT
      })
    );
    const chapter = createdId(
      await create.execute("chapter", {
        kind: "chapter_card",
        meta: { title: "新章卡", volume_id: "volume_one" },
        content: CONTENT
      })
    );
    for (const [id, document] of [
      [character, "relationships"],
      [chapter, "body"],
      [chapter, "character_state"],
      [chapter, "handoff"],
      [chapter, "foreshadowing_changes"]
    ]) {
      const read = await toolByName(child, "read").execute(`read-${document}`, {
        id,
        document
      });
      expect(resultText(read)).toContain("（正文为空）");
    }
    expect(
      executor.mock.calls.some(
        ([command]) => command.type === "long.readDocument"
      )
    ).toBe(false);
  });

  it("does not duplicate pending objects after Core has saved their creation", async () => {
    const { parent, index, sharedState } = harness();
    const result = await toolByName(parent, "create").execute("character", {
      kind: "character",
      meta: { name: "已保存的新人物", type_id: "major_supporting" },
      content: CONTENT
    });
    const id = createdId(result);
    if (result.details.kind !== "long-character-file-proposal")
      throw new Error("Missing character proposal");
    const saved = applyLongWorkspaceOperations(
      index,
      result.details.batch
    ).snapshot;
    const overlaid = sharedState.proposalOverlay.applyToIndex(saved);
    expect(overlaid.characters.filter((entry) => entry.id === id)).toHaveLength(
      1
    );
    expect(
      overlaid.characterFiles.filter((entry) => entry.characterId === id)
    ).toHaveLength(1);
  });
});
