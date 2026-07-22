import { afterEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import {
  DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
  SHORT_WORKSPACE_STAGE_IDS,
  SHORT_WORKSPACE_TEXT_STAGE_IDS,
  createShortWorkspaceContentRevision,
  createEnvelope,
  type DeepWriteApi,
  type ModelSettings,
  type SessionAbortCommandPayload,
  type SessionPromptAcceptedPayload,
  type SessionPromptCommandPayload,
  type ShortWorkspaceStageId
} from "@deepwrite/contracts";
import { useAgentConversation } from "./useAgentConversation";
import type { AgentEditProposal } from "../types/conversation";
import type { WorkspaceDocument } from "../types/workspace";

const document: WorkspaceDocument = {
  id: "chapter_3",
  domain: "creation",
  title: "第三章 雨夜回声",
  eyebrow: "长篇正文",
  path: ["雾港来信", "第三章 雨夜回声"],
  format: "正文",
  content: "雨是在午夜以后落下来的。"
};

const runtime = {
  provider: "deepwrite",
  model: "deepwrite-writing-faux",
  mode: "local-faux" as const
};

const shortStageTitles: Record<ShortWorkspaceStageId, string> = {
  character_design: "人物",
  plot_design: "剧情设计",
  intro_design: "导语设计",
  plot_refine: "剧情细化",
  outline: "大纲",
  draft: "正文"
};

function createShortWorkspaceDocuments(): WorkspaceDocument[] {
  const stages: WorkspaceDocument[] = SHORT_WORKSPACE_TEXT_STAGE_IDS.map((stageId) => ({
    id: `short_${stageId}`,
    domain: "creation",
    title: shortStageTitles[stageId],
    eyebrow: "短篇创作",
    path: ["雨夜来信", shortStageTitles[stageId]],
    format: "设定" as const,
    content: `${stageId} 的实时内容`,
    workspaceId: "short_story_1",
    workspaceType: "short",
    workspaceTitle: "雨夜来信",
    workspaceCategories: ["都市", "悬疑"],
    stageId
  }));
  const draftFiles: WorkspaceDocument[] = ["intro", "section-1"].flatMap(
    (sectionId, index) => {
      const title = index === 0 ? "导语" : "第一节";
      const common = {
        domain: "creation" as const,
        eyebrow: "短篇创作",
        workspaceId: "short_story_1",
        workspaceType: "short" as const,
        workspaceTitle: "雨夜来信",
        workspaceCategories: ["都市", "悬疑"],
        stageId: "draft" as const,
        shortAgentId: "expert_section_writer" as const,
        expertSectionId: sectionId,
        expertSectionOrder: index,
        expertWordCountRequirement: index === 0 ? "300 字" : "1200 字",
        draftDirectoryId: "draft"
      };
      return [
        {
          ...common,
          id: `short_draft_${sectionId}_body`,
          title,
          path: ["雨夜来信", "正文", title, "正文"],
          format: "正文" as const,
          content: index === 0 ? "" : "draft 的实时内容",
          draftFileKind: "body" as const
        },
        {
          ...common,
          id: `short_draft_${sectionId}_state`,
          title: `${title} · 人物状态`,
          path: ["雨夜来信", "正文", title, "人物状态"],
          format: "账本" as const,
          content: index === 0 ? "" : "第一节人物状态",
          draftFileKind: "character-state" as const
        }
      ];
    }
  );
  return [...stages, ...draftFiles];
}

function createDraftCoordinatorDocument(
  workspaceDocuments: WorkspaceDocument[]
): WorkspaceDocument {
  const source = workspaceDocuments.find(
    (candidate) => candidate.draftFileKind === "body"
  );
  if (!source) throw new Error("Missing draft body document.");
  const {
    catalogDocumentId: _catalogDocumentId,
    draftFileKind: _draftFileKind,
    expertSectionId: _expertSectionId,
    expertSectionOrder: _expertSectionOrder,
    expertWordCountRequirement: _expertWordCountRequirement,
    ...coordinator
  } = source;
  return {
    ...coordinator,
    id: "draft",
    title: "正文",
    path: ["雨夜来信", "正文"],
    content: "",
    shortAgentId: "expert_draft_coordinator"
  };
}

function createDeferredApi(): {
  api: DeepWriteApi;
  prompts: SessionPromptCommandPayload[];
  aborts: SessionAbortCommandPayload[];
  resolveAccepted(index: number, payload: SessionPromptAcceptedPayload): void;
  rejectPrompt(index: number, error: Error): void;
  promptCount(): number;
} {
  const pending: Array<{
    resolve(payload: SessionPromptAcceptedPayload): void;
    reject(error: Error): void;
  }> = [];
  const prompts: SessionPromptCommandPayload[] = [];
  const aborts: SessionAbortCommandPayload[] = [];
  const api: DeepWriteApi = {
    system: {
      async health() {
        return { status: "ok", checkedAt: new Date().toISOString(), workers: [] };
      }
    },
    catalog: {
      loadDraftRecovery: vi.fn(async () => ({})),
      saveDraftRecovery: vi.fn(async () => undefined),
      snapshot: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      openProject: vi.fn(async () => null),
      importLegacyBook: vi.fn(async () => null),
      importLegacyLibrary: vi.fn(async () => null),
      createShortBook: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      createDraftSection: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      deleteDraftSection: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      createLibrary: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      createLibraryGroup: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      updateBook: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      updateLibraryGroup: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      deleteBook: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      saveDocument: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      saveLibraryEntry: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      createLibraryEntry: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      removeLibraryEntry: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      unregisterProject: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      deleteProject: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      })
    },
    session: {
      prompt(payload) {
        prompts.push(payload);
        return new Promise<SessionPromptAcceptedPayload>((resolve, reject) => {
          pending.push({ resolve, reject });
        });
      },
      async abort(payload) {
        aborts.push(payload);
        return {
          ...payload,
          abortedAt: new Date().toISOString()
        };
      }
    },
    models: {
      async list() {
        return { models: [], defaultModelId: "" };
      },
      async save(settings) {
        return {
          defaultModelId: settings.defaultModelId,
          models: settings.models.map((model) => ({
            id: model.id,
            label: model.label,
            provider: model.provider,
            modelId: model.modelId,
            api: model.api,
            baseUrl: model.baseUrl,
            reasoning: model.reasoning,
            defaultThinkingLevel: model.defaultThinkingLevel,
            thinkingLevelOptions: model.thinkingLevelOptions,
            temperatureOptions: model.temperatureOptions,
            hasApiKey: Boolean(model.apiKey)
          }))
        };
      },
      async test(model) {
        return {
          modelId: model.id,
          ok: true,
          message: "连接成功",
          testedAt: new Date().toISOString()
        };
      }
    },
    workspaceAgents: {
      async list() {
        return structuredClone(DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS);
      },
      async save() {
        return structuredClone(DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS);
      },
      async reset() {
        return structuredClone(DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS);
      }
    },
    learningImitationSettings: {
      async list() {
        throw new Error("Learning imitation settings are not used by conversation tests.");
      },
      async save() {
        throw new Error("Learning imitation settings are not used by conversation tests.");
      },
      async reset() {
        throw new Error("Learning imitation settings are not used by conversation tests.");
      }
    },
    workspaceDirectory: {
      async list() {
        return { path: null };
      },
      async choose() {
        return null;
      }
    },
    events: {
      subscribe() {
        return () => undefined;
      }
    }
  };
  return {
    api,
    prompts,
    aborts,
    resolveAccepted(index, payload) {
      pending[index]?.resolve(payload);
    },
    rejectPrompt(index, error) {
      pending[index]?.reject(error);
    },
    promptCount: () => prompts.length
  };
}

function eventOptions(sessionId: string, runId: string, id: string) {
  return {
    id,
    context: { correlationId: "cmd_1", sessionId, runId }
  };
}

function createMemoryStorage(): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
} {
  const values = new Map<string, string>();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    }
  };
}

function createEditProposal(
  overrides: Partial<AgentEditProposal> = {}
): AgentEditProposal {
  return {
    id: "proposal_1",
    runId: "run_edit_1",
    workspaceId: "short_story_1",
    stageId: "plot_design",
    documentId: "short_plot_design",
    title: "剧情设计",
    summary: "调整雨夜相遇的因果关系",
    status: "pending",
    baseRevision: "v1:4:11111111",
    proposedRevision: "v1:5:22222222",
    proposedText: "新的剧情文本",
    toolCallIds: ["tool_edit_1"],
    additions: 1,
    deletions: 1,
    hunks: [
      {
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        lines: [
          { type: "deletion", text: "旧句", oldLineNumber: 1 },
          { type: "addition", text: "新句", newLineNumber: 1 },
          {
            type: "context",
            text: "保留句",
            oldLineNumber: 2,
            newLineNumber: 2
          }
        ]
      }
    ],
    createdAt: "2026-07-19T11:00:00.000Z",
    updatedAt: "2026-07-19T11:00:00.000Z",
    ...overrides
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("agent conversation controller", () => {
  it("adds and replaces edit proposals with deep-cloned diff state", () => {
    const controller = useAgentConversation({ api: () => undefined });
    controller.messages.value = [{
      id: "run_edit_1_assistant",
      role: "assistant",
      content: "已生成修改建议",
      createdAt: "2026-07-19T11:00:00.000Z",
      runId: "run_edit_1",
      status: "completed"
    }];
    const proposal = createEditProposal();

    controller.upsertEditProposal("run_edit_1", proposal);
    proposal.toolCallIds.push("mutated_outside");
    proposal.hunks[0]!.lines[0]!.text = "外部改写";

    const storedProposal = controller.getEditProposal("run_edit_1", "proposal_1");
    expect(storedProposal).toMatchObject({
      summary: "调整雨夜相遇的因果关系",
      toolCallIds: ["tool_edit_1"]
    });
    expect(storedProposal?.hunks[0]?.lines[0]?.text).toBe("旧句");

    controller.upsertEditProposal(
      "run_edit_1",
      createEditProposal({
        summary: "更新后的修改摘要",
        additions: 2,
        updatedAt: "2026-07-19T11:02:00.000Z"
      })
    );

    expect(controller.messages.value[0]?.editProposals).toHaveLength(1);
    expect(controller.getEditProposal("run_edit_1", "proposal_1")).toMatchObject({
      summary: "更新后的修改摘要",
      additions: 2,
      updatedAt: "2026-07-19T11:02:00.000Z"
    });
    controller.dispose();
  });

  it("updates completed-run proposal status and blocks sending while review is pending", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api });
    controller.messages.value = [{
      id: "run_edit_1_assistant",
      role: "assistant",
      content: "本轮已经完成",
      createdAt: "2026-07-19T11:00:00.000Z",
      runId: "run_edit_1",
      status: "completed"
    }];
    controller.upsertEditProposal("run_edit_1", createEditProposal());
    controller.draft.value = "基于修改继续创作";

    expect(controller.hasPendingEditReview.value).toBe(true);
    expect(controller.canSend.value).toBe(false);
    await controller.sendMessage(document);
    expect(deferred.promptCount()).toBe(0);

    expect(
      controller.updateEditProposal("run_edit_1", "proposal_1", {
        status: "accepting",
        statusMessage: "正在应用"
      })
    ).toMatchObject({ status: "accepting", statusMessage: "正在应用" });
    expect(controller.hasPendingEditReview.value).toBe(true);

    expect(
      controller.updateEditProposal("run_edit_1", "proposal_1", {
        status: "accepted",
        statusMessage: "已应用"
      })
    ).toMatchObject({ status: "accepted", statusMessage: "已应用" });
    expect(controller.hasPendingEditReview.value).toBe(false);
    expect(controller.canSend.value).toBe(true);
    controller.dispose();
  });

  it("freezes the selected approval mode for each in-flight run", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.selectApprovalMode("auto-approve");
    controller.draft.value = "自动写入这次正文修改";
    const sessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);

    expect(deferred.prompts[0]?.writeApprovalMode).toBe("auto-approve");

    expect(controller.acceptsRunEvent(sessionId, "run_auto_approval")).toBe(true);
    expect(controller.approvalModeForRun(sessionId, "run_auto_approval")).toBe(
      "auto-approve"
    );

    controller.selectApprovalMode("request-approval");
    expect(controller.approvalMode.value).toBe("request-approval");
    expect(controller.approvalModeForRun(sessionId, "run_auto_approval")).toBe(
      "auto-approve"
    );

    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_auto_approval",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    expect(controller.approvalModeForRun(sessionId, "run_auto_approval")).toBe(
      "auto-approve"
    );
    controller.dispose();
  });

  it("persists the approval mode with its conversation", () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-approval-mode-test";
    const controller = useAgentConversation({
      api: () => undefined,
      persistenceKey,
      storage
    });
    expect(controller.approvalMode.value).toBe("request-approval");
    controller.draft.value = "保留这份对话草稿";
    controller.selectApprovalMode("auto-approve");
    controller.dispose();

    const restored = useAgentConversation({
      api: () => undefined,
      persistenceKey,
      storage
    });
    expect(restored.approvalMode.value).toBe("auto-approve");
    restored.dispose();
  });

  it("persists edit proposals and restores interrupted acceptance as pending", () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-edit-proposal-test";
    const controller = useAgentConversation({
      api: () => undefined,
      persistenceKey,
      storage
    });
    const interruptedProposal = createEditProposal({
      status: "accepting",
      truncated: true,
      statusMessage: "正在写入"
    });
    delete interruptedProposal.proposedText;
    controller.upsertEditProposal("run_edit_1", interruptedProposal);
    controller.dispose();

    const restored = useAgentConversation({
      api: () => undefined,
      persistenceKey,
      storage
    });
    expect(restored.getEditProposal("run_edit_1", "proposal_1")).toMatchObject({
      status: "pending",
      truncated: true,
      statusMessage: "正在写入",
      hunks: [
        {
          lines: [
            { type: "deletion", text: "旧句" },
            { type: "addition", text: "新句" },
            { type: "context", text: "保留句" }
          ]
        }
      ]
    });
    expect(restored.getEditProposal("run_edit_1", "proposal_1")).not.toHaveProperty(
      "proposedText"
    );
    expect(restored.hasPendingEditReview.value).toBe(true);
    restored.dispose();
  });

  it("persists conversation history and restores a selected conversation", () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-history-test";
    const controller = useAgentConversation({
      api: () => undefined,
      persistenceKey,
      storage
    });
    const firstSessionId = controller.sessionId.value;
    controller.messages.value = [{
      id: "first-user",
      role: "user",
      content: "分析第一章的人物动机",
      createdAt: "2026-07-19T10:00:00.000Z",
      status: "completed"
    }];

    controller.newConversation();
    const secondSessionId = controller.sessionId.value;
    controller.messages.value = [{
      id: "second-user",
      role: "user",
      content: "继续完善雨夜场景",
      createdAt: "2026-07-19T10:05:00.000Z",
      status: "completed"
    }];
    controller.draft.value = "补充环境细节";

    expect(controller.history.value).toHaveLength(2);
    expect(controller.history.value[0]).toMatchObject({
      sessionId: secondSessionId,
      title: "继续完善雨夜场景",
      current: true
    });
    expect(controller.selectConversation(firstSessionId)).toBe(true);
    expect(controller.messages.value[0]?.content).toBe("分析第一章的人物动机");
    expect(controller.sessionId.value).toBe(firstSessionId);
    controller.dispose();

    const restored = useAgentConversation({
      api: () => undefined,
      persistenceKey,
      storage
    });
    expect(restored.sessionId.value).toBe(firstSessionId);
    expect(restored.history.value).toHaveLength(2);
    expect(restored.selectConversation(secondSessionId)).toBe(true);
    expect(restored.draft.value).toBe("补充环境细节");
    restored.dispose();
  });

  it("keeps only the 20 most recent conversations", () => {
    const storage = createMemoryStorage();
    const controller = useAgentConversation({
      api: () => undefined,
      persistenceKey: "conversation-history-limit-test",
      storage
    });

    for (let index = 0; index < 22; index += 1) {
      controller.messages.value = [{
        id: `user-${index}`,
        role: "user",
        content: `历史对话 ${index}`,
        createdAt: new Date(Date.UTC(2026, 6, 19, 10, index)).toISOString(),
        status: "completed"
      }];
      controller.newConversation();
    }

    expect(controller.history.value).toHaveLength(20);
    expect(controller.history.value.some((item) => item.title === "历史对话 0")).toBe(false);
    expect(controller.history.value.some((item) => item.title === "历史对话 1")).toBe(false);
    expect(controller.history.value.some((item) => item.title === "历史对话 21")).toBe(true);
    controller.dispose();
  });

  it("uses the configured default model thinking level and carries model identity", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.applyModelSettings({
      defaultModelId: "writer",
      models: [
        {
          id: "writer",
          label: "Writer",
          provider: "openai",
          modelId: "writer-model",
          api: "openai-responses",
          baseUrl: "https://api.openai.com/v1",
          reasoning: true,
          defaultThinkingLevel: "high",
          thinkingLevelOptions: ["low", "high"],
          temperatureOptions: [0.1, 0.7, 1],
          hasApiKey: true
        }
      ]
    });

    expect(controller.selectedModelId.value).toBe("writer");
    expect(controller.thinkingLevel.value).toBe("high");
    controller.selectThinkingLevel("medium");
    expect(controller.thinkingLevel.value).toBe("high");
    controller.draft.value = "按默认配置运行";
    const sending = controller.sendMessage(document);
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_model",
      acceptedAt: new Date().toISOString(),
      runtime: { provider: "openai", model: "writer-model", mode: "provider" }
    });
    await sending;

    expect(deferred.prompts[0]).toMatchObject({
      modelId: "writer",
      thinkingLevel: "high"
    });
    controller.dispose();
  });

  it("keeps the latest run choices when starting or reopening a conversation", () => {
    const controller = useAgentConversation({
      api: () => undefined,
      persistenceKey: "project-run-preferences-test",
      storage: createMemoryStorage()
    });
    controller.applyModelSettings({
      defaultModelId: "writer",
      models: [
        {
          id: "writer",
          label: "Writer",
          provider: "openai",
          modelId: "writer-model",
          api: "openai-responses",
          baseUrl: "https://api.openai.com/v1",
          reasoning: true,
          defaultThinkingLevel: "high",
          thinkingLevelOptions: ["low", "high"],
          temperatureOptions: [0.2, 0.6, 1.2],
          hasApiKey: true
        }
      ]
    });
    controller.messages.value = [{
      id: "first-user",
      role: "user",
      content: "第一条对话",
      createdAt: "2026-07-22T08:00:00.000Z",
      status: "completed"
    }];
    const firstSessionId = controller.sessionId.value;
    controller.selectThinkingLevel("off");
    controller.selectTemperature(1.2);
    controller.selectApprovalMode("auto-approve");

    controller.newConversation();
    expect(controller.selectedModelId.value).toBe("writer");
    expect(controller.thinkingLevel.value).toBe("off");
    expect(controller.temperature.value).toBe(1.2);
    expect(controller.approvalMode.value).toBe("auto-approve");

    controller.selectThinkingLevel("low");
    controller.selectApprovalMode("request-approval");
    expect(controller.selectConversation(firstSessionId)).toBe(true);
    expect(controller.selectedModelId.value).toBe("writer");
    expect(controller.thinkingLevel.value).toBe("low");
    expect(controller.temperature.value).toBe(1.2);
    expect(controller.approvalMode.value).toBe("request-approval");
    controller.dispose();
  });

  it("preserves valid run choices when model settings are refreshed", () => {
    const controller = useAgentConversation({ api: () => undefined });
    const settings: ModelSettings = {
      defaultModelId: "writer",
      models: [
        {
          id: "writer",
          label: "Writer",
          provider: "openai",
          modelId: "writer-model",
          api: "openai-responses",
          baseUrl: "https://api.openai.com/v1",
          reasoning: true,
          defaultThinkingLevel: "high",
          thinkingLevelOptions: ["low", "high"],
          temperatureOptions: [0.2, 0.6, 1.2],
          hasApiKey: true
        }
      ]
    };
    controller.applyModelSettings(settings);
    controller.selectThinkingLevel("off");
    controller.selectTemperature(1.2);
    controller.selectApprovalMode("auto-approve");

    controller.applyModelSettings(settings);

    expect(controller.selectedModelId.value).toBe("writer");
    expect(controller.thinkingLevel.value).toBe("off");
    expect(controller.temperature.value).toBe(1.2);
    expect(controller.approvalMode.value).toBe("auto-approve");
    controller.dispose();
  });

  it("clears a persisted model choice when all configured models are removed", () => {
    const controller = useAgentConversation({ api: () => undefined });
    controller.applyModelSettings({
      defaultModelId: "writer",
      models: [
        {
          id: "writer",
          label: "Writer",
          provider: "openai",
          modelId: "writer-model",
          api: "openai-responses",
          baseUrl: "https://api.openai.com/v1",
          reasoning: true,
          defaultThinkingLevel: "high",
          thinkingLevelOptions: ["low", "high"],
          temperatureOptions: [0.2, 0.6, 1.2],
          hasApiKey: true
        }
      ]
    });
    controller.selectThinkingLevel("off");
    controller.selectTemperature(1.2);
    controller.selectApprovalMode("auto-approve");

    controller.applyModelSettings({ defaultModelId: "", models: [] });
    controller.applyRunSettings({
      selectedModelId: "writer",
      thinkingLevel: "off",
      temperature: 1.2,
      approvalMode: "auto-approve"
    });

    expect(controller.selectedModelId.value).toBe("");
    expect(controller.thinkingLevel.value).toBe("medium");
    expect(controller.temperature.value).toBe(0.7);
    expect(controller.approvalMode.value).toBe("auto-approve");
    controller.dispose();
  });

  it("falls back to the new default settings when the selected model is removed", () => {
    const controller = useAgentConversation({ api: () => undefined });
    controller.applyRunSettings({
      selectedModelId: "removed-writer",
      thinkingLevel: "low",
      temperature: 1.2,
      approvalMode: "request-approval"
    });
    controller.applyModelSettings({
      defaultModelId: "replacement",
      models: [
        {
          id: "replacement",
          label: "Replacement",
          provider: "openai",
          modelId: "replacement-model",
          api: "openai-responses",
          baseUrl: "https://api.openai.com/v1",
          reasoning: true,
          defaultThinkingLevel: "high",
          thinkingLevelOptions: ["low", "high"],
          temperatureOptions: [0.2, 0.6, 1.2],
          hasApiKey: true
        }
      ]
    });

    expect(controller.selectedModelId.value).toBe("replacement");
    expect(controller.thinkingLevel.value).toBe("high");
    expect(controller.temperature.value).toBe(0.6);
    controller.dispose();
  });

  it("sends attachment-only prompts and stores only display metadata", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    expect(controller.canSend.value).toBe(false);
    expect(controller.canSendAttachments.value).toBe(true);

    const proxiedAttachments = reactive([
      {
        id: "notes",
        kind: "text",
        name: "notes.md",
        mediaType: "text/markdown",
        size: 12,
        content: "雨夜，旧站台。"
      },
      {
        id: "reference",
        kind: "image",
        name: "reference.png",
        mediaType: "image/png",
        size: 3,
        data: "AQID"
      }
    ] as const);
    const sending = controller.sendMessage(document, [], {}, [...proxiedAttachments]);
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_attachments",
      acceptedAt: new Date().toISOString(),
      runtime: { provider: "openai", model: "vision-model", mode: "provider" }
    });
    await sending;

    expect(deferred.prompts[0]).toMatchObject({
      message: "请阅读并分析我上传的附件。",
      attachments: [
        { kind: "text", content: "雨夜，旧站台。" },
        { kind: "image", data: "AQID" }
      ]
    });
    expect(() => structuredClone(deferred.prompts[0]?.attachments)).not.toThrow();
    expect(controller.messages.value[0]).toMatchObject({
      role: "user",
      attachments: [
        { kind: "text", name: "notes.md" },
        { kind: "image", name: "reference.png" }
      ]
    });
    expect(controller.messages.value[0]?.attachments?.[1]).not.toHaveProperty("data");
    controller.dispose();
  });

  it("uses temperature when a reasoning model turns thinking off", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.applyModelSettings({
      defaultModelId: "reasoning-writer",
      models: [
        {
          id: "reasoning-writer",
          label: "Reasoning writer",
          provider: "openai",
          modelId: "reasoning-writer-model",
          api: "openai-responses",
          baseUrl: "https://api.openai.com/v1",
          reasoning: true,
          defaultThinkingLevel: "high",
          thinkingLevelOptions: ["low", "high"],
          temperatureOptions: [0.2, 0.6, 1.2],
          hasApiKey: true
        }
      ]
    });

    controller.selectThinkingLevel("off");
    controller.selectTemperature(1.2);
    expect(controller.thinkingLevel.value).toBe("off");
    expect(controller.temperature.value).toBe(1.2);

    controller.draft.value = "关闭思考并提高表达变化";
    const sending = controller.sendMessage(document);
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_reasoning_temperature",
      acceptedAt: new Date().toISOString(),
      runtime: { provider: "openai", model: "reasoning-writer-model", mode: "provider" }
    });
    await sending;

    expect(deferred.prompts[0]).toMatchObject({
      modelId: "reasoning-writer",
      thinkingLevel: "off",
      temperature: 1.2
    });
    controller.dispose();
  });

  it("uses only configured temperatures when a model defaults to non-thinking mode", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.applyModelSettings({
      defaultModelId: "plain-writer",
      models: [
        {
          id: "plain-writer",
          label: "Plain writer",
          provider: "deepseek",
          modelId: "deepseek-chat",
          api: "openai-completions",
          baseUrl: "https://api.deepseek.com/v1",
          reasoning: false,
          defaultThinkingLevel: "off",
          thinkingLevelOptions: ["medium"],
          temperatureOptions: [0.2, 0.6, 1.2],
          hasApiKey: true
        }
      ]
    });

    expect(controller.thinkingLevel.value).toBe("off");
    expect(controller.temperature.value).toBe(0.6);
    controller.selectTemperature(1.5);
    expect(controller.temperature.value).toBe(0.6);
    controller.selectTemperature(1.2);
    controller.draft.value = "使用更有变化的表达";
    const sending = controller.sendMessage(document);
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_temperature",
      acceptedAt: new Date().toISOString(),
      runtime: { provider: "deepseek", model: "deepseek-chat", mode: "provider" }
    });
    await sending;

    expect(deferred.prompts[0]).toMatchObject({
      modelId: "plain-writer",
      thinkingLevel: "off",
      temperature: 1.2
    });
    controller.dispose();
  });

  it("can turn thinking on when a model defaults to non-thinking mode", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.applyModelSettings({
      defaultModelId: "plain-writer",
      models: [
        {
          id: "plain-writer",
          label: "Plain writer",
          provider: "deepseek",
          modelId: "deepseek-chat",
          api: "openai-completions",
          baseUrl: "https://api.deepseek.com/v1",
          reasoning: false,
          defaultThinkingLevel: "off",
          thinkingLevelOptions: ["low", "high"],
          temperatureOptions: [0.2, 0.6, 1.2],
          hasApiKey: true
        }
      ]
    });

    expect(controller.thinkingLevel.value).toBe("off");
    controller.selectThinkingLevel("medium");
    expect(controller.thinkingLevel.value).toBe("off");
    controller.selectThinkingLevel("high");
    expect(controller.thinkingLevel.value).toBe("high");

    controller.draft.value = "开启深度思考";
    const sending = controller.sendMessage(document);
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_temperature_default_thinking_override",
      acceptedAt: new Date().toISOString(),
      runtime: { provider: "deepseek", model: "deepseek-chat", mode: "provider" }
    });
    await sending;

    expect(deferred.prompts[0]).toMatchObject({
      modelId: "plain-writer",
      thinkingLevel: "high"
    });
    expect(deferred.prompts[0]).not.toHaveProperty("temperature");
    controller.dispose();
  });

  it("accepts events before prompt accepted and prevents duplicate sends", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.draft.value = "续写当前章节";
    const sessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);

    controller.draft.value = "重复发送";
    await controller.sendMessage(document);
    expect(deferred.promptCount()).toBe(1);

    controller.handleEvent(
      createEnvelope(
        "agent.thinking_delta",
        {
          sessionId,
          runId: "run_1",
          messageId: "message_1",
          delta: "读取上下文",
          runtime
        },
        eventOptions(sessionId, "run_1", "evt_1")
      )
    );
    controller.handleEvent(
      createEnvelope(
        "agent.message_delta",
        {
          sessionId,
          runId: "run_1",
          messageId: "message_1",
          delta: "流式回复",
          runtime
        },
        eventOptions(sessionId, "run_1", "evt_2")
      )
    );

    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_1",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    expect(controller.messages.value.at(-1)).toMatchObject({
      content: "流式回复",
      thinking: "读取上下文",
      status: "streaming"
    });
    expect(controller.isBusy.value).toBe(true);
    controller.dispose();
  });

  it("ignores accepted and events after a new conversation starts", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.draft.value = "旧会话问题";
    const oldSessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);
    controller.newConversation();

    deferred.resolveAccepted(0, {
      sessionId: oldSessionId,
      runId: "run_old",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    controller.handleEvent(
      createEnvelope(
        "agent.message_delta",
        {
          sessionId: oldSessionId,
          runId: "run_old",
          messageId: "message_old",
          delta: "不应出现",
          runtime
        },
        eventOptions(oldSessionId, "run_old", "evt_old")
      )
    );

    expect(controller.messages.value).toEqual([]);
    expect(controller.isBusy.value).toBe(false);
    controller.dispose();
  });

  it("deduplicates events and drops late deltas after completion", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.draft.value = "验证事件";
    const sessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_1",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    const delta = createEnvelope(
      "agent.message_delta",
      {
        sessionId,
        runId: "run_1",
        messageId: "message_1",
        delta: "A",
        runtime
      },
      eventOptions(sessionId, "run_1", "evt_delta")
    );
    controller.handleEvent(delta);
    controller.handleEvent(delta);
    controller.handleEvent(
      createEnvelope(
        "agent.message_completed",
        {
          sessionId,
          runId: "run_1",
          messageId: "message_1",
          role: "assistant" as const,
          content: "AB",
          runtime
        },
        eventOptions(sessionId, "run_1", "evt_completed")
      )
    );
    controller.handleEvent(
      createEnvelope(
        "agent.message_delta",
        {
          sessionId,
          runId: "run_1",
          messageId: "message_1",
          delta: "迟到",
          runtime
        },
        eventOptions(sessionId, "run_1", "evt_late")
      )
    );

    expect(controller.messages.value.at(-1)?.content).toBe("AB");
    expect(controller.messages.value.at(-1)?.status).toBe("completed");
    expect(controller.isBusy.value).toBe(false);
    controller.dispose();
  });

  it("groups thinking and tool events into the assistant processing trace", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.draft.value = "检查项目";
    const sessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_tools",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    controller.handleEvent(
      createEnvelope(
        "tool.call_requested",
        {
          sessionId,
          runId: "run_tools",
          toolCallId: "tool_1",
          toolName: "read_file",
          args: { path: "README.md" },
          runtime
        },
        eventOptions(sessionId, "run_tools", "evt_tool_start")
      )
    );
    controller.handleEvent(
      createEnvelope(
        "agent.thinking_delta",
        {
          sessionId,
          runId: "run_tools",
          messageId: "message_tools",
          delta: "先检查项目说明。",
          runtime
        },
        eventOptions(sessionId, "run_tools", "evt_thinking")
      )
    );
    controller.handleEvent(
      createEnvelope(
        "tool.execution_completed",
        {
          sessionId,
          runId: "run_tools",
          toolCallId: "tool_1",
          toolName: "read_file",
          resultSummary: "已读取 README.md",
          isError: false,
          runtime
        },
        eventOptions(sessionId, "run_tools", "evt_tool_end")
      )
    );
    controller.handleEvent(
      createEnvelope(
        "agent.message_completed",
        {
          sessionId,
          runId: "run_tools",
          messageId: "message_tools",
          role: "assistant" as const,
          content: "检查完成。",
          runtime
        },
        eventOptions(sessionId, "run_tools", "evt_tools_completed")
      )
    );

    expect(controller.messages.value.at(-1)).toMatchObject({
      id: "message_tools",
      content: "检查完成。",
      thinking: "先检查项目说明。",
      status: "completed",
      activityOnly: false,
      toolCalls: [
        {
          id: "tool_1",
          name: "read_file",
          status: "completed",
          resultSummary: "已读取 README.md"
        }
      ]
    });
    expect(controller.messages.value.at(-1)?.processingStartedAt).toBeTruthy();
    expect(controller.messages.value.at(-1)?.processingCompletedAt).toBeTruthy();
    expect(
      controller.messages.value.at(-1)?.processingSteps?.map((step) => step.type)
    ).toEqual(["tool", "thinking", "response"]);
    controller.dispose();
  });

  it("shows and incrementally updates a tool before execution starts", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.draft.value = "写入剧情";
    const sessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_streaming_tool",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    const stream = (
      phase: "start" | "delta" | "end",
      argumentsDelta: string,
      eventId: string,
      args?: unknown
    ) => controller.handleEvent(
      createEnvelope(
        "tool.call_stream",
        {
          sessionId,
          runId: "run_streaming_tool",
          streamId: "message_streaming_tool:0",
          toolCallId: "tool_write_1",
          toolName: "write_workspace_editor",
          phase,
          argumentsDelta,
          runtime,
          ...(args !== undefined ? { args } : {})
        },
        eventOptions(sessionId, "run_streaming_tool", eventId)
      )
    );

    stream("start", "", "evt_tool_stream_start");
    expect(controller.messages.value.at(-1)?.toolCalls).toMatchObject([
      {
        id: "tool_write_1",
        status: "preparing",
        argumentsText: ""
      }
    ]);

    stream(
      "delta",
      '{"target_stage_id":"plot_design","text":"第一',
      "evt_tool_stream_delta_1"
    );
    stream("delta", '幕"}', "evt_tool_stream_delta_2");
    stream(
      "end",
      "",
      "evt_tool_stream_end",
      { target_stage_id: "plot_design", text: "第一幕" }
    );

    const streamedTool = controller.messages.value.at(-1)?.toolCalls?.[0];
    expect(streamedTool).toMatchObject({
      id: "tool_write_1",
      name: "write_workspace_editor",
      status: "preparing",
      argumentsComplete: true,
      argumentsText: '{"target_stage_id":"plot_design","text":"第一幕"}',
      args: { target_stage_id: "plot_design", text: "第一幕" }
    });

    controller.handleEvent(
      createEnvelope(
        "tool.call_requested",
        {
          sessionId,
          runId: "run_streaming_tool",
          toolCallId: "tool_write_1",
          toolName: "write_workspace_editor",
          args: { target_stage_id: "plot_design", text: "第一幕" },
          runtime
        },
        eventOptions(sessionId, "run_streaming_tool", "evt_tool_execution_start")
      )
    );

    expect(controller.messages.value.at(-1)?.toolCalls).toHaveLength(1);
    expect(controller.messages.value.at(-1)?.toolCalls?.[0]?.status).toBe("running");
    expect(controller.messages.value.at(-1)?.processingSteps).toHaveLength(1);
    controller.dispose();
  });

  it.each([
    {
      toolName: "write_section_body",
      first: '{"text":"第一',
      second: '段正文"}',
      args: { text: "第一段正文" }
    },
    {
      toolName: "write_expert_draft_section",
      first: '{"section_id":"section-1","text":"第一',
      second: '段正文"}',
      args: { section_id: "section-1", text: "第一段正文" }
    }
  ])("streams $toolName content and character progress before execution", async ({
    toolName,
    first,
    second,
    args
  }) => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.draft.value = "写正文";
    const sessionId = controller.sessionId.value;
    const runId = `run_${toolName}`;
    const streamId = `stream_${toolName}`;
    const toolCallId = `tool_${toolName}`;
    const sending = controller.sendMessage(document);
    deferred.resolveAccepted(0, {
      sessionId,
      runId,
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    const stream = (
      phase: "start" | "delta" | "end",
      argumentsDelta: string,
      eventId: string,
      completedArgs?: unknown
    ) => controller.handleEvent(
      createEnvelope(
        "tool.call_stream",
        {
          sessionId,
          runId,
          streamId,
          toolCallId,
          toolName,
          phase,
          argumentsDelta,
          runtime,
          ...(completedArgs !== undefined ? { args: completedArgs } : {})
        },
        eventOptions(sessionId, runId, eventId)
      )
    );

    stream("start", first, `${toolCallId}_start`);
    expect(controller.messages.value.at(-1)?.toolCalls?.[0]).toMatchObject({
      name: toolName,
      status: "preparing",
      argumentsText: first
    });

    stream("delta", second, `${toolCallId}_delta`);
    expect(controller.messages.value.at(-1)?.toolCalls?.[0]?.argumentsText).toBe(
      `${first}${second}`
    );

    stream("end", "", `${toolCallId}_end`, args);
    expect(controller.messages.value.at(-1)?.toolCalls?.[0]).toMatchObject({
      name: toolName,
      status: "preparing",
      argumentsComplete: true,
      args
    });
    expect(controller.messages.value.at(-1)?.processingSteps).toHaveLength(1);
    controller.dispose();
  });

  it("keeps later tool streams separate when a provider repeats a stream id", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.draft.value = "先读取再写入";
    const sessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_repeated_stream_id",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    const stream = (toolCallId: string, toolName: string, eventId: string) =>
      controller.handleEvent(
        createEnvelope(
          "tool.call_stream",
          {
            sessionId,
            runId: "run_repeated_stream_id",
            streamId: "provider-content-index-0",
            toolCallId,
            toolName,
            phase: "start" as const,
            argumentsDelta: "",
            runtime
          },
          eventOptions(sessionId, "run_repeated_stream_id", eventId)
        )
      );

    stream("tool_read", "read_workspace_content", "evt_repeated_stream_read");
    stream("tool_write", "write_workspace_editor", "evt_repeated_stream_write");

    expect(controller.messages.value.at(-1)?.toolCalls).toMatchObject([
      { id: "tool_read", name: "read_workspace_content", status: "preparing" },
      { id: "tool_write", name: "write_workspace_editor", status: "preparing" }
    ]);
    expect(
      controller.messages.value.at(-1)?.processingSteps?.filter((step) => step.type === "tool")
    ).toHaveLength(2);
    controller.dispose();
  });

  it("preserves interleaved thinking, responses, and tools in arrival order", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.draft.value = "按步骤处理";
    const sessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_ordered",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    const emit = (
      type: "agent.thinking_delta" | "agent.message_delta" | "tool.call_requested",
      payload: Record<string, unknown>,
      eventId: string
    ) => {
      controller.handleEvent(
        createEnvelope(
          type,
          {
            sessionId,
            runId: "run_ordered",
            runtime,
            ...payload
          } as never,
          eventOptions(sessionId, "run_ordered", eventId)
        )
      );
    };

    emit(
      "agent.thinking_delta",
      { messageId: "message_ordered", delta: "先分析。" },
      "evt_ordered_1"
    );
    emit(
      "agent.message_delta",
      { messageId: "message_ordered", delta: "先返回阶段结论。" },
      "evt_ordered_2"
    );
    emit(
      "tool.call_requested",
      { toolCallId: "tool_ordered_1", toolName: "read_file", args: { path: "one.md" } },
      "evt_ordered_3"
    );
    emit(
      "agent.thinking_delta",
      { messageId: "message_ordered", delta: "继续分析。" },
      "evt_ordered_4"
    );
    emit(
      "agent.message_delta",
      { messageId: "message_ordered", delta: "再返回阶段结论。" },
      "evt_ordered_5"
    );
    emit(
      "tool.call_requested",
      { toolCallId: "tool_ordered_2", toolName: "read_file", args: { path: "two.md" } },
      "evt_ordered_6"
    );

    expect(
      controller.messages.value.at(-1)?.processingSteps?.map((step) => step.type)
    ).toEqual(["thinking", "response", "tool", "thinking", "response", "tool"]);

    controller.handleEvent(
      createEnvelope(
        "agent.message_completed",
        {
          sessionId,
          runId: "run_ordered",
          messageId: "message_ordered",
          role: "assistant" as const,
          content: "这是最后一段返回信息。",
          runtime
        },
        eventOptions(sessionId, "run_ordered", "evt_ordered_complete")
      )
    );

    const message = controller.messages.value.at(-1);
    expect(message?.processingSteps?.map((step) => step.type)).toEqual([
      "thinking",
      "response",
      "tool",
      "thinking",
      "response",
      "tool",
      "response"
    ]);
    expect(
      message?.processingSteps
        ?.filter((step) => step.type === "response")
        .map((step) => step.content)
    ).toEqual(["先返回阶段结论。", "再返回阶段结论。", "这是最后一段返回信息。"]);
    expect(message?.content).toBe("这是最后一段返回信息。");
    controller.dispose();
  });

  it("releases busy state and exposes a clear agent error", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.draft.value = "验证错误";
    const sessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_error",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;
    controller.handleEvent(
      createEnvelope(
        "agent.error",
        {
          sessionId,
          runId: "run_error",
          code: "agent.failed",
          message: "本地运行失败",
          runtime
        },
        eventOptions(sessionId, "run_error", "evt_error")
      )
    );

    expect(controller.conversationError.value).toBe("本地运行失败");
    expect(controller.messages.value.at(-1)?.status).toBe("error");
    expect(controller.isBusy.value).toBe(false);
    controller.dispose();
  });

  it("stops the active run and keeps a partial reply without treating it as an error", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.draft.value = "生成一段长回复";
    const sessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_stop",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;
    controller.handleEvent(
      createEnvelope(
        "agent.message_delta",
        {
          sessionId,
          runId: "run_stop",
          messageId: "message_stop",
          delta: "已经生成的部分",
          runtime
        },
        eventOptions(sessionId, "run_stop", "evt_stop_delta")
      )
    );

    expect(controller.canStop.value).toBe(true);
    await expect(controller.stopGeneration()).resolves.toBe(true);
    expect(deferred.aborts).toEqual([{ sessionId, runId: "run_stop" }]);
    expect(controller.canStop.value).toBe(false);

    controller.handleEvent(
      createEnvelope(
        "agent.error",
        {
          sessionId,
          runId: "run_stop",
          code: "pi_agent.aborted",
          message: "Agent run aborted.",
          runtime
        },
        eventOptions(sessionId, "run_stop", "evt_stopped")
      )
    );

    expect(controller.messages.value.at(-1)).toMatchObject({
      content: "已经生成的部分",
      status: "stopped"
    });
    expect(controller.conversationError.value).toBeNull();
    expect(controller.isBusy.value).toBe(false);
    controller.dispose();
  });

  it("isolates a timed-out acceptance from the next send", async () => {
    vi.useFakeTimers();
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 50 });
    const sessionId = controller.sessionId.value;
    controller.draft.value = "第一轮";
    const first = controller.sendMessage(document);
    await vi.advanceTimersByTimeAsync(60);
    expect(controller.isBusy.value).toBe(false);

    controller.draft.value = "第二轮";
    const second = controller.sendMessage(document);
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_late",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await first;
    expect(controller.isBusy.value).toBe(true);

    deferred.resolveAccepted(1, {
      sessionId,
      runId: "run_current",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await second;
    expect(controller.isBusy.value).toBe(true);
    controller.dispose();
  });

  it("uses a five-minute idle timeout by default", async () => {
    vi.useFakeTimers();
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api });
    controller.draft.value = "验证默认空闲超时";
    void controller.sendMessage(document);

    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(controller.isBusy.value).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(controller.isBusy.value).toBe(false);
    expect(controller.conversationError.value).toBe("智能体长时间没有返回新事件，请稍后重试。");
    controller.dispose();
  });

  it("marks an existing streaming message as error on idle timeout", async () => {
    vi.useFakeTimers();
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 50 });
    controller.draft.value = "验证流超时";
    const sessionId = controller.sessionId.value;
    void controller.sendMessage(document);
    controller.handleEvent(
      createEnvelope(
        "agent.message_delta",
        {
          sessionId,
          runId: "run_timeout",
          messageId: "message_timeout",
          delta: "未完成",
          runtime
        },
        eventOptions(sessionId, "run_timeout", "evt_timeout")
      )
    );
    await vi.advanceTimersByTimeAsync(60);

    expect(controller.messages.value.at(-1)).toMatchObject({
      content: "未完成",
      status: "error"
    });
    expect(controller.isBusy.value).toBe(false);
    controller.dispose();
  });

  it("rejects an acceptance that disagrees with an already observed run", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.draft.value = "验证身份";
    const sessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);
    controller.handleEvent(
      createEnvelope(
        "agent.message_delta",
        {
          sessionId,
          runId: "run_observed",
          messageId: "message_observed",
          delta: "先到事件",
          runtime
        },
        eventOptions(sessionId, "run_observed", "evt_observed")
      )
    );
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_other",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    expect(controller.conversationError.value).toContain("运行标识不一致");
    expect(controller.messages.value.at(-1)?.status).toBe("error");
    expect(controller.isBusy.value).toBe(false);
    controller.dispose();
  });

  it("builds five text stages plus the physical expert-draft directory", async () => {
    for (const [index, activeStageId] of SHORT_WORKSPACE_STAGE_IDS.entries()) {
      const deferred = createDeferredApi();
      const controller = useAgentConversation({
        api: () => deferred.api,
        idleTimeoutMs: 10_000
      });
      const workspaceDocuments = createShortWorkspaceDocuments();
      const activeDocument =
        activeStageId === "draft"
          ? createDraftCoordinatorDocument(workspaceDocuments)
          : workspaceDocuments.find(
              (candidate) => candidate.stageId === activeStageId
            );
      if (!activeDocument) throw new Error(`Missing stage document: ${activeStageId}`);

      controller.draft.value = `检查 ${activeStageId}`;
      const sending = controller.sendMessage(
        activeDocument,
        [...workspaceDocuments].reverse()
      );
      const sessionId = controller.sessionId.value;
      deferred.resolveAccepted(0, {
        sessionId,
        runId: `run_short_snapshot_${index}`,
        acceptedAt: new Date().toISOString(),
        runtime
      });
      await sending;

      const context = deferred.prompts[0]?.workspaceContext;
      expect(context?.shortWorkspace).toMatchObject({
        id: "short_story_1",
        title: "雨夜来信",
        categories: ["都市", "悬疑"],
        activeStageId,
        stages: SHORT_WORKSPACE_TEXT_STAGE_IDS.map((stageId) => ({
          stageId,
          title: shortStageTitles[stageId],
          content: `${stageId} 的实时内容`,
          revision: createShortWorkspaceContentRevision(
            `${stageId} 的实时内容`
          )
        })),
        expertDraft: {
          id: "draft",
          title: "正文",
          sections: [
            expect.objectContaining({
              id: "intro",
              body: expect.objectContaining({
                documentId: "short_draft_intro_body",
                content: ""
              }),
              characterState: expect.objectContaining({
                documentId: "short_draft_intro_state",
                content: ""
              })
            }),
            expect.objectContaining({
              id: "section-1",
              body: expect.objectContaining({
                documentId: "short_draft_section-1_body",
                content: "draft 的实时内容"
              }),
              characterState: expect.objectContaining({
                documentId: "short_draft_section-1_state",
                content: "第一节人物状态"
              })
            })
          ]
        }
      });
      expect(context?.activeResource?.content).toBe(
        activeStageId === "draft" ? "" : `${activeStageId} 的实时内容`
      );
      if (activeStageId === "draft") {
        expect(context?.activeResource?.id).toBe("draft");
        expect(context?.shortWorkspace?.activeAgentId).toBe(
          "expert_draft_coordinator"
        );
      }
      controller.dispose();
    }
  });

  it("forwards the selected draft section and section-writer identity", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    const workspaceDocuments = createShortWorkspaceDocuments();
    const sectionDocument = workspaceDocuments.find(
      (candidate) =>
        candidate.expertSectionId === "section-1" &&
        candidate.draftFileKind === "body"
    );
    if (!sectionDocument) throw new Error("Missing draft section body.");

    controller.draft.value = "继续编写第一节";
    const sending = controller.sendMessage(sectionDocument, workspaceDocuments);
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_section_writer",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    expect(deferred.prompts[0]?.workspaceContext?.shortWorkspace).toMatchObject({
      activeStageId: "draft",
      activeAgentId: "expert_section_writer",
      activeSectionId: "section-1",
      expertDraft: {
        sections: [
          expect.objectContaining({ id: "intro" }),
          expect.objectContaining({
            id: "section-1",
            body: expect.objectContaining({ content: "draft 的实时内容" }),
            characterState: expect.objectContaining({ content: "第一节人物状态" })
          })
        ]
      }
    });
    expect(
      deferred.prompts[0]?.workspaceContext?.shortWorkspace?.stages
    ).toHaveLength(SHORT_WORKSPACE_TEXT_STAGE_IDS.length);
    expect(deferred.prompts[0]?.workspaceContext?.activeResource).toMatchObject({
      id: "short_draft_section-1_body",
      content: "draft 的实时内容"
    });
    controller.dispose();
  });

  it("sends the tab-selected section body as the active physical draft file", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    const workspaceDocuments = createShortWorkspaceDocuments();
    const firstBody = workspaceDocuments.find(
      (candidate) =>
        candidate.expertSectionId === "section-1" &&
        candidate.draftFileKind === "body"
    );
    const firstState = workspaceDocuments.find(
      (candidate) =>
        candidate.expertSectionId === "section-1" &&
        candidate.draftFileKind === "character-state"
    );
    if (!firstBody || !firstState) throw new Error("Missing first section files.");
    const secondBody: WorkspaceDocument = {
      ...firstBody,
      id: "short_draft_section-2_body",
      title: "第二节",
      path: ["雨夜来信", "正文", "第二节", "正文"],
      content: "第二节实时正文",
      expertSectionId: "section-2",
      expertSectionOrder: 2
    };
    const secondState: WorkspaceDocument = {
      ...firstState,
      id: "short_draft_section-2_state",
      title: "第二节 · 人物状态",
      path: ["雨夜来信", "正文", "第二节", "人物状态"],
      content: "第二节人物状态",
      expertSectionId: "section-2",
      expertSectionOrder: 2
    };
    workspaceDocuments.push(secondBody, secondState);

    controller.draft.value = "右侧标签已切到第二节";
    const sending = controller.sendMessage(secondBody, workspaceDocuments);
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_tab_selected_section",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    const context = deferred.prompts[0]?.workspaceContext;
    expect(context?.shortWorkspace).toMatchObject({
      activeStageId: "draft",
      activeAgentId: "expert_section_writer",
      activeSectionId: "section-2"
    });
    expect(
      context?.shortWorkspace?.expertDraft.sections.find(
        (section) => section.id === "section-2"
      )?.body
    ).toMatchObject({
      documentId: "short_draft_section-2_body",
      content: "第二节实时正文"
    });
    expect(context?.activeResource).toMatchObject({
      id: "short_draft_section-2_body",
      content: "第二节实时正文"
    });
    controller.dispose();
  });

  it("sends every physical draft file in full without the former 20k snapshot truncation", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    const ordinaryStages = createShortWorkspaceDocuments().filter(
      (candidate) => candidate.stageId !== "draft"
    );
    const firstBody = `第一节完整开头${"雨".repeat(20_100)}第一节完整结尾`;
    const draftFiles: WorkspaceDocument[] = Array.from(
      { length: 5 },
      (_, index) => {
        const sectionId = `section-${index + 1}`;
        const title = `第${index + 1}节`;
        const common = {
          domain: "creation" as const,
          eyebrow: "短篇创作",
          workspaceId: "short_story_1",
          workspaceType: "short" as const,
          workspaceTitle: "雨夜来信",
          workspaceCategories: ["都市", "悬疑"],
          stageId: "draft" as const,
          shortAgentId: "expert_section_writer" as const,
          expertSectionId: sectionId,
          expertSectionOrder: index,
          expertWordCountRequirement: "1200 字",
          draftDirectoryId: "draft"
        };
        return [
          {
            ...common,
            id: `${sectionId}-body`,
            title,
            path: ["雨夜来信", "正文", title, "正文"],
            format: "正文" as const,
            content: index === 0 ? firstBody : `第${index + 1}节完整正文`,
            draftFileKind: "body" as const
          },
          {
            ...common,
            id: `${sectionId}-state`,
            title: `${title} · 人物状态`,
            path: ["雨夜来信", "正文", title, "人物状态"],
            format: "账本" as const,
            content: `第${index + 1}节人物状态`,
            draftFileKind: "character-state" as const
          }
        ];
      }
    ).flat();
    const workspaceDocuments = [...ordinaryStages, ...draftFiles];
    const sectionDocument = draftFiles.find(
      (candidate) =>
        candidate.expertSectionId === "section-5" &&
        candidate.draftFileKind === "body"
    );
    if (!sectionDocument) throw new Error("Missing fifth section body.");

    controller.draft.value = "继续编写第五节";
    const sending = controller.sendMessage(sectionDocument, workspaceDocuments);
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_long_section_writer",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    const snapshot = deferred.prompts[0]?.workspaceContext?.shortWorkspace;
    expect(snapshot?.stages.map((stage) => stage.stageId)).toEqual(
      SHORT_WORKSPACE_TEXT_STAGE_IDS
    );
    expect(snapshot?.expertDraft.sections.map((section) => section.id)).toEqual([
      "section-1",
      "section-2",
      "section-3",
      "section-4",
      "section-5"
    ]);
    expect(snapshot?.expertDraft.sections[0]?.body.content).toBe(firstBody);
    expect(snapshot?.expertDraft.sections.at(-1)?.body.content).toBe(
      "第5节完整正文"
    );
    expect(deferred.prompts[0]?.workspaceContext?.activeResource).toMatchObject({
      id: "section-5-body",
      content: "第5节完整正文"
    });
    controller.dispose();
  });

  it("tracks a requested tool as running and updates it when completed", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    controller.draft.value = "读取人物内容";
    const sessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_tools",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    controller.handleEvent(
      createEnvelope(
        "tool.call_requested",
        {
          sessionId,
          runId: "run_tools",
          toolCallId: "tool_read_character",
          toolName: "read_workspace_content",
          args: { stage_ids: ["character_design"] },
          runtime
        },
        eventOptions(sessionId, "run_tools", "evt_tool_requested")
      )
    );

    expect(controller.messages.value.at(-1)).toMatchObject({
      id: "run_tools_assistant",
      role: "assistant",
      status: "streaming",
      tools: [
        {
          id: "tool_read_character",
          name: "read_workspace_content",
          status: "running"
        }
      ]
    });

    controller.handleEvent(
      createEnvelope(
        "tool.execution_completed",
        {
          sessionId,
          runId: "run_tools",
          toolCallId: "tool_read_character",
          toolName: "read_workspace_content",
          resultSummary: "已读取人物阶段",
          isError: false,
          runtime
        },
        eventOptions(sessionId, "run_tools", "evt_tool_completed")
      )
    );

    expect(controller.messages.value.at(-1)?.tools).toEqual([
      {
        id: "tool_read_character",
        name: "read_workspace_content",
        status: "completed",
        summary: "已读取人物阶段"
      }
    ]);
    expect(controller.isBusy.value).toBe(true);
    expect(controller.acceptsRunEvent(sessionId, "run_tools")).toBe(true);
    controller.markToolConflict(
      "run_tools",
      "tool_read_character",
      "文稿版本已变化，未应用。"
    );
    expect(controller.messages.value.at(-1)?.tools?.[0]).toMatchObject({
      status: "error",
      summary: "文稿版本已变化，未应用。"
    });

    controller.handleEvent(
      createEnvelope(
        "agent.message_completed",
        {
          sessionId,
          runId: "run_tools",
          messageId: "run_tools_assistant",
          role: "assistant" as const,
          content: "检查完成。",
          runtime
        },
        eventOptions(sessionId, "run_tools", "evt_tools_completed")
      )
    );
    expect(controller.acceptsRunEvent(sessionId, "run_tools")).toBe(false);
    controller.dispose();
  });

  it("forwards explicitly bound skill and material snapshots with the short workspace", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    const workspaceDocuments = createShortWorkspaceDocuments();
    const activeDocument = workspaceDocuments.find((candidate) => candidate.stageId === "plot_design");
    if (!activeDocument) throw new Error("Missing plot_design stage document.");

    controller.draft.value = "使用绑定资料设计剧情";
    const sending = controller.sendMessage(activeDocument, workspaceDocuments, {
      attachedSkills: [
        {
          id: "skill_entry_1",
          title: "剧情反转",
          source: "attached-skill",
          kind: "plot",
          content: "先建立稳定预期，再用人物选择完成反转。"
        }
      ],
      attachedMaterials: [
        {
          id: "material_entry_1",
          title: "雨夜误导线索",
          source: "attached-material",
          kind: "plot",
          content: "雨水会冲淡脚印，但不会改变门轴上的新鲜锈痕。"
        }
      ]
    });
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_bound_libraries",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    expect(deferred.prompts[0]?.workspaceContext).toMatchObject({
      attachedSkills: [
        {
          id: "skill_entry_1",
          title: "剧情反转",
          source: "attached-skill",
          kind: "plot"
        }
      ],
      attachedMaterials: [
        {
          id: "material_entry_1",
          title: "雨夜误导线索",
          source: "attached-material",
          kind: "plot"
        }
      ]
    });
    controller.dispose();
  });

  it("records truncation metadata for a document over the context limit", () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.draft.value = "验证长文快照";
    void controller.sendMessage({ ...document, content: "长".repeat(20_010) });

    expect(deferred.prompts[0]?.workspaceContext?.activeResource).toMatchObject({
      truncated: true,
      originalLength: 20_010
    });
    expect(
      deferred.prompts[0]?.workspaceContext?.activeResource?.content
    ).toHaveLength(20_000);
    controller.dispose();
  });
});
