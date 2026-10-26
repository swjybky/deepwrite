import { describe, expect, it } from "vitest";
import type {
  AgentToolTrace,
  ChatContextCompaction
} from "../types/conversation";
import {
  foldWorkGroups,
  type WorkGroupDisplayItem
} from "./conversationWorkGroups";
import { workGroupActivityLabel } from "./conversationActivityLabel";

function thinking(
  id: string,
  content = "思考"
): {
  id: string;
  type: "thinking";
  content: string;
  createdAt: string;
} {
  return {
    id,
    type: "thinking",
    content,
    createdAt: "2026-01-01T00:00:00.000Z"
  };
}

function response(
  id: string,
  content: string
): { id: string; type: "response"; content: string; createdAt: string } {
  return {
    id,
    type: "response",
    content,
    createdAt: "2026-01-01T00:00:00.000Z"
  };
}

function toolGroup(
  id: string,
  status: AgentToolTrace["status"] = "completed"
): {
  id: string;
  type: "tool-group";
  tools: AgentToolTrace[];
} {
  return {
    id,
    type: "tool-group",
    tools: [
      {
        id,
        name: "read_workspace_content",
        args: {},
        status,
        requestedAt: "2026-01-01T00:00:00.000Z"
      }
    ]
  };
}

function compaction(id: string, status: ChatContextCompaction["status"]) {
  return {
    id,
    type: "compaction" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    compaction: {
      id,
      status,
      reason: "run_limit" as const,
      level: "summary" as const,
      createdAt: "2026-01-01T00:00:00.000Z"
    }
  };
}

describe("foldWorkGroups", () => {
  it("merges consecutive thinking and tools into one work group", () => {
    const items = foldWorkGroups(
      [thinking("t1"), toolGroup("g1"), thinking("t2")],
      false
    );
    expect(items.map((item) => item.type)).toEqual(["work-group"]);
    expect(items[0]).toMatchObject({
      id: "work:t1",
      type: "work-group",
      running: false
    });
    expect(
      (items[0] as WorkGroupDisplayItem).items.map((item) => item.id)
    ).toEqual(["t1", "g1", "t2"]);
  });

  it("embeds compaction after its preceding work and before the next step", () => {
    const items = foldWorkGroups(
      [
        thinking("t1"),
        toolGroup("g1"),
        compaction("summary", "completed"),
        thinking("t2"),
        toolGroup("g2")
      ],
      false
    );
    expect(items).toHaveLength(1);
    expect(
      (items[0] as WorkGroupDisplayItem).items.map((item) => item.id)
    ).toEqual(["t1", "g1", "summary", "t2", "g2"]);
  });

  it("keeps compaction standalone when there is no preceding work group", () => {
    const items = foldWorkGroups(
      [
        compaction("before-work", "completed"),
        thinking("t1"),
        response("r1", "阶段汇报"),
        compaction("after-response", "completed"),
        thinking("t2")
      ],
      false
    );
    expect(items.map((item) => item.id)).toEqual([
      "before-work",
      "work:t1",
      "r1",
      "after-response",
      "work:t2"
    ]);
    expect((items[1] as WorkGroupDisplayItem).items).toEqual([thinking("t1")]);
    expect((items[4] as WorkGroupDisplayItem).items).toEqual([thinking("t2")]);
  });

  it("shows compaction activity only while the embedded compaction is running", () => {
    const summary = compaction("summary", "running");
    const members = [thinking("t1"), summary];
    const running = foldWorkGroups(members, true)[0] as WorkGroupDisplayItem;
    expect(running.running).toBe(true);
    expect(workGroupActivityLabel(running)).toBe("压缩上下文中");

    summary.compaction.status = "completed";
    const waiting = foldWorkGroups(members, true)[0] as WorkGroupDisplayItem;
    expect(waiting.running).toBe(false);
    expect(workGroupActivityLabel(waiting)).toBe("处理完成");

    const resumed = foldWorkGroups(
      [...members, thinking("t2")],
      true
    )[0] as WorkGroupDisplayItem;
    expect(resumed.running).toBe(true);
    expect(workGroupActivityLabel(resumed)).toBe("思考中");
  });

  it("breaks on visible responses, subagents and approval cards", () => {
    const items = foldWorkGroups(
      [
        thinking("t1"),
        response("r1", "正文"),
        toolGroup("g1"),
        {
          id: "subagent:child",
          type: "subagent" as const,
          createdAt: "2026-01-01T00:00:00.000Z"
        },
        thinking("t2"),
        {
          id: "edit:p1",
          type: "edit-proposal" as const,
          createdAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      false
    );
    expect(items.map((item) => item.type)).toEqual([
      "work-group",
      "response",
      "work-group",
      "subagent",
      "work-group",
      "edit-proposal"
    ]);
    expect(items.map((item) => item.id)).toEqual([
      "work:t1",
      "r1",
      "work:g1",
      "subagent:child",
      "work:t2",
      "edit:p1"
    ]);
  });

  it("skips empty responses so they do not split a work group", () => {
    const items = foldWorkGroups(
      [thinking("t1"), response("empty", ""), toolGroup("g1")],
      true
    );
    expect(items.map((item) => item.type)).toEqual(["work-group"]);
    expect((items[0] as WorkGroupDisplayItem).running).toBe(false);
    expect(
      (items[0] as WorkGroupDisplayItem).items.map((item) => item.id)
    ).toEqual(["t1", "g1"]);
  });

  it("keeps earlier thinking closed while a later tool executes", () => {
    const items = foldWorkGroups(
      [thinking("t1"), response("r1", "正文"), toolGroup("g1", "running")],
      true
    );
    expect(items.map((item) => item.type)).toEqual([
      "work-group",
      "response",
      "work-group"
    ]);
    expect((items[0] as WorkGroupDisplayItem).running).toBe(false);
    expect((items[2] as WorkGroupDisplayItem).running).toBe(true);
  });

  it("keeps completed work groups closed when a breaker follows", () => {
    const items = foldWorkGroups(
      [thinking("t1"), response("r1", "正文")],
      true
    );
    expect((items[0] as WorkGroupDisplayItem).running).toBe(false);
    expect(workGroupActivityLabel(items[0] as WorkGroupDisplayItem)).toBe(
      "处理完成"
    );
    const running = foldWorkGroups([thinking("t2"), toolGroup("g1")], true);
    expect(workGroupActivityLabel(running[0] as WorkGroupDisplayItem)).toBe(
      "处理完成"
    );
    const thinkingLast = foldWorkGroups(
      [toolGroup("g1"), thinking("after")],
      true
    );
    expect(
      workGroupActivityLabel(thinkingLast[0] as WorkGroupDisplayItem)
    ).toBe("思考中");
  });

  it.each(["completed", "error"] as const)(
    "does not keep a %s tool busy while the model is still streaming",
    (status) => {
      const group = foldWorkGroups(
        [thinking("before"), toolGroup("read", status)],
        true
      )[0] as WorkGroupDisplayItem;
      expect(group.running).toBe(false);
      expect(workGroupActivityLabel(group)).toBe("处理完成");
    }
  );

  it("distinguishes streamed arguments, queued calls and execution", () => {
    const tools = toolGroup("read", "preparing");
    const current = () =>
      foldWorkGroups([tools], true)[0] as WorkGroupDisplayItem;
    expect(workGroupActivityLabel(current())).toBe("准备工具调用");
    tools.tools[0]!.argumentsComplete = true;
    expect(workGroupActivityLabel(current())).toBe("等待执行");
    tools.tools[0]!.status = "running";
    expect(workGroupActivityLabel(current())).toBe("读取文件");
    tools.tools[0]!.status = "completed";
    expect(current().running).toBe(false);
    expect(workGroupActivityLabel(current())).toBe("处理完成");
  });

  it("names the executing tool even when later calls are queued or completed", () => {
    const tools = toolGroup("read", "running");
    tools.tools.push({
      ...tools.tools[0]!,
      id: "web",
      name: "web_search",
      status: "preparing",
      argumentsComplete: true
    });
    const current = () =>
      foldWorkGroups([tools], true)[0] as WorkGroupDisplayItem;
    expect(workGroupActivityLabel(current())).toBe("读取文件");
    tools.tools[1]!.status = "completed";
    expect(workGroupActivityLabel(current())).toBe("读取文件");
  });

  it("keeps queued work pending when a subagent card follows it", () => {
    const tools = toolGroup("read", "preparing");
    tools.tools[0]!.argumentsComplete = true;
    const items = foldWorkGroups(
      [tools, { id: "child", type: "subagent" }],
      true
    );
    const group = items[0] as WorkGroupDisplayItem;
    expect(group.running).toBe(true);
    expect(workGroupActivityLabel(group)).toBe("等待执行");
  });
});
