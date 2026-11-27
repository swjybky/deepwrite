import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentPromptCommandPayloadSchema,
  DEFAULT_CONTEXT_COMPACTION_BUDGET_TOKENS,
  DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES,
  ExtrasAgentRunRequestSchema,
  ExtrasAgentRunSpecSchema,
  SessionPromptCommandPayloadSchema,
  type AgentPromptCommandPayload,
  type AgentProviderRuntimeConfig
} from "@deepwrite/contracts";
import {
  PiAgentRuntimeAdapter,
  type AgentRuntimeEvent
} from "@deepwrite/pi-runtime-adapter";
import {
  profile as libraryProfile,
  materialWorkspace,
  skillWorkspace
} from "../../../../packages/pi-runtime-adapter/src/library-agent-tools/library-tools.test-support";
import {
  shortProfile,
  shortWorkspace
} from "../../../../packages/pi-runtime-adapter/src/short-agent-tools.test-support";
import {
  profile as longProfile,
  workspace as longWorkspace
} from "../../../../packages/pi-runtime-adapter/src/long-agent-tools.test-support";
import { chatNormalTask } from "../../../../packages/pi-runtime-adapter/src/extras/agents/chat.test-support";
import { createAgentRunInput } from "./agent-run-input";

type Domain = "skill" | "material" | "short" | "script" | "long" | "chat";
const config: AgentProviderRuntimeConfig = {
  id: "long-prompt-fixture",
  label: "Long prompt fixture",
  provider: "openai",
  api: "openai-completions",
  modelId: "long-prompt-fixture",
  baseUrl: "https://api.example.test/v1",
  apiKey: "invalid-long-prompt-fixture-key",
  reasoning: false,
  defaultThinkingLevel: "off",
  thinkingLevelOptions: ["low", "high"],
  temperatureOptions: [0.2, 0.7, 1],
  contextWindow: 2_000_000,
  maxTokens: 4_096
};

function workspaceFields(domain: Exclude<Domain, "chat">) {
  if (domain === "skill" || domain === "material") {
    return {
      libraryAgentProfile: libraryProfile(domain),
      workspaceContext: {
        libraryWorkspace:
          domain === "skill" ? skillWorkspace() : materialWorkspace()
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
  if (domain === "script") {
    return {
      scriptAgentProfile: DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0]!,
      workspaceContext: {
        scriptWorkspace: { ...shortWorkspace("draft"), activeAgentId: "script" }
      }
    };
  }
  return {
    agentProfile: shortProfile(),
    workspaceContext: { shortWorkspace: shortWorkspace("draft") }
  };
}

function start(
  domain: Domain,
  message: string,
  model = config,
  budgetTokens = DEFAULT_CONTEXT_COMPACTION_BUDGET_TOKENS
) {
  const runtime = new PiAgentRuntimeAdapter();
  const common = {
    sessionId: `session-long-prompt-${domain}`,
    thinkingLevel: "off" as const
  };
  const settings = {
    enabled: true,
    budgetTokens
  };
  if (domain === "chat") {
    const request = ExtrasAgentRunRequestSchema.parse({
      ...common,
      task: { agentId: "chat-normal", profileId: "default", input: {} },
      conversation: { message }
    });
    return runtime.startExtras({
      runId: "run-long-prompt",
      spec: ExtrasAgentRunSpecSchema.parse({
        ...request,
        task: chatNormalTask(),
        runtimeConfig: model,
        contextCompactionSettings: settings
      })
    });
  }
  const request = SessionPromptCommandPayloadSchema.parse({
    ...common,
    message
  });
  const payload: AgentPromptCommandPayload =
    AgentPromptCommandPayloadSchema.parse({
      ...request,
      ...workspaceFields(domain),
      runtimeConfig: model,
      contextCompactionSettings: settings
    });
  return runtime.start(
    createAgentRunInput(
      payload,
      "run-long-prompt",
      new AbortController().signal
    )
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("long prompt transport through the Agent runtime", () => {
  it.each(["skill", "chat"] as const)(
    "rechecks the authoritative %s compaction budget in the Agent",
    async (domain) => {
      const fetcher = vi.fn<typeof fetch>();
      vi.stubGlobal("fetch", fetcher);
      const collect = async () => {
        const events: AgentRuntimeEvent[] = [];
        for await (const event of start(
          domain,
          "字".repeat(60_000),
          config,
          64_000
        ))
          events.push(event);
        return events;
      };
      await expect(collect()).rejects.toThrow("预留 10% 余量");
      expect(fetcher).not.toHaveBeenCalled();
    }
  );

  it.each(["skill", "material", "short", "script", "long", "chat"] as const)(
    "delivers the complete %s message to the provider",
    async (domain) => {
      const length = domain === "skill" ? 1_000_000 : 80_000;
      const prefix = "开头：请处理以下长文本。\n";
      const suffix = "\n结尾：保留最后这条要求。";
      const message = `${prefix}${"长".repeat(length - prefix.length - suffix.length)}${suffix}`;
      const requests: Array<{
        messages: Array<{ role: string; content: unknown }>;
      }> = [];
      const fetcher: typeof fetch = async (_input, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return new Response(
          `data: ${JSON.stringify({
            id: "long-prompt-response",
            object: "chat.completion.chunk",
            created: 0,
            model: config.modelId,
            choices: [
              {
                index: 0,
                delta: { content: "已读取完整长消息。" },
                finish_reason: "stop"
              }
            ]
          })}\n\ndata: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } }
        );
      };
      vi.stubGlobal("fetch", fetcher);
      const events: AgentRuntimeEvent[] = [];
      for await (const event of start(domain, message, config, 2_000_000))
        events.push(event);
      expect(events.filter((event) => event.type === "agent.error")).toEqual(
        []
      );
      expect(events.at(-1)?.type).toBe("agent.completed");
      expect(requests).toHaveLength(1);
      const user = requests[0]!.messages.find((item) => item.role === "user");
      const text =
        typeof user?.content === "string"
          ? user.content
          : (user?.content as Array<{ text?: string }>)
              .map((item) => item.text ?? "")
              .join("");
      expect(text).toContain(message);
    }
  );

  it("reports the selected model's capacity when the intact long message cannot fit", async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    const events: AgentRuntimeEvent[] = [];
    for await (const event of start("skill", "字".repeat(60_000), {
      ...config,
      contextWindow: 32_000
    }))
      events.push(event);
    expect(fetcher).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "agent.error",
        payload: expect.objectContaining({
          message: expect.stringContaining("超过模型上下文容量")
        })
      })
    );
  });
});
