import {
  AgentPromptCommandPayloadSchema,
  DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES,
  type AgentPromptCommandPayload,
  type AgentProviderRuntimeConfig
} from "@deepwrite/contracts";
import {
  PiAgentRuntimeAdapter,
  type AgentRuntimeEvent
} from "@deepwrite/pi-runtime-adapter";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  shortProfile,
  shortWorkspace
} from "../../../../packages/pi-runtime-adapter/src/short-agent-tools.test-support";
import {
  profile as longProfile,
  workspace as longWorkspace
} from "../../../../packages/pi-runtime-adapter/src/long-agent-tools.test-support";
import {
  materialWorkspace,
  profile as libraryProfile,
  skillWorkspace
} from "../../../../packages/pi-runtime-adapter/src/library-agent-tools/library-tools.test-support";
import { createAgentRunInput } from "./agent-run-input";

type Domain = "short" | "script" | "long" | "material" | "skill";
interface ToolPayload {
  tools: Array<{
    function: {
      name: string;
      parameters: { properties: Record<string, Record<string, unknown>> };
    };
  }>;
}

const config: AgentProviderRuntimeConfig = {
  id: "gemini-tool-schema",
  label: "Gemini tool schema test",
  provider: "openai",
  api: "openai-completions",
  modelId: "google/gemini-3.8-flash",
  baseUrl: "https://gateway.example.test/v1",
  reasoning: false,
  defaultThinkingLevel: "off",
  thinkingLevelOptions: ["low", "high"],
  temperatureOptions: [0.2, 0.7, 1.2],
  apiKey: "invalid-desktop-schema-test-key"
};

function domainInput(domain: Domain): Partial<AgentPromptCommandPayload> {
  if (domain === "short") {
    return {
      agentProfile: shortProfile(),
      workspaceContext: { shortWorkspace: shortWorkspace("draft") }
    };
  }
  if (domain === "script") {
    return {
      scriptAgentProfile: DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0]!,
      workspaceContext: {
        scriptWorkspace: {
          ...shortWorkspace("draft"),
          activeAgentId: "script"
        }
      }
    };
  }
  if (domain === "long") {
    return {
      longAgentProfile: longProfile("long"),
      workspaceContext: {
        longWorkspace: longWorkspace("long", "draft", "chapter_one")
      }
    };
  }
  return {
    libraryAgentProfile: libraryProfile(domain),
    workspaceContext: {
      libraryWorkspace:
        domain === "material" ? materialWorkspace() : skillWorkspace()
    }
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("desktop Agent utility Gemini gateway tool schemas", () => {
  it.each(["short", "script", "long", "material", "skill"] as const)(
    "sends portable tool schemas from the %s App workflow and completes its turn",
    async (domain) => {
      let payload: ToolPayload | undefined;
      const fetcher: typeof globalThis.fetch = async (input, init) => {
        const body =
          init?.body ??
          (input instanceof Request ? await input.clone().text() : "");
        payload = JSON.parse(String(body)) as ToolPayload;
        const chunk = {
          id: "completion-schema-test",
          object: "chat.completion.chunk",
          created: 0,
          model: config.modelId,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "检查完成。" },
              finish_reason: "stop"
            }
          ]
        };
        return new Response(
          `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } }
        );
      };
      vi.stubGlobal("fetch", fetcher);
      const commandPayload = AgentPromptCommandPayloadSchema.parse({
        sessionId: `session-schema-${domain}`,
        message: "检查当前工作区。",
        thinkingLevel: "off",
        runtimeConfig: config,
        ...domainInput(domain)
      });
      const input = createAgentRunInput(
        commandPayload,
        `run-schema-${domain}`,
        new AbortController().signal
      );
      const events: AgentRuntimeEvent[] = [];
      for await (const event of new PiAgentRuntimeAdapter().start(input)) {
        events.push(event);
      }
      expect(events.filter((event) => event.type === "agent.error")).toEqual(
        []
      );
      expect(events.some((event) => event.type === "agent.completed")).toBe(
        true
      );
      expect(payload).toBeDefined();
      const editNames =
        domain === "material" || domain === "skill"
          ? [`edit_${domain}_entry`, `edit_${domain}_library_overview`]
          : ["edit"];
      for (const name of editNames) {
        const properties = payload!.tools.find(
          (item) => item.function.name === name
        )!.function.parameters.properties;
        expect(properties.overwrite_mode).toMatchObject({
          type: "string",
          enum: ["replace_all"]
        });
        expect(properties.overwrite_mode).not.toHaveProperty("const");
        expect(properties).not.toHaveProperty("allow_overwrite_existing");
      }
      if (domain === "short" || domain === "script") {
        const readProperties = payload!.tools.find(
          (item) => item.function.name === "read"
        )!.function.parameters.properties;
        expect(readProperties.section_scope).toMatchObject({
          type: "string",
          enum: ["directory", "all_sections"]
        });
        expect(readProperties).not.toHaveProperty("include_all_sections");
      }
    }
  );
  it("reads the directory and then the selected section through the official Gemini OpenAI route", async () => {
    const officialConfig = {
      ...config,
      provider: "deepwrite-site",
      modelId: "gemini-3.8-flash-high",
      reasoning: true,
      defaultThinkingLevel: "high"
    };
    const requests: Array<Record<string, unknown>> = [];
    const fetcher: typeof globalThis.fetch = async (input, init) => {
      const body =
        init?.body ??
        (input instanceof Request ? await input.clone().text() : "");
      const payload = JSON.parse(String(body)) as Record<string, unknown>;
      requests.push(payload);
      const step = requests.length;
      const args =
        step === 1
          ? { kind: "draft", id: "draft", section_scope: "directory" }
          : { kind: "draft_section", id: "section-1", document: "body" };
      const delta =
        step <= 2
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: `call-read-${step}`,
                  type: "function",
                  function: { name: "read", arguments: JSON.stringify(args) },
                  extra_content: {
                    google: {
                      thought_signature: `opaque-query-signature-${step}`
                    }
                  }
                }
              ]
            }
          : { content: "已读到第一节正文。" };
      const chunk = {
        id: "completion-read-test",
        object: "chat.completion.chunk",
        created: 0,
        model: officialConfig.modelId,
        choices: [
          { index: 0, delta, finish_reason: step <= 2 ? "tool_calls" : "stop" }
        ]
      };
      return new Response(
        `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } }
      );
    };
    vi.stubGlobal("fetch", fetcher);
    const payload = AgentPromptCommandPayloadSchema.parse({
      sessionId: "session-official-gemini-read",
      message: "先查正文目录，再读取第一节正文。",
      thinkingLevel: "high",
      runtimeConfig: officialConfig,
      ...domainInput("short")
    });
    const events: AgentRuntimeEvent[] = [];
    for await (const event of new PiAgentRuntimeAdapter().start(
      createAgentRunInput(
        payload,
        "run-official-gemini-read",
        new AbortController().signal
      )
    )) {
      events.push(event);
    }
    expect(events.filter((event) => event.type === "agent.error")).toEqual([]);
    expect(events.some((event) => event.type === "agent.completed")).toBe(true);
    expect(requests).toHaveLength(3);
    for (const request of requests.slice(1)) {
      const messages = request.messages as Array<Record<string, unknown>>;
      const calls = messages.flatMap((message) =>
        message.role === "assistant"
          ? (message.tool_calls as Array<Record<string, unknown>>)
          : []
      );
      calls.forEach((call, index) => {
        expect(call).toHaveProperty(
          "extra_content.google.thought_signature",
          `opaque-query-signature-${index + 1}`
        );
      });
    }
    const results = (
      requests[2]!.messages as Array<Record<string, unknown>>
    ).filter((message) => message.role === "tool");
    expect(results).toMatchObject([
      {
        name: "read",
        tool_call_id: "call-read-1",
        content: expect.stringContaining("section-1")
      },
      {
        name: "read",
        tool_call_id: "call-read-2",
        content: expect.stringContaining("汽笛迟到了七分钟。")
      }
    ]);
  });
});
