import {
  DEFAULT_LONG_AGENT_SETTINGS,
  LONG_BOOK_LINE_FILE_ID,
  LongWorkspaceIndexSnapshotSchema,
  createLongWorkspaceNavigationSnapshot,
  getDefaultLongAgentProfile,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterStateFileId,
  longChapterHandoffFileId,
  longWorldbuildingFileId,
  type LongAgentProfile,
  type LongBookSummary,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { createPinia, setActivePinia, storeToRefs } from "pinia";
import { ref, shallowRef, triggerRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useConversationStore } from "../stores/conversationStore";
import type {
  LongWorkspaceFileContext,
  LongWorkspaceRefreshStatus
} from "../stores/longWorkspaceStore";
import type { LongWorkspaceSelection } from "../types/longWorkspace";
import type { WorkspaceDocument } from "../types/workspace";
import type { LibraryAttachmentBuildResult } from "../utils/libraryAttachments";
import type { AgentConversationController } from "./useAgentConversation";
import {
  useLongWorkspacePresentationCoordinator,
  type LongWorkspacePresentationConversationState,
  type LongWorkspacePresentationCoordinatorOptions,
  type LongWorkspacePresentationEditorPort
} from "./useLongWorkspacePresentationCoordinator";

const NOW = "2026-08-14T08:00:00.000Z";
const BOOK_ID = "longbook_presentation";

function file(id: string, path: string) {
  return { id, path, updatedAt: NOW };
}

function chapterFiles(chapterCardId: string, slug: string) {
  return {
    chapterCardId,
    body: file(
      longChapterBodyFileId(chapterCardId),
      `long/chapters/${slug}/body.md`
    ),
    card: file(
      longChapterCardFileId(chapterCardId),
      `long/chapters/${slug}/card.md`
    ),
    characterState: file(
      longChapterCharacterStateFileId(chapterCardId),
      `long/chapters/${slug}/character-state.md`
    ),
    handoff: file(
      longChapterHandoffFileId(chapterCardId),
      `long/chapters/${slug}/handoff.md`
    ),
    commitId: null
  };
}

function workspaceIndex(): LongWorkspaceIndexSnapshot {
  return LongWorkspaceIndexSnapshotSchema.parse({
    schemaVersion: 1,
    bookId: BOOK_ID,
    updatedAt: NOW,
    bookLine: file(LONG_BOOK_LINE_FILE_ID, "long/plot/book-line.md"),
    worldbuilding: [
      {
        id: "world_rules",
        title: "世界规则",
        order: 1,
        format: "text",
        contentAuthority: "markdown",
        file: file(
          longWorldbuildingFileId("world_rules"),
          "long/worldbuilding/rules.md"
        )
      }
    ],
    characters: [],
    characterFiles: [],
    plot: {
      volumes: [{ id: "volume_one", title: "第一卷", order: 1, summary: "" }],
      arcs: [],
      chapterCards: [
        {
          id: "chapter_one",
          volumeId: "volume_one",
          primaryArcId: null,
          title: "第一章",
          narrativeOrder: 1
        },
        {
          id: "chapter_two",
          volumeId: "volume_one",
          primaryArcId: null,
          title: "第二章",
          narrativeOrder: 2
        }
      ],
      storyEvents: [],
      storyPlots: [],
      eventConnections: [],
      narrativePlacements: [],
      foreshadowing: []
    },
    chapters: [
      chapterFiles("chapter_one", "one"),
      chapterFiles("chapter_two", "two")
    ],
    ledger: {
      committedThroughChapterId: null,
      commits: []
    }
  });
}

function bookSummary(index: LongWorkspaceIndexSnapshot): LongBookSummary {
  return {
    schemaVersion: 1,
    kind: "deepwrite.long-book",
    id: index.bookId,
    title: "展示协调器测试",
    bookType: "long",
    genre: "测试",
    status: "editing",
    linkedMaterialIdsByKind: {
      character: [],
      gimmick: [],
      plot: ["material_plot"],
      draft: [],
      other: []
    },
    linkedSkillIdsByKind: {
      general: [],
      plot: [],
      style: ["skill_style"],
      other: []
    },
    createdAt: NOW,
    updatedAt: NOW,
    navigation: createLongWorkspaceNavigationSnapshot(index)
  };
}

function selection(
  root: LongWorkspaceSelection["root"] = "worldbuilding",
  patch: Partial<LongWorkspaceSelection> = {}
): LongWorkspaceSelection {
  return {
    key: `${root}:test`,
    root,
    title: "当前选择",
    breadcrumbs: ["当前选择"],
    files: [],
    preferredRole: "content",
    ...patch
  };
}

function document(
  id: string,
  patch: Partial<WorkspaceDocument> = {}
): WorkspaceDocument {
  return {
    id,
    domain: "creation",
    title: id,
    eyebrow: "测试",
    path: [id],
    content: "",
    ...patch
  };
}

function createHarness() {
  const index = workspaceIndex();
  const summary = bookSummary(index);
  const isLongWorkspaceActive = ref(true);
  const activeBookId = ref<string | null>(BOOK_ID);
  const activeBookSummary = shallowRef<LongBookSummary | null>(summary);
  const activeIndex = shallowRef<LongWorkspaceIndexSnapshot | null>(index);
  const activeSelection = shallowRef<LongWorkspaceSelection | null>(
    selection()
  );
  const fileContext = shallowRef<LongWorkspaceFileContext | null>(null);
  const contextReady = ref(false);
  const agentSettings = shallowRef(
    structuredClone(DEFAULT_LONG_AGENT_SETTINGS)
  );
  const refreshStatus = shallowRef<LongWorkspaceRefreshStatus | null>(null);
  const sendPreflightPending = ref(false);
  const proposalApprovalPending = ref(false);
  const documents = shallowRef<readonly WorkspaceDocument[]>([]);
  const controllerMap = new Map<
    string,
    LongWorkspacePresentationConversationState
  >();
  const scopeMap = new Map<string, string>();
  const controllers =
    shallowRef<ReadonlyMap<string, LongWorkspacePresentationConversationState>>(
      controllerMap
    );
  const scopesByKey = shallowRef<ReadonlyMap<string, string>>(scopeMap);
  const acceptingDocumentIds = ref(new Set<string>());
  const acceptingWorkspaceIds = ref(new Set<string>());
  const savingDocumentIds = ref(new Set<string>());

  const options: LongWorkspacePresentationCoordinatorOptions = {
    isLongWorkspaceActive,
    long: {
      activeBookId,
      activeBookSummary,
      workspaceIndex: activeIndex,
      selection: activeSelection,
      fileContext,
      contextReady,
      agentSettings,
      refreshStatus,
      sendPreflightPending,
      proposalApprovalPending
    },
    catalog: { documents },
    conversations: { controllers, scopesByKey },
    edits: {
      acceptingDocumentIds,
      acceptingWorkspaceIds,
      savingDocumentIds
    }
  };
  const coordinator = useLongWorkspacePresentationCoordinator(options);
  return {
    coordinator,
    options,
    index,
    summary,
    activeBookId,
    activeBookSummary,
    activeIndex,
    activeSelection,
    fileContext,
    contextReady,
    refreshStatus,
    sendPreflightPending,
    proposalApprovalPending,
    documents,
    controllers,
    scopesByKey,
    controllerMap,
    scopeMap,
    acceptingDocumentIds,
    acceptingWorkspaceIds,
    savingDocumentIds
  };
}

describe("useLongWorkspacePresentationCoordinator", () => {
  it("keeps late-bound editor presentation conservative", () => {
    const { coordinator } = createHarness();
    expect(coordinator.longEditorLocked.value).toBe(false);
    expect(coordinator.editorLocked.value).toBe(false);
    expect(coordinator.editorLockedLabel.value).toBeUndefined();
    expect(coordinator.editorSaving.value).toBe(false);

    const activeDocument = ref(document("document_one"));
    const editor: LongWorkspacePresentationEditorPort = {
      selectedResourceId: ref("document_one"),
      activeDocument,
      activeAgentDocument: activeDocument,
      promptDocumentForResourceId: () => activeDocument.value
    };
    coordinator.bindEditor(editor);
    coordinator.bindEditor(editor);
    expect(() =>
      coordinator.bindEditor({ ...editor, selectedResourceId: ref("other") })
    ).toThrow("editor port is already bound");
  });

  it("builds a guarded runtime context and enables only the eligible chapter writer", () => {
    const { coordinator, activeSelection, fileContext, contextReady, index } =
      createHarness();
    expect(coordinator.activeLongRuntimeContext.value).toBeNull();

    const worldCategory = index.worldbuilding[0];
    if (!worldCategory || worldCategory.format !== "text") {
      throw new Error("Expected a text worldbuilding category.");
    }
    const worldFile = worldCategory.file;
    activeSelection.value = selection("worldbuilding", {
      files: [{ role: "content", label: "世界规则", file: worldFile }]
    });
    fileContext.value = {
      bookId: "longbook_stale",
      fileId: worldFile.id
    };
    contextReady.value = true;
    expect(coordinator.activeLongRuntimeContext.value).toMatchObject({
      bookId: BOOK_ID,
      activeRoot: "worldbuilding",
      activeAgentId: "long"
    });
    expect(
      coordinator.activeLongRuntimeContext.value?.activeFileId
    ).toBeUndefined();
    expect(
      coordinator.activeLongRuntimeContext.value?.worldbuildingDirectory
    ).toBeDefined();

    fileContext.value = {
      bookId: BOOK_ID,
      fileId: worldFile.id
    };
    expect(coordinator.activeLongRuntimeContext.value).toMatchObject({
      activeFileId: worldFile.id
    });

    activeSelection.value = selection("character_design", {
      files: [{ role: "overview", label: "概览", file: worldFile }]
    });
    expect(coordinator.activeLongRuntimeContext.value).toMatchObject({
      activeRoot: "character_design",
      activeAgentId: "long"
    });
    expect(
      coordinator.activeLongRuntimeContext.value?.worldbuildingDirectory
    ).toBeDefined();

    activeSelection.value = selection("plot_design", {
      files: [{ role: "content", label: "全书故事线", file: worldFile }]
    });
    expect(coordinator.activeLongRuntimeContext.value).toMatchObject({
      activeRoot: "plot_design",
      activeAgentId: "long"
    });
    expect(
      coordinator.activeLongRuntimeContext.value?.worldbuildingDirectory
    ).toBeDefined();

    activeSelection.value = selection("draft", {
      chapterCardId: "chapter_one",
      preferredRole: "body"
    });
    expect(coordinator.activeLongChapterWriterEnabled.value).toBe(true);
    expect(coordinator.activeLongAgentProfile.value?.id).toBe("long");
    expect(
      coordinator.activeLongRuntimeContext.value?.worldbuildingDirectory
    ).toBeDefined();

    activeSelection.value = selection("continuity_ledger");
    expect(coordinator.activeLongAgentProfile.value?.id).toBe("long");
    expect(
      coordinator.activeLongRuntimeContext.value?.worldbuildingDirectory
    ).toBeDefined();
  });

  it("filters readable attachments and preserves Catalog document order", () => {
    const { coordinator, summary, documents } = createHarness();
    const profile: LongAgentProfile = {
      ...getDefaultLongAgentProfile("long"),
      readAccess: {
        ...getDefaultLongAgentProfile("long").readAccess,
        materialKinds: ["plot"],
        skillKinds: ["style"]
      }
    };
    const attachments: LibraryAttachmentBuildResult = {
      bookId: BOOK_ID,
      attachedSkills: [
        {
          id: "skill_style_entry",
          title: "文风",
          source: "attached-skill",
          kind: "style",
          content: "文风内容"
        },
        {
          id: "skill_general_entry",
          title: "通用",
          source: "attached-skill",
          kind: "general",
          content: "通用内容"
        }
      ],
      attachedMaterials: [
        {
          id: "material_plot_entry",
          title: "剧情",
          source: "attached-material",
          kind: "plot",
          content: "剧情内容"
        },
        {
          id: "material_character_entry",
          title: "人物",
          source: "attached-material",
          kind: "character",
          content: "人物内容"
        }
      ],
      diagnostics: [],
      omittedAttachments: [],
      complete: true
    };
    expect(
      coordinator.filterLongReadableAttachmentsForProfile(attachments, profile)
    ).toEqual({
      attachedSkills: [attachments.attachedSkills[0]],
      attachedMaterials: [attachments.attachedMaterials[0]]
    });
    expect(
      coordinator.buildLongReadableAttachmentsForProfile(summary, null, profile)
    ).toEqual({
      attachedSkills: [],
      attachedMaterials: []
    });

    documents.value = [
      document("unbound", { domain: "skill", libraryId: "skill_other" }),
      document("material", {
        domain: "material",
        libraryId: "material_plot"
      }),
      document("skill", { domain: "skill", libraryId: "skill_style" })
    ];
    expect(
      coordinator
        .longCatalogContextDocuments(summary, profile)
        .map(({ id }) => id)
    ).toEqual(["material", "skill"]);
  });

  it("loads bound resource documents only in their configured stage", () => {
    const { coordinator, summary, documents, activeSelection } =
      createHarness();
    summary.linkedResourceStageScopes = {
      materials: { material_plot: ["plot_design"] },
      skills: { skill_style: ["draft"] }
    };
    documents.value = [
      document("material", {
        domain: "material",
        libraryId: "material_plot"
      }),
      document("skill", { domain: "skill", libraryId: "skill_style" })
    ];
    const profile = getDefaultLongAgentProfile("long");

    expect(coordinator.longCatalogContextDocuments(summary, profile)).toEqual(
      []
    );
    activeSelection.value = selection("plot_design");
    expect(
      coordinator
        .longCatalogContextDocuments(summary, profile)
        .map(({ id }) => id)
    ).toEqual(["material"]);
    activeSelection.value = selection("draft");
    expect(
      coordinator
        .longCatalogContextDocuments(summary, profile)
        .map(({ id }) => id)
    ).toEqual(["skill"]);
  });

  it("does not expose the removed rollback presentation state", () => {
    const { coordinator } = createHarness();
    expect(coordinator).not.toHaveProperty("latestLongLedgerCommit");
    expect(coordinator).not.toHaveProperty("longRollbackCommit");
    expect(coordinator).not.toHaveProperty("longRollbackChapterTitle");
  });

  it("reacts to stable-map registration and preserves lock reason priority", () => {
    const {
      coordinator,
      controllers,
      scopesByKey,
      controllerMap,
      scopeMap,
      refreshStatus,
      sendPreflightPending,
      proposalApprovalPending
    } = createHarness();
    expect(coordinator.longEditorLocked.value).toBe(false);

    const busy = ref(true);
    const pendingEditReview = ref(false);
    const controller = {
      isBusy: busy,
      hasPendingEditReview: pendingEditReview
    };
    controllerMap.set("conversation", controller);
    scopeMap.set("conversation", `long:${BOOK_ID}`);
    triggerRef(controllers);
    triggerRef(scopesByKey);
    expect(coordinator.agentRunScopeHasWriteBarrier(`long:${BOOK_ID}`)).toBe(
      true
    );
    expect(coordinator.longEditorLocked.value).toBe(false);

    busy.value = false;
    pendingEditReview.value = true;
    expect(
      coordinator.agentRunScopeHasPendingEditReview(`long:${BOOK_ID}`)
    ).toBe(true);
    expect(coordinator.agentRunScopeHasWriteBarrier("general")).toBe(false);

    proposalApprovalPending.value = true;
    expect(coordinator.longEditorLockedReason.value).toBe(
      "正在应用长篇提案，编辑暂时锁定"
    );
    sendPreflightPending.value = true;
    expect(coordinator.longEditorLockedReason.value).toBe(
      "正在保存并准备发送，编辑暂时锁定"
    );
    refreshStatus.value = {
      bookId: BOOK_ID,
      requestId: 1,
      pending: true,
      error: null
    };
    expect(coordinator.longEditorLockedReason.value).toBe(
      "正在同步长篇工作区，编辑暂时锁定"
    );
  });

  it("releases a pending-review barrier when the conversation store removes its controller", () => {
    setActivePinia(createPinia());
    const store = useConversationStore();
    const { controllers, scopesByKey } = storeToRefs(store);
    const pendingReviewController = {
      sessionId: ref("pending-review"),
      messages: ref([]),
      isBusy: ref(false),
      hasPendingEditReview: ref(true),
      dispose: vi.fn()
    } as unknown as AgentConversationController;
    store.registerController(
      "pending-review",
      `long:${BOOK_ID}`,
      pendingReviewController,
      {
        applyPreferences: false
      }
    );

    const harness = createHarness();
    const coordinator = useLongWorkspacePresentationCoordinator({
      ...harness.options,
      conversations: { controllers, scopesByKey }
    });
    expect(coordinator.agentRunScopeHasWriteBarrier(`long:${BOOK_ID}`)).toBe(
      true
    );

    expect(store.removeController("pending-review")).toBe(
      pendingReviewController
    );
    expect(controllers.value.has("pending-review")).toBe(false);
    expect(scopesByKey.value.has("pending-review")).toBe(false);
    expect(coordinator.agentRunScopeHasWriteBarrier(`long:${BOOK_ID}`)).toBe(
      false
    );
    expect(pendingReviewController.dispose).toHaveBeenCalledOnce();
  });

  it("binds generic editor locks without changing their existing semantics", () => {
    const {
      coordinator,
      controllers,
      scopesByKey,
      controllerMap,
      scopeMap,
      acceptingDocumentIds,
      savingDocumentIds
    } = createHarness();
    const activeDocument = ref(
      document("draft_document", {
        workspaceId: "short_book",
        workspaceType: "short"
      })
    );
    const selectedDocument = ref(activeDocument.value);
    coordinator.bindEditor({
      selectedResourceId: ref("selected"),
      activeDocument,
      activeAgentDocument: activeDocument,
      promptDocumentForResourceId: () => selectedDocument.value
    });

    const busy = ref(true);
    controllerMap.set("short", {
      isBusy: busy,
      hasPendingEditReview: ref(false)
    });
    scopeMap.set("short", "book:short_book");
    triggerRef(controllers);
    triggerRef(scopesByKey);
    expect(coordinator.editorLocked.value).toBe(true);

    busy.value = false;
    acceptingDocumentIds.value = new Set([activeDocument.value.id]);
    expect(coordinator.editorLockedLabel.value).toBe(
      "正在接受并保存智能体修改"
    );
    savingDocumentIds.value = new Set([activeDocument.value.id]);
    expect(coordinator.editorSaving.value).toBe(true);
  });
});
