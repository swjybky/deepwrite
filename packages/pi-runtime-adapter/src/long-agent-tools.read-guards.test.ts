import { describe, expect, it, vi } from "vitest";
import {
  validateToolArguments,
  type JsonObject,
  type ToolResultMessage
} from "@earendil-works/pi-ai";
import { buildLongWorkspaceTools } from "./long-agent-tools";
import {
  fixtureIndex,
  profile,
  createLongWorkspaceNavigationSnapshot,
  toolByName,
  resultText
} from "./long-agent-tools.test-support";
import {
  manager,
  user,
  assistant,
  policy
} from "./kernel/context/context.test-support";
import { WORKSPACE_TOOL_COMPACTORS } from "./workspace-context-policy";

function harness(initial = "原文😀".repeat(12_000)) {
  const index = fixtureIndex();
  let body = initial;
  let notify!: (ids?: readonly string[]) => void;
  const executor = vi.fn(
    async (command: {
      id: string;
      type: string;
      payload: Record<string, unknown>;
    }) => {
      if (command.type === "long.getWorkspaceIndex")
        return {
          status: "accepted" as const,
          requestId: command.id,
          payload: { bookId: index.bookId, workspaceIndex: index }
        };
      const file = index.chapters[0]!.body;
      const characters = Array.from(body);
      const offset = command.payload.offset as number;
      const maximum = command.payload.maxCharacters as number;
      const content = characters.slice(offset, offset + maximum).join("");
      const end = offset + Array.from(content).length;
      return {
        status: "accepted" as const,
        requestId: command.id,
        payload: {
          bookId: index.bookId,
          file,
          content,
          offset,
          totalCharacters: characters.length,
          nextOffset: end < characters.length ? end : null
        }
      };
    }
  );
  const tools = buildLongWorkspaceTools({
    workspace: {
      bookId: index.bookId,
      title: "读取合成书",
      activeAgentId: "long",
      activeRoot: "draft",
      navigation: createLongWorkspaceNavigationSnapshot(index)
    },
    profile: profile("long"),
    sessionId: "session",
    runId: "read-guards",
    executor,
    onContextCompacted: (listener) => {
      notify = listener;
    }
  });
  let sequence = 0;
  async function call(
    name: string,
    args: JsonObject,
    id = `read-${++sequence}`
  ) {
    const tool = toolByName(tools, name);
    return tool.execute(
      id,
      validateToolArguments(tool, {
        type: "toolCall",
        id,
        name,
        arguments: args
      })
    );
  }
  return {
    call,
    executor,
    index,
    invalidate: (ids?: readonly string[]) => notify(ids),
    setBody: (text: string) => {
      body = text;
    }
  };
}

const target = { id: "chapter_one", document: "body" };
describe("long read retention and ranges", () => {
  it("deduplicates only retained unchanged full reads, preserving edit evidence", async () => {
    const h = harness("原文");
    expect(resultText(await h.call("read", target, "full-original"))).toContain(
      "原文"
    );
    expect(resultText(await h.call("read", target, "duplicate"))).toContain(
      "原文仍在上文"
    );
    h.invalidate(["duplicate"]);
    expect(resultText(await h.call("read", target))).toContain("原文仍在上文");
    await expect(
      h.call("edit", {
        ...target,
        replacements: [{ original_text: "原文", new_text: "改文" }]
      })
    ).resolves.toMatchObject({
      details: { kind: "long-chapter-write-proposal" }
    });
  });
  it("returns full text after its actual read result is pruned or summarized", async () => {
    const h = harness("原文");
    await h.call("read", target, "full");
    await h.call("read", target, "duplicate");
    h.invalidate(["full"]);
    expect(resultText(await h.call("read", target))).not.toContain(
      "原文仍在上文"
    );
    h.invalidate();
    expect(resultText(await h.call("read", target))).not.toContain(
      "原文仍在上文"
    );
    h.setBody("已被用户改动");
    expect(resultText(await h.call("read", target))).toContain("已被用户改动");
  });
  it("receives precise invalidation from actual context pruning", async () => {
    const h = harness();
    const read = await h.call("read", target, "full-read");
    const request = assistant();
    request.content = [
      { type: "toolCall", id: "full-read", name: "read", arguments: target }
    ];
    const result: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "full-read",
      toolName: "read",
      content: read.content,
      isError: false,
      timestamp: 2
    };
    const invalidated = vi.fn(h.invalidate);
    const { guard, events } = manager(
      [user("读取正文"), request, result, assistant()],
      {
        policy: {
          ...policy,
          task: "long",
          toolCompactors: WORKSPACE_TOOL_COMPACTORS
        },
        notifyCompacted: invalidated
      }
    );
    const incoming = user("继续", 3);
    guard.noteRunStart(incoming, incoming.content);
    await guard.beforeRun(incoming);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "agent.context_compaction",
          payload: expect.objectContaining({
            level: "prune",
            phase: "completed"
          })
        })
      ])
    );
    expect(invalidated).toHaveBeenCalledWith(["full-read"]);
    expect(resultText(await h.call("read", target))).toContain("本文较长");
    expect(resultText(await h.call("read", target))).toContain("原文仍在上文");
  });
  it.each(["head", "tail"] as const)(
    "reads a Unicode %s without an edit credential",
    async (range) => {
      const h = harness("开头😀中间😀结尾");
      const text = resultText(
        await h.call("read", { ...target, range, max_chars: 3 })
      );
      expect(text.startsWith("片段，修改前须完整读取。")).toBe(true);
      expect(text).toContain(range === "head" ? "开头😀" : "😀结尾");
      expect(
        h.executor.mock.calls
          .filter(([c]) => c.type === "long.readDocument")
          .every(([c]) => (c.payload.maxCharacters as number) <= 3)
      ).toBe(true);
      expect(
        resultText(
          await h.call("edit", {
            ...target,
            content: "覆盖",
            overwrite_mode: "replace_all"
          })
        )
      ).toContain("完整读取");
    }
  );
  it.each([0, 8_001, 1.5])(
    "rejects invalid range lengths (%s)",
    async (max_chars) => {
      const h = harness();
      await expect(
        h.call("read", { ...target, range: "tail", max_chars })
      ).rejects.toThrow(/max_chars/u);
      expect(h.executor).not.toHaveBeenCalled();
    }
  );
});

describe("read parameter compatibility", () => {
  it("defaults max_chars to head and never grants a full edit credential", async () => {
    const h = harness("开头😀中间结尾");
    const result = resultText(
      await h.call("read", { ...target, max_chars: 3 })
    );
    expect(result).toContain("【参数归一化】");
    expect(result).toContain("片段，修改前须完整读取");
    expect(result).toContain("开头😀");
    expect(result).not.toContain("中间结尾");
    expect(
      resultText(
        await h.call("edit", {
          ...target,
          content: "覆盖",
          overwrite_mode: "replace_all"
        })
      )
    ).toContain("完整读取");
  });
  it("drops only identical chapter_id and rejects conflicting chapter locations", async () => {
    const h = harness("正文");
    expect(
      resultText(await h.call("read", { ...target, chapter_id: target.id }))
    ).toContain("【参数归一化】");
    await expect(
      h.call("read", { ...target, chapter_id: "chapter_other" })
    ).rejects.toThrow("章节定位冲突");
  });
});
