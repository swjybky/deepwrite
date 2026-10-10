<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import {
  type LongArcId,
  type LongChapterCardId,
  type LongCharacterId,
  type LongFileId,
  type LongWorkspaceImpactConfirmation,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceOperationBatch,
  type LongWorkspaceRoot,
  type LongWriteDocumentResult,
  type TextViewMode
} from "@deepwrite/contracts";
import { LONG_EDITOR_LIST_MIN_WIDTH } from "../utils/longEditorPanePreferences";
import { longDeletionDescription } from "../utils/longDeletionImpact";
import { longImpactConfirmationDescription } from "../utils/longImpactConfirmation";
import { countNonWhitespaceCharacters } from "../utils/boundedTextHistory";
import { handleHorizontalOverflowWheel } from "../utils/horizontalOverflow";
import { revealTextareaOffset } from "../utils/textareaMirror";
import { resolveEditorTextReferenceRange } from "../utils/editorTextReferences";
import type { EditorTextReference } from "../types/conversation";
import {
  isEditableLongFile,
  resolveLongWorkspaceApi,
  type LongForeshadowingFocus,
  type LongStructureMutationCompletion,
  type LongWorkspaceSelection
} from "../types/longWorkspace";
import AppIcon from "./AppIcon.vue";
import EditorPaneToggle from "./EditorPaneToggle.vue";
import EditorTextTools from "./EditorTextTools.vue";
import { useBodyTextFormatting } from "../composables/useBodyTextFormatting";
import { longBodyTextKind } from "../utils/bodyTextTarget";
import EditorSearchHighlight from "./EditorSearchHighlight.vue";
import LongCharacterNavigation from "./LongCharacterNavigation.vue";
import LongContinuityLedgerNavigation from "./LongContinuityLedgerNavigation.vue";
import LongEditorFooterMeta from "./LongEditorFooterMeta.vue";
import LongEditorDeleteDialogs from "./LongEditorDeleteDialogs.vue";
import LongEditorFindReplaceBar from "./LongEditorFindReplaceBar.vue";
import LongForeshadowingWorkspace from "./LongForeshadowingWorkspace.vue";
import LongManuscriptEditor from "./LongManuscriptEditor.vue";
import LongManuscriptNavigation from "./LongManuscriptNavigation.vue";
import LongPlotStoryListPane from "./LongPlotStoryListPane.vue";
import LongWorldbuildingNavigation from "./LongWorldbuildingNavigation.vue";
import MarkdownContent from "./MarkdownContent.vue";
import PreviewOutlinePopover from "./PreviewOutlinePopover.vue";
import {
  useLongEditorDeleteDialogs,
  type LongNavigationDeleteTarget
} from "../composables/useLongEditorDeleteDialogs";
import { useEditorSelectionInsertion } from "../composables/useEditorSelectionInsertion";
import {
  useLongEditorDocumentSession,
  type LongDocumentState,
  type LongVolumeOutlineDraft
} from "../composables/useLongEditorDocumentSession";
import { useEditorComposition } from "../composables/useEditorComposition";
import { useEditorFindReplace } from "../composables/useEditorFindReplace";
import { useLongEditorEntrySearch } from "../composables/useLongEditorEntrySearch";
import { useLongEditorHistory } from "../composables/useLongEditorHistory";
import { useLongEditorPaneResize } from "../composables/useLongEditorPaneResize";
import {
  longEditorScrollMemoryKey,
  useLongEditorScrollMemory
} from "../composables/useLongEditorScrollMemory";
import { useLongEditorRecovery } from "../composables/useLongEditorRecovery";
import {
  useLongEditorStructureSelection,
  type LongEditorStructureHost,
  type LongStructureTitleTarget
} from "../composables/useLongEditorStructureSelection";
import { useTextViewMode } from "../composables/useTextViewMode";

const t = createScopedTranslator("components.longWorkspaceEditor");

const props = defineProps<{
  bookId: string;
  selection: LongWorkspaceSelection | null;
  workspaceIndex: LongWorkspaceIndexSnapshot | null;
  locked?: boolean;
  lockedReason?: string | undefined;
  rightPane?: boolean;
  rightPaneCollapsed?: boolean;
  defaultViewMode: TextViewMode;
  autoSaveEnabled: boolean;
}>();

const emit = defineEmits<{
  collapse: [];
  toggleRight: [];
  saved: [result: LongWriteDocumentResult];
  insertSelection: [reference: EditorTextReference];
  contextChange: [
    context: {
      bookId: string;
      fileId: LongFileId;
    } | null
  ];
  selectCharacter: [
    characterId: LongCharacterId,
    done?: (accepted: boolean) => void
  ];
  selectPlotPoint: [plotPointId: LongArcId];
  selectChapterCard: [chapterCardId: LongChapterCardId];
  selectEntrySearchResult: [fileId: string];
  renameCharacter: [
    input: { characterId: LongCharacterId; name: string },
    completion: (succeeded: boolean) => void
  ];
  renameStructureTitle: [
    input: {
      kind: "worldbuilding" | "volume" | "plotPoint" | "chapterCard";
      id: string;
      title: string;
    },
    completion: (succeeded: boolean) => void
  ];
  createCharacter: [];
  createWorldbuildingItem: [];
  createPlotPoint: [];
  createChapterCard: [];
  createVolume: [];
  previewDeleteStructure: [
    input: {
      kind: "character" | "volume" | "plotPoint" | "chapterCard";
      id: string;
      title: string;
    },
    completion: (impact?: LongWorkspaceImpactConfirmation) => void
  ];
  deleteStructure: [
    input: {
      kind: "character" | "volume" | "plotPoint" | "chapterCard";
      id: string;
      title: string;
      expectedImpact: LongWorkspaceImpactConfirmation;
    },
    completion: (
      succeeded: boolean,
      changedImpact?: LongWorkspaceImpactConfirmation
    ) => void
  ];
  saveVolumeOutline: [
    input: { volumeId: string; outline: string },
    completion: (succeeded: boolean) => void
  ];
  savePlotPointContent: [
    input: {
      plotPointId: LongArcId;
      field: "summary";
      content: string;
    },
    completion: (succeeded: boolean) => void
  ];
  mutation: [
    batch: LongWorkspaceOperationBatch,
    completion: LongStructureMutationCompletion
  ];
  previewMutation: [
    batch: LongWorkspaceOperationBatch,
    completion: (impact?: LongWorkspaceImpactConfirmation) => void
  ];
}>();

const documentStates = ref<Record<string, LongDocumentState>>({});
const volumeOutlineDrafts = ref<Record<string, LongVolumeOutlineDraft>>({});
const plotPointSummaryDrafts = ref<Record<string, LongVolumeOutlineDraft>>({});
const pendingWorldbuildingDeleteId = ref<string | null>(null);
const editorInput = ref<HTMLTextAreaElement | null>(null);
const editorComposition = useEditorComposition();
const documentPreview = ref<HTMLElement | null>(null);
const { resetToDefault, setViewMode, viewMode } = useTextViewMode({
  defaultMode: () => props.defaultViewMode
});
function setEditorInputElement(element: HTMLTextAreaElement | null): void {
  editorInput.value = element;
}

function setDocumentPreviewElement(element: HTMLElement | null): void {
  documentPreview.value = element;
}

const currentIsBookLineWorkspace = computed(
  () =>
    props.selection?.key === "plot-design:book-line" &&
    props.selection.root === "plot_design"
);
const currentIsPlotPointWorkspace = computed(
  () =>
    Boolean(props.selection?.key.startsWith("plot-design:plot-points:")) &&
    props.selection?.root === "plot_design"
);
const currentIsChapterCardWorkspace = computed(
  () =>
    Boolean(props.selection?.key.startsWith("plot-design:chapter-cards:")) &&
    props.selection?.root === "plot_design"
);
const currentIsForeshadowingWorkspace = computed(
  () =>
    props.selection?.key === "plot-design:foreshadowing" &&
    props.selection.root === "plot_design"
);
const currentIsCharacterGroup = computed(
  () =>
    props.selection?.root === "character_design" &&
    Boolean(props.selection.characterGroup)
);
const currentIsCharacterDocument = computed(
  () =>
    props.selection?.root === "character_design" &&
    Boolean(props.selection.characterId)
);
const currentEmptyCollection = computed<{
  icon: "file" | "user";
  title: string;
  description: string;
  buttonLabel: string;
  action: "character" | "plotPoint" | "chapterCard";
} | null>(() => {
  const selection = props.selection;
  if (currentIsCharacterGroup.value && selection?.characterTabs?.length === 0) {
    return {
      icon: "user",
      title: t("noValueYet", {
        arg0: selection.title
      }),
      description: currentUsesLeftTreeCharacter.value
        ? t("createACharacterThenSelectItInTheLeft")
        : t("createACharacterThenUseEntryNavigationToEdit"),
      buttonLabel: t("createFirstCharacter"),
      action: "character"
    };
  }
  if (
    currentIsPlotPointWorkspace.value &&
    selection?.plotPointTabs?.length === 0
  ) {
    return {
      icon: "file",
      title: t("noPlotPointsYet"),
      description: currentUsesLeftTreePlot.value
        ? t("createAPlotPointThenSelectItInThe")
        : t("createAPlotPointThenUseEntryNavigationTo"),
      buttonLabel: t("createFirstPlotPoint"),
      action: "plotPoint"
    };
  }
  if (
    currentIsChapterCardWorkspace.value &&
    selection?.chapterCardTabs?.length === 0
  ) {
    return {
      icon: "file",
      title: t("noChapterCardsYet"),
      description: currentUsesLeftTreePlot.value
        ? t("createAChapterCardThenSelectItInThe")
        : t("createAChapterCardThenUseEntryNavigationTo"),
      buttonLabel: t("createFirstChapterCard"),
      action: "chapterCard"
    };
  }
  return null;
});

function createFirstCollectionItem(): void {
  const action = currentEmptyCollection.value?.action;
  if (action === "character") {
    emit("createCharacter");
  } else if (action === "plotPoint") {
    emit("createPlotPoint");
  } else if (action === "chapterCard") {
    emit("createChapterCard");
  }
}
const currentStructureTitleTarget = computed<LongStructureTitleTarget | null>(
  () => {
    if (currentIsPlotPointWorkspace.value && currentPlotPoint.value) {
      return {
        kind: "plotPoint",
        id: currentPlotPoint.value.id,
        title: currentPlotPoint.value.title,
        inputLabel: t("plotPointTitle"),
        emptyMessage: t("plotPointTitleIsRequired")
      };
    }
    if (currentIsVolumeOutline.value && currentBookLineVolume.value) {
      return {
        kind: "volume",
        id: currentBookLineVolume.value.id,
        title: currentBookLineVolume.value.title,
        inputLabel: t("volumeName"),
        emptyMessage: t("volumeNameIsRequired")
      };
    }
    if (
      (currentIsChapterCardWorkspace.value ||
        props.selection?.root === "draft") &&
      props.selection?.chapterCardId
    ) {
      const chapter = props.workspaceIndex?.plot.chapterCards.find(
        ({ id }) => id === props.selection?.chapterCardId
      );
      if (chapter) {
        return {
          kind: "chapterCard",
          id: chapter.id,
          title: chapter.title,
          inputLabel: t("chapterCardTitle"),
          emptyMessage: t("chapterCardTitleIsRequired")
        };
      }
    }
    if (
      props.selection?.root === "worldbuilding" &&
      props.selection.key.startsWith("worldbuilding:")
    ) {
      const categoryId = props.selection.key.slice("worldbuilding:".length);
      const category = props.workspaceIndex?.worldbuilding.find(
        ({ id }) => id === categoryId
      );
      if (category) {
        return {
          kind: "worldbuilding",
          id: category.id,
          title: category.title,
          inputLabel: t("worldbuildingCategoryName"),
          emptyMessage: t("worldbuildingCategoryNameIsRequired")
        };
      }
    }
    return null;
  }
);
const currentStructureTitleReadOnly = computed(() => {
  const target = currentStructureTitleTarget.value;
  if (!target) return true;
  return Boolean(
    props.locked || currentReadOnly.value || structureTitleSaving.value
  );
});
const orderedBookLineVolumes = computed(() =>
  [...(props.workspaceIndex?.plot.volumes ?? [])].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  )
);
const currentBookLineVolume = computed(
  () =>
    orderedBookLineVolumes.value.find(
      ({ id }) => id === activeBookLineVolumeId.value
    ) ?? null
);
const currentPlotPoint = computed(
  () =>
    props.workspaceIndex?.plot.arcs.find(
      ({ id }) => id === props.selection?.plotPointId
    ) ?? null
);
const currentChapterCard = computed(
  () =>
    props.workspaceIndex?.plot.chapterCards.find(
      ({ id }) => id === props.selection?.chapterCardId
    ) ?? null
);
const currentNavigationDeleteTarget =
  computed<LongNavigationDeleteTarget | null>(() => {
    const index = props.workspaceIndex;
    const selection = props.selection;
    if (!index || !selection) return null;
    if (currentIsCharacterGroup.value && selection.characterId) {
      const character = index.characters.find(
        ({ id }) => id === selection.characterId
      );
      if (!character) return null;
      return {
        kind: "character",
        id: character.id,
        title: character.name,
        label: t("characters"),
        description: longDeletionDescription(index, "character", character.id)
      };
    }
    if (currentIsBookLineWorkspace.value && currentBookLineVolume.value) {
      const volume = currentBookLineVolume.value;
      return {
        kind: "volume",
        id: volume.id,
        title: volume.title,
        label: t("volume"),
        description: longDeletionDescription(index, "volume", volume.id)
      };
    }
    if (currentIsPlotPointWorkspace.value && currentPlotPoint.value) {
      const plotPoint = currentPlotPoint.value;
      return {
        kind: "plotPoint",
        id: plotPoint.id,
        title: plotPoint.title,
        label: t("plotPoint"),
        description: longDeletionDescription(index, "plotPoint", plotPoint.id)
      };
    }
    if (currentIsChapterCardWorkspace.value && currentChapterCard.value) {
      const chapterCard = currentChapterCard.value;
      return {
        kind: "chapterCard",
        id: chapterCard.id,
        title: chapterCard.title,
        label: t("chapterCard"),
        description: longDeletionDescription(
          index,
          "chapterCard",
          chapterCard.id
        )
      };
    }
    return null;
  });
const currentVolumeOutlineDraft = computed(() => {
  const volumeId =
    currentIsBookLineWorkspace.value &&
    activeBookLineContentTab.value === "outline"
      ? currentBookLineVolume.value?.id
      : undefined;
  return volumeId ? volumeOutlineDrafts.value[volumeId] : undefined;
});
const currentPlotPointDraft = computed(() => {
  const plotPointId = currentPlotPoint.value?.id;
  if (!plotPointId || activePlotPointTab.value !== "summary") {
    return undefined;
  }
  return plotPointSummaryDrafts.value[plotPointId];
});
const currentChapterCardCommitted = computed(() => {
  const chapterCardId = currentChapterCard.value?.id;
  return Boolean(
    chapterCardId &&
    props.workspaceIndex?.chapters.some(
      (entry) =>
        entry.chapterCardId === chapterCardId && entry.commitId !== null
    )
  );
});

const currentIsCommittedEditableDocument = computed(
  () =>
    currentChapterCardCommitted.value &&
    ((props.selection?.root === "draft" &&
      currentSelectionFile.value?.role === "body") ||
      (currentIsChapterCardWorkspace.value &&
        currentSelectionFile.value?.role === "card"))
);
const currentCommittedEditNotice = computed(() =>
  currentIsChapterCardWorkspace.value
    ? t("thisChapterCardHasContinuityRecordsItCanStill")
    : t("thisChapterHasContinuityRecordsTheyAreForReference")
);
const currentIsVolumeOutline = computed(
  () =>
    currentIsBookLineWorkspace.value &&
    currentBookLineVolume.value !== null &&
    activeBookLineContentTab.value === "outline"
);
const currentIsVolumeForeshadowing = computed(
  () =>
    currentIsBookLineWorkspace.value &&
    currentBookLineVolume.value !== null &&
    activeBookLineContentTab.value === "foreshadowing"
);
const currentIsPlotPointSummary = computed(
  () =>
    currentIsPlotPointWorkspace.value &&
    currentPlotPoint.value !== null &&
    activePlotPointTab.value === "summary"
);
const currentIsPlotPointStoryline = computed(
  () =>
    currentIsPlotPointWorkspace.value &&
    currentPlotPoint.value !== null &&
    activePlotPointTab.value === "storyline"
);
const currentIsPlotPointForeshadowing = computed(
  () =>
    currentIsPlotPointWorkspace.value &&
    currentPlotPoint.value !== null &&
    activePlotPointTab.value === "foreshadowing"
);
const currentIsForeshadowingView = computed(
  () =>
    currentIsForeshadowingWorkspace.value ||
    currentIsVolumeForeshadowing.value ||
    currentIsPlotPointForeshadowing.value
);
const currentForeshadowingMode = computed<"overview" | "volume" | "plotPoint">(
  () =>
    currentIsForeshadowingWorkspace.value
      ? "overview"
      : currentIsVolumeForeshadowing.value
        ? "volume"
        : "plotPoint"
);
const currentForeshadowingVolumeId = computed(() => {
  if (currentIsVolumeForeshadowing.value) {
    return currentBookLineVolume.value?.id;
  }
  if (currentIsPlotPointForeshadowing.value) {
    return currentPlotPoint.value?.volumeId;
  }
  return undefined;
});
const currentIsChapterCardContent = computed(
  () => currentIsChapterCardWorkspace.value && currentChapterCard.value !== null
);
const currentIsStructuredText = computed(
  () => currentIsVolumeOutline.value || currentIsPlotPointSummary.value
);
const currentStoryPlots = computed(() => props.selection?.storyPlots ?? []);
const currentStoryPlot = computed(
  () =>
    currentStoryPlots.value.find(({ id }) => id === activeStoryPlotId.value) ??
    null
);
const pendingStoryPlotDelete = computed(() => {
  const storyPlot = currentStoryPlots.value.find(
    ({ id }) => id === pendingStoryPlotDeleteId.value
  );
  if (!storyPlot) return null;
  const fallback = t("thisStoryEventAndItsManuscriptFileWillBe");
  return {
    ...storyPlot,
    description: pendingStoryPlotDeleteImpact.value
      ? longImpactConfirmationDescription(
          pendingStoryPlotDeleteImpact.value,
          fallback
        )
      : fallback,
    previewPending: pendingStoryPlotDeletePreviewPending.value,
    pending: pendingStoryPlotDeletePending.value,
    canConfirm: Boolean(pendingStoryPlotDeleteImpact.value)
  };
});
const isDocumentContentBusy = computed(() => {
  if (isDocumentSwitchPending.value) return true;
  if (currentIsStructuredText.value || currentIsForeshadowingView.value) {
    return false;
  }
  const state = currentState.value;
  return Boolean(state?.loading || (state && !state.loaded));
});
const currentReadOnly = computed(() => {
  const selectedFile = currentSelectionFile.value;
  return Boolean(
    props.locked ||
    selectedFile?.readOnly ||
    (selectedFile && !isEditableLongFile(selectedFile.file))
  );
});
const currentDirty = computed(() => {
  if (currentIsVolumeForeshadowing.value) {
    const volumeId = currentBookLineVolume.value?.id;
    const draft = volumeId ? volumeOutlineDrafts.value[volumeId] : undefined;
    return Boolean(draft && draft.content !== draft.savedContent);
  }
  if (currentIsPlotPointForeshadowing.value) {
    const plotPointId = currentPlotPoint.value?.id;
    const summaryDraft = plotPointId
      ? plotPointSummaryDrafts.value[plotPointId]
      : undefined;
    return Boolean(
      summaryDraft && summaryDraft.content !== summaryDraft.savedContent
    );
  }
  if (currentIsStructuredText.value) {
    const draft =
      currentPlotPointDraft.value ?? currentVolumeOutlineDraft.value;
    return Boolean(draft && draft.content !== draft.savedContent);
  }
  return (
    Boolean(currentState.value?.loaded) &&
    currentState.value?.content !== currentState.value?.savedContent
  );
});
const currentIsWorldbuildingList = computed(
  () =>
    props.selection?.root === "worldbuilding" &&
    props.selection.worldbuildingFormat === "list"
);
const currentWorldbuildingItemLayout = computed(
  () =>
    props.workspaceIndex?.featureSettings.worldbuildingItemLayout ?? "top-tabs"
);
const currentUsesLeftTreeWorldbuilding = computed(
  () =>
    currentIsWorldbuildingList.value &&
    currentWorldbuildingItemLayout.value === "left-tree"
);
const currentUsesTopWorldbuildingTabs = computed(
  () =>
    currentIsWorldbuildingList.value &&
    currentWorldbuildingItemLayout.value === "top-tabs"
);
const currentUsesRightWorldbuildingList = computed(
  () =>
    currentIsWorldbuildingList.value &&
    currentWorldbuildingItemLayout.value === "right-list"
);
const currentSharedItemLayout = computed(
  () =>
    props.workspaceIndex?.featureSettings.characterAndContinuityItemLayout ??
    "top-tabs"
);
const currentPlotItemLayout = computed(
  () => props.workspaceIndex?.featureSettings.plotItemLayout ?? "top-tabs"
);
const currentUsesLeftTreeCharacter = computed(
  () =>
    currentIsCharacterGroup.value &&
    currentSharedItemLayout.value === "left-tree"
);
const currentUsesLeftTreePlot = computed(
  () =>
    (currentIsBookLineWorkspace.value ||
      currentIsPlotPointWorkspace.value ||
      currentIsChapterCardWorkspace.value) &&
    currentPlotItemLayout.value === "left-tree"
);
const currentUsesLeftTreeContinuity = computed(
  () =>
    props.selection?.root === "continuity_ledger" &&
    currentSharedItemLayout.value === "left-tree"
);
const currentUsesTopCharacterTabs = computed(
  () =>
    currentIsCharacterGroup.value &&
    currentSharedItemLayout.value === "top-tabs"
);
const currentUsesRightCharacterList = computed(
  () =>
    currentIsCharacterGroup.value &&
    currentSharedItemLayout.value === "right-list"
);
const currentCharacterNavigationItems = computed(
  () => props.selection?.characterTabs ?? []
);
const currentUsesTopPlotTabs = computed(
  () =>
    (currentIsBookLineWorkspace.value ||
      currentIsPlotPointWorkspace.value ||
      currentIsChapterCardWorkspace.value) &&
    currentPlotItemLayout.value === "top-tabs"
);
const currentUsesRightBookLineList = computed(
  () =>
    currentIsBookLineWorkspace.value &&
    currentPlotItemLayout.value === "right-list"
);
const currentUsesRightPlotPointList = computed(
  () =>
    currentIsPlotPointWorkspace.value &&
    currentPlotItemLayout.value === "right-list"
);
const currentUsesRightChapterCardList = computed(
  () =>
    currentIsChapterCardWorkspace.value &&
    currentPlotItemLayout.value === "right-list"
);
const currentUsesTopContinuityTabs = computed(
  () =>
    props.selection?.root === "continuity_ledger" &&
    currentSharedItemLayout.value === "top-tabs"
);
const currentUsesRightContinuityList = computed(
  () =>
    props.selection?.root === "continuity_ledger" &&
    currentSharedItemLayout.value === "right-list"
);
const currentContinuityNavigationItems = computed(() =>
  props.selection?.root === "continuity_ledger"
    ? props.selection.files.map((file) => ({
        id: file.file.id,
        label: file.label
      }))
    : []
);
const currentUsesAnyRightEntryList = computed(
  () =>
    currentUsesRightWorldbuildingList.value ||
    currentUsesRightCharacterList.value ||
    currentUsesRightBookLineList.value ||
    currentUsesRightPlotPointList.value ||
    currentUsesRightChapterCardList.value ||
    currentUsesRightContinuityList.value
);
const showGenericFileTabs = computed(
  () =>
    Boolean(props.selection && props.selection.files.length > 1) &&
    !currentIsWorldbuildingList.value &&
    !currentIsPlotPointWorkspace.value &&
    !currentIsBookLineWorkspace.value &&
    !currentIsChapterCardWorkspace.value &&
    !currentUsesTopContinuityTabs.value &&
    !currentUsesRightContinuityList.value &&
    !currentUsesLeftTreeContinuity.value
);
const currentWorldbuildingListState = computed<{
  items: Array<{ id: string; title: string }>;
  error: string | null;
}>(() => {
  if (!currentIsWorldbuildingList.value) {
    return { items: [], error: null };
  }
  return {
    items: props.selection?.worldbuildingItems ?? [],
    error: null
  };
});
const currentWorldbuildingItems = computed(
  () => currentWorldbuildingListState.value.items
);
const currentWorldbuildingItem = computed(
  () =>
    currentWorldbuildingItems.value.find(
      ({ id }) => id === activeWorldbuildingItemId.value
    ) ?? null
);
const currentVisibleContent = computed(() => {
  if (currentIsPlotPointSummary.value) {
    return currentPlotPointDraft.value?.content ?? "";
  }
  if (currentIsVolumeOutline.value) {
    return currentVolumeOutlineDraft.value?.content ?? "";
  }
  if (isDocumentSwitchPending.value) {
    return displayDocumentState.value?.content ?? "";
  }
  return currentState.value?.content ?? "";
});
const currentDocumentTitle = computed(
  () =>
    (currentIsWorldbuildingList.value &&
    activeWorldbuildingItemId.value === null
      ? t("overview")
      : undefined) ??
    (currentIsChapterCardWorkspace.value
      ? currentChapterCard.value?.title
      : undefined) ??
    (currentIsPlotPointWorkspace.value
      ? currentPlotPoint.value?.title
      : undefined) ??
    (currentIsBookLineWorkspace.value
      ? currentBookLineVolume.value?.title
      : undefined) ??
    (currentIsBookLineWorkspace.value
      ? t("overallOutline")
      : (props.selection?.title ?? ""))
);
const currentDocumentFormat = computed(() =>
  currentIsChapterCardContent.value
    ? t("chapterCardContent")
    : currentIsPlotPointStoryline.value
      ? t("storyEvent")
      : currentIsPlotPointSummary.value
        ? t("summary")
        : currentIsVolumeOutline.value
          ? t("volumeOutline")
          : currentIsBookLineWorkspace.value
            ? t("overallOutline")
            : (currentSelectionFile.value?.label ?? "")
);
const currentSaving = computed(
  () =>
    characterNameSaving.value ||
    structureTitleSaving.value ||
    Boolean(
      currentPlotPointDraft.value?.saving ??
      currentVolumeOutlineDraft.value?.saving ??
      currentState.value?.saving ??
      false
    )
);
const canUseTextTools = computed(
  () =>
    !currentIsForeshadowingView.value &&
    (Boolean(currentState.value?.loaded) || currentIsStructuredText.value) &&
    Boolean(
      !currentIsWorldbuildingList.value ||
      currentWorldbuildingListState.value.error ||
      currentSelectionFile.value
    ) &&
    Boolean(!currentIsPlotPointStoryline.value || currentStoryPlot.value)
);
const hasUnsavedChanges = computed(
  () =>
    Object.values(documentStates.value).some(
      (state) => state.loaded && state.content !== state.savedContent
    ) ||
    Object.values(volumeOutlineDrafts.value).some(
      (draft) => draft.content !== draft.savedContent
    ) ||
    Object.values(plotPointSummaryDrafts.value).some(
      (draft) => draft.content !== draft.savedContent
    )
);

function updateVisibleContent(content: string): void {
  const plotPoint = currentPlotPoint.value;
  if (
    currentIsPlotPointWorkspace.value &&
    plotPoint &&
    activePlotPointTab.value === "summary"
  ) {
    const persistedContent = plotPoint.summary ?? "";
    let current = plotPointSummaryDrafts.value[plotPoint.id];
    if (!current) {
      current = {
        content,
        savedContent: persistedContent,
        saving: false
      };
      plotPointSummaryDrafts.value[plotPoint.id] = current;
      return;
    }
    current.content = content;
    return;
  }
  const volume = currentBookLineVolume.value;
  if (currentIsVolumeOutline.value && volume) {
    let current = volumeOutlineDrafts.value[volume.id];
    if (!current) {
      current = {
        content,
        savedContent: volume.summary,
        saving: false
      };
      volumeOutlineDrafts.value[volume.id] = current;
      return;
    }
    current.content = content;
    return;
  }
  const item = currentWorldbuildingItem.value;
  if (
    currentIsWorldbuildingList.value &&
    !currentWorldbuildingListState.value.error &&
    item
  ) {
    updateWorldbuildingItemContent(item.id, content);
    return;
  }
  updateCurrentContent(content);
}

async function saveVolumeOutline(volumeId: string): Promise<boolean> {
  const draft = volumeOutlineDrafts.value[volumeId];
  if (!draft || draft.saving || draft.content === draft.savedContent) {
    return Boolean(draft && !draft.saving);
  }
  const submittedContent = draft.content;
  volumeOutlineDrafts.value = {
    ...volumeOutlineDrafts.value,
    [volumeId]: { ...draft, saving: true }
  };
  return await new Promise<boolean>((resolve) => {
    emit(
      "saveVolumeOutline",
      { volumeId, outline: submittedContent },
      (succeeded) => {
        const latest = volumeOutlineDrafts.value[volumeId];
        if (latest) {
          volumeOutlineDrafts.value = {
            ...volumeOutlineDrafts.value,
            [volumeId]: {
              ...latest,
              ...(succeeded ? { savedContent: submittedContent } : {}),
              saving: false
            }
          };
        }
        resolve(succeeded);
      }
    );
  });
}

async function savePlotPointContent(
  plotPointId: LongArcId,
  field: "summary" = "summary"
): Promise<boolean> {
  const draft = plotPointSummaryDrafts.value[plotPointId];
  if (!draft || draft.saving || draft.content === draft.savedContent) {
    return Boolean(draft && !draft.saving);
  }
  const submittedContent = draft.content;
  plotPointSummaryDrafts.value = {
    ...plotPointSummaryDrafts.value,
    [plotPointId]: { ...draft, saving: true }
  };
  return await new Promise<boolean>((resolve) => {
    emit(
      "savePlotPointContent",
      { plotPointId, field, content: submittedContent },
      (succeeded) => {
        const latest = plotPointSummaryDrafts.value[plotPointId];
        if (latest) {
          plotPointSummaryDrafts.value = {
            ...plotPointSummaryDrafts.value,
            [plotPointId]: {
              ...latest,
              ...(succeeded ? { savedContent: submittedContent } : {}),
              saving: false
            }
          };
        }
        resolve(succeeded);
      }
    );
  });
}

function stateKey(fileId: string, bookId = props.bookId): string {
  return `${bookId}\u0000${fileId}`;
}

let volumeDraftBookId = "";

const {
  longEditorDocumentElement,
  storyPlotLayoutElement,
  entryListWidth,
  storyPlotListWidth,
  entryListMaxWidth,
  storyPlotListMaxWidth,
  resizingLongEditorPane,
  entryListGridStyle,
  storyPlotListGridStyle,
  startLongEditorPaneResize,
  handleLongEditorPaneResizeKeydown
} = useLongEditorPaneResize({
  currentUsesAnyRightEntryList,
  currentIsPlotPointStoryline
});

const {
  clearRecoveryRecordForKey,
  readRecoveryRecord,
  persistRecoveryForKey,
  scheduleRecoveryWrite
} = useLongEditorRecovery({
  documentStates,
  hasUnsavedChanges
});

const structureHost = {} as LongEditorStructureHost;
const {
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
  updateWorldbuildingItemContent,
  updateWorldbuildingItemTitle,
  selectBookLineOverview,
  selectBookLineVolume,
  selectBookLineContentTab,
  selectPlotPointTab,
  requestCreateVolume,
  forwardForeshadowingMutation,
  selectStoryPlot,
  addStoryPlot,
  updateStoryPlotTitle,
  cancelStoryPlotDelete,
  confirmStoryPlotDelete,
  toggleStoryPlotActionMenu,
  closeStoryPlotActionMenu,
  reorderChapterCard,
  runStoryPlotMenuAction,
  saveCharacterName,
  handleCharacterNameKeydown,
  resetStructureTitleDraft,
  saveStructureTitle,
  handleStructureTitleKeydown,
  selectWorkspaceFile,
  focusFile,
  focusTarget,
  captureNavigationSelection,
  requestSelectCharacter
} = useLongEditorStructureSelection({
  props,
  emit,
  host: structureHost,
  currentWorldbuildingItems,
  currentWorldbuildingListState,
  currentStoryPlots,
  currentPlotPoint,
  orderedBookLineVolumes,
  currentCharacterNavigationItems,
  documentStates,
  resetTextViewMode: resetToDefault,
  stateKey
});

const {
  workspaceSavePending,
  currentState,
  isDocumentSwitchPending,
  displayDocumentState,
  showEditorLoading,
  showEditorLoadError,
  loadWorkspaceDocument,
  loadSelectedDocument,
  ensureDocumentsLoaded,
  saveCurrentDocument,
  saveAllChanges
} = useLongEditorDocumentSession({
  props,
  emit,
  documentStates,
  volumeOutlineDrafts,
  plotPointSummaryDrafts,
  currentSelectionFile,
  currentReadOnly,
  currentDirty,
  currentIsStructuredText,
  currentIsWorldbuildingList,
  viewMode,
  editorInput,
  isComposing: editorComposition.isComposing,
  activeWorldbuildingItemId,
  activeBookLineVolumeId,
  activeBookLineContentTab,
  activePlotPointTab,
  activeStoryPlotId,
  saveVolumeOutline,
  savePlotPointContent,
  readRecoveryRecord,
  clearRecoveryRecordForKey,
  persistRecoveryForKey
});
const activeEditorScrollMemoryKey = computed(() =>
  longEditorScrollMemoryKey({
    bookId: props.bookId,
    selectionKey: props.selection?.key ?? "",
    fileId: currentSelectionFile.value?.file.id ?? "",
    worldbuildingItemId:
      props.selection?.worldbuildingItemId ??
      activeWorldbuildingItemId.value ??
      "",
    bookLineVolumeId: activeBookLineVolumeId.value ?? "",
    bookLineContentTab: activeBookLineContentTab.value,
    plotPointId: props.selection?.plotPointId ?? "",
    plotPointTab: activePlotPointTab.value,
    storyPlotId: activeStoryPlotId.value ?? "",
    chapterCardId: props.selection?.chapterCardId ?? ""
  })
);
const currentReferenceDocumentId = computed(
  () => currentSelectionFile.value?.file.id ?? activeEditorScrollMemoryKey.value
);
const {
  closeSelectionAction,
  handleEditorContextMenu,
  handlePreviewContextMenu
} = useEditorSelectionInsertion({
  history: {
    canUndo: () => canUndo.value,
    canRedo: () => canRedo.value,
    undo: () => undo(),
    redo: () => redo()
  },
  source: () => {
    const selection = props.selection;
    if (!selection || !canUseTextTools.value) return undefined;
    const format = currentDocumentFormat.value;
    return {
      resourceId: `${props.bookId}:${selection.key}`,
      document: {
        id: currentReferenceDocumentId.value,
        title: currentDocumentTitle.value,
        path: [...selection.breadcrumbs, ...(format ? [format] : [])],
        content: currentVisibleContent.value
      }
    };
  },
  insert: (reference) => emit("insertSelection", reference)
});
const {
  handleScroll: handleEditorScroll,
  rememberScroll: rememberCurrentEditorScroll,
  restoreScroll: restoreCurrentEditorScroll
} = useLongEditorScrollMemory({
  documentKey: () => activeEditorScrollMemoryKey.value,
  viewMode,
  editorInput,
  documentPreview
});
const characterCount = ref(
  countNonWhitespaceCharacters(currentVisibleContent.value)
);
let countedVisibleContent = currentVisibleContent.value;
watch(
  currentVisibleContent,
  (nextContent) => {
    if (nextContent === countedVisibleContent) return;
    countedVisibleContent = nextContent;
    characterCount.value = countNonWhitespaceCharacters(nextContent);
  },
  { flush: "post" }
);

const historyHost = { updateVisibleContent };

const {
  canUndo,
  canRedo,
  resetEditorHistory,
  handleEditorBeforeInput,
  handleEditorInput,
  handleEditorCompositionStart,
  handleEditorCompositionEnd,
  recordProgrammaticChange,
  updateVisibleCharacterCount,
  undo,
  redo,
  updateCurrentContent
} = useLongEditorHistory({
  documentStates,
  currentState,
  currentSelectionFile,
  currentVisibleContent,
  currentReadOnly,
  isDocumentContentBusy,
  isDocumentSwitchPending,
  canUseTextTools,
  viewMode,
  editorInput,
  composition: editorComposition,
  characterCount,
  stateKey,
  updateVisibleContent: (content) => historyHost.updateVisibleContent(content),
  scrollEditorToRange: (input, start) => revealTextareaOffset(input, start),
  clearRecoveryRecordForKey,
  scheduleRecoveryWrite
});

const {
  visible: bodyFormatVisible,
  disabled: bodyFormatDisabled,
  format: formatBody
} = useBodyTextFormatting({
  kind: () =>
    longBodyTextKind(props.selection?.root, currentSelectionFile.value?.role),
  content: () => currentVisibleContent.value,
  disabled: () =>
    currentReadOnly.value ||
    currentSaving.value ||
    isDocumentContentBusy.value ||
    isDocumentSwitchPending.value ||
    !canUseTextTools.value,
  documentKey: () =>
    `${props.bookId}:${currentSelectionFile.value?.file.id ?? ""}`,
  editorInput: () => editorInput.value,
  recordChange: recordProgrammaticChange,
  updateContent: (content, delta) => {
    updateVisibleContent(content);
    updateVisibleCharacterCount(content, delta);
  }
});

const {
  findPanelElement,
  findInput,
  findPanelOpen,
  findPanelMode,
  searchQuery,
  replacementText,
  currentMatchIndex,
  searchMatches,
  searchResultLabel,
  closeFindPanel,
  dismissFindPanel,
  toggleFindPanel,
  findMatch,
  handleFindInput,
  replaceCurrentMatch,
  replaceAllMatches,
  handleEditorKeydown
} = useEditorFindReplace({
  content: () => currentVisibleContent.value,
  readOnly: () => currentReadOnly.value,
  canOpen: () => canUseTextTools.value,
  editorInput: () => editorInput.value,
  showEditor: () => setViewMode("edit"),
  replaceContent: (nextContent, selectionAfter) => {
    const delta = recordProgrammaticChange(nextContent, selectionAfter);
    historyHost.updateVisibleContent(nextContent);
    updateVisibleCharacterCount(nextContent, delta);
  },
  undo,
  redo,
  isComposing: () => editorComposition.isComposing.value
});
const entrySearchScope = computed<LongWorkspaceRoot>(
  () => props.selection?.root ?? "worldbuilding"
);
const entrySearch = useLongEditorEntrySearch({
  bookId: () => props.bookId,
  scope: entrySearchScope,
  api: resolveLongWorkspaceApi,
  navigate: (fileId) => emit("selectEntrySearchResult", fileId)
});
const {
  query: entrySearchQuery,
  results: entrySearchResults,
  activeIndex: activeEntrySearchIndex,
  pending: entrySearchPending,
  resultLabel: entrySearchResultLabel,
  handleInput: handleEntrySearchInput,
  moveActive: moveActiveEntrySearchResult,
  selectResult: selectEntrySearchResult
} = entrySearch;

const {
  worldbuildingDeleteDialog,
  worldbuildingDeleteCancelButton,
  navigationDeleteTarget,
  navigationDeletePending,
  navigationDeleteDialog,
  navigationDeleteCancelButton,
  pendingWorldbuildingDeleteItem,
  openWorldbuildingItemDelete,
  closeWorldbuildingItemDelete,
  handleWorldbuildingDeleteKeydown,
  confirmWorldbuildingItemDelete,
  openNavigationDelete,
  closeNavigationDelete,
  handleNavigationDeleteKeydown,
  confirmNavigationDelete,
  openChapterCardDelete
} = useLongEditorDeleteDialogs({
  props,
  currentReadOnly,
  currentNavigationDeleteTarget,
  currentWorldbuildingItems,
  pendingWorldbuildingDeleteId,
  emitPreviewMutation: (batch, completion) => {
    emit("previewMutation", batch, completion);
  },
  emitMutation: (batch, completion) => {
    emit("mutation", batch, completion);
  },
  selectWorldbuildingItem,
  selectWorldbuildingOverview,
  emitPreviewDeleteStructure: (input, completion) => {
    emit("previewDeleteStructure", input, completion);
  },
  emitDeleteStructure: (input, completion) => {
    emit("deleteStructure", input, completion);
  }
});

function forwardPreviewMutation(
  batch: LongWorkspaceOperationBatch,
  completion: (impact?: LongWorkspaceImpactConfirmation) => void
): void {
  emit("previewMutation", batch, completion);
}

Object.assign(structureHost, {
  currentReadOnly,
  currentIsPlotPointStoryline,
  currentStructureTitleTarget,
  currentStructureTitleReadOnly,
  currentWorldbuildingItem,
  currentEmptyCollection,
  currentIsCharacterDocument,
  currentIsBookLineWorkspace,
  resetEditorHistory,
  loadWorkspaceDocument,
  saveAllChanges,
  updateCurrentContent
});

function captureForeshadowingFocus(): LongForeshadowingFocus {
  return (
    foreshadowingWorkspace.value?.captureFocus() ?? {
      threadId: null,
      beatId: null
    }
  );
}

async function locateEditorReference(
  reference: EditorTextReference
): Promise<boolean> {
  closeSelectionAction();
  if (reference.documentId !== currentReferenceDocumentId.value) {
    const isCurrentSelectionFile = props.selection?.files.some(
      ({ file }) => file.id === reference.documentId
    );
    if (!isCurrentSelectionFile || !(await focusFile(reference.documentId))) {
      return false;
    }
  }

  setViewMode("edit");
  await nextTick();
  const input = editorInput.value;
  if (!input || reference.documentId !== currentReferenceDocumentId.value) {
    return false;
  }
  const range = resolveEditorTextReferenceRange(
    currentVisibleContent.value,
    reference
  );
  input.focus();
  input.setSelectionRange(range.start, range.end, "forward");
  revealTextareaOffset(input, range.start);
  return true;
}

defineExpose({
  saveAllChanges,
  selectBookLineVolume,
  focusFile,
  focusTarget,
  locateEditorReference,
  captureNavigationSelection,
  captureForeshadowingFocus,
  ensureDocumentsLoaded
});

watch(
  () => [props.bookId, props.workspaceIndex] as const,
  () => {
    if (volumeDraftBookId !== props.bookId) {
      volumeDraftBookId = props.bookId;
      volumeOutlineDrafts.value = {};
      plotPointSummaryDrafts.value = {};
      activeBookLineVolumeId.value = null;
      activeBookLineContentTab.value = "outline";
      activePlotPointTab.value = "summary";
      activeStoryPlotId.value = null;
    }
    const volumes = props.workspaceIndex?.plot.volumes ?? [];
    const next: Record<string, LongVolumeOutlineDraft> = {};
    for (const volume of volumes) {
      const existing = volumeOutlineDrafts.value[volume.id];
      next[volume.id] =
        existing &&
        (existing.saving || existing.content !== existing.savedContent)
          ? existing
          : {
              content: volume.summary,
              savedContent: volume.summary,
              saving: false
            };
    }
    volumeOutlineDrafts.value = next;
    const nextSummaries: Record<string, LongVolumeOutlineDraft> = {};
    for (const plotPoint of props.workspaceIndex?.plot.arcs ?? []) {
      const existingSummary = plotPointSummaryDrafts.value[plotPoint.id];
      nextSummaries[plotPoint.id] =
        existingSummary &&
        (existingSummary.saving ||
          existingSummary.content !== existingSummary.savedContent)
          ? existingSummary
          : {
              content: plotPoint.summary ?? "",
              savedContent: plotPoint.summary ?? "",
              saving: false
            };
    }
    plotPointSummaryDrafts.value = nextSummaries;
    if (
      activeBookLineVolumeId.value &&
      !volumes.some(({ id }) => id === activeBookLineVolumeId.value)
    ) {
      activeBookLineVolumeId.value = null;
    }
  },
  // The workspace index is replaced atomically for every refresh, which lets
  // Vue batch draft reconciliation outside the input event.
  { immediate: true, flush: "post" }
);

watch(
  () =>
    [
      props.bookId,
      currentStructureTitleTarget.value?.kind,
      currentStructureTitleTarget.value?.id,
      currentStructureTitleTarget.value?.title
    ] as const,
  resetStructureTitleDraft,
  { immediate: true, flush: "sync" }
);

watch(
  () =>
    [
      props.bookId,
      currentSelectionFile.value?.file.id,
      activeWorldbuildingItemId.value,
      activeBookLineVolumeId.value,
      activeBookLineContentTab.value,
      props.selection?.plotPointId,
      activePlotPointTab.value,
      props.selection?.chapterCardId
    ] as const,
  () => {
    resetToDefault(Boolean(currentSelectionFile.value?.readOnly));
    closeFindPanel();
    searchQuery.value = "";
    replacementText.value = "";
    resetEditorHistory();
  },
  { immediate: true, flush: "sync" }
);

watch(
  () => props.defaultViewMode,
  () => resetToDefault(Boolean(currentSelectionFile.value?.readOnly)),
  { flush: "sync" }
);

watch(
  () =>
    [
      props.bookId,
      props.selection?.key,
      currentWorldbuildingItems.value.map(({ id }) => id).join("\u0000")
    ] as const,
  () => {
    const items = currentWorldbuildingItems.value;
    if (!items.some(({ id }) => id === pendingWorldbuildingDeleteId.value)) {
      pendingWorldbuildingDeleteId.value = null;
    }
  },
  { immediate: true, flush: "sync" }
);

function closeStoryPlotActionMenuOnOutsidePointer(event: PointerEvent): void {
  if (!storyPlotActionMenuId.value) return;
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest(".long-story-plot-card-actions")
  ) {
    return;
  }
  closeStoryPlotActionMenu();
}

onMounted(() => {
  window.addEventListener(
    "pointerdown",
    closeStoryPlotActionMenuOnOutsidePointer,
    true
  );
  void restoreCurrentEditorScroll();
});
onBeforeUnmount(() => {
  editorComposition.reset();
  rememberCurrentEditorScroll();
  window.removeEventListener(
    "pointerdown",
    closeStoryPlotActionMenuOnOutsidePointer,
    true
  );
});
</script>

<template>
  <section
    class="long-workspace-editor"
    :class="{
      'has-navigation-tabs':
        currentUsesTopCharacterTabs ||
        currentUsesTopPlotTabs ||
        currentUsesTopWorldbuildingTabs
    }"
    :aria-label="t('novelFileEditor')"
  >
    <template v-if="selection">
      <LongCharacterNavigation
        v-if="currentUsesTopCharacterTabs"
        mode="top-tabs"
        :label="
          t('valueCharacters', {
            arg0: selection.characterGroup ?? t('characters')
          })
        "
        :title="selection.title"
        :items="currentCharacterNavigationItems"
        :active-character-id="selection.characterId ?? null"
        :pending-character-id="pendingCharacterId"
        :locked="locked"
        :can-delete="Boolean(currentNavigationDeleteTarget)"
        @select-character="requestSelectCharacter"
        @create-character="emit('createCharacter')"
        @delete-character="openNavigationDelete"
      />

      <nav
        v-if="currentIsBookLineWorkspace && currentUsesTopPlotTabs"
        class="section-tabs-bar long-worldbuilding-tabs long-book-line-tabs"
        :aria-label="t('overallStoryline')"
      >
        <div
          class="section-tabs-scroll"
          role="tablist"
          @wheel="handleHorizontalOverflowWheel"
        >
          <button
            class="section-tab"
            :class="{ 'is-active': activeBookLineVolumeId === null }"
            type="button"
            role="tab"
            :aria-selected="activeBookLineVolumeId === null"
            :title="t('overallOutline')"
            @click="selectBookLineOverview"
          >
            {{ t("overallOutline") }}
          </button>
          <button
            v-for="volume in orderedBookLineVolumes"
            :key="volume.id"
            class="section-tab"
            :class="{ 'is-active': activeBookLineVolumeId === volume.id }"
            type="button"
            role="tab"
            :aria-selected="activeBookLineVolumeId === volume.id"
            :title="volume.title"
            @click="selectBookLineVolume(volume.id)"
          >
            {{ volume.title }}
          </button>
        </div>
        <button
          v-if="!currentReadOnly"
          class="long-worldbuilding-add"
          type="button"
          :aria-label="t('newVolume')"
          :title="t('newVolume')"
          @click="requestCreateVolume"
        >
          <AppIcon name="plus" :size="15" />
        </button>
        <button
          v-if="!currentReadOnly"
          class="long-worldbuilding-remove"
          type="button"
          :aria-label="t('deleteCurrentVolume')"
          :title="
            currentBookLineVolume
              ? t('deleteCurrentVolume')
              : t('selectAVolumeFirst')
          "
          :disabled="locked || !currentNavigationDeleteTarget"
          @click="openNavigationDelete"
        >
          <AppIcon name="minus" :size="15" />
        </button>
      </nav>

      <nav
        v-if="currentIsPlotPointWorkspace && currentUsesTopPlotTabs"
        class="section-tabs-bar long-worldbuilding-tabs long-plot-point-tabs"
        :aria-label="
          t('valuePlotPoints', {
            arg0: selection.breadcrumbs.at(-1) ?? t('currentVolume')
          })
        "
      >
        <div
          class="section-tabs-scroll"
          role="tablist"
          @wheel="handleHorizontalOverflowWheel"
        >
          <button
            v-for="plotPoint in selection.plotPointTabs"
            :key="plotPoint.id"
            class="section-tab"
            :class="{ 'is-active': selection.plotPointId === plotPoint.id }"
            type="button"
            role="tab"
            :aria-selected="selection.plotPointId === plotPoint.id"
            :title="plotPoint.label"
            @click="emit('selectPlotPoint', plotPoint.id)"
          >
            {{ plotPoint.label }}
          </button>
        </div>
        <button
          v-if="!currentReadOnly"
          class="long-worldbuilding-add"
          type="button"
          :aria-label="t('addPlotPoint')"
          :title="t('addPlotPoint')"
          :disabled="locked"
          @click="emit('createPlotPoint')"
        >
          <AppIcon name="plus" :size="15" />
        </button>
        <button
          v-if="!currentReadOnly"
          class="long-worldbuilding-remove"
          type="button"
          :aria-label="t('deleteCurrentPlotPoint')"
          :title="t('deleteCurrentPlotPoint')"
          :disabled="locked || !currentNavigationDeleteTarget"
          @click="openNavigationDelete"
        >
          <AppIcon name="minus" :size="15" />
        </button>
      </nav>

      <LongManuscriptNavigation
        v-if="currentIsChapterCardWorkspace && currentUsesTopPlotTabs"
        mode="top-tabs"
        :label="
          t('valueChapterCards', {
            arg0: selection.breadcrumbs[3] ?? t('currentVolume')
          })
        "
        :items="selection.chapterCardTabs ?? []"
        :active-chapter-id="selection.chapterCardId ?? null"
        :locked="locked"
        :committed="currentChapterCardCommitted"
        @select-chapter="emit('selectChapterCard', $event)"
        @create-chapter="emit('createChapterCard')"
        @delete-chapter="openChapterCardDelete"
        @reorder-chapter="reorderChapterCard"
      />

      <LongWorldbuildingNavigation
        v-if="currentUsesTopWorldbuildingTabs"
        mode="top-tabs"
        :items="currentWorldbuildingItems"
        :active-item-id="activeWorldbuildingItemId"
        :pending-item-id="pendingWorldbuildingItemId"
        :pending-overview="pendingWorldbuildingOverview"
        :read-only="currentReadOnly"
        :locked="locked"
        @select-overview="selectWorldbuildingOverview"
        @select-item="selectWorldbuildingItem"
        @add-item="addWorldbuildingItem"
        @delete-item="openWorldbuildingItemDelete"
      />

      <div class="long-editor-toolbar">
        <div
          v-if="currentIsBookLineWorkspace && currentBookLineVolume"
          class="long-editor-file-tabs"
          role="tablist"
          :aria-label="
            t('valueContent', {
              arg0: currentBookLineVolume.title
            })
          "
        >
          <button
            type="button"
            role="tab"
            :aria-selected="activeBookLineContentTab === 'outline'"
            :class="{
              'is-active': activeBookLineContentTab === 'outline'
            }"
            @click="selectBookLineContentTab('outline')"
          >
            {{ t("volumeOutline") }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="activeBookLineContentTab === 'foreshadowing'"
            :class="{
              'is-active': activeBookLineContentTab === 'foreshadowing'
            }"
            @click="selectBookLineContentTab('foreshadowing')"
          >
            {{ t("volumeForeshadowing") }}
          </button>
        </div>
        <div
          v-if="currentIsPlotPointWorkspace && currentPlotPoint"
          class="long-editor-file-tabs"
          role="tablist"
          :aria-label="
            t('valueContent', {
              arg0: currentPlotPoint?.title ?? t('currentPlotPoint')
            })
          "
        >
          <button
            type="button"
            role="tab"
            :aria-selected="activePlotPointTab === 'summary'"
            :class="{ 'is-active': activePlotPointTab === 'summary' }"
            @click="selectPlotPointTab('summary')"
          >
            {{ t("summary") }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="activePlotPointTab === 'storyline'"
            :class="{ 'is-active': activePlotPointTab === 'storyline' }"
            @click="selectPlotPointTab('storyline')"
          >
            {{ t("storyEvent") }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="activePlotPointTab === 'foreshadowing'"
            :class="{
              'is-active': activePlotPointTab === 'foreshadowing'
            }"
            @click="selectPlotPointTab('foreshadowing')"
          >
            {{ t("foreshadowingTouchpoints") }}
          </button>
        </div>
        <LongContinuityLedgerNavigation
          v-if="currentUsesTopContinuityTabs"
          mode="top-tabs"
          :title="selection.title"
          :items="currentContinuityNavigationItems"
          :active-file-id="currentSelectionFile?.file.id ?? null"
          :pending-file-id="pendingFileId"
          @select-file="selectWorkspaceFile"
        />
        <div
          v-if="showGenericFileTabs"
          class="long-editor-file-tabs"
          role="tablist"
          :aria-label="
            t('valueFile', {
              arg0: selection.title
            })
          "
        >
          <button
            v-for="file in selection.files"
            :key="file.file.id"
            type="button"
            role="tab"
            :aria-selected="currentSelectionFile?.file.id === file.file.id"
            :class="{
              'is-active': currentSelectionFile?.file.id === file.file.id,
              'is-loading': pendingFileId === file.file.id
            }"
            :aria-busy="pendingFileId === file.file.id"
            @click="selectWorkspaceFile(file.file.id)"
          >
            {{ file.label }}
          </button>
        </div>
        <span
          v-if="
            !currentIsForeshadowingView &&
            !currentIsPlotPointStoryline &&
            ((currentIsBookLineWorkspace && currentBookLineVolume) ||
              (currentIsPlotPointWorkspace && currentPlotPoint) ||
              (currentIsChapterCardWorkspace && currentChapterCard) ||
              currentUsesTopContinuityTabs ||
              showGenericFileTabs)
          "
          class="long-toolbar-separator"
        />
        <div
          v-if="!currentIsForeshadowingView && !currentIsPlotPointStoryline"
          class="long-editor-view-tabs"
          role="tablist"
          :aria-label="t('textView')"
        >
          <button
            type="button"
            role="tab"
            :aria-selected="viewMode === 'edit'"
            :class="{ 'is-active': viewMode === 'edit' }"
            :disabled="!canUseTextTools || currentReadOnly"
            @click="setViewMode('edit')"
          >
            {{ t("edit") }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="viewMode === 'preview'"
            :class="{ 'is-active': viewMode === 'preview' }"
            :disabled="!canUseTextTools"
            @click="setViewMode('preview')"
          >
            {{ t("preview") }}
          </button>
        </div>
        <span
          v-if="!currentIsForeshadowingView && !currentIsPlotPointStoryline"
          class="long-toolbar-separator"
        />
        <div
          v-if="!currentIsForeshadowingView && !currentIsPlotPointStoryline"
          class="long-editor-text-tools"
          role="group"
          :aria-label="t('textActions')"
        >
          <EditorTextTools
            :can-undo="canUndo"
            :can-redo="canRedo"
            :disabled="!canUseTextTools"
            :find-panel-open="findPanelOpen"
            :find-panel-mode="findPanelMode"
            :format-visible="bodyFormatVisible"
            :format-disabled="bodyFormatDisabled"
            @undo="undo"
            @redo="redo"
            @toggle-find="toggleFindPanel"
            @format="formatBody"
          />
          <PreviewOutlinePopover
            v-if="viewMode === 'preview' && canUseTextTools"
            icon-only
            :content="currentVisibleContent"
            :preview-element="documentPreview"
            :document-key="
              currentSelectionFile?.file.id ?? selection?.key ?? ''
            "
          />

          <LongEditorFindReplaceBar
            v-if="findPanelOpen"
            v-model:find-panel-element="findPanelElement"
            v-model:find-input="findInput"
            :find-panel-mode="findPanelMode"
            :search-query="searchQuery"
            :replacement-text="replacementText"
            :search-result-label="searchResultLabel"
            :current-read-only="currentReadOnly"
            :entry-search-query="entrySearchQuery"
            :entry-search-results="entrySearchResults"
            :active-entry-search-index="activeEntrySearchIndex"
            :entry-search-pending="entrySearchPending"
            :entry-search-result-label="entrySearchResultLabel"
            @update:search-query="searchQuery = $event"
            @update:replacement-text="replacementText = $event"
            @update:entry-search-query="entrySearchQuery = $event"
            @find-input="handleFindInput"
            @find-match="findMatch"
            @close="dismissFindPanel"
            @replace-current="replaceCurrentMatch"
            @replace-all="replaceAllMatches"
            @entry-search-input="handleEntrySearchInput"
            @move-entry-search="moveActiveEntrySearchResult"
            @select-entry-search="selectEntrySearchResult"
          />
        </div>
        <EditorPaneToggle
          :right-pane="rightPane"
          :right-pane-collapsed="rightPaneCollapsed"
          @collapse="emit('collapse')"
          @toggle-right="emit('toggleRight')"
        />
      </div>

      <div
        ref="longEditorDocumentElement"
        class="long-editor-document"
        :style="entryListGridStyle"
        :class="{
          'is-entry-right-list': currentUsesAnyRightEntryList,
          'is-resizing-entry-list': resizingLongEditorPane === 'entry-list'
        }"
      >
        <LongForeshadowingWorkspace
          v-if="currentIsForeshadowingView && workspaceIndex"
          ref="foreshadowingWorkspace"
          :snapshot="workspaceIndex"
          :mode="currentForeshadowingMode"
          :volume-id="currentForeshadowingVolumeId"
          :plot-point-id="currentPlotPoint?.id"
          :disabled="locked"
          @preview-mutation="forwardPreviewMutation"
          @mutation="forwardForeshadowingMutation"
        />
        <section
          v-else-if="currentIsPlotPointStoryline"
          class="long-story-plot-workspace"
          :aria-label="
            t('valueStoryEvents', {
              arg0: currentPlotPoint?.title ?? t('currentPlotPoint')
            })
          "
        >
          <header class="long-story-plot-header">
            <div class="long-story-plot-heading">
              <h2>
                {{
                  t("storyEventsMessage", {
                    arg0: currentPlotPoint?.title ?? t("currentPlotPoint") ?? ""
                  })
                }}
              </h2>
            </div>
            <div class="long-story-plot-header-actions">
              <button
                v-if="!currentReadOnly"
                class="long-story-plot-add"
                type="button"
                :disabled="locked"
                @click="addStoryPlot"
              >
                <AppIcon name="plus" :size="15" />
                {{ t("addEvent") }}
              </button>
            </div>
          </header>

          <div
            ref="storyPlotLayoutElement"
            class="long-story-plot-layout"
            :class="{
              'is-resizing-story-list':
                resizingLongEditorPane === 'story-plot-list'
            }"
            :style="storyPlotListGridStyle"
          >
            <LongPlotStoryListPane
              :plots="currentStoryPlots"
              :active-story-plot-id="activeStoryPlotId"
              :pending-story-plot-id="pendingStoryPlotId"
              :action-menu-id="storyPlotActionMenuId"
              :read-only="currentReadOnly"
              :locked="locked"
              @select="selectStoryPlot"
              @toggle-action-menu="toggleStoryPlotActionMenu"
              @close-action-menu="closeStoryPlotActionMenu"
              @menu-action="runStoryPlotMenuAction"
            />

            <div
              class="long-editor-internal-resizer long-story-plot-resizer"
              role="separator"
              :aria-label="t('resizeCurrentPlotPointEventList')"
              aria-orientation="vertical"
              :aria-valuemin="LONG_EDITOR_LIST_MIN_WIDTH"
              :aria-valuemax="storyPlotListMaxWidth"
              :aria-valuenow="storyPlotListWidth ?? LONG_EDITOR_LIST_MIN_WIDTH"
              tabindex="0"
              @pointerdown="
                startLongEditorPaneResize('story-plot-list', $event)
              "
              @keydown="
                handleLongEditorPaneResizeKeydown('story-plot-list', $event)
              "
            />

            <main
              class="long-story-plot-detail"
              :aria-label="t('storyEventManuscript')"
            >
              <div v-if="showEditorLoading" class="long-editor-loading">
                <span class="long-loading-dot" />
                <span>{{ t("readingFileContent") }}</span>
              </div>
              <div
                v-else-if="showEditorLoadError"
                class="long-editor-unavailable"
                role="status"
              >
                <AppIcon name="file" :size="22" />
                <strong>{{ t("couldNotReadFile") }}</strong>
                <span>{{ currentState?.loadError }}</span>
              </div>
              <div
                v-else-if="currentStoryPlot"
                class="long-story-plot-writing-surface"
                :class="{
                  'is-readonly': currentReadOnly
                }"
              >
                <input
                  :value="currentStoryPlot.title"
                  class="long-story-plot-title-input"
                  :readonly="currentReadOnly || locked || isDocumentContentBusy"
                  maxlength="256"
                  autocomplete="off"
                  :aria-label="t('storyEventName')"
                  @change="updateStoryPlotTitle(currentStoryPlot.id, $event)"
                />
                <div class="long-story-plot-text-toolbar">
                  <div
                    class="long-editor-view-tabs"
                    role="tablist"
                    :aria-label="t('textView')"
                  >
                    <button
                      type="button"
                      role="tab"
                      :aria-selected="viewMode === 'edit'"
                      :class="{ 'is-active': viewMode === 'edit' }"
                      :disabled="!canUseTextTools"
                      @click="setViewMode('edit')"
                    >
                      {{ t("edit") }}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      :aria-selected="viewMode === 'preview'"
                      :class="{ 'is-active': viewMode === 'preview' }"
                      :disabled="!canUseTextTools"
                      @click="setViewMode('preview')"
                    >
                      {{ t("preview") }}
                    </button>
                  </div>
                  <span class="long-toolbar-separator" />
                  <div
                    class="long-editor-text-tools"
                    role="group"
                    :aria-label="t('textActions')"
                  >
                    <EditorTextTools
                      :can-undo="canUndo"
                      :can-redo="canRedo"
                      :disabled="!canUseTextTools"
                      :find-panel-open="findPanelOpen"
                      :find-panel-mode="findPanelMode"
                      :format-visible="bodyFormatVisible"
                      :format-disabled="bodyFormatDisabled"
                      @undo="undo"
                      @redo="redo"
                      @toggle-find="toggleFindPanel"
                      @format="formatBody"
                    />
                    <PreviewOutlinePopover
                      v-if="viewMode === 'preview'"
                      icon-only
                      :content="currentVisibleContent"
                      :preview-element="documentPreview"
                      :document-key="currentStoryPlot.id"
                    />

                    <LongEditorFindReplaceBar
                      v-if="findPanelOpen"
                      v-model:find-panel-element="findPanelElement"
                      v-model:find-input="findInput"
                      :find-panel-mode="findPanelMode"
                      :search-query="searchQuery"
                      :replacement-text="replacementText"
                      :search-result-label="searchResultLabel"
                      :current-read-only="currentReadOnly"
                      :entry-search-query="entrySearchQuery"
                      :entry-search-results="entrySearchResults"
                      :active-entry-search-index="activeEntrySearchIndex"
                      :entry-search-pending="entrySearchPending"
                      :entry-search-result-label="entrySearchResultLabel"
                      @update:search-query="searchQuery = $event"
                      @update:replacement-text="replacementText = $event"
                      @update:entry-search-query="entrySearchQuery = $event"
                      @find-input="handleFindInput"
                      @find-match="findMatch"
                      @close="dismissFindPanel"
                      @replace-current="replaceCurrentMatch"
                      @replace-all="replaceAllMatches"
                      @entry-search-input="handleEntrySearchInput"
                      @move-entry-search="moveActiveEntrySearchResult"
                      @select-entry-search="selectEntrySearchResult"
                    />
                  </div>
                </div>
                <EditorSearchHighlight
                  v-if="viewMode === 'edit'"
                  :content="currentVisibleContent"
                  :matches="searchMatches"
                  :active-index="currentMatchIndex"
                  :visible="findPanelOpen"
                >
                  <textarea
                    ref="editorInput"
                    :value="
                      editorComposition.valueForRender(
                        currentVisibleContent,
                        editorInput
                      )
                    "
                    class="long-document-editor long-story-plot-editor"
                    :readonly="currentReadOnly || isDocumentContentBusy"
                    :aria-label="
                      t('valueManuscript', {
                        arg0: currentStoryPlot.title
                      })
                    "
                    spellcheck="false"
                    @beforeinput="handleEditorBeforeInput"
                    @input="handleEditorInput"
                    @compositionstart="handleEditorCompositionStart"
                    @compositionend="handleEditorCompositionEnd"
                    @keydown="handleEditorKeydown"
                    @contextmenu="handleEditorContextMenu"
                    @scroll="handleEditorScroll"
                  />
                </EditorSearchHighlight>
                <article
                  v-else
                  ref="documentPreview"
                  class="long-document-preview long-story-plot-editor"
                  @contextmenu="handlePreviewContextMenu"
                  @scroll="handleEditorScroll"
                >
                  <MarkdownContent
                    v-if="currentVisibleContent.trim()"
                    :content="currentVisibleContent"
                    annotate-headings
                  />
                  <p v-else class="is-empty">
                    {{ t("noStoryEventManuscriptYet") }}
                  </p>
                </article>
              </div>
              <div v-else class="long-story-plot-detail-empty">
                <AppIcon name="sparkles" :size="26" />
                <strong>{{ t("selectAStoryEventToViewItsManuscript") }}</strong>
                <span>{{ t("manageEntriesInTheRightListAndWriteTheir") }}</span>
              </div>
            </main>
          </div>
        </section>
        <div v-else-if="showEditorLoading" class="long-editor-loading">
          <span class="long-loading-dot" />
          <span>{{ t("readingFileContent") }}</span>
        </div>
        <div
          v-else-if="showEditorLoadError"
          class="long-editor-unavailable"
          role="status"
        >
          <AppIcon name="file" :size="22" />
          <strong>{{ t("couldNotReadFile") }}</strong>
          <span>{{ currentState?.loadError }}</span>
          <button
            type="button"
            :disabled="workspaceSavePending"
            @click="loadSelectedDocument(true)"
          >
            {{ t("reload") }}
          </button>
        </div>
        <LongManuscriptEditor
          v-else-if="
            selection.root === 'draft' &&
            (currentState?.loaded ||
              Boolean(currentState?.content) ||
              isDocumentSwitchPending)
          "
          v-model:title-draft="structureTitleDraft"
          :title="currentDocumentTitle"
          :title-editable="Boolean(currentStructureTitleTarget)"
          :title-read-only="currentStructureTitleReadOnly"
          :format="currentDocumentFormat"
          :content="currentVisibleContent"
          :composing="editorComposition.isComposing.value"
          :view-mode="viewMode"
          :read-only="currentReadOnly"
          :busy="isDocumentContentBusy"
          :search-matches="searchMatches"
          :active-search-index="currentMatchIndex"
          :search-highlight-visible="findPanelOpen"
          @title-change="saveStructureTitle"
          @title-keydown="handleStructureTitleKeydown"
          @beforeinput="handleEditorBeforeInput"
          @input="handleEditorInput"
          @compositionstart="handleEditorCompositionStart"
          @compositionend="handleEditorCompositionEnd"
          @keydown="handleEditorKeydown"
          @contextmenu="handleEditorContextMenu"
          @preview-contextmenu="handlePreviewContextMenu"
          @editor-element-change="setEditorInputElement"
          @preview-element-change="setDocumentPreviewElement"
          @editor-scroll="handleEditorScroll"
        />
        <div
          v-else-if="
            currentState?.loaded ||
            Boolean(currentState?.content) ||
            isDocumentSwitchPending ||
            currentIsWorldbuildingList ||
            (currentIsChapterCardWorkspace && currentChapterCard)
          "
          class="long-editor-writing-surface"
          :class="{
            'is-readonly': currentReadOnly
          }"
        >
          <div
            v-if="
              currentIsWorldbuildingList &&
              !currentWorldbuildingListState.error &&
              !currentSelectionFile
            "
            class="long-worldbuilding-empty"
          >
            <AppIcon name="file" :size="22" />
            <strong>{{ t("noWorldbuildingEntriesYet") }}</strong>
            <span>
              {{
                t("afterCreatingAnEntryUseToSwitchMessage", {
                  arg0:
                    (currentUsesLeftTreeWorldbuilding
                      ? t("theLeftTree")
                      : currentUsesRightWorldbuildingList
                        ? t("theRightList")
                        : t("theTabsAbove")) ?? ""
                })
              }}
            </span>
            <button
              v-if="!currentReadOnly"
              type="button"
              @click="addWorldbuildingItem"
            >
              {{ t("createFirstEntry") }}
            </button>
          </div>
          <template v-else>
            <input
              v-if="
                currentIsWorldbuildingList &&
                !currentWorldbuildingListState.error &&
                currentWorldbuildingItem
              "
              :value="currentWorldbuildingItem.title"
              class="long-document-title-input"
              :readonly="currentReadOnly || locked || isDocumentContentBusy"
              maxlength="256"
              autocomplete="off"
              :aria-label="t('worldbuildingEntryName')"
              @change="
                updateWorldbuildingItemTitle(
                  currentWorldbuildingItem.id,
                  $event
                )
              "
            />
            <input
              v-else-if="currentIsCharacterDocument"
              v-model="characterNameDraft"
              class="long-document-title-input"
              :readonly="locked || characterNameSaving"
              maxlength="256"
              autocomplete="off"
              :aria-label="t('characterName')"
              @change="saveCharacterName"
              @keydown="handleCharacterNameKeydown"
            />
            <input
              v-else-if="currentStructureTitleTarget"
              v-model="structureTitleDraft"
              class="long-document-title-input"
              :readonly="currentStructureTitleReadOnly"
              maxlength="256"
              autocomplete="off"
              :aria-label="currentStructureTitleTarget.inputLabel"
              @change="saveStructureTitle"
              @keydown="handleStructureTitleKeydown"
            />
            <h1 v-else class="long-document-title">
              {{ currentDocumentTitle }}
            </h1>
            <EditorSearchHighlight
              v-if="viewMode === 'edit'"
              :content="currentVisibleContent"
              :matches="searchMatches"
              :active-index="currentMatchIndex"
              :visible="findPanelOpen"
            >
              <textarea
                ref="editorInput"
                :value="
                  editorComposition.valueForRender(
                    currentVisibleContent,
                    editorInput
                  )
                "
                class="long-document-editor"
                :readonly="currentReadOnly || isDocumentContentBusy"
                :aria-label="
                  t('documentLabel', {
                    title: currentDocumentTitle,
                    format: currentDocumentFormat || t('content')
                  })
                "
                :maxlength="
                  currentIsStructuredText
                    ? 200000
                    : currentIsWorldbuildingList &&
                        !currentWorldbuildingListState.error
                      ? 1000000
                      : undefined
                "
                spellcheck="false"
                @beforeinput="handleEditorBeforeInput"
                @input="handleEditorInput"
                @compositionstart="handleEditorCompositionStart"
                @compositionend="handleEditorCompositionEnd"
                @keydown="handleEditorKeydown"
                @contextmenu="handleEditorContextMenu"
                @scroll="handleEditorScroll"
              />
            </EditorSearchHighlight>
            <article
              v-else
              ref="documentPreview"
              class="long-document-preview"
              @contextmenu="handlePreviewContextMenu"
              @scroll="handleEditorScroll"
            >
              <MarkdownContent
                v-if="currentVisibleContent.trim()"
                :content="currentVisibleContent"
                annotate-headings
              />
              <p v-else class="is-empty">
                {{
                  currentIsPlotPointStoryline
                    ? t("noStoryEventsYet")
                    : currentIsPlotPointSummary
                      ? t("noSummaryYet")
                      : currentIsChapterCardContent
                        ? t("noChapterCardContentYet")
                        : currentIsVolumeOutline
                          ? t("noVolumeOutlineYet")
                          : t("noManuscriptYet")
                }}
              </p>
            </article>
          </template>
        </div>
        <div
          v-else-if="currentEmptyCollection"
          class="long-editor-writing-surface"
        >
          <div class="long-worldbuilding-empty">
            <AppIcon :name="currentEmptyCollection.icon" :size="22" />
            <strong>{{ currentEmptyCollection.title }}</strong>
            <span>{{ currentEmptyCollection.description }}</span>
            <button
              type="button"
              :disabled="locked"
              @click="createFirstCollectionItem"
            >
              {{ currentEmptyCollection.buttonLabel }}
            </button>
          </div>
        </div>
        <div v-else class="long-editor-unavailable">
          <AppIcon
            :name="
              selection.key.startsWith('character-group:') ? 'user' : 'file'
            "
            :size="22"
          />
          <strong>{{ selection.title }}</strong>
          <span>
            {{ selection.description ?? t("selectAFileInThisFolderToLoadIts") }}
          </span>
        </div>

        <div
          v-if="currentUsesAnyRightEntryList"
          class="long-editor-internal-resizer long-entry-list-resizer"
          role="separator"
          :aria-label="t('resizeRightEntryList')"
          aria-orientation="vertical"
          :aria-valuemin="LONG_EDITOR_LIST_MIN_WIDTH"
          :aria-valuemax="entryListMaxWidth"
          :aria-valuenow="entryListWidth ?? LONG_EDITOR_LIST_MIN_WIDTH"
          tabindex="0"
          @pointerdown="startLongEditorPaneResize('entry-list', $event)"
          @keydown="handleLongEditorPaneResizeKeydown('entry-list', $event)"
        />

        <LongWorldbuildingNavigation
          v-if="currentUsesRightWorldbuildingList"
          mode="right-list"
          :items="currentWorldbuildingItems"
          :active-item-id="activeWorldbuildingItemId"
          :pending-item-id="pendingWorldbuildingItemId"
          :pending-overview="pendingWorldbuildingOverview"
          :read-only="currentReadOnly"
          :locked="locked"
          @select-overview="selectWorldbuildingOverview"
          @select-item="selectWorldbuildingItem"
          @add-item="addWorldbuildingItem"
          @delete-item="openWorldbuildingItemDelete"
        />
        <LongCharacterNavigation
          v-if="currentUsesRightCharacterList"
          mode="right-list"
          :label="
            t('valueCharacters', {
              arg0: selection.characterGroup ?? t('characters')
            })
          "
          :title="selection.title"
          :items="currentCharacterNavigationItems"
          :active-character-id="selection.characterId ?? null"
          :pending-character-id="pendingCharacterId"
          :locked="locked"
          :can-delete="Boolean(currentNavigationDeleteTarget)"
          @select-character="requestSelectCharacter"
          @create-character="emit('createCharacter')"
          @delete-character="openNavigationDelete"
        />
        <aside
          v-if="currentUsesRightBookLineList"
          class="long-story-plot-pane long-entry-list-pane"
          :aria-label="t('overallStorylineList')"
        >
          <header>
            <div>
              <strong>{{ t("overallStoryline") }}</strong>
              <span>{{ orderedBookLineVolumes.length + 1 }}</span>
            </div>
            <div v-if="!currentReadOnly" class="long-entry-list-actions">
              <button
                type="button"
                :aria-label="t('newVolume')"
                :title="t('newVolume')"
                @click="requestCreateVolume"
              >
                <AppIcon name="plus" :size="14" />
              </button>
              <button
                type="button"
                :aria-label="t('deleteCurrentVolume')"
                :disabled="locked || !currentNavigationDeleteTarget"
                @click="openNavigationDelete"
              >
                <AppIcon name="minus" :size="14" />
              </button>
            </div>
          </header>
          <div class="long-story-plot-list" role="list">
            <article
              class="long-story-plot-card"
              :class="{ 'is-active': activeBookLineVolumeId === null }"
              role="listitem"
            >
              <button
                class="long-story-plot-card-main"
                type="button"
                :aria-pressed="activeBookLineVolumeId === null"
                @click="selectBookLineOverview"
              >
                <span class="long-story-plot-card-order">—</span>
                <span class="long-story-plot-card-title">{{
                  t("overallOutline")
                }}</span>
              </button>
            </article>
            <article
              v-for="volume in orderedBookLineVolumes"
              :key="volume.id"
              class="long-story-plot-card"
              :class="{ 'is-active': activeBookLineVolumeId === volume.id }"
              role="listitem"
            >
              <button
                class="long-story-plot-card-main"
                type="button"
                :aria-pressed="activeBookLineVolumeId === volume.id"
                :title="volume.title"
                @click="selectBookLineVolume(volume.id)"
              >
                <span class="long-story-plot-card-order">{{
                  volume.order
                }}</span>
                <span class="long-story-plot-card-title">{{
                  volume.title
                }}</span>
              </button>
            </article>
          </div>
        </aside>
        <aside
          v-if="currentUsesRightPlotPointList"
          class="long-story-plot-pane long-entry-list-pane"
          :aria-label="t('plotPoints')"
        >
          <header>
            <div>
              <strong>{{ t("plotPoint") }}</strong>
              <span>{{ selection.plotPointTabs?.length ?? 0 }}</span>
            </div>
            <div v-if="!currentReadOnly" class="long-entry-list-actions">
              <button
                type="button"
                :aria-label="t('addPlotPoint')"
                :title="t('addPlotPoint')"
                :disabled="locked"
                @click="emit('createPlotPoint')"
              >
                <AppIcon name="plus" :size="14" />
              </button>
              <button
                type="button"
                :aria-label="t('deleteCurrentPlotPoint')"
                :disabled="locked || !currentNavigationDeleteTarget"
                @click="openNavigationDelete"
              >
                <AppIcon name="minus" :size="14" />
              </button>
            </div>
          </header>
          <div class="long-story-plot-list" role="list">
            <article
              v-for="(plotPoint, index) in selection.plotPointTabs"
              :key="plotPoint.id"
              class="long-story-plot-card"
              :class="{ 'is-active': selection.plotPointId === plotPoint.id }"
              role="listitem"
            >
              <button
                class="long-story-plot-card-main"
                type="button"
                :aria-pressed="selection.plotPointId === plotPoint.id"
                :title="plotPoint.label"
                @click="emit('selectPlotPoint', plotPoint.id)"
              >
                <span class="long-story-plot-card-order">{{ index + 1 }}</span>
                <span class="long-story-plot-card-title">{{
                  plotPoint.label
                }}</span>
              </button>
            </article>
          </div>
        </aside>
        <LongManuscriptNavigation
          v-if="currentUsesRightChapterCardList"
          mode="right-list"
          :label="t('chapterCards')"
          :items="selection.chapterCardTabs ?? []"
          :active-chapter-id="selection.chapterCardId ?? null"
          :locked="locked"
          :committed="currentChapterCardCommitted"
          @select-chapter="emit('selectChapterCard', $event)"
          @create-chapter="emit('createChapterCard')"
          @delete-chapter="openChapterCardDelete"
          @reorder-chapter="reorderChapterCard"
        />
        <LongContinuityLedgerNavigation
          v-if="currentUsesRightContinuityList"
          mode="right-list"
          :title="selection.title"
          :items="currentContinuityNavigationItems"
          :active-file-id="currentSelectionFile?.file.id ?? null"
          :pending-file-id="pendingFileId"
          @select-file="selectWorkspaceFile"
        />
      </div>

      <footer class="long-editor-footer">
        <LongEditorFooterMeta
          :is-chapter-body="
            selection.root === 'draft' && currentSelectionFile?.role === 'body'
          "
          :character-count="characterCount"
          :auto-save-enabled="autoSaveEnabled || currentIsForeshadowingView"
        />
        <span
          v-if="currentIsCommittedEditableDocument"
          class="long-editor-status"
          :title="currentCommittedEditNotice"
        >
          {{ currentCommittedEditNotice }}
        </span>
        <span v-else-if="currentReadOnly" class="long-editor-status">
          {{ t("readOnlyContent") }}
        </span>
        <span class="long-footer-spacer" />
        <button
          v-if="!currentIsForeshadowingView"
          class="long-editor-save-button"
          type="button"
          :disabled="
            currentReadOnly ||
            !currentDirty ||
            isDocumentContentBusy ||
            currentSaving ||
            workspaceSavePending
          "
          @mousedown.prevent
          @click="saveCurrentDocument"
        >
          <AppIcon name="save" :size="14" />
          {{ currentSaving ? t("saving") : t("saveNow") }}
        </button>
      </footer>
    </template>

    <div v-else class="long-editor-empty">
      <span class="long-editor-empty-icon">
        <AppIcon name="book" :size="28" />
      </span>
      <h2>{{ t("selectANovelFile") }}</h2>
      <p>
        {{
          t(
            "chooseWorldbuildingCharactersStorylinesChaptersOrLedgerRecordsFrom"
          )
        }}
      </p>
    </div>

    <LongEditorDeleteDialogs
      v-model:worldbuilding-delete-dialog="worldbuildingDeleteDialog"
      v-model:worldbuilding-delete-cancel-button="
        worldbuildingDeleteCancelButton
      "
      v-model:navigation-delete-dialog="navigationDeleteDialog"
      v-model:navigation-delete-cancel-button="navigationDeleteCancelButton"
      :pending-story-plot-delete="pendingStoryPlotDelete"
      :pending-worldbuilding-delete-item="pendingWorldbuildingDeleteItem"
      :navigation-delete-target="navigationDeleteTarget"
      :navigation-delete-pending="navigationDeletePending"
      @cancel-story-plot-delete="cancelStoryPlotDelete"
      @confirm-story-plot-delete="confirmStoryPlotDelete"
      @close-worldbuilding-item-delete="closeWorldbuildingItemDelete"
      @worldbuilding-delete-keydown="handleWorldbuildingDeleteKeydown"
      @confirm-worldbuilding-item-delete="confirmWorldbuildingItemDelete"
      @close-navigation-delete="closeNavigationDelete"
      @navigation-delete-keydown="handleNavigationDeleteKeydown"
      @confirm-navigation-delete="confirmNavigationDelete"
    />
  </section>
</template>

<style scoped>
.long-workspace-editor {
  container-type: inline-size;
  grid-column: 3;
  display: grid;
  grid-template-rows: minmax(40px, auto) minmax(0, 1fr) minmax(36px, auto);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid var(--theme-line);
  background: var(--surface-main);
  color: var(--text-primary);
}

.long-workspace-editor.has-navigation-tabs {
  grid-template-rows:
    minmax(42px, auto) minmax(40px, auto)
    minmax(0, 1fr) minmax(36px, auto);
}

.long-editor-toolbar {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  padding: 5px 13px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}

.long-editor-file-tabs,
.long-editor-view-tabs {
  display: flex;
  align-items: center;
  padding: 2px;
  border-radius: 7px;
  background: var(--surface-hover);
}

.long-editor-file-tabs {
  max-width: 48%;
  overflow-x: auto;
  scrollbar-width: none;
}

.long-editor-file-tabs::-webkit-scrollbar {
  display: none;
}

.long-editor-file-tabs button,
.long-editor-view-tabs button {
  flex: 0 0 auto;
  height: max(25px, 1.85em);
  padding: 0 9px;
  border-radius: 5px;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 0.714286rem;
  cursor: pointer;
}

.long-editor-file-tabs button.is-active,
.long-editor-view-tabs button.is-active {
  background: var(--surface-main);
  color: var(--text-primary);
  box-shadow: 0 1px 2px rgb(24 26 28 / 8%);
}

.long-editor-file-tabs button:disabled,
.long-editor-view-tabs button:disabled {
  cursor: default;
  opacity: 0.45;
}

.long-toolbar-separator {
  flex: 0 0 auto;
  width: 1px;
  height: 19px;
  margin: 0 4px;
  background: var(--theme-line);
}

.long-footer-spacer {
  flex: 1 1 auto;
}

.long-editor-text-tools {
  position: static;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 3px;
}

.long-editor-save-button {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 7px;
  background: var(--neutral-solid);
  color: var(--accent-contrast, #ffffff);
  font-size: 0.714286rem;
  cursor: pointer;
}

.long-editor-save-button:disabled {
  background: var(--surface-selected);
  color: var(--text-tertiary);
}

.long-editor-document {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--surface-main);
}

.long-editor-document.is-entry-right-list {
  display: grid;
  grid-template-columns:
    minmax(0, 1fr) 7px
    minmax(170px, var(--long-entry-list-width, 38%));
}

.long-editor-document.is-entry-right-list
  > :not(.long-entry-list-pane):not(.long-editor-internal-resizer) {
  grid-row: 1;
  grid-column: 1;
  min-width: 0;
  min-height: 0;
}

.long-entry-list-pane {
  grid-row: 1;
  grid-column: 3;
}

.long-editor-internal-resizer {
  position: relative;
  z-index: 4;
  width: 7px;
  min-width: 7px;
  height: 100%;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  cursor: col-resize;
  touch-action: none;
}

.long-editor-internal-resizer::after {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 1px;
  background: var(--theme-line-soft);
  content: "";
  transition:
    width 120ms ease,
    background 120ms ease;
}

.long-editor-internal-resizer:hover::after,
.long-editor-internal-resizer:focus-visible::after,
.is-resizing-entry-list > .long-entry-list-resizer::after,
.is-resizing-story-list > .long-story-plot-resizer::after {
  left: 2px;
  width: 3px;
  background: color-mix(in srgb, var(--accent) 72%, var(--theme-line));
}

.long-entry-list-resizer {
  grid-row: 1;
  grid-column: 2;
}

:global(html.is-long-editor-pane-resizing),
:global(html.is-long-editor-pane-resizing *) {
  cursor: col-resize !important;
  user-select: none !important;
}

.long-editor-writing-surface {
  --long-document-inline-padding: clamp(18px, 2vw, 24px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  padding: 28px 0 18px;
  overflow: hidden;
  background: var(--surface-main);
}

.long-continuity-workspace-host {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.long-editor-writing-surface.is-readonly {
  background: var(--surface-raised);
}

.long-document-title-input,
.long-document-title {
  width: 100%;
  margin: 8px 0 13px;
  padding: 0 var(--long-document-inline-padding);
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--editor-font);
  font-size: clamp(1.71429rem, 2.2vw, 2.42857rem);
  font-weight: 600;
  line-height: 1.28;
  letter-spacing: -0.025em;
}

.long-document-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.long-document-title-input[readonly] {
  color: var(--text-primary);
}

.long-document-editor,
.long-document-preview {
  width: 100%;
  min-height: 0;
  padding: 0 var(--long-document-inline-padding) 80px;
  overflow-x: hidden;
  overflow-y: auto;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--editor-font);
  font-size: 1.07143rem;
  line-height: 1.95;
  letter-spacing: 0.025em;
}

.long-document-editor {
  resize: none;
  white-space: pre-wrap;
}

.long-document-title-input:focus-visible,
.long-document-editor:focus-visible {
  outline: 1px solid
    color-mix(in srgb, var(--theme-foreground) 22%, transparent);
}

:global(html[data-theme="dark"] .long-document-title-input:focus-visible),
:global(html[data-theme="dark"] .long-document-editor:focus-visible) {
  outline-color: rgb(255 255 255 / 22%);
}

.long-document-editor[readonly] {
  color: var(--text-secondary);
}

.long-document-preview :deep(.markdown-content) {
  white-space: normal;
}

.long-document-preview .is-empty {
  color: var(--text-tertiary);
}

.long-worldbuilding-empty {
  display: grid;
  grid-row: 1 / -1;
  place-content: center;
  justify-items: center;
  gap: 8px;
  min-height: 0;
  padding: 28px;
  color: var(--text-tertiary);
  text-align: center;
}

.long-worldbuilding-empty strong {
  color: var(--text-primary);
}

.long-worldbuilding-empty span {
  font-size: 0.75rem;
}

.long-worldbuilding-empty button {
  margin-top: 4px;
  min-height: 31px;
  padding: 6px 11px;
  border-radius: 7px;
  background: var(--neutral-solid);
  color: var(--accent-contrast, #ffffff);
  font-size: 0.75rem;
  cursor: pointer;
}

.long-editor-readonly {
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
  padding: clamp(20px, 3vw, 38px) clamp(24px, 5vw, 70px);
  overflow: auto;
  border: 0;
  outline: 0;
  background: var(--surface-main);
  color: var(--text-primary);
  font-family: var(--code-font);
  font-size: var(--code-font-size);
  line-height: 1.75;
  white-space: pre-wrap;
}

.long-editor-loading,
.long-editor-unavailable,
.long-editor-empty {
  display: grid;
  place-content: center;
  justify-items: center;
  min-height: 100%;
  gap: 9px;
  padding: 28px;
  color: var(--text-tertiary);
  text-align: center;
}

.long-editor-loading {
  grid-auto-flow: column;
  align-items: center;
}

.long-editor-unavailable strong {
  color: var(--text-primary);
}

.long-editor-unavailable button {
  min-height: 31px;
  padding: 6px 11px;
  border: 1px solid var(--theme-line);
  border-radius: 7px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
}

.long-editor-unavailable button:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-editor-unavailable button:disabled {
  cursor: default;
  opacity: 0.5;
}

.long-loading-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  animation: long-editor-pulse 1.1s ease-in-out infinite;
}

.long-editor-footer {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 10px;
  padding: 0 13px;
  border-top: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
  color: var(--text-tertiary);
  font-size: 0.678571rem;
}

.long-editor-status {
  min-width: 0;
  max-width: 40%;
  overflow: hidden;
  color: var(--text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.long-editor-footer .long-editor-save-button {
  flex: 0 0 auto;
  height: max(26px, 1.9em);
  min-height: 26px;
  padding: 0 9px;
  border-radius: 6px;
}

.long-editor-empty {
  grid-row: 1 / -1;
}

.long-editor-empty-icon {
  display: grid;
  place-items: center;
  width: 58px;
  height: 58px;
  border-radius: 16px;
  background: var(--accent-soft);
  color: var(--accent);
}

.long-editor-empty h2 {
  color: var(--text-primary);
  font-size: 1.142857rem;
}

.long-editor-empty p {
  max-width: 420px;
  line-height: 1.65;
}

@container (max-width: 38rem) {
  .long-editor-toolbar {
    flex-wrap: wrap;
    padding-inline: 8px;
  }

  .long-editor-file-tabs {
    flex: 1 1 100%;
    max-width: 100%;
  }

  .long-editor-writing-surface {
    --long-document-inline-padding: clamp(14px, 4cqw, 20px);
    padding-top: 18px;
  }

  .long-document-title-input,
  .long-document-title {
    font-size: clamp(1.45rem, 7cqw, 2rem);
  }
}

@container (max-width: 27rem) {
  .long-footer-spacer {
    display: none;
  }
}

@keyframes long-editor-pulse {
  50% {
    opacity: 0.35;
    transform: scale(0.8);
  }
}

.long-story-plot-workspace {
  container-type: inline-size;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: var(--surface-main);
  color: var(--text-primary);
}

.long-story-plot-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  gap: 16px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-raised);
}

.long-story-plot-heading {
  min-width: 0;
}

.long-story-plot-heading h2 {
  overflow: hidden;
  margin: 0;
  font-size: 1.142857rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.long-story-plot-header-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 7px;
}

.long-story-plot-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 31px;
  gap: 5px;
  padding: 6px 11px;
  border: 1px solid var(--neutral-solid);
  border-radius: 7px;
  background: var(--neutral-solid);
  color: var(--accent-contrast, #ffffff);
  font-size: 0.75rem;
  font-weight: 620;
  cursor: pointer;
}

.long-story-plot-add:hover:not(:disabled) {
  filter: brightness(1.08);
}

.long-story-plot-add:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.long-story-plot-layout {
  display: grid;
  grid-template-columns:
    minmax(0, 1fr) 7px
    minmax(170px, var(--long-story-plot-list-width, 38%));
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.long-story-plot-detail-empty {
  display: grid;
  place-content: center;
  justify-items: center;
  min-height: 0;
  gap: 6px;
  padding: 24px;
  color: var(--text-tertiary);
  text-align: center;
}

.long-story-plot-detail-empty strong {
  color: var(--text-primary);
  font-size: 0.785714rem;
}

.long-story-plot-detail-empty span {
  max-width: 18rem;
  font-size: 0.678571rem;
  line-height: 1.5;
}

.long-story-plot-detail-empty {
  height: 100%;
}

.long-story-plot-detail {
  order: 1;
  grid-row: 1;
  grid-column: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--surface-main);
}

.long-story-plot-writing-surface {
  --long-document-inline-padding: clamp(16px, 2vw, 20px);
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
  padding: 14px 0 0;
  overflow: hidden;
  background: var(--surface-main);
}

.long-story-plot-writing-surface.is-readonly {
  background: var(--surface-raised);
}

.long-story-plot-title-input {
  width: 100%;
  margin: 6px 0 8px;
  padding: 0 var(--long-document-inline-padding);
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 1.142857rem;
  font-weight: 650;
  line-height: 1.35;
}

.long-story-plot-title-input[readonly] {
  color: var(--text-primary);
}

.long-story-plot-title-input:focus-visible {
  outline: 1px solid
    color-mix(in srgb, var(--theme-foreground) 22%, transparent);
}

.long-story-plot-text-toolbar {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  margin: 0 var(--long-document-inline-padding);
  padding: 0 0 8px;
  border-bottom: 1px solid var(--theme-line-soft);
}

.long-story-plot-editor {
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 12px var(--long-document-inline-padding) 20px;
  overflow-x: hidden;
  overflow-y: auto;
}

.long-story-plot-resizer {
  grid-row: 1;
  grid-column: 2;
}

@media (max-width: 56rem) {
  .long-story-plot-header {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .long-story-plot-layout {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) minmax(10rem, 34%);
  }

  .long-story-plot-resizer {
    display: none;
  }

  .long-story-plot-layout > .long-story-plot-pane {
    grid-row: 2;
    grid-column: 1;
    border-left: none;
    border-top: 1px solid var(--theme-line-soft);
  }

  .long-story-plot-layout > .long-story-plot-detail {
    grid-row: 1;
    grid-column: 1;
  }
}

@container (max-width: 26rem) {
  .long-editor-document.is-entry-right-list {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) minmax(10rem, 34%);
  }

  .long-editor-document.is-entry-right-list > :not(.long-entry-list-pane) {
    grid-row: 1;
    grid-column: 1;
  }

  .long-entry-list-pane {
    grid-row: 2;
    grid-column: 1;
    border-top: 1px solid var(--theme-line-soft);
    border-left: none;
  }

  .long-entry-list-resizer {
    display: none;
  }
}

@container (max-width: 31rem) {
  .long-story-plot-layout {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) minmax(10rem, 34%);
  }

  .long-story-plot-resizer {
    display: none;
  }

  .long-story-plot-layout > .long-story-plot-pane {
    grid-row: 2;
    grid-column: 1;
    border-top: 1px solid var(--theme-line-soft);
    border-left: none;
  }

  .long-story-plot-layout > .long-story-plot-detail {
    grid-row: 1;
    grid-column: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .long-loading-dot {
    animation: none;
  }
}
</style>
