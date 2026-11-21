import {
  getDefaultLongAgentProfile,
  type CatalogIndexSnapshot,
  type CatalogSnapshot,
  type LongBookSummary,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceRuntimeContext
} from "@deepwrite/contracts";
import { computed, nextTick, ref, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { AgentConversationController } from "./useAgentConversation";
import {
  useLongConversationCoordinator,
  type LongConversationCoordinatorOptions
} from "./useLongConversationCoordinator";
import type {
  LongWorkspaceRendererApi,
  LongWorkspaceSelection
} from "../types/longWorkspace";
import { createLongChapterSelection } from "../types/longWorkspace";
import { fixture } from "../types/longWorkspace.test-support";
import type { ChatMessage } from "../types/conversation";
import type { LibraryAttachmentBuildResult } from "../utils/libraryAttachments";

const BOOK_ID = "long-book-one";
const NOW = "2026-08-14T00:00:00.000Z";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function bookSummary(): LongBookSummary {
  return {
    id: BOOK_ID,
    title: "长篇测试书",
    updatedAt: NOW,
    linkedMaterialIdsByKind: {
      character: [],
      gimmick: [],
      plot: [],
      draft: [],
      other: []
    },
    linkedSkillIdsByKind: {
      general: [],
      plot: [],
      style: [],
      other: []
    },
    navigation: {
      schemaVersion: 1,
      bookId: BOOK_ID,
      updatedAt: NOW,
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
  } as unknown as LongBookSummary;
}

function selection(key = "plot-design:book-line"): LongWorkspaceSelection {
  return {
    key,
    root: "plot_design",
    title: "全书故事线",
    breadcrumbs: ["长篇测试书", "剧情设计"],
    files: [],
    preferredRole: "body"
  };
}

function runtimeContext(summary: LongBookSummary): LongWorkspaceRuntimeContext {
  return {
    bookId: summary.id,
    title: summary.title,
    activeRoot: "plot_design",
    activeAgentId: "long",
    navigation: summary.navigation
  };
}

function attachmentResult(): LibraryAttachmentBuildResult {
  return {
    bookId: BOOK_ID,
    attachedSkills: [],
    attachedMaterials: [],
    diagnostics: [],
    omittedAttachments: [],
    complete: true
  };
}

function controllerFixture() {
  const sessionId = ref("session-one");
  const draft = ref("继续设计剧情");
  const isBusy = ref(false);
  const canRewriteHistory = ref(true);
  const messages = ref<ChatMessage[]>([
    {
      id: "user-long-history",
      role: "user",
      content: "长篇历史问题",
      createdAt: "2026-08-25T08:00:00.000Z",
      status: "completed"
    }
  ]);
  const conversationError = ref<string | null>(null);
  const selectedModelId = ref("model-one");
  const thinkingLevel = ref<"off" | "low" | "medium" | "high">("medium");
  const webSearchEnabled = ref(false);
  const temperature = ref(0.7);
  const approvalMode = ref<"request-approval" | "auto-approve">(
    "request-approval"
  );
  const sendLongMessage = vi.fn(
    async (_context?: LongWorkspaceRuntimeContext) => {
      draft.value = "";
    }
  );
  const resendLongMessage = vi.fn(async (request: { messageId: string }) => {
    const index = messages.value.findIndex(
      (message) => message.id === request.messageId
    );
    if (index < 0) return false;
    messages.value.splice(index);
    return true;
  });
  const newConversation = vi.fn(() => {
    sessionId.value = "session-new";
    draft.value = "";
  });
  const selectConversation = vi.fn((nextSessionId: string) => {
    if (isBusy.value) return false;
    sessionId.value = nextSessionId;
    return true;
  });
  const selectModel = vi.fn((modelId: string) => {
    selectedModelId.value = modelId;
  });
  const selectThinkingLevel = vi.fn(
    (level: "off" | "low" | "medium" | "high") => {
      thinkingLevel.value = level;
    }
  );
  const selectWebSearchEnabled = vi.fn((enabled: boolean) => {
    webSearchEnabled.value = enabled;
  });
  const selectTemperature = vi.fn((value: number) => {
    temperature.value = value;
  });
  const selectApprovalMode = vi.fn(
    (mode: "request-approval" | "auto-approve") => {
      approvalMode.value = mode;
    }
  );
  const stopGeneration = vi.fn(async () => {
    isBusy.value = false;
    return true;
  });
  const controller = {
    sessionId,
    draft,
    messages,
    isBusy,
    canRewriteHistory,
    conversationError,
    selectedModelId,
    thinkingLevel,
    webSearchEnabled,
    temperature,
    approvalMode,
    sendLongMessage,
    resendLongMessage,
    newConversation,
    selectConversation,
    useSuggestion: vi.fn((value: string) => {
      draft.value = value;
    }),
    selectModel,
    selectThinkingLevel,
    selectWebSearchEnabled,
    selectTemperature,
    selectApprovalMode,
    stopGeneration,
    followUps: {
      dispatching: computed(() => false),
      setDispatcher: vi.fn()
    }
  } as unknown as AgentConversationController;
  return {
    controller,
    draft,
    canRewriteHistory,
    isBusy,
    newConversation,
    messages,
    resendLongMessage,
    selectApprovalMode,
    selectConversation,
    selectModel,
    selectTemperature,
    selectThinkingLevel,
    selectWebSearchEnabled,
    selectedModelId,
    sendLongMessage,
    sessionId,
    stopGeneration
  };
}

function selectChapterFile(
  test: ReturnType<typeof createHarness>,
  role: "card" | "body"
) {
  const { summary, workspaceIndex } = fixture(null);
  test.activeSelection.value = createLongChapterSelection(
    summary,
    workspaceIndex,
    "chapter_one"
  )!;
  const file = workspaceIndex.chapters[0]![role];
  test.fileContext.value = { bookId: BOOK_ID, fileId: file.id };
  test.context.value = {
    ...test.context.value!,
    activeRoot: role === "card" ? "plot_design" : "draft",
    activeFileId: file.id,
    activeChapterCardId: "chapter_one",
    navigation: summary.navigation
  };
  return file.id;
}

function createHarness() {
  const summary = shallowRef<LongBookSummary | null>(bookSummary());
  const activeSelection = shallowRef<LongWorkspaceSelection | null>(
    selection()
  );
  const profile = shallowRef(getDefaultLongAgentProfile("long"));
  const context = shallowRef<LongWorkspaceRuntimeContext | null>(
    runtimeContext(summary.value!)
  );
  const conversation = controllerFixture();
  const sendPreflightPending = ref(false);
  const ensureAgentSettingsLoaded = vi.fn(async () => true);
  const saveActiveEditorChanges = vi.fn(async () => true);
  const refreshActiveWorkspace = vi.fn(async () => true);
  const foreshadowingFocus = ref({
    threadId: null as string | null,
    beatId: null as string | null
  });
  const documentsForProfile = vi.fn(() => []);
  const ensureDocumentsLoaded = vi.fn(async () => true);
  const hydratedSnapshot = vi.fn(() => null as CatalogSnapshot | null);
  const buildAttachments = vi.fn(() => attachmentResult());
  const filterReadableAttachments = vi.fn(() => ({
    attachedSkills: [],
    attachedMaterials: []
  }));
  const notifications = {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn()
  };
  const showConversation = vi.fn();
  const stopGeneration = vi.fn(async () => undefined);
  const synchronizeSessionModelSelection = vi.fn();
  const synchronizeRunPreferences = vi.fn();
  const updatePermissionMode = vi.fn();
  const indexSnapshot = shallowRef<CatalogIndexSnapshot | null>(null);
  const fileContext = shallowRef<{ bookId: string; fileId: string } | null>(
    null
  );
  const workspaceIndex = shallowRef({
    plot: { foreshadowing: [] }
  } as unknown as LongWorkspaceIndexSnapshot);
  const options: LongConversationCoordinatorOptions = {
    state: {
      activeBookId: ref(BOOK_ID),
      activeBookSummary: summary,
      workspaceIndex,
      selection: activeSelection,
      fileContext,
      activeRoot: computed(() => {
        const selection = activeSelection.value;
        return selection?.files.some(
          ({ role, file }) =>
            role === "card" && file.id === fileContext.value?.fileId
        )
          ? "plot_design"
          : (selection?.root ?? "worldbuilding");
      }),
      activeAgentProfile: profile,
      activeRuntimeContext: context,
      sendPreflightPending,
      agentLoadError: ref(null)
    },
    runtime: {
      conversationKey: vi.fn((bookId, root, chapterCardId) =>
        [bookId, root, chapterCardId ?? "none"].join(":")
      ),
      conversationForKey: vi.fn(() => conversation.controller),
      synchronizeSessionModelSelection,
      synchronizeRunPreferences
    },
    workspace: {
      ensureAgentSettingsLoaded,
      saveActiveEditorChanges,
      refreshActiveWorkspace,
      captureForeshadowingFocus: vi.fn(() => foreshadowingFocus.value),
      api: vi.fn(() => undefined)
    },
    catalog: {
      indexSnapshot,
      documentsForProfile,
      ensureDocumentsLoaded,
      hydratedSnapshot,
      buildAttachments,
      filterReadableAttachments
    },
    settings: {
      permissionMode: vi.fn(() => "request-approval" as const),
      updatePermissionMode
    },
    commands: { stopGeneration },
    showConversation,
    notifications
  };
  const coordinator = useLongConversationCoordinator(options);
  return {
    activeSelection,
    buildAttachments,
    context,
    conversation,
    coordinator,
    documentsForProfile,
    ensureAgentSettingsLoaded,
    ensureDocumentsLoaded,
    filterReadableAttachments,
    fileContext,
    foreshadowingFocus,
    hydratedSnapshot,
    indexSnapshot,
    notifications,
    options,
    profile,
    refreshActiveWorkspace,
    saveActiveEditorChanges,
    sendPreflightPending,
    showConversation,
    stopGeneration,
    summary,
    synchronizeSessionModelSelection,
    synchronizeRunPreferences,
    updatePermissionMode,
    workspaceIndex
  };
}

async function waitForCall(mock: ReturnType<typeof vi.fn>): Promise<void> {
  await vi.waitFor(() => expect(mock).toHaveBeenCalled());
}

describe("useLongConversationCoordinator", () => {
  it.each(["worldbuilding", "character_design"] as const)(
    "sends a %s focus even when document reads are unavailable",
    async (root) => {
      const test = createHarness();
      const file = {
        id: "file_focus",
        path: "long/test/focus.md",
        updatedAt: NOW
      };
      test.activeSelection.value =
        root === "worldbuilding"
          ? {
              key: "worldbuilding:world_rules",
              root,
              title: "世界规则",
              breadcrumbs: ["合成书", "世界观"],
              worldbuildingFormat: "text",
              files: [{ role: "content", label: "设定", file }],
              preferredRole: "content"
            }
          : {
              key: "character-group:protagonist",
              root,
              title: "林岚",
              breadcrumbs: ["合成书", "人物"],
              characterId: "character_lan",
              characterGroup: "protagonist",
              files: [{ role: "relationships", label: "人物关系", file }],
              preferredRole: "relationships"
            };
      test.context.value = {
        ...test.context.value!,
        activeRoot: root,
        activeFileId: file.id
      };
      test.fileContext.value = { bookId: BOOK_ID, fileId: file.id };
      const readDocument = vi.fn(async () => {
        throw new Error("Synthetic document read failure");
      });
      vi.mocked(test.options.workspace.api).mockReturnValue({
        readDocument,
        readAgentsMd: async () => ({
          bookId: BOOK_ID,
          content: "",
          truncated: false
        })
      } as unknown as LongWorkspaceRendererApi);
      await test.coordinator.sendLongMessage();
      expect(readDocument).not.toHaveBeenCalled();
      expect(test.conversation.sendLongMessage).toHaveBeenCalledOnce();
      const sent = test.conversation.sendLongMessage.mock.calls[0]![0]!;
      expect(
        root === "worldbuilding" ? sent.worldbuildingFocus : sent.characterFocus
      ).toEqual(
        root === "worldbuilding"
          ? {
              categoryId: "world_rules",
              categoryTitle: "世界规则",
              format: "text",
              currentStage: { kind: "text", title: "世界规则" }
            }
          : {
              characterId: "character_lan",
              characterName: "林岚",
              group: "protagonist",
              currentDocument: { kind: "relationships", title: "人物关系" }
            }
      );
      expect(test.notifications.warning).not.toHaveBeenCalled();
      expect(test.notifications.error).not.toHaveBeenCalled();
      await test.coordinator.dispose();
    }
  );

  it("builds UI references from metadata and full attachments only on send", async () => {
    const test = createHarness();
    test.summary.value = {
      ...test.summary.value!,
      linkedResourceStageScopes: {
        materials: { "material-library": ["draft"] },
        skills: { "skill-library": ["draft"] }
      },
      linkedMaterialIdsByKind: {
        ...test.summary.value!.linkedMaterialIdsByKind,
        character: ["material-library"]
      },
      linkedSkillIdsByKind: {
        ...test.summary.value!.linkedSkillIdsByKind,
        plot: ["skill-library"]
      }
    };
    test.context.value = runtimeContext(test.summary.value);
    test.indexSnapshot.value = {
      skills: [
        {
          id: "skill-library",
          title: "剧情方法",
          skillKind: "plot",
          entries: [
            {
              id: "skill-entry",
              title: "冲突升级",
              body: "",
              contentBytes: 18
            }
          ]
        }
      ],
      materials: [
        {
          id: "material-library",
          title: "人物素材",
          entries: [
            {
              id: "material-entry",
              title: "主角档案",
              stageId: "character",
              body: "",
              contentBytes: 24
            }
          ]
        }
      ]
    } as unknown as CatalogIndexSnapshot;

    expect(test.coordinator.availableSkillReferences.value).toEqual([
      {
        id: "skill:skill-library:skill-entry",
        label: "剧情方法 · 冲突升级",
        detail: "剧情设计技能库 · 当前长篇已绑定"
      }
    ]);
    expect(test.coordinator.availableMaterialReferences.value).toEqual([
      {
        id: "material:material-library:material-entry",
        label: "人物素材 · 主角档案",
        detail: "人设素材库 · 当前长篇已绑定"
      }
    ]);
    expect(test.hydratedSnapshot).not.toHaveBeenCalled();
    expect(test.buildAttachments).not.toHaveBeenCalled();

    test.hydratedSnapshot.mockReturnValue({} as CatalogSnapshot);
    await test.coordinator.sendLongMessage();

    expect(test.documentsForProfile).toHaveBeenCalledOnce();
    expect(test.ensureDocumentsLoaded).toHaveBeenCalledOnce();
    expect(test.hydratedSnapshot).toHaveBeenCalledOnce();
    expect(test.buildAttachments).toHaveBeenCalledOnce();
    expect(test.filterReadableAttachments).toHaveBeenCalledOnce();
    expect(test.conversation.sendLongMessage).toHaveBeenCalledOnce();
  });

  it("injects AGENTS.md into the long runtime context before sending", async () => {
    const test = createHarness();
    const readAgentsMd = vi.fn(async () => ({
      bookId: BOOK_ID,
      content: "# 长篇上下文\n\n## 正文阶段\n写当前章。",
      truncated: false
    }));
    test.options.workspace.api = vi.fn(
      () =>
        ({
          readAgentsMd
        }) as unknown as LongWorkspaceRendererApi
    );

    await test.coordinator.sendLongMessage();

    expect(readAgentsMd).toHaveBeenCalledWith({ bookId: BOOK_ID });
    expect(test.conversation.sendLongMessage).toHaveBeenCalledOnce();
    const [context] = test.conversation.sendLongMessage.mock.calls[0]!;
    expect(context).toMatchObject({
      bookId: BOOK_ID,
      agentsMd: "# 长篇上下文\n\n## 正文阶段\n写当前章。"
    });
  });

  it("still sends when AGENTS.md cannot be read and warns that it was not injected", async () => {
    const test = createHarness();
    const readAgentsMd = vi.fn(async () => {
      throw new Error("工作区未就绪");
    });
    test.options.workspace.api = vi.fn(
      () =>
        ({
          readAgentsMd
        }) as unknown as LongWorkspaceRendererApi
    );

    await test.coordinator.sendLongMessage();

    expect(readAgentsMd).toHaveBeenCalledWith({ bookId: BOOK_ID });
    expect(test.notifications.warning).toHaveBeenCalledWith(
      "长篇上下文未注入：工作区未就绪"
    );
    expect(test.conversation.sendLongMessage).toHaveBeenCalledOnce();
    const [context] = test.conversation.sendLongMessage.mock.calls[0]!;
    expect(context).toMatchObject({ bookId: BOOK_ID });
    expect(context).not.toHaveProperty("agentsMd");
  });

  it("injects the latest foreshadowing directory and focused beat", async () => {
    const test = createHarness();
    test.activeSelection.value = selection("plot-design:foreshadowing");
    test.foreshadowingFocus.value = {
      threadId: "foreshadow_watch",
      beatId: "beat_watch"
    };
    test.workspaceIndex.value = {
      plot: {
        foreshadowing: [
          {
            id: "foreshadow_watch",
            title: "失踪的航海日志",
            coreQuestion: "日志为何缺页？",
            hiddenTruth: "船长主动撕毁了日志。",
            plannedSpan: "cross_volume",
            truthEventId: null,
            expectedReaderEffect: "持续怀疑船长",
            status: "open",
            beats: [
              {
                id: "beat_watch",
                type: "plant",
                order: 1,
                eventId: null,
                placementId: null,
                chapterCardId: null,
                plannedScope: "第一卷中段",
                note: "只露出被撕过的页脚",
                status: "planned",
                commitId: null
              }
            ]
          }
        ]
      }
    } as unknown as LongWorkspaceIndexSnapshot;

    await test.coordinator.sendLongMessage();

    const sentContext = test.conversation.sendLongMessage.mock.calls[0]![0]!;
    expect(sentContext.plotFocus).toEqual({
      section: "foreshadowing",
      foreshadowingDirectory: {
        totalCount: 1,
        omittedCount: 0,
        entries: [
          {
            foreshadowingId: "foreshadow_watch",
            title: "失踪的航海日志",
            status: "open",
            plannedSpan: "cross_volume",
            beatCount: 1
          }
        ]
      },
      foreshadowingThreadId: "foreshadow_watch",
      foreshadowingBeatId: "beat_watch"
    });
    expect(JSON.stringify(sentContext.plotFocus)).not.toContain("船长主动");
    expect(JSON.stringify(sentContext.plotFocus)).not.toContain("被撕过");
  });

  it("rejects a second send while the first preflight is pending", async () => {
    const gate = deferred<boolean>();
    const test = createHarness();
    test.ensureAgentSettingsLoaded.mockImplementation(() => gate.promise);

    const first = test.coordinator.sendLongMessage();
    await test.coordinator.sendLongMessage();

    expect(test.notifications.info).toHaveBeenCalledWith(
      "正在准备上一条长篇消息，请稍候。"
    );
    await waitForCall(test.ensureAgentSettingsLoaded);
    expect(test.ensureAgentSettingsLoaded).toHaveBeenCalledOnce();
    gate.resolve(true);
    await first;
    expect(test.conversation.sendLongMessage).toHaveBeenCalledOnce();
  });

  it("saves and refreshes the long workspace before resending edited history", async () => {
    const test = createHarness();
    test.conversation.draft.value = "保留长篇主输入草稿";

    const result = await test.coordinator.resendLongMessage({
      messageId: "user-long-history",
      content: "修改后的长篇问题"
    });

    expect(result).toBe(true);
    expect(test.ensureAgentSettingsLoaded).toHaveBeenCalledOnce();
    expect(test.saveActiveEditorChanges).toHaveBeenCalledOnce();
    expect(test.refreshActiveWorkspace).toHaveBeenCalledWith(BOOK_ID);
    expect(test.ensureDocumentsLoaded).toHaveBeenCalledOnce();
    expect(test.conversation.resendLongMessage).toHaveBeenCalledWith(
      {
        messageId: "user-long-history",
        content: "修改后的长篇问题"
      },
      expect.objectContaining({
        bookId: BOOK_ID
      }),
      { attachedSkills: [], attachedMaterials: [] }
    );
    expect(test.conversation.sendLongMessage).not.toHaveBeenCalled();
    expect(test.conversation.draft.value).toBe("保留长篇主输入草稿");
  });

  it("keeps long history when preflight fails", async () => {
    const saveFailure = createHarness();
    saveFailure.saveActiveEditorChanges.mockResolvedValue(false);
    await expect(
      saveFailure.coordinator.resendLongMessage({
        messageId: "user-long-history",
        content: "保存失败时不要截断"
      })
    ).resolves.toBe(false);
    expect(
      saveFailure.conversation.messages.value.map((message) => message.id)
    ).toContain("user-long-history");
    expect(saveFailure.conversation.resendLongMessage).not.toHaveBeenCalled();
  });

  it("protects conversation and model commands during preflight", async () => {
    const gate = deferred<boolean>();
    const test = createHarness();
    test.ensureAgentSettingsLoaded.mockImplementation(() => gate.promise);
    const sending = test.coordinator.sendLongMessage();

    test.coordinator.newConversation();
    test.coordinator.selectConversation("session-two");
    test.coordinator.selectModel("model-two");
    test.coordinator.selectThinking("high");
    test.coordinator.selectWebSearch(true);
    test.coordinator.selectTemperature(0.2);
    test.coordinator.selectApprovalMode("auto-approve");

    expect(test.conversation.newConversation).not.toHaveBeenCalled();
    expect(test.conversation.selectConversation).not.toHaveBeenCalled();
    expect(test.conversation.selectModel).not.toHaveBeenCalled();
    expect(test.conversation.selectThinkingLevel).not.toHaveBeenCalled();
    expect(test.conversation.selectWebSearchEnabled).not.toHaveBeenCalled();
    expect(test.conversation.selectTemperature).not.toHaveBeenCalled();
    expect(test.conversation.selectApprovalMode).not.toHaveBeenCalled();
    expect(test.updatePermissionMode).not.toHaveBeenCalled();
    expect(test.showConversation).not.toHaveBeenCalled();

    gate.resolve(true);
    await sending;
  });

  it("blocks a new conversation while the controller is busy", () => {
    const test = createHarness();
    test.conversation.isBusy.value = true;

    test.coordinator.newConversation();

    expect(test.conversation.newConversation).not.toHaveBeenCalled();
    expect(test.notifications.warning).toHaveBeenCalledWith(
      "请先停止当前长篇回复，再新建对话。"
    );
    expect(test.showConversation).not.toHaveBeenCalled();
  });

  it.each(["card", "body"] as const)(
    "sends a chapter's loaded %s with its own stage",
    async (role) => {
      const test = createHarness();
      const fileId = selectChapterFile(test, role);
      await test.coordinator.sendLongMessage();
      expect(test.conversation.sendLongMessage).toHaveBeenCalledOnce();
      const [context] = test.conversation.sendLongMessage.mock.calls[0]!;
      expect(context).toMatchObject({
        activeRoot: role === "card" ? "plot_design" : "draft",
        activeChapterCardId: "chapter_one",
        activeFileId: fileId
      });
      expect(context?.plotFocus).toEqual(
        role === "card"
          ? {
              section: "chapter_card",
              volumeId: "volume_one",
              volumeTitle: "第一卷",
              chapterCardId: "chapter_one",
              chapterCardTitle: "第一章"
            }
          : undefined
      );
    }
  );

  it("rejects a pending chapter tab change and cancels the old preflight", async () => {
    const test = createHarness();
    const save = deferred<boolean>();
    selectChapterFile(test, "card");
    test.saveActiveEditorChanges.mockReturnValueOnce(save.promise);
    const sending = test.coordinator.sendLongMessage();
    await waitForCall(test.saveActiveEditorChanges);
    test.fileContext.value = null;
    test.context.value = null;
    await nextTick();
    selectChapterFile(test, "body");
    save.resolve(true);
    await sending;
    expect(test.conversation.sendLongMessage).not.toHaveBeenCalled();
    test.fileContext.value = null;
    test.context.value = null;
    await test.coordinator.sendLongMessage();
    expect(test.conversation.sendLongMessage).not.toHaveBeenCalled();
  });

  it("cancels after an awaited save when the semantic selection changes", async () => {
    const gate = deferred<boolean>();
    const test = createHarness();
    test.saveActiveEditorChanges.mockImplementation(() => gate.promise);
    const sending = test.coordinator.sendLongMessage();
    await waitForCall(test.saveActiveEditorChanges);

    test.activeSelection.value = selection("plot-design:book-line:other");
    gate.resolve(true);
    await sending;

    expect(test.refreshActiveWorkspace).not.toHaveBeenCalled();
    expect(test.conversation.sendLongMessage).not.toHaveBeenCalled();
    expect(test.notifications.info).toHaveBeenCalledWith(
      "长篇上下文、会话、模型设置或输入内容已切换，本次发送已取消。"
    );
  });

  it("cancels after an awaited save when the foreshadowing focus changes", async () => {
    const gate = deferred<boolean>();
    const test = createHarness();
    test.activeSelection.value = selection("plot-design:foreshadowing");
    test.foreshadowingFocus.value = {
      threadId: "foreshadow_first",
      beatId: "beat_first"
    };
    test.saveActiveEditorChanges.mockImplementation(() => gate.promise);
    const sending = test.coordinator.sendLongMessage();
    await waitForCall(test.saveActiveEditorChanges);

    test.foreshadowingFocus.value = {
      threadId: "foreshadow_second",
      beatId: "beat_second"
    };
    gate.resolve(true);
    await sending;

    expect(test.refreshActiveWorkspace).not.toHaveBeenCalled();
    expect(test.conversation.sendLongMessage).not.toHaveBeenCalled();
    expect(test.notifications.info).toHaveBeenCalledWith(
      "长篇上下文、会话、模型设置或输入内容已切换，本次发送已取消。"
    );
  });

  it("cancels after Catalog loading when the captured model changes", async () => {
    const gate = deferred<boolean>();
    const test = createHarness();
    test.ensureDocumentsLoaded.mockImplementation(() => gate.promise);
    const sending = test.coordinator.sendLongMessage();
    await waitForCall(test.ensureDocumentsLoaded);

    test.conversation.selectedModelId.value = "model-two";
    gate.resolve(true);
    await sending;

    expect(test.hydratedSnapshot).not.toHaveBeenCalled();
    expect(test.conversation.sendLongMessage).not.toHaveBeenCalled();
  });

  it("disposal invalidates and drains an active preflight silently", async () => {
    const gate = deferred<boolean>();
    const test = createHarness();
    test.ensureAgentSettingsLoaded.mockImplementation(() => gate.promise);
    const sending = test.coordinator.sendLongMessage();
    await nextTick();
    const disposing = test.coordinator.dispose();

    gate.resolve(true);
    await Promise.all([sending, disposing]);

    expect(test.conversation.sendLongMessage).not.toHaveBeenCalled();
    expect(test.sendPreflightPending.value).toBe(false);
    expect(test.notifications.info).not.toHaveBeenCalledWith(
      "长篇上下文、会话、模型设置或输入内容已切换，本次发送已取消。"
    );
  });

  it("stops a busy active controller before draining disposal", async () => {
    const gate = deferred<void>();
    const test = createHarness();
    test.conversation.sendLongMessage.mockImplementation(async () => {
      test.conversation.isBusy.value = true;
      await gate.promise;
      test.conversation.isBusy.value = false;
    });
    test.conversation.stopGeneration.mockImplementation(async () => {
      test.conversation.isBusy.value = false;
      gate.resolve();
      return true;
    });

    const sending = test.coordinator.sendLongMessage();
    await waitForCall(test.conversation.sendLongMessage);
    await test.coordinator.dispose();
    await sending;

    expect(test.conversation.stopGeneration).toHaveBeenCalledOnce();
    expect(test.sendPreflightPending.value).toBe(false);
  });

  it("delegates stop generation through its command port", async () => {
    const test = createHarness();

    await test.coordinator.stopGeneration();

    expect(test.stopGeneration).toHaveBeenCalledOnce();
  });
});
