import { createLongWorkspaceToolSharedState } from "./long-agent-tools";
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

const DUPLICATE_CHAPTER_PARAMS = {
  kind: "chapter_card",
  meta: { title: "第二章", volume_id: "volume_one" },
  summary: "新建第二章"
} as const;

describe("unified long-form tools: duplicate chapter card creates", () => {
  it("rejects a repeated same-title chapter card create within one run", async () => {
    const tools = longTools({ executor: documentExecutor(fixtureIndex()) });
    const create = toolByName(tools, "create");

    const first = await create.execute("create-chapter-first", {
      ...DUPLICATE_CHAPTER_PARAMS
    });
    expect(first.details).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        operations: [expect.objectContaining({ type: "chapter.create" })]
      }
    });

    const second = await create.execute("create-chapter-second", {
      ...DUPLICATE_CHAPTER_PARAMS
    });
    expect(resultText(second)).toContain("目标条目已经存在");
    expect(resultText(second)).toContain("第二章");
    expect(second.details).toMatchObject({ kind: "none" });

    const third = await create.execute("create-chapter-third", {
      ...DUPLICATE_CHAPTER_PARAMS
    });
    expect(resultText(third)).toContain("目标条目已经存在");
  });

  it("still creates distinct chapter cards with different titles", async () => {
    const tools = longTools({ executor: documentExecutor(fixtureIndex()) });
    const create = toolByName(tools, "create");

    await create.execute("create-chapter-second", DUPLICATE_CHAPTER_PARAMS);
    const other = await create.execute("create-chapter-third", {
      kind: "chapter_card",
      meta: { title: "第三章", volume_id: "volume_one" },
      summary: "新建第三章"
    });
    expect(other.details).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        operations: [
          expect.objectContaining({
            type: "chapter.create",
            chapterCard: expect.objectContaining({ title: "第三章" })
          })
        ]
      }
    });
  });

  it("rejects duplicate chapter card creates across parent and child agents", async () => {
    const executor = documentExecutor(fixtureIndex());
    const sharedState = createLongWorkspaceToolSharedState();
    const parentTools = longTools({ executor, sharedState });
    const childTools = longTools({ executor, sharedState });

    const parentProposal = await toolByName(parentTools, "create").execute(
      "parent-create-chapter",
      DUPLICATE_CHAPTER_PARAMS
    );
    expect(parentProposal.details).toMatchObject({
      kind: "long-mutation-proposal"
    });

    const childDuplicate = await toolByName(childTools, "create").execute(
      "child-create-chapter",
      DUPLICATE_CHAPTER_PARAMS
    );
    expect(resultText(childDuplicate)).toContain("目标条目已经存在");
  });
});
