import { describe, expect, it, vi } from "vitest";
import { validateToolArguments, type JsonObject } from "@earendil-works/pi-ai";
import {
  createShortWorkspaceContentRevision,
  LIBRARY_AGENT_ENTRY_MAX_CHARACTERS
} from "@deepwrite/contracts";
import type { AgentRunInput } from "../runtime-types";
import { createLibraryManagementRuntime } from "../library-management-runtime";
import { materialWorkspace } from "../library-agent-tools/test-fixtures";
import { toRuntimeEvents } from "../event-mapping";
import { libraryExecutor } from "./test-support";

function fixture() {
  const workspace = materialWorkspace();
  const executor = libraryExecutor(workspace);
  const input: AgentRunInput = {
    sessionId: "session",
    runId: "run",
    prompt: "管理素材",
    libraryManagement: {
      scope: { bookId: "book", bookType: "short" },
      managers: [{ domain: "material", description: "管理素材" }],
      libraries: [
        {
          domain: "material",
          libraryId: workspace.libraryId,
          title: workspace.title,
          readOnly: false
        }
      ]
    },
    libraryManagementCommandExecutor: executor
  };
  const runtime = createLibraryManagementRuntime(input);
  const call = (name: string, params: Record<string, unknown>) =>
    runtime.tools
      .find((t) => t.name === name)!
      .execute(name, { library_id: workspace.libraryId, ...params });
  return { workspace, executor, input, runtime, call };
}
const create = (name: string) => ({
  action: "create",
  stage_id: "character",
  name,
  description: "人物设定",
  body: "正文"
});
const content = (value: unknown) => JSON.stringify(value);

describe("work-scoped library tools", () => {
  it("reads the library introduction only with include=overview", async () => {
    const f = fixture();
    const read = f.runtime.tools.find((tool) => tool.name === "library_read")!;
    expect(
      JSON.stringify(f.runtime.tools.map((tool) => tool.parameters))
    ).not.toContain('"type":"boolean"');
    const run = (args: JsonObject) =>
      read.execute(
        "read",
        validateToolArguments(read, {
          type: "toolCall",
          id: "read",
          name: read.name,
          arguments: { library_id: f.workspace.libraryId, ...args }
        })
      );

    expect(() => run({ include: true })).toThrow("include");
    expect(content(await run({ overview: true }))).toContain(
      "include=overview"
    );
    expect(
      content(await run({ entry_ids: [f.workspace.entries[0]!.id] }))
    ).not.toContain("【库介绍】");
    expect(content(await run({ include: "overview" }))).toContain("【库介绍】");
    expect(content(await run({ include: "overview" }))).toContain(
      f.workspace.overview
    );
  });

  it("validates an entire batch before emitting any mutation or keeping drafts", async () => {
    const f = fixture();
    const failed = await f.call("library_write", {
      operations: [create("新人物"), create("新人物")]
    });
    expect(content(failed)).toContain("未提交任何变更");
    expect(failed.details).toEqual({ kind: "none" });
    expect(content(await f.call("library_list", {}))).not.toContain("新人物");
    const unchanged = await f.call("library_write", {
      operations: [create("甲"), { action: "edit_overview" }]
    });
    expect(content(unchanged)).toContain("库介绍没有实际变化");
    expect(content(await f.call("library_list", {}))).not.toContain("甲");
    expect(
      (await f.call("library_write", { operations: [create("新人物")] }))
        .details
    ).toMatchObject({ operation: "create" });
  });

  it("emits one scoped proposal per target with distinct creation ids from a single call", async () => {
    const f = fixture();
    const result = await f.call("library_write", {
      operations: [create("甲"), create("乙")]
    });
    const events = toRuntimeEvents(
      {
        type: "tool_execution_end",
        toolCallId: "batch",
        toolName: "library_write",
        isError: false,
        result
      },
      f.input,
      { provider: "test", model: "test", mode: "provider" },
      "message"
    );
    const proposals = events.filter(
      (event) => event.type === "library.editor_mutation"
    );
    expect(proposals).toHaveLength(2);
    expect(new Set(proposals.map((p) => p.payload.creationId)).size).toBe(2);
    for (const event of proposals)
      expect(event.payload).toMatchObject({
        toolCallId: "batch",
        managementScope: f.input.libraryManagement!.scope
      });
  });

  it("requires a read before editing and rejects over-limit fragment edits", async () => {
    const f = fixture();
    const entry = f.workspace.entries[0]!;
    entry.content = "a".repeat(LIBRARY_AGENT_ENTRY_MAX_CHARACTERS - 2) + "唯一";
    const edit = {
      action: "edit",
      entry_id: entry.id,
      mode: "replace_fragments",
      replacements: [{ original_text: "唯一", new_text: "过长内容" }]
    };
    expect(
      content(await f.call("library_write", { operations: [edit] }))
    ).toContain("请先");
    await f.call("library_read", { entry_ids: [entry.id] });
    const result = await f.call("library_write", { operations: [edit] });
    expect(content(result)).toContain("上限");
    expect(result.details).toEqual({ kind: "none" });
  });

  it("requires replace_all for each whole-text replacement in a batch", async () => {
    const f = fixture();
    const entry = f.workspace.entries[0]!;
    const tool = f.runtime.tools.find((item) => item.name === "library_write")!;
    const operations = [
      {
        action: "edit",
        entry_id: entry.id,
        mode: "replace",
        body: "新条目正文。"
      },
      { action: "edit_overview", mode: "replace", body: "新库介绍。" }
    ] as const;
    const validate = (items: JsonObject[]) =>
      validateToolArguments(tool, {
        type: "toolCall",
        id: "batch-overwrite",
        name: tool.name,
        arguments: { library_id: f.workspace.libraryId, operations: items }
      });
    await f.call("library_read", {
      entry_ids: [entry.id],
      include: "overview"
    });

    expect(() =>
      validate([{ ...operations[0], overwrite_mode: [null, null, null, 1] }])
    ).toThrow("overwrite_mode");
    const blocked = await tool.execute(
      "batch-blocked",
      validate([
        { ...operations[0], overwrite_mode: "replace_all" },
        operations[1]!
      ])
    );
    expect(content(blocked)).toContain("overwrite_mode=replace_all");
    expect(blocked.details).toEqual({ kind: "none" });

    const allowed = await tool.execute(
      "batch-overwrite",
      validate(
        operations.map((op) => ({ ...op, overwrite_mode: "replace_all" }))
      )
    );
    expect(allowed.details).toMatchObject({
      items: [
        { kind: "library-entry-mutation", text: "新条目正文。" },
        { kind: "library-overview-mutation", text: "新库介绍。" }
      ]
    });
  });

  it("reloads user-edited saved text after review and does not retain rejected creations", async () => {
    const f = fixture();
    const entry = f.workspace.entries[0]!;
    await f.call("library_read", { entry_ids: [entry.id] });
    await f.call("library_write", {
      operations: [
        {
          action: "edit",
          entry_id: entry.id,
          mode: "append",
          body: "模型追加"
        },
        create("被拒绝的条目")
      ]
    });
    entry.content = "用户审阅时修改的内容";
    f.workspace.projectRevision = (f.workspace.projectRevision ?? 0) + 1;
    f.runtime.reset?.();
    expect(content(await f.call("library_list", {}))).not.toContain(
      "被拒绝的条目"
    );
    expect(
      content(await f.call("library_read", { entry_ids: [entry.id] }))
    ).toContain(entry.content);
    expect(
      (
        await f.call("library_write", {
          operations: [
            { action: "edit", entry_id: entry.id, mode: "append", body: "继续" }
          ]
        })
      ).details
    ).toMatchObject({
      baseRevision: createShortWorkspaceContentRevision(entry.content),
      baseProjectRevision: f.workspace.projectRevision
    });
  });

  it("keeps reads of unchanged entries across a review and asks to re-read changed ones", async () => {
    const f = fixture();
    const [first, second] = f.workspace.entries as [
      (typeof f.workspace.entries)[number],
      (typeof f.workspace.entries)[number]
    ];
    const append = (entryId: string, body: string) => ({
      operations: [{ action: "edit", entry_id: entryId, mode: "append", body }]
    });
    await f.call("library_read", { entry_ids: [first.id, second.id] });
    const proposed = (await f.call("library_write", append(first.id, "追加")))
      .details as { text: string };
    // Accepted unchanged: the saved text is what the agent proposed.
    first.content = proposed.text;
    f.runtime.reset?.();
    expect(
      (await f.call("library_write", append(second.id, "未变化的条目"))).details
    ).toMatchObject({ kind: "library-entry-mutation", entryId: second.id });
    expect(
      (await f.call("library_write", append(first.id, "已保存的提案"))).details
    ).toMatchObject({ kind: "library-entry-mutation", entryId: first.id });
    // Changed during review: the agent's view is stale until it reads again.
    first.content = "用户审阅时改写的正文";
    f.runtime.reset?.();
    const stale = await f.call("library_write", append(first.id, "继续"));
    expect(content(stale)).toContain("重新读取");
    expect(stale.details).toEqual({ kind: "none" });
    await f.call("library_read", { entry_ids: [first.id] });
    expect(
      (await f.call("library_write", append(first.id, "继续"))).details
    ).toMatchObject({
      baseRevision: createShortWorkspaceContentRevision(first.content)
    });
  });

  it("asks to re-read an entry whose proposal was rejected", async () => {
    const f = fixture();
    const entry = f.workspace.entries[0]!;
    const append = {
      operations: [
        { action: "edit", entry_id: entry.id, mode: "append", body: "追加" }
      ]
    };
    await f.call("library_read", { entry_ids: [entry.id] });
    await f.call("library_write", append);
    f.runtime.reset?.();
    expect(content(await f.call("library_write", append))).toContain(
      "重新读取"
    );
  });

  it("never interprets missing read data as an empty document", async () => {
    const f = fixture();
    await f.call("library_list", {});
    f.executor.mockResolvedValueOnce({
      status: "accepted",
      requestId: "read",
      payload: { libraries: [], documents: [] }
    });
    const result = await f.call("library_read", {
      entry_ids: [f.workspace.entries[0]!.id]
    });
    expect(content(result)).toContain("读取不完整");
  });

  it("follows Core directory pages without loading bodies", async () => {
    const f = fixture();
    const real = f.executor.getMockImplementation()!;
    f.executor.mockImplementation(async (command, signal) => {
      const response = await real(command, signal);
      if (
        command.payload.request?.kind === "directory" &&
        response.status === "accepted"
      ) {
        const payload = response.payload as {
          directory: { entries: unknown[]; nextOffset?: number };
        };
        if (!command.payload.request.offset) payload.directory.nextOffset = 512;
        else
          payload.directory.entries = [
            {
              entryId: "later",
              documentId: "later-doc",
              title: "后续条目",
              stageId: "character",
              contentBytes: 20
            }
          ];
      }
      return response;
    });
    expect(content(await f.call("library_list", {}))).toContain("后续条目");
    expect(
      f.executor.mock.calls.map(([command]) => command.payload.request?.kind)
    ).toEqual(["directory", "directory"]);
  });

  it("searches without a library id and exposes the continuation offset", async () => {
    const f = fixture();
    f.executor.mockResolvedValueOnce({
      status: "accepted",
      requestId: "search",
      payload: {
        libraries: [],
        search: {
          entries: [
            {
              libraryId: f.workspace.libraryId,
              entryId: f.workspace.entries[0]!.id,
              title: "目标",
              stageId: "character",
              titleHit: true,
              hits: []
            }
          ],
          limited: true,
          nextOffset: 2
        }
      }
    });
    const result = await f.runtime.tools
      .find((t) => t.name === "library_search")!
      .execute("search", { query: "目标" });
    expect(content(result)).toContain("offset=2");
    expect(f.executor.mock.calls[0]![0].payload.libraryId).toBeUndefined();
    expect(f.executor.mock.calls[0]![0].payload.domain).toBe("material");
  });

  it("selects a management domain and rejects a conflicting library id across all read tools", async () => {
    const f = fixture();
    const list = f.runtime.tools.find((tool) => tool.name === "library_list")!;
    expect(
      content(await list.execute("list", { domain: "material" }))
    ).toContain(f.workspace.libraryId);
    expect(
      content(await list.execute("list", { domain: "skill" }))
    ).not.toContain(f.workspace.libraryId);
    for (const name of ["library_list", "library_read", "library_search"])
      expect(
        content(await f.call(name, { domain: "skill", query: "素材" }))
      ).toContain("不一致");
    expect(f.executor).not.toHaveBeenCalled();
  });

  it("batches a same-library copy and recoverable deletion as one review-only structure plan", async () => {
    const f = fixture();
    const real = f.executor.getMockImplementation()!;
    const planExecutor = vi.fn(async (command: Parameters<typeof real>[0]) => {
      const request = command.payload.request!;
      if (request.kind !== "preview-structure") return real(command);
      const { kind: _kind, ...plan } = request;
      return {
        status: "accepted" as const,
        requestId: command.id,
        payload: {
          libraries: [],
          plan: {
            ...plan,
            domain: "material",
            baseVersion: "a".repeat(64),
            summary: "删除并保留备份"
          }
        }
      };
    });
    f.executor.mockImplementation(planExecutor);
    const result = await f.call("library_organize", {
      operations: [
        { action: "copy", entry_ids: [f.workspace.entries[0]!.id] },
        { action: "delete", entry_ids: [f.workspace.entries[0]!.id] }
      ]
    });
    expect(result.details).toMatchObject({
      kind: "library-structure-mutation",
      plan: {
        operations: [
          {
            action: "copy-entries",
            target: { kind: "library", libraryId: f.workspace.libraryId }
          },
          { action: "archive-entries" }
        ]
      }
    });
  });
});
