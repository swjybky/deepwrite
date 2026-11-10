import { describe, expect, it, vi } from "vitest";
import type { AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Api,
  type Context,
  type FauxResponseStep,
  type Model
} from "@earendil-works/pi-ai";
import {
  DEFAULT_LIBRARY_AGENT_PROFILES,
  createShortWorkspaceContentRevision,
  type LibraryAgentWorkspaceSnapshot,
  type SubagentAgentMode,
  type SubagentWebSearchMode
} from "@deepwrite/contracts";
import { scriptAgentProfile, screenplayWorkspace } from "../index.test-support";
import {
  profile as longProfile,
  workspace as longWorkspace
} from "../long-agent-tools.test-support";
import { buildEffectiveSystemPrompt } from "../prompts-system";
import { buildRunTools } from "../run-tools";
import type { AgentRunInput } from "../runtime-types";
import {
  shortProfile,
  shortWorkspace
} from "../short-agent-tools.test-support";
import { inspectTranscript } from "../transcript.test-support";
import { WEB_SEARCH_FETCH_PROMPT } from "./prompt";
import { runtimeConfig } from "./test-support";

const contextOf = (searching: boolean) =>
  searching
    ? {
        webSearch: runtimeConfig({ perRunCallLimit: 2 }),
        webSearchEnabled: true
      }
    : {};

const libraryWorkspace: LibraryAgentWorkspaceSnapshot = {
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

function member(
  agentMode: SubagentAgentMode,
  webSearchMode?: SubagentWebSearchMode
) {
  return {
    id: `member_${agentMode.replace("-", "_")}`,
    name: `成员-${agentMode}`,
    description: "测试成员",
    systemPrompt: "完成委派。",
    enabled: true,
    agentMode,
    ...(webSearchMode ? { webSearchMode } : {}),
    modelMode: "inherit" as const
  };
}

function harness(
  responses: FauxResponseStep[] = [fauxAssistantMessage("完成")]
) {
  const faux = fauxProvider({
    api: `mounting-${Math.random()}`,
    provider: `mounting-${Math.random()}`,
    tokensPerSecond: 0,
    models: [{ id: "test-model", name: "Test", reasoning: true }]
  });
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  const contexts: Context[] = [];
  const streamFn: StreamFn = (model, context, options) => {
    contexts.push(inspectTranscript(context));
    return models.streamSimple(model, context, options);
  };
  return {
    contexts,
    streamFn,
    model: faux.getModel("test-model") as Model<Api>
  };
}

function options(
  runtime: ReturnType<typeof harness>,
  mode: "provider" | "local-faux" = "provider"
) {
  return {
    ...runtime,
    parentRuntime: { provider: "test", model: "test-model", mode },
    thinkingLevel: "off" as const,
    toolExecutionHooks: {},
    requestUserInput: vi.fn(),
    getParentMessages: () => [],
    portableToolSchemaProfile: "writing-workspace" as const
  };
}

const names = (tools: readonly Pick<AgentTool, "name">[]) =>
  tools.map(({ name }) => name);
const SEARCH = "web_search";
const FETCH = "web_fetch";
const WEB_PAIR = [FETCH, SEARCH];
const webOf = (tools: readonly Pick<AgentTool, "name">[]) =>
  names(tools)
    .filter((name) => name === SEARCH || name === FETCH)
    .sort();

function mainInputs(searching: boolean): Record<string, AgentRunInput> {
  const base = { sessionId: "session", runId: "run", prompt: "你好" };
  return {
    短篇: {
      ...base,
      agentProfile: shortProfile(),
      workspaceContext: { shortWorkspace: shortWorkspace() },
      ...contextOf(searching)
    },
    剧本: {
      ...base,
      scriptAgentProfile: scriptAgentProfile(),
      workspaceContext: { scriptWorkspace: screenplayWorkspace() },
      ...contextOf(searching)
    },
    长篇: {
      ...base,
      longAgentProfile: longProfile("long"),
      workspaceContext: { longWorkspace: longWorkspace("long", "plot_design") },
      ...contextOf(searching)
    },
    素材库: {
      ...base,
      libraryAgentProfile: DEFAULT_LIBRARY_AGENT_PROFILES.find(
        (entry) => entry.domain === "material"
      )!,
      workspaceContext: { libraryWorkspace },
      ...contextOf(searching)
    },
    技能库: {
      ...base,
      libraryAgentProfile: DEFAULT_LIBRARY_AGENT_PROFILES.find(
        (entry) => entry.domain === "skill"
      )!,
      workspaceContext: {
        libraryWorkspace: {
          ...libraryWorkspace,
          domain: "skill",
          kind: "general",
          entries: []
        }
      },
      ...contextOf(searching)
    },
    技能转子智能体编写: {
      ...base,
      workspaceContext: {
        subagentAuthoring: {
          parentAgentId: "script",
          parentAgentLabel: "剧本",
          outputMode: "handoff",
          skills: [],
          existingSubagentNames: []
        }
      },
      ...contextOf(searching)
    } as AgentRunInput
  };
}

describe("web_search in the main agent's tools", () => {
  for (const [label, searching] of [
    ["", true],
    ["不", false]
  ] as const) {
    it.each(Object.keys(mainInputs(true)))(
      `${label}挂载到%s主智能体：设置${searching ? "已" : "未"}启用`,
      (kind) => {
        const tools = buildRunTools(
          mainInputs(searching)[kind]!,
          options(harness())
        );
        expect(names(tools).includes(SEARCH)).toBe(searching);
        // Whoever has search has page reading too, once each.
        expect(webOf(tools)).toEqual(searching ? WEB_PAIR : []);
      }
    );
  }
});

describe("the main agent's switch", () => {
  it.each(Object.keys(mainInputs(true)))(
    "不给%s主智能体挂载：设置可用但本轮开关关闭",
    (kind) => {
      const { webSearchEnabled: _off, ...input } = mainInputs(true)[kind]!;
      const tools = buildRunTools(input, options(harness()));
      expect(webOf(tools)).toEqual([]);
    }
  );

  it("keeps the search rules out of a main prompt whose switch is off", () => {
    const { webSearchEnabled: _off, ...input } = mainInputs(true).短篇!;
    const prompt = buildEffectiveSystemPrompt("基础提示。", input);
    expect(prompt).not.toContain("【联网搜索】");
    expect(prompt).not.toContain(FETCH);
    const on = buildEffectiveSystemPrompt("基础提示。", mainInputs(true).短篇!);
    expect(on).toContain(WEB_SEARCH_FETCH_PROMPT);
    expect(on).toContain("联网查证公开资料使用 web_search、web_fetch");
    expect(
      buildEffectiveSystemPrompt("基础提示。", mainInputs(false).短篇!)
    ).not.toContain(FETCH);
  });
});

describe("web_search follows each member's web search mode", () => {
  function run(options: {
    config: boolean;
    main: boolean;
    mode?: SubagentWebSearchMode;
  }): AgentRunInput {
    const { webSearchEnabled: _flag, ...base } = mainInputs(
      options.config
    ).短篇!;
    return {
      ...base,
      ...(options.main ? { webSearchEnabled: true } : {}),
      subagentDefinitions: [member("standard", options.mode)]
    };
  }

  async function childTools(input: AgentRunInput) {
    const runtime = harness();
    const spawn = buildRunTools(input, options(runtime)).find(
      (tool) => tool.name === "spawn_subagent"
    )!;
    await spawn.execute("call", {
      tasks: [{ subagent_id: member("standard").id, task: "处理这一段" }]
    } as never);
    return runtime.contexts[0]!;
  }

  it.each([
    ["inherit", true, true],
    ["inherit", false, false],
    [undefined, true, true],
    [undefined, false, false],
    ["on", true, true],
    ["on", false, true],
    ["off", true, false],
    ["off", false, false]
  ] as const)(
    "mode %s with the main switch %s: child searches %s",
    async (mode, main, expected) => {
      const context = await childTools(
        run({ config: true, main, ...(mode ? { mode } : {}) })
      );
      expect(webOf(context.tools ?? [])).toEqual(expected ? WEB_PAIR : []);
      expect(context.systemPrompt?.includes(WEB_SEARCH_FETCH_PROMPT)).toBe(
        expected
      );
      // The section is what depends on holding the tools; the boundary line
      // handed to every child follows the main agent's switch instead.
      expect(context.systemPrompt?.includes("【联网搜索】")).toBe(expected);
    }
  );

  it("lets an always-on member search while the main agent cannot", () => {
    const tools = buildRunTools(
      run({ config: true, main: false, mode: "on" }),
      options(harness())
    );
    expect(webOf(tools)).toEqual([]);
    expect(names(tools)).toContain("spawn_subagent");
  });

  it("gives nobody search while the settings are missing", async () => {
    const context = await childTools(
      run({ config: false, main: true, mode: "on" })
    );
    expect(webOf(context.tools ?? [])).toEqual([]);
  });

  it("keeps a bare member toolless whatever its mode says", async () => {
    const input = run({ config: true, main: true, mode: "on" });
    const bare = member("pure-bare", "on");
    const runtime = harness();
    const spawn = buildRunTools(
      { ...input, subagentDefinitions: [bare] },
      options(runtime)
    ).find((tool) => tool.name === "spawn_subagent")!;
    await spawn.execute("call", {
      tasks: [{ subagent_id: bare.id, task: "只用文字回答" }]
    } as never);
    expect(runtime.contexts[0]!.tools ?? []).toEqual([]);
  });
});

describe("web_search in subagents", () => {
  function shortRun(searching: boolean): AgentRunInput {
    return {
      ...mainInputs(searching).短篇!,
      subagentDefinitions: (
        ["standard", "pure-read", "pure-bare"] as SubagentAgentMode[]
      ).map((mode) => member(mode))
    };
  }

  async function runChild(
    input: AgentRunInput,
    mode: SubagentAgentMode,
    responses?: FauxResponseStep[]
  ) {
    const runtime = harness(responses);
    const spawn = buildRunTools(input, options(runtime)).find(
      (tool) => tool.name === "spawn_subagent"
    )!;
    await spawn.execute("call", {
      tasks: [{ subagent_id: member(mode).id, task: "处理这一段" }]
    } as never);
    return runtime.contexts[0]!;
  }

  it.each([
    ["standard", true],
    ["pure-read", true],
    ["pure-bare", false]
  ] as const)("%s child %s the tool and its rules", async (mode, gets) => {
    const withSearch = await runChild(shortRun(true), mode);
    const childTools = (withSearch.tools ?? []).map(({ name }) => name);
    expect(childTools.includes(SEARCH)).toBe(gets);
    expect(webOf(withSearch.tools ?? [])).toEqual(gets ? WEB_PAIR : []);
    expect(withSearch.systemPrompt?.includes(WEB_SEARCH_FETCH_PROMPT)).toBe(
      gets
    );
    if (mode === "pure-read")
      expect(childTools.sort()).toEqual([
        "query_linked_material_entries",
        "read",
        FETCH,
        SEARCH
      ]);
    const without = await runChild(shortRun(false), mode);
    expect(webOf(without.tools ?? [])).toEqual([]);
    expect(without.systemPrompt).not.toContain("【联网搜索】");
    expect(without.systemPrompt).not.toContain(FETCH);
  });

  it("tells a pure-read child it may look things up when it can", async () => {
    const context = await runChild(shortRun(true), "pure-read");
    expect(context.systemPrompt).toContain(
      "工具清单列有 web_search 时，也可用 web_search、web_fetch 查证公开资料"
    );
    const plain = await runChild(shortRun(false), "pure-read");
    expect(plain.systemPrompt).not.toContain("web_search");
    expect(plain.systemPrompt).not.toContain(FETCH);
  });

  it("shares one search budget between the main agent and its children", async () => {
    const runtime = harness([
      fauxAssistantMessage(fauxToolCall(SEARCH, { query: "子任务查证" }), {
        stopReason: "toolUse"
      }),
      fauxAssistantMessage("子任务完成")
    ]);
    const tools = buildRunTools(shortRun(true), options(runtime, "local-faux"));
    const search = tools.find((tool) => tool.name === SEARCH)!;
    const spawn = tools.find((tool) => tool.name === "spawn_subagent")!;
    await search.execute("one", { query: "主智能体先查" } as never);
    await spawn.execute("call", {
      tasks: [{ subagent_id: member("standard").id, task: "查一下" }]
    } as never);
    await expect(
      search.execute("three", { query: "主智能体再查" } as never)
    ).rejects.toThrow("本轮联网搜索已达上限（2 次）");
    // Reading a page draws on the same spent budget.
    const fetchPage = tools.find((tool) => tool.name === FETCH)!;
    await expect(
      fetchPage.execute("four", { url: "https://example.test/a" } as never)
    ).rejects.toThrow("本轮联网搜索已达上限（2 次）");
  });

  it("lets the main agent and a child read one page for a single call", async () => {
    const address = "https://example.test/shared";
    const runtime = harness([
      fauxAssistantMessage(fauxToolCall(FETCH, { url: address }), {
        stopReason: "toolUse"
      }),
      fauxAssistantMessage("子任务完成")
    ]);
    const tools = buildRunTools(shortRun(true), options(runtime, "local-faux"));
    const fetchPage = tools.find((tool) => tool.name === FETCH)!;
    const spawn = tools.find((tool) => tool.name === "spawn_subagent")!;
    const first = await fetchPage.execute("one", { url: address } as never);
    await spawn.execute("call", {
      tasks: [{ subagent_id: member("standard").id, task: "读一下" }]
    } as never);
    const again = await fetchPage.execute("two", { url: address } as never);
    expect(first.details).toMatchObject({ cached: false, callIndex: 1 });
    // The child's read came from the cache, so the count did not move.
    expect(again.details).toMatchObject({ cached: true, callIndex: 1 });
  });
});

describe("web_search in library management children", () => {
  it("lets a manager search and states the rules once", async () => {
    const run: AgentRunInput = {
      ...mainInputs(true).短篇!,
      libraryManagement: {
        scope: { bookId: "book", bookType: "short" },
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
        payload: { libraries: [], workspace: libraryWorkspace }
      }))
    };
    const runtime = harness();
    const tools = buildRunTools(run, options(runtime));
    expect(webOf(tools)).toEqual(WEB_PAIR);
    expect(
      tools.some(
        (tool) => tool.name === "manage_material_create_material_entry"
      )
    ).toBe(true);
    expect(
      tools.find((tool) => tool.name === "spawn_subagent")?.description ?? ""
    ).not.toContain("builtin:material-manager");
    const prompt = buildEffectiveSystemPrompt("base", run);
    expect(prompt.split("【联网搜索】").length - 1).toBe(1);
  });
});

describe("web access in the members of every creative workspace", () => {
  async function childTools(
    kind: "短篇" | "剧本" | "长篇",
    main: boolean,
    mode: SubagentWebSearchMode,
    agentMode: SubagentAgentMode
  ) {
    const { webSearchEnabled: _flag, ...base } = mainInputs(true)[kind]!;
    const input: AgentRunInput = {
      ...base,
      ...(main ? { webSearchEnabled: true } : {}),
      subagentDefinitions: [member(agentMode, mode)]
    };
    const runtime = harness();
    const spawn = buildRunTools(input, options(runtime)).find(
      (tool) => tool.name === "spawn_subagent"
    )!;
    await spawn.execute("call", {
      tasks: [{ subagent_id: member(agentMode).id, task: "处理这一段" }]
    } as never);
    return runtime.contexts[0]!;
  }

  const cases = (["短篇", "剧本", "长篇"] as const).flatMap((kind) =>
    (
      [
        ["standard", "inherit", true, true],
        ["standard", "inherit", false, false],
        ["standard", "on", false, true],
        ["standard", "off", true, false],
        ["pure-read", "on", false, true],
        ["pure-read", "off", true, false]
      ] as const
    ).map(([agentMode, mode, main, expected]) => ({
      kind,
      agentMode,
      mode,
      main,
      expected
    }))
  );

  it.each(cases)(
    "$kind $agentMode 成员：联网配置 $mode、主开关 $main 时有联网工具：$expected",
    async ({ kind, agentMode, mode, main, expected }) => {
      const context = await childTools(kind, main, mode, agentMode);
      // Search and page reading go together, once each.
      expect(webOf(context.tools ?? [])).toEqual(expected ? WEB_PAIR : []);
    }
  );
});
