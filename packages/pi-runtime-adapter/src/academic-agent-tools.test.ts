import {
  ACADEMIC_BATCH_CREATE_MAX_ITEMS,
  ACADEMIC_CITE_KEY_MAX_LENGTH,
  ACADEMIC_TERMINOLOGY_DOCUMENT_ID,
  ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID,
  ContextCompactionRunSettingsSchema,
  createAcademicCardDocumentId,
  createAcademicSectionDocumentId,
  createShortWorkspaceContentRevision,
  DEFAULT_ACADEMIC_AGENT_PROFILES,
  DEFAULT_ACADEMIC_SUBAGENTS,
  type AcademicCitationStyle,
  type AcademicWorkspaceRuntimeContext,
  type AgentRuntimeRef,
  type WritingReadCommand
} from "@deepwrite/contracts";
import type { AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  validateToolArguments,
  type Api,
  type Context,
  type JsonObject,
  type Model,
  type ToolCall,
  type ToolResultMessage
} from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import {
  buildAcademicWorkspaceTools,
  createAcademicWorkspaceToolSharedState,
  createAcademicWritingReader,
  type AcademicToolDetails
} from "./academic-agent-tools";
import {
  academicReadOnlyRuntimeSystemRequirements,
  buildAcademicRuntimeUserPrompt
} from "./prompts-academic";
import { buildEffectiveSystemPrompt } from "./prompts-system";
import { buildRunTools } from "./run-tools";
import type {
  AgentRunEventSource,
  AgentRunInput,
  AgentUserInputRequester
} from "./runtime-types";
import { resultText, toolByName } from "./short-agent-tools.test-support";
import { toSubagentRuntimeEvents } from "./subagent-events";
import {
  isSubagentToolProgressDetails,
  type SubagentToolProgress
} from "./subagent-runtime";
import { inspectTranscript } from "./transcript.test-support";
import {
  workspaceContextPolicy,
  workspaceContextTask,
  WORKSPACE_TOOL_COMPACTORS
} from "./workspace-context-policy";
import { rehydrateWorkspaceContext } from "./workspace-context-recovery";

function mkDocMetric(id: string, title: string, content: string) {
  return {
    id,
    title,
    revision: createShortWorkspaceContentRevision(content),
    characters: content.length,
    content
  };
}

function createFixtureAcademicWorkspace(
  overrides: Partial<AcademicWorkspaceRuntimeContext> = {}
): AcademicWorkspaceRuntimeContext {
  const sec1Brief = "聚焦多智能体协作中的证据锚定缺口与本文核心假设。";
  const sec1Body =
    "近年来，大型语言模型在学术辅助写作中的应用迅速扩展 [Smith2024]。\n\n然而，现有系统普遍缺乏显式的文献卡片锚定与可审计证据链。\n\n本文提出基于结构化卡片与提案门控的学术协作框架。";
  const sec1State = "已定义研究缺口与核心贡献，引入术语：证据门控（EG）。";
  return {
    id: "book-acad-1",
    title: "结构化证据门控驱动的学术写作研究",
    subtype: "empirical_paper",
    citationStyle: "apa",
    agentsMd: "全文统一使用主动语态；实验显著性阈值固定 p < 0.01。",
    readSource: "inline",
    projectRevision: 12,
    foundation: {
      thesisOverview: mkDocMetric(
        ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID,
        "研究总述与核心贡献",
        "核心假设：将文献卡片与章节草稿解耦可降低虚构引用率。"
      ),
      terminology: mkDocMetric(
        ACADEMIC_TERMINOLOGY_DOCUMENT_ID,
        "术语与符号表",
        "- EG（Evidence Gate）：证据门控机制\n- $\\mathcal{C}$：已核验文献卡集合"
      ),
      cards: [
        {
          id: "card-smith",
          citeKey: "Smith2024",
          cardType: "literature",
          title: "Smith et al. (2024) Academic Grounding",
          documentId: createAcademicCardDocumentId("card-smith"),
          revision: createShortWorkspaceContentRevision(
            "Smith et al. (2024) 在 500 篇综述基准上测得无锚定引用幻觉率为 27.4%。"
          ),
          characters: 52,
          content:
            "Smith et al. (2024) 在 500 篇综述基准上测得无锚定引用幻觉率为 27.4%。"
        }
      ]
    },
    frameworkStages: [
      {
        id: "problem_and_gap",
        title: "核心问题与研究缺口",
        description: "研究背景缺口、核心问题与贡献声明。",
        enabled: true,
        builtin: true,
        document: mkDocMetric(
          "problem_and_gap",
          "核心问题与研究缺口",
          "RQ1：证据门控能否消除未核验引用？"
        )
      },
      {
        id: "stage-custom-threat",
        title: "效度威胁分析",
        description: "内部效度与外部效度边界。",
        enabled: true,
        builtin: false,
        document: mkDocMetric(
          "stage-custom-threat",
          "效度威胁分析",
          "外部效度受限于计算机科学语料。"
        )
      }
    ],
    manuscript: {
      chapters: [{ id: "chap-1", title: "第一章 绪论", order: 1 }],
      sections: [
        {
          id: "sec-1",
          chapterId: "chap-1",
          order: 1,
          title: "1.1 研究背景与问题定义",
          wordCountRequirement: "800-1200字",
          brief: mkDocMetric(
            createAcademicSectionDocumentId("sec-1", "brief"),
            "1.1 研究背景与问题定义 - 写作指引",
            sec1Brief
          ),
          body: mkDocMetric(
            createAcademicSectionDocumentId("sec-1", "body"),
            "1.1 研究背景与问题定义",
            sec1Body
          ),
          state: mkDocMetric(
            createAcademicSectionDocumentId("sec-1", "state"),
            "1.1 研究背景与问题定义 - 节末状态",
            sec1State
          )
        }
      ]
    },
    activeTarget: {
      zone: "manuscript",
      kind: "section",
      targetId: "sec-1",
      sectionDocument: "body",
      title: "1.1 研究背景与问题定义"
    },
    ...overrides
  };
}

const noopUserInput: AgentUserInputRequester = async () => ({
  sessionId: "session-acad-1",
  runId: "run-acad-1",
  requestId: "req-1",
  answers: []
});

function makeRunInput(
  workspace = createFixtureAcademicWorkspace(),
  overrides: Partial<AgentRunInput> = {}
): AgentRunInput {
  return {
    sessionId: "session-acad-1",
    runId: "run-acad-1",
    prompt: "请先审阅 1.1 节论证链条并完善引用锚点。",
    academicAgentProfile: DEFAULT_ACADEMIC_AGENT_PROFILES[0]!,
    writeApprovalMode: "request-approval",
    workspaceContext: {
      academicWorkspace: workspace,
      activeResource: {
        id: "acad:sec:book-acad-1:sec-1",
        title: "1.1 研究背景与问题定义",
        domain: "creation",
        path: ["结构化证据门控驱动的学术写作研究", "1.1 研究背景与问题定义"],
        source: "live-editor",
        content: ""
      },
      attachedSkills: [
        {
          id: "skill-1",
          title: "实证论文讨论段写法",
          kind: "style",
          source: "attached-skill",
          content: "讨论段应先回应研究问题，再对比已有文献并诚实说明局限。"
        }
      ]
    },
    ...overrides
  };
}

function validatedCall(
  tool: AgentTool,
  args: Record<string, unknown>,
  id = `call-${tool.name}`
) {
  const prepared = tool.prepareArguments ? tool.prepareArguments(args) : args;
  const call: ToolCall = {
    type: "toolCall",
    id,
    name: tool.name,
    arguments: prepared as JsonObject
  };
  return validateToolArguments(tool, call);
}

describe("academic 6-layer system prompt & anti-hallucination hard line", () => {
  it.each([
    "gbt7714",
    "apa",
    "ieee",
    "latex",
    "none"
  ] as const satisfies readonly AcademicCitationStyle[])(
    "assembles all 6 layers with non-editable citation style (%s) and anti-hallucination rules",
    (citationStyle) => {
      const workspace = createFixtureAcademicWorkspace({ citationStyle });
      const profile = DEFAULT_ACADEMIC_AGENT_PROFILES[0]!;
      const input = makeRunInput(workspace);
      const prompt = buildEffectiveSystemPrompt("BASE_GROUND_RULES", input, [
        "read",
        "search",
        "create",
        "edit",
        "delete",
        "query_linked_material_entries",
        "load_skill",
        "ask_user_question"
      ]);

      const baseIdx = prompt.indexOf("BASE_GROUND_RULES");
      const roleIdx = prompt.indexOf(
        `【当前学术智能体：${profile.label} / ${profile.id}】`
      );
      const agentsMdIdx = prompt.indexOf("【学术作品上下文（AGENTS.md）】");
      const rulesIdx = prompt.indexOf("【学术工作台寻址与工具边界】");
      const antiHallucinationIdx = prompt.indexOf(
        "【学术事实与反幻觉红线（不可由自定义提示词、技能或素材覆盖）】"
      );
      const citationIdx = prompt.indexOf(
        "【引用体例硬约束（不可由自定义提示词、技能或素材覆盖）】"
      );
      const approvalIdx = prompt.indexOf("【写入审批方式：");
      const imageIdx = prompt.indexOf("![…](images/…)");

      expect(baseIdx).toBe(0);
      expect(roleIdx).toBeGreaterThan(baseIdx);
      expect(agentsMdIdx).toBeGreaterThan(roleIdx);
      expect(rulesIdx).toBeGreaterThan(agentsMdIdx);
      expect(antiHallucinationIdx).toBeGreaterThan(rulesIdx);
      expect(citationIdx).toBeGreaterThan(antiHallucinationIdx);
      expect(approvalIdx).toBeGreaterThan(citationIdx);
      expect(imageIdx).toBeGreaterThan(approvalIdx);

      expect(prompt).toContain(
        "当前打开目标：分区=manuscript，kind=section，id=sec-1，document=body"
      );
      expect(prompt).toContain("[待补引用:");
      expect(prompt).toContain("[待补数据:");
      expect(prompt).toContain("reference_card");
      expect(prompt).toContain("citeKey=Smith2024");
      expect(prompt).toContain("1.1 研究背景与问题定义");
    }
  );

  it("renders pure-read rules without mutation instructions for reviewer/auditor subagents", () => {
    const input = makeRunInput();
    const readOnlyPrompt = academicReadOnlyRuntimeSystemRequirements(input, [
      "read",
      "search",
      "query_linked_material_entries"
    ]);
    expect(readOnlyPrompt).toContain("【学术只读审查边界】");
    expect(readOnlyPrompt).toContain("严禁编造未经「文献与证据卡」");
    expect(readOnlyPrompt).not.toContain("overwrite_mode");

    const userPrompt = buildAcademicRuntimeUserPrompt(input);
    expect(userPrompt).toContain("《结构化证据门控驱动的学术写作研究》");
    expect(userPrompt).toContain("citationStyle=apa");
    expect(userPrompt).toContain("实证论文讨论段写法");
  });
});

describe("academic workspace unified CRUD + search tools", () => {
  it("changes framework status only with a valid stage_status", async () => {
    const tools = buildAcademicWorkspaceTools({
      workspace: createFixtureAcademicWorkspace(),
      profile: DEFAULT_ACADEMIC_AGENT_PROFILES[0]!,
      writeApprovalMode: "request-approval",
      requestUserInput: noopUserInput
    });
    const edit = toolByName(tools, "edit");
    const target = { kind: "framework_stage", id: "stage-custom-threat" };
    const update = (args: Record<string, unknown>) =>
      edit.execute("stage-status", validatedCall(edit, { ...target, ...args }));

    expect(() => update({ meta: { stage_status: 0 } })).toThrow("stage_status");
    await expect(update({ meta: { enabled: false } })).rejects.toThrow(
      "stage_status=disabled"
    );
    expect(
      (await update({ meta: { stage_status: "disabled" } })).details
    ).toMatchObject({
      target: { kind: "framework-stage-mutation", mutation: { enabled: false } }
    });
    await expect(
      update({ id: "problem_and_gap", stage_status: "disabled" })
    ).rejects.toThrow("至少须保留 1 个处于启用状态的论证框架阶段");
    expect((await update({ stage_status: "enabled" })).details).toMatchObject({
      target: { kind: "framework-stage-mutation", mutation: { enabled: true } }
    });
  });

  it("requires match_scope=all_matches before replacing repeated text", async () => {
    const workspace = createFixtureAcademicWorkspace();
    workspace.foundation.thesisOverview = mkDocMetric(
      ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID,
      "研究总述",
      "原词在甲，原词在乙。"
    );
    const edit = toolByName(
      buildAcademicWorkspaceTools({
        workspace,
        profile: DEFAULT_ACADEMIC_AGENT_PROFILES[0]!,
        writeApprovalMode: "request-approval",
        requestUserInput: noopUserInput
      }),
      "edit"
    );
    const replace = (args: Record<string, unknown>) =>
      edit.execute(
        "replace-matches",
        validatedCall(edit, {
          kind: "foundation",
          id: "thesis_overview",
          replacements: [{ old_text: "原词", new_text: "新词", ...args }]
        })
      );

    expect(() => replace({ match_scope: "true" })).toThrow("match_scope");
    await expect(replace({ replace_all: true })).rejects.toThrow(
      "match_scope=all_matches"
    );
    await expect(replace({})).rejects.toThrow("原文片段出现多次");
    expect(
      (await replace({ match_scope: "all_matches" })).details
    ).toMatchObject({
      target: { kind: "document-edit", text: "新词在甲，新词在乙。" }
    });
  });

  it("translates selection_mode into the user input request", async () => {
    const requestUserInput = vi.fn(noopUserInput);
    const ask = toolByName(
      buildAcademicWorkspaceTools({
        workspace: createFixtureAcademicWorkspace(),
        profile: DEFAULT_ACADEMIC_AGENT_PROFILES[0]!,
        writeApprovalMode: "request-approval",
        requestUserInput
      }),
      "ask_user_question"
    );
    const question = {
      id: "choice",
      question: "保留哪些文献？",
      options: [
        { id: "a", label: "甲" },
        { id: "b", label: "乙" }
      ]
    };
    const run = (args: Record<string, unknown>) =>
      ask.execute(
        "ask",
        validatedCall(ask, { questions: [{ ...question, ...args }] })
      );

    expect(() => run({ selection_mode: false })).toThrow("selection_mode");
    expect(() => run({ multi_select: true })).toThrow("multi_select");
    expect(requestUserInput).not.toHaveBeenCalled();
    await run({});
    await run({ selection_mode: "single" });
    await run({ selection_mode: "multiple" });
    expect(
      requestUserInput.mock.calls.map(([request]) => request.questions)
    ).toEqual([
      [question],
      [{ ...question, multi_select: false }],
      [{ ...question, multi_select: true }]
    ]);
  });

  it("enforces full-read before full overwrite, blocks preview reads from granting overwrite, and clears credential on compaction", async () => {
    let triggerCompacted: (() => void) | undefined;
    const workspace = createFixtureAcademicWorkspace();
    const tools = buildAcademicWorkspaceTools({
      workspace,
      profile: DEFAULT_ACADEMIC_AGENT_PROFILES[0]!,
      writeApprovalMode: "request-approval",
      requestUserInput: noopUserInput,
      onContextCompacted: (listener) => {
        triggerCompacted = () => listener();
      }
    });
    const read = toolByName(tools, "read");
    const edit = toolByName(tools, "edit");

    const unreadAttempt = await edit.execute(
      "edit-unread",
      validatedCall(edit, {
        kind: "section",
        id: "sec-1",
        document: "body",
        content: "未经读取直接覆盖。",
        overwrite_mode: "replace_all"
      })
    );
    expect(unreadAttempt.details).toEqual({ kind: "none" });
    expect(resultText(unreadAttempt)).toContain("尚未完整读取");

    const headPreview = await read.execute(
      "read-head",
      validatedCall(read, {
        kind: "section",
        id: "sec-1",
        document: "body",
        head: 20
      })
    );
    expect(resultText(headPreview)).toContain(
      "预览与分段读取不授予全文覆盖凭证"
    );

    const afterPreviewAttempt = await edit.execute(
      "edit-after-preview",
      validatedCall(edit, {
        kind: "section",
        id: "sec-1",
        document: "body",
        content: "仅预览后尝试覆盖。",
        overwrite_mode: "replace_all"
      })
    );
    expect(afterPreviewAttempt.details).toEqual({ kind: "none" });
    expect(resultText(afterPreviewAttempt)).toContain("尚未完整读取");

    const fullRead = await read.execute(
      "read-full",
      validatedCall(read, {
        kind: "section",
        id: "sec-1",
        document: "body"
      })
    );
    expect(resultText(fullRead)).toContain("Smith2024");

    const validOverwrite = await edit.execute(
      "edit-valid-overwrite",
      validatedCall(edit, {
        kind: "section",
        id: "sec-1",
        document: "body",
        content: "完整读取后重写的小节正文 [Smith2024]。",
        overwrite_mode: "replace_all"
      })
    );
    expect(validOverwrite.details).toMatchObject({
      kind: "academic-workspace-mutation",
      target: {
        kind: "document-edit",
        objectKind: "section",
        targetId: "sec-1",
        sectionDocument: "body",
        text: "完整读取后重写的小节正文 [Smith2024]。"
      }
    });

    expect(triggerCompacted).toBeDefined();
    triggerCompacted!();

    const afterCompactionAttempt = await edit.execute(
      "edit-after-compaction",
      validatedCall(edit, {
        kind: "section",
        id: "sec-1",
        document: "body",
        content: "上下文压缩后未重读再次覆盖。",
        overwrite_mode: "replace_all"
      })
    );
    expect(afterCompactionAttempt.details).toEqual({ kind: "none" });
    expect(resultText(afterCompactionAttempt)).toContain("尚未完整读取");
  });

  it("executes Core search + live overlay search without granting overwrite credentials", async () => {
    const workspace = createFixtureAcademicWorkspace({ readSource: "core" });
    const coreSearchSpy = vi.fn(async (command: WritingReadCommand) => {
      if (command.payload.query.mode === "search") {
        return {
          status: "accepted" as const,
          requestId: command.id,
          payload: {
            mode: "search" as const,
            query: command.payload.query.query,
            totalMatches: 1,
            matches: [
              {
                kind: "reference_card" as const,
                objectId: "card-smith",
                documentId: createAcademicCardDocumentId("card-smith"),
                title: "Smith et al. (2024) Academic Grounding",
                citeKey: "Smith2024",
                snippet: "...无锚定引用幻觉率为 27.4%...",
                matchCount: 1
              }
            ]
          }
        };
      }
      if (command.payload.query.mode === "index") {
        return {
          status: "accepted" as const,
          requestId: command.id,
          payload: {
            mode: "index" as const,
            bookType: "academic" as const,
            title: workspace.title,
            subtype: workspace.subtype,
            citationStyle: workspace.citationStyle,
            foundation: {
              thesisOverview: {
                id: ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID,
                title: "研究总述与核心贡献"
              },
              terminology: {
                id: ACADEMIC_TERMINOLOGY_DOCUMENT_ID,
                title: "术语与符号表"
              },
              cards: [
                {
                  id: "card-smith",
                  citeKey: "Smith2024",
                  cardType: "literature" as const,
                  title: "Smith et al. (2024) Academic Grounding",
                  document: {
                    id: createAcademicCardDocumentId("card-smith"),
                    title: "Smith et al. (2024) Academic Grounding"
                  }
                }
              ]
            },
            frameworkStages: workspace.frameworkStages.map((s) => ({
              id: s.id,
              title: s.title,
              description: s.description,
              enabled: s.enabled
            })),
            chapters: workspace.manuscript.chapters.map((c) => ({
              id: c.id,
              title: c.title
            })),
            sections: workspace.manuscript.sections.map((sec) => ({
              id: sec.id,
              ...(sec.chapterId ? { chapterId: sec.chapterId } : {}),
              title: sec.title,
              wordCountRequirement: sec.wordCountRequirement,
              brief: { id: sec.brief.id, title: sec.brief.title },
              body: { id: sec.body.id, title: sec.body.title },
              state: { id: sec.state.id, title: sec.state.title }
            })),
            counts: [
              {
                id: ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID,
                revision: workspace.foundation.thesisOverview.revision,
                length: workspace.foundation.thesisOverview.characters,
                characters: workspace.foundation.thesisOverview.characters
              },
              {
                id: ACADEMIC_TERMINOLOGY_DOCUMENT_ID,
                revision: workspace.foundation.terminology.revision,
                length: workspace.foundation.terminology.characters,
                characters: workspace.foundation.terminology.characters
              },
              {
                id: createAcademicCardDocumentId("card-smith"),
                revision: workspace.foundation.cards[0]!.revision,
                length: 52,
                characters: 52
              },
              ...workspace.frameworkStages.map((s) => ({
                id: s.id,
                revision: s.document.revision,
                length: s.document.characters,
                characters: s.document.characters
              })),
              ...workspace.manuscript.sections.flatMap((sec) => [
                {
                  id: sec.brief.id,
                  revision: sec.brief.revision,
                  length: sec.brief.characters,
                  characters: sec.brief.characters
                },
                {
                  id: sec.body.id,
                  revision: sec.body.revision,
                  length: sec.body.characters,
                  characters: sec.body.characters
                },
                {
                  id: sec.state.id,
                  revision: sec.state.revision,
                  length: sec.state.characters,
                  characters: sec.state.characters
                }
              ])
            ]
          }
        };
      }
      throw new Error(`Unexpected query mode: ${command.payload.query.mode}`);
    });

    const input = makeRunInput(workspace, {
      writingCommandExecutor: coreSearchSpy
    });
    const reader = createAcademicWritingReader(input, workspace.id);
    const sharedState = createAcademicWorkspaceToolSharedState(workspace);
    const tools = buildAcademicWorkspaceTools({
      workspace,
      profile: DEFAULT_ACADEMIC_AGENT_PROFILES[0]!,
      writeApprovalMode: "request-approval",
      writingReader: reader,
      sharedState,
      requestUserInput: noopUserInput
    });

    const create = toolByName(tools, "create");
    const search = toolByName(tools, "search");
    const edit = toolByName(tools, "edit");

    await create.execute(
      "create-card",
      validatedCall(create, {
        kind: "reference_card",
        cite_key: "Jones2025",
        card_type: "evidence",
        title: "Jones 2025 Ablation Benchmark",
        content: "消融实验显示引用校验模块贡献 27.4% 增益。"
      })
    );

    const searchRes = await search.execute(
      "search-27",
      validatedCall(search, { query: "27.4%" })
    );
    const text = resultText(searchRes);
    expect(coreSearchSpy).toHaveBeenCalled();
    expect(text).toContain("命中 2 条");
    expect(text).toContain("citeKey=Smith2024");
    expect(text).toContain("citeKey=Jones2025");
    expect(text).toContain("检索摘要不授予全文覆盖凭证");

    const overwriteSmith = await edit.execute(
      "overwrite-smith",
      validatedCall(edit, {
        kind: "reference_card",
        id: "Smith2024",
        content: "尝试仅凭检索结果覆盖已有卡片。",
        overwrite_mode: "replace_all"
      })
    );
    expect(overwriteSmith.details).toEqual({ kind: "none" });
    expect(resultText(overwriteSmith)).toContain("尚未完整读取");
  });

  it("supports same-turn provisional ID chaining, citeKey lookup, meta edits, and structural delete guards", async () => {
    const workspace = createFixtureAcademicWorkspace();
    const sharedState = createAcademicWorkspaceToolSharedState(workspace);
    const tools = buildAcademicWorkspaceTools({
      workspace,
      profile: DEFAULT_ACADEMIC_AGENT_PROFILES[0]!,
      writeApprovalMode: "request-approval",
      sharedState,
      requestUserInput: noopUserInput
    });
    const read = toolByName(tools, "read");
    const create = toolByName(tools, "create");
    const edit = toolByName(tools, "edit");
    const del = toolByName(tools, "delete");

    // 1. Delete last remaining section is rejected
    await expect(
      del.execute(
        "del-last-sec",
        validatedCall(del, { kind: "section", id: "sec-1" })
      )
    ).rejects.toThrow(/至少须保留 1 个正文小节/);

    // 2. Delete builtin framework stage is rejected, custom stage succeeds
    await expect(
      del.execute(
        "del-builtin-stage",
        validatedCall(del, {
          kind: "framework_stage",
          id: "problem_and_gap"
        })
      )
    ).rejects.toThrow(/内置论证框架阶段.*不可删除/);

    const delCustomStage = await del.execute(
      "del-custom-stage",
      validatedCall(del, {
        kind: "framework_stage",
        id: "stage-custom-threat"
      })
    );
    expect(delCustomStage.details).toMatchObject({
      kind: "academic-workspace-mutation",
      target: {
        kind: "framework-stage-mutation",
        mutation: { type: "delete", stageId: "stage-custom-threat" }
      }
    });

    // 3. Create provisional chapter -> provisional section -> edit provisional section & card
    const createdChapter = await create.execute(
      "create-chap",
      validatedCall(create, {
        kind: "chapter",
        title: "第二章 方法设计"
      })
    );
    const chapDetails = createdChapter.details as Extract<
      AcademicToolDetails,
      { kind: "academic-workspace-mutation" }
    >;
    expect(chapDetails.target.kind).toBe("chapter-mutation");
    const provisionalChapterId =
      chapDetails.target.kind === "chapter-mutation" &&
      chapDetails.target.mutation.type === "create"
        ? chapDetails.target.mutation.chapters[0]!.provisionalChapterId
        : "";
    expect(provisionalChapterId).toMatch(/^pending:academic-chapter:/);

    const createdSection = await create.execute(
      "create-sec",
      validatedCall(create, {
        kind: "section",
        chapter_id: provisionalChapterId,
        title: "2.1 形式化建模",
        word_count_requirement: "1500字",
        brief: "给出证据门控的形式化定义。",
        body: "设候选断言集合为 $\\mathcal{A}$。"
      })
    );
    const secDetails = createdSection.details as Extract<
      AcademicToolDetails,
      { kind: "academic-workspace-mutation" }
    >;
    const provisionalSectionId =
      secDetails.target.kind === "section-mutation" &&
      secDetails.target.mutation.type === "create"
        ? secDetails.target.mutation.sections[0]!.provisionalSectionId
        : "";
    expect(provisionalSectionId).toMatch(/^pending:academic-section:/);

    // Append to provisional section body in the same turn
    const appendedSection = await edit.execute(
      "append-sec",
      validatedCall(edit, {
        kind: "section",
        id: provisionalSectionId,
        document: "body",
        append:
          "\n\n每条断言必须映射至 $\\mathcal{C}$ 中的有效条目 [Smith2024]。"
      })
    );
    expect(appendedSection.details).toMatchObject({
      kind: "academic-workspace-mutation",
      target: {
        kind: "document-edit",
        objectKind: "section",
        targetId: provisionalSectionId,
        sectionDocument: "body"
      }
    });

    // Read reference_card by citeKey and update meta + replacements
    const smithRead = await read.execute(
      "read-smith",
      validatedCall(read, { kind: "reference_card", id: "Smith2024" })
    );
    expect(resultText(smithRead)).toContain("27.4%");

    const updatedSmith = await edit.execute(
      "edit-smith",
      validatedCall(edit, {
        kind: "reference_card",
        id: "Smith2024",
        meta: { cite_key: "Smith2024a", card_type: "evidence" },
        replacements: [{ old_text: "27.4%", new_text: "27.4%（95% CI）" }]
      })
    );
    expect(updatedSmith.details).toMatchObject({
      kind: "academic-workspace-mutation",
      target: {
        kind: "document-edit",
        objectKind: "reference_card",
        targetId: "card-smith",
        cardMeta: { citeKey: "Smith2024a", cardType: "evidence" }
      }
    });

    // Duplicate citeKey is rejected
    await expect(
      create.execute(
        "dup-citekey",
        validatedCall(create, {
          kind: "reference_card",
          cite_key: "smith2024a",
          title: "Duplicate Key Card"
        })
      )
    ).rejects.toThrow(/cite_key.*已存在/);
  });

  it("repairs JSON-stringified array/object arguments via prepareArguments and enforces contract limits with field paths", async () => {
    const workspace = createFixtureAcademicWorkspace();
    const tools = buildAcademicWorkspaceTools({
      workspace,
      profile: DEFAULT_ACADEMIC_AGENT_PROFILES[0]!,
      writeApprovalMode: "request-approval",
      requestUserInput: noopUserInput
    });
    const create = toolByName(tools, "create");
    const edit = toolByName(tools, "edit");

    // JSON-stringified `items` repaired cleanly through prepareArguments + validateToolArguments
    const batchParams = validatedCall(create, {
      kind: "reference_card",
      items: JSON.stringify([
        {
          cite_key: "Lee2023",
          card_type: "evidence",
          title: "Lee 2023 Verification",
          content: "提出两阶段引用核查流水线。"
        }
      ])
    });
    const batchResult = await create.execute("batch-str", batchParams);
    expect(batchResult.details).toMatchObject({
      kind: "academic-workspace-mutation",
      target: { kind: "reference-card-create" }
    });

    // JSON-stringified `replacements` repaired cleanly through prepareArguments + validateToolArguments
    const editParams = validatedCall(edit, {
      kind: "foundation",
      id: "thesis_overview",
      replacements: JSON.stringify([
        { old_text: "降低虚构引用率", new_text: "显著降低虚构引用率" }
      ])
    });
    const editResult = await edit.execute("edit-str", editParams);
    expect(editResult.details).toMatchObject({
      kind: "academic-workspace-mutation",
      target: { kind: "document-edit", objectKind: "foundation" }
    });

    // Over-limit batch items & citeKey length fail inside execute with clear field paths
    const overBatchParams = validatedCall(create, {
      kind: "chapter",
      items: Array.from(
        { length: ACADEMIC_BATCH_CREATE_MAX_ITEMS + 1 },
        (_, i) => ({
          title: `第 ${i + 2} 章`
        })
      )
    });
    await expect(create.execute("over-batch", overBatchParams)).rejects.toThrow(
      new RegExp(`${ACADEMIC_BATCH_CREATE_MAX_ITEMS}`)
    );

    const overCiteKeyParams = validatedCall(create, {
      kind: "reference_card",
      items: [
        {
          cite_key: "K".repeat(ACADEMIC_CITE_KEY_MAX_LENGTH + 1),
          title: "Overlong CiteKey"
        }
      ]
    });
    await expect(
      create.execute("over-citekey", overCiteKeyParams)
    ).rejects.toThrow(/items\.0\.cite_key/);
  });
});

describe("academic subagent team delegation & runtime event bubbling", () => {
  it("strips write tools for pure-read reviewers and bubbles collaborator academic.workspace_mutation events", async () => {
    const childContexts: Array<{ subagentId: string; context: Context }> = [];
    const faux = fauxProvider({
      api: `academic-subagent-${Math.random()}`,
      provider: `academic-subagent-${Math.random()}`,
      models: [{ id: "acad-model", name: "Academic Model", reasoning: true }],
      tokensPerSecond: 0
    });
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses([
      // 1st child run: peer_reviewer (pure-read) reads section body
      fauxAssistantMessage([
        fauxToolCall("read", {
          kind: "section",
          id: "sec-1",
          document: "body"
        })
      ]),
      fauxAssistantMessage([
        fauxText("审稿意见：因果推断链条清晰，建议补充消融实验边界。")
      ]),
      // 2nd child run: section_drafter (standard collaborator) appends to provisional section
      fauxAssistantMessage([
        fauxToolCall("edit", {
          kind: "section",
          id: "pending:academic-section:1",
          document: "body",
          append: "\n\n进一步地，我们给出定理 1 的收敛性草图。"
        })
      ]),
      fauxAssistantMessage([fauxText("已完成 1.2 节定理草图续写。")])
    ]);

    const model = faux.getModel("acad-model") as Model<Api>;
    const baseStream = models.streamSimple.bind(models) as StreamFn;
    let callIdx = 0;
    const streamFn: StreamFn = (reqModel, context, opts) => {
      callIdx += 1;
      childContexts.push({
        subagentId: callIdx <= 2 ? "peer_reviewer" : "section_drafter",
        context: inspectTranscript(context)
      });
      return baseStream(reqModel, context, opts);
    };

    const enabledTeam = DEFAULT_ACADEMIC_SUBAGENTS.map((member) => ({
      ...member,
      enabled:
        member.id === "peer_reviewer" ||
        member.id === "citation_auditor" ||
        member.id === "section_drafter"
    }));
    const workspace = createFixtureAcademicWorkspace();
    const input = makeRunInput(workspace, {
      subagentDefinitions: enabledTeam
    });
    const runtime: AgentRuntimeRef = {
      provider: "test-provider",
      model: "acad-model",
      mode: "provider"
    };

    const tools = buildRunTools(input, {
      model,
      thinkingLevel: "off",
      streamFn,
      parentRuntime: runtime,
      toolExecutionHooks: {},
      requestUserInput: noopUserInput,
      getParentMessages: () => [],
      portableToolSchemaProfile: "writing-workspace"
    });

    // Parent creates a provisional section first so child subagents should see it in live directory + shared overlay
    const parentCreate = toolByName(tools, "create");
    await parentCreate.execute(
      "parent-create-sec",
      validatedCall(parentCreate, {
        kind: "section",
        chapter_id: "chap-1",
        title: "1.2 形式化收敛性质",
        body: "初始形式化定义。"
      })
    );

    const spawn = toolByName(tools, "spawn_subagent");
    const progressEvents: SubagentToolProgress[] = [];
    const onUpdate = (partial: { details?: unknown }) => {
      if (isSubagentToolProgressDetails(partial.details)) {
        progressEvents.push(partial.details.progress);
      }
    };

    // Run 1: pure-read peer_reviewer
    await spawn.execute(
      "spawn-reviewer",
      validatedCall(spawn, {
        tasks: [
          {
            subagent_id: "peer_reviewer",
            task: "审阅 1.1 节的方法学严密性。"
          }
        ]
      }),
      undefined,
      onUpdate
    );

    const reviewerTools = (childContexts[0]!.context.tools ?? []).map(
      (t) => t.name
    );
    expect(reviewerTools).toContain("read");
    expect(reviewerTools).toContain("search");
    expect(reviewerTools).toContain("query_linked_material_entries");
    expect(reviewerTools).not.toContain("create");
    expect(reviewerTools).not.toContain("edit");
    expect(reviewerTools).not.toContain("delete");
    expect(reviewerTools).not.toContain("ask_user_question");
    expect(childContexts[0]!.context.systemPrompt).toContain(
      "1.2 形式化收敛性质"
    );

    // Run 2: collaborator section_drafter
    await spawn.execute(
      "spawn-drafter",
      validatedCall(spawn, {
        tasks: [
          {
            subagent_id: "section_drafter",
            task: "在新建的 1.2 节（pending:academic-section:1）末尾补充定理草图。"
          }
        ]
      }),
      undefined,
      onUpdate
    );

    const drafterTools = (childContexts[2]!.context.tools ?? []).map(
      (t) => t.name
    );
    expect(drafterTools).toContain("edit");
    expect(drafterTools).toContain("create");
    expect(drafterTools).not.toContain("ask_user_question");

    const source: AgentRunEventSource = {
      sessionId: input.sessionId,
      runId: input.runId
    };
    const runtimeEvents = progressEvents.flatMap((progress) =>
      toSubagentRuntimeEvents(progress, source, runtime, "msg-acad-1")
    );
    const mutationEvents = runtimeEvents.filter(
      (event) => event.type === "academic.workspace_mutation"
    );
    expect(mutationEvents).toHaveLength(1);
    expect(mutationEvents[0]!.payload).toMatchObject({
      workspaceId: workspace.id,
      target: {
        kind: "document-edit",
        objectKind: "section",
        targetId: "pending:academic-section:1",
        sectionDocument: "body"
      }
    });
  });
});

describe("academic context compaction & L2 rehydration", () => {
  it("stubs >200 char academic prose in mutation arguments and rehydrates skills + terminology + active section tail", async () => {
    const longBody = "严密推导段落。".repeat(60);
    const workspace = createFixtureAcademicWorkspace({
      readSource: "core"
    });
    const coreFileReads: string[] = [];
    const input = makeRunInput(workspace, {
      contextCompactionSettings: ContextCompactionRunSettingsSchema.parse({
        enabled: true,
        budgetTokens: 64_000
      }),
      writingCommandExecutor: async (command: WritingReadCommand) => {
        if (command.payload.query.mode === "file") {
          const docId = command.payload.query.documentId;
          coreFileReads.push(docId);
          const content =
            docId === ACADEMIC_TERMINOLOGY_DOCUMENT_ID
              ? "- EG：证据门控\n- $\\mathcal{C}$：已核验文献卡集合"
              : "定理 1 证明完毕，由此确立了门控机制的收敛上界 [Smith2024]。";
          return {
            status: "accepted",
            requestId: command.id,
            payload: {
              mode: "file",
              id: docId,
              content,
              revision: createShortWorkspaceContentRevision(content),
              length: content.length,
              characters: content.length
            }
          };
        }
        throw new Error("Unexpected query");
      }
    });

    expect(workspaceContextTask(input)).toBe("academic");
    const policy = workspaceContextPolicy(input);
    expect(policy?.task).toBe("academic");

    const createCompactor = WORKSPACE_TOOL_COMPACTORS.create!;
    const stubbedArgs = createCompactor.args!({
      kind: "section",
      items: [
        {
          title: "2.2 实验设置",
          brief: longBody,
          body: longBody,
          state: "简短状态"
        }
      ]
    });
    expect(stubbedArgs).toBeDefined();
    const stubbedItem = (
      stubbedArgs!.items as Array<Record<string, unknown>>
    )[0]!;
    expect(String(stubbedItem.brief)).toContain("已作为提案提交");
    expect(String(stubbedItem.body)).toContain("已作为提案提交");
    expect(stubbedItem.state).toBe("简短状态");

    const skillResult: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "load-skill-1",
      toolName: "load_skill",
      content: [
        {
          type: "text",
          text: "【技能：实证论文讨论段写法】\n讨论段应先回应研究问题。"
        }
      ],
      isError: false,
      timestamp: 1
    };
    const skillRefs = WORKSPACE_TOOL_COMPACTORS.load_skill!.refs!(
      {
        type: "toolCall",
        id: "load-skill-1",
        name: "load_skill",
        arguments: { name: "实证论文讨论段写法" }
      },
      skillResult
    );
    expect(skillRefs).toEqual({ skills: ["实证论文讨论段写法"] });

    const rehydrated = await rehydrateWorkspaceContext(
      input,
      "academic",
      {
        read: [],
        proposed: ["edit section:sec-1/body"],
        skills: ["实证论文讨论段写法"],
        materials: []
      },
      4_000
    );
    expect(rehydrated).toContain("已加载技能：实证论文讨论段写法");
    expect(rehydrated).toContain("术语与符号表（terminology");
    expect(rehydrated).toContain("EG：证据门控");
    expect(rehydrated).toContain(
      "续写衔接：1.1 研究背景与问题定义（sec-1/body"
    );
    expect(rehydrated).toContain("此片段不授予全文覆盖凭证");
    expect(coreFileReads).toContain(ACADEMIC_TERMINOLOGY_DOCUMENT_ID);
    expect(coreFileReads).toContain(
      createAcademicSectionDocumentId("sec-1", "body")
    );
  });
});
