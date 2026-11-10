import { describe, expect, it, vi } from "vitest";
import { type StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxProvider,
  fauxAssistantMessage,
  type Api,
  type Model
} from "@earendil-works/pi-ai";
import {
  DEFAULT_LIBRARY_AGENT_PROFILES,
  createShortWorkspaceContentRevision,
  type LibraryAgentWorkspaceSnapshot
} from "@deepwrite/contracts";
import { libraryManagementParentPrompt } from "./library-management-runtime";
import { inspectTranscript } from "./transcript.test-support";
import { buildRunTools } from "./run-tools";
import { shortProfile, shortWorkspace } from "./short-agent-tools.test-support";
import { scriptAgentProfile, screenplayWorkspace } from "./index.test-support";
import { profile, workspace } from "./long-agent-tools.test-support";
import type { AgentRunInput } from "./runtime-types";

const runtime = {
  provider: "flow-test",
  model: "test",
  mode: "provider" as const
};
const managerWorkspace: LibraryAgentWorkspaceSnapshot = {
  domain: "material",
  libraryId: "materials",
  title: "情节素材库",
  kind: "plot",
  libraryType: "short",
  readOnly: false,
  projectRevision: 1,
  overview: "情节参考",
  overviewDocumentId: "overview",
  overviewRevision: createShortWorkspaceContentRevision("情节参考"),
  entries: []
};
function input(
  kind: "short" | "script" | "long",
  team: boolean
): AgentRunInput {
  return {
    sessionId: "session",
    runId: "run",
    prompt: "将刚才的情节记录为素材",
    ...(kind === "short"
      ? {
          agentProfile: shortProfile(),
          workspaceContext: { shortWorkspace: shortWorkspace() }
        }
      : kind === "script"
        ? {
            scriptAgentProfile: scriptAgentProfile(),
            workspaceContext: { scriptWorkspace: screenplayWorkspace() }
          }
        : {
            longAgentProfile: profile("long"),
            workspaceContext: {
              longWorkspace: workspace("long", "plot_design")
            }
          }),
    subagentDefinitions: team
      ? [
          {
            id: "writer",
            name: "写作成员",
            description: "处理写作任务",
            systemPrompt: "完成写作任务",
            enabled: true,
            agentMode: "standard",
            modelMode: "inherit"
          }
        ]
      : [],
    libraryManagement: {
      scope: { bookId: "book", bookType: kind },
      libraries: [
        {
          domain: "material",
          libraryId: "materials",
          title: "情节素材库",
          readOnly: false
        }
      ],
      managers: DEFAULT_LIBRARY_AGENT_PROFILES.map((profile) => ({
        domain: profile.domain,
        description: "管理已确认的资料"
      }))
    },
    libraryManagementCommandExecutor: vi.fn(async () => ({
      status: "accepted" as const,
      requestId: "query",
      payload: { libraries: [], workspace: managerWorkspace }
    }))
  };
}
function provider() {
  const faux = fauxProvider({
    api: "flow-test",
    provider: "flow-test",
    tokensPerSecond: 0,
    models: [{ id: "test", name: "Test", reasoning: true }]
  });
  const models = createModels();
  models.setProvider(faux.provider);
  return {
    faux,
    model: faux.getModel("test") as Model<Api>,
    streamFn: models.streamSimple.bind(models) as StreamFn
  };
}

describe("creative workspace management delegation", () => {
  it.each(["short", "script", "long"] as const)(
    "registers global managers and main questions in %s normal and team modes",
    async (kind) => {
      const { model, streamFn, faux } = provider();
      const childToolNames: string[][] = [];
      const childStream: StreamFn = (model, context, options) => {
        childToolNames.push(
          (inspectTranscript(context).tools ?? []).map((tool) => tool.name)
        );
        return streamFn(model, context, options);
      };
      for (const team of [false, true]) {
        const run = input(kind, team);
        const options = {
          model,
          streamFn: childStream,
          thinkingLevel: "off" as const,
          parentRuntime: runtime,
          toolExecutionHooks: {},
          portableToolSchemaProfile: "default" as const,
          getParentMessages: () => [],
          requestUserInput: vi.fn()
        };
        const tools = buildRunTools(run, options);
        expect(
          tools.filter((tool) => tool.name === "ask_user_question")
        ).toHaveLength(1);
        expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
        expect(
          tools.some(
            (tool) => tool.name === "manage_material_create_material_entry"
          )
        ).toBe(true);
        const spawn = tools.find((tool) => tool.name === "spawn_subagent");
        expect(Boolean(spawn)).toBe(team);
        expect(spawn?.description ?? "").not.toContain("builtin:");
        expect(libraryManagementParentPrompt(run)).toContain(
          "manage_material_"
        );
        if (spawn) {
          faux.setResponses([fauxAssistantMessage("任务已完成")]);
          await spawn.execute("spawn", {
            tasks: [{ subagent_id: "writer", task: "分析正文" }]
          });
          expect(childToolNames.flat()).toContain("read");
          expect(
            childToolNames
              .flat()
              .some(
                (name) =>
                  name.startsWith("manage_") ||
                  name.includes("agent_team_prompt")
              )
          ).toBe(false);
        }
        run.libraryManagement!.managers = [];
        expect(libraryManagementParentPrompt(run)).toBe("");
        expect(
          buildRunTools(run, options).some((tool) =>
            tool.name.startsWith("manage_")
          )
        ).toBe(false);
      }
    }
  );
});
