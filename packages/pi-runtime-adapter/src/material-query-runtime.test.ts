import { describe, expect, it, vi } from "vitest";
import {
  type CatalogQueryMaterialsCommand,
  type MaterialCatalogContext
} from "@deepwrite/contracts";
import { createMaterialQueryRunner } from "./material-query-runtime";
import {
  buildRuntimeUserPrompt,
  buildLongFollowUpTurnUserMessageContent
} from "./prompts";
import {
  buildShortWorkspaceTools,
  buildScriptWorkspaceTools
} from "./short-agent-tools";
import { buildLongWorkspaceTools } from "./long-agent-tools";
import {
  shortWorkspace,
  shortProfile,
  resultText,
  toolByName
} from "./short-agent-tools.test-support";
import { screenplayWorkspace, scriptAgentProfile } from "./index.test-support";
import {
  workspace as longWorkspace,
  profile as longProfile
} from "./long-agent-tools.test-support";
import type { AgentRunInput } from "./runtime-types";

const catalog: MaterialCatalogContext = {
  scope: {
    bookId: "book",
    bookType: "short",
    stageId: "plot_design",
    kinds: ["plot", "character"]
  },
  entries: [
    {
      id: "material:library:entry",
      title: "库 · 原标题",
      libraryId: "library",
      entryId: "entry",
      kind: "plot",
      revision: "v1:1:00000000",
      metadata: {
        name: "冲突升级",
        description: "适合剧情转折",
        nameSource: "configured",
        descriptionSource: "configured"
      }
    }
  ],
  total: 80,
  nextCursor: 64,
  notices: []
};

function run(): AgentRunInput {
  return {
    runId: "run",
    sessionId: "session",
    prompt: "继续创作",
    workspaceContext: {
      shortWorkspace: shortWorkspace(),
      materialCatalog: catalog
    },
    agentProfile: shortProfile(),
    materialCommandExecutor: vi.fn(
      async (command: CatalogQueryMaterialsCommand) => ({
        status: "accepted" as const,
        requestId: command.id,
        payload: {
          status: "ok",
          entries: catalog.entries,
          total: 80,
          nextCursor: 32,
          notices: [],
          ...(command.payload.mode === "read"
            ? {
                content: "---\nname: 冲突升级\n---\n完整原文",
                revisionChanged: true
              }
            : {})
        }
      })
    )
  };
}

describe("runtime material bridge", () => {
  it("uses Main's catalog on first and subsequent long turns, including pagination", () => {
    const input = run();
    const prompt = buildRuntimeUserPrompt(input);
    expect(prompt).toContain("冲突升级");
    expect(prompt).toContain("适合剧情转折");
    expect(prompt).toContain("共 80 条");
    expect(prompt).toContain("cursor=64");
    const { agentProfile: _profile, ...longBase } = input;
    const longInput: AgentRunInput = {
      ...longBase,
      longAgentProfile: longProfile("long"),
      workspaceContext: {
        longWorkspace: longWorkspace("long", "plot_design"),
        materialCatalog: catalog
      }
    };
    expect(buildLongFollowUpTurnUserMessageContent(longInput)).toContain(
      "冲突升级"
    );
  });

  it("binds the request identity, narrows kinds and detects changed content", async () => {
    const input = run();
    const signal = new AbortController().signal;
    const query = createMaterialQueryRunner(input)!;
    const text = await query(
      { mode: "read", entry_id: catalog.entries[0]!.id },
      ["plot"],
      signal
    );
    expect(input.materialCommandExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          sessionId: "session",
          runId: "run",
          resourceId: "book"
        }),
        payload: expect.objectContaining({
          scope: { ...catalog.scope, kinds: ["plot"] },
          expected_revision: catalog.entries[0]!.revision
        })
      }),
      signal
    );
    expect(text).toContain("最新原文");
    expect(text).toContain("---\nname: 冲突升级\n---\n完整原文");
    expect(await query({ mode: "list", cursor: 32 }, ["plot"])).toContain(
      "cursor=32"
    );
  });

  it("wires the existing material tool through the bridge for short, script and long workspaces", async () => {
    const input = run();
    const queryMaterials = createMaterialQueryRunner(input)!;
    const variants = [
      buildShortWorkspaceTools({
        workspace: shortWorkspace(),
        profile: shortProfile(),
        queryMaterials
      }),
      buildScriptWorkspaceTools({
        workspace: screenplayWorkspace(),
        profile: scriptAgentProfile(),
        queryMaterials
      }),
      buildLongWorkspaceTools({
        workspace: longWorkspace("long", "plot_design"),
        profile: longProfile("long"),
        sessionId: "session",
        runId: "run",
        queryMaterials
      })
    ];
    for (const tools of variants) {
      const result = await toolByName(
        tools,
        "query_linked_material_entries"
      ).execute("read", { mode: "read", entry_id: catalog.entries[0]!.id });
      expect(resultText(result)).toContain("完整原文");
    }
    expect(input.materialCommandExecutor).toHaveBeenCalledTimes(3);
  });

  it("surfaces rejected or incomplete reads instead of returning an empty successful body", async () => {
    const input = run();
    input.materialCommandExecutor = async (command) => ({
      status: "rejected",
      requestId: command.id,
      error: { code: "denied", message: "已撤销关联" }
    });
    await expect(
      createMaterialQueryRunner(input)!(
        { mode: "read", entry_id: catalog.entries[0]!.id },
        ["plot"]
      )
    ).rejects.toThrow("已撤销关联");
  });
});
