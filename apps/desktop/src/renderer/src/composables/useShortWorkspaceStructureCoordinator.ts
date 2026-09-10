import { hasBusyBookConversation } from "../utils/bookConversationKey";
import type {
  Book,
  CharacterStructureMutation,
  DeepWriteApi,
  PlotStructureMutation
} from "@deepwrite/contracts";
import { computed, nextTick, ref, type Ref, type ShallowRef } from "vue";
import type {
  CatalogWorkspaceProjection,
  DraftDirectoryProjection
} from "../data/catalogWorkspace";
import type {
  EditorDraftState,
  ResourceTreeNode,
  ResourceTreeSection,
  WorkspaceDocument
} from "../types/workspace";
import { agentRunScopeForDocument } from "../utils/agentRunPreferences";
import { suggestedDraftSectionTitle } from "../utils/draftFileTitles";

type DraftFileKind = "body" | "character-state";

export interface ShortStructureMutationCompletion {
  succeed(): void;
  fail(): void;
}

export interface CharacterItemDialogState {
  mode: "create" | "rename" | "delete";
  bookId: string;
  itemId?: string;
  title: string;
}

export interface PendingExpertSectionDeletion {
  workspaceId: string;
  draftDirectoryId: string;
  sectionId: string;
  sectionTitle: string;
  hasContent: boolean;
  workspaceType: "short" | "script";
}

export interface PendingExpertSectionCreation {
  draftDirectoryId: string;
  workspaceType: "short" | "script";
  suggestedTitle: string;
}

interface ShortWorkspaceConversationHandle {
  isBusy: Readonly<Ref<boolean>>;
}

export interface ShortWorkspaceStructureNotifications {
  error(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
}

export interface ShortWorkspaceStructureState {
  documents: ShallowRef<WorkspaceDocument[]>;
  drafts: ShallowRef<Record<string, EditorDraftState>>;
  mutationPending: Ref<boolean>;
  selectedResourceId: Ref<string>;
  activeCreationResourceId: Ref<string>;
  selectedExpertSectionIds: Ref<Record<string, string>>;
  selectedDraftFileKinds: Ref<Record<string, DraftFileKind>>;
  savingDocumentIds: Readonly<Ref<ReadonlySet<string>>>;
  acceptingDocumentIds: Readonly<Ref<ReadonlySet<string>>>;
  acceptingWorkspaceIds: Readonly<Ref<ReadonlySet<string>>>;
}

export interface ShortWorkspaceStructureCatalogPort {
  projection: Readonly<Ref<CatalogWorkspaceProjection | null>>;
  findBook(bookId: string): Book | undefined;
  refresh(): Promise<boolean>;
  isConflict(error: unknown): boolean;
}

export interface ShortWorkspaceStructureSavePort {
  conflict: Readonly<Ref<{ documentId: string } | null>>;
  drain(): Promise<void>;
  cancel(documentId: string): void;
  persist(
    payload: { id: string; title: string; content: string },
    announceSuccess: boolean
  ): Promise<boolean>;
}

export interface ShortWorkspaceStructureResourcePort {
  sections: Readonly<Ref<readonly ResourceTreeSection[]>>;
  activeDocument: Readonly<Ref<WorkspaceDocument>>;
  activeCharacterItemTabs: Readonly<
    Ref<readonly { id: string; title: string }[]>
  >;
  activeExpertSectionId: Readonly<Ref<string | undefined>>;
  documentForResourceId(resourceId: string): WorkspaceDocument | undefined;
  resourceIdForDocumentId(documentId: string): string | undefined;
  resourceNode(resourceId: string): ResourceTreeNode | undefined;
  draftDirectoryForResourceId(
    resourceId: string
  ): DraftDirectoryProjection | undefined;
  draftFileDocument(
    directory: DraftDirectoryProjection,
    sectionId: string,
    fileKind: DraftFileKind
  ): WorkspaceDocument | undefined;
  ensureDocumentLoaded(document: WorkspaceDocument): Promise<WorkspaceDocument>;
  liveDocument(document: WorkspaceDocument): WorkspaceDocument;
  selectResource(node: ResourceTreeNode): Promise<unknown>;
  revealCatalogBook(projectId: string): Promise<void>;
}

export interface ShortWorkspaceStructureConversationPort {
  forKey(key: string, scope: string): ShortWorkspaceConversationHandle;
  entries(): Iterable<readonly [string, ShortWorkspaceConversationHandle]>;
  hasWriteBarrier(scope: string): boolean;
  remove(key: string, options?: { clearPersistence?: boolean }): void;
}

export interface ShortWorkspaceStructureCoordinatorOptions {
  api(): DeepWriteApi["catalog"] | undefined;
  state: ShortWorkspaceStructureState;
  catalog: ShortWorkspaceStructureCatalogPort;
  saves: ShortWorkspaceStructureSavePort;
  resources: ShortWorkspaceStructureResourcePort;
  conversations: ShortWorkspaceStructureConversationPort;
  refreshWorkspaceDirectory(): Promise<void>;
  notifications: ShortWorkspaceStructureNotifications;
}

interface WorkspaceMutationContext {
  bookId: string;
  epoch: number;
}

/**
 * Owns short/script structure transactions and their modal state. Mutations are
 * serialized per book so every command can re-read the authoritative project
 * revision after earlier saves or structure changes have settled.
 */
export function useShortWorkspaceStructureCoordinator(
  options: ShortWorkspaceStructureCoordinatorOptions
) {
  const { catalog, conversations, notifications, resources, saves, state } =
    options;
  const plotStructureBookId = ref<string | null>(null);
  const characterItemDialog = ref<CharacterItemDialogState | null>(null);
  const pendingExpertSectionDeletion = ref<PendingExpertSectionDeletion | null>(
    null
  );
  const pendingExpertSectionCreation = ref<PendingExpertSectionCreation | null>(
    null
  );
  const plotStructureBook = computed(() =>
    plotStructureBookId.value
      ? (catalog.findBook(plotStructureBookId.value) ?? null)
      : null
  );

  const workspaceMutationTails = new Map<string, Promise<void>>();
  const workspaceMutationEpochs = new Map<string, number>();
  let ownedPendingCount = 0;
  let characterSelectionEpoch = 0;
  let plotDialogRequestEpoch = 0;
  let disposed = false;
  let disposePromise: Promise<void> | null = null;

  function legacyDraftSectionConversationKeys(
    workspaceId: string,
    sectionId: string
  ): string[] {
    const suffix = encodeURIComponent(sectionId);
    return [
      `${workspaceId}:expert_draft_coordinator:${suffix}`,
      `${workspaceId}:expert_section_writer:${suffix}`
    ];
  }

  function workspaceEpoch(bookId: string): number {
    const epoch = (workspaceMutationEpochs.get(bookId) ?? 0) + 1;
    workspaceMutationEpochs.set(bookId, epoch);
    return epoch;
  }

  function canPublish(context: WorkspaceMutationContext): boolean {
    return (
      !disposed && workspaceMutationEpochs.get(context.bookId) === context.epoch
    );
  }

  function enqueueWorkspaceMutation(
    bookId: string,
    task: (context: WorkspaceMutationContext) => Promise<void>
  ): Promise<void> | null {
    if (disposed) return null;
    // A foreign catalog transaction owns the shared flag. Calls already queued
    // by this coordinator may still join their per-workspace tail.
    if (state.mutationPending.value && ownedPendingCount === 0) return null;

    const context: WorkspaceMutationContext = {
      bookId,
      epoch: workspaceEpoch(bookId)
    };
    const predecessor = workspaceMutationTails.get(bookId) ?? Promise.resolve();
    ownedPendingCount += 1;
    state.mutationPending.value = true;

    const operation = predecessor
      .catch(() => undefined)
      .then(async () => {
        if (disposed) return;
        await task(context);
      });
    const tail = operation.then(
      () => undefined,
      () => undefined
    );
    workspaceMutationTails.set(bookId, tail);
    void tail.finally(() => {
      if (workspaceMutationTails.get(bookId) === tail) {
        workspaceMutationTails.delete(bookId);
      }
      ownedPendingCount = Math.max(0, ownedPendingCount - 1);
      if (ownedPendingCount === 0) state.mutationPending.value = false;
    });
    return operation;
  }

  async function drain(): Promise<void> {
    while (workspaceMutationTails.size > 0) {
      await Promise.allSettled([...workspaceMutationTails.values()]);
    }
  }

  function expertDraftMutationBlocked(source: WorkspaceDocument): boolean {
    return (
      state.savingDocumentIds.value.has(source.id) ||
      state.acceptingDocumentIds.value.has(source.id) ||
      Boolean(
        source.workspaceId &&
        (state.acceptingWorkspaceIds.value.has(source.workspaceId) ||
          hasBusyBookConversation(conversations.entries(), source.workspaceId))
      )
    );
  }

  async function prepareBookStructureMutation(
    bookId: string
  ): Promise<boolean> {
    await saves.drain();
    if (disposed) return false;
    const scopedDocuments = state.documents.value.filter(
      (document) => document.workspaceId === bookId
    );
    const scope = scopedDocuments[0]
      ? agentRunScopeForDocument(scopedDocuments[0])
      : `book:${bookId}`;

    for (const agentId of [
      "character_design",
      "plot_design",
      "expert_draft_coordinator"
    ] as const) {
      conversations.forKey(`${bookId}:${agentId}`, scope);
    }
    for (const sectionId of new Set(
      scopedDocuments.flatMap((document) =>
        document.expertSectionId ? [document.expertSectionId] : []
      )
    )) {
      for (const key of legacyDraftSectionConversationKeys(bookId, sectionId)) {
        conversations.forKey(key, scope);
      }
    }

    if (
      conversations.hasWriteBarrier(scope) ||
      state.acceptingWorkspaceIds.value.has(bookId)
    ) {
      notifications.warning("请先等待当前智能体结束，并接受或拒绝待审阅变更。");
      return false;
    }
    if (
      saves.conflict.value &&
      scopedDocuments.some(({ id }) => id === saves.conflict.value?.documentId)
    ) {
      notifications.warning("请先处理该作品尚未解决的保存冲突。");
      return false;
    }

    for (const document of scopedDocuments) {
      if (document.readOnly) continue;
      const draft = state.drafts.value[document.id];
      if (!draft?.dirty) continue;
      saves.cancel(document.id);
      const saved = await saves.persist(
        { id: document.id, title: draft.title, content: draft.content },
        false
      );
      if (disposed) return false;
      if (!saved) {
        notifications.warning("存在无法安全保存的草稿，结构未变更。");
        return false;
      }
    }
    return true;
  }

  async function duplicateCatalogBook(book: ResourceTreeNode): Promise<void> {
    const api = options.api();
    if (!api || book.unavailable) return;
    const operation = enqueueWorkspaceMutation(book.id, async (context) => {
      if (!(await prepareBookStructureMutation(book.id)) || disposed) return;
      try {
        const duplicated = await api.duplicateProject({
          domain: "book",
          projectId: book.id
        });
        await options.refreshWorkspaceDirectory();
        await catalog.refresh();
        if (canPublish(context)) {
          await nextTick();
          if (!canPublish(context)) return;
          await resources.revealCatalogBook(duplicated.projectId);
          if (canPublish(context)) {
            notifications.success(
              `已复制“${book.label}”为“${duplicated.title}”`
            );
          }
        }
      } catch (error: unknown) {
        if (canPublish(context)) {
          notifications.error(
            error instanceof Error ? error.message : "复制创作空间失败。"
          );
        }
      }
    });
    if (!operation) notifications.info("当前作品正在更新，请稍候。");
    await operation;
  }

  async function openPlotStructureDialog(bookId: string): Promise<boolean> {
    const api = options.api();
    if (!api) return false;
    const dialogRequestEpoch = ++plotDialogRequestEpoch;
    let opened = false;
    const operation = enqueueWorkspaceMutation(bookId, async (context) => {
      if (!(await prepareBookStructureMutation(bookId))) return;
      const authoritativeBook = catalog.findBook(bookId);
      if (
        !authoritativeBook ||
        authoritativeBook.projectRevision === undefined
      ) {
        if (canPublish(context)) {
          notifications.error("当前作品缺少项目版本，无法安全管理结构。");
        }
        return;
      }
      if (
        !canPublish(context) ||
        dialogRequestEpoch !== plotDialogRequestEpoch
      ) {
        return;
      }
      plotStructureBookId.value = bookId;
      opened = true;
    });
    if (!operation) {
      notifications.info("当前作品正在更新，请稍候。");
      return false;
    }
    await operation;
    return opened;
  }

  function closePlotStructureDialog(): void {
    plotDialogRequestEpoch += 1;
    plotStructureBookId.value = null;
  }

  async function mutateCharacterStructure(
    mutation: CharacterStructureMutation,
    completion: ShortStructureMutationCompletion,
    bookIdOverride?: string
  ): Promise<void> {
    const api = options.api();
    const bookId = bookIdOverride ?? plotStructureBookId.value;
    if (!api || !bookId) {
      completion.fail();
      return;
    }
    const operation = enqueueWorkspaceMutation(bookId, async (context) => {
      if (!(await prepareBookStructureMutation(bookId))) {
        if (canPublish(context)) completion.fail();
        return;
      }
      const authoritativeBook = catalog.findBook(bookId);
      if (
        !authoritativeBook ||
        authoritativeBook.projectRevision === undefined
      ) {
        if (canPublish(context)) {
          completion.fail();
          notifications.error("当前作品缺少项目版本，无法安全变更人物结构。");
        }
        return;
      }
      if (disposed) return;
      try {
        await api.mutateCharacterStructure({
          bookId,
          baseProjectRevision: authoritativeBook.projectRevision,
          mutation
        });
        await catalog.refresh();
        if (!canPublish(context)) return;
        completion.succeed();
        notifications.success(
          mutation.type === "setFormat"
            ? mutation.format === "list"
              ? "人物结构已转换为条目样式"
              : "人物结构已转换为文本样式"
            : mutation.type === "createItem"
              ? "人物条目已创建"
              : mutation.type === "updateItem"
                ? "人物条目名称已更新"
                : mutation.type === "moveItem"
                  ? "人物条目顺序已更新"
                  : "人物条目已删除"
        );
      } catch (error: unknown) {
        if (catalog.isConflict(error)) await catalog.refresh();
        if (!canPublish(context)) return;
        completion.fail();
        if (catalog.isConflict(error)) {
          notifications.warning(
            "作品已在其他位置更新，已重新加载；请确认后重试。"
          );
        } else {
          notifications.error(
            error instanceof Error ? error.message : "人物结构变更失败。"
          );
        }
      }
    });
    if (!operation) completion.fail();
    await operation;
  }

  function characterBookIdForNode(node: ResourceTreeNode): string | undefined {
    return resources.documentForResourceId(node.id)?.workspaceId;
  }

  function requestCreateCharacterItem(node: ResourceTreeNode): void {
    const bookId = characterBookIdForNode(node);
    if (!bookId) {
      notifications.warning("无法确定人物条目所属作品。");
      return;
    }
    if (state.mutationPending.value || disposed) {
      notifications.info("当前作品正在更新，请稍候。");
      return;
    }
    characterItemDialog.value = { mode: "create", bookId, title: "" };
  }

  function findCharacterDirectoryNode(
    resourceId: string
  ): ResourceTreeNode | undefined {
    const visit = (
      nodes: readonly ResourceTreeNode[],
      parent?: ResourceTreeNode
    ): ResourceTreeNode | undefined => {
      for (const node of nodes) {
        if (node.id === resourceId) {
          if (node.characterDirectory) return node;
          if (parent?.characterDirectory) return parent;
          return undefined;
        }
        const nested = visit(node.children ?? [], node);
        if (nested) return nested;
      }
      return undefined;
    };
    return visit(resources.sections.value.flatMap((section) => section.nodes));
  }

  async function selectCharacterItemTab(documentId: string): Promise<void> {
    if (
      !resources.activeCharacterItemTabs.value.some(
        (tab) => tab.id === documentId
      )
    ) {
      notifications.warning("该人物条目已不存在，列表已刷新");
      return;
    }
    const requestEpoch = ++characterSelectionEpoch;
    const selectionAnchor = state.selectedResourceId.value;
    const document = state.documents.value.find(({ id }) => id === documentId);
    if (document) {
      const loaded = await resources.ensureDocumentLoaded(document);
      if (loaded.catalogContentLoaded === false) return;
    }
    if (
      disposed ||
      requestEpoch !== characterSelectionEpoch ||
      state.selectedResourceId.value !== selectionAnchor
    ) {
      return;
    }
    const resourceId =
      resources.resourceIdForDocumentId(documentId) ?? documentId;
    state.selectedResourceId.value = resourceId;
    state.activeCreationResourceId.value = resourceId;
  }

  function addCharacterItemFromEditor(): void {
    const activeDocument = resources.activeDocument.value;
    const directory =
      findCharacterDirectoryNode(state.selectedResourceId.value) ??
      (activeDocument.workspaceId
        ? findCharacterDirectoryNode(
            resources.resourceIdForDocumentId(activeDocument.id) ??
              activeDocument.id
          )
        : undefined);
    if (!directory) {
      notifications.warning("无法确定人物目录，暂时不能新建人物条目。");
      return;
    }
    requestCreateCharacterItem(directory);
  }

  function deleteCharacterItemFromEditor(): void {
    const document = resources.activeDocument.value;
    if (
      document.characterFileKind !== "item" ||
      !document.characterItemId ||
      !document.workspaceId
    ) {
      notifications.warning("请先选择一个人物条目。");
      return;
    }
    if (state.mutationPending.value || disposed) {
      notifications.info("当前作品正在更新，请稍候。");
      return;
    }
    characterItemDialog.value = {
      mode: "delete",
      bookId: document.workspaceId,
      itemId: document.characterItemId,
      title: document.title
    };
  }

  function handleCharacterItemAction(
    action: "rename" | "move-up" | "move-down" | "delete",
    node: ResourceTreeNode
  ): void {
    const bookId = characterBookIdForNode(node);
    const itemId = node.characterItemId;
    if (!bookId || !itemId) {
      notifications.warning("无法确定人物条目。");
      return;
    }
    if (action === "move-up" || action === "move-down") {
      void mutateCharacterStructure(
        {
          type: "moveItem",
          itemId,
          direction: action === "move-up" ? "up" : "down"
        },
        { succeed: () => undefined, fail: () => undefined },
        bookId
      );
      return;
    }
    if (state.mutationPending.value || disposed) {
      notifications.info("当前作品正在更新，请稍候。");
      return;
    }
    characterItemDialog.value = {
      mode: action,
      bookId,
      itemId,
      title: node.label
    };
  }

  function closeCharacterItemDialog(): void {
    if (ownedPendingCount === 0) characterItemDialog.value = null;
  }

  function submitCharacterItemDialog(title: string): void {
    const target = characterItemDialog.value;
    if (!target) return;
    const mutation: CharacterStructureMutation =
      target.mode === "create"
        ? { type: "createItem", title }
        : target.mode === "rename"
          ? { type: "updateItem", itemId: target.itemId!, title }
          : { type: "deleteItem", itemId: target.itemId! };
    void mutateCharacterStructure(
      mutation,
      {
        succeed: () => {
          if (characterItemDialog.value === target) {
            characterItemDialog.value = null;
          }
        },
        fail: () => undefined
      },
      target.bookId
    );
  }

  async function mutatePlotStructure(
    mutation: PlotStructureMutation,
    completion: ShortStructureMutationCompletion
  ): Promise<void> {
    const api = options.api();
    const bookId = plotStructureBookId.value;
    if (!api || !bookId) {
      completion.fail();
      return;
    }
    const operation = enqueueWorkspaceMutation(bookId, async (context) => {
      if (!(await prepareBookStructureMutation(bookId))) {
        if (canPublish(context)) completion.fail();
        return;
      }
      const authoritativeBook = catalog.findBook(bookId);
      if (
        !authoritativeBook ||
        authoritativeBook.projectRevision === undefined
      ) {
        if (canPublish(context)) {
          completion.fail();
          notifications.error("当前作品缺少项目版本，无法安全变更剧情结构。");
        }
        return;
      }
      const deletedIndex =
        mutation.type === "delete"
          ? authoritativeBook.plotStages.findIndex(
              ({ id }) => id === mutation.stageId
            )
          : -1;
      const selectionAnchor = state.selectedResourceId.value;
      const selectedPlotStageId = state.documents.value.find(
        ({ id }) => id === selectionAnchor
      )?.stageId;
      if (disposed) return;
      try {
        await api.mutatePlotStructure({
          bookId,
          baseProjectRevision: authoritativeBook.projectRevision,
          mutation
        });
        await catalog.refresh();
        if (
          canPublish(context) &&
          state.selectedResourceId.value === selectionAnchor &&
          mutation.type === "delete" &&
          selectedPlotStageId === mutation.stageId
        ) {
          const refreshed = catalog.findBook(bookId);
          const fallbackStage =
            refreshed?.plotStages[
              Math.min(
                Math.max(0, deletedIndex),
                refreshed.plotStages.length - 1
              )
            ];
          const fallbackDocument = fallbackStage
            ? state.documents.value.find(
                (document) =>
                  document.workspaceId === bookId &&
                  document.stageId === fallbackStage.id &&
                  document.draftFileKind === undefined
              )
            : undefined;
          if (fallbackDocument) {
            state.selectedResourceId.value = fallbackDocument.id;
            state.activeCreationResourceId.value = fallbackDocument.id;
          }
        }
        if (!canPublish(context)) return;
        completion.succeed();
        notifications.success(
          mutation.type === "create"
            ? "剧情结构已创建，并同步到全部短篇与剧本"
            : mutation.type === "update"
              ? "剧情结构已全局更新"
              : mutation.type === "move"
                ? "剧情结构顺序已更新"
                : mutation.type === "setEnabled"
                  ? mutation.enabled
                    ? "已启用该剧情结构"
                    : "已关闭该剧情结构"
                  : "剧情结构已从全部作品中删除"
        );
      } catch (error: unknown) {
        if (catalog.isConflict(error)) await catalog.refresh();
        if (!canPublish(context)) return;
        completion.fail();
        if (catalog.isConflict(error)) {
          notifications.warning(
            "作品已在其他位置更新，已重新加载；请确认后重试。"
          );
        } else {
          notifications.error(
            error instanceof Error ? error.message : "剧情结构变更失败。"
          );
        }
      }
    });
    if (!operation) completion.fail();
    await operation;
  }

  function requestCreateExpertSection(draftNode: ResourceTreeNode): void {
    const directory = resources.draftDirectoryForResourceId(draftNode.id);
    const source = resources.documentForResourceId(draftNode.id);
    if (!directory) return;
    if (
      (source?.workspaceType !== "short" &&
        source?.workspaceType !== "script") ||
      source.stageId !== "draft"
    ) {
      return;
    }
    const unitLabel = source.workspaceType === "script" ? "剧集" : "小节";
    if (
      draftNode.stageCategoryId !== "draft" ||
      expertDraftMutationBlocked(source) ||
      source.readOnly ||
      state.mutationPending.value ||
      !options.api() ||
      disposed
    ) {
      notifications.info(`当前正文暂时不能新建${unitLabel}，请稍候`);
      return;
    }
    if (directory.sections.length >= 100) {
      notifications.warning(`正文最多支持 100 个${unitLabel}`);
      return;
    }
    pendingExpertSectionCreation.value = {
      draftDirectoryId: directory.id,
      workspaceType: directory.workspaceType,
      suggestedTitle: suggestedDraftSectionTitle(
        directory.workspaceType,
        directory.sections.map((section) => section.id)
      )
    };
  }

  async function addExpertSection(draftNode: ResourceTreeNode): Promise<void> {
    requestCreateExpertSection(draftNode);
  }

  function closeCreateExpertSectionDialog(): void {
    if (ownedPendingCount === 0) pendingExpertSectionCreation.value = null;
  }

  async function confirmCreateExpertSection(title: string): Promise<void> {
    const target = pendingExpertSectionCreation.value;
    if (!target) return;
    const initialDirectory = catalog.projection.value?.draftDirectories.find(
      (candidate) => candidate.id === target.draftDirectoryId
    );
    if (!initialDirectory) {
      if (pendingExpertSectionCreation.value === target) {
        pendingExpertSectionCreation.value = null;
      }
      notifications.warning("该正文已经不存在");
      return;
    }
    const bookId = initialDirectory.workspaceId;
    const api = options.api();
    if (!api) return;
    const operation = enqueueWorkspaceMutation(bookId, async (context) => {
      if (!(await prepareBookStructureMutation(bookId))) return;
      const directory = catalog.projection.value?.draftDirectories.find(
        (candidate) => candidate.id === target.draftDirectoryId
      );
      const draftNode = directory
        ? resources.resourceNode(directory.id)
        : undefined;
      const source = draftNode
        ? resources.documentForResourceId(draftNode.id)
        : undefined;
      const unitLabel = target.workspaceType === "script" ? "剧集" : "小节";
      if (!directory || !draftNode || !source) {
        if (canPublish(context)) {
          if (pendingExpertSectionCreation.value === target) {
            pendingExpertSectionCreation.value = null;
          }
          notifications.warning("该正文已经不存在");
        }
        return;
      }
      if (
        draftNode.stageCategoryId !== "draft" ||
        expertDraftMutationBlocked(source) ||
        source.readOnly
      ) {
        if (canPublish(context)) {
          notifications.info(`当前正文暂时不能新建${unitLabel}，请稍候`);
        }
        return;
      }
      if (directory.sections.length >= 100) {
        if (canPublish(context)) {
          notifications.warning(`正文最多支持 100 个${unitLabel}`);
        }
        return;
      }
      const authoritativeBook = catalog.findBook(bookId);
      if (
        !authoritativeBook ||
        authoritativeBook.projectRevision === undefined
      ) {
        if (canPublish(context)) {
          notifications.error("当前作品缺少项目版本，无法安全新建正文结构。");
        }
        return;
      }
      if (disposed) return;
      try {
        const added = await api.createDraftSection({
          bookId,
          title,
          ...(directory.sections.at(-1)
            ? { afterSectionId: directory.sections.at(-1)!.id }
            : {}),
          baseProjectRevision: authoritativeBook.projectRevision
        });
        await catalog.refresh();
        if (!canPublish(context)) return;
        state.selectedResourceId.value = directory.id;
        state.activeCreationResourceId.value = directory.id;
        state.selectedExpertSectionIds.value = {
          ...state.selectedExpertSectionIds.value,
          [directory.id]: added.id
        };
        state.selectedDraftFileKinds.value = {
          ...state.selectedDraftFileKinds.value,
          [directory.id]: "body"
        };
        if (pendingExpertSectionCreation.value === target) {
          pendingExpertSectionCreation.value = null;
        }
        notifications.success(`已新建“${added.title}”并保存到正文文件夹`);
      } catch (error: unknown) {
        if (catalog.isConflict(error)) await catalog.refresh();
        if (!canPublish(context)) return;
        if (catalog.isConflict(error)) {
          notifications.warning(
            "作品已在其他位置更新，已重新加载；请确认后重试。"
          );
        } else {
          notifications.error(
            error instanceof Error
              ? error.message
              : `新建正文${unitLabel}失败。`
          );
        }
      }
    });
    if (!operation) notifications.info("当前作品正在更新，请稍候。");
    await operation;
  }

  async function addExpertSectionFromEditor(): Promise<void> {
    const directory = resources.draftDirectoryForResourceId(
      state.selectedResourceId.value
    );
    if (!directory || directory.workspaceType !== "short") return;
    const draftNode = resources.resourceNode(directory.id);
    if (!draftNode) {
      notifications.info("当前正文暂时不能新建小节，请稍候");
      return;
    }
    await addExpertSection(draftNode);
  }

  async function moveExpertSection(
    action: "move-up" | "move-down",
    node: ResourceTreeNode
  ): Promise<void> {
    if (!node.expertSectionId) return;
    const initialDirectory = resources.draftDirectoryForResourceId(node.id);
    if (!initialDirectory) return;
    const bookId = initialDirectory.workspaceId;
    const sectionId = node.expertSectionId;
    const api = options.api();
    if (!api) return;
    const operation = enqueueWorkspaceMutation(bookId, async (context) => {
      if (!(await prepareBookStructureMutation(bookId))) return;
      const directory = catalog.projection.value?.draftDirectories.find(
        (candidate) => candidate.id === initialDirectory.id
      );
      const section = directory?.sections.find(
        (candidate) => candidate.id === sectionId
      );
      const source = section
        ? state.documents.value.find(
            (document) => document.id === section.bodyDocumentId
          )
        : undefined;
      if (!directory || !section || !source) {
        if (canPublish(context)) {
          notifications.warning("该正文小节已经不存在，列表已刷新");
        }
        return;
      }
      const unitLabel = directory.workspaceType === "script" ? "剧集" : "小节";
      if (expertDraftMutationBlocked(source)) {
        if (canPublish(context)) {
          notifications.info(
            `当前${unitLabel}正在处理或保存，请稍候再调整顺序`
          );
        }
        return;
      }
      const currentIndex = directory.sections.findIndex(
        (candidate) => candidate.id === section.id
      );
      const direction = action === "move-up" ? "up" : "down";
      const targetIndex =
        direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= directory.sections.length) return;
      const authoritativeBook = catalog.findBook(bookId);
      if (
        !authoritativeBook ||
        authoritativeBook.projectRevision === undefined
      ) {
        if (canPublish(context)) {
          notifications.error("当前作品缺少项目版本，无法安全调整正文结构。");
        }
        return;
      }
      if (disposed) return;
      try {
        const result = await api.moveDraftSection({
          bookId,
          sectionId: section.id,
          direction,
          baseProjectRevision: authoritativeBook.projectRevision
        });
        if (!result.moved) return;
        await catalog.refresh();
        if (!canPublish(context)) return;
        state.selectedResourceId.value = directory.id;
        state.activeCreationResourceId.value = directory.id;
        state.selectedExpertSectionIds.value = {
          ...state.selectedExpertSectionIds.value,
          [directory.id]: section.id
        };
        notifications.success(
          `已${direction === "up" ? "上移" : "下移"}“${section.title}”`
        );
      } catch (error: unknown) {
        if (catalog.isConflict(error)) await catalog.refresh();
        if (!canPublish(context)) return;
        if (catalog.isConflict(error)) {
          notifications.warning(
            "作品已在其他位置更新，已重新加载；请确认后重试。"
          );
        } else {
          notifications.error(
            error instanceof Error
              ? error.message
              : `调整${unitLabel}顺序失败。`
          );
        }
      }
    });
    if (!operation) notifications.info("当前作品正在更新，请稍候。");
    await operation;
  }

  function removeExpertSectionFromEditor(): void {
    const directory = resources.draftDirectoryForResourceId(
      state.selectedResourceId.value
    );
    if (!directory || directory.workspaceType !== "short") return;
    const sectionId = resources.activeExpertSectionId.value;
    if (!sectionId) {
      notifications.warning("请先选择一个小节");
      return;
    }
    const draftNode = resources.resourceNode(directory.id);
    const sectionNode = draftNode?.children?.find(
      (child) => child.expertSectionId === sectionId
    );
    if (!sectionNode) {
      notifications.warning("该小节已经不存在，列表已刷新");
      return;
    }
    requestRemoveExpertSection(sectionNode);
  }

  function requestRemoveExpertSection(node: ResourceTreeNode): void {
    if (!node.expertSectionId) return;
    const directory = resources.draftDirectoryForResourceId(node.id);
    const section = directory?.sections.find(
      (candidate) => candidate.id === node.expertSectionId
    );
    if (!directory || !section) {
      notifications.warning(
        `该${directory?.workspaceType === "script" ? "剧集" : "小节"}已经不存在`
      );
      return;
    }
    if (directory.sections.length <= 1) {
      notifications.warning(
        `正文至少需要保留一个${directory.workspaceType === "script" ? "剧集" : "小节"}`
      );
      return;
    }
    if (state.mutationPending.value || disposed) {
      notifications.info("当前作品正在更新，请稍候。");
      return;
    }
    const body = resources.draftFileDocument(directory, section.id, "body");
    const characterState = resources.draftFileDocument(
      directory,
      section.id,
      "character-state"
    );
    pendingExpertSectionDeletion.value = {
      workspaceId: directory.workspaceId,
      draftDirectoryId: directory.id,
      sectionId: section.id,
      sectionTitle: section.title,
      workspaceType: directory.workspaceType,
      hasContent: Boolean(
        (body && resources.liveDocument(body).content.trim()) ||
        (characterState &&
          resources.liveDocument(characterState).content.trim()) ||
        section.wordCountRequirement.trim()
      )
    };
  }

  function closeRemoveExpertSectionDialog(): void {
    if (ownedPendingCount === 0) pendingExpertSectionDeletion.value = null;
  }

  async function confirmRemoveExpertSection(): Promise<void> {
    const target = pendingExpertSectionDeletion.value;
    if (!target) return;
    const api = options.api();
    if (!api) return;
    const operation = enqueueWorkspaceMutation(
      target.workspaceId,
      async (context) => {
        if (!(await prepareBookStructureMutation(target.workspaceId))) return;
        const directory = catalog.projection.value?.draftDirectories.find(
          (candidate) => candidate.id === target.draftDirectoryId
        );
        const section = directory?.sections.find(
          (candidate) => candidate.id === target.sectionId
        );
        const source = section
          ? state.documents.value.find(
              (document) => document.id === section.bodyDocumentId
            )
          : undefined;
        if (!directory || !section || !source) {
          if (canPublish(context)) {
            if (pendingExpertSectionDeletion.value === target) {
              pendingExpertSectionDeletion.value = null;
            }
            notifications.warning("该正文已经不存在");
          }
          return;
        }
        if (directory.sections.length <= 1) {
          if (canPublish(context)) {
            notifications.warning(
              `正文至少需要保留一个${directory.workspaceType === "script" ? "剧集" : "小节"}`
            );
          }
          return;
        }
        if (expertDraftMutationBlocked(source)) {
          if (canPublish(context)) {
            notifications.info(
              `当前${target.workspaceType === "script" ? "剧集" : "小节"}正在处理或保存，请稍候再删除`
            );
          }
          return;
        }
        const removedIndex = directory.sections.findIndex(
          (candidate) => candidate.id === target.sectionId
        );
        const fallbackSections = directory.sections.filter(
          (candidate) => candidate.id !== target.sectionId
        );
        const fallbackSection =
          fallbackSections[Math.min(removedIndex, fallbackSections.length - 1)];
        const authoritativeBook = catalog.findBook(target.workspaceId);
        if (
          !authoritativeBook ||
          authoritativeBook.projectRevision === undefined
        ) {
          if (canPublish(context)) {
            notifications.error("当前作品缺少项目版本，无法安全删除正文结构。");
          }
          return;
        }
        if (disposed) return;
        try {
          const deleted = await api.deleteDraftSection({
            bookId: target.workspaceId,
            sectionId: target.sectionId,
            baseProjectRevision: authoritativeBook.projectRevision
          });
          if (!deleted.deleted) {
            throw new Error(
              `该${target.workspaceType === "script" ? "剧集" : "正文小节"}已经不存在。`
            );
          }

          // This cleanup is part of the durable mutation result and must run
          // even when the renderer begins disposal while I/O is in flight.
          const nextDrafts = { ...state.drafts.value };
          delete nextDrafts[section.bodyDocumentId];
          delete nextDrafts[section.characterStateDocumentId];
          state.drafts.value = nextDrafts;
          for (const conversationKey of legacyDraftSectionConversationKeys(
            target.workspaceId,
            target.sectionId
          )) {
            conversations.remove(conversationKey, { clearPersistence: true });
          }
          await catalog.refresh();
          if (!canPublish(context)) return;
          state.selectedResourceId.value = directory.id;
          state.activeCreationResourceId.value = directory.id;
          if (fallbackSection) {
            state.selectedExpertSectionIds.value = {
              ...state.selectedExpertSectionIds.value,
              [directory.id]: fallbackSection.id
            };
          }
          state.selectedDraftFileKinds.value = {
            ...state.selectedDraftFileKinds.value,
            [directory.id]: "body"
          };
          if (pendingExpertSectionDeletion.value === target) {
            pendingExpertSectionDeletion.value = null;
          }
          notifications.success(
            `已删除“${target.sectionTitle}”及对应人物状态文件`
          );
        } catch (error: unknown) {
          if (catalog.isConflict(error)) await catalog.refresh();
          if (!canPublish(context)) return;
          if (catalog.isConflict(error)) {
            notifications.warning(
              "作品已在其他位置更新，已重新加载；请确认后重试。"
            );
          } else {
            notifications.error(
              error instanceof Error
                ? error.message
                : `删除${target.workspaceType === "script" ? "剧集" : "正文小节"}失败。`
            );
          }
        }
      }
    );
    if (!operation) notifications.info("当前作品正在更新，请稍候。");
    await operation;
  }

  async function dispose(): Promise<void> {
    if (disposePromise) return disposePromise;
    if (disposed) return;
    disposed = true;
    characterSelectionEpoch += 1;
    plotDialogRequestEpoch += 1;
    for (const bookId of workspaceMutationEpochs.keys()) workspaceEpoch(bookId);
    disposePromise = (async () => {
      await drain();
      plotStructureBookId.value = null;
      characterItemDialog.value = null;
      pendingExpertSectionCreation.value = null;
      pendingExpertSectionDeletion.value = null;
    })();
    await disposePromise;
  }

  return {
    plotStructureBookId,
    plotStructureBook,
    characterItemDialog,
    pendingExpertSectionCreation,
    pendingExpertSectionDeletion,
    legacyDraftSectionConversationKeys,
    prepareBookMutation: prepareBookStructureMutation,
    duplicateCatalogBook,
    openPlotStructureDialog,
    closePlotStructureDialog,
    mutateCharacterStructure,
    mutatePlotStructure,
    selectCharacterItemTab,
    addCharacterItemFromEditor,
    deleteCharacterItemFromEditor,
    requestCreateCharacterItem,
    handleCharacterItemAction,
    closeCharacterItemDialog,
    submitCharacterItemDialog,
    addExpertSection,
    closeCreateExpertSectionDialog,
    confirmCreateExpertSection,
    addExpertSectionFromEditor,
    moveExpertSection,
    removeExpertSectionFromEditor,
    requestRemoveExpertSection,
    closeRemoveExpertSectionDialog,
    confirmRemoveExpertSection,
    drain,
    dispose
  };
}
