import type {
  AgentTool,
  LongWorkspaceRuntimeContext,
  ScriptWorkspaceSnapshot,
  ShortWorkspaceSnapshot
} from "./index.test-support";
import {
  DEFAULT_LONG_AGENT_PROFILES,
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  PiAgentRuntimeAdapter,
  SCRIPT_SCREENPLAY_FORMAT_REQUIREMENTS,
  buildEffectiveSystemPrompt,
  buildRuntimeUserPrompt,
  createShortWorkspaceContentRevision,
  describe,
  expect,
  it,
  normalChatContext,
  screenplayWorkspace,
  scriptAgentProfile
} from "./index.test-support";

describe("DeepWrite Pi runtime adapter: workspace-prompts", () => {
  it("isolates chat-assistant prompts, tools and cached history from workspace agents", async () => {
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    const sessionId = "session_shared_chat_boundary";

    for (const [runId, prompt] of [
      ["run_chat_1", "你好，只聊聊天"],
      ["run_chat_2", "继续刚才的话题"]
    ] as const) {
      for await (const _event of runtime.start({
        runId,
        sessionId,
        prompt,
        mode: "chat-assistant",
        chatAssistantRuntimeContext: normalChatContext(),
        thinkingLevel: "off"
      })) {
        // Consume the isolated chat turn before inspecting the cache.
      }
    }

    for await (const _event of runtime.start({
      runId: "run_workspace_same_session",
      sessionId,
      prompt: "分析当前内容",
      thinkingLevel: "off",
      workspaceContext: {
        activeResource: {
          id: "workspace_resource",
          domain: "creation",
          title: "工作区文稿",
          path: ["工作区文稿"],
          source: "live-editor",
          content: "这段内容不能进入聊天助手。"
        }
      }
    })) {
      // Consume a workspace turn with the same session id.
    }

    const cache = (
      runtime as unknown as {
        conversationAgents: Map<
          string,
          {
            state: {
              systemPrompt: string;
              tools: Array<{ name: string }>;
              messages: Array<{ role?: string; content?: unknown }>;
            };
          }
        >;
      }
    ).conversationAgents;
    expect([...cache.keys()]).toEqual(
      expect.arrayContaining([
        `${sessionId}:chat-assistant:normal`,
        `${sessionId}:default`
      ])
    );

    const chat = cache.get(`${sessionId}:chat-assistant:normal`)!;
    expect(chat.state.tools.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "list_creation_projects",
        "get_creation_project_summary",
        "query_model_configs",
        "query_model_usage"
      ])
    );
    expect(chat.state.tools.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining(["read_workspace_content", "edit_text"])
    );
    expect(chat.state.systemPrompt).toContain("普通聊天模式");
    expect(chat.state.systemPrompt).not.toContain("本地创作协作智能体");
    const chatUserMessages = chat.state.messages.filter(
      (message) => message.role === "user"
    );
    expect(chatUserMessages.map((message) => message.content)).toEqual([
      "你好，只聊聊天",
      "继续刚才的话题"
    ]);
    expect(JSON.stringify(chatUserMessages)).not.toContain("sessionId");
    expect(JSON.stringify(chatUserMessages)).not.toContain("工作区文稿");
  });

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
    expect(scriptSystemPrompt).toContain("write（document=body）");
    expect(scriptSystemPrompt).toContain(
      "不得混入 Markdown 表格、分析标题或格式讲解"
    );
    expect(scriptSystemPrompt).toContain(
      "【当前剧情结构配置（顺序即执行顺序）】"
    );
    expect(scriptSystemPrompt).toContain("叙事视角（narrative_perspective）");
    expect(scriptSystemPrompt).toContain("阶段边界与交付标准：确定叙事人称");
    expect(scriptSystemPrompt).toContain(
      "delete（kind=draft_section）会删除整个剧集"
    );
    expect(scriptSystemPrompt).toContain("正文至少保留一个剧集");

    const runtimePrompt = buildRuntimeUserPrompt(scriptInput);
    expect(runtimePrompt).toContain("【剧本上下文（AGENTS.md）】");
    expect(runtimePrompt).toContain("本剧每集围绕一次不可撤销的选择");
    expect(runtimePrompt).toContain("【当前剧本情况（发送时快照）】");
    expect(runtimePrompt).toContain("剧本作品: 《雾港剧本》");
    expect(runtimePrompt).toContain(
      "当前用户正在操作的剧集: 第一集（section_id=episode-1）"
    );
    expect(runtimePrompt).toContain(
      "正文目录剧集（由早到晚）: 第一集 (episode-1)"
    );
    expect(runtimePrompt).toContain(
      "人物结构: 文本样式（所有人物写在同一份总稿，kind=character_overview、id=character_design）"
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

  it("describes DeepSeek server-side search for workspace agents only when enabled", () => {
    const shortProfile = DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES[0]!;
    const workspaceContext = {
      shortWorkspace: {
        ...(screenplayWorkspace() as unknown as ShortWorkspaceSnapshot),
        activeAgentId: "short" as const
      }
    };
    const disabledPrompt = buildEffectiveSystemPrompt("DeepWrite base", {
      runId: "run_short_search_off",
      sessionId: "session_short_search_off",
      prompt: "继续写第一节",
      agentProfile: shortProfile,
      workspaceContext
    });
    expect(disabledPrompt).not.toContain("本轮已启用 DeepSeek 服务端智能搜索");
    expect(disabledPrompt).not.toContain(
      "实时公开信息使用 DeepSeek 服务端 web_search"
    );

    const enabledPrompt = buildEffectiveSystemPrompt("DeepWrite base", {
      runId: "run_short_search_on",
      sessionId: "session_short_search_on",
      prompt: "查一下同类题材",
      agentProfile: shortProfile,
      webSearchEnabled: true,
      workspaceContext
    });
    expect(enabledPrompt).toContain("本轮已启用 DeepSeek 服务端智能搜索");
    expect(enabledPrompt).toContain(
      "实时公开信息使用 DeepSeek 服务端 web_search"
    );
    expect(enabledPrompt).toContain(
      "网络能力仅限本轮列出的 DeepSeek 服务端 web_search"
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

    const write = agent?.state.tools.find(
      (candidate) => candidate.name === "write"
    );
    if (!write) throw new Error("Missing refreshed draft write tool.");
    const result = await write.execute("write-focused-episode", {
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
    expect(draftPrompt).toContain("document=body 与 document=character_state");
    expect(draftPrompt).toContain("必须指定 document");
    expect(draftPrompt).toContain("不传 document 时默认 body");
    expect(draftPrompt).toContain(
      "kind=draft_section 必须同时给出 document=body 或 character_state"
    );
    expect(draftPrompt).toContain("read、create、edit、write、delete");
    expect(draftPrompt).toContain("delete（kind=draft_section）会删除整个小节");

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
      "用 create（kind=character）为每个人物创建独立条目"
    );
    expect(characterPrompt).toContain(
      "用 delete（kind=character）删除指定人物条目及其文件"
    );
    expect(draftPrompt).toContain(
      "当前人物结构是条目样式：创建人物时用 create（kind=character）"
    );

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
    expect(textCharacterPrompt).toContain("创建人物就是把全部人设写入这份文本");
    expect(textCharacterPrompt).toContain("不要 create character");
    expect(textCharacterPrompt).toContain(
      "delete 只会清空总稿内容并保留人物结构"
    );
    expect(textCharacterPrompt).toContain(
      "当前人物结构是文本样式：创建人物时不要用 create"
    );

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
    expect(plotPrompt).toContain(
      "delete（kind=plot_stage）只会清空指定阶段正文"
    );

    const autoApprovedPrompt = buildEffectiveSystemPrompt("DeepWrite base", {
      runId: "run_plot_auto_approved_context",
      sessionId: "session_plot_auto_approved_context",
      prompt: "跨阶段完善人物",
      agentProfile: profile,
      autoApproveCrossStageOperations: true,
      workspaceContext: {
        shortWorkspace: {
          ...draftWorkspace,
          activeStageId: "plot_design",
          activeSectionId: undefined
        }
      }
    });
    expect(autoApprovedPrompt).toContain(
      "跨阶段操作已由用户在常规设置中授权自动允许，不会逐笔询问"
    );
    expect(autoApprovedPrompt).toContain("变更提案仍按当前写入审批方式处理");
    expect(autoApprovedPrompt).not.toContain(
      "每笔跨阶段变更都会单独请求用户确认"
    );
  });

  it("uses only the configured long-agent prompt and discards the base prompt", () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "long"
    )!;
    const longWorkspace: LongWorkspaceRuntimeContext = {
      bookId: "longbook_prompt",
      title: "雾港长篇",
      activeRoot: "plot_design",
      activeAgentId: profile.id,
      navigation: {
        schemaVersion: 1,
        bookId: "longbook_prompt",
        updatedAt: "2026-07-26T10:00:00.000Z",
        counts: {
          worldbuildingCategories: 0,
          characters: 0,
          volumes: 1,
          arcs: 0,
          chapterCards: 0,
          storyEvents: 0,
          storyPlots: 0,
          foreshadowingThreads: 0,
          committedChapters: 0
        },
        worldbuilding: [],
        characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
        characters: [],
        volumes: [{ id: "volume_prompt", title: "第一卷", order: 1 }],
        arcs: [],
        chapterCards: [],
        committedThroughChapterId: null
      }
    };
    const prompt = buildEffectiveSystemPrompt("DeepWrite base", {
      runId: "run_long_prompt",
      sessionId: "session_long_prompt",
      prompt: "调整结构",
      writeApprovalMode: "auto-approve",
      longAgentProfile: profile,
      workspaceContext: { longWorkspace }
    });

    expect(prompt).toBe(profile.systemPrompt.trim());
    expect(prompt).not.toContain("DeepWrite base");
    expect(prompt).not.toContain("【当前长篇智能体");
    expect(prompt).not.toContain("【DeepWrite 长篇工具边界】");
  });

  it("keeps the long chapter-writer runtime boundary limited to novel body", () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "long"
    )!;
    const longWorkspace: LongWorkspaceRuntimeContext = {
      bookId: "longbook_writer_prompt",
      title: "雾港长篇",
      activeRoot: "draft",
      activeAgentId: profile.id,
      activeChapterCardId: "chapter_writer_prompt",
      navigation: {
        schemaVersion: 1,
        bookId: "longbook_writer_prompt",
        updatedAt: "2026-08-02T10:00:00.000Z",
        counts: {
          worldbuildingCategories: 0,
          characters: 0,
          volumes: 1,
          arcs: 1,
          chapterCards: 1,
          storyEvents: 0,
          storyPlots: 0,
          foreshadowingThreads: 0,
          committedChapters: 0
        },
        worldbuilding: [],
        characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
        characters: [],
        volumes: [{ id: "volume_writer_prompt", title: "第一卷", order: 1 }],
        arcs: [
          {
            id: "arc_writer_prompt",
            volumeId: "volume_writer_prompt",
            title: "主线",
            order: 1
          }
        ],
        chapterCards: [
          {
            id: "chapter_writer_prompt",
            volumeId: "volume_writer_prompt",
            primaryArcId: "arc_writer_prompt",
            title: "第一章",
            narrativeOrder: 1,
            bodyStatus: "empty"
          }
        ],
        committedThroughChapterId: null
      }
    };

    const prompt = buildEffectiveSystemPrompt("DeepWrite base", {
      runId: "run_writer_prompt",
      sessionId: "session_writer_prompt",
      prompt: "写第一章",
      longAgentProfile: profile,
      workspaceContext: { longWorkspace }
    });

    expect(prompt).toBe(profile.systemPrompt.trim());
    expect(prompt).toContain("All five stages share the same tools");
    expect(prompt).toContain(
      "The fixed context already contains the worldbuilding directory, character directory, and long-form structure navigation."
    );
    expect(prompt).toContain(
      "Do not request, infer, or repeat implementation details"
    );
    expect(prompt).not.toContain("必须同时形成正文");
  });

  it("lets the continuity ledger write any unrecorded chapter and catch up in one pass", () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "long"
    )!;
    const longWorkspace: LongWorkspaceRuntimeContext = {
      bookId: "longbook_ledger_prompt",
      title: "雾港长篇",
      activeRoot: "continuity_ledger",
      activeAgentId: profile.id,
      navigation: {
        schemaVersion: 1,
        bookId: "longbook_ledger_prompt",
        updatedAt: "2026-08-16T10:00:00.000Z",
        counts: {
          worldbuildingCategories: 0,
          characters: 0,
          volumes: 1,
          arcs: 0,
          chapterCards: 0,
          storyEvents: 0,
          storyPlots: 0,
          foreshadowingThreads: 0,
          committedChapters: 0
        },
        worldbuilding: [],
        characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
        characters: [],
        volumes: [{ id: "volume_ledger_prompt", title: "第一卷", order: 1 }],
        arcs: [],
        chapterCards: [],
        committedThroughChapterId: null
      }
    };

    const prompt = buildEffectiveSystemPrompt("DeepWrite base", {
      runId: "run_ledger_prompt",
      sessionId: "session_ledger_prompt",
      prompt: "批量提交所有未提交章节",
      longAgentProfile: profile,
      workspaceContext: { longWorkspace }
    });

    expect(prompt).toContain("propose_continuity_commit");
    expect(prompt).toContain(
      "The foreshadowing overview is the design source."
    );
  });

  it("keeps worldbuilding prompts on business ids and hides file controls", () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "long"
    )!;
    const longWorkspace: LongWorkspaceRuntimeContext = {
      bookId: "longbook_world_prompt",
      title: "雾港长篇",
      activeRoot: "worldbuilding",
      activeAgentId: profile.id,
      activeFileId: "file_world_rules:content",
      worldbuildingDirectory: {
        categories: [
          {
            categoryId: "world_rules",
            title: "世界规则",
            order: 1,
            format: "text"
          },
          {
            categoryId: "world_factions",
            title: "势力",
            order: 2,
            format: "list",
            itemCount: 2,
            items: [
              {
                itemId: "worlditem_watchers",
                title: "守夜人",
                order: 1
              },
              {
                itemId: "worlditem_harbor",
                title: "港务会",
                order: 2
              }
            ],
            omittedItemCount: 0
          }
        ],
        omittedCategoryCount: 0
      },
      worldbuildingFocus: {
        categoryTitle: "世界规则",
        format: "text",
        currentStage: {
          kind: "text",
          title: "世界规则",
          text: { content: "雾潮期间禁止点燃蓝焰。" }
        }
      },
      navigation: {
        schemaVersion: 1,
        bookId: "longbook_world_prompt",
        updatedAt: "2026-07-26T10:00:00.000Z",
        counts: {
          worldbuildingCategories: 1,
          characters: 0,
          volumes: 1,
          arcs: 0,
          chapterCards: 0,
          storyEvents: 0,
          storyPlots: 0,
          foreshadowingThreads: 0,
          committedChapters: 0
        },
        worldbuilding: [
          {
            id: "world_rules",
            title: "世界规则",
            order: 1,
            format: "text"
          }
        ],
        characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
        characters: [],
        volumes: [{ id: "volume_world_prompt", title: "第一卷", order: 1 }],
        arcs: [],
        chapterCards: [],
        committedThroughChapterId: null
      }
    };
    const input = {
      runId: "run_world_prompt",
      sessionId: "session_world_prompt",
      prompt: "核对世界规则",
      longAgentProfile: profile,
      workspaceContext: { longWorkspace }
    };

    const systemPrompt = buildEffectiveSystemPrompt("DeepWrite base", input);
    expect(systemPrompt).toBe(profile.systemPrompt.trim());
    expect(systemPrompt).toContain("All five stages share the same tools");
    expect(systemPrompt).toContain("list");
    expect(systemPrompt).toContain(
      "Do not request, infer, or repeat implementation details"
    );
    expect(systemPrompt).not.toContain("bookId");
    expect(systemPrompt).not.toContain(" / worldbuilding");
    expect(systemPrompt).toContain(
      "The fixed context already contains the worldbuilding directory, character directory, and long-form structure navigation."
    );
    expect(systemPrompt).toContain(
      "worldbuilding categories and character types"
    );

    const userPrompt = buildRuntimeUserPrompt(input);
    expect(userPrompt).toContain("长篇作品: 《雾港长篇》");
    expect(userPrompt).toContain("【世界观条目列表（发送时快照）】");
    expect(userPrompt).toContain("【人物设计列表（发送时快照）】");
    expect(userPrompt).toContain(
      "【长篇结构导航（发送时快照；条目正文与最新内容请通过工具读取）】"
    );
    expect(userPrompt).toContain("【当前阶段信息与要求】");
    expect(userPrompt.indexOf("【世界观条目列表（发送时快照）】")).toBeLessThan(
      userPrompt.indexOf("【人物设计列表（发送时快照）】")
    );
    expect(userPrompt.indexOf("【人物设计列表（发送时快照）】")).toBeLessThan(
      userPrompt.indexOf(
        "【长篇结构导航（发送时快照；条目正文与最新内容请通过工具读取）】"
      )
    );
    expect(
      userPrompt.indexOf(
        "【长篇结构导航（发送时快照；条目正文与最新内容请通过工具读取）】"
      )
    ).toBeLessThan(userPrompt.indexOf("【当前阶段信息与要求】"));
    expect(userPrompt).toContain(
      "全书共 1 卷、0 个剧情点、0 张章卡、0 条故事情节、0 个故事事件、0 条伏笔线"
    );
    expect(userPrompt).toContain(
      "- 第 1 卷「第一卷」(volume_world_prompt): 暂无剧情点"
    );
    expect(userPrompt).not.toContain("当前剧情工作区");
    expect(userPrompt).toContain(
      "世界规则（category_id=world_rules；类型=文本）"
    );
    expect(userPrompt).toContain(
      "势力（category_id=world_factions；类型=条目列表；共 2 项）"
    );
    expect(userPrompt).toContain(
      "守夜人（item_id=worlditem_watchers；顺序=1）"
    );
    expect(userPrompt).toContain("主角（type_id=protagonist；共 0 人）");
    expect(userPrompt).toContain("当前智能体: 长篇智能体");
    expect(userPrompt).toContain(
      "当前用户所处的世界观阶段: 文本型分类「世界规则」（category_id=world_rules）"
    );
    expect(userPrompt).toContain(
      "当前阶段简要信息: 仅定位当前页面，正文未注入；需要时调用 read（id=world_rules）读取。"
    );
    expect(userPrompt).not.toContain("雾潮期间禁止点燃蓝焰。");
    expect(userPrompt).not.toContain("当前阶段信息:");
    expect(userPrompt).not.toContain("当前分类概览");
    expect(userPrompt).not.toContain("另一侧人物");
    expect(userPrompt).not.toContain("当前根节点:");
    expect(userPrompt).not.toContain("(worldbuilding)");
    expect(userPrompt).not.toContain("longbook_world_prompt");
    expect(userPrompt).not.toContain("file_world_rules:content");
    expect(userPrompt).not.toContain("v1:0:00000000");
    expect(userPrompt).not.toContain("session_world_prompt");
    expect(userPrompt).not.toContain("run_world_prompt");

    const listPrompt = buildRuntimeUserPrompt({
      ...input,
      workspaceContext: {
        longWorkspace: {
          ...longWorkspace,
          worldbuildingFocus: {
            categoryTitle: "势力",
            format: "list",
            currentStage: {
              kind: "item",
              title: "守夜人",
              text: { content: "守夜人负责执行宵禁。" }
            },
            overview: { content: "各势力争夺港务权。" }
          }
        }
      }
    });
    expect(listPrompt).toContain(
      "当前用户所处的世界观阶段: 列表型分类「势力」 / 条目「守夜人」（category_id=world_factions；item_id=worlditem_watchers）"
    );
    expect(listPrompt).toContain(
      "当前阶段简要信息: 仅定位当前页面，正文未注入；需要时调用 read（id=worlditem_watchers）读取。"
    );
    expect(listPrompt).not.toContain("守夜人负责执行宵禁。");
    expect(listPrompt).not.toContain("各势力争夺港务权。");
    expect(listPrompt).not.toContain("当前分类概览");
  });

  it("keeps character prompts on business ids and injects a brief focused stage", () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "long"
    )!;
    const longWorkspace: LongWorkspaceRuntimeContext = {
      bookId: "longbook_character_prompt",
      title: "雾港长篇",
      activeRoot: "character_design",
      activeAgentId: profile.id,
      activeFileId: "file_character_lan:relationships",
      worldbuildingDirectory: {
        categories: [
          {
            categoryId: "world_rules",
            title: "世界规则",
            order: 1,
            format: "text"
          }
        ],
        omittedCategoryCount: 0
      },
      characterFocus: {
        characterName: "林岚",
        group: "chartype_viewpoint",
        currentDocument: {
          kind: "relationships",
          title: "人物关系",
          text: { content: "与沈砚暂时合作。" }
        },
        coreProfile: { content: "雾港巡夜人，害怕深水。" }
      },
      navigation: {
        schemaVersion: 1,
        bookId: "longbook_character_prompt",
        updatedAt: "2026-07-26T10:00:00.000Z",
        counts: {
          worldbuildingCategories: 0,
          characters: 1,
          volumes: 1,
          arcs: 0,
          chapterCards: 0,
          storyEvents: 0,
          storyPlots: 0,
          foreshadowingThreads: 0,
          committedChapters: 0
        },
        worldbuilding: [],
        characterTypes: [
          { id: "chartype_viewpoint", title: "视角人物", order: 1 }
        ],
        characters: [
          {
            id: "character_lan",
            name: "林岚",
            group: "chartype_viewpoint",
            order: 1
          }
        ],
        volumes: [{ id: "volume_character_prompt", title: "第一卷", order: 1 }],
        arcs: [],
        chapterCards: [],
        committedThroughChapterId: null
      }
    };
    const input = {
      runId: "run_character_prompt",
      sessionId: "session_character_prompt",
      prompt: "完善人物关系",
      longAgentProfile: profile,
      workspaceContext: { longWorkspace }
    };

    const systemPrompt = buildEffectiveSystemPrompt("DeepWrite base", input);
    expect(systemPrompt).toContain("list");
    expect(systemPrompt).toContain("read");
    expect(systemPrompt).toContain(
      "Do not request, infer, or repeat implementation details"
    );
    expect(systemPrompt).toBe(profile.systemPrompt.trim());
    expect(systemPrompt).not.toContain("bookId");

    const userPrompt = buildRuntimeUserPrompt(input);
    expect(userPrompt).toContain("【世界观条目列表（发送时快照）】");
    expect(userPrompt).toContain(
      "世界规则（category_id=world_rules；类型=文本）"
    );
    expect(userPrompt).toContain("【人物设计列表（发送时快照）】");
    expect(userPrompt).toContain(
      "【长篇结构导航（发送时快照；条目正文与最新内容请通过工具读取）】"
    );
    expect(userPrompt).toContain("【当前阶段信息与要求】");
    expect(userPrompt.indexOf("【人物设计列表（发送时快照）】")).toBeLessThan(
      userPrompt.indexOf(
        "【长篇结构导航（发送时快照；条目正文与最新内容请通过工具读取）】"
      )
    );
    expect(
      userPrompt.indexOf(
        "【长篇结构导航（发送时快照；条目正文与最新内容请通过工具读取）】"
      )
    ).toBeLessThan(userPrompt.indexOf("【当前阶段信息与要求】"));
    expect(userPrompt).toContain(
      "全书共 1 卷、0 个剧情点、0 张章卡、0 条故事情节、0 个故事事件、0 条伏笔线"
    );
    expect(userPrompt).not.toContain("当前剧情工作区");
    expect(userPrompt).toContain(
      "视角人物（type_id=chartype_viewpoint；共 1 人）"
    );
    expect(userPrompt).toContain("林岚（id=character_lan；顺序=1）");
    expect(userPrompt).toContain(
      "当前用户所处的人物阶段: 「林岚」 / 人物关系（id=character_lan；document=relationships；type_id=chartype_viewpoint）"
    );
    expect(userPrompt).toContain(
      "当前阶段简要信息: 仅定位当前人物文档，正文未注入；需要时调用 read（id=character_lan, document=relationships）读取。"
    );
    expect(userPrompt).not.toContain("与沈砚暂时合作。");
    expect(userPrompt).not.toContain("雾港巡夜人，害怕深水。");
    expect(userPrompt).not.toContain("人物核心档案:");
    expect(userPrompt).not.toContain("【人物类型目录");
    expect(userPrompt).not.toContain("另一侧世界观");
    expect(userPrompt).not.toContain("当前根节点:");
    expect(userPrompt).not.toContain("longbook_character_prompt");
    expect(userPrompt).not.toContain("file_character_lan:relationships");
    expect(userPrompt).not.toContain("session_character_prompt");
    expect(userPrompt).not.toContain("run_character_prompt");
  });

  it("caps the setting-agent character directory at 50 people per type", () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "long"
    )!;
    const extras = Array.from({ length: 52 }, (_, index) => ({
      id: `character_extra_${String(index + 1).padStart(2, "0")}`,
      name: `配角${index + 1}`,
      group: "supporting",
      order: index + 1
    }));
    const userPrompt = buildRuntimeUserPrompt({
      runId: "run_character_directory_cap",
      sessionId: "session_character_directory_cap",
      prompt: "补充配角",
      longAgentProfile: profile,
      workspaceContext: {
        longWorkspace: {
          bookId: "longbook_character_directory",
          title: "雾港长篇",
          activeRoot: "worldbuilding",
          activeAgentId: profile.id,
          worldbuildingDirectory: {
            categories: [
              {
                categoryId: "world_rules",
                title: "世界规则",
                order: 1,
                format: "text"
              }
            ],
            omittedCategoryCount: 0
          },
          navigation: {
            schemaVersion: 1,
            bookId: "longbook_character_directory",
            updatedAt: "2026-07-26T10:00:00.000Z",
            counts: {
              worldbuildingCategories: 0,
              characters: extras.length,
              volumes: 1,
              arcs: 0,
              chapterCards: 0,
              storyEvents: 0,
              storyPlots: 0,
              foreshadowingThreads: 0,
              committedChapters: 0
            },
            worldbuilding: [],
            characterTypes: [{ id: "supporting", title: "配角", order: 1 }],
            characters: extras,
            volumes: [
              { id: "volume_character_directory", title: "第一卷", order: 1 }
            ],
            arcs: [],
            chapterCards: [],
            committedThroughChapterId: null
          }
        }
      }
    });

    expect(userPrompt).toContain("【世界观条目列表（发送时快照）】");
    expect(userPrompt).toContain("【人物设计列表（发送时快照）】");
    expect(userPrompt).toContain("配角（type_id=supporting；共 52 人）");
    expect(userPrompt).toContain("配角1（id=character_extra_01；顺序=1）");
    expect(userPrompt).toContain("配角50（id=character_extra_50；顺序=50）");
    expect(userPrompt).not.toContain("character_extra_51");
    expect(userPrompt).not.toContain("配角51");
    expect(userPrompt).toContain(
      "另有 2 人未进入固定上下文，需要时调用 list（stage=character, scope_id=supporting）查询。"
    );
  });

  it("injects only the nearby chapter-card window around the active chapter", () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "long"
    )!;
    const chapterCards = Array.from({ length: 60 }, (_, index) => ({
      id: `chapter_window_${String(index + 1).padStart(2, "0")}`,
      volumeId: "volume_window",
      primaryArcId: "arc_window",
      title: `第${index + 1}章`,
      narrativeOrder: index + 1,
      bodyStatus: index < 59 ? ("written" as const) : ("empty" as const)
    }));
    const longWorkspace: LongWorkspaceRuntimeContext = {
      bookId: "longbook_chapter_window",
      title: "章卡窗口测试",
      activeRoot: "draft",
      activeAgentId: profile.id,
      activeChapterCardId: "chapter_window_30",
      navigation: {
        schemaVersion: 1,
        bookId: "longbook_chapter_window",
        updatedAt: "2026-08-19T00:00:00.000Z",
        counts: {
          worldbuildingCategories: 0,
          characters: 0,
          volumes: 1,
          arcs: 1,
          chapterCards: chapterCards.length,
          storyEvents: 0,
          storyPlots: 0,
          foreshadowingThreads: 0,
          committedChapters: 0
        },
        worldbuilding: [],
        characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
        characters: [],
        volumes: [{ id: "volume_window", title: "第一卷", order: 1 }],
        arcs: [
          {
            id: "arc_window",
            volumeId: "volume_window",
            title: "主线",
            order: 1
          }
        ],
        chapterCards,
        committedThroughChapterId: null
      }
    };

    const userPrompt = buildRuntimeUserPrompt({
      runId: "run_chapter_window",
      sessionId: "session_chapter_window",
      prompt: "写当前章",
      longAgentProfile: profile,
      workspaceContext: { longWorkspace }
    });

    expect(userPrompt).toContain("正文进度：已写 59 章，空白 1 章。");
    expect(userPrompt).toContain("27. 「第27章」(chapter_window_27)");
    expect(userPrompt).toContain(
      "30. 「第30章」(chapter_window_30)；分卷=第 1 卷「第一卷」(volume_window)；卷内顺序=30；主剧情点=「主线」(arc_window)；正文=已写；当前章=是"
    );
    expect(userPrompt).toContain("40. 「第40章」(chapter_window_40)");
    expect(userPrompt).toContain(
      "目录窗口：围绕当前章展示第 27-40 张（前最多 3 张、后最多 10 张）；之前省略 26 张，之后省略 20 张。需要完整目录时按上下文中的 volume_id 调用 list（stage=draft, scope_id=<volume_id>）查询。"
    );
    expect(userPrompt).toContain(
      "查连续性：list（stage=continuity, scope_id=chapter_window_30）"
    );
    expect(userPrompt).not.toContain("「第26章」(chapter_window_26)");
    expect(userPrompt).not.toContain("「第41章」(chapter_window_41)");

    const noActiveChapterPrompt = buildRuntimeUserPrompt({
      runId: "run_chapter_window_without_active",
      sessionId: "session_chapter_window_without_active",
      prompt: "规划全书",
      longAgentProfile: profile,
      workspaceContext: {
        longWorkspace: {
          ...longWorkspace,
          activeChapterCardId: undefined
        }
      }
    });

    expect(noActiveChapterPrompt).toContain("1. 「第1章」(chapter_window_01)");
    expect(noActiveChapterPrompt).toContain("3. 「第3章」(chapter_window_03)");
    expect(noActiveChapterPrompt).toContain(
      "51. 「第51章」(chapter_window_51)"
    );
    expect(noActiveChapterPrompt).toContain(
      "60. 「第60章」(chapter_window_60)"
    );
    expect(noActiveChapterPrompt).not.toContain(
      "4. 「第4章」(chapter_window_04)"
    );
    expect(noActiveChapterPrompt).not.toContain(
      "50. 「第50章」(chapter_window_50)"
    );
    expect(noActiveChapterPrompt).toContain(
      "目录窗口：当前未选中章卡，展示最前 3 张与最后 10 张；中间省略 47 张。需要完整目录时按上下文中的 volume_id 调用 list（stage=draft, scope_id=<volume_id>）查询。"
    );
  });

  it("injects plot structure navigation and refreshes the plot position on every turn", async () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "long"
    )!;
    const navigation = {
      schemaVersion: 1 as const,
      bookId: "longbook_plot_prompt",
      updatedAt: "2026-07-26T10:00:00.000Z",
      counts: {
        worldbuildingCategories: 1,
        characters: 1,
        volumes: 2,
        arcs: 3,
        chapterCards: 1,
        storyEvents: 0,
        storyPlots: 2,
        foreshadowingThreads: 1,
        committedChapters: 1
      },
      worldbuilding: [
        {
          id: "world_rules",
          title: "世界规则",
          order: 1,
          format: "text" as const
        }
      ],
      characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
      characters: [
        {
          id: "character_lan",
          name: "林岚",
          group: "protagonist",
          order: 1
        }
      ],
      volumes: [
        { id: "volume_plot_a", title: "起势", order: 1 },
        { id: "volume_plot_b", title: "转折", order: 2 }
      ],
      arcs: [
        {
          id: "arc_plot_main",
          volumeId: "volume_plot_a",
          title: "主线",
          order: 1
        },
        {
          id: "arc_plot_hidden",
          volumeId: "volume_plot_a",
          title: "暗线",
          order: 2
        },
        {
          id: "arc_plot_turn",
          volumeId: "volume_plot_b",
          title: "反击",
          order: 1
        }
      ],
      chapterCards: [
        {
          id: "chapter_plot_one",
          volumeId: "volume_plot_a",
          primaryArcId: "arc_plot_main",
          title: "第一章",
          narrativeOrder: 1,
          bodyStatus: "written" as const
        }
      ],
      committedThroughChapterId: "chapter_plot_one"
    };
    const longWorkspace: LongWorkspaceRuntimeContext = {
      bookId: "longbook_plot_prompt",
      title: "雾港长篇",
      activeRoot: "plot_design",
      activeAgentId: profile.id,
      activeFileId: "file_long-book-line",
      agentsMd: "# 长篇上下文\n\n## 剧情点阶段\n维护结构。",
      worldbuildingDirectory: {
        categories: [
          {
            categoryId: "world_rules",
            title: "世界规则",
            order: 1,
            format: "text"
          },
          {
            categoryId: "world_factions",
            title: "势力",
            order: 2,
            format: "list",
            itemCount: 1,
            items: [
              {
                itemId: "worlditem_watchers",
                title: "守夜人",
                order: 1
              }
            ],
            omittedItemCount: 0
          }
        ],
        omittedCategoryCount: 0
      },
      navigation,
      plotFocus: {
        section: "plot_point",
        volumeId: "volume_plot_a",
        volumeTitle: "起势",
        arcId: "arc_plot_main",
        arcTitle: "主线"
      }
    };
    const input = {
      runId: "run_plot_prompt",
      sessionId: "session_plot_prompt",
      prompt: "梳理这一卷的节奏",
      longAgentProfile: profile,
      workspaceContext: { longWorkspace }
    };

    const userPrompt = buildRuntimeUserPrompt(input);
    const systemPrompt = buildEffectiveSystemPrompt("DeepWrite base", input);
    expect(systemPrompt).toContain("propose_continuity_commit");
    expect(systemPrompt).toContain("book_line");
    expect(systemPrompt).toBe(profile.systemPrompt.trim());
    expect(systemPrompt).toContain(
      "The fixed context already contains the worldbuilding directory, character directory, and long-form structure navigation."
    );
    expect(systemPrompt).toContain(
      "Do not request, infer, or repeat implementation details"
    );
    expect(userPrompt).toContain(
      "全书共 2 卷、3 个剧情点、1 张章卡、2 条故事情节、0 个故事事件、1 条伏笔线"
    );
    expect(userPrompt).toContain(
      "连续性记录：1 章；最高连续记录位置为「第一章」(chapter_plot_one)"
    );
    expect(userPrompt).toContain("【list 范围规则】");
    expect(userPrompt).toContain("叶子不要 list，直接 read");
    expect(userPrompt).toContain(
      "查连续性：list（stage=continuity, scope_id=<volume_id|chapter_id|character_id>）"
    );
    expect(userPrompt).toContain("不要对 arc_ 使用 continuity");
    expect(userPrompt).toContain("记录只作参考，不锁定正文或结构");
    expect(userPrompt).toContain("【章卡目录（由早到晚；共 1 张）】");
    expect(userPrompt).toContain(
      "1. 「第一章」(chapter_plot_one)；分卷=第 1 卷「起势」(volume_plot_a)；卷内顺序=1；主剧情点=「主线」(arc_plot_main)；正文=已写"
    );
    expect(userPrompt).toContain(
      "- 第 1 卷「起势」(volume_plot_a): 「主线」(arc_plot_main)、「暗线」(arc_plot_hidden)"
    );
    expect(userPrompt).toContain(
      "- 第 2 卷「转折」(volume_plot_b): 「反击」(arc_plot_turn)"
    );
    expect(userPrompt).toContain(
      "当前剧情工作区: 剧情点「主线」(arc_plot_main)，所属分卷「起势」(volume_plot_a)"
    );
    expect(userPrompt).toContain("【世界观条目列表（发送时快照）】");
    expect(userPrompt).toContain(
      "世界规则（category_id=world_rules；类型=文本）"
    );
    expect(userPrompt).toContain(
      "守夜人（item_id=worlditem_watchers；顺序=1）"
    );
    expect(userPrompt).toContain("【人物设计列表（发送时快照）】");
    expect(userPrompt).toContain(
      "【长篇结构导航（发送时快照；条目正文与最新内容请通过工具读取）】"
    );
    expect(userPrompt).not.toContain("【当前阶段信息与要求】");
    expect(userPrompt.indexOf("【人物设计列表（发送时快照）】")).toBeLessThan(
      userPrompt.indexOf(
        "【长篇结构导航（发送时快照；条目正文与最新内容请通过工具读取）】"
      )
    );
    expect(userPrompt).toContain("主角（type_id=protagonist；共 1 人）");
    expect(userPrompt).toContain("林岚（id=character_lan；顺序=1）");
    expect(userPrompt).not.toContain("session_plot_prompt");
    expect(userPrompt).not.toContain("run_plot_prompt");
    expect(userPrompt).not.toContain("当前根节点:");
    expect(userPrompt).not.toContain("当前文件:");
    expect(userPrompt).not.toContain("file_long-book-line");
    expect(userPrompt).not.toContain("当前用户所处的世界观阶段");
    expect(userPrompt).not.toContain("当前用户所处的人物阶段");

    const chapterCardPrompt = buildRuntimeUserPrompt({
      ...input,
      workspaceContext: {
        longWorkspace: {
          ...longWorkspace,
          activeChapterCardId: "chapter_plot_one",
          plotFocus: {
            section: "chapter_card",
            volumeId: "volume_plot_a",
            volumeTitle: "起势",
            chapterCardId: "chapter_plot_one",
            chapterCardTitle: "第一章"
          }
        }
      }
    });
    expect(chapterCardPrompt).toContain(
      "当前剧情工作区: 章卡「第一章」(chapter_plot_one)，所属分卷「起势」(volume_plot_a)"
    );

    const bookLinePrompt = buildRuntimeUserPrompt({
      ...input,
      workspaceContext: {
        longWorkspace: {
          ...longWorkspace,
          plotFocus: { section: "book_line" }
        }
      }
    });
    expect(bookLinePrompt).toContain("当前剧情工作区: 全书故事线");
    expect(bookLinePrompt).not.toContain("当前文件:");
    expect(bookLinePrompt).not.toContain("file_long-book-line");

    const draftProfile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "long"
    )!;
    const draftPrompt = buildRuntimeUserPrompt({
      ...input,
      longAgentProfile: draftProfile,
      workspaceContext: {
        longWorkspace: {
          ...longWorkspace,
          activeRoot: "draft",
          activeAgentId: "long",
          plotFocus: undefined
        }
      }
    });
    expect(draftPrompt).toContain("【世界观条目列表（发送时快照）】");
    expect(draftPrompt).toContain("【人物设计列表（发送时快照）】");
    expect(draftPrompt).toContain(
      "【长篇结构导航（发送时快照；条目正文与最新内容请通过工具读取）】"
    );
    expect(draftPrompt).toContain(
      "世界规则（category_id=world_rules；类型=文本）"
    );
    expect(draftPrompt).toContain("林岚（id=character_lan；顺序=1）");
    expect(draftPrompt).not.toContain("当前剧情工作区");
    expect(draftPrompt).not.toContain("session_plot_prompt");
    expect(draftPrompt).not.toContain("run_plot_prompt");
    expect(draftPrompt).not.toContain("当前根节点:");
    expect(draftPrompt).not.toContain("当前文件:");

    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    const turnContexts: LongWorkspaceRuntimeContext[] = [
      {
        ...longWorkspace,
        plotFocus: { section: "book_line" }
      },
      {
        ...longWorkspace,
        navigation: {
          ...navigation,
          updatedAt: "2026-07-26T10:01:00.000Z"
        },
        plotFocus: {
          section: "plot_point",
          volumeId: "volume_plot_a",
          volumeTitle: "起势",
          arcId: "arc_plot_hidden",
          arcTitle: "暗线"
        }
      },
      {
        ...longWorkspace,
        activeChapterCardId: "chapter_plot_one",
        navigation: {
          ...navigation,
          updatedAt: "2026-07-26T10:02:00.000Z"
        },
        plotFocus: {
          section: "chapter_card",
          volumeId: "volume_plot_a",
          volumeTitle: "起势",
          chapterCardId: "chapter_plot_one",
          chapterCardTitle: "第一章"
        }
      }
    ];
    for (const [turnIndex, context] of turnContexts.entries()) {
      for await (const _event of runtime.start({
        runId: `run_plot_turn_${turnIndex}`,
        sessionId: "session_plot_turns",
        prompt: `剧情请求 ${turnIndex + 1}`,
        thinkingLevel: "off",
        longAgentProfile: profile,
        workspaceContext: { longWorkspace: context }
      })) {
        // Consume every turn before inspecting the cached model transcript.
      }
    }
    const cache = (
      runtime as unknown as {
        conversationAgents: Map<
          string,
          { state: { messages: Array<{ role?: string; content?: unknown }> } }
        >;
      }
    ).conversationAgents;
    const agent = cache.get(
      "session_plot_turns:long:long:longbook_plot_prompt"
    );
    const userMessages = agent?.state.messages.filter(
      (message) => message.role === "user"
    );
    expect(userMessages).toHaveLength(3);
    expect(String(userMessages?.[0]?.content)).toContain(
      "【本次智能体会话固定上下文】"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "当前剧情工作区: 全书故事线"
    );
    expect(String(userMessages?.[0]?.content)).not.toContain(
      "session_plot_turns"
    );
    expect(String(userMessages?.[0]?.content)).not.toContain("当前文件:");
    expect(String(userMessages?.[0]?.content)).not.toContain(
      "file_long-book-line"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "【世界观条目列表（发送时快照）】"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "【人物设计列表（发送时快照）】"
    );
    expect(String(userMessages?.[1]?.content)).toContain(
      "【本轮长篇工作区上下文】"
    );
    expect(String(userMessages?.[1]?.content)).toContain(
      "【长篇结构导航（本轮发送时快照；条目正文与最新内容请通过工具读取）】"
    );
    expect(String(userMessages?.[1]?.content)).toContain(
      "【长篇上下文（AGENTS.md）】"
    );
    expect(String(userMessages?.[1]?.content)).not.toContain(
      "【世界观条目列表"
    );
    expect(String(userMessages?.[1]?.content)).not.toContain("【人物设计列表");
    expect(String(userMessages?.[1]?.content)).toContain(
      "【世界观分类入口（本轮发送时快照）】"
    );
    expect(String(userMessages?.[1]?.content)).toContain(
      "【人物类型入口（本轮发送时快照）】"
    );
    expect(String(userMessages?.[1]?.content)).toContain("【list 范围规则】");
    expect(String(userMessages?.[1]?.content)).toContain(
      "连续性不要传 arc_ 或 book_line"
    );
    expect(String(userMessages?.[1]?.content)).toContain(
      "世界规则（category_id=world_rules；类型=文本）"
    );
    expect(String(userMessages?.[1]?.content)).toContain(
      "主角（type_id=protagonist；共 1 人）"
    );
    expect(String(userMessages?.[1]?.content)).toContain(
      "当前剧情工作区: 剧情点「暗线」(arc_plot_hidden)"
    );
    expect(String(userMessages?.[1]?.content)).not.toContain("当前文件:");
    expect(String(userMessages?.[1]?.content)).not.toContain(
      "file_long-book-line"
    );
    expect(String(userMessages?.[1]?.content)).not.toContain("当前根节点:");
    expect(String(userMessages?.[2]?.content)).toContain(
      "当前章卡: chapter_plot_one"
    );
    expect(String(userMessages?.[2]?.content)).toContain(
      "当前剧情工作区: 章卡「第一章」(chapter_plot_one)"
    );
    expect(String(userMessages?.[2]?.content)).not.toContain("当前文件:");
  });

  it("injects design directories for the chapter writer and refreshes plot navigation later", async () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "long"
    )!;
    const navigation = {
      schemaVersion: 1 as const,
      bookId: "longbook_draft_prompt",
      updatedAt: "2026-07-26T10:00:00.000Z",
      counts: {
        worldbuildingCategories: 1,
        characters: 1,
        volumes: 1,
        arcs: 1,
        chapterCards: 1,
        storyEvents: 0,
        storyPlots: 0,
        foreshadowingThreads: 0,
        committedChapters: 0
      },
      worldbuilding: [
        {
          id: "world_rules",
          title: "世界规则",
          order: 1,
          format: "text" as const
        }
      ],
      characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
      characters: [
        {
          id: "character_lan",
          name: "林岚",
          group: "protagonist",
          order: 1
        }
      ],
      volumes: [{ id: "volume_draft_a", title: "起势", order: 1 }],
      arcs: [
        {
          id: "arc_draft_main",
          volumeId: "volume_draft_a",
          title: "主线",
          order: 1
        }
      ],
      chapterCards: [
        {
          id: "chapter_draft_one",
          volumeId: "volume_draft_a",
          primaryArcId: "arc_draft_main",
          title: "第一章",
          narrativeOrder: 1,
          bodyStatus: "empty" as const
        }
      ],
      committedThroughChapterId: null
    };
    const longWorkspace: LongWorkspaceRuntimeContext = {
      bookId: "longbook_draft_prompt",
      title: "雾港长篇",
      activeRoot: "draft",
      activeAgentId: profile.id,
      activeChapterCardId: "chapter_draft_one",
      agentsMd: "# 长篇上下文\n\n## 正文阶段\n按章写作。",
      worldbuildingDirectory: {
        categories: [
          {
            categoryId: "world_rules",
            title: "世界规则",
            order: 1,
            format: "text"
          }
        ],
        omittedCategoryCount: 0
      },
      navigation
    };
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    for (const [turnIndex, context] of [
      longWorkspace,
      {
        ...longWorkspace,
        navigation: {
          ...navigation,
          updatedAt: "2026-07-26T10:01:00.000Z"
        }
      }
    ].entries()) {
      for await (const _event of runtime.start({
        runId: `run_draft_turn_${turnIndex}`,
        sessionId: "session_draft_turns",
        prompt: `写手请求 ${turnIndex + 1}`,
        thinkingLevel: "off",
        longAgentProfile: profile,
        workspaceContext: { longWorkspace: context }
      })) {
        // Consume every turn before inspecting the cached model transcript.
      }
    }
    const cache = (
      runtime as unknown as {
        conversationAgents: Map<
          string,
          { state: { messages: Array<{ role?: string; content?: unknown }> } }
        >;
      }
    ).conversationAgents;
    const agent = cache.get(
      "session_draft_turns:long:long:longbook_draft_prompt"
    );
    const userMessages = agent?.state.messages.filter(
      (message) => message.role === "user"
    );
    expect(userMessages).toHaveLength(2);
    expect(String(userMessages?.[0]?.content)).toContain(
      "【本次智能体会话固定上下文】"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "【世界观条目列表（发送时快照）】"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "【人物设计列表（发送时快照）】"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "【长篇结构导航（发送时快照；条目正文与最新内容请通过工具读取）】"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "正文进度：已写 0 章，空白 1 章。"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "【章卡目录（由早到晚；共 1 张）】"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "1. 「第一章」(chapter_draft_one)；分卷=第 1 卷「起势」(volume_draft_a)；卷内顺序=1；主剧情点=「主线」(arc_draft_main)；正文=空白；当前章=是"
    );
    expect(String(userMessages?.[1]?.content)).toContain(
      "【本轮长篇工作区上下文】"
    );
    expect(String(userMessages?.[1]?.content)).toContain(
      "【长篇结构导航（本轮发送时快照；条目正文与最新内容请通过工具读取）】"
    );
    expect(String(userMessages?.[1]?.content)).toContain(
      "当前章卡: chapter_draft_one"
    );
    expect(String(userMessages?.[1]?.content)).toContain(
      "1. 「第一章」(chapter_draft_one)；分卷=第 1 卷「起势」(volume_draft_a)；卷内顺序=1；主剧情点=「主线」(arc_draft_main)；正文=空白；当前章=是"
    );
    expect(String(userMessages?.[1]?.content)).not.toContain(
      "【世界观条目列表"
    );
    expect(String(userMessages?.[1]?.content)).not.toContain("【人物设计列表");
    expect(String(userMessages?.[1]?.content)).toContain(
      "【世界观分类入口（本轮发送时快照）】"
    );
    expect(String(userMessages?.[1]?.content)).toContain(
      "【人物类型入口（本轮发送时快照）】"
    );
    expect(String(userMessages?.[1]?.content)).toContain("【list 范围规则】");
    expect(String(userMessages?.[1]?.content)).not.toContain("当前剧情工作区");
  });
});
