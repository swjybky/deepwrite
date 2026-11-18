import { describe, expect, it, vi } from "vitest";
import { validateToolArguments, type JsonObject } from "@earendil-works/pi-ai";
import {
  CommandEnvelopeSchema,
  LibraryStructurePlanSchema
} from "@deepwrite/contracts";
import { buildDomainLibraryAgentTools } from "./domain-tools";
import { buildLibraryAgentTools } from "../library-agent-tools";
import {
  materialWorkspace,
  profile,
  toolByName,
  resultText
} from "./test-fixtures";

describe("library structure tools", () => {
  it("mounts exactly three structural tools only in the domain entry and accumulates a review batch", async () => {
    const input = {
      workspace: materialWorkspace(),
      profile: profile("material")
    };
    const executor = vi.fn(async (command: unknown) => {
      const parsed = CommandEnvelopeSchema.parse(command);
      if (parsed.type !== "catalog.previewLibraryStructure")
        throw new Error("unexpected command");
      return {
        status: "accepted" as const,
        requestId: parsed.id,
        payload: LibraryStructurePlanSchema.parse({
          ...parsed.payload,
          baseVersion: "a".repeat(64),
          summary: "待整理"
        })
      };
    });
    const tools = buildDomainLibraryAgentTools(input, {
      runId: "run",
      sessionId: "session",
      prompt: "整理",
      libraryAgentCommandExecutor: executor
    });
    const names = ["manage_library", "manage_group", "organize_entries"];
    expect(
      tools.filter((tool) => names.includes(tool.name)).map((tool) => tool.name)
    ).toEqual(names);
    expect(
      buildLibraryAgentTools(input).some((tool) => names.includes(tool.name))
    ).toBe(false);
    expect(
      JSON.stringify(toolByName(tools, "manage_library").parameters)
    ).not.toContain("libraryType");
    expect(
      JSON.stringify(toolByName(tools, "create_material_entry").parameters)
    ).not.toContain("library_type");
    const first = await toolByName(tools, "manage_library").execute("one", {
      operations: [
        {
          action: "create-library",
          ref: "new",
          title: "新库",
          kind: "plot",
          libraryType: "short"
        }
      ]
    });
    expect(resultText(first)).toContain("待用户接受");
    const second = await toolByName(tools, "manage_group").execute("two", {
      operations: [
        {
          action: "create-group",
          ref: "group",
          title: "分组",
          members: { plot: "new" }
        }
      ]
    });
    expect(second.details).toMatchObject({
      kind: "library-structure-mutation",
      plan: {
        domain: "material",
        operations: [{ action: "create-library" }, { action: "create-group" }]
      }
    });
    expect(executor).toHaveBeenCalledTimes(2);
    expect(
      executor.mock.calls.every(
        ([command]) =>
          CommandEnvelopeSchema.parse(command).type ===
          "catalog.previewLibraryStructure"
      )
    ).toBe(true);
    const group = toolByName(tools, "manage_group");
    expect(JSON.stringify(group.parameters)).not.toContain('"type":"boolean"');
    const validateDelete = (args: JsonObject) =>
      validateToolArguments(group, {
        type: "toolCall",
        id: "delete",
        name: group.name,
        arguments: group.prepareArguments!({
          operations: [{ action: "delete-group", id: "group", ...args }]
        }) as JsonObject
      });
    expect(() => validateDelete({})).toThrow("deletion_scope");
    expect(() => validateDelete({ deletion_scope: true })).toThrow(
      "deletion_scope"
    );
    expect(() => validateDelete({ includeLibraries: true })).toThrow(
      "deletion_scope"
    );
    expect(executor).toHaveBeenCalledTimes(2);
    const retain = await group.execute(
      "retain-libraries",
      validateDelete({
        id: "retain",
        deletion_scope: "group_only"
      })
    );
    expect(retain.details).toMatchObject({
      plan: {
        operations: [
          { action: "create-library" },
          { action: "create-group" },
          { action: "delete-group", id: "retain", includeLibraries: false }
        ]
      }
    });
    const remove = await group.execute(
      "remove-libraries",
      validateDelete({
        id: "remove",
        deletion_scope: "group_and_libraries"
      })
    );
    expect(remove.details).toMatchObject({
      plan: {
        operations: [
          { action: "create-library" },
          { action: "create-group" },
          { action: "delete-group", id: "retain", includeLibraries: false },
          { action: "delete-group", id: "remove", includeLibraries: true }
        ]
      }
    });
  });
  it("routes unbound creation through the shared reviewed plan without editing the focus library", async () => {
    const executor = vi.fn(async (command: unknown) => {
      const parsed = CommandEnvelopeSchema.parse(command);
      if (parsed.type !== "catalog.previewLibraryStructure")
        throw new Error("unexpected command");
      return {
        status: "accepted" as const,
        requestId: parsed.id,
        payload: LibraryStructurePlanSchema.parse({
          ...parsed.payload,
          baseVersion: "a".repeat(64),
          summary: "新增未绑定素材"
        })
      };
    });
    const tools = buildDomainLibraryAgentTools(
      { workspace: materialWorkspace(), profile: profile("material") },
      {
        runId: "run",
        sessionId: "session",
        prompt: "暂存",
        libraryAgentCommandExecutor: executor
      }
    );
    const result = await toolByName(tools, "create_material_entry").execute(
      "loose",
      {
        target: "unbound",
        title: "暂存情节",
        stage_id: "pacing",
        name: "暂存情节",
        description: "用法",
        body: "正文"
      }
    );
    expect(result.details).toMatchObject({
      kind: "library-structure-mutation",
      plan: {
        operations: [{ action: "create-unbound-entry", title: "暂存情节" }]
      }
    });
    expect(executor).toHaveBeenCalledOnce();
  });
  it("rejects another tool's action before invoking Core", async () => {
    const executor = vi.fn();
    const tools = buildDomainLibraryAgentTools(
      { workspace: materialWorkspace(), profile: profile("material") },
      {
        runId: "run",
        sessionId: "session",
        prompt: "整理",
        libraryAgentCommandExecutor: executor
      }
    );
    const result = await toolByName(tools, "manage_library").execute("call", {
      operations: [{ action: "dissolve-group", id: "group" }]
    });
    expect(resultText(result)).toContain("不属于此工具");
    expect(executor).not.toHaveBeenCalled();
  });
});
