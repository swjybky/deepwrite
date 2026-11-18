import {
  ACADEMIC_TERMINOLOGY_DOCUMENT_ID,
  ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID,
  createAcademicCardDocumentId,
  createAcademicSectionDocumentId,
  createShortWorkspaceContentRevision,
  DEFAULT_ACADEMIC_AGENT_PROFILES,
  DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES,
  type AcademicWorkspaceRuntimeContext,
  type AgentProviderRuntimeConfig
} from "@deepwrite/contracts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  normalizeContext,
  validateToolArguments,
  type JsonObject
} from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { buildAcademicWorkspaceTools } from "./academic-agent-tools";
import { buildAskUserQuestionTool } from "./ask-user-question-tool";
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

type WorkspaceType = "short" | "script" | "long" | "academic";
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

function academicTools() {
  const mkMetric = (id: string, title: string, content: string) => ({
    id,
    title,
    revision: createShortWorkspaceContentRevision(content),
    characters: content.length,
    content
  });
  const workspace: AcademicWorkspaceRuntimeContext = {
    id: "book-academic-bool",
    title: "测试学术论文",
    subtype: "empirical_paper",
    citationStyle: "apa",
    readSource: "inline",
    foundation: {
      thesisOverview: mkMetric(
        ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID,
        "研究总述",
        "原始研究总述。"
      ),
      terminology: mkMetric(
        ACADEMIC_TERMINOLOGY_DOCUMENT_ID,
        "术语与符号表",
        "原始术语表。"
      ),
      cards: [
        {
          id: "card-1",
          citeKey: "Smith2024",
          cardType: "literature",
          title: "Smith 2024",
          documentId: createAcademicCardDocumentId("card-1"),
          revision: createShortWorkspaceContentRevision("原始文献卡内容。"),
          characters: 8,
          content: "原始文献卡内容。"
        }
      ]
    },
    frameworkStages: [
      {
        id: "research_question",
        title: "核心问题与贡献点",
        description: "研究问题",
        enabled: true,
        builtin: true,
        document: mkMetric(
          "research_question",
          "核心问题与贡献点",
          "原始阶段论证。"
        )
      }
    ],
    manuscript: {
      chapters: [],
      sections: [
        {
          id: "sec-1",
          order: 0,
          title: "1. 引言",
          wordCountRequirement: "",
          brief: mkMetric(
            createAcademicSectionDocumentId("sec-1", "brief"),
            "1. 引言 - 写作指引",
            "原始指引。"
          ),
          body: mkMetric(
            createAcademicSectionDocumentId("sec-1", "body"),
            "1. 引言",
            "原始引言正文。"
          ),
          state: mkMetric(
            createAcademicSectionDocumentId("sec-1", "state"),
            "1. 引言 - 节末状态",
            "原始节末状态。"
          )
        }
      ]
    }
  };
  return buildAcademicWorkspaceTools({
    workspace,
    profile: DEFAULT_ACADEMIC_AGENT_PROFILES[0]!,
    writeApprovalMode: "request-approval",
    requestUserInput: async () => ({
      sessionId: "s",
      runId: "r",
      requestId: "req-1",
      answers: []
    })
  });
}

async function capturePayload(
  tools: AgentTool[],
  config: AgentProviderRuntimeConfig,
  declaration: "root" | "transcript" = "root"
) {
  const { model, streamFn } = buildProviderRuntime(config, undefined, "off", {
    portableToolSchemaProfile: "writing-workspace"
  });
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
  return payload;
}

it.each([
  ["openai-completions", "openai", "chat-test"],
  ["openai-responses", "openai", "responses-test"],
  ["anthropic-messages", "anthropic", "claude-test"],
  ["google-generative-ai", "google", "gemini-test"]
] as const)(
  "serializes migrated tool modes as strings through %s",
  async (api, provider, modelId) => {
    const tools = [
      toolByName(writingTools("short"), "read"),
      ...academicTools().filter(({ name }) => name !== "read")
    ];
    const payload = JSON.stringify(
      await capturePayload(tools, {
        ...gatewayConfig,
        api,
        provider,
        modelId
      })
    );
    expect(payload).toContain('"section_scope"');
    expect(payload).toContain('"stage_status"');
    expect(payload).toContain('"match_scope"');
    expect(payload).toContain('"selection_mode"');
    expect(payload).not.toMatch(/"type":"boolean"/iu);
  }
);

describe.each(["short", "script", "long", "academic"] as const)(
  "%s workspace tool parameters",
  (workspaceType: WorkspaceType) => {
    it.each([
      ["native", "root"],
      ["native", "transcript"],
      ["portable", "root"],
      ["portable", "transcript"]
    ] as const)(
      "sends portable schemas through the Gemini gateway with %s profiles and %s declarations",
      async (profile, declaration) => {
        const tools =
          workspaceType === "long"
            ? longTools({ executor: documentExecutor(fixtureIndex()) })
            : workspaceType === "academic"
              ? academicTools()
              : writingTools(workspaceType);
        const payload = (await capturePayload(
          tools,
          { ...gatewayConfig, toolSchemaProfile: profile },
          declaration
        )) as ToolPayload;
        expect(JSON.stringify(payload.tools)).not.toContain('"type":"boolean"');
        const editProperties = payload.tools.find(
          (item) => item.function.name === "edit"
        )!.function.parameters.properties;
        expect(editProperties.overwrite_mode).toMatchObject({
          type: "string",
          enum: ["replace_all"]
        });
        expect(editProperties.overwrite_mode).not.toHaveProperty("const");
        expect(editProperties).not.toHaveProperty("allow_overwrite_existing");
        if (workspaceType === "short" || workspaceType === "script") {
          const readProperties = payload.tools.find(
            (item) => item.function.name === "read"
          )!.function.parameters.properties;
          expect(readProperties.section_scope).toMatchObject({
            type: "string",
            enum: ["directory", "all_sections"]
          });
          expect(readProperties).not.toHaveProperty("include_all_sections");
        }
        if (workspaceType === "academic") {
          const metaProps = (
            editProperties.meta as {
              properties: Record<string, Record<string, unknown>>;
            }
          ).properties;
          expect(metaProps.stage_status).toMatchObject({
            type: "string",
            enum: ["enabled", "disabled"]
          });
          expect(metaProps).not.toHaveProperty("enabled");
        }
      }
    );
  }
);

function validateEdit(tool: AgentTool, args: JsonObject) {
  return validateToolArguments(tool, {
    type: "toolCall",
    id: "overwrite-test",
    name: tool.name,
    arguments: args
  });
}

it("validates selection_mode and forwards the existing question shape", async () => {
  const requestUserInput = vi.fn(async () => ({
    sessionId: "session",
    runId: "run",
    requestId: "request",
    answers: []
  }));
  const ask = buildAskUserQuestionTool(requestUserInput);
  const question = {
    id: "choice",
    question: "保留哪些文献？",
    options: [
      { id: "a", label: "甲" },
      { id: "b", label: "乙" }
    ]
  };
  const run = (options: JsonObject) =>
    ask.execute(
      "ask",
      validateEdit(ask, { questions: [{ ...question, ...options }] })
    );

  expect(() => run({ selection_mode: false })).toThrow("selection_mode");
  expect(() => run({ multi_select: true })).toThrow("multi_select");
  expect(requestUserInput).not.toHaveBeenCalled();
  await run({ selection_mode: "single" });
  await run({ selection_mode: "multiple" });
  expect(requestUserInput).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      questions: [{ ...question, multi_select: false }]
    }),
    undefined
  );
  expect(requestUserInput).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      questions: [{ ...question, multi_select: true }]
    }),
    undefined
  );
});

function expectInvalidOverwriteModesRejected(
  tool: AgentTool,
  args: JsonObject
) {
  for (const mode of [
    true,
    false,
    1,
    "true",
    "replace",
    ["replace_all"],
    [null, null, null, 1]
  ]) {
    expect(() => validateEdit(tool, { ...args, overwrite_mode: mode })).toThrow(
      "overwrite_mode"
    );
  }
}

describe.each(["short", "script"] as const)(
  "%s workspace overwrite permission",
  (workspaceType) => {
    it.each(["", "替换后的正文。"])(
      "preserves existing content when overwrite mode is missing or invalid (content=%j)",
      async (content) => {
        const tools = writingTools(workspaceType);
        const read = toolByName(tools, "read");
        const edit = toolByName(tools, "edit");
        const targets: JsonObject[] = [
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
          const args = { ...target, content };
          expectInvalidOverwriteModesRejected(edit, args);
          for (const input of [args, { ...args, overwrite_mode: null }]) {
            const result = await edit.execute(
              "blocked-overwrite",
              validateEdit(edit, input)
            );
            expect(resultText(result)).toContain("overwrite_mode=replace_all");
            expect(result.details).toMatchObject({ kind: "none" });
            expect(resultText(await read.execute("read-after", target))).toBe(
              before
            );
          }
        }
      }
    );

    it("reads the directory by default and requires an explicit scope for all sections", async () => {
      const read = toolByName(writingTools(workspaceType), "read");
      const draft = { kind: "draft", id: "draft" };
      const run = (args: JsonObject) =>
        read.execute("read-draft", validateEdit(read, { ...draft, ...args }));
      expect(resultText(await run({}))).toContain("section-1");
      expect(
        resultText(await run({ section_scope: "directory" }))
      ).not.toContain("汽笛迟到了七分钟。");
      expect(
        resultText(await run({ section_scope: "all_sections" }))
      ).toContain("汽笛迟到了七分钟。");
      expect(() => run({ section_scope: true })).toThrow("section_scope");
      expect(() => run({ include_all_sections: true })).toThrow(
        "include_all_sections"
      );
    });
  }
);

describe("long workspace overwrite permission", () => {
  it.each(["", "替换后的正文。"])(
    "preserves document and record content when mode is missing or invalid (content=%j)",
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
      const targets: JsonObject[] = [
        { id: "chapter_one", document: "body" },
        { id: "volume_one" }
      ];
      for (const target of targets) {
        expect(resultText(await read.execute("read-before", target))).toContain(
          beforeText
        );
        const args = { ...target, content };
        expectInvalidOverwriteModesRejected(edit, args);
        for (const input of [args, { ...args, overwrite_mode: null }]) {
          const result = await edit.execute(
            "blocked-overwrite",
            validateEdit(edit, input)
          );
          expect(resultText(result)).toContain("overwrite_mode=replace_all");
          expect(result.details).toMatchObject({ kind: "none" });
          expect(
            resultText(await read.execute("read-after", target))
          ).toContain("该文档自上次读取后未变化，原文仍在上文。");
        }
      }
    }
  );
});

describe("academic workspace overwrite permission", () => {
  it.each(["", "替换后的学术正文。"])(
    "preserves academic document content when overwrite mode is missing or invalid (content=%j)",
    async (content) => {
      const tools = academicTools();
      const read = toolByName(tools, "read");
      const edit = toolByName(tools, "edit");
      const targets: JsonObject[] = [
        { kind: "foundation", id: "thesis_overview" },
        { kind: "foundation", id: "terminology" },
        { kind: "reference_card", id: "card-1" },
        { kind: "framework_stage", id: "research_question" },
        { kind: "section", id: "sec-1", document: "brief" },
        { kind: "section", id: "sec-1", document: "body" },
        { kind: "section", id: "sec-1", document: "state" }
      ];
      for (const target of targets) {
        const before = resultText(await read.execute("read-before", target));
        const args = { ...target, content };
        expectInvalidOverwriteModesRejected(edit, args);
        for (const input of [args, { ...args, overwrite_mode: null }]) {
          const result = await edit.execute(
            "blocked-overwrite",
            validateEdit(edit, input)
          );
          expect(resultText(result)).toContain("overwrite_mode=replace_all");
          expect(result.details).toMatchObject({ kind: "none" });
          expect(resultText(await read.execute("read-after", target))).toBe(
            before
          );
        }
      }
    }
  );
});
