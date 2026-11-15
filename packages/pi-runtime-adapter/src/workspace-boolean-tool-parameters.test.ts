import {
  DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES,
  type AgentProviderRuntimeConfig
} from "@deepwrite/contracts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { normalizeContext, validateToolArguments } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { buildProviderRuntime } from "./provider-runtime";
import {
  documentExecutor,
  fixtureIndex,
  longTools
} from "./long-agent-tools.test-support";
import {
  buildScriptWorkspaceTools,
  buildShortWorkspaceTools
} from "./short-agent-tools";
import {
  resultText,
  shortProfile,
  shortWorkspace,
  toolByName
} from "./short-agent-tools.test-support";

type WorkspaceType = "short" | "script" | "long";
type SchemaProfile = "native" | "portable";
interface ToolPayload {
  tools: Array<{
    function: {
      name: string;
      parameters: { properties: Record<string, Record<string, unknown>> };
    };
  }>;
}

const gatewayConfig: AgentProviderRuntimeConfig = {
  id: "gemini-gateway",
  label: "Gemini gateway",
  provider: "openai",
  api: "openai-completions",
  modelId: "google/gemini-3.8-flash",
  baseUrl: "https://gateway.example.test/v1",
  reasoning: false,
  defaultThinkingLevel: "off",
  thinkingLevelOptions: ["low", "medium", "high"],
  temperatureOptions: [0.2, 0.7, 1.2],
  apiKey: "invalid-schema-test-key"
};

function writingTools(workspaceType: "short" | "script") {
  const workspace = shortWorkspace("draft", { characterList: true });
  const input = {};
  return workspaceType === "short"
    ? buildShortWorkspaceTools({ ...input, workspace, profile: shortProfile() })
    : buildScriptWorkspaceTools({
        ...input,
        workspace: { ...workspace, activeAgentId: "script" },
        profile: DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0]!
      });
}

async function capturePayload(
  tools: AgentTool[],
  profile: SchemaProfile,
  declaration: "root" | "transcript"
): Promise<ToolPayload> {
  const { model, streamFn } = buildProviderRuntime(
    { ...gatewayConfig, toolSchemaProfile: profile },
    undefined,
    "off",
    { portableToolSchemaProfile: "writing-workspace" }
  );
  const context = normalizeContext({
    ...(declaration === "root" ? { tools } : {}),
    messages: [
      ...(declaration === "transcript"
        ? [
            {
              role: "system" as const,
              content: "",
              timestamp: 0,
              toolsAdded: tools
            }
          ]
        : []),
      { role: "user", content: "检查工具参数。", timestamp: 1 }
    ]
  });
  let payload: unknown;
  const stream = await streamFn(model, context, {
    onPayload: (value) => {
      payload = value;
      throw new Error("Captured payload before transport");
    }
  });
  await stream.result();
  expect(payload).toBeDefined();
  return payload as ToolPayload;
}

describe.each(["short", "script", "long"] as const)(
  "%s workspace boolean tool parameters",
  (workspaceType: WorkspaceType) => {
    it.each([
      ["native", "root"],
      ["native", "transcript"],
      ["portable", "root"],
      ["portable", "transcript"]
    ] as const)(
      "sends plain booleans through the Gemini gateway with %s schemas and %s declarations",
      async (profile, declaration) => {
        const tools =
          workspaceType === "long"
            ? longTools({ executor: documentExecutor(fixtureIndex()) })
            : writingTools(workspaceType);
        const payload = await capturePayload(tools, profile, declaration);
        const fields = [
          ["edit", "allow_overwrite_existing"],
          ...(workspaceType === "long"
            ? []
            : [["read", "include_all_sections"]])
        ];
        for (const [name, field] of fields) {
          const tool = payload.tools.find(
            (item) => item.function.name === name
          );
          expect(tool).toBeDefined();
          const parameter = tool!.function.parameters.properties[field!]!;
          expect(parameter).toMatchObject({ type: "boolean" });
          expect(parameter).not.toHaveProperty("enum");
          expect(parameter).not.toHaveProperty("const");
        }
      }
    );
  }
);

describe.each(["short", "script"] as const)(
  "%s workspace overwrite permission",
  (workspaceType) => {
    it.each(["", "替换后的正文。"])(
      "preserves existing content when overwrite permission is false or only truthy (content=%j)",
      async (content) => {
        const tools = writingTools(workspaceType);
        const read = toolByName(tools, "read");
        const edit = toolByName(tools, "edit");
        const targets = [
          { kind: "character_overview", id: "character_design" },
          { kind: "character", id: "character-lin" },
          { kind: "plot_stage", id: "plot_design" },
          { kind: "draft_section", id: "section-1", document: "body" },
          {
            kind: "draft_section",
            id: "section-1",
            document: "character_state"
          }
        ];
        for (const target of targets) {
          const before = resultText(await read.execute("read-before", target));
          for (const flag of [false, "true", 1]) {
            const args = { ...target, content, allow_overwrite_existing: flag };
            const params =
              flag === false
                ? validateToolArguments(edit, {
                    type: "toolCall",
                    id: "blocked-overwrite",
                    name: "edit",
                    arguments: args
                  })
                : args;
            const result = await edit.execute("blocked-overwrite", params);
            expect(resultText(result)).toContain(
              "allow_overwrite_existing=true"
            );
            expect(result.details).toMatchObject({ kind: "none" });
            expect(resultText(await read.execute("read-after", target))).toBe(
              before
            );
          }
        }
      }
    );

    it("reads the directory instead of all sections when include_all_sections is false", async () => {
      const read = toolByName(writingTools(workspaceType), "read");
      const params = validateToolArguments(read, {
        type: "toolCall",
        id: "read-directory",
        name: "read",
        arguments: { kind: "draft", id: "draft", include_all_sections: false }
      });
      const result = resultText(await read.execute("read-directory", params));
      expect(result).toContain("section-1");
      expect(result).not.toContain("汽笛迟到了七分钟。");
    });
  }
);

describe("long workspace overwrite permission", () => {
  it.each(["", "替换后的正文。"])(
    "preserves document and record content when permission is false or only truthy (content=%j)",
    async (content) => {
      const index = fixtureIndex();
      const beforeText = "需要保留的旧正文。";
      index.plot.volumes[0]!.summary = beforeText;
      const tools = longTools({
        index,
        executor: documentExecutor(index, {
          [index.chapters[0]!.body.id]: beforeText
        })
      });
      const read = toolByName(tools, "read");
      const edit = toolByName(tools, "edit");
      for (const target of [
        { id: "chapter_one", document: "body" },
        { id: "volume_one" }
      ]) {
        expect(resultText(await read.execute("read-before", target))).toContain(
          beforeText
        );
        for (const flag of [false, "true", 1]) {
          const args = { ...target, content, allow_overwrite_existing: flag };
          const params =
            flag === false
              ? validateToolArguments(edit, {
                  type: "toolCall",
                  id: "blocked-overwrite",
                  name: "edit",
                  arguments: args
                })
              : args;
          const result = await edit.execute("blocked-overwrite", params);
          expect(resultText(result)).toContain("allow_overwrite_existing=true");
          expect(result.details).toMatchObject({ kind: "none" });
          expect(
            resultText(await read.execute("read-after", target))
          ).toContain("该文档自上次读取后未变化，原文仍在上文。");
        }
      }
    }
  );
});
