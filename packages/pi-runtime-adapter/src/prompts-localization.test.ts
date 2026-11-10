import {
  BUILTIN_AGENT_SYSTEM_PROMPTS,
  scriptScreenplayFormatRequirements
} from "@deepwrite/contracts";
import type { LongWorkspaceRuntimeContext } from "./index.test-support";
import {
  DEFAULT_LIBRARY_AGENT_PROFILES,
  DEFAULT_LONG_AGENT_PROFILES,
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  buildEffectiveSystemPrompt,
  describe,
  expect,
  it,
  screenplayWorkspace,
  scriptAgentProfile
} from "./index.test-support";
import { buildLongRuntimeToolBoundary } from "./prompts-long";
import { buildLongWorkspaceRules } from "./prompts-long-rules";
import { runtimeConfig } from "./web-search/test-support";

const CJK = /[㐀-鿿]/;

/** Lines of the prompt that this runtime wrote itself (not work data). */
function runtimeLines(prompt: string, workData: readonly string[]): string[] {
  return prompt
    .split("\n")
    .filter((line) => !workData.some((value) => line.includes(value)));
}

function longWorkspace(): LongWorkspaceRuntimeContext {
  return {
    bookId: "longbook_locale",
    title: "Fog Harbor",
    activeRoot: "plot_design",
    activeAgentId: "long",
    navigation: {
      schemaVersion: 1,
      bookId: "longbook_locale",
      updatedAt: "2026-11-08T10:00:00.000Z",
      counts: {
        worldbuildingCategories: 0,
        characters: 0,
        volumes: 0,
        arcs: 0,
        chapterCards: 0,
        storyEvents: 0,
        storyPlots: 0,
        foreshadowingThreads: 0,
        committedChapters: 0
      },
      worldbuilding: [],
      characterTypes: [],
      characters: [],
      volumes: [],
      arcs: [],
      chapterCards: [],
      committedThroughChapterId: null
    }
  } as unknown as LongWorkspaceRuntimeContext;
}

describe("system prompt language", () => {
  it("builds the screenplay prompt entirely in English for en-US", () => {
    const workspace = screenplayWorkspace();
    const profile = {
      ...scriptAgentProfile(),
      systemPrompt: BUILTIN_AGENT_SYSTEM_PROMPTS.script["en-US"]
    };
    const prompt = buildEffectiveSystemPrompt(undefined, {
      runId: "run_script_en",
      sessionId: "session_script_en",
      prompt: "Continue episode one",
      promptLocale: "en-US",
      writeApprovalMode: "auto-approve",
      scriptAgentProfile: profile,
      workspaceContext: { scriptWorkspace: workspace }
    });
    expect(prompt.startsWith("[DeepWrite ground rules]")).toBe(true);
    expect(prompt).toContain(profile.systemPrompt);
    expect(prompt).toContain("[Addressing work objects]");
    expect(prompt).toContain("[Write approval: auto-save]");
    expect(prompt).toContain(
      scriptScreenplayFormatRequirements("en-US").trim()
    );
    const workData = [
      profile.label,
      workspace.title,
      ...workspace.plotStages.flatMap((stage) => [
        stage.title,
        stage.description
      ]),
      ...workspace.expertDraft.sections.map((section) => section.title),
      "内景/外景",
      "【上一轮修改的处理结果】",
      "未修改",
      "未写入"
    ];
    expect(
      runtimeLines(prompt, workData).filter((line) => CJK.test(line))
    ).toEqual([]);
  });

  it("keeps Chinese as the default and for zh-CN runs", () => {
    const input = {
      runId: "run_short_zh",
      sessionId: "session_short_zh",
      prompt: "继续写",
      agentProfile: DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES[0]!,
      workspaceContext: {
        shortWorkspace: { ...screenplayWorkspace(), workspaceType: "short" }
      }
    } as Parameters<typeof buildEffectiveSystemPrompt>[1];
    const implicit = buildEffectiveSystemPrompt(undefined, input);
    expect(implicit.startsWith("【DeepWrite 基础准则】")).toBe(true);
    expect(implicit).toContain("【作品对象定位】");
    expect(implicit).toContain("【写入审批方式：用户审批】");
    expect(
      buildEffectiveSystemPrompt(undefined, { ...input, promptLocale: "zh-CN" })
    ).toBe(implicit);
  });

  it("localizes the long-form layers and the per-turn tool boundary", () => {
    const profile = {
      ...DEFAULT_LONG_AGENT_PROFILES[0]!,
      systemPrompt: BUILTIN_AGENT_SYSTEM_PROMPTS.long["en-US"]
    };
    const prompt = buildEffectiveSystemPrompt(undefined, {
      runId: "run_long_en",
      sessionId: "session_long_en",
      prompt: "Plan volume one",
      promptLocale: "en-US",
      longAgentProfile: profile,
      workspaceContext: { longWorkspace: longWorkspace() }
    });
    expect(prompt).toContain(profile.systemPrompt);
    expect(prompt).toContain(buildLongWorkspaceRules("en-US"));
    expect(prompt).toContain("[Write approval: user review]");
    expect(
      runtimeLines(prompt, [profile.label, "【上一轮修改的处理结果】"]).filter(
        (line) => CJK.test(line)
      )
    ).toEqual([]);
    expect(
      buildLongRuntimeToolBoundary(
        [{ name: "read" }, { name: "list" }],
        "en-US"
      )
    ).toContain("Tools actually available this turn: read, list.");
  });

  it("keeps the long-form rules complete in both languages", () => {
    for (const locale of ["zh-CN", "en-US"] as const) {
      const rules = buildLongWorkspaceRules(locale);
      for (const token of [
        "list",
        "read",
        "create",
        "edit",
        "delete",
        "query_linked_material_entries",
        "load_skill",
        "propose_continuity_commit",
        "ask_user_question",
        "worlditem_",
        "storyplot_",
        "foreshadow_",
        "character_overview",
        "meta.category_id",
        "meta.chapter_order",
        "continuity_character",
        "meta.document=current_state",
        "chapter_card_ids",
        "scope_id",
        "file_id"
      ]) {
        expect(rules, `${locale} ${token}`).toContain(token);
      }
      expect(rules).not.toContain("bookId");
    }
  });

  it("localizes the library agent layers", () => {
    const profile = DEFAULT_LIBRARY_AGENT_PROFILES.find(
      (candidate) => candidate.domain === "skill"
    )!;
    const prompt = buildEffectiveSystemPrompt(undefined, {
      runId: "run_library_en",
      sessionId: "session_library_en",
      prompt: "Create a skill",
      promptLocale: "en-US",
      libraryAgentProfile: {
        ...profile,
        systemPrompt: BUILTIN_AGENT_SYSTEM_PROMPTS.skill["en-US"]
      },
      workspaceContext: {
        libraryWorkspace: {
          domain: "skill",
          libraryId: "skill-library-1",
          title: "Methods",
          kind: "general",
          readOnly: false,
          readableLibraries: []
        }
      }
    } as unknown as Parameters<typeof buildEffectiveSystemPrompt>[1]);
    expect(prompt).toContain(BUILTIN_AGENT_SYSTEM_PROMPTS.skill["en-US"]);
    expect(prompt).toContain("[Library tool rules]");
    expect(prompt).toContain("create_skill_entry");
    expect(prompt).toContain("edit_skill_library_overview");
    expect(prompt).toContain("[Current location]");
    expect(
      runtimeLines(prompt, [profile.label, "【上一轮修改的处理结果】"]).filter(
        (line) => CJK.test(line)
      )
    ).toEqual([]);
  });

  it("localizes the web search section", () => {
    const prompt = buildEffectiveSystemPrompt(undefined, {
      runId: "run_web_en",
      sessionId: "session_web_en",
      prompt: "Check the history",
      promptLocale: "en-US",
      webSearchEnabled: true,
      webSearch: runtimeConfig(),
      scriptAgentProfile: scriptAgentProfile(),
      workspaceContext: { scriptWorkspace: screenplayWorkspace() }
    });
    expect(prompt).toContain("[Web search]");
    expect(prompt).not.toContain("【联网搜索】");
  });
});
