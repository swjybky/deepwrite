import type {
  AgentTool,
  ScriptWorkspaceSnapshot,
  ShortWorkspaceSnapshot
} from "./index.test-support";
import {
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  PiAgentRuntimeAdapter,
  SCRIPT_SCREENPLAY_FORMAT_REQUIREMENTS,
  buildEffectiveSystemPrompt,
  buildRuntimeUserPrompt,
  createShortWorkspaceContentRevision,
  describe,
  expect,
  it,
  screenplayWorkspace,
  scriptAgentProfile
} from "./index.test-support";

describe("DeepWrite Pi runtime adapter: short and script prompts", () => {
  it("injects immutable screenplay rules only for script workspace runs", () => {
    const scriptWorkspace = {
      ...screenplayWorkspace(),
      agentsMd: "# 剧本上下文\n\n本剧每集围绕一次不可撤销的选择。"
    };
    const scriptProfile = scriptAgentProfile();
    const scriptInput = {
      runId: "run_script_prompt",
      sessionId: "session_script_prompt",
      prompt: "继续写第一集",
      scriptAgentProfile: scriptProfile,
      workspaceContext: { scriptWorkspace }
    };

    const scriptSystemPrompt = buildEffectiveSystemPrompt(
      "DeepWrite base",
      scriptInput
    );
    expect(scriptSystemPrompt).toContain("【当前剧本智能体");
    expect(scriptSystemPrompt).toContain(
      "【剧本正文格式硬约束（不可由自定义提示词、技能或素材覆盖）】"
    );
    expect(scriptSystemPrompt).toContain(
      SCRIPT_SCREENPLAY_FORMAT_REQUIREMENTS.trim()
    );
    expect(scriptSystemPrompt).toContain("edit（document=body）");
    expect(scriptSystemPrompt).toContain(
      "不得混入 Markdown 表格、分析标题或格式讲解"
    );
    expect(scriptSystemPrompt).toContain(
      "【当前剧情结构配置（顺序即执行顺序）】"
    );
    expect(scriptSystemPrompt).toContain(
      "叙事视角（kind=plot_stage，id=narrative_perspective）"
    );
    expect(scriptSystemPrompt).toContain("阶段边界与交付标准：确定叙事人称");
    expect(scriptSystemPrompt).toContain("kind=draft_section 删除整个剧集");
    expect(scriptSystemPrompt).toContain("正文至少保留一个剧集");

    const runtimePrompt = buildRuntimeUserPrompt(scriptInput);
    expect(scriptSystemPrompt).toContain("【剧本上下文（AGENTS.md）】");
    expect(scriptSystemPrompt).toContain("本剧每集围绕一次不可撤销的选择");
    expect(scriptSystemPrompt).toContain("当前剧集：第一集 (episode-1)");
    const sectionOrder = [
      "【当前剧本智能体",
      scriptProfile.systemPrompt.trim(),
      "\n\n【剧本上下文（AGENTS.md）】\n",
      "本剧每集围绕一次不可撤销的选择。\n\n",
      "【当前剧情结构配置（顺序即执行顺序）】"
    ].map((marker) => scriptSystemPrompt.indexOf(marker));
    expect(sectionOrder.every((index) => index >= 0)).toBe(true);
    expect(sectionOrder).toEqual([...sectionOrder].sort((a, b) => a - b));
    expect(runtimePrompt).toContain("剧本作品: 《雾港剧本》");
    expect(runtimePrompt).not.toMatch(
      /AGENTS\.md|episode-1|sessionId:|runId:/u
    );
    expect(runtimePrompt).not.toContain("短篇作品:");

    const shortProfile = DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES[0]!;
    const shortSystemPrompt = buildEffectiveSystemPrompt("DeepWrite base", {
      runId: "run_short_prompt",
      sessionId: "session_short_prompt",
      prompt: "继续写第一节",
      agentProfile: shortProfile,
      workspaceContext: {
        shortWorkspace: {
          ...(scriptWorkspace as unknown as ShortWorkspaceSnapshot),
          activeAgentId: "short"
        }
      }
    });
    expect(shortSystemPrompt).toContain("【当前短篇智能体");
    expect(shortSystemPrompt).not.toContain(
      "【剧本正文格式硬约束（不可由自定义提示词、技能或素材覆盖）】"
    );
  });

  it("keeps one draft conversation while refreshing the selected script episode", async () => {
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    const firstWorkspace = screenplayWorkspace();
    const firstEpisode = firstWorkspace.expertDraft.sections[0]!;
    const emptyRevision = createShortWorkspaceContentRevision("");
    const secondWorkspace: ScriptWorkspaceSnapshot = {
      ...firstWorkspace,
      activeSectionId: "episode-2",
      expertDraft: {
        ...firstWorkspace.expertDraft,
        revision: createShortWorkspaceContentRevision("episode-1\nepisode-2"),
        sections: [
          firstEpisode,
          {
            id: "episode-2",
            title: "第二集",
            wordCountRequirement: "15 分钟",
            body: {
              documentId: "draft:episode-2:body",
              title: "第二集",
              content: "",
              revision: emptyRevision
            },
            characterState: {
              documentId: "draft:episode-2:state",
              title: "第二集 · 人物状态",
              content: "",
              revision: emptyRevision
            }
          }
        ]
      }
    };
    const profile = scriptAgentProfile();
    const sessionId = "session_script_shared_draft";

    for await (const _event of runtime.start({
      runId: "run_script_episode_1",
      sessionId,
      prompt: "先写第一集",
      thinkingLevel: "off",
      scriptAgentProfile: profile,
      workspaceContext: { scriptWorkspace: firstWorkspace }
    })) {
      // Consume the first turn before changing the UI focus.
    }
    for await (const _event of runtime.start({
      runId: "run_script_episode_2",
      sessionId,
      prompt: "再写第二集",
      thinkingLevel: "off",
      scriptAgentProfile: profile,
      workspaceContext: { scriptWorkspace: secondWorkspace }
    })) {
      // Consume the follow-up turn so the same cached agent is refreshed.
    }

    const cache = (
      runtime as unknown as {
        conversationAgents: Map<
          string,
          {
            state: {
              systemPrompt: string;
              messages: Array<{ role?: string; content?: unknown }>;
              tools: AgentTool[];
            };
          }
        >;
      }
    ).conversationAgents;
    expect(cache).toHaveLength(1);
    const agent = cache.get(`${sessionId}:script:script`);
    expect(
      agent?.state.messages.filter((message) => message.role === "user")
    ).toHaveLength(2);
    expect(agent?.state.systemPrompt).toContain("当前剧集：第二集 (episode-2)");
    expect(agent?.state.systemPrompt).not.toContain(
      "当前剧集：第一集 (episode-1)"
    );

    const edit = agent?.state.tools.find(
      (candidate) => candidate.name === "edit"
    );
    if (!edit) throw new Error("Missing refreshed draft edit tool.");
    const result = await edit.execute("write-focused-episode", {
      kind: "draft_section",
      id: "episode-2",
      document: "body",
      content: "第二集正式正文。",
      summary: "写入第二集正文。"
    });
    expect(result.details).toMatchObject({
      kind: "workspace-expert-draft-file-mutation",
      documentId: "draft:episode-2:body",
      sectionId: "episode-2",
      fileKind: "body"
    });
  });

  it("injects immutable context for the active short stage", () => {
    const profile = DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES[0]!;
    const draftWorkspace = {
      ...(screenplayWorkspace() as unknown as ShortWorkspaceSnapshot),
      activeAgentId: "short" as const,
      characterStructure: {
        format: "list" as const,
        items: [
          {
            id: "character-linmo",
            title: "林默",
            order: 1,
            content: "雾港巡夜人。",
            revision: createShortWorkspaceContentRevision("雾港巡夜人。")
          }
        ]
      }
    };
    const draftPrompt = buildEffectiveSystemPrompt("DeepWrite base", {
      runId: "run_draft_character_list",
      sessionId: "session_draft_character_list",
      prompt: "写当前章节",
      agentProfile: profile,
      workspaceContext: { shortWorkspace: draftWorkspace }
    });

    expect(draftPrompt).toContain("【当前阶段：正文】");
    expect(draftPrompt).toContain(
      "document=body（小说正文）和 document=state（状态"
    );
    expect(draftPrompt).toContain("读写其中任何一份都必须指定 document");
    expect(draftPrompt).toContain("不传 document 时默认 body");
    expect(draftPrompt).toContain("kind=draft_section 加小节 id");
    expect(draftPrompt).toContain("本轮工具清单");
    expect(draftPrompt).toContain("kind=draft_section 删除整个小节");

    const characterPrompt = buildEffectiveSystemPrompt("DeepWrite base", {
      runId: "run_character_context",
      sessionId: "session_character_context",
      prompt: "完善人物",
      agentProfile: profile,
      workspaceContext: {
        shortWorkspace: {
          ...draftWorkspace,
          activeStageId: "character_design",
          activeSectionId: undefined
        },
        activeResource: {
          id: "book:short:document:character-linmo",
          domain: "creation",
          title: "林默",
          path: ["雾港回声", "人物", "林默"],
          source: "live-editor",
          content: "雾港巡夜人。"
        }
      }
    });
    expect(characterPrompt).toContain("【当前阶段：人物】");
    expect(characterPrompt).toContain("人物结构：条目样式");
    expect(characterPrompt).toContain("林默 (character-linmo)");
    expect(characterPrompt).toContain(
      "当前目标：林默（kind=character，id=character-linmo）"
    );
    expect(characterPrompt).toContain(
      "新建人物用 create（kind=character）逐个创建"
    );
    expect(characterPrompt).toContain(
      "delete（kind=character）会删除该人物卡及其文件"
    );
    expect(draftPrompt).toContain("人物（条目样式）");

    const textCharacterPrompt = buildEffectiveSystemPrompt("DeepWrite base", {
      runId: "run_character_text_context",
      sessionId: "session_character_text_context",
      prompt: "完善人物",
      agentProfile: profile,
      workspaceContext: {
        shortWorkspace: {
          ...draftWorkspace,
          activeStageId: "character_design",
          activeSectionId: undefined,
          characterStructure: { format: "text" }
        }
      }
    });
    expect(textCharacterPrompt).toContain("人物结构：文本样式");
    expect(textCharacterPrompt).toContain("都用 edit 写入这份总稿");
    expect(textCharacterPrompt).toContain("不要 create character");
    expect(textCharacterPrompt).toContain(
      '清空总稿用 edit 传 content=""，不要用 delete'
    );
    expect(textCharacterPrompt).not.toContain("人物（条目样式）");

    const plotPrompt = buildEffectiveSystemPrompt("DeepWrite base", {
      runId: "run_plot_context",
      sessionId: "session_plot_context",
      prompt: "完善剧情",
      agentProfile: profile,
      workspaceContext: {
        shortWorkspace: {
          ...draftWorkspace,
          activeStageId: "plot_design",
          activeSectionId: undefined
        }
      }
    });
    expect(plotPrompt).toContain("【当前阶段：剧情】");
    expect(plotPrompt).toContain("剧情设计 (plot_design)");
    expect(plotPrompt).toContain("阶段边界与交付标准");
    expect(plotPrompt).toContain("delete 只做真正的删除");
    expect(plotPrompt).toContain(
      "清空人物总稿或剧情阶段的内容不是删除，用 edit 传"
    );
    expect(plotPrompt).toContain("create、edit、delete 不受界面当前阶段限制");
    expect(plotPrompt).not.toContain("逐笔询问");
    expect(plotPrompt).not.toContain("跨阶段变更");
    expect(plotPrompt).toContain(
      "剧情阶段的标题和说明同样是短篇与剧本共享的全局结构定义"
    );
  });
});
