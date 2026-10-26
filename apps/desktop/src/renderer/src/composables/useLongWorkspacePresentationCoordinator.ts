import { createScopedTranslator } from "../i18n";
import {
  buildLongLibraryAttachmentsForProfile,
  filterLongReadableAttachmentsForProfile,
  buildLongReadableAttachmentsForProfile,
  longCatalogContextDocuments
} from "../utils/longLibraryAttachments";
import {
  getDefaultLongAgentProfile,
  resolveLongAgentIdForRoot,
  type CatalogSnapshot,
  type LongAgentProfile,
  type LongAgentSettings,
  type LongBookSummary,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceRuntimeContext
} from "@deepwrite/contracts";
import { computed, shallowRef, type ComputedRef, type Ref } from "vue";
import type {
  LongWorkspaceFileContext,
  LongWorkspaceRefreshStatus
} from "../stores/longWorkspaceStore";
import type { LongWorkspaceSelection } from "../types/longWorkspace";
import { nextWritableLongChapterId } from "../types/longWorkspace";
import type { WorkspaceDocument } from "../types/workspace";
import { agentRunScopeForDocument } from "../utils/agentRunPreferences";
import { type LibraryAttachmentBuildResult } from "../utils/libraryAttachments";
import { buildLongWorldbuildingDirectorySnapshot } from "../utils/longWorldbuildingAgentContext";

const t = createScopedTranslator(
  "workspace.longWorkspacePresentationCoordinator"
);

type LongReadableAttachments = Pick<
  LibraryAttachmentBuildResult,
  "attachedSkills" | "attachedMaterials"
>;

export interface LongWorkspacePresentationEditorPort {
  readonly selectedResourceId: Readonly<Ref<string>>;
  readonly activeDocument: Readonly<Ref<WorkspaceDocument>>;
  readonly activeAgentDocument: Readonly<Ref<WorkspaceDocument>>;
  promptDocumentForResourceId(
    resourceId: string
  ): WorkspaceDocument | undefined;
}

export interface LongWorkspacePresentationConversationState {
  readonly isBusy: Readonly<Ref<boolean>>;
  readonly hasPendingEditReview: Readonly<Ref<boolean>>;
}

export interface LongWorkspacePresentationCoordinatorOptions {
  isLongWorkspaceActive: Readonly<Ref<boolean>>;
  long: {
    activeBookId: Readonly<Ref<string | null>>;
    activeBookSummary: Readonly<Ref<LongBookSummary | null>>;
    workspaceIndex: Readonly<Ref<LongWorkspaceIndexSnapshot | null>>;
    selection: Readonly<Ref<LongWorkspaceSelection | null>>;
    fileContext: Readonly<Ref<LongWorkspaceFileContext | null>>;
    contextReady: Readonly<Ref<boolean>>;
    agentSettings: Readonly<Ref<LongAgentSettings>>;
    refreshStatus: Readonly<Ref<LongWorkspaceRefreshStatus | null>>;
    sendPreflightPending: Readonly<Ref<boolean>>;
    proposalApprovalPending: Readonly<Ref<boolean>>;
  };
  catalog: {
    documents: Readonly<Ref<readonly WorkspaceDocument[]>>;
  };
  conversations: {
    /**
     * Keep these as refs even though their Map identities are stable. The
     * store uses triggerRef after registration/removal, which must invalidate
     * the aggregated scope state below.
     */
    controllers: Readonly<
      Ref<ReadonlyMap<string, LongWorkspacePresentationConversationState>>
    >;
    scopesByKey: Readonly<Ref<ReadonlyMap<string, string>>>;
  };
  edits: {
    acceptingDocumentIds: Readonly<Ref<Set<string>>>;
    acceptingWorkspaceIds: Readonly<Ref<Set<string>>>;
    savingDocumentIds: Readonly<Ref<Set<string>>>;
  };
}

export interface LongWorkspacePresentationCoordinator {
  activeLongRoot: ComputedRef<LongWorkspaceRuntimeContext["activeRoot"]>;
  activeLongChapterWriterEnabled: ComputedRef<boolean>;
  activeLongAgentProfile: ComputedRef<LongAgentProfile | null>;
  activeLongRuntimeContext: ComputedRef<LongWorkspaceRuntimeContext | null>;
  activeLongAgentRunScope: ComputedRef<string | null>;
  longEditorLocked: ComputedRef<boolean>;
  longEditorLockedReason: ComputedRef<string>;
  editorLocked: ComputedRef<boolean>;
  editorLockedLabel: ComputedRef<string | undefined>;
  editorSaving: ComputedRef<boolean>;
  buildLongLibraryAttachmentsForProfile(
    summary: LongBookSummary,
    snapshot: CatalogSnapshot,
    profile: LongAgentProfile
  ): LibraryAttachmentBuildResult;
  filterLongReadableAttachmentsForProfile(
    attachments: LibraryAttachmentBuildResult,
    profile: LongAgentProfile
  ): LongReadableAttachments;
  buildLongReadableAttachmentsForProfile(
    summary: LongBookSummary,
    snapshot: CatalogSnapshot | null,
    profile: LongAgentProfile
  ): LongReadableAttachments;
  longCatalogContextDocuments(
    summary: LongBookSummary,
    profile: LongAgentProfile
  ): WorkspaceDocument[];
  agentRunScopeHasWriteBarrier(scope: string): boolean;
  agentRunScopeIsBusy(scope: string): boolean;
  agentRunScopeHasPendingEditReview(scope: string): boolean;
  bindEditor(port: LongWorkspacePresentationEditorPort): void;
}

interface ConversationScopeState {
  busy: boolean;
  pendingEditReview: boolean;
}

/**
 * Owns long-workspace display derivations and the shared editor write barrier.
 * Generic editor sources bind after this coordinator is assembled in
 * WorkspaceShell.
 */
export function useLongWorkspacePresentationCoordinator(
  options: LongWorkspacePresentationCoordinatorOptions
): LongWorkspacePresentationCoordinator {
  const editorPort = shallowRef<LongWorkspacePresentationEditorPort | null>(
    null
  );

  function bindEditor(port: LongWorkspacePresentationEditorPort): void {
    if (editorPort.value && editorPort.value !== port) {
      throw new Error(
        "Long workspace presentation editor port is already bound."
      );
    }
    editorPort.value = port;
  }

  const activeLongRoot = computed(
    () => options.long.selection.value?.root ?? "worldbuilding"
  );

  const chapterPresentation = computed(() => {
    const index = options.long.workspaceIndex.value;
    const byCardId = new Map<
      string,
      LongWorkspaceIndexSnapshot["chapters"][number]
    >();
    for (const chapter of index?.chapters ?? []) {
      byCardId.set(chapter.chapterCardId, chapter);
    }
    return {
      byCardId,
      nextWritableChapterCardId: index
        ? nextWritableLongChapterId(index)
        : undefined
    };
  });

  const activeLongChapterWriterEnabled = computed(() => {
    const chapterCardId = options.long.selection.value?.chapterCardId;
    const chapter = chapterCardId
      ? chapterPresentation.value.byCardId.get(chapterCardId)
      : undefined;
    return Boolean(
      activeLongRoot.value === "draft" &&
      chapterCardId &&
      chapter &&
      (chapter.commitId !== null ||
        chapter.bodyStatus === "written" ||
        chapterPresentation.value.nextWritableChapterCardId === chapterCardId)
    );
  });

  const activeLongAgentProfile = computed<LongAgentProfile | null>(() => {
    if (!options.long.activeBookSummary.value) return null;
    const agentId = resolveLongAgentIdForRoot(activeLongRoot.value);
    return (
      options.long.agentSettings.value.agents.find(
        (profile) => profile.id === agentId
      ) ?? getDefaultLongAgentProfile(agentId)
    );
  });

  const activeLongRuntimeContext = computed<LongWorkspaceRuntimeContext | null>(
    () => {
      const summary = options.long.activeBookSummary.value;
      const workspaceIndex = options.long.workspaceIndex.value;
      const profile = activeLongAgentProfile.value;
      if (
        !summary ||
        !workspaceIndex ||
        !profile ||
        !options.long.contextReady.value
      ) {
        return null;
      }
      const selection = options.long.selection.value;
      const candidateFileContext = options.long.fileContext.value;
      const fileContext =
        candidateFileContext?.bookId === summary.id &&
        selection?.files.some(
          ({ file }) => file.id === candidateFileContext.fileId
        )
          ? candidateFileContext
          : null;
      return {
        bookId: summary.id,
        title: summary.title,
        activeRoot: activeLongRoot.value,
        activeAgentId: profile.id,
        ...(fileContext
          ? {
              activeFileId: fileContext.fileId
            }
          : {}),
        ...(selection?.chapterCardId
          ? { activeChapterCardId: selection.chapterCardId }
          : {}),
        navigation: summary.navigation,
        worldbuildingDirectory: buildLongWorldbuildingDirectorySnapshot(
          workspaceIndex.worldbuilding
        )
      };
    }
  );

  const conversationStateByScope = computed(() => {
    // Reading both refs is intentional: their Maps retain identity and the
    // store publishes topology changes with triggerRef.
    const controllers = options.conversations.controllers.value;
    const scopesByKey = options.conversations.scopesByKey.value;
    const result = new Map<string, ConversationScopeState>();
    for (const [key, conversation] of controllers) {
      const scope = scopesByKey.get(key);
      if (!scope) continue;
      const previous = result.get(scope);
      result.set(scope, {
        busy: Boolean(previous?.busy || conversation.isBusy.value),
        pendingEditReview: Boolean(
          previous?.pendingEditReview || conversation.hasPendingEditReview.value
        )
      });
    }
    return result;
  });

  function agentRunScopeHasWriteBarrier(scope: string): boolean {
    if (scope === "general") return false;
    const state = conversationStateByScope.value.get(scope);
    return Boolean(state?.busy || state?.pendingEditReview);
  }

  function agentRunScopeIsBusy(scope: string): boolean {
    return conversationStateByScope.value.get(scope)?.busy ?? false;
  }

  function agentRunScopeHasPendingEditReview(scope: string): boolean {
    return (
      conversationStateByScope.value.get(scope)?.pendingEditReview ?? false
    );
  }

  const activeLongAgentRunScope = computed(() => {
    const summary = options.long.activeBookSummary.value;
    return summary ? `long:${summary.id}` : null;
  });

  const longEditorLocked = computed(() => {
    const scope = activeLongAgentRunScope.value;
    const workspaceId = scope;
    return (
      Boolean(options.long.refreshStatus.value?.pending) ||
      options.long.sendPreflightPending.value ||
      options.long.proposalApprovalPending.value ||
      Boolean(
        workspaceId &&
        options.edits.acceptingWorkspaceIds.value.has(workspaceId)
      )
    );
  });

  const longEditorLockedReason = computed(() => {
    if (options.long.refreshStatus.value?.pending) {
      return t("syncingTheNovelWorkspaceEditingIsTemporarilyLocked");
    }
    if (options.long.sendPreflightPending.value) {
      return t("savingAndPreparingToSendEditingIsTemporarilyLocked");
    }
    const workspaceId = activeLongAgentRunScope.value;
    if (
      options.long.proposalApprovalPending.value ||
      Boolean(
        workspaceId &&
        options.edits.acceptingWorkspaceIds.value.has(workspaceId)
      )
    ) {
      return t("applyingANovelProposalEditingIsTemporarilyLocked");
    }
    return t("applyingNovelEditsEditingIsTemporarilyLocked");
  });

  /**
   * Scopes whose book-level accepting flag comes from a text edit. Text
   * accepts also mark their target document, so only that document locks;
   * structural accepts mark the scope alone and still lock the whole book.
   */
  const textAcceptScopes = computed(() => {
    const documentIds = options.edits.acceptingDocumentIds.value;
    const scopes = new Set<string>();
    if (documentIds.size === 0) return scopes;
    for (const document of options.catalog.documents.value) {
      if (!documentIds.has(document.id)) continue;
      scopes.add(agentRunScopeForDocument(document));
      if (document.workspaceId) scopes.add(document.workspaceId);
    }
    return scopes;
  });

  function scopeHasStructuralAccept(scope: string | undefined): boolean {
    return (
      scope !== undefined &&
      options.edits.acceptingWorkspaceIds.value.has(scope) &&
      !textAcceptScopes.value.has(scope)
    );
  }

  // Running agents and pending reviews never lock editing: proposals check
  // their base revision when accepted (docs/智能体运行中编辑正文设计.md).
  const editorLocked = computed(() => {
    const editor = editorPort.value;
    if (!editor) return false;
    const activeDocument = editor.activeDocument.value;
    return (
      options.edits.acceptingDocumentIds.value.has(activeDocument.id) ||
      scopeHasStructuralAccept(
        agentRunScopeForDocument(editor.activeAgentDocument.value)
      ) ||
      scopeHasStructuralAccept(activeDocument.workspaceId)
    );
  });

  const editorLockedLabel = computed(() =>
    editorLocked.value ? t("acceptingAndSavingAgentEdits") : undefined
  );

  const editorSaving = computed(() => {
    const activeDocument = editorPort.value?.activeDocument.value;
    return Boolean(
      activeDocument &&
      options.edits.savingDocumentIds.value.has(activeDocument.id)
    );
  });

  return {
    activeLongRoot,
    activeLongChapterWriterEnabled,
    activeLongAgentProfile,
    activeLongRuntimeContext,
    activeLongAgentRunScope,
    longEditorLocked,
    longEditorLockedReason,
    editorLocked,
    editorLockedLabel,
    editorSaving,
    buildLongLibraryAttachmentsForProfile,
    filterLongReadableAttachmentsForProfile,
    buildLongReadableAttachmentsForProfile,
    longCatalogContextDocuments: (summary, profile) =>
      longCatalogContextDocuments(
        summary,
        profile,
        options.catalog.documents.value
      ),
    agentRunScopeHasWriteBarrier,
    agentRunScopeIsBusy,
    agentRunScopeHasPendingEditReview,
    bindEditor
  };
}
