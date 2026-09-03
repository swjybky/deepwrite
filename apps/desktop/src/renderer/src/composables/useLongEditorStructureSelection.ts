import {
  createEmptyLongMarkdownFileReference,
  longStoryPlotBodyFileId,
  longStoryPlotFilePath,
  type LongChapterCardId,
  type LongCharacterId,
  type LongWorkspaceImpactConfirmation,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceOperation,
  type LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import {
  computed,
  nextTick,
  ref,
  watch,
  type ComputedRef,
  type Ref
} from "vue";
import {
  type LongForeshadowingFocus,
  type LongStructureMutationCompletion,
  type LongWorkspaceFileRole,
  type LongWorkspaceSelection,
  type LongWorkspaceSelectionFile
} from "../types/longWorkspace";
import { uiMessage } from "../ui-feedback";
import type { LongApprovalEditorFocus } from "../utils/approvalNavigation";
import { orderLongChapterNavigationItems } from "../utils/orderLongChapterNavigationItems";
import type { LongDocumentState } from "./useLongEditorDocumentSession";
import { useLongStoryPlotDeleteConfirmation } from "./useLongStoryPlotDeleteConfirmation";

export interface LongStructureTitleTarget {
  kind: "worldbuilding" | "volume" | "plotPoint" | "chapterCard";
  id: string;
  title: string;
  inputLabel: string;
  emptyMessage: string;
}

export interface LongEditorStructureHost {
  currentReadOnly: ComputedRef<boolean>;
  currentIsPlotPointStoryline: ComputedRef<boolean>;
  currentStructureTitleTarget: ComputedRef<LongStructureTitleTarget | null>;
  currentStructureTitleReadOnly: ComputedRef<boolean>;
  currentWorldbuildingItem: ComputedRef<{ id: string; title: string } | null>;
  currentEmptyCollection: ComputedRef<{
    action: "character" | "plotPoint" | "chapterCard";
  } | null>;
  currentIsCharacterDocument: ComputedRef<boolean>;
  currentIsBookLineWorkspace: ComputedRef<boolean>;
  resetEditorHistory: () => void;
  loadWorkspaceDocument: (
    selectedFile: LongWorkspaceSelectionFile,
    force?: boolean
  ) => Promise<void>;
  saveAllChanges: () => Promise<boolean>;
  updateCurrentContent: (content: string) => void;
}

export function useLongEditorStructureSelection(options: {
  props: {
    bookId: string;
    selection: LongWorkspaceSelection | null;
    workspaceIndex: LongWorkspaceIndexSnapshot | null;
    locked?: boolean;
  };
  host: LongEditorStructureHost;
  emit: {
    (
      event: "selectCharacter",
      characterId: LongCharacterId,
      done?: (accepted: boolean) => void
    ): void;
    (event: "createCharacter"): void;
    (event: "createWorldbuildingItem"): void;
    (event: "createPlotPoint"): void;
    (event: "createChapterCard"): void;
    (event: "createVolume"): void;
    (
      event: "renameCharacter",
      input: { characterId: LongCharacterId; name: string },
      completion: (succeeded: boolean) => void
    ): void;
    (
      event: "renameStructureTitle",
      input: {
        kind: "worldbuilding" | "volume" | "plotPoint" | "chapterCard";
        id: string;
        title: string;
      },
      completion: (succeeded: boolean) => void
    ): void;
    (
      event: "mutation",
      batch: LongWorkspaceOperationBatch,
      completion: LongStructureMutationCompletion
    ): void;
    (
      event: "previewMutation",
      batch: LongWorkspaceOperationBatch,
      completion: (impact?: LongWorkspaceImpactConfirmation) => void
    ): void;
  };
  currentWorldbuildingItems: ComputedRef<Array<{ id: string; title: string }>>;
  currentWorldbuildingListState: ComputedRef<{
    items: Array<{ id: string; title: string }>;
    error: string | null;
  }>;
  currentStoryPlots: ComputedRef<
    Array<{ id: string; title: string; order: number; file: { id: string } }>
  >;
  currentPlotPoint: ComputedRef<{ id: string; title: string } | null>;
  orderedBookLineVolumes: ComputedRef<Array<{ id: string }>>;
  currentCharacterNavigationItems: ComputedRef<Array<{ id: string }>>;
  documentStates: Ref<Record<string, LongDocumentState>>;
  resetTextViewMode: (forcePreview?: boolean) => void;
  stateKey: (fileId: string, bookId?: string) => string;
}): {
  activeRole: Ref<LongWorkspaceFileRole>;
  activeFileId: Ref<string | null>;
  activeWorldbuildingItemId: Ref<string | null>;
  pendingWorldbuildingItemId: Ref<string | null>;
  pendingWorldbuildingOverview: Ref<boolean>;
  activeStoryPlotId: Ref<string | null>;
  pendingStoryPlotId: Ref<string | null>;
  pendingStoryPlotDeleteId: Ref<string | null>;
  pendingStoryPlotDeleteImpact: Ref<
    LongWorkspaceImpactConfirmation | undefined
  >;
  pendingStoryPlotDeletePreviewPending: Ref<boolean>;
  pendingStoryPlotDeletePending: Ref<boolean>;
  storyPlotActionMenuId: Ref<string | null>;
  pendingCharacterId: Ref<string | null>;
  pendingRole: Ref<LongWorkspaceFileRole | null>;
  pendingFileId: Ref<string | null>;
  foreshadowingWorkspace: Ref<{
    captureFocus(): LongForeshadowingFocus;
    focusTarget(threadId?: string, beatId?: string): Promise<boolean>;
  } | null>;
  activeBookLineVolumeId: Ref<string | null>;
  activeBookLineContentTab: Ref<"outline" | "foreshadowing">;
  activePlotPointTab: Ref<"summary" | "storyline" | "foreshadowing">;
  characterNameDraft: Ref<string>;
  characterNameSaving: Ref<boolean>;
  structureTitleDraft: Ref<string>;
  structureTitleSaving: Ref<boolean>;
  currentSelectionFile: ComputedRef<LongWorkspaceSelectionFile | undefined>;
  selectWorldbuildingItem: (itemId: string) => Promise<void>;
  selectWorldbuildingOverview: () => Promise<void>;
  addWorldbuildingItem: () => void;
  emitWorldbuildingItemMutation: (
    operations: LongWorkspaceOperation[],
    onSuccess?: () => void
  ) => void;
  updateWorldbuildingItemContent: (itemId: string, content: string) => void;
  updateWorldbuildingItemTitle: (itemId: string, event: Event) => void;
  selectBookLineOverview: () => void;
  selectBookLineVolume: (volumeId: string) => void;
  selectBookLineContentTab: (tab: "outline" | "foreshadowing") => Promise<void>;
  selectPlotPointTab: (
    tab: "summary" | "storyline" | "foreshadowing"
  ) => Promise<void>;
  requestCreateVolume: () => void;
  forwardForeshadowingMutation: (
    batch: LongWorkspaceOperationBatch,
    completion: LongStructureMutationCompletion
  ) => void;
  selectStoryPlot: (storyPlotId: string) => Promise<void>;
  ensureActiveStoryPlotSelection: () => Promise<void>;
  addStoryPlot: () => void;
  updateStoryPlotTitle: (storyPlotId: string, event: Event) => void;
  openStoryPlotDelete: (storyPlotId: string) => void;
  cancelStoryPlotDelete: () => void;
  confirmStoryPlotDelete: () => void;
  reorderStoryPlot: (storyPlotId: string, direction: "up" | "down") => void;
  toggleStoryPlotActionMenu: (storyPlotId: string) => void;
  closeStoryPlotActionMenu: () => void;
  reorderChapterCard: (
    chapterCardId: LongChapterCardId,
    direction: "up" | "down"
  ) => void;
  runStoryPlotMenuAction: (
    storyPlotId: string,
    action: "up" | "down" | "delete"
  ) => void;
  resetCharacterNameDraft: () => void;
  saveCharacterName: () => void;
  handleCharacterNameKeydown: (event: KeyboardEvent) => void;
  resetStructureTitleDraft: () => void;
  saveStructureTitle: () => void;
  handleStructureTitleKeydown: (event: KeyboardEvent) => void;
  selectRole: (role: LongWorkspaceFileRole) => Promise<void>;
  selectWorkspaceFile: (fileId: string) => Promise<void>;
  focusFile: (fileId: string) => Promise<boolean>;
  focusTarget: (target: LongApprovalEditorFocus) => Promise<boolean>;
  captureNavigationSelection: () => Partial<LongWorkspaceSelection>;
  requestSelectCharacter: (characterId: LongCharacterId) => void;
  createFirstCollectionItem: () => void;
} {
  const { props, emit } = options;

  async function saveAllChanges(): Promise<boolean> {
    return options.host.saveAllChanges();
  }

  async function loadWorkspaceDocument(
    selectedFile: LongWorkspaceSelectionFile,
    force = false
  ): Promise<void> {
    await options.host.loadWorkspaceDocument(selectedFile, force);
  }
  const activeRole = ref<LongWorkspaceFileRole>("content");
  const activeFileId = ref<string | null>(null);
  const activeWorldbuildingItemId = ref<string | null>(null);
  const pendingWorldbuildingItemId = ref<string | null>(null);
  const pendingWorldbuildingOverview = ref(false);
  const activeStoryPlotId = ref<string | null>(null);
  const pendingStoryPlotId = ref<string | null>(null);
  const storyPlotActionMenuId = ref<string | null>(null);
  let storyPlotSelectionRequest = 0;
  const pendingCharacterId = ref<string | null>(null);
  const pendingRole = ref<LongWorkspaceFileRole | null>(null);
  const pendingFileId = ref<string | null>(null);
  const foreshadowingWorkspace = ref<{
    captureFocus(): LongForeshadowingFocus;
    focusTarget(threadId?: string, beatId?: string): Promise<boolean>;
  } | null>(null);
  const activeBookLineVolumeId = ref<string | null>(null);
  const activeBookLineContentTab = ref<"outline" | "foreshadowing">("outline");
  const activePlotPointTab = ref<"summary" | "storyline" | "foreshadowing">(
    "summary"
  );
  const characterNameDraft = ref("");
  const characterNameSaving = ref(false);
  const structureTitleDraft = ref("");
  const structureTitleSaving = ref(false);
  let worldbuildingSelectionRequest = 0;
  const {
    pendingStoryPlotDeleteId,
    pendingStoryPlotDeleteImpact,
    pendingStoryPlotDeletePreviewPending,
    pendingStoryPlotDeletePending,
    openStoryPlotDelete,
    cancelStoryPlotDelete,
    confirmStoryPlotDelete
  } = useLongStoryPlotDeleteConfirmation({
    currentReadOnly: options.host.currentReadOnly,
    currentStoryPlots: options.currentStoryPlots,
    activeStoryPlotId,
    ensureActiveSelection: ensureActiveStoryPlotSelection,
    preview: (batch, completion) => emit("previewMutation", batch, completion),
    mutate: (batch, completion) => emit("mutation", batch, completion)
  });

  const currentSelectionFile = computed<LongWorkspaceSelectionFile | undefined>(
    () => {
      const selection = props.selection;
      if (!selection) return undefined;
      const explicitlySelectedFile = selection.preferredFileId
        ? selection.files.find(
            ({ file }) => file.id === selection.preferredFileId
          )
        : undefined;
      if (selection.worldbuildingFormat === "list") {
        const selectedItemId =
          selection.worldbuildingItemId !== undefined
            ? selection.worldbuildingItemId
            : activeWorldbuildingItemId.value;
        const item = selection.worldbuildingItems?.find(
          ({ id }) => id === selectedItemId
        );
        return (
          explicitlySelectedFile ??
          (item
            ? selection.files.find(({ file }) => file.id === item.file.id)
            : (selection.files.find(({ role }) => role === "overview") ??
              selection.files[0]))
        );
      }
      if (selection.plotPointId && activePlotPointTab.value === "storyline") {
        if (explicitlySelectedFile) return explicitlySelectedFile;
        const item = selection.storyPlots?.find(
          ({ id }) => id === activeStoryPlotId.value
        );
        return item
          ? selection.files.find(({ file }) => file.id === item.file.id)
          : undefined;
      }
      if (
        selection.plotPointId &&
        (activePlotPointTab.value === "summary" ||
          activePlotPointTab.value === "foreshadowing")
      ) {
        return selection.files.find(({ role }) => role === "book-line");
      }
      return (
        explicitlySelectedFile ??
        selection.files.find(({ file }) => file.id === activeFileId.value) ??
        selection.files.find(({ role }) => role === activeRole.value) ??
        selection.files[0]
      );
    }
  );

  function createFirstCollectionItem(): void {
    const action = options.host.currentEmptyCollection.value?.action;
    if (action === "character") {
      emit("createCharacter");
    } else if (action === "plotPoint") {
      emit("createPlotPoint");
    } else if (action === "chapterCard") {
      emit("createChapterCard");
    }
  }

  function emitWorldbuildingItemMutation(
    operations: LongWorkspaceOperation[],
    onSuccess?: () => void
  ): void {
    if (!props.workspaceIndex || options.host.currentReadOnly.value) return;
    emit(
      "mutation",
      {
        updatedAt: new Date().toISOString(),
        operations,
        documentWrites: []
      },
      {
        succeed() {
          onSuccess?.();
        },
        fail() {},
        appliedButRefreshFailed() {
          onSuccess?.();
        }
      }
    );
  }

  async function selectWorldbuildingItem(itemId: string): Promise<void> {
    if (
      itemId === activeWorldbuildingItemId.value ||
      itemId === pendingWorldbuildingItemId.value
    ) {
      return;
    }
    const selection = props.selection;
    const item = selection?.worldbuildingItems?.find(({ id }) => id === itemId);
    const selectedFile = item
      ? selection?.files.find(({ file }) => file.id === item.file.id)
      : undefined;
    if (!selection || !item || !selectedFile) return;

    const request = ++worldbuildingSelectionRequest;
    const bookId = props.bookId;
    const selectionKey = selection.key;
    pendingWorldbuildingOverview.value = false;
    pendingWorldbuildingItemId.value = itemId;
    await loadWorkspaceDocument(selectedFile);

    if (
      request !== worldbuildingSelectionRequest ||
      props.bookId !== bookId ||
      props.selection?.key !== selectionKey
    ) {
      return;
    }
    pendingWorldbuildingItemId.value = null;
    const state =
      options.documentStates.value[
        options.stateKey(selectedFile.file.id, bookId)
      ];
    if (state?.loaded || Boolean(state?.content)) {
      activeWorldbuildingItemId.value = itemId;
    }
  }

  async function selectWorldbuildingOverview(): Promise<void> {
    if (
      activeWorldbuildingItemId.value === null &&
      !pendingWorldbuildingOverview.value &&
      pendingWorldbuildingItemId.value === null
    ) {
      return;
    }
    const selection = props.selection;
    const selectedFile = selection?.files.find(
      ({ role }) => role === "overview"
    );
    if (!selection || !selectedFile) return;

    const request = ++worldbuildingSelectionRequest;
    const bookId = props.bookId;
    const selectionKey = selection.key;
    pendingWorldbuildingItemId.value = null;
    pendingWorldbuildingOverview.value = true;
    await loadWorkspaceDocument(selectedFile);
    if (
      request !== worldbuildingSelectionRequest ||
      props.bookId !== bookId ||
      props.selection?.key !== selectionKey
    ) {
      return;
    }
    pendingWorldbuildingOverview.value = false;
    const state =
      options.documentStates.value[
        options.stateKey(selectedFile.file.id, bookId)
      ];
    if (state?.loaded || Boolean(state?.content)) {
      activeWorldbuildingItemId.value = null;
    }
  }

  function addWorldbuildingItem(): void {
    if (options.host.currentReadOnly.value) return;
    emit("createWorldbuildingItem");
  }

  function updateWorldbuildingItemContent(
    itemId: string,
    content: string
  ): void {
    if (options.host.currentWorldbuildingItem.value?.id === itemId) {
      options.host.updateCurrentContent(content);
    }
  }

  function selectBookLineOverview(): void {
    activeBookLineVolumeId.value = null;
    activeBookLineContentTab.value = "outline";
    options.host.resetEditorHistory();
  }

  function selectBookLineVolume(volumeId: string): void {
    if (
      !options.orderedBookLineVolumes.value.some(({ id }) => id === volumeId)
    ) {
      return;
    }
    activeBookLineVolumeId.value = volumeId;
    activeBookLineContentTab.value = "outline";
    options.host.resetEditorHistory();
  }

  async function selectBookLineContentTab(
    tab: "outline" | "foreshadowing"
  ): Promise<void> {
    if (tab === "foreshadowing") {
      // 锁定期间编辑器只读、不会产生脏数据，跳过保存以避免与智能体写入冲突
      if (!props.locked && !(await saveAllChanges())) return;
      await nextTick();
    }
    activeBookLineContentTab.value = tab;
    options.host.resetEditorHistory();
  }

  async function selectPlotPointTab(
    tab: "summary" | "storyline" | "foreshadowing"
  ): Promise<void> {
    if (tab === "foreshadowing" || tab === "storyline") {
      // 同上：锁定时允许只读切换，不再触发保存
      if (!props.locked && !(await saveAllChanges())) return;
      await nextTick();
    }
    activePlotPointTab.value = tab;
    options.host.resetEditorHistory();
    if (tab === "storyline") {
      await ensureActiveStoryPlotSelection();
    }
  }

  function requestCreateVolume(): void {
    if (!options.host.currentReadOnly.value) {
      emit("createVolume");
    }
  }

  function forwardForeshadowingMutation(
    batch: LongWorkspaceOperationBatch,
    completion: LongStructureMutationCompletion
  ): void {
    emit("mutation", batch, completion);
  }

  function emitStoryPlotMutation(
    operations: LongWorkspaceOperation[],
    onSuccess?: () => void
  ): void {
    if (!props.workspaceIndex || options.host.currentReadOnly.value) return;
    emit(
      "mutation",
      {
        updatedAt: new Date().toISOString(),
        operations,
        documentWrites: []
      },
      {
        succeed() {
          onSuccess?.();
        },
        fail() {},
        appliedButRefreshFailed() {
          onSuccess?.();
        }
      }
    );
  }

  async function selectStoryPlot(storyPlotId: string): Promise<void> {
    closeStoryPlotActionMenu();
    if (
      storyPlotId === activeStoryPlotId.value ||
      storyPlotId === pendingStoryPlotId.value
    ) {
      return;
    }
    const selection = props.selection;
    const item = selection?.storyPlots?.find(({ id }) => id === storyPlotId);
    const selectedFile = item
      ? selection?.files.find(({ file }) => file.id === item.file.id)
      : undefined;
    if (!selection || !item || !selectedFile) return;

    const request = ++storyPlotSelectionRequest;
    const bookId = props.bookId;
    const selectionKey = selection.key;
    pendingStoryPlotId.value = storyPlotId;
    await loadWorkspaceDocument(selectedFile);
    if (
      request !== storyPlotSelectionRequest ||
      props.bookId !== bookId ||
      props.selection?.key !== selectionKey
    ) {
      return;
    }
    pendingStoryPlotId.value = null;
    const state =
      options.documentStates.value[
        options.stateKey(selectedFile.file.id, bookId)
      ];
    if (state?.loaded || Boolean(state?.content)) {
      activeStoryPlotId.value = storyPlotId;
    }
  }

  async function ensureActiveStoryPlotSelection(): Promise<void> {
    const plots = options.currentStoryPlots.value;
    if (!plots.length) {
      activeStoryPlotId.value = null;
      pendingStoryPlotId.value = null;
      return;
    }
    if (
      activeStoryPlotId.value &&
      plots.some(({ id }) => id === activeStoryPlotId.value)
    ) {
      const selected = plots.find(({ id }) => id === activeStoryPlotId.value);
      const selectedFile = selected
        ? props.selection?.files.find(
            ({ file }) => file.id === selected.file.id
          )
        : undefined;
      if (selectedFile) {
        await loadWorkspaceDocument(selectedFile);
      }
      return;
    }
    await selectStoryPlot(plots[0]!.id);
  }

  function addStoryPlot(): void {
    const plotPointId = options.currentPlotPoint.value?.id;
    const plots = options.currentStoryPlots.value;
    if (
      !plotPointId ||
      options.host.currentReadOnly.value ||
      plots.length >= 200_000
    ) {
      if (plots.length >= 200_000) {
        uiMessage.warning("故事情节数量已达上限。");
      }
      return;
    }
    const usedTitles = new Set(plots.map(({ title }) => title));
    let sequence = plots.length + 1;
    let title = `故事情节 ${sequence}`;
    while (usedTitles.has(title)) {
      sequence += 1;
      title = `故事情节 ${sequence}`;
    }
    const id = createId("storyplot");
    const updatedAt = new Date().toISOString();
    emitStoryPlotMutation(
      [
        {
          type: "storyPlot.create",
          storyPlot: {
            id,
            arcId: plotPointId,
            title,
            order: plots.length + 1,
            file: createEmptyLongMarkdownFileReference(
              longStoryPlotBodyFileId(id),
              longStoryPlotFilePath(id),
              updatedAt
            )
          }
        }
      ],
      () => {
        void selectStoryPlot(id);
      }
    );
  }

  function updateStoryPlotTitle(storyPlotId: string, event: Event): void {
    const title = (event.target as HTMLInputElement).value.trim();
    const current = options.currentStoryPlots.value.find(
      ({ id }) => id === storyPlotId
    );
    if (!current || options.host.currentReadOnly.value) return;
    if (!title) {
      uiMessage.warning("故事情节名称不能为空。");
      (event.target as HTMLInputElement).value = current.title;
      return;
    }
    if (title === current.title) return;
    emitStoryPlotMutation([
      {
        type: "storyPlot.update",
        id: storyPlotId,
        patch: { title }
      }
    ]);
  }

  function reorderStoryPlot(
    storyPlotId: string,
    direction: "up" | "down"
  ): void {
    const plots = options.currentStoryPlots.value;
    const index = plots.findIndex(({ id }) => id === storyPlotId);
    if (index < 0) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= plots.length) return;
    const orderedIds = plots.map(({ id }) => id);
    [orderedIds[index], orderedIds[targetIndex]] = [
      orderedIds[targetIndex]!,
      orderedIds[index]!
    ];
    const arcId = options.currentPlotPoint.value?.id;
    if (!arcId) return;
    emitStoryPlotMutation([
      {
        type: "storyPlot.reorder",
        arcId,
        orderedIds
      }
    ]);
  }

  function toggleStoryPlotActionMenu(storyPlotId: string): void {
    storyPlotActionMenuId.value =
      storyPlotActionMenuId.value === storyPlotId ? null : storyPlotId;
  }

  function closeStoryPlotActionMenu(): void {
    storyPlotActionMenuId.value = null;
  }

  function reorderChapterCard(
    chapterCardId: LongChapterCardId,
    direction: "up" | "down"
  ): void {
    const tabs = orderLongChapterNavigationItems(
      props.selection?.chapterCardTabs ?? []
    );
    const index = tabs.findIndex(({ id }) => id === chapterCardId);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (
      props.locked ||
      index < 0 ||
      targetIndex < 0 ||
      targetIndex >= tabs.length
    ) {
      return;
    }
    const orderedIds = tabs.map(({ id }) => id);
    [orderedIds[index], orderedIds[targetIndex]] = [
      orderedIds[targetIndex]!,
      orderedIds[index]!
    ];
    const volumeId = props.selection?.chapterCardVolumeId;
    if (!volumeId) return;
    emitStoryPlotMutation([
      {
        type: "chapter.reorder",
        volumeId,
        orderedIds
      }
    ]);
  }

  function runStoryPlotMenuAction(
    storyPlotId: string,
    action: "up" | "down" | "delete"
  ): void {
    closeStoryPlotActionMenu();
    if (action === "delete") {
      openStoryPlotDelete(storyPlotId);
      return;
    }
    reorderStoryPlot(storyPlotId, action);
  }

  function updateWorldbuildingItemTitle(itemId: string, event: Event): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    const title = input.value.trim();
    const current = options.currentWorldbuildingItems.value.find(
      (item) => item.id === itemId
    );
    if (!current) return;
    if (!title) {
      input.value = current.title;
      uiMessage.warning("世界观条目名称不能为空。");
      return;
    }
    const categoryId = props.selection?.key.slice("worldbuilding:".length);
    if (!categoryId) {
      input.value = current.title;
      return;
    }
    emitWorldbuildingItemMutation(
      [
        {
          type: "worldbuildingItem.update",
          categoryId,
          id: itemId,
          patch: { title }
        }
      ],
      () => {
        input.value = title;
      }
    );
  }

  function resetCharacterNameDraft(): void {
    characterNameDraft.value = props.selection?.title ?? "";
  }

  function saveCharacterName(): void {
    const characterId = props.selection?.characterId;
    if (
      !options.host.currentIsCharacterDocument.value ||
      !characterId ||
      characterNameSaving.value
    ) {
      return;
    }
    const name = characterNameDraft.value.trim();
    if (!name) {
      resetCharacterNameDraft();
      uiMessage.warning("人物姓名不能为空。");
      return;
    }
    if (name === props.selection?.title) {
      characterNameDraft.value = name;
      return;
    }

    characterNameDraft.value = name;
    characterNameSaving.value = true;
    emit("renameCharacter", { characterId, name }, (succeeded) => {
      characterNameSaving.value = false;
      if (!succeeded) {
        resetCharacterNameDraft();
      }
    });
  }

  function handleCharacterNameKeydown(event: KeyboardEvent): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      resetCharacterNameDraft();
      input.blur();
    }
  }

  function resetStructureTitleDraft(): void {
    structureTitleDraft.value =
      options.host.currentStructureTitleTarget.value?.title ?? "";
  }

  function saveStructureTitle(): void {
    const target = options.host.currentStructureTitleTarget.value;
    if (!target || options.host.currentStructureTitleReadOnly.value) return;
    const title = structureTitleDraft.value.trim();
    if (!title) {
      resetStructureTitleDraft();
      uiMessage.warning(target.emptyMessage);
      return;
    }
    if (title === target.title) {
      structureTitleDraft.value = title;
      return;
    }

    structureTitleDraft.value = title;
    structureTitleSaving.value = true;
    emit(
      "renameStructureTitle",
      { kind: target.kind, id: target.id, title },
      (succeeded) => {
        structureTitleSaving.value = false;
        if (!succeeded) {
          resetStructureTitleDraft();
        }
      }
    );
  }

  function handleStructureTitleKeydown(event: KeyboardEvent): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      resetStructureTitleDraft();
      input.blur();
    }
  }

  async function selectRole(role: LongWorkspaceFileRole): Promise<void> {
    if (role === activeRole.value || role === pendingRole.value) return;
    const selectedFile = props.selection?.files.find(
      (file) => file.role === role
    );
    if (!selectedFile) {
      activeRole.value = role;
      activeFileId.value = null;
      return;
    }
    await selectWorkspaceFile(selectedFile.file.id);
  }

  async function selectWorkspaceFile(fileId: string): Promise<void> {
    if (fileId === activeFileId.value || fileId === pendingFileId.value) return;
    const selectedFile = props.selection?.files.find(
      ({ file }) => file.id === fileId
    );
    if (!selectedFile) return;
    const bookId = props.bookId;
    const selectionKey = props.selection?.key;
    pendingRole.value = selectedFile.role;
    pendingFileId.value = fileId;
    await loadWorkspaceDocument(selectedFile);
    if (
      props.bookId !== bookId ||
      props.selection?.key !== selectionKey ||
      pendingFileId.value !== fileId
    ) {
      return;
    }
    pendingRole.value = null;
    pendingFileId.value = null;
    const state =
      options.documentStates.value[
        options.stateKey(selectedFile.file.id, bookId)
      ];
    if (state?.loaded || Boolean(state?.content)) {
      activeRole.value = selectedFile.role;
      activeFileId.value = fileId;
      options.resetTextViewMode(selectedFile.readOnly);
    }
  }

  async function focusFile(fileId: string): Promise<boolean> {
    const selection = props.selection;
    if (!selection?.files.some(({ file }) => file.id === fileId)) return false;
    if (selection.worldbuildingFormat === "list") {
      const item = selection.worldbuildingItems?.find(
        ({ file }) => file.id === fileId
      );
      if (item) {
        await selectWorldbuildingItem(item.id);
      } else {
        await selectWorldbuildingOverview();
      }
    } else {
      const storyPlot = selection.storyPlots?.find(
        ({ file }) => file.id === fileId
      );
      if (storyPlot) {
        await selectPlotPointTab("storyline");
        await selectStoryPlot(storyPlot.id);
      } else {
        await selectWorkspaceFile(fileId);
      }
    }
    return currentSelectionFile.value?.file.id === fileId;
  }

  async function focusTarget(
    target: LongApprovalEditorFocus
  ): Promise<boolean> {
    if (target.bookLineVolumeId) {
      selectBookLineVolume(target.bookLineVolumeId);
    }
    if (target.foreshadowingThreadId || target.foreshadowingBeatId) {
      await nextTick();
      if (
        !(await foreshadowingWorkspace.value?.focusTarget(
          target.foreshadowingThreadId,
          target.foreshadowingBeatId
        ))
      ) {
        return false;
      }
    }
    return target.fileId ? focusFile(target.fileId) : true;
  }

  function captureNavigationSelection(): Partial<LongWorkspaceSelection> {
    const selection = props.selection;
    if (!selection) return {};
    const selectedFile = currentSelectionFile.value;
    return {
      ...(selection.worldbuildingFormat === "list"
        ? { worldbuildingItemId: activeWorldbuildingItemId.value }
        : {}),
      ...(options.host.currentIsBookLineWorkspace.value
        ? { bookLineVolumeId: activeBookLineVolumeId.value }
        : {}),
      ...(selectedFile ? { preferredFileId: selectedFile.file.id } : {})
    };
  }

  function requestSelectCharacter(characterId: LongCharacterId): void {
    if (
      characterId === props.selection?.characterId ||
      characterId === pendingCharacterId.value
    ) {
      return;
    }
    pendingCharacterId.value = characterId;
    emit("selectCharacter", characterId, (accepted) => {
      if (!accepted && pendingCharacterId.value === characterId) {
        pendingCharacterId.value = null;
      }
    });
  }

  watch(
    () =>
      [
        props.bookId,
        props.selection?.key,
        props.selection?.preferredRole,
        props.selection?.preferredFileId
      ] as const,
    () => {
      const preferredRole = props.selection?.preferredRole ?? "content";
      activeRole.value = preferredRole;
      activeFileId.value =
        props.selection?.preferredFileId ??
        props.selection?.files.find(({ role }) => role === preferredRole)?.file
          .id ??
        props.selection?.files[0]?.file.id ??
        null;
    },
    { immediate: true, flush: "sync" }
  );

  watch(
    () =>
      [
        props.bookId,
        props.selection?.key,
        props.selection?.worldbuildingItemId
      ] as const,
    ([, , itemId]) => {
      if (itemId !== undefined) {
        activeWorldbuildingItemId.value = itemId;
      }
    },
    { immediate: true, flush: "sync" }
  );

  watch(
    () =>
      [
        props.bookId,
        props.selection?.key,
        props.selection?.bookLineVolumeId
      ] as const,
    ([, , volumeId]) => {
      if (volumeId !== undefined) {
        activeBookLineVolumeId.value = volumeId;
      }
    },
    { immediate: true, flush: "sync" }
  );

  watch(
    () =>
      [
        props.bookId,
        props.selection?.key,
        props.selection?.plotPointId,
        activePlotPointTab.value,
        (props.selection?.storyPlots ?? []).map(({ id }) => id).join("\0")
      ] as const,
    () => {
      if (!options.host.currentIsPlotPointStoryline.value) return;
      void ensureActiveStoryPlotSelection();
    },
    { flush: "post" }
  );

  watch(
    () =>
      [
        props.bookId,
        props.selection?.characterId,
        props.selection?.title
      ] as const,
    resetCharacterNameDraft,
    { immediate: true, flush: "sync" }
  );

  watch(
    [() => props.bookId, () => props.selection?.key],
    () => {
      worldbuildingSelectionRequest += 1;
      pendingWorldbuildingItemId.value = null;
      pendingWorldbuildingOverview.value = false;
      pendingRole.value = null;
      pendingFileId.value = null;
    },
    { flush: "sync" }
  );

  watch(
    () => props.selection?.characterId ?? null,
    (characterId) => {
      if (
        pendingCharacterId.value !== null &&
        characterId === pendingCharacterId.value
      ) {
        pendingCharacterId.value = null;
      }
    },
    { flush: "sync" }
  );

  watch(
    () =>
      options.currentCharacterNavigationItems.value
        .map(({ id }) => id)
        .join("\u0000"),
    () => {
      if (
        pendingCharacterId.value &&
        !options.currentCharacterNavigationItems.value.some(
          ({ id }) => id === pendingCharacterId.value
        )
      ) {
        pendingCharacterId.value = null;
      }
    },
    { flush: "sync" }
  );

  watch(
    () =>
      [
        props.bookId,
        props.selection?.key,
        options.currentWorldbuildingItems.value
          .map(({ id }) => id)
          .join("\u0000")
      ] as const,
    () => {
      const items = options.currentWorldbuildingItems.value;
      if (
        pendingWorldbuildingItemId.value &&
        !items.some(({ id }) => id === pendingWorldbuildingItemId.value)
      ) {
        worldbuildingSelectionRequest += 1;
        pendingWorldbuildingItemId.value = null;
      }
      if (
        activeWorldbuildingItemId.value !== null &&
        !items.some(({ id }) => id === activeWorldbuildingItemId.value)
      ) {
        activeWorldbuildingItemId.value = null;
      }
    },
    { immediate: true, flush: "sync" }
  );

  return {
    activeRole,
    activeFileId,
    activeWorldbuildingItemId,
    pendingWorldbuildingItemId,
    pendingWorldbuildingOverview,
    activeStoryPlotId,
    pendingStoryPlotId,
    pendingStoryPlotDeleteId,
    pendingStoryPlotDeleteImpact,
    pendingStoryPlotDeletePreviewPending,
    pendingStoryPlotDeletePending,
    storyPlotActionMenuId,
    pendingCharacterId,
    pendingRole,
    pendingFileId,
    foreshadowingWorkspace,
    activeBookLineVolumeId,
    activeBookLineContentTab,
    activePlotPointTab,
    characterNameDraft,
    characterNameSaving,
    structureTitleDraft,
    structureTitleSaving,
    currentSelectionFile,
    selectWorldbuildingItem,
    selectWorldbuildingOverview,
    addWorldbuildingItem,
    emitWorldbuildingItemMutation,
    updateWorldbuildingItemContent,
    updateWorldbuildingItemTitle,
    selectBookLineOverview,
    selectBookLineVolume,
    selectBookLineContentTab,
    selectPlotPointTab,
    requestCreateVolume,
    forwardForeshadowingMutation,
    selectStoryPlot,
    ensureActiveStoryPlotSelection,
    addStoryPlot,
    updateStoryPlotTitle,
    openStoryPlotDelete,
    cancelStoryPlotDelete,
    confirmStoryPlotDelete,
    reorderStoryPlot,
    toggleStoryPlotActionMenu,
    closeStoryPlotActionMenu,
    reorderChapterCard,
    runStoryPlotMenuAction,
    resetCharacterNameDraft,
    saveCharacterName,
    handleCharacterNameKeydown,
    resetStructureTitleDraft,
    saveStructureTitle,
    handleStructureTitleKeydown,
    selectRole,
    selectWorkspaceFile,
    focusFile,
    focusTarget,
    captureNavigationSelection,
    requestSelectCharacter,
    createFirstCollectionItem
  };
}
