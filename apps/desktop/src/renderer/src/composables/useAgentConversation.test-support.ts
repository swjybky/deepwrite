import { afterEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import {
  DEFAULT_AGENT_TEAM_SETTINGS,
  DEFAULT_LIBRARY_AGENT_SETTINGS,
  DEFAULT_LONG_AGENT_SETTINGS,
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS,
  DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
  SCRIPT_WORKSPACE_TEXT_STAGE_IDS,
  SHORT_WORKSPACE_STAGE_IDS,
  SHORT_WORKSPACE_TEXT_STAGE_IDS,
  createDefaultAppearanceSettings,
  createDefaultCreativePlotStages,
  createEmptyLongMarkdownFileReference,
  createShortWorkspaceContentRevision,
  createEnvelope,
  longCharacterCoreProfileFileId,
  longCharacterFilePath,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  type DeepWriteApi,
  type ModelSettings,
  type SessionAbortCommandPayload,
  type SessionPromptAcceptedPayload,
  type SessionPromptCommandPayload
} from "@deepwrite/contracts";
import {
  mergeAgentConversationPersistenceSnapshots,
  useAgentConversation,
  type AgentConversationPersistenceRecord,
  type AgentConversationPersistenceSnapshot,
  type UseAgentConversationOptions
} from "./useAgentConversation";
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

const plotStages = createDefaultCreativePlotStages();

function shortStageTitle(stageId: string): string {
  return stageId === "character_design"
    ? "人物"
    : stageId === "draft"
      ? "正文"
      : (plotStages.find(({ id }) => id === stageId)?.title ?? stageId);
}

function createShortWorkspaceDocuments(): WorkspaceDocument[] {
  const stages: WorkspaceDocument[] = SHORT_WORKSPACE_TEXT_STAGE_IDS.map(
    (stageId) => ({
      id: `short_${stageId}`,
      domain: "creation",
      title: shortStageTitle(stageId),
      eyebrow: "短篇创作",
      path: ["雨夜来信", shortStageTitle(stageId)],
      format: "设定" as const,
      content: `${stageId} 的实时内容`,
      workspaceId: "short_story_1",
      workspaceType: "short",
      workspaceTitle: "雨夜来信",
      workspaceCategories: ["都市", "悬疑"],
      stageId,
      ...(stageId === "character_design"
        ? {}
        : {
            plotStageDescription: plotStages.find(({ id }) => id === stageId)!
              .description,
            plotStageOrder: plotStages.findIndex(({ id }) => id === stageId)
          })
    })
  );
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
        shortAgentId: "short" as const,
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

function createScriptWorkspaceDocuments(): WorkspaceDocument[] {
  const stages: WorkspaceDocument[] = SCRIPT_WORKSPACE_TEXT_STAGE_IDS.map(
    (stageId) => ({
      id: `script_${stageId}`,
      domain: "creation",
      title: shortStageTitle(stageId),
      eyebrow: "剧本创作",
      path: ["雨夜剧本", shortStageTitle(stageId)],
      format: "设定" as const,
      content: `${stageId} 的剧本实时内容`,
      workspaceId: "script_story_1",
      workspaceType: "script",
      workspaceTitle: "雨夜剧本",
      workspaceCategories: ["悬疑"],
      stageId,
      ...(stageId === "character_design"
        ? {}
        : {
            plotStageDescription: plotStages.find(({ id }) => id === stageId)!
              .description,
            plotStageOrder: plotStages.findIndex(({ id }) => id === stageId)
          })
    })
  );
  const common = {
    domain: "creation" as const,
    eyebrow: "剧本创作",
    workspaceId: "script_story_1",
    workspaceType: "script" as const,
    workspaceTitle: "雨夜剧本",
    workspaceCategories: ["悬疑"],
    stageId: "draft" as const,
    shortAgentId: "script" as const,
    expertSectionId: "episode-1",
    expertSectionOrder: 0,
    expertWordCountRequirement: "1200 字",
    draftDirectoryId: "draft"
  };
  return [
    ...stages,
    {
      ...common,
      id: "script_draft_episode-1_body",
      title: "第一集",
      path: ["雨夜剧本", "正文", "第一集", "正文"],
      format: "正文" as const,
      content: "1. 内景 公寓 - 夜\n△雨水沿着窗玻璃滑落。",
      draftFileKind: "body" as const
    },
    {
      ...common,
      id: "script_draft_episode-1_state",
      title: "第一集 · 人物状态",
      path: ["雨夜剧本", "正文", "第一集", "人物状态"],
      format: "账本" as const,
      content: "林默：发现来信。",
      draftFileKind: "character-state" as const
    }
  ];
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
    shortAgentId: "short"
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
  const queuedPromptResults = new Map<
    number,
    | { status: "accepted"; payload: SessionPromptAcceptedPayload }
    | { status: "rejected"; error: Error }
  >();
  const prompts: SessionPromptCommandPayload[] = [];
  const aborts: SessionAbortCommandPayload[] = [];
  const api: DeepWriteApi = {
    system: {
      async health() {
        return {
          status: "ok",
          checkedAt: new Date().toISOString(),
          workers: []
        };
      }
    },
    updates: {
      async getState() {
        return {
          status: "idle",
          currentVersion: "1.0.0",
          releaseNotes: [],
          mandatory: false,
          canDownload: false,
          canInstall: false
        };
      },
      async check() {
        return this.getState();
      },
      async download() {
        return this.getState();
      },
      async install() {},
      subscribe() {
        return () => undefined;
      }
    },
    appAlerts: {
      async get() {
        return {
          desktopMessages: [],
          modelMessages: ["模型公告"],
          desktopRevision: "0".repeat(64),
          shouldShowDesktop: false
        };
      },
      async acknowledgeDesktop() {}
    },
    marketplace: {
      async session() {
        throw new Error("Marketplace is not used by conversation tests.");
      },
      async register() {
        throw new Error("Marketplace is not used by conversation tests.");
      },
      async login() {
        throw new Error("Marketplace is not used by conversation tests.");
      },
      async logout() {
        throw new Error("Marketplace is not used by conversation tests.");
      },
      async list() {
        throw new Error("Marketplace is not used by conversation tests.");
      },
      async detail() {
        throw new Error("Marketplace is not used by conversation tests.");
      },
      async listMine() {
        throw new Error("Marketplace is not used by conversation tests.");
      },
      async myDetail() {
        throw new Error("Marketplace is not used by conversation tests.");
      },
      async publish() {
        throw new Error("Marketplace is not used by conversation tests.");
      },
      async update() {
        throw new Error("Marketplace is not used by conversation tests.");
      },
      async setEnabled() {
        throw new Error("Marketplace is not used by conversation tests.");
      },
      async delete() {
        throw new Error("Marketplace is not used by conversation tests.");
      },
      async like() {
        throw new Error("Marketplace is not used by conversation tests.");
      },
      async previewInstall() {
        throw new Error("Marketplace is not used by conversation tests.");
      },
      async install() {
        throw new Error("Marketplace is not used by conversation tests.");
      }
    },
    cloudBackup: {
      async status() {
        throw new Error("Cloud backup is not used by conversation tests.");
      },
      async previewBackup() {
        throw new Error("Cloud backup is not used by conversation tests.");
      },
      async applyBackup() {
        throw new Error("Cloud backup is not used by conversation tests.");
      },
      async previewRestore() {
        throw new Error("Cloud backup is not used by conversation tests.");
      },
      async applyRestore() {
        throw new Error("Cloud backup is not used by conversation tests.");
      }
    },
    catalog: {
      loadDraftRecovery: vi.fn(async () => ({})),
      saveDraftRecovery: vi.fn(async () => undefined),
      index: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      readDocument: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      readWritingContext: vi.fn(async ({ bookId }) => ({
        bookId,
        workspaceType: bookId.startsWith("script_")
          ? ("script" as const)
          : ("short" as const),
        content: "# 测试作品上下文",
        truncated: false
      })),
      writeWritingContext: vi.fn(async () => {
        throw new Error(
          "Writing context save is not used by conversation tests."
        );
      }),
      snapshot: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      openProject: vi.fn(async () => null),
      importLegacyLibrary: vi.fn(async () => null),
      chooseExternalLibraryEntries: vi.fn(async () => null),
      importLibraryEntries: vi.fn(),
      createShortBook: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      createScriptBook: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      mutatePlotStructure: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      mutateCharacterStructure: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      createDraftSection: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      createDraftSections: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      deleteDraftSection: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      moveDraftSection: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      createLibrary: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      updateLibrary: vi.fn(async () => {
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
      moveLibraryEntry: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      unregisterProject: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      deleteProject: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      }),
      duplicateProject: vi.fn(async () => {
        throw new Error("Catalog is not used by conversation tests.");
      })
    },
    long: {
      list: vi.fn(async () => {
        throw new Error("Long workspace is not used by conversation tests.");
      }),
      create: vi.fn(async () => null),
      duplicateBook: vi.fn(async () => {
        throw new Error("Long workspace is not used by conversation tests.");
      }),
      rename: vi.fn(async () => {
        throw new Error("Long workspace is not used by conversation tests.");
      }),
      updateBindings: vi.fn(async () => {
        throw new Error("Long workspace is not used by conversation tests.");
      }),
      chooseLegacySyncSource: vi.fn(async () => null),
      applyLegacySync: vi.fn(async () => {
        throw new Error("Long workspace is not used by conversation tests.");
      }),
      importPortable: vi.fn(async () => null),
      chooseContinuationImportSource: vi.fn(async () => null),
      importContinuation: vi.fn(async () => null),
      open: vi.fn(async () => {
        throw new Error("Long workspace is not used by conversation tests.");
      }),
      openExisting: vi.fn(async () => null),
      getWorkspaceIndex: vi.fn(async () => {
        throw new Error("Long workspace is not used by conversation tests.");
      }),
      readDocument: vi.fn(async () => {
        throw new Error("Long workspace is not used by conversation tests.");
      }),
      search: vi.fn(async () => {
        throw new Error("Long workspace is not used by conversation tests.");
      }),
      writeDocument: vi.fn(async () => {
        throw new Error("Long workspace is not used by conversation tests.");
      }),
      readAgentsMd: vi.fn(async () => {
        throw new Error("Long workspace is not used by conversation tests.");
      }),
      writeAgentsMd: vi.fn(async () => {
        throw new Error("Long workspace is not used by conversation tests.");
      }),
      previewOperations: vi.fn(async () => {
        throw new Error("Long workspace is not used by conversation tests.");
      }),
      applyOperations: vi.fn(async () => {
        throw new Error("Long workspace is not used by conversation tests.");
      }),
      writeChapter: vi.fn(async () => {
        throw new Error("Long workspace is not used by conversation tests.");
      }),
      commitChapter: vi.fn(async () => {
        throw new Error("Long workspace is not used by conversation tests.");
      }),
      deleteLedgerCommit: vi.fn(async () => {
        throw new Error("Long workspace is not used by conversation tests.");
      }),
      unregister: vi.fn(async () => {
        throw new Error("Long workspace is not used by conversation tests.");
      }),
      delete: vi.fn(async () => {
        throw new Error("Long workspace is not used by conversation tests.");
      })
    },
    session: {
      prompt(payload) {
        const index = prompts.length;
        prompts.push(payload);
        return new Promise<SessionPromptAcceptedPayload>((resolve, reject) => {
          pending[index] = { resolve, reject };
          const queued = queuedPromptResults.get(index);
          if (!queued) return;
          queuedPromptResults.delete(index);
          if (queued.status === "accepted") resolve(queued.payload);
          else reject(queued.error);
        });
      },
      async abort(payload) {
        aborts.push(payload);
        return {
          ...payload,
          abortedAt: new Date().toISOString()
        };
      },
      async submitUserInput(payload) {
        return {
          sessionId: payload.sessionId,
          runId: payload.runId,
          requestId: payload.requestId,
          resolvedAt: new Date().toISOString()
        };
      }
    },
    models: {
      async list() {
        return { models: [], defaultModelId: "" };
      },
      async refreshFree() {
        return { models: [], defaultModelId: "" };
      },
      async setFreeModelEnabled() {
        return { models: [], defaultModelId: "" };
      },
      async refreshOfficial() {
        return { models: [], defaultModelId: "" };
      },
      async queryOfficialBalance() {
        return {
          queriedAt: "2026-07-06T10:04:00.000Z",
          accountBalance: 0,
          accountBalanceYuan: 0,
          keyQuotaRemaining: 0,
          keyQuotaRemainingYuan: 0,
          quotaPerUnit: 10_000
        };
      },
      async saveOfficialToken() {
        return { models: [], defaultModelId: "" };
      },
      async clearOfficialToken() {
        return { models: [], defaultModelId: "" };
      },
      async saveSiteOfficialToken() {
        return { models: [], defaultModelId: "" };
      },
      async clearSiteOfficialToken() {
        return { models: [], defaultModelId: "" };
      },
      async refreshSiteOfficial() {
        return { models: [], defaultModelId: "" };
      },
      async querySiteOfficialQuota() {
        return {
          queriedAt: "2026-09-01T00:00:00.000Z",
          remaining: 0,
          used: 0,
          total: 0,
          unlimited: false
        };
      },
      async setSiteOfficialModelEnabled() {
        return { models: [], defaultModelId: "" };
      },
      async setOfficialModelEnabled() {
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
          testedAt: new Date().toISOString(),
          contextWindow: 272_000,
          maxTokens: 128_000
        };
      },
      async resolveCapacity(model) {
        return {
          modelId: model.id,
          contextWindow: 272_000,
          maxTokens: 128_000
        };
      },
      async listRemote() {
        return { models: [] };
      }
    },
    modelUsage: {
      async query() {
        return {
          generatedAt: new Date().toISOString(),
          totals: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 0,
            requestCount: 0
          },
          trendGranularity: "day",
          trend: [],
          models: [],
          modules: [],
          recentCalls: []
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
    longAgents: {
      async list() {
        return structuredClone(DEFAULT_LONG_AGENT_SETTINGS);
      },
      async save() {
        return structuredClone(DEFAULT_LONG_AGENT_SETTINGS);
      },
      async reset() {
        return structuredClone(DEFAULT_LONG_AGENT_SETTINGS);
      }
    },
    agentTeams: {
      async list() {
        return {
          enabledTeamIds: {},
          teams: [
            {
              id: "team_short_default",
              name: "默认短篇团队",
              workspaceType: "short" as const,
              settings: structuredClone(DEFAULT_AGENT_TEAM_SETTINGS)
            },
            {
              id: "team_script_default",
              name: "默认剧本团队",
              workspaceType: "script" as const,
              settings: structuredClone(DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS)
            },
            {
              id: "team_long_default",
              name: "默认长篇团队",
              workspaceType: "long" as const,
              settings: structuredClone(DEFAULT_LONG_AGENT_TEAM_SETTINGS)
            }
          ]
        };
      },
      async create() {
        return this.list();
      },
      async rename() {
        return this.list();
      },
      async delete() {
        return this.list();
      },
      async setEnabled() {
        return this.list();
      },
      async save() {
        return this.list();
      },
      async download() {
        return { status: "canceled" as const };
      },
      async install() {
        return { status: "canceled" as const };
      }
    },
    libraryAgents: {
      async list() {
        return structuredClone(DEFAULT_LIBRARY_AGENT_SETTINGS);
      },
      async save() {
        return structuredClone(DEFAULT_LIBRARY_AGENT_SETTINGS);
      },
      async reset() {
        return structuredClone(DEFAULT_LIBRARY_AGENT_SETTINGS);
      }
    },
    learningImitationSettings: {
      async list() {
        throw new Error(
          "Learning imitation settings are not used by conversation tests."
        );
      },
      async save() {
        throw new Error(
          "Learning imitation settings are not used by conversation tests."
        );
      },
      async reset() {
        throw new Error(
          "Learning imitation settings are not used by conversation tests."
        );
      }
    },
    longBookAnalysis: {
      async chooseSource() {
        throw new Error(
          "Long book analysis is not used by conversation tests."
        );
      },
      sources: {
        async list() {
          throw new Error(
            "Long book analysis is not used by conversation tests."
          );
        },
        async load() {
          throw new Error(
            "Long book analysis is not used by conversation tests."
          );
        }
      },
      presets: {
        async list() {
          throw new Error(
            "Long book analysis is not used by conversation tests."
          );
        },
        async save() {
          throw new Error(
            "Long book analysis is not used by conversation tests."
          );
        },
        async reset() {
          throw new Error(
            "Long book analysis is not used by conversation tests."
          );
        }
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
    appearance: {
      async list() {
        return {
          persisted: false,
          settings: createDefaultAppearanceSettings()
        };
      },
      async save(settings) {
        return { persisted: true, settings };
      },
      fonts: {
        async list() {
          return { fonts: [] };
        },
        async install() {
          return { status: "canceled" as const };
        },
        async remove() {
          throw new Error(
            "Appearance fonts are not used by conversation tests."
          );
        }
      }
    },
    generalSettings: {
      async list() {
        return {
          persisted: false,
          settings: {
            permissionMode: "request-approval" as const,
            autoApproveCrossStageOperations: false,
            autoSave: false,
            language: "auto" as const,
            showInMenuBar: true,
            showContextUsage: true,
            useNetworkProxy: false,
            workspacePaneLayout: "agent-editor" as const,
            defaultTextViewMode: "edit" as const
          }
        };
      },
      async save(settings) {
        return { persisted: true, settings };
      }
    },
    manuscript: {
      async exportLong() {
        throw new Error(
          "Long manuscript export is not used by conversation tests."
        );
      },
      async exportShort() {
        throw new Error("Manuscript export is not used by conversation tests.");
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
      const request = pending[index];
      if (request) request.resolve(payload);
      else queuedPromptResults.set(index, { status: "accepted", payload });
    },
    rejectPrompt(index, error) {
      const request = pending[index];
      if (request) request.reject(error);
      else queuedPromptResults.set(index, { status: "rejected", error });
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
  options(
    key: string
  ): Pick<
    UseAgentConversationOptions,
    | "initialPersistenceSnapshot"
    | "onPersistenceSnapshot"
    | "onPersistenceRemove"
  >;
  getItem(key: string): unknown | null;
  setItem(key: string, value: unknown): void;
  removeItem(key: string): void;
} {
  const values = new Map<string, unknown>();
  return {
    options(key) {
      return {
        initialPersistenceSnapshot: structuredClone(values.get(key)),
        onPersistenceSnapshot(snapshot) {
          values.set(key, structuredClone(snapshot));
        },
        onPersistenceRemove() {
          values.delete(key);
        }
      };
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function storedConversation(
  sessionId: string,
  updatedAt: string,
  content: string
): AgentConversationPersistenceRecord {
  return {
    sessionId,
    messages: [
      {
        id: `user-${sessionId}`,
        role: "user",
        content,
        createdAt: updatedAt,
        status: "completed"
      }
    ],
    draft: "",
    approvalMode: "request-approval",
    createdAt: updatedAt,
    updatedAt,
    temperature: 0.7
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
  vi.unstubAllGlobals();
});

export {
  DEFAULT_AGENT_TEAM_SETTINGS,
  DEFAULT_LIBRARY_AGENT_SETTINGS,
  DEFAULT_LONG_AGENT_SETTINGS,
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
  SCRIPT_WORKSPACE_TEXT_STAGE_IDS,
  SHORT_WORKSPACE_STAGE_IDS,
  SHORT_WORKSPACE_TEXT_STAGE_IDS,
  afterEach,
  createDefaultAppearanceSettings,
  createDefaultCreativePlotStages,
  createDeferredApi,
  createDraftCoordinatorDocument,
  createEditProposal,
  createEmptyLongMarkdownFileReference,
  createEnvelope,
  createMemoryStorage,
  createScriptWorkspaceDocuments,
  createShortWorkspaceContentRevision,
  createShortWorkspaceDocuments,
  describe,
  document,
  eventOptions,
  expect,
  it,
  longCharacterCoreProfileFileId,
  longCharacterFilePath,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  mergeAgentConversationPersistenceSnapshots,
  plotStages,
  reactive,
  runtime,
  shortStageTitle,
  storedConversation,
  useAgentConversation,
  vi
};
export type {
  AgentConversationPersistenceRecord,
  AgentConversationPersistenceSnapshot,
  AgentEditProposal,
  DeepWriteApi,
  ModelSettings,
  SessionAbortCommandPayload,
  SessionPromptAcceptedPayload,
  SessionPromptCommandPayload,
  UseAgentConversationOptions,
  WorkspaceDocument
};
