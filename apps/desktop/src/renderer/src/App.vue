<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { darkTheme, NConfigProvider } from "naive-ui";
import type {
  CatalogDocument,
  CatalogDraftRecovery,
  CatalogLibraryEntry,
  CatalogLibraryGroup,
  CatalogSnapshot,
  CreateLibraryInput,
  CreateLibraryGroupInput,
  CreateLibraryEntryInput,
  CreateShortBookInput,
  LearningImitationSettings,
  LearningImitationSettingsInput,
  LearningImitationStageId,
  LibraryAgentDomain,
  LibraryAgentSettings,
  LibraryAgentSettingsInput,
  LinkedMaterialIdsByKind,
  LinkedSkillIdsByKind,
  MaterialKind,
  ModelConfigInput,
  ModelSettings,
  ModelSettingsInput,
  ShortBook,
  ShortManuscriptExportFormat,
  ShortWorkspaceAgentId,
  ShortWorkspaceAgentSettings,
  ShortWorkspaceAgentSettingsInput,
  SkillKind,
  SystemEventEnvelope,
  ThinkingLevel,
  UpdateLibraryGroupInput,
  UserPromptAttachment,
  WorkspaceDirectorySettings
} from "@deepwrite/contracts";
import {
  DEFAULT_LIBRARY_AGENT_PROFILES,
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  MATERIAL_KINDS,
  MaterialStageIdSchema,
  PROMPT_ATTACHMENT_MAX_ITEMS,
  SKILL_KINDS,
  SkillStageIdSchema,
  createShortWorkspaceContentRevision,
  resolveShortWorkspaceAgentIdForStage
} from "@deepwrite/contracts";
import AgentConversation from "./components/AgentConversation.vue";
import BookResourceDialog from "./components/BookResourceDialog.vue";
import CreateShortBookDialog from "./components/CreateShortBookDialog.vue";
import DeleteExpertSectionDialog from "./components/DeleteExpertSectionDialog.vue";
import ExportShortManuscriptDialog from "./components/ExportShortManuscriptDialog.vue";
import LibraryProjectDialog from "./components/LibraryProjectDialog.vue";
import LibraryGroupDialog from "./components/LibraryGroupDialog.vue";
import LibraryRemovalDialog from "./components/LibraryRemovalDialog.vue";
import LearningImitationDialog from "./components/LearningImitationDialog.vue";
import LeftSidebar from "./components/LeftSidebar.vue";
import RightEditorPane from "./components/RightEditorPane.vue";
import SaveConflictDialog from "./components/SaveConflictDialog.vue";
import SettingsPage from "./components/SettingsPage.vue";
import WorkspaceDialog from "./components/WorkspaceDialog.vue";
import {
  useAgentConversation,
  type AgentConversationController,
  type AgentRunSettings
} from "./composables/useAgentConversation";
import { useAppearance } from "./composables/useAppearance";
import { useLearningImitation } from "./composables/useLearningImitation";
import { uiMessage } from "./ui-feedback";
import { resourceSections } from "./data/demoWorkspace";
import {
  MATERIAL_KIND_LABELS,
  SKILL_KIND_LABELS,
  projectCatalogWorkspace,
  resolveBookWorkspaceId,
  resolveDraftSectionResourceId,
  resolveDraftSectionProjection,
  resolvePreferredBookResourceId,
  type DraftDirectoryProjection
} from "./data/catalogWorkspace";
import type {
  AgentEditProposal,
  ComposerReferenceOption,
  EditorTextReference,
  EditorTextReferenceNavigation
} from "./types/conversation";
import type {
  BookResourceDialogMode,
  CatalogResourceNodeActionPayload,
  DialogMode,
  EditorDraftState,
  ResourceSectionActionPayload,
  ResourceTreeNode,
  ResourceTreeSection,
  WorkspaceDocument
} from "./types/workspace";
import {
  applyBookResourcePreferences,
  BOOK_RESOURCE_PREFERENCES_STORAGE_KEY,
  parseBookResourcePreferences,
  type BookResourcePreference,
  type BookResourcePreferences
} from "./utils/bookResourcePreferences";
import { buildLibraryAttachments } from "./utils/libraryAttachments";
import { buildLibraryAgentWorkspaceContext, buildLibraryEntryComposerReferences } from "./utils/libraryAgentContext";
import { buildLibraryAgentSkillAttachments } from "./utils/libraryAgentSkillAttachments";
import {
  captureWorkspaceDocumentBaselines,
  rebaseDraftsForMatchingDocuments,
  type WorkspaceDocumentBaseline
} from "./utils/catalogSaveReconciliation";
import { draftCharacterStateTitle } from "./utils/draftFileTitles";
import { migrateLegacyDraftRecoveries } from "./utils/legacyDraftRecovery";
import { createShortManuscriptExportInput } from "./utils/shortManuscriptExport";
import {
  agentEditProposalId,
  classifyAgentEditAcceptance,
  expectedMutationBaseRevision,
  resolveAgentEditorMutationText
} from "./utils/agentEditReview";
import {
  AGENT_RUN_PREFERENCES_STORAGE_KEY,
  activeAgentDocumentForSelection,
  agentConversationKeyForDocument as conversationKeyForDocument,
  agentRunScopeForDocument,
  parseAgentRunPreferences,
  type AgentRunPreferencesByScope
} from "./utils/agentRunPreferences";
import { buildAgentTextDiff } from "./utils/agentTextDiff";

const EMPTY_WORKSPACE_DOCUMENT: WorkspaceDocument = {
  id: "deepwrite-empty-workspace",
  domain: "creation",
  title: "尚未打开书籍",
  eyebrow: "创作空间",
  path: ["尚未打开书籍"],
  content: "请从左侧创作空间的“＋”菜单新建书籍，或打开一个已存在的 DeepWrite 书籍文件夹。",
  readOnly: true,
  format: "设定"
};

const EMPTY_RESOURCE_SECTIONS: ResourceTreeSection[] = resourceSections.map((section) => ({
  ...section,
  nodes: []
}));
const COMPOSER_STAGE_LABELS = {
  character_design: "人设",
  plot_design: "剧情",
  outline: "大纲",
  expert_draft_coordinator: "正文",
  expert_section_writer: "分节"
} as const satisfies Record<ShortWorkspaceAgentId, string>;
const EDITOR_DRAFT_RECOVERY_KEY = "deepwrite:editor-draft-recovery:v1";
let draftRecoveryClock = 0;

function observeDraftRecoveryTimestamp(value: string | undefined): void {
  const timestamp = Date.parse(value ?? "");
  if (Number.isFinite(timestamp)) {
    draftRecoveryClock = Math.max(draftRecoveryClock, timestamp);
  }
}

function nextDraftRecoveryTimestamp(): string {
  draftRecoveryClock = Math.max(Date.now(), draftRecoveryClock + 1);
  return new Date(draftRecoveryClock).toISOString();
}

function loadEmergencyEditorDrafts(): Record<string, EditorDraftState> {
  try {
    const raw = localStorage.getItem(EDITOR_DRAFT_RECOVERY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([id, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const draft = value as Record<string, unknown>;
        if (
          draft.dirty !== true ||
          typeof draft.title !== "string" ||
          typeof draft.content !== "string"
        ) {
          return [];
        }
        return [[
          id,
          {
            title: draft.title,
            content: draft.content,
            dirty: true,
            ...(typeof draft.recoveryUpdatedAt === "string" &&
            Number.isFinite(Date.parse(draft.recoveryUpdatedAt))
              ? { recoveryUpdatedAt: draft.recoveryUpdatedAt }
              : {}),
            ...(typeof draft.baseRevision === "string"
              ? { baseRevision: draft.baseRevision }
              : {}),
            ...(typeof draft.baseProjectRevision === "number" &&
            Number.isSafeInteger(draft.baseProjectRevision) &&
            draft.baseProjectRevision >= 0
              ? { baseProjectRevision: draft.baseProjectRevision }
              : {})
          } satisfies EditorDraftState
        ]];
      })
    );
  } catch {
    return {};
  }
}

function loadAgentRunPreferences(): AgentRunPreferencesByScope {
  try {
    return parseAgentRunPreferences(
      localStorage.getItem(AGENT_RUN_PREFERENCES_STORAGE_KEY)
    );
  } catch {
    return {};
  }
}

function mergeRecoveredEditorDrafts(
  coreDrafts: CatalogDraftRecovery,
  emergencyDrafts: Record<string, EditorDraftState>,
  liveDrafts: CatalogDraftRecovery
): Record<string, EditorDraftState> {
  const merged: Record<string, EditorDraftState> = {};
  for (const source of [coreDrafts, emergencyDrafts, liveDrafts]) {
    for (const [id, draft] of Object.entries(source)) {
      if (!draft.dirty) continue;
      const existing = merged[id];
      observeDraftRecoveryTimestamp(existing?.recoveryUpdatedAt);
      observeDraftRecoveryTimestamp(draft.recoveryUpdatedAt);
      const existingTime = Date.parse(existing?.recoveryUpdatedAt ?? "");
      const candidateTime = Date.parse(draft.recoveryUpdatedAt ?? "");
      if (
        existing &&
        Number.isFinite(existingTime) &&
        (!Number.isFinite(candidateTime) || candidateTime < existingTime)
      ) {
        continue;
      }
      merged[id] = {
        title: draft.title,
        content: draft.content,
        dirty: true,
        recoveryUpdatedAt:
          draft.recoveryUpdatedAt ?? nextDraftRecoveryTimestamp(),
        ...(typeof draft.baseRevision === "string"
          ? { baseRevision: draft.baseRevision }
          : {}),
        ...(typeof draft.baseProjectRevision === "number"
          ? { baseProjectRevision: draft.baseProjectRevision }
          : {})
      };
    }
  }
  return merged;
}

const appearance = useAppearance();
const naiveTheme = computed(() =>
  appearance.resolvedScheme.value === "dark" ? darkTheme : null
);
const themeOverrides = computed(() => ({
  common: {
    primaryColor: appearance.activeTheme.value.accent,
    primaryColorHover: appearance.activeTheme.value.accent,
    primaryColorPressed: appearance.activeTheme.value.accent,
    borderRadius: "8px",
    fontFamily: "var(--ui-font)",
    fontSize: `${appearance.activeTheme.value.uiFontSize}px`
  }
}));

const leftCollapsed = ref(false);
const rightCollapsed = ref(false);
const desktopShell = ref<HTMLElement | null>(null);
const leftPaneWidth = ref(window.innerWidth <= 1220 ? 262 : 286);
const rightPaneWidth = ref(
  window.innerWidth <= 1220 ? 395 : Math.min(650, Math.max(410, window.innerWidth * 0.34))
);
const resizingPane = ref<"left" | "right" | null>(null);
const selectedResourceId = ref(EMPTY_WORKSPACE_DOCUMENT.id);
const activeCreationResourceId = ref(EMPTY_WORKSPACE_DOCUMENT.id);
const documents = ref<WorkspaceDocument[]>([{ ...EMPTY_WORKSPACE_DOCUMENT }]);
const editorDrafts = ref<Record<string, EditorDraftState>>({});
const selectedExpertSectionIds = ref<Record<string, string>>({});
const selectedDraftFileKinds = ref<
  Record<string, "body" | "character-state">
>({});
const pendingEditorReferences = ref<EditorTextReference[]>([]);
const editorReferenceNavigation = ref<EditorTextReferenceNavigation>();
let editorReferenceNavigationClock = 0;
const acceptingAgentEditDocumentIds = ref<Set<string>>(new Set());
const acceptingAgentEditWorkspaceIds = ref<Set<string>>(new Set());
const savingDocumentIds = ref<Set<string>>(new Set());
let recoveredEditorDraftCount = 0;
const dialogMode = ref<DialogMode | null>(null);
const learningImitationOpen = ref(false);
const learningImitation = useLearningImitation({
  api: () => window.deepwrite
});
const learningImitationRunning = computed(
  () => learningImitation.isBusy.value
);
const bookDialogMode = ref<BookResourceDialogMode | null>(null);
const activeBook = ref<ResourceTreeNode | null>(null);
const catalogSnapshot = ref<CatalogSnapshot | null>(null);
const catalogLoading = ref(false);
const catalogMutationPending = ref(false);
const manuscriptExportPending = ref(false);
const exportBookTarget = ref<ResourceTreeNode | null>(null);
const createShortBookDialogOpen = ref(false);
interface LibraryProjectDialogState {
  operation: "create-library" | "create-entry" | "remove-entry";
  domain: "material" | "skill";
  libraryId?: string;
  libraryTitle?: string;
  entryId?: string;
  entryTitle?: string;
  documentId?: string;
  materialKind?: MaterialKind | "mixed";
}
type CreateLibraryEntryDraft =
  | Omit<Extract<CreateLibraryEntryInput, { domain: "material" }>, "content">
  | Omit<Extract<CreateLibraryEntryInput, { domain: "skill" }>, "content">;
const libraryProjectDialog = ref<LibraryProjectDialogState | null>(null);
interface LibraryGroupDialogState {
  domain: "material" | "skill";
  groupId?: string;
}
const libraryGroupDialog = ref<LibraryGroupDialogState | null>(null);
interface LibraryRemovalDialogState {
  action: "remove" | "delete";
  payload: CatalogResourceNodeActionPayload;
}
const libraryRemovalDialog = ref<LibraryRemovalDialogState | null>(null);
const activeLibraryGroup = computed<CatalogLibraryGroup | null>(() => {
  const state = libraryGroupDialog.value;
  if (!state?.groupId) return null;
  const groups =
    state.domain === "material"
      ? catalogSnapshot.value?.materialGroups
      : catalogSnapshot.value?.skillGroups;
  return groups?.find((group) => group.id === state.groupId) ?? null;
});
interface PendingExpertSectionDeletion {
  workspaceId: string;
  draftDirectoryId: string;
  sectionId: string;
  sectionTitle: string;
  hasContent: boolean;
}
const pendingExpertSectionDeletion = ref<PendingExpertSectionDeletion | null>(null);
interface SaveConflictState {
  documentId: string;
  payload: { id: string; title: string; content: string };
  latestSnapshot: CatalogSnapshot;
  diskTitle: string;
  diskContent: string;
}
const saveConflict = ref<SaveConflictState | null>(null);
const saveConflictSubmitting = ref(false);
const currentView = ref<"workspace" | "settings">("workspace");
const modelSettings = ref<ModelSettings | null>(null);
const modelLoading = ref(false);
const modelSaving = ref(false);
const modelError = ref<string | null>(null);
const modelTestMessage = ref<string | null>(null);
const testingModelId = ref<string | null>(null);
const workspaceAgentSettings = ref<ShortWorkspaceAgentSettings>({
  workspaceType: "short",
  agents: DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES.map((agent) => ({
    ...agent,
    welcomeShortcuts: [
      agent.welcomeShortcuts[0],
      agent.welcomeShortcuts[1],
      agent.welcomeShortcuts[2]
    ],
    readAccess: {
      workspace: [...agent.readAccess.workspace],
      material: [...agent.readAccess.material],
      skill: [...agent.readAccess.skill]
    }
  }))
});
const workspaceAgentLoading = ref(false);
const workspaceAgentSaving = ref(false);
const workspaceAgentError = ref<string | null>(null);
const workspaceAgentStatus = ref<string | null>(null);
const libraryAgentSettings = ref<LibraryAgentSettings>({
  agents: DEFAULT_LIBRARY_AGENT_PROFILES.map((agent) => ({
    ...agent,
    readAccess: {
      skills: agent.readAccess.skills.map((skill) => ({ ...skill }))
    }
  }))
});
const libraryAgentLoading = ref(false);
const libraryAgentSaving = ref(false);
const learningImitationSettings = ref<LearningImitationSettings | null>(null);
const learningImitationLoading = ref(false);
const learningImitationSaving = ref(false);
const workspaceDirectoryPath = ref<string | null>(null);
const workspaceDirectoryLoading = ref(false);
let workspaceAgentFeedbackTimer: number | undefined;
let draftRecoveryTimer: number | undefined;
let draftPersistenceWarningShown = false;
let conversationPersistenceWarningShown = false;
let agentRunPreferenceWarningShown = false;
let removeSystemListener: (() => void) | undefined;
const conversations = new Map<string, AgentConversationController>();
const conversationScopes = new Map<string, string>();
const agentRunPreferences = ref<AgentRunPreferencesByScope>(
  loadAgentRunPreferences()
);
const seenCatalogDiagnosticKeys = new Set<string>();
const warnedUnmappedLegacyRecoveryKeys = new Set<string>();
const handledWorkspaceMutationEventIds = new Set<string>();
interface QueuedAutoAgentEdit {
  conversation: AgentConversationController;
  sessionId: string;
  runId: string;
  proposalId: string;
}
const queuedAutoAgentEdits = new Map<string, QueuedAutoAgentEdit>();
const acceptedLibraryMutationCounts = new Map<string, number>();
let autoAgentEditFlush = Promise.resolve();

const catalogProjection = computed(() =>
  catalogSnapshot.value ? projectCatalogWorkspace(catalogSnapshot.value) : null
);

const baseResourceSections = computed<ResourceTreeSection[]>(() => {
  const projected = catalogProjection.value?.resourceSections;
  if (!projected) {
    return EMPTY_RESOURCE_SECTIONS;
  }
  return projected;
});

function loadBookResourcePreferences(): BookResourcePreferences {
  try {
    return parseBookResourcePreferences(
      localStorage.getItem(BOOK_RESOURCE_PREFERENCES_STORAGE_KEY),
      baseResourceSections.value
    );
  } catch {
    return {};
  }
}

const bookResourcePreferences = ref<BookResourcePreferences>(loadBookResourcePreferences());

const resourceTreeSections = computed(() =>
  applyBookResourcePreferences(baseResourceSections.value, bookResourcePreferences.value)
);

function resourceSelectionExists(
  sections: readonly ResourceTreeSection[],
  resourceId: string
): boolean {
  const targetId = resourceTargetDocumentId(sections, resourceId);
  return documents.value.some((document) => document.id === targetId);
}

function fallbackCreationResourceId(
  previousSections: readonly ResourceTreeSection[],
  previousResourceId: string
): string {
  const previousTargetId = resourceTargetDocumentId(
    previousSections,
    previousResourceId
  );
  const previousWorkspaceId = documents.value.find(
    (document) => document.id === previousTargetId
  )?.workspaceId;
  return (
    (previousWorkspaceId
      ? resolvePreferredBookResourceId(
          catalogProjection.value ?? undefined,
          previousWorkspaceId
        )
      : undefined) ??
    catalogProjection.value?.draftDirectories[0]?.id ??
    documents.value.find((document) => document.domain === "creation")?.id ??
    documents.value[0]?.id ??
    ""
  );
}

watch(
  resourceTreeSections,
  (nextSections, previousSections) => {
    if (
      selectedResourceId.value &&
      !resourceSelectionExists(nextSections, selectedResourceId.value)
    ) {
      selectedResourceId.value = fallbackCreationResourceId(
        previousSections ?? [],
        selectedResourceId.value
      );
    }
    if (
      activeCreationResourceId.value &&
      !resourceSelectionExists(nextSections, activeCreationResourceId.value)
    ) {
      activeCreationResourceId.value = fallbackCreationResourceId(
        previousSections ?? [],
        activeCreationResourceId.value
      );
    }
  },
  { flush: "sync" }
);
const skillLibraries = computed<ResourceTreeNode[]>(() => {
  if (catalogSnapshot.value) {
    return catalogSnapshot.value.skills
      .filter((library) => library.skillType === "short")
      .map((library) => ({
      id: library.id,
      label: library.title,
      icon: "library",
      ...(library.isBuiltin ? { badge: "官方" } : {}),
      catalogNodeType: "library",
      libraryId: library.id,
      skillKind: library.skillKind
      }));
  }
  return resourceTreeSections.value.find((section) => section.id === "skill")?.nodes ?? [];
});
const materialLibraries = computed<ResourceTreeNode[]>(() => {
  if (catalogSnapshot.value) {
    return catalogSnapshot.value.materials
      .filter((library) => library.materialType === "short")
      .map((library) => ({
      id: library.id,
      label: library.title,
      icon: "archive",
      ...([library.parentGenre, library.subGenre].filter(Boolean).join(" / ")
        ? { badge: [library.parentGenre, library.subGenre].filter(Boolean).join(" / ") }
        : {}),
      catalogNodeType: "library",
      libraryId: library.id,
      materialKind: library.materialKind,
      ...(library.parentGenre ? { parentGenre: library.parentGenre } : {}),
      ...(library.subGenre ? { subGenre: library.subGenre } : {})
      }));
  }
  return resourceTreeSections.value.find((section) => section.id === "material")?.nodes ?? [];
});

function catalogBook(bookId: string): ShortBook | undefined {
  return catalogSnapshot.value?.books.find((book) => book.id === bookId);
}

function findResourceNodeIn(
  sections: readonly ResourceTreeSection[],
  resourceId: string
): ResourceTreeNode | undefined {
  const visit = (nodes: readonly ResourceTreeNode[]): ResourceTreeNode | undefined => {
    for (const node of nodes) {
      if (node.id === resourceId) return node;
      const nested = visit(node.children ?? []);
      if (nested) return nested;
    }
    return undefined;
  };
  return visit(sections.flatMap((section) => section.nodes));
}

function resourceIdForDocumentId(documentId: string): string | undefined {
  const visit = (nodes: readonly ResourceTreeNode[]): string | undefined => {
    for (const node of nodes) {
      if (
        node.id === documentId ||
        node.targetDocumentId === documentId ||
        node.characterStateDocumentId === documentId
      ) {
        return node.id;
      }
      const nested = visit(node.children ?? []);
      if (nested) return nested;
    }
    return undefined;
  };
  return visit(resourceTreeSections.value.flatMap((section) => section.nodes));
}

function resourceTargetDocumentId(
  sections: readonly ResourceTreeSection[],
  resourceId: string
): string {
  const node = findResourceNodeIn(sections, resourceId);
  return (
    node?.targetDocumentId ??
    (node?.shortAgentId === "expert_draft_coordinator"
      ? node.children?.find((child) => child.targetDocumentId)?.targetDocumentId
      : undefined) ??
    resourceId
  );
}

function applyCatalogSnapshot(snapshot: CatalogSnapshot): void {
  const previousProjection = catalogProjection.value ?? undefined;
  const selectedWorkspaceAnchor = resolveBookWorkspaceId(
    previousProjection,
    selectedResourceId.value
  );
  const activeWorkspaceAnchor = resolveBookWorkspaceId(
    previousProjection,
    activeCreationResourceId.value
  );
  const diagnostics = snapshot.projectDiagnostics ?? [];
  const diagnosticKeys = new Set(
    diagnostics.map(
      (diagnostic) =>
        `${diagnostic.projectId}\u0000${diagnostic.code}\u0000${diagnostic.message}`
    )
  );
  for (const key of seenCatalogDiagnosticKeys) {
    if (!diagnosticKeys.has(key)) {
      seenCatalogDiagnosticKeys.delete(key);
    }
  }
  const unseenDiagnostics = diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.projectId}\u0000${diagnostic.code}\u0000${diagnostic.message}`;
    if (seenCatalogDiagnosticKeys.has(key)) {
      return false;
    }
    seenCatalogDiagnosticKeys.add(key);
    return true;
  });
  if (unseenDiagnostics.length) {
    const first = unseenDiagnostics[0]!;
    uiMessage.warning(
      `项目“${first.projectId}”暂时无法读取：${first.message}${
        unseenDiagnostics.length > 1
          ? `（另有 ${unseenDiagnostics.length - 1} 个项目）`
          : ""
      }`
    );
  }
  const projection = projectCatalogWorkspace(snapshot);
  const projectedDocuments = new Map(
    projection.workspaceDocuments.map((document) => [document.id, document] as const)
  );
  const recoveryMigration = migrateLegacyDraftRecoveries(
    editorDrafts.value,
    snapshot,
    projection
  );
  const currentUnmappedLegacyKeys = new Set(recoveryMigration.unmappedLegacyKeys);
  for (const key of warnedUnmappedLegacyRecoveryKeys) {
    if (!currentUnmappedLegacyKeys.has(key)) {
      warnedUnmappedLegacyRecoveryKeys.delete(key);
    }
  }
  const newlyUnmappedLegacyKeys = recoveryMigration.unmappedLegacyKeys.filter(
    (key) => !warnedUnmappedLegacyRecoveryKeys.has(key)
  );
  if (newlyUnmappedLegacyKeys.length) {
    newlyUnmappedLegacyKeys.forEach((key) =>
      warnedUnmappedLegacyRecoveryKeys.add(key)
    );
    uiMessage.warning(
      `旧版恢复稿与当前正文的磁盘版本或小节结构不一致，原恢复稿已保留，请核对当前正文目录${
        newlyUnmappedLegacyKeys.length > 1
          ? `（共 ${newlyUnmappedLegacyKeys.length} 份）`
          : ""
      }`
    );
  }
  editorDrafts.value = Object.fromEntries(
    Object.entries(recoveryMigration.drafts).filter(([documentId, draft]) => {
      if (!draft.dirty) return false;
      const persisted = projectedDocuments.get(documentId);
      return (
        !persisted ||
        persisted.title !== draft.title ||
        persisted.content !== draft.content
      );
    })
  );
  recoveredEditorDraftCount = Object.keys(editorDrafts.value).filter((documentId) =>
    projectedDocuments.has(documentId)
  ).length;
  catalogSnapshot.value = snapshot;
  documents.value = projection.workspaceDocuments.length
    ? projection.workspaceDocuments
    : [{ ...EMPTY_WORKSPACE_DOCUMENT }];

  const selectedTargetId = resourceTargetDocumentId(
    projection.resourceSections,
    selectedResourceId.value
  );
  if (!documents.value.some((document) => document.id === selectedTargetId)) {
    selectedResourceId.value =
      (selectedWorkspaceAnchor
        ? resolvePreferredBookResourceId(projection, selectedWorkspaceAnchor)
        : undefined) ??
      projection.draftDirectories[0]?.id ??
      documents.value.find((document) => document.domain === "creation")?.id ??
      documents.value[0]?.id ??
      "";
  }
  const activeCreationTargetId = resourceTargetDocumentId(
    projection.resourceSections,
    activeCreationResourceId.value
  );
  if (!documents.value.some((document) => document.id === activeCreationTargetId)) {
    const selectedCreationTargetId = resourceTargetDocumentId(
      projection.resourceSections,
      selectedResourceId.value
    );
    activeCreationResourceId.value =
      (activeWorkspaceAnchor
        ? resolvePreferredBookResourceId(projection, activeWorkspaceAnchor)
        : undefined) ??
      (documents.value.some(
        (document) =>
          document.id === selectedCreationTargetId && document.domain === "creation"
      )
        ? selectedResourceId.value
        : undefined) ??
      documents.value.find((document) => document.domain === "creation")?.id ??
      documents.value[0]?.id ??
      "";
  }
}

async function loadCatalogSnapshot(): Promise<void> {
  if (!window.deepwrite || catalogLoading.value) {
    return;
  }
  catalogLoading.value = true;
  try {
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "加载素材库和技能库失败。");
  } finally {
    catalogLoading.value = false;
  }
}

function captureAgentRunSettings(
  conversation: AgentConversationController
): AgentRunSettings {
  return {
    selectedModelId: conversation.selectedModelId.value,
    thinkingLevel: conversation.thinkingLevel.value,
    temperature: conversation.temperature.value,
    approvalMode: conversation.approvalMode.value
  };
}

function storeAgentRunPreferences(): void {
  try {
    localStorage.setItem(
      AGENT_RUN_PREFERENCES_STORAGE_KEY,
      JSON.stringify(agentRunPreferences.value)
    );
    agentRunPreferenceWarningShown = false;
  } catch {
    if (agentRunPreferenceWarningShown) return;
    agentRunPreferenceWarningShown = true;
    uiMessage.warning("当前书籍的智能体运行选项暂时无法保存到本机");
  }
}

function persistAgentRunPreferences(
  scope: string,
  preferences: AgentRunSettings
): void {
  agentRunPreferences.value = {
    ...agentRunPreferences.value,
    [scope]: preferences
  };
  storeAgentRunPreferences();
}

function removeAgentRunPreferences(scope: string): void {
  if (!(scope in agentRunPreferences.value)) return;
  const next = { ...agentRunPreferences.value };
  delete next[scope];
  agentRunPreferences.value = next;
  storeAgentRunPreferences();
}

function synchronizeAgentRunPreferences(
  scope: string,
  source: AgentConversationController
): void {
  const preferences = captureAgentRunSettings(source);
  for (const [key, conversation] of conversations) {
    if (conversationScopes.get(key) === scope && conversation !== source) {
      conversation.applyRunSettings(preferences);
    }
  }
  persistAgentRunPreferences(scope, preferences);
}

function conversationForKey(
  key: string,
  scope = "general"
): AgentConversationController {
  const existing = conversations.get(key);
  if (existing) {
    const previousScope = conversationScopes.get(key);
    conversationScopes.set(key, scope);
    if (previousScope !== scope) {
      const preferences = agentRunPreferences.value[scope];
      if (preferences) {
        existing.applyRunSettings(preferences);
      }
    }
    return existing;
  }
  const created = useAgentConversation({
    api: () => window.deepwrite,
    persistenceKey: `deepwrite:agent-conversations:v1:${encodeURIComponent(key)}`,
    onPersistenceError: () => {
      if (conversationPersistenceWarningShown) return;
      conversationPersistenceWarningShown = true;
      uiMessage.warning("历史对话暂时无法保存到本机，本次运行中仍可继续切换");
    }
  });
  conversations.set(key, created);
  conversationScopes.set(key, scope);
  if (modelSettings.value) {
    created.applyModelSettings(modelSettings.value);
  }
  const preferences = agentRunPreferences.value[scope];
  if (preferences) {
    created.applyRunSettings(preferences);
  } else if (modelSettings.value) {
    persistAgentRunPreferences(scope, captureAgentRunSettings(created));
  }
  return created;
}

function allConversations(): AgentConversationController[] {
  return [...conversations.values()];
}

function applyModelSettingsToConversations(settings: ModelSettings): void {
  for (const conversation of allConversations()) {
    conversation.applyModelSettings(settings);
  }

  const representativeByScope = new Map<string, AgentConversationController>();
  for (const [key, conversation] of conversations) {
    const scope = conversationScopes.get(key) ?? "general";
    if (!representativeByScope.has(scope)) {
      representativeByScope.set(scope, conversation);
    }
  }
  for (const [scope, representative] of representativeByScope) {
    const preferences = agentRunPreferences.value[scope];
    if (preferences) {
      representative.applyRunSettings(preferences);
    }
    synchronizeAgentRunPreferences(scope, representative);
  }
}

conversationForKey("general");

function resourceNode(resourceId: string): ResourceTreeNode | undefined {
  return findResourceNodeIn(resourceTreeSections.value, resourceId);
}

function draftDirectoryForResourceId(
  resourceId: string
): DraftDirectoryProjection | undefined {
  const exact = catalogProjection.value?.draftDirectories.find(
    (directory) => directory.id === resourceId
  );
  if (exact) return exact;
  const node = resourceNode(resourceId);
  const targetId = node?.targetDocumentId ?? resourceId;
  const target = documents.value.find((document) => document.id === targetId);
  if (
    node?.shortAgentId !== "expert_section_writer" &&
    target?.draftDirectoryId === undefined
  ) {
    return undefined;
  }
  return catalogProjection.value?.draftDirectories.find(
    (directory) => directory.workspaceId === target?.workspaceId
  );
}

function selectedDraftSection(
  directory: DraftDirectoryProjection,
  node?: ResourceTreeNode
): DraftDirectoryProjection["sections"][number] | undefined {
  return resolveDraftSectionProjection(
    directory,
    selectedExpertSectionIds.value[directory.id],
    node?.expertSectionId
  );
}

function draftFileDocument(
  directory: DraftDirectoryProjection,
  sectionId: string,
  fileKind: "body" | "character-state"
): WorkspaceDocument | undefined {
  const section = directory.sections.find((candidate) => candidate.id === sectionId);
  if (!section) return undefined;
  const documentId =
    fileKind === "body"
      ? section.bodyDocumentId
      : section.characterStateDocumentId;
  return documents.value.find((document) => document.id === documentId);
}

function documentForResourceId(resourceId: string): WorkspaceDocument | undefined {
  const node = resourceNode(resourceId);
  const directory = draftDirectoryForResourceId(resourceId);
  if (directory) {
    const section = selectedDraftSection(directory, node);
    if (!section) return undefined;
    return draftFileDocument(
      directory,
      section.id,
      selectedDraftFileKinds.value[directory.id] ?? "body"
    );
  }
  const targetId = node?.targetDocumentId ?? resourceId;
  return documents.value.find((document) => document.id === targetId);
}

function liveDocument(document: WorkspaceDocument): WorkspaceDocument {
  const live = editorDrafts.value[document.id];
  return live ? { ...document, title: live.title, content: live.content } : document;
}

function promptDocumentForResourceId(resourceId: string): WorkspaceDocument | undefined {
  const node = resourceNode(resourceId);
  const directory = draftDirectoryForResourceId(resourceId);
  const promptSection = directory
    ? selectedDraftSection(directory, node)
    : undefined;
  const document =
    directory && promptSection
      ? draftFileDocument(directory, promptSection.id, "body")
      : documentForResourceId(resourceId);
  if (!document) return undefined;
  const resolved = liveDocument(document);
  if (!node?.shortAgentId) return resolved;
  if (node.shortAgentId === "expert_draft_coordinator" && directory) {
    const {
      catalogDocumentId: _catalogDocumentId,
      draftFileKind: _draftFileKind,
      expertSectionId: _expertSectionId,
      ...contextDocument
    } = resolved;
    return {
      ...contextDocument,
      id: "draft",
      title: directory.title,
      eyebrow: "短篇 · 正文",
      path: [resolved.workspaceTitle ?? resolved.path[0] ?? "短篇", directory.title],
      content: "",
      shortAgentId: "expert_draft_coordinator"
    };
  }
  return {
    ...resolved,
    shortAgentId: node.shortAgentId,
    ...(promptSection && node.shortAgentId === "expert_section_writer"
      ? {
          expertSectionId: promptSection.id,
          title: promptSection.title,
          eyebrow: "短篇 · 小节编写",
          path: [
            resolved.workspaceTitle ?? resolved.path[0] ?? "短篇",
            "正文",
            promptSection.title
          ]
        }
      : {})
  };
}

const activeDocument = computed<WorkspaceDocument>(() => {
  const source =
    documentForResourceId(selectedResourceId.value) ??
    documents.value[0]!;
  return liveDocument(source);
});
const activeEditorDraft = computed<EditorDraftState | undefined>(
  () => editorDrafts.value[activeDocument.value.id]
);
const activeExpertSectionTabs = computed(() => {
  const directory = draftDirectoryForResourceId(selectedResourceId.value);
  return (directory?.sections ?? []).map((section) => ({
    id: section.id,
    title: section.title
  }));
});
const activeExpertSectionId = computed(() => activeDocument.value.expertSectionId);
const activePromptDocument = computed<WorkspaceDocument>(() => {
  return (
    promptDocumentForResourceId(activeCreationResourceId.value) ??
    documents.value.find((document) => document.domain === "creation") ??
    documents.value[0]!
  );
});
const activeAgentDocument = computed<WorkspaceDocument>(() =>
  activeAgentDocumentForSelection(
    activeDocument.value,
    activePromptDocument.value
  )
);
const liveWorkspaceDocuments = computed<WorkspaceDocument[]>(() =>
  documents.value.map((document) => {
    const live = editorDrafts.value[document.id];
    return live ? { ...document, title: live.title, content: live.content } : document;
  })
);
const activeLibraryAgentContext = computed(() =>
  buildLibraryAgentWorkspaceContext(
    catalogSnapshot.value,
    activeAgentDocument.value,
    liveWorkspaceDocuments.value
  )
);
const activeLibraryBoundToBook = computed(() => {
  const document = activeDocument.value;
  const workspaceId = activePromptDocument.value.workspaceId;
  if (!document.libraryId || !workspaceId || document.domain === "creation") {
    return false;
  }
  const book = findVisibleBook(workspaceId);
  return document.domain === "skill"
    ? book?.boundSkillLibraryIds?.includes(document.libraryId) ?? false
    : book?.boundMaterialLibraryIds?.includes(document.libraryId) ?? false;
});
const activeConversationKey = computed(() =>
  conversationKeyForDocument(activeAgentDocument.value)
);
const activeConversation = computed(() =>
  conversationForKey(
    activeConversationKey.value,
    agentRunScopeForDocument(activeAgentDocument.value)
  )
);
const messages = computed(() => activeConversation.value.messages.value);
const conversationHistory = computed(() => activeConversation.value.history.value);
const currentSessionId = computed(() => activeConversation.value.sessionId.value);
const composerDraft = computed({
  get: () => activeConversation.value.draft.value,
  set: (value: string) => {
    activeConversation.value.draft.value = value;
  }
});
const approvalMode = computed(() => activeConversation.value.approvalMode.value);
const thinkingLevel = computed(() => activeConversation.value.thinkingLevel.value);
const temperature = computed(() => activeConversation.value.temperature.value);
const configuredModels = computed(
  () => activeConversation.value.configuredModels.value
);
const selectedModelId = computed(
  () => activeConversation.value.selectedModelId.value
);
const conversationError = computed(
  () => activeConversation.value.conversationError.value
);
const responding = computed(() => activeConversation.value.isBusy.value);
const canSend = computed(() => activeConversation.value.canSend.value);
const canSendAttachments = computed(
  () => activeConversation.value.canSendAttachments.value
);
const canStop = computed(() => activeConversation.value.canStop.value);
const editorLocked = computed(() => {
  const selectedDocument =
    promptDocumentForResourceId(selectedResourceId.value) ?? activeDocument.value;
  const key = conversationKeyForDocument(selectedDocument);
  return (
    acceptingAgentEditDocumentIds.value.has(activeDocument.value.id) ||
    acceptingAgentEditWorkspaceIds.value.has(
      agentRunScopeForDocument(activeAgentDocument.value)
    ) ||
    (activeDocument.value.workspaceId !== undefined &&
      acceptingAgentEditWorkspaceIds.value.has(activeDocument.value.workspaceId)) ||
    (key !== "general" &&
      conversationForKey(
        key,
        agentRunScopeForDocument(selectedDocument)
      ).isBusy.value)
  );
});
const editorLockedLabel = computed(() =>
  acceptingAgentEditDocumentIds.value.has(activeDocument.value.id) ||
  acceptingAgentEditWorkspaceIds.value.has(
    agentRunScopeForDocument(activeAgentDocument.value)
  ) ||
  (activeDocument.value.workspaceId !== undefined &&
    acceptingAgentEditWorkspaceIds.value.has(activeDocument.value.workspaceId))
    ? "正在接受并保存智能体修改"
    : undefined
);
const editorSaving = computed(() => savingDocumentIds.value.has(activeDocument.value.id));
const activeAgentId = computed<ShortWorkspaceAgentId | undefined>(() => {
  const document = activeAgentDocument.value;
  return document.workspaceType === "short" && document.stageId
    ? document.shortAgentId ?? resolveShortWorkspaceAgentIdForStage(document.stageId)
    : undefined;
});
const activeLibraryDomain = computed<LibraryAgentDomain | undefined>(() => {
  const domain = activeAgentDocument.value.domain;
  return domain === "material" || domain === "skill" ? domain : undefined;
});
const activeShortAgentProfile = computed(() => {
  const agentId = activeAgentId.value;
  return agentId
    ? workspaceAgentSettings.value?.agents.find((agent) => agent.id === agentId)
    : undefined;
});
const activeLibraryAgentProfile = computed(() => {
  const domain = activeAgentDocument.value.domain;
  return domain === "material" || domain === "skill"
    ? libraryAgentSettings.value.agents.find((agent) => agent.domain === domain)
    : undefined;
});
const activeAgentLabel = computed(
  () =>
    activeShortAgentProfile.value?.label ??
    activeLibraryAgentProfile.value?.label ??
    "智能体对话"
);
const composerBookTitle = computed(
  () =>
    activeAgentDocument.value.workspaceTitle ??
    activeAgentDocument.value.path[0] ??
    "未选择资源"
);
const composerStageLabel = computed(() => {
  const agentId = activeAgentId.value;
  if (agentId) return COMPOSER_STAGE_LABELS[agentId];
  return activeAgentDocument.value.domain === "skill"
    ? "技能库"
    : activeAgentDocument.value.domain === "material"
      ? "素材库"
      : "未选择阶段";
});
const activeLibraryAttachments = computed(() => {
  if (activeAgentDocument.value.domain !== "creation") return null;
  const workspaceId = activePromptDocument.value.workspaceId;
  return catalogSnapshot.value && workspaceId && catalogBook(workspaceId)
    ? buildLibraryAttachments(catalogSnapshot.value, workspaceId)
    : null;
});
const activeLibrarySkillAttachments = computed(() => {
  const profile = activeLibraryAgentProfile.value;
  if (!profile) return null;
  return buildLibraryAgentSkillAttachments(profile.readAccess.skills);
});
const activeLibraryWelcomeSkills = computed(() =>
  activeLibraryAgentProfile.value?.readAccess.skills.map((skill) => ({
    name: skill.name
  }))
);
const activeWelcomeShortcuts = computed(() =>
  activeShortAgentProfile.value?.welcomeShortcuts
);
const availableSkillReferences = computed<ComposerReferenceOption[]>(() => {
  if (activeLibraryDomain.value) {
    return (activeLibrarySkillAttachments.value?.attachedSkills ?? []).map((skill) => ({
      id: skill.id,
      label: skill.title,
      detail: "按需加载的方法"
    }));
  }
  const allowedKinds = new Set(activeShortAgentProfile.value?.readAccess.skill ?? []);
  return (activeLibraryAttachments.value?.attachedSkills ?? [])
    .filter(
      (skill): skill is typeof skill & { kind: SkillKind } =>
        skill.kind !== undefined && allowedKinds.has(skill.kind)
    )
    .map((skill) => ({
      id: skill.id,
      label: skill.title,
      detail: `${SKILL_KIND_LABELS[skill.kind]} · 当前书籍已绑定`
    }));
});
const availableMaterialReferences = computed<ComposerReferenceOption[]>(() => {
  if (activeLibraryDomain.value) {
    return buildLibraryEntryComposerReferences(activeLibraryAgentContext.value);
  }
  const allowedKinds = new Set(activeShortAgentProfile.value?.readAccess.material ?? []);
  return (activeLibraryAttachments.value?.attachedMaterials ?? [])
    .filter(
      (material): material is typeof material & { kind: MaterialKind } =>
        material.kind !== undefined && allowedKinds.has(material.kind)
    )
    .map((material) => ({
      id: material.id,
      label: material.title,
      detail: `${MATERIAL_KIND_LABELS[material.kind]} · 当前书籍已绑定`
    }));
});

const shellClasses = computed(() => ({
  "is-left-collapsed": leftCollapsed.value,
  "is-right-collapsed": rightCollapsed.value,
  "is-resizing": resizingPane.value !== null
}));
const shellStyle = computed(() => ({
  "--left-pane-width": `${leftPaneWidth.value}px`,
  "--right-pane-width": `${rightPaneWidth.value}px`
}));
const hasDesktopRuntime = computed(() => Boolean(window.deepwrite));

watch(conversationError, (message) => {
  if (message) {
    uiMessage.error(message);
  }
});

const LEFT_PANE_MIN = 220;
const LEFT_PANE_MAX = 480;
const RIGHT_PANE_MIN = 320;
const RIGHT_PANE_MAX = 760;
const CENTER_PANE_MIN_FALLBACK = 420;

function centerPaneMinWidth(): number {
  if (!desktopShell.value) {
    return CENTER_PANE_MIN_FALLBACK;
  }
  const value = Number.parseFloat(
    window.getComputedStyle(desktopShell.value).getPropertyValue("--center-pane-min")
  );
  return Number.isFinite(value) ? value : CENTER_PANE_MIN_FALLBACK;
}

function clampPaneWidth(side: "left" | "right", width: number): number {
  const shellWidth = desktopShell.value?.getBoundingClientRect().width ?? window.innerWidth;
  const otherWidth =
    side === "left"
      ? rightCollapsed.value
        ? 0
        : rightPaneWidth.value
      : leftCollapsed.value
        ? 0
        : leftPaneWidth.value;
  const paneMin = side === "left" ? LEFT_PANE_MIN : RIGHT_PANE_MIN;
  const paneMax = side === "left" ? LEFT_PANE_MAX : RIGHT_PANE_MAX;
  const availableMax = Math.max(paneMin, shellWidth - otherWidth - centerPaneMinWidth());
  return Math.round(Math.min(Math.max(width, paneMin), paneMax, availableMax));
}

function setPaneWidth(side: "left" | "right", width: number): void {
  if (side === "left") {
    leftPaneWidth.value = clampPaneWidth(side, width);
    return;
  }
  rightPaneWidth.value = clampPaneWidth(side, width);
}

function reconcilePaneWidths(): void {
  if (!leftCollapsed.value) {
    setPaneWidth("left", leftPaneWidth.value);
  }
  if (!rightCollapsed.value) {
    setPaneWidth("right", rightPaneWidth.value);
  }
}

function handleResizeMove(event: PointerEvent): void {
  if (!resizingPane.value || !desktopShell.value) {
    return;
  }
  const bounds = desktopShell.value.getBoundingClientRect();
  const width =
    resizingPane.value === "left" ? event.clientX - bounds.left : bounds.right - event.clientX;
  setPaneWidth(resizingPane.value, width);
}

function stopPaneResize(): void {
  resizingPane.value = null;
  window.removeEventListener("pointermove", handleResizeMove);
  window.removeEventListener("pointerup", stopPaneResize);
  window.removeEventListener("pointercancel", stopPaneResize);
}

function startPaneResize(side: "left" | "right", event: PointerEvent): void {
  event.preventDefault();
  resizingPane.value = side;
  window.addEventListener("pointermove", handleResizeMove);
  window.addEventListener("pointerup", stopPaneResize);
  window.addEventListener("pointercancel", stopPaneResize);
}

function handleResizeKeydown(side: "left" | "right", event: KeyboardEvent): void {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
    return;
  }
  event.preventDefault();
  const direction = event.key === "ArrowLeft" ? -1 : 1;
  const currentWidth = side === "left" ? leftPaneWidth.value : rightPaneWidth.value;
  setPaneWidth(side, currentWidth + direction * (side === "left" ? 12 : -12));
}

function selectResource(node: ResourceTreeNode): void {
  const directory = draftDirectoryForResourceId(node.id);
  if (directory && node.expertSectionId) {
    selectedExpertSectionIds.value = {
      ...selectedExpertSectionIds.value,
      [directory.id]: node.expertSectionId
    };
    selectedDraftFileKinds.value = {
      ...selectedDraftFileKinds.value,
      [directory.id]: "body"
    };
  }
  const document = documentForResourceId(node.id);
  if (!document) {
    return;
  }
  selectedResourceId.value = node.id;
  if (document.domain === "creation") {
    activeCreationResourceId.value = node.id;
  }
  rightCollapsed.value = false;
}

function collectResourceNodeIds(node: ResourceTreeNode): string[] {
  return [node.id, ...(node.children?.flatMap(collectResourceNodeIds) ?? [])];
}

function findVisibleBook(bookId: string): ResourceTreeNode | undefined {
  return resourceTreeSections.value
    .find((section) => section.id === "creation")
    ?.nodes.find((node) => node.id === bookId);
}

function updateBookPreference(bookId: string, patch: BookResourcePreference): void {
  bookResourcePreferences.value = {
    ...bookResourcePreferences.value,
    [bookId]: {
      ...bookResourcePreferences.value[bookId],
      ...patch
    }
  };
  try {
    localStorage.setItem(
      BOOK_RESOURCE_PREFERENCES_STORAGE_KEY,
      JSON.stringify(bookResourcePreferences.value)
    );
  } catch {
    uiMessage.warning("书籍设置暂时无法保存，但本次操作仍然有效");
  }
}

function openBookDialog(mode: BookResourceDialogMode, book: ResourceTreeNode): void {
  activeBook.value = book;
  bookDialogMode.value = mode;
}

function closeBookDialog(): void {
  bookDialogMode.value = null;
  activeBook.value = null;
}

const MANUSCRIPT_EXPORT_FORMAT_LABELS: Record<
  ShortManuscriptExportFormat,
  string
> = {
  docx: "DOCX",
  txt: "TXT",
  epub: "EPUB"
};

function openBookExportDialog(book: ResourceTreeNode): void {
  exportBookTarget.value = book;
}

function closeBookExportDialog(): void {
  if (!manuscriptExportPending.value) {
    exportBookTarget.value = null;
  }
}

async function exportBookManuscript(
  format: ShortManuscriptExportFormat
): Promise<void> {
  if (!window.deepwrite || manuscriptExportPending.value) return;
  const bookNode = exportBookTarget.value;
  if (!bookNode) return;
  const book = catalogBook(bookNode.id);
  if (!book) {
    uiMessage.error("未找到要导出正文的书籍");
    exportBookTarget.value = null;
    return;
  }
  manuscriptExportPending.value = true;
  try {
    const result = await window.deepwrite.manuscript.exportShort(
      createShortManuscriptExportInput(
        book,
        documents.value,
        editorDrafts.value,
        format
      )
    );
    if (result.status === "saved") {
      exportBookTarget.value = null;
      uiMessage.success(
        `已将“${book.title}”的导语和全部小节导出为 ${MANUSCRIPT_EXPORT_FORMAT_LABELS[format]}`
      );
    }
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "导出正文失败。");
  } finally {
    manuscriptExportPending.value = false;
  }
}

async function renameCatalogBook(
  book: ResourceTreeNode,
  payload: { bookId: string; label: string }
): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  catalogMutationPending.value = true;
  try {
    const persistedBook = catalogBook(payload.bookId);
    if (!persistedBook) {
      throw new Error("未找到要修改的书籍。");
    }
    const baseProjectRevision = book.projectRevision ?? persistedBook.projectRevision;
    await window.deepwrite.catalog.updateBook({
      bookId: payload.bookId,
      ...(baseProjectRevision === undefined
        ? {}
        : { baseProjectRevision }),
      title: payload.label.trim().slice(0, 80)
    });
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    closeBookDialog();
    uiMessage.success(`已将“${book.label}”修改为“${payload.label.trim()}”`);
  } catch (error: unknown) {
    if (isCatalogConflict(error)) {
      await loadCatalogSnapshot();
      closeBookDialog();
      uiMessage.warning("书籍配置已在外部更新，已重新加载；请确认后再次修改")
    } else {
      uiMessage.error(error instanceof Error ? error.message : "修改书名失败。");
    }
  } finally {
    catalogMutationPending.value = false;
  }
}

function renameBook(payload: { bookId: string; label: string }): void {
  const book = findVisibleBook(payload.bookId);
  if (!book) {
    closeBookDialog();
    return;
  }

  if (catalogBook(payload.bookId)) {
    void renameCatalogBook(book, payload);
    return;
  }

  const label = payload.label.trim().slice(0, 80);
  const documentIds = new Set(collectResourceNodeIds(book));
  documents.value = documents.value.map((document) => {
    if (!documentIds.has(document.id)) {
      return document;
    }
    return {
      ...document,
      path: document.path.length ? [label, ...document.path.slice(1)] : [label],
      ...(document.workspaceId === payload.bookId ? { workspaceTitle: label } : {})
    };
  });
  updateBookPreference(payload.bookId, { label });
  closeBookDialog();
  uiMessage.success(`已将“${book.label}”修改为“${label}”`);
}

function disposeBookConversations(bookId: string, documentIds?: Set<string>): void {
  const conversationKeys = new Set(
    [...conversations.keys()].filter((key) => key.startsWith(`${bookId}:`))
  );
  for (const document of documents.value) {
    if (
      document.workspaceId === bookId ||
      Boolean(documentIds?.has(document.id))
    ) {
      const key = conversationKeyForDocument(document);
      if (key !== "general") conversationKeys.add(key);
    }
  }
  for (const key of conversationKeys) {
    conversations.get(key)?.dispose();
    conversations.delete(key);
    conversationScopes.delete(key);
  }
  removeAgentRunPreferences(`book:${bookId}`);
}

function disposeLibraryConversation(
  domain: "material" | "skill",
  libraryId: string
): void {
  const key = `library:${domain}:${libraryId}`;
  conversations.get(key)?.dispose();
  conversations.delete(key);
  conversationScopes.delete(key);
  removeAgentRunPreferences(key);
}

async function removeCatalogBook(book: ResourceTreeNode): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  catalogMutationPending.value = true;
  try {
    const result = await window.deepwrite.catalog.unregisterProject({
      domain: "book",
      projectId: book.id
    });
    if (!result.unregistered) {
      throw new Error("未找到要移除的书籍。");
    }
    const removedDocumentIds = new Set(collectResourceNodeIds(book));
    editorDrafts.value = Object.fromEntries(
      Object.entries(editorDrafts.value).filter(
        ([documentId]) => !removedDocumentIds.has(documentId)
      )
    );
    disposeBookConversations(book.id);
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    closeBookDialog();
    uiMessage.success(`已移除“${book.label}”`);
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "移除书籍失败。");
  } finally {
    catalogMutationPending.value = false;
  }
}

async function deleteCatalogBook(book: ResourceTreeNode): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  catalogMutationPending.value = true;
  try {
    const result = await window.deepwrite.catalog.deleteProject({
      domain: "book",
      projectId: book.id
    });
    if (!result.deleted) {
      throw new Error("未找到要删除的书籍。");
    }
    const removedDocumentIds = new Set(collectResourceNodeIds(book));
    editorDrafts.value = Object.fromEntries(
      Object.entries(editorDrafts.value).filter(
        ([documentId]) => !removedDocumentIds.has(documentId)
      )
    );
    disposeBookConversations(book.id);
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    closeBookDialog();
    uiMessage.success(`已删除“${book.label}”及其本地文件夹`);
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "删除书籍失败。");
  } finally {
    catalogMutationPending.value = false;
  }
}

async function removeUnavailableCatalogBook(book: ResourceTreeNode): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  catalogMutationPending.value = true;
  try {
    const result = await window.deepwrite.catalog.unregisterProject({
      domain: "book",
      projectId: book.id
    });
    if (!result.unregistered) {
      throw new Error("该书籍已经不在项目注册表中。");
    }
    disposeBookConversations(book.id);
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    closeBookDialog();
    uiMessage.success(`已解除“${book.label}”的注册，本地文件夹未删除`);
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "移除不可用书籍失败。");
  } finally {
    catalogMutationPending.value = false;
  }
}

function removeBook(bookId: string): void {
  const book = findVisibleBook(bookId);
  if (!book) {
    closeBookDialog();
    return;
  }

  if (catalogBook(bookId)) {
    void removeCatalogBook(book);
    return;
  }
  if (book.unavailable) {
    void removeUnavailableCatalogBook(book);
    return;
  }

  const documentIds = new Set(collectResourceNodeIds(book));
  disposeBookConversations(bookId, documentIds);

  documents.value = documents.value.filter((document) => !documentIds.has(document.id));
  editorDrafts.value = Object.fromEntries(
    Object.entries(editorDrafts.value).filter(([documentId]) => !documentIds.has(documentId))
  );
  if (documentIds.has(selectedResourceId.value)) {
    selectedResourceId.value =
      documents.value.find((document) => document.domain === "creation")?.id ??
      documents.value[0]?.id ??
      "";
  }
  if (documentIds.has(activeCreationResourceId.value)) {
    activeCreationResourceId.value =
      documents.value.find((document) => document.domain === "creation")?.id ??
      documents.value[0]?.id ??
      "";
  }

  updateBookPreference(bookId, { removed: true });
  closeBookDialog();
  uiMessage.success(`已移除“${book.label}”`);
}

function deleteBook(bookId: string): void {
  const book = findVisibleBook(bookId);
  if (!book) {
    closeBookDialog();
    return;
  }
  if (!catalogBook(bookId) || book.unavailable) {
    uiMessage.error("该书籍没有可删除的本地项目文件夹。");
    return;
  }
  void deleteCatalogBook(book);
}

async function updateCatalogBookBindings(
  book: ResourceTreeNode,
  payload:
    | { bookId: string; domain: "skill"; linksByKind: LinkedSkillIdsByKind }
    | { bookId: string; domain: "material"; linksByKind: LinkedMaterialIdsByKind }
): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  catalogMutationPending.value = true;
  try {
    const persistedBook = catalogBook(payload.bookId);
    if (!persistedBook) {
      throw new Error("未找到要更新绑定的书籍。");
    }
    const baseProjectRevision = book.projectRevision ?? persistedBook.projectRevision;
    await window.deepwrite.catalog.updateBook({
      bookId: payload.bookId,
      ...(baseProjectRevision === undefined
        ? {}
        : { baseProjectRevision }),
      ...(payload.domain === "skill"
        ? {
            linkedSkillIdsByKind: payload.linksByKind
          }
        : {
            linkedMaterialIdsByKind: payload.linksByKind
          })
    });
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    closeBookDialog();
    uiMessage.success(
      `已更新“${book.label}”的${payload.domain === "skill" ? "技能库" : "素材库"}绑定`
    );
  } catch (error: unknown) {
    if (isCatalogConflict(error)) {
      await loadCatalogSnapshot();
      closeBookDialog();
      uiMessage.warning("书籍绑定已在外部更新，已重新加载；请确认后再次保存")
    } else {
      uiMessage.error(error instanceof Error ? error.message : "更新资料库绑定失败。");
    }
  } finally {
    catalogMutationPending.value = false;
  }
}

function updateBookBindings(payload:
  | { bookId: string; domain: "skill"; linksByKind: LinkedSkillIdsByKind }
  | { bookId: string; domain: "material"; linksByKind: LinkedMaterialIdsByKind }
): void {
  const book = findVisibleBook(payload.bookId);
  if (!book) {
    closeBookDialog();
    return;
  }
  if (catalogBook(payload.bookId)) {
    void updateCatalogBookBindings(book, payload);
    return;
  }
  updateBookPreference(
    payload.bookId,
    payload.domain === "skill"
      ? { skillLibraryIds: [...new Set(Object.values(payload.linksByKind).flat())] }
      : { materialLibraryIds: [...new Set(Object.values(payload.linksByKind).flat())] }
  );
  closeBookDialog();
  uiMessage.success(
    `已更新“${book.label}”的${payload.domain === "skill" ? "技能库" : "素材库"}绑定`
  );
}

async function createShortBook(input: CreateShortBookInput): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) {
    return;
  }
  catalogMutationPending.value = true;
  try {
    const book = await window.deepwrite.catalog.createShortBook(input);
    if (!book) {
      return;
    }
    await loadWorkspaceDirectory();
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    createShortBookDialogOpen.value = false;
    const targetResourceId = resolvePreferredBookResourceId(
      catalogProjection.value ?? undefined,
      book.id
    );
    if (targetResourceId) {
      selectedResourceId.value = targetResourceId;
      activeCreationResourceId.value = targetResourceId;
      rightCollapsed.value = false;
    }
    uiMessage.success(`已创建短篇“${book.title}”，素材库和技能库绑定已保存`);
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "创建短篇书籍失败。");
  } finally {
    catalogMutationPending.value = false;
  }
}

async function handleResourceAction(payload: ResourceSectionActionPayload): Promise<void> {
  if (payload.domain === "creation" && payload.action === "create") {
    if (!window.deepwrite) {
      uiMessage.warning("浏览器预览不能保存书籍，请使用桌面客户端创建短篇。");
      return;
    }
    createShortBookDialogOpen.value = true;
    return;
  }

  if (
    payload.action === "create" &&
    (payload.domain === "material" || payload.domain === "skill")
  ) {
    if (!window.deepwrite) {
      uiMessage.warning("浏览器预览不能创建本地资料库，请使用桌面客户端。");
      return;
    }
    libraryProjectDialog.value = {
      operation: "create-library",
      domain: payload.domain
    };
    return;
  }

  if (
    payload.action === "create-group" &&
    (payload.domain === "material" || payload.domain === "skill")
  ) {
    if (!window.deepwrite) {
      uiMessage.warning("浏览器预览不能创建本地分组，请使用桌面客户端。");
      return;
    }
    libraryGroupDialog.value = { domain: payload.domain };
    return;
  }

  if (payload.domain === "creation" && payload.action === "import-legacy-book") {
    if (!window.deepwrite) {
      uiMessage.warning("浏览器预览不能导入旧版书籍，请使用桌面客户端。");
      return;
    }
    if (catalogMutationPending.value) {
      return;
    }
    catalogMutationPending.value = true;
    try {
      const imported = await window.deepwrite.catalog.importLegacyBook();
      if (!imported) {
        return;
      }
      await loadWorkspaceDirectory();
      applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
      const targetResourceId = resolvePreferredBookResourceId(
        catalogProjection.value ?? undefined,
        imported.id
      );
      if (targetResourceId) {
        selectedResourceId.value = targetResourceId;
        activeCreationResourceId.value = targetResourceId;
        rightCollapsed.value = false;
      }
      uiMessage.success(`已导入旧版书籍“${imported.title}”并转换为新的文件结构`);
    } catch (error: unknown) {
      uiMessage.error(error instanceof Error ? error.message : "导入旧版书籍失败。");
    } finally {
      catalogMutationPending.value = false;
    }
    return;
  }

  if (
    payload.action === "import-legacy-library" &&
    (payload.domain === "material" || payload.domain === "skill")
  ) {
    if (!window.deepwrite) {
      uiMessage.warning("浏览器预览不能导入旧版资料库，请使用桌面客户端。");
      return;
    }
    if (catalogMutationPending.value) {
      return;
    }
    catalogMutationPending.value = true;
    try {
      const result = await window.deepwrite.catalog.importLegacyLibrary(
        payload.domain
      );
      if (!result) {
        return;
      }
      await loadWorkspaceDirectory();
      applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
      const imported = result.imported.at(-1);
      const target = documents.value.find(
        (document) => document.libraryId === imported?.id
      );
      if (target) {
        selectedResourceId.value = target.id;
        rightCollapsed.value = false;
      }
      const libraryLabel = payload.domain === "material" ? "素材" : "技能";
      if (result.failures.length === 0) {
        uiMessage.success(
          result.imported.length === 1
            ? `已导入旧版${libraryLabel}库“${result.imported[0]!.title}”并新建资料库`
            : `已导入 ${result.imported.length} 个旧版${libraryLabel}库并新建资料库`
        );
      } else {
        const failureSummary = result.failures
          .map(({ fileName, message }) => `${fileName}：${message}`)
          .join("；");
        if (result.imported.length > 0) {
          uiMessage.warning(
            `已导入 ${result.imported.length} 个旧版${libraryLabel}库，${result.failures.length} 个失败：${failureSummary}`
          );
        } else {
          uiMessage.error(`导入旧版${libraryLabel}库失败：${failureSummary}`);
        }
      }
    } catch (error: unknown) {
      uiMessage.error(
        error instanceof Error ? error.message : "导入旧版资料库失败。"
      );
    } finally {
      catalogMutationPending.value = false;
    }
    return;
  }

  if (payload.action === "import") {
    if (!window.deepwrite) {
      uiMessage.warning("浏览器预览不能打开本地文件夹，请使用桌面客户端。");
      return;
    }
    if (catalogMutationPending.value) {
      return;
    }
    const domain =
      payload.domain === "creation"
        ? "book"
        : payload.domain === "material"
          ? "material"
          : "skill";
    catalogMutationPending.value = true;
    try {
      const opened = await window.deepwrite.catalog.openProject(domain);
      if (!opened) {
        return;
      }
      await loadWorkspaceDirectory();
      applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
      const targetResourceId =
        opened.domain === "book"
          ? resolvePreferredBookResourceId(
              catalogProjection.value ?? undefined,
              opened.id
            )
          : documents.value.find((document) => document.libraryId === opened.id)?.id;
      if (targetResourceId) {
        selectedResourceId.value = targetResourceId;
        if (opened.domain === "book") {
          activeCreationResourceId.value = targetResourceId;
        }
        rightCollapsed.value = false;
      }
      uiMessage.success(`已打开${opened.domain === "book" ? "书籍" : opened.domain === "material" ? "素材库" : "技能库"}“${opened.title}”`);
    } catch (error: unknown) {
      uiMessage.error(error instanceof Error ? error.message : "打开本地项目失败。");
    } finally {
      catalogMutationPending.value = false;
    }
    return;
  }

  uiMessage.info("当前资源操作暂不可用。");
}

function findCatalogLibrary(
  domain: "material" | "skill",
  libraryId: string
) {
  return domain === "material"
    ? catalogSnapshot.value?.materials.find((library) => library.id === libraryId)
    : catalogSnapshot.value?.skills.find((library) => library.id === libraryId);
}

function advanceLibraryDraftProjectRevision(
  domain: "material" | "skill",
  libraryId: string,
  expectedProjectRevision: number | undefined
): void {
  const projectRevision = findCatalogLibrary(domain, libraryId)?.projectRevision;
  if (
    projectRevision === undefined ||
    expectedProjectRevision === undefined ||
    projectRevision !== expectedProjectRevision
  ) {
    return;
  }
  const documentIds = new Set(
    documents.value
      .filter(
        (document) =>
          document.domain === domain && document.libraryId === libraryId
      )
      .map((document) => document.id)
  );
  editorDrafts.value = Object.fromEntries(
    Object.entries(editorDrafts.value).map(([documentId, draft]) => [
      documentId,
      documentIds.has(documentId) && draft.dirty
        ? {
            ...draft,
            recoveryUpdatedAt: nextDraftRecoveryTimestamp(),
            baseProjectRevision: projectRevision
          }
        : draft
    ])
  );
}

async function createCatalogLibrary(payload: CreateLibraryInput): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  catalogMutationPending.value = true;
  try {
    const created = await window.deepwrite.catalog.createLibrary(payload);
    if (!created) return;
    await loadWorkspaceDirectory();
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    libraryProjectDialog.value = null;
    const target = documents.value.find(
      (document) => document.libraryId === created.id
    );
    if (target) {
      selectedResourceId.value = target.id;
      rightCollapsed.value = false;
    }
    uiMessage.success(`已创建${payload.domain === "material" ? "素材" : "技能"}库“${created.title}”`);
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "创建资料库失败。");
  } finally {
    catalogMutationPending.value = false;
  }
}

async function createCatalogLibraryGroup(
  payload: CreateLibraryGroupInput
): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  catalogMutationPending.value = true;
  try {
    const created = await window.deepwrite.catalog.createLibraryGroup(payload);
    if (!created) return;
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    libraryGroupDialog.value = null;
    uiMessage.success(`已创建${payload.domain === "material" ? "素材" : "技能"}分组“${created.title}”`);
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "创建资料库分组失败。");
  } finally {
    catalogMutationPending.value = false;
  }
}

async function updateCatalogLibraryGroup(
  payload: UpdateLibraryGroupInput
): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  catalogMutationPending.value = true;
  try {
    const updated = await window.deepwrite.catalog.updateLibraryGroup(payload);
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    libraryGroupDialog.value = null;
    uiMessage.success(`已更新分组“${updated.title}”的绑定`);
  } catch (error: unknown) {
    if (isCatalogConflict(error)) {
      await loadCatalogSnapshot();
      libraryGroupDialog.value = null;
      uiMessage.warning("分组配置已在外部更新，已重新加载；请确认后再次切换绑定");
    } else {
      uiMessage.error(error instanceof Error ? error.message : "更新分组绑定失败。");
    }
  } finally {
    catalogMutationPending.value = false;
  }
}

function saveCatalogLibraryGroup(
  payload: CreateLibraryGroupInput | UpdateLibraryGroupInput
): void {
  if ("groupId" in payload) {
    void updateCatalogLibraryGroup(payload);
  } else {
    void createCatalogLibraryGroup(payload);
  }
}

async function createCatalogLibraryEntry(
  payload: CreateLibraryEntryDraft
): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  catalogMutationPending.value = true;
  try {
    const baseProjectRevision = findCatalogLibrary(
      payload.domain,
      payload.libraryId
    )?.projectRevision;
    const created = await window.deepwrite.catalog.createLibraryEntry({
      ...payload,
      content: "",
      ...(baseProjectRevision === undefined ? {} : { baseProjectRevision })
    });
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    advanceLibraryDraftProjectRevision(
      payload.domain,
      payload.libraryId,
      baseProjectRevision === undefined ? undefined : baseProjectRevision + 1
    );
    libraryProjectDialog.value = null;
    const target = documents.value.find(
      (document) =>
        document.libraryId === payload.libraryId &&
        document.catalogEntryId === created.id
    );
    if (target) {
      selectedResourceId.value = target.id;
      rightCollapsed.value = false;
    }
    uiMessage.success(`已创建${payload.domain === "material" ? "素材" : "技能"}条目“${created.title}”`);
  } catch (error: unknown) {
    if (isCatalogConflict(error)) {
      await loadCatalogSnapshot();
      libraryProjectDialog.value = null;
      uiMessage.warning("资料库已在外部更新，已重新加载；请从新目录状态重新创建条目");
    } else {
      uiMessage.error(error instanceof Error ? error.message : "创建资料库条目失败。");
    }
  } finally {
    catalogMutationPending.value = false;
  }
}

async function removeCatalogLibraryEntry(payload: {
  domain: "material" | "skill";
  libraryId: string;
  entryId: string;
}): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  catalogMutationPending.value = true;
  const dialogState = libraryProjectDialog.value;
  try {
    const library = findCatalogLibrary(payload.domain, payload.libraryId);
    const baseProjectRevision = library?.projectRevision;
    const persistedDocument = documents.value.find(
      (document) =>
        document.libraryId === payload.libraryId &&
        document.catalogEntryId === payload.entryId
    );
    const result = await window.deepwrite.catalog.removeLibraryEntry({
      ...payload,
      ...(persistedDocument === undefined
        ? {}
        : {
            baseRevision: createShortWorkspaceContentRevision(
              persistedDocument.content
            )
          }),
      ...(baseProjectRevision === undefined
        ? {}
        : { baseProjectRevision })
    });
    if (!result.deleted) {
      await loadCatalogSnapshot();
      libraryProjectDialog.value = null;
      uiMessage.warning("条目已经不存在，目录已重新加载");
      return;
    }
    if (dialogState?.documentId) {
      const nextDrafts = { ...editorDrafts.value };
      delete nextDrafts[dialogState.documentId];
      editorDrafts.value = nextDrafts;
    }
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    advanceLibraryDraftProjectRevision(
      payload.domain,
      payload.libraryId,
      baseProjectRevision === undefined ? undefined : baseProjectRevision + 1
    );
    libraryProjectDialog.value = null;
    uiMessage.success(`已删除${payload.domain === "material" ? "素材" : "技能"}条目文件`);
  } catch (error: unknown) {
    if (isCatalogConflict(error)) {
      await loadCatalogSnapshot();
      libraryProjectDialog.value = null;
      uiMessage.warning("资料库已在外部更新，已重新加载；请确认后再次删除");
    } else {
      uiMessage.error(error instanceof Error ? error.message : "删除资料库条目失败。");
    }
  } finally {
    catalogMutationPending.value = false;
  }
}

async function unregisterCatalogLibrary(
  payload: CatalogResourceNodeActionPayload
): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value || !payload.node.libraryId) return;
  catalogMutationPending.value = true;
  try {
    const result = await window.deepwrite.catalog.unregisterProject({
      domain: payload.domain,
      projectId: payload.node.libraryId
    });
    if (!result.unregistered) {
      throw new Error("资料库已经不在当前目录中。");
    }
    disposeLibraryConversation(payload.domain, payload.node.libraryId);
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    libraryRemovalDialog.value = null;
    uiMessage.success(`已从列表移除“${payload.node.label}”，本地文件夹仍完整保留`);
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "移除资料库失败。");
  } finally {
    catalogMutationPending.value = false;
  }
}

async function deleteCatalogLibrary(
  payload: CatalogResourceNodeActionPayload
): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value || !payload.node.libraryId) return;
  catalogMutationPending.value = true;
  try {
    const result = await window.deepwrite.catalog.deleteProject({
      domain: payload.domain,
      projectId: payload.node.libraryId
    });
    if (!result.deleted) {
      throw new Error("资料库已经不在当前目录中。");
    }
    const removedDocumentIds = new Set(collectResourceNodeIds(payload.node));
    editorDrafts.value = Object.fromEntries(
      Object.entries(editorDrafts.value).filter(
        ([documentId]) => !removedDocumentIds.has(documentId)
      )
    );
    disposeLibraryConversation(payload.domain, payload.node.libraryId);
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    libraryRemovalDialog.value = null;
    uiMessage.success(`已删除“${payload.node.label}”及其本地文件夹`);
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "删除资料库失败。");
  } finally {
    catalogMutationPending.value = false;
  }
}

function confirmLibraryRemoval(): void {
  const dialog = libraryRemovalDialog.value;
  if (!dialog) return;
  if (dialog.action === "delete") {
    void deleteCatalogLibrary(dialog.payload);
  } else {
    void unregisterCatalogLibrary(dialog.payload);
  }
}

async function dissolveCatalogLibraryGroup(
  payload: CatalogResourceNodeActionPayload
): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value || !payload.node.groupId) return;
  catalogMutationPending.value = true;
  try {
    const result = await window.deepwrite.catalog.unregisterProject({
      domain: payload.domain === "material" ? "material-group" : "skill-group",
      projectId: payload.node.groupId
    });
    if (!result.unregistered) {
      throw new Error("分组已经不在当前目录中。");
    }
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    uiMessage.success(`已解散分组“${payload.node.label}”，成员库已回到原分类`);
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "解散分组失败。");
  } finally {
    catalogMutationPending.value = false;
  }
}

function handleResourceNodeAction(payload: CatalogResourceNodeActionPayload): void {
  if (payload.action === "edit-group-bindings") {
    if (!payload.node.groupId) {
      uiMessage.error("未找到对应的分组");
      return;
    }
    libraryGroupDialog.value = {
      domain: payload.domain,
      groupId: payload.node.groupId
    };
    return;
  }
  if (payload.action === "dissolve-group") {
    void dissolveCatalogLibraryGroup(payload);
    return;
  }
  const libraryId = payload.node.libraryId;
  if (!libraryId) {
    uiMessage.error("未找到对应的本地资料库");
    return;
  }
  if (
    (payload.node.readOnly || payload.node.unavailable) &&
    (payload.action === "create-entry" || payload.action === "remove-entry")
  ) {
    uiMessage.warning("内置技能库为只读内容，不能修改条目");
    return;
  }
  if (payload.action === "unregister-library") {
    libraryRemovalDialog.value = { action: "remove", payload };
    return;
  }
  if (payload.action === "delete-library") {
    libraryRemovalDialog.value = { action: "delete", payload };
    return;
  }
  if (payload.action === "create-entry") {
    libraryProjectDialog.value = {
      operation: "create-entry",
      domain: payload.domain,
      libraryId,
      libraryTitle: payload.node.label,
      ...(payload.domain === "material" && payload.node.materialKind
        ? { materialKind: payload.node.materialKind }
        : {})
    };
    return;
  }
  if (!payload.node.catalogEntryId) {
    uiMessage.error("未找到要删除的条目文件");
    return;
  }
  libraryProjectDialog.value = {
    operation: "remove-entry",
    domain: payload.domain,
    libraryId,
    libraryTitle:
      findCatalogLibrary(payload.domain, libraryId)?.title ?? "资料库",
    entryId: payload.node.catalogEntryId,
    entryTitle: payload.node.label,
    documentId: payload.node.id
  };
}

function stageEditorDraft(payload: { id: string; title: string; content: string }): void {
  const persisted = documents.value.find((document) => document.id === payload.id);
  const existingDraft = editorDrafts.value[payload.id];
  editorDrafts.value = {
    ...editorDrafts.value,
    [payload.id]: {
      title: payload.title,
      content: payload.content,
      dirty: true,
      recoveryUpdatedAt: nextDraftRecoveryTimestamp(),
      ...(existingDraft?.baseRevision
        ? { baseRevision: existingDraft.baseRevision }
        : persisted
          ? { baseRevision: createShortWorkspaceContentRevision(persisted.content) }
          : {}),
      ...(existingDraft?.baseProjectRevision !== undefined
        ? { baseProjectRevision: existingDraft.baseProjectRevision }
        : persisted?.catalogProjectRevision === undefined
          ? {}
          : { baseProjectRevision: persisted.catalogProjectRevision })
    }
  };
}

function handleLiveDocumentChange(rawPayload: { id: string; title: string; content: string }): void {
  stageEditorDraft(rawPayload);
}

function expertDraftMutationBlocked(source: WorkspaceDocument): boolean {
  return (
    savingDocumentIds.value.has(source.id) ||
    acceptingAgentEditDocumentIds.value.has(source.id) ||
    Boolean(
      source.workspaceId &&
      (acceptingAgentEditWorkspaceIds.value.has(source.workspaceId) ||
        [...conversations.entries()].some(
          ([key, conversation]) =>
            key.startsWith(`${source.workspaceId}:expert_`) &&
            conversation.isBusy.value
        ))
    )
  );
}

function selectExpertSection(sectionId: string): void {
  const directory = draftDirectoryForResourceId(selectedResourceId.value);
  if (!directory) return;
  if (!directory.sections.some((section) => section.id === sectionId)) {
    uiMessage.warning("该小节已不存在，章节列表已刷新");
    return;
  }
  selectedExpertSectionIds.value = {
    ...selectedExpertSectionIds.value,
    [directory.id]: sectionId
  };
  const selectedNode = resourceNode(selectedResourceId.value);
  if (selectedNode?.shortAgentId === "expert_section_writer") {
    const sectionResourceId = resolveDraftSectionResourceId(
      resourceNode(directory.id),
      sectionId
    );
    if (sectionResourceId) {
      selectedResourceId.value = sectionResourceId;
      activeCreationResourceId.value = sectionResourceId;
    }
  }
}

function selectDraftFile(fileKind: "body" | "character-state"): void {
  const directory = draftDirectoryForResourceId(selectedResourceId.value);
  if (!directory) return;
  selectedDraftFileKinds.value = {
    ...selectedDraftFileKinds.value,
    [directory.id]: fileKind
  };
}

function insertEditorSelectionReference(reference: EditorTextReference): void {
  const duplicate = pendingEditorReferences.value.some(
    (item) =>
      item.documentId === reference.documentId &&
      item.start === reference.start &&
      item.end === reference.end &&
      item.text === reference.text
  );
  if (duplicate) {
    uiMessage.info("这段正文已经插入输入框");
    return;
  }
  if (pendingEditorReferences.value.length >= PROMPT_ATTACHMENT_MAX_ITEMS) {
    uiMessage.warning(`每条消息最多插入 ${PROMPT_ATTACHMENT_MAX_ITEMS} 段正文引用`);
    return;
  }
  pendingEditorReferences.value = [...pendingEditorReferences.value, reference];
}

function removeEditorSelectionReference(referenceId: string): void {
  pendingEditorReferences.value = pendingEditorReferences.value.filter(
    (reference) => reference.id !== referenceId
  );
}

function clearEditorSelectionReferences(): void {
  pendingEditorReferences.value = [];
}

function locateEditorSelectionReference(reference: EditorTextReference): void {
  const document = documents.value.find((candidate) => candidate.id === reference.documentId);
  if (!document) {
    removeEditorSelectionReference(reference.id);
    uiMessage.warning("引用的正文文件已不存在，已移除这条引用");
    return;
  }

  let targetResourceId = resourceNode(reference.resourceId)
    ? reference.resourceId
    : resourceIdForDocumentId(reference.documentId) ?? reference.documentId;
  if (document.draftFileKind && document.expertSectionId) {
    const directory = catalogProjection.value?.draftDirectories.find((candidate) =>
      candidate.sections.some(
        (section) =>
          section.bodyDocumentId === document.id ||
          section.characterStateDocumentId === document.id
      )
    );
    if (directory) {
      selectedExpertSectionIds.value = {
        ...selectedExpertSectionIds.value,
        [directory.id]: document.expertSectionId
      };
      selectedDraftFileKinds.value = {
        ...selectedDraftFileKinds.value,
        [directory.id]: document.draftFileKind
      };
      const referenceNode = resourceNode(targetResourceId);
      const referenceDirectory = referenceNode
        ? draftDirectoryForResourceId(referenceNode.id)
        : undefined;
      if (referenceDirectory?.id !== directory.id) {
        targetResourceId =
          resolveDraftSectionResourceId(
            resourceNode(directory.id),
            document.expertSectionId
          ) ?? directory.id;
      }
    }
  }

  selectedResourceId.value = targetResourceId;
  if (document.domain === "creation") {
    activeCreationResourceId.value = targetResourceId;
  }
  rightCollapsed.value = false;
  editorReferenceNavigation.value = {
    requestId: ++editorReferenceNavigationClock,
    reference
  };
}

async function addExpertSection(draftNode: ResourceTreeNode): Promise<void> {
  const directory = draftDirectoryForResourceId(draftNode.id);
  const source = documentForResourceId(draftNode.id);
  if (!directory) return;
  if (source?.workspaceType !== "short" || source.stageId !== "draft") return;
  if (
    draftNode.shortAgentId !==
      "expert_draft_coordinator" ||
    expertDraftMutationBlocked(source) ||
    source.readOnly ||
    catalogMutationPending.value ||
    !window.deepwrite
  ) {
    uiMessage.info("当前正文暂时不能新建小节，请稍候");
    return;
  }
  if (directory.sections.length >= 100) {
    uiMessage.warning("正文最多支持 100 个小节");
    return;
  }
  catalogMutationPending.value = true;
  try {
    const book = catalogBook(directory.workspaceId);
    const added = await window.deepwrite.catalog.createDraftSection({
      bookId: directory.workspaceId,
      ...(directory.sections.at(-1)
        ? { afterSectionId: directory.sections.at(-1)!.id }
        : {}),
      ...(book?.projectRevision === undefined
        ? {}
        : { baseProjectRevision: book.projectRevision })
    });
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    selectedResourceId.value = directory.id;
    activeCreationResourceId.value = directory.id;
    selectedExpertSectionIds.value = {
      ...selectedExpertSectionIds.value,
      [directory.id]: added.id
    };
    selectedDraftFileKinds.value = {
      ...selectedDraftFileKinds.value,
      [directory.id]: "body"
    };
    uiMessage.success(`已新建“${added.title}”并保存到正文文件夹`);
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "新建正文小节失败。");
  } finally {
    catalogMutationPending.value = false;
  }
}

function requestRemoveExpertSection(node: ResourceTreeNode): void {
  if (!node.expertSectionId) return;
  const directory = draftDirectoryForResourceId(node.id);
  const section = directory?.sections.find(
    (candidate) => candidate.id === node.expertSectionId
  );
  if (!directory || !section) {
    uiMessage.warning("该小节已经不存在");
    return;
  }
  if (directory.sections.length <= 1) {
    uiMessage.warning("正文至少需要保留一个小节");
    return;
  }
  const body = draftFileDocument(directory, section.id, "body");
  const characterState = draftFileDocument(
    directory,
    section.id,
    "character-state"
  );
  pendingExpertSectionDeletion.value = {
    workspaceId: directory.workspaceId,
    draftDirectoryId: directory.id,
    sectionId: section.id,
    sectionTitle: section.title,
    hasContent: Boolean(
      (body && liveDocument(body).content.trim()) ||
      (characterState && liveDocument(characterState).content.trim()) ||
      section.wordCountRequirement.trim()
    )
  };
}

async function confirmRemoveExpertSection(): Promise<void> {
  const pending = pendingExpertSectionDeletion.value;
  if (!pending) return;
  const directory = catalogProjection.value?.draftDirectories.find(
    (candidate) => candidate.id === pending.draftDirectoryId
  );
  const section = directory?.sections.find(
    (candidate) => candidate.id === pending.sectionId
  );
  const source = section
    ? documents.value.find((document) => document.id === section.bodyDocumentId)
    : undefined;
  if (!directory || !section || !source) {
    pendingExpertSectionDeletion.value = null;
    uiMessage.warning("该正文已经不存在");
    return;
  }
  const conversationKey = `${pending.workspaceId}:expert_section_writer:${encodeURIComponent(pending.sectionId)}`;
  if (
    expertDraftMutationBlocked(source) ||
    catalogMutationPending.value ||
    !window.deepwrite
  ) {
    uiMessage.info("当前小节正在处理或保存，请稍候再删除");
    return;
  }
  const removedIndex = directory.sections.findIndex(
    (candidate) => candidate.id === pending.sectionId
  );
  const fallbackSections = directory.sections.filter(
    (candidate) => candidate.id !== pending.sectionId
  );
  const fallbackSection =
    fallbackSections[Math.min(removedIndex, fallbackSections.length - 1)];
  catalogMutationPending.value = true;
  try {
    const book = catalogBook(pending.workspaceId);
    const deleted = await window.deepwrite.catalog.deleteDraftSection({
      bookId: pending.workspaceId,
      sectionId: pending.sectionId,
      ...(book?.projectRevision === undefined
        ? {}
        : { baseProjectRevision: book.projectRevision })
    });
    if (!deleted.deleted) {
      throw new Error("该正文小节已经不存在。");
    }
    const nextDrafts = { ...editorDrafts.value };
    delete nextDrafts[section.bodyDocumentId];
    delete nextDrafts[section.characterStateDocumentId];
    editorDrafts.value = nextDrafts;
    conversations.get(conversationKey)?.dispose();
    conversations.delete(conversationKey);
    // Keep the refresh anchored to this book's virtual draft directory. If the
    // deleted child disappears first, the generic fallback would otherwise
    // choose the first draft directory from another book.
    selectedResourceId.value = directory.id;
    activeCreationResourceId.value = directory.id;
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    selectedResourceId.value = directory.id;
    activeCreationResourceId.value = directory.id;
    if (fallbackSection) {
      selectedExpertSectionIds.value = {
        ...selectedExpertSectionIds.value,
        [directory.id]: fallbackSection.id
      };
    }
    selectedDraftFileKinds.value = {
      ...selectedDraftFileKinds.value,
      [directory.id]: "body"
    };
    pendingExpertSectionDeletion.value = null;
    uiMessage.success(`已删除“${pending.sectionTitle}”及对应人物状态文件`);
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "删除正文小节失败。");
  } finally {
    catalogMutationPending.value = false;
  }
}

function applyDocumentLocally(
  payload: { id: string; title: string; content: string },
  savedProjectRevision?: number,
  submittedPayload = payload
): void {
  const index = documents.value.findIndex((document) => document.id === payload.id);
  if (index < 0) {
    return;
  }
  const current = documents.value[index]!;
  const projectDocumentIds = new Set(
    documents.value.flatMap((document) => {
      const belongsToProject = current.workspaceId
        ? document.workspaceId === current.workspaceId
        : current.libraryId
          ? document.libraryId === current.libraryId && document.domain === current.domain
          : document.id === current.id;
      return belongsToProject ? [document.id] : [];
    })
  );
  documents.value = documents.value.map((document) => {
    if (!projectDocumentIds.has(document.id)) return document;
    const withProjectRevision =
      savedProjectRevision === undefined
        ? document
        : { ...document, catalogProjectRevision: savedProjectRevision };
    if (document.id === payload.id) {
      const path = [...withProjectRevision.path];
      if (document.draftFileKind === "body" && path.length >= 2) {
        path[path.length - 2] = payload.title;
      } else if (path.length) {
        path[path.length - 1] = payload.title;
      }
      return {
        ...withProjectRevision,
        title: payload.title,
        content: payload.content,
        path
      };
    }
    if (
      current.draftFileKind === "body" &&
      document.draftFileKind === "character-state" &&
      document.expertSectionId === current.expertSectionId
    ) {
      const path = [...withProjectRevision.path];
      if (path.length >= 2) path[path.length - 2] = payload.title;
      return {
        ...withProjectRevision,
        title: draftCharacterStateTitle(payload.title),
        path
      };
    }
    return withProjectRevision;
  });
  const currentDraft = editorDrafts.value[payload.id];
  const nextDrafts = { ...editorDrafts.value };
  if (savedProjectRevision !== undefined) {
    for (const documentId of projectDocumentIds) {
      const draft = nextDrafts[documentId];
      if (draft?.dirty) {
        nextDrafts[documentId] = {
          ...draft,
          recoveryUpdatedAt: nextDraftRecoveryTimestamp(),
          baseProjectRevision: savedProjectRevision
        };
      }
    }
  }
  if (current.draftFileKind === "body" && current.expertSectionId) {
    const pairedState = documents.value.find(
      (document) =>
        document.workspaceId === current.workspaceId &&
        document.expertSectionId === current.expertSectionId &&
        document.draftFileKind === "character-state"
    );
    if (pairedState && nextDrafts[pairedState.id]) {
      nextDrafts[pairedState.id] = {
        ...nextDrafts[pairedState.id]!,
        title: draftCharacterStateTitle(payload.title)
      };
    }
  }
  if (
    currentDraft &&
    (currentDraft.title !== submittedPayload.title ||
      currentDraft.content !== submittedPayload.content)
  ) {
    // The user continued typing while an asynchronous save was in flight.
    // Keep that newer draft and advance only its disk base to what just saved.
    nextDrafts[payload.id] = {
      ...currentDraft,
      ...(current.draftFileKind === "character-state"
        ? { title: payload.title }
        : {}),
      dirty: true,
      recoveryUpdatedAt: nextDraftRecoveryTimestamp(),
      baseRevision: createShortWorkspaceContentRevision(payload.content),
      ...(savedProjectRevision === undefined
        ? {}
        : { baseProjectRevision: savedProjectRevision })
    };
  } else {
    delete nextDrafts[payload.id];
  }
  editorDrafts.value = nextDrafts;
}

function applyAcceptedAgentDocumentLocally(
  payload: { id: string; title: string; content: string },
  savedProjectRevision: number | undefined,
  draftAtAccept: EditorDraftState | undefined
): void {
  const currentDraft = editorDrafts.value[payload.id];
  if (currentDraft && currentDraft === draftAtAccept) {
    // Only replace the exact draft reviewed by the user. Recovery syncs,
    // programmatic writes, or another window may have produced a newer draft
    // while Core was saving; applyDocumentLocally preserves those drafts.
    editorDrafts.value = {
      ...editorDrafts.value,
      [payload.id]: {
        ...currentDraft,
        title: payload.title,
        content: payload.content
      }
    };
  }
  applyDocumentLocally(payload, savedProjectRevision);
}

async function refreshBookAfterSuccessfulDocumentSave(
  workspaceId: string,
  expectedDocuments: ReadonlyMap<string, WorkspaceDocumentBaseline>
): Promise<boolean> {
  if (!window.deepwrite) return false;
  try {
    const latestSnapshot = await window.deepwrite.catalog.snapshot();
    const latestBook = latestSnapshot.books.find(
      (book) => book.id === workspaceId
    );
    if (!latestBook) {
      throw new Error("保存后的书籍没有出现在最新目录快照中。");
    }
    const latestRevision = latestBook.projectRevision;
    const currentRevision = catalogBook(workspaceId)?.projectRevision;
    if (
      latestRevision !== undefined &&
      currentRevision !== undefined &&
      latestRevision < currentRevision
    ) {
      return true;
    }
    applyCatalogSnapshot(latestSnapshot);
    const projectRevision = catalogBook(workspaceId)?.projectRevision;
    editorDrafts.value = rebaseDraftsForMatchingDocuments(
      editorDrafts.value,
      documents.value,
      workspaceId,
      expectedDocuments,
      projectRevision,
      nextDraftRecoveryTimestamp()
    );
    return true;
  } catch {
    uiMessage.warning("文稿已保存，但最新目录版本暂未同步；下次聚焦窗口时会自动重试");
    return false;
  }
}

function setAgentEditDocumentAccepting(documentId: string, accepting: boolean): void {
  const next = new Set(acceptingAgentEditDocumentIds.value);
  if (accepting) {
    next.add(documentId);
  } else {
    next.delete(documentId);
  }
  acceptingAgentEditDocumentIds.value = next;
}

function setAgentEditWorkspaceAccepting(workspaceId: string, accepting: boolean): void {
  const next = new Set(acceptingAgentEditWorkspaceIds.value);
  if (accepting) {
    next.add(workspaceId);
  } else {
    next.delete(workspaceId);
  }
  acceptingAgentEditWorkspaceIds.value = next;
}

function setDocumentSaving(documentId: string, saving: boolean): void {
  const next = new Set(savingDocumentIds.value);
  if (saving) {
    next.add(documentId);
  } else {
    next.delete(documentId);
  }
  savingDocumentIds.value = next;
}

function rememberWorkspaceMutationEvent(eventId: string): boolean {
  if (handledWorkspaceMutationEventIds.has(eventId)) return false;
  handledWorkspaceMutationEventIds.add(eventId);
  while (handledWorkspaceMutationEventIds.size > 2_000) {
    const oldest = handledWorkspaceMutationEventIds.values().next().value as
      | string
      | undefined;
    if (!oldest) break;
    handledWorkspaceMutationEventIds.delete(oldest);
  }
  return true;
}

function applySavedCatalogDocument(
  bookId: string,
  saved: CatalogDocument,
  projectRevision: number | undefined
): void {
  const snapshot = catalogSnapshot.value;
  if (!snapshot) return;
  const nextSnapshot = {
    ...snapshot,
    revision: snapshot.revision + 1,
    updatedAt: saved.updatedAt,
    books: snapshot.books.map((book) =>
      book.id !== bookId
        ? book
        : {
            ...book,
            updatedAt: saved.updatedAt,
            ...(projectRevision === undefined ? {} : { projectRevision }),
            documents: book.documents.map((document) =>
              document.id === saved.id ? saved : document
            ),
            draft: {
              ...book.draft,
              updatedAt: saved.updatedAt,
              sections: book.draft.sections.map((section) => {
                if (section.body.id === saved.id) {
                  return {
                    ...section,
                    title: saved.title,
                    body: saved,
                    characterState: {
                      ...section.characterState,
                      title: draftCharacterStateTitle(saved.title)
                    },
                    updatedAt: saved.updatedAt
                  };
                }
                if (section.characterState.id === saved.id) {
                  return {
                    ...section,
                    characterState: saved,
                    updatedAt: saved.updatedAt
                  };
                }
                return section;
              })
            }
          }
    )
  };
}

function applySavedLibraryEntry(
  domain: "material" | "skill",
  libraryId: string,
  saved: CatalogLibraryEntry,
  projectRevision: number | undefined
): void {
  const snapshot = catalogSnapshot.value;
  if (!snapshot) return;
  catalogSnapshot.value = {
    ...snapshot,
    revision: snapshot.revision + 1,
    updatedAt: saved.updatedAt,
    ...(domain === "material"
      ? {
          materials: snapshot.materials.map((library) =>
            library.id !== libraryId
              ? library
              : {
                  ...library,
                  updatedAt: saved.updatedAt,
                  ...(projectRevision === undefined ? {} : { projectRevision }),
                  entries: library.entries.map((entry) =>
                    entry.id === saved.id ? saved : entry
                  )
                }
          )
        }
      : {
          skills: snapshot.skills.map((library) =>
            library.id !== libraryId
              ? library
              : {
                  ...library,
                  updatedAt: saved.updatedAt,
                  ...(projectRevision === undefined ? {} : { projectRevision }),
                  entries: library.entries.map((entry) =>
                    entry.id === saved.id ? saved : entry
                  )
                }
          )
        })
  } as CatalogSnapshot;
}

function applyCreatedLibraryEntry(
  domain: "material" | "skill",
  libraryId: string,
  created: CatalogLibraryEntry,
  projectRevision: number | undefined
): void {
  const snapshot = catalogSnapshot.value;
  if (!snapshot) return;
  const nextSnapshot = {
    ...snapshot,
    revision: snapshot.revision + 1,
    updatedAt: created.updatedAt,
    ...(domain === "material"
      ? {
          materials: snapshot.materials.map((library) =>
            library.id !== libraryId
              ? library
              : {
                  ...library,
                  updatedAt: created.updatedAt,
                  ...(projectRevision === undefined ? {} : { projectRevision }),
                  entries: [...library.entries, created]
                }
          )
        }
      : {
          skills: snapshot.skills.map((library) =>
            library.id !== libraryId
              ? library
              : {
                  ...library,
                  updatedAt: created.updatedAt,
                  ...(projectRevision === undefined ? {} : { projectRevision }),
                  entries: [...library.entries, created]
                }
          )
        })
  } as CatalogSnapshot;
  catalogSnapshot.value = nextSnapshot;
  const createdDocument = projectCatalogWorkspace(
    nextSnapshot
  ).workspaceDocuments.find(
    (document) =>
      document.domain === domain &&
      document.libraryId === libraryId &&
      document.catalogEntryId === created.id
  );
  if (
    createdDocument &&
    !documents.value.some((document) => document.id === createdDocument.id)
  ) {
    documents.value = [...documents.value, createdDocument];
  }
}

function restoreDraftAfterSaveFailure(
  document: WorkspaceDocument,
  payload: { id: string; title: string; content: string }
): void {
  const currentDraft = editorDrafts.value[payload.id];
  const newerDraft =
    currentDraft &&
    (currentDraft.title !== payload.title || currentDraft.content !== payload.content)
      ? currentDraft
      : { title: payload.title, content: payload.content };
  editorDrafts.value = {
    ...editorDrafts.value,
    [payload.id]: {
      ...newerDraft,
      dirty: true,
      recoveryUpdatedAt: nextDraftRecoveryTimestamp(),
      baseRevision:
        currentDraft?.baseRevision ??
        createShortWorkspaceContentRevision(document.content),
      ...(currentDraft?.baseProjectRevision !== undefined
        ? { baseProjectRevision: currentDraft.baseProjectRevision }
        : document.catalogProjectRevision === undefined
          ? {}
          : { baseProjectRevision: document.catalogProjectRevision })
    }
  };
}

function isCatalogConflict(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("catalog.conflict:");
}

async function openSaveConflict(
  document: WorkspaceDocument,
  payload: { id: string; title: string; content: string }
): Promise<void> {
  if (!window.deepwrite) return;
  try {
    const latestSnapshot = await window.deepwrite.catalog.snapshot();
    const diskBook = document.workspaceId
      ? latestSnapshot.books.find((book) => book.id === document.workspaceId)
      : undefined;
    const diskDocument = document.workspaceId && document.catalogDocumentId
      ? diskBook?.documents.find(
          (candidate) => candidate.id === document.catalogDocumentId
        ) ??
        diskBook?.draft.sections
          .flatMap((section) => [section.body, section.characterState])
          .find((candidate) => candidate.id === document.catalogDocumentId)
      : document.libraryId && document.catalogEntryId && document.domain === "material"
        ? latestSnapshot.materials
            .find((library) => library.id === document.libraryId)
            ?.entries.find((entry) => entry.id === document.catalogEntryId)
        : document.libraryId && document.catalogEntryId && document.domain === "skill"
          ? latestSnapshot.skills
              .find((library) => library.id === document.libraryId)
              ?.entries.find((entry) => entry.id === document.catalogEntryId)
          : undefined;
    applyCatalogSnapshot(latestSnapshot);
    if (!diskDocument) {
      uiMessage.error("磁盘版本已不存在，当前草稿仍保留在恢复区");
      return;
    }
    const diskTitle = diskDocument.title;
    const diskContent = "content" in diskDocument ? diskDocument.content : diskDocument.body;
    if (diskTitle === payload.title && diskContent === payload.content) {
      const nextDrafts = { ...editorDrafts.value };
      const currentDraft = nextDrafts[payload.id];
      if (
        currentDraft &&
        (currentDraft.title !== payload.title ||
          currentDraft.content !== payload.content)
      ) {
        const latestProjectRevision = documents.value.find(
          (candidate) => candidate.id === payload.id
        )?.catalogProjectRevision;
        nextDrafts[payload.id] = {
          ...currentDraft,
          dirty: true,
          recoveryUpdatedAt: nextDraftRecoveryTimestamp(),
          baseRevision: createShortWorkspaceContentRevision(diskContent),
          ...(latestProjectRevision === undefined
            ? {}
            : { baseProjectRevision: latestProjectRevision })
        };
      } else {
        delete nextDrafts[payload.id];
      }
      editorDrafts.value = nextDrafts;
      uiMessage.info(
        currentDraft &&
          (currentDraft.title !== payload.title ||
            currentDraft.content !== payload.content)
          ? "磁盘已包含较早修改；你随后输入的新草稿仍保留"
          : "磁盘版本已经包含当前修改，无需重复保存"
      );
      return;
    }
    saveConflict.value = {
      documentId: payload.id,
      payload,
      latestSnapshot,
      diskTitle,
      diskContent
    };
  } catch (snapshotError: unknown) {
    uiMessage.error(
      snapshotError instanceof Error
        ? snapshotError.message
        : "读取磁盘冲突版本失败，当前草稿仍保留"
    );
  }
}

async function saveCatalogDocument(
  document: WorkspaceDocument,
  payload: { id: string; title: string; content: string },
  force = false
): Promise<boolean> {
  if (
    !window.deepwrite ||
    !document.workspaceId ||
    !document.catalogDocumentId ||
    savingDocumentIds.value.has(payload.id)
  ) {
    return false;
  }
  setDocumentSaving(payload.id, true);
  try {
    const projectRevision =
      force
        ? document.catalogProjectRevision
        : editorDrafts.value[payload.id]?.baseProjectRevision ??
          document.catalogProjectRevision;
    const saved = await window.deepwrite.catalog.saveDocument({
      bookId: document.workspaceId,
      documentId: document.catalogDocumentId,
      title: payload.title,
      content: payload.content,
      baseRevision:
        editorDrafts.value[payload.id]?.baseRevision ??
        createShortWorkspaceContentRevision(document.content),
      ...(projectRevision === undefined
        ? {}
        : { baseProjectRevision: projectRevision }),
      ...(force ? { force: true } : {})
    });
    const normalizedPayload = {
      id: payload.id,
      title: saved.title,
      content: saved.content
    };
    applySavedCatalogDocument(document.workspaceId, saved, undefined);
    applyDocumentLocally(
      normalizedPayload,
      undefined,
      payload
    );
    uiMessage.success("文稿已保存到本机");
    const expectedDocuments = captureWorkspaceDocumentBaselines(
      documents.value,
      document.workspaceId
    );
    await refreshBookAfterSuccessfulDocumentSave(
      document.workspaceId,
      expectedDocuments
    );
    return true;
  } catch (error: unknown) {
    restoreDraftAfterSaveFailure(document, payload);
    if (isCatalogConflict(error)) {
      await openSaveConflict(document, payload);
    } else {
      uiMessage.error(error instanceof Error ? error.message : "保存文稿失败。");
    }
    return false;
  } finally {
    setDocumentSaving(payload.id, false);
  }
}

async function saveCatalogLibraryEntry(
  document: WorkspaceDocument,
  payload: { id: string; title: string; content: string },
  force = false
): Promise<boolean> {
  if (
    !window.deepwrite ||
    !document.libraryId ||
    !document.catalogEntryId ||
    (document.domain !== "material" && document.domain !== "skill") ||
    savingDocumentIds.value.has(payload.id)
  ) {
    return false;
  }
  setDocumentSaving(payload.id, true);
  try {
    const projectRevision =
      force
        ? document.catalogProjectRevision
        : editorDrafts.value[payload.id]?.baseProjectRevision ??
          document.catalogProjectRevision;
    const saved = await window.deepwrite.catalog.saveLibraryEntry({
      domain: document.domain,
      libraryId: document.libraryId,
      entryId: document.catalogEntryId,
      title: payload.title,
      content: payload.content,
      baseRevision:
        editorDrafts.value[payload.id]?.baseRevision ??
        createShortWorkspaceContentRevision(document.content),
      ...(projectRevision === undefined
        ? {}
        : { baseProjectRevision: projectRevision }),
      ...(force ? { force: true } : {})
    });
    const savedProjectRevision =
      projectRevision === undefined ? undefined : projectRevision + 1;
    applySavedLibraryEntry(
      document.domain,
      document.libraryId,
      saved,
      savedProjectRevision
    );
    applyDocumentLocally(
      payload,
      savedProjectRevision
    );
    uiMessage.success(`${document.domain === "material" ? "素材" : "技能"}内容已保存到本机文件夹`);
    return true;
  } catch (error: unknown) {
    restoreDraftAfterSaveFailure(document, payload);
    if (isCatalogConflict(error)) {
      await openSaveConflict(document, payload);
    } else {
      uiMessage.error(error instanceof Error ? error.message : "保存资料库内容失败。");
    }
    return false;
  } finally {
    setDocumentSaving(payload.id, false);
  }
}

function applyDocument(rawPayload: { id: string; title: string; content: string }): void {
  const payload = rawPayload;
  const document = documents.value.find((candidate) => candidate.id === payload.id);
  if (!document) return;
  if (
    document.workspaceId &&
    acceptingAgentEditWorkspaceIds.value.has(document.workspaceId)
  ) {
    uiMessage.info("正在保存同一作品的智能体修改，请稍候");
    return;
  }
  if (document.catalogDocumentId && document.workspaceId) {
    void saveCatalogDocument(document, payload);
    return;
  }
  if (
    document.catalogEntryId &&
    document.libraryId &&
    (document.domain === "material" || document.domain === "skill")
  ) {
    void saveCatalogLibraryEntry(document, payload);
    return;
  }
  applyDocumentLocally(payload);
}

function keepSaveConflictDraft(): void {
  saveConflict.value = null;
}

function reloadSaveConflictFromDisk(): void {
  const conflict = saveConflict.value;
  if (!conflict) return;
  const nextDrafts = { ...editorDrafts.value };
  delete nextDrafts[conflict.documentId];
  editorDrafts.value = nextDrafts;
  applyCatalogSnapshot(conflict.latestSnapshot);
  saveConflict.value = null;
  uiMessage.success("已重新加载磁盘版本");
}

async function overwriteSaveConflictOnDisk(): Promise<void> {
  const conflict = saveConflict.value;
  if (!conflict || saveConflictSubmitting.value) return;
  saveConflictSubmitting.value = true;
  try {
    applyCatalogSnapshot(conflict.latestSnapshot);
    const document = documents.value.find(
      (candidate) => candidate.id === conflict.documentId
    );
    if (!document) {
      throw new Error("冲突文稿已不在当前项目中，草稿仍保留");
    }
    const saved =
      document.catalogDocumentId && document.workspaceId
        ? await saveCatalogDocument(document, conflict.payload, true)
        : document.catalogEntryId && document.libraryId &&
            (document.domain === "material" || document.domain === "skill")
          ? await saveCatalogLibraryEntry(document, conflict.payload, true)
          : false;
    if (saved) {
      saveConflict.value = null;
    }
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "覆盖磁盘版本失败");
  } finally {
    saveConflictSubmitting.value = false;
  }
}

function newConversation(): void {
  if (acceptingAgentEditDocumentIds.value.size > 0) {
    uiMessage.info("请等待智能体修改保存完成后再新建对话");
    return;
  }
  activeConversation.value.newConversation();
  clearEditorSelectionReferences();
}

function selectConversation(sessionId: string): void {
  if (acceptingAgentEditDocumentIds.value.size > 0) {
    uiMessage.info("请等待智能体修改保存完成后再切换对话");
    return;
  }
  if (!activeConversation.value.selectConversation(sessionId)) {
    uiMessage.warning(
      activeConversation.value.isBusy.value
        ? "请先停止当前回复，再切换历史对话"
        : "这条历史对话已不可用，请重新打开历史列表"
    );
    return;
  }
  clearEditorSelectionReferences();
}

function useSuggestion(value: string): void {
  activeConversation.value.useSuggestion(value);
}

async function sendMessage(promptAttachments: UserPromptAttachment[] = []): Promise<void> {
  const conversation = activeConversation.value;
  const sendSessionId = conversation.sessionId.value;
  const attachments = activeLibraryAttachments.value;
  const librarySkillAttachments = activeLibrarySkillAttachments.value;
  if (
    (activeAgentDocument.value.domain === "material" ||
      activeAgentDocument.value.domain === "skill") &&
    !activeLibraryAgentContext.value
  ) {
    uiMessage.warning("当前资料库上下文尚未就绪，请重新选择条目后再发送。");
    return;
  }
  if (attachments && !attachments.complete && attachments.diagnostics.length) {
    const first = attachments.diagnostics[0]!;
    uiMessage.warning(
      attachments.diagnostics.length === 1
        ? first.message
        : `${first.message}（另有 ${attachments.diagnostics.length - 1} 项资料库提示）`
    );
  }
  if (
    librarySkillAttachments &&
    !librarySkillAttachments.complete &&
    librarySkillAttachments.diagnostics.length
  ) {
    const first = librarySkillAttachments.diagnostics[0]!;
    uiMessage.warning(
      librarySkillAttachments.diagnostics.length === 1
        ? first.message
        : `${first.message}（另有 ${librarySkillAttachments.diagnostics.length - 1} 项可用技能提示）`
    );
  }
  await conversation.sendMessage(
    activeAgentDocument.value,
    liveWorkspaceDocuments.value,
    {
      ...(attachments
        ? {
          attachedSkills: attachments.attachedSkills,
          attachedMaterials: attachments.attachedMaterials
          }
        : librarySkillAttachments
          ? { attachedSkills: librarySkillAttachments.attachedSkills }
          : {}),
      ...(activeLibraryAgentContext.value
        ? { libraryWorkspace: activeLibraryAgentContext.value }
        : {})
    },
    promptAttachments
  );
  scheduleQueuedAutoAgentEdits(
    (queued) =>
      queued.conversation === conversation && queued.sessionId === sendSessionId
  );
}

async function stopGeneration(): Promise<void> {
  try {
    if (await activeConversation.value.stopGeneration()) {
      uiMessage.info("已停止生成");
    }
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "停止生成失败，请稍后重试。");
  }
}

function seedPrompt(value: string): void {
  composerDraft.value = value;
  dialogMode.value = null;
}

function openWorkspaceDialog(mode: DialogMode): void {
  if (mode === "imitation") {
    dialogMode.value = null;
    learningImitationOpen.value = true;
    if (!modelSettings.value && window.deepwrite) {
      void loadModelSettings();
    }
    return;
  }
  dialogMode.value = mode;
}

function openSettings(): void {
  currentView.value = "settings";
  if (window.deepwrite) {
    void loadWorkspaceAgentSettings();
    void loadLibraryAgentSettings();
    void loadLearningImitationSettings();
  }
}

async function loadWorkspaceDirectory(): Promise<void> {
  if (!window.deepwrite) return;
  try {
    const settings: WorkspaceDirectorySettings =
      await window.deepwrite.workspaceDirectory.list();
    workspaceDirectoryPath.value = settings.path;
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "加载工作目录失败。");
  }
}

async function chooseWorkspaceDirectory(): Promise<void> {
  if (!window.deepwrite || workspaceDirectoryLoading.value) return;
  workspaceDirectoryLoading.value = true;
  try {
    const settings = await window.deepwrite.workspaceDirectory.choose();
    if (!settings) return;
    workspaceDirectoryPath.value = settings.path;
    uiMessage.success("工作目录已切换；现有项目保持原位置不变");
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "切换工作目录失败。");
  } finally {
    workspaceDirectoryLoading.value = false;
  }
}

function closeSettings(): void {
  currentView.value = "workspace";
}

type WorkspaceEditorMutationEvent = Extract<
  SystemEventEnvelope,
  { type: "workspace.editor_mutation" }
>;
type LibraryEditorMutationEvent = Extract<
  SystemEventEnvelope,
  { type: "library.editor_mutation" }
>;

interface AgentEditReviewRequest {
  runId: string;
  proposalId: string;
  decision: "accept" | "reject";
}

function libraryMutationCountKey(proposal: AgentEditProposal): string {
  const target = proposal.libraryTarget!;
  return `${proposal.runId}\u0000${target.domain}\u0000${target.libraryId}`;
}

function currentLibraryProjectRevisionMatches(
  proposal: AgentEditProposal,
  currentRevision: number | undefined
): boolean {
  const baseRevision = proposal.libraryTarget?.baseProjectRevision;
  if (baseRevision === undefined || currentRevision === undefined) {
    return baseRevision === currentRevision;
  }
  const acceptedCount =
    acceptedLibraryMutationCounts.get(libraryMutationCountKey(proposal)) ?? 0;
  return currentRevision === baseRevision + acceptedCount;
}

function rememberAcceptedLibraryMutation(proposal: AgentEditProposal): void {
  const key = libraryMutationCountKey(proposal);
  acceptedLibraryMutationCounts.set(
    key,
    (acceptedLibraryMutationCounts.get(key) ?? 0) + 1
  );
  while (acceptedLibraryMutationCounts.size > 2_000) {
    const oldest = acceptedLibraryMutationCounts.keys().next().value as
      | string
      | undefined;
    if (!oldest) break;
    acceptedLibraryMutationCounts.delete(oldest);
  }
}

async function acceptLibraryCreationProposal(
  conversation: AgentConversationController,
  request: AgentEditReviewRequest,
  proposal: AgentEditProposal,
  automatic: boolean
): Promise<void> {
  const target = proposal.libraryTarget;
  if (
    !target ||
    target.operation !== "create" ||
    typeof proposal.proposedText !== "string"
  ) {
    const message = "待审阅的新条目缺少完整内容，请重新生成。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "error",
      statusMessage: message
    });
    uiMessage.error(message);
    return;
  }
  if (!window.deepwrite) {
    uiMessage.error("桌面文件服务当前不可用。");
    return;
  }
  const library = findCatalogLibrary(target.domain, target.libraryId);
  const readOnly =
    !library ||
    (target.domain === "skill" && "isBuiltin" in library && library.isBuiltin);
  if (readOnly) {
    const message = "目标资料库已不可用或只读，无法创建条目。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "conflict",
      statusMessage: message
    });
    uiMessage.warning(message);
    return;
  }
  if (
    !currentLibraryProjectRevisionMatches(proposal, library.projectRevision)
  ) {
    const message = "资料库目录已发生变化，未创建条目，请重新生成。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "conflict",
      statusMessage: message
    });
    uiMessage.warning(message);
    return;
  }
  if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
    uiMessage.info("同一资料库正在保存其他修改，请稍候再接受");
    return;
  }

  conversation.updateEditProposal(request.runId, request.proposalId, {
    status: "accepting",
    statusMessage: automatic
      ? "正在自动批准并创建资料库条目…"
      : "正在校验资料库版本并创建条目…"
  });
  setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
  try {
    const commonInput = {
      libraryId: target.libraryId,
      title: proposal.title,
      content: proposal.proposedText,
      ...(library.projectRevision === undefined
        ? {}
        : { baseProjectRevision: library.projectRevision })
    };
    const created =
      target.domain === "material"
        ? await window.deepwrite.catalog.createLibraryEntry({
            ...commonInput,
            domain: "material",
            stageId: MaterialStageIdSchema.parse(target.stageId)
          })
        : await window.deepwrite.catalog.createLibraryEntry({
            ...commonInput,
            domain: "skill",
            stageId: SkillStageIdSchema.parse(target.stageId)
          });
    const nextProjectRevision =
      library.projectRevision === undefined
        ? undefined
        : library.projectRevision + 1;
    applyCreatedLibraryEntry(
      target.domain,
      target.libraryId,
      created,
      nextProjectRevision
    );
    rememberAcceptedLibraryMutation(proposal);
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepted",
      proposedText: undefined,
      statusMessage: automatic
        ? "已自动批准并创建资料库条目。"
        : "已创建并保存到本地 Markdown。"
    });
    const createdDocument = documents.value.find(
      (document) =>
        document.domain === target.domain &&
        document.libraryId === target.libraryId &&
        document.catalogEntryId === created.id
    );
    if (createdDocument) {
      selectedResourceId.value = createdDocument.id;
      rightCollapsed.value = false;
    }
    uiMessage.success(
      automatic ? "已自动批准并创建资料库条目" : "已创建资料库条目"
    );
  } catch (error: unknown) {
    const message = isCatalogConflict(error)
      ? "资料库已在外部更新，未创建条目；请重新生成。"
      : error instanceof Error
        ? error.message
        : "创建资料库条目失败。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: isCatalogConflict(error) ? "conflict" : "error",
      statusMessage: message
    });
    if (isCatalogConflict(error)) {
      await loadCatalogSnapshot();
      uiMessage.warning(message);
    } else {
      uiMessage.error(message);
    }
  } finally {
    setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
  }
}

function stageAgentEditProposal(event: WorkspaceEditorMutationEvent): void {
  if (!rememberWorkspaceMutationEvent(event.id)) return;
  const sourceConversation = allConversations().find((conversation) =>
    conversation.acceptsRunEvent(event.payload.sessionId, event.payload.runId)
  );
  if (!sourceConversation) return;

  const mutationTarget = event.payload.mutationTarget;
  const expectedDraftFileKind =
    mutationTarget?.fileKind === "characterState"
      ? "character-state"
      : mutationTarget?.fileKind;
  const target = liveWorkspaceDocuments.value.find((document) =>
    mutationTarget
      ? document.id === mutationTarget.documentId &&
        document.workspaceId === event.payload.workspaceId &&
        document.stageId === "draft" &&
        document.expertSectionId === mutationTarget.sectionId &&
        document.draftFileKind === expectedDraftFileKind
      : document.workspaceId === event.payload.workspaceId &&
        document.stageId === event.payload.stageId &&
        document.draftFileKind === undefined
  );
  if (!target || target.readOnly) {
    const message = "目标文稿不可写，本次智能体变更未进入审阅。";
    sourceConversation.markToolConflict(
      event.payload.runId,
      event.payload.toolCallId,
      message
    );
    uiMessage.warning(message);
    return;
  }

  const proposalId = agentEditProposalId(
    event.payload.runId,
    event.payload.workspaceId,
    event.payload.stageId,
    target.id
  );
  const existing = sourceConversation.getEditProposal(
    event.payload.runId,
    proposalId
  );
  if (existing?.toolCallIds.includes(event.payload.toolCallId)) {
    return;
  }
  const currentRevision = createShortWorkspaceContentRevision(target.content);
  const expectedBaseRevision = expectedMutationBaseRevision(
    existing,
    target.content
  );
  if (
    event.payload.baseRevision !== expectedBaseRevision ||
    (existing !== undefined && currentRevision !== existing.baseRevision)
  ) {
    const message =
      "文稿版本已变化，本次智能体变更未进入审阅，也没有覆盖你的最新编辑。";
    if (existing) {
      sourceConversation.updateEditProposal(event.payload.runId, proposalId, {
        status: "conflict",
        statusMessage: message,
        updatedAt: event.timestamp
      });
    }
    sourceConversation.markToolConflict(
      event.payload.runId,
      event.payload.toolCallId,
      message
    );
    uiMessage.warning(message);
    return;
  }

  const resolvedMutation = resolveAgentEditorMutationText(
    event.payload.mutationTarget && existing?.proposedText !== undefined
      ? existing.proposedText
      : target.content,
    event.payload
  );
  if ("error" in resolvedMutation) {
    if (existing) {
      sourceConversation.updateEditProposal(event.payload.runId, proposalId, {
        status: "conflict",
        statusMessage: resolvedMutation.error,
        updatedAt: event.timestamp
      });
    }
    sourceConversation.markToolConflict(
      event.payload.runId,
      event.payload.toolCallId,
      resolvedMutation.error
    );
    uiMessage.warning(resolvedMutation.error);
    return;
  }
  const proposedText = resolvedMutation.text;
  const proposedRevision = createShortWorkspaceContentRevision(proposedText);

  const diff = buildAgentTextDiff(target.content, proposedText);
  const noChanges = proposedRevision === (existing?.baseRevision ?? currentRevision);
  const proposal: AgentEditProposal = {
    id: proposalId,
    runId: event.payload.runId,
    workspaceId: event.payload.workspaceId,
    stageId: event.payload.stageId,
    documentId: target.id,
    title: target.title,
    summary: event.payload.summary,
    status: noChanges ? "accepted" : "pending",
    baseRevision: existing?.baseRevision ?? event.payload.baseRevision,
    proposedRevision,
    ...(noChanges ? {} : { proposedText }),
    toolCallIds: [
      ...new Set([...(existing?.toolCallIds ?? []), event.payload.toolCallId])
    ],
    additions: diff.additions,
    deletions: diff.deletions,
    hunks: diff.hunks,
    ...(diff.truncated ? { truncated: true } : {}),
    ...(noChanges ? { statusMessage: "文本没有实际变化，无需保存。" } : {}),
    createdAt: existing?.createdAt ?? event.timestamp,
    updatedAt: event.timestamp
  };
  sourceConversation.upsertEditProposal(event.payload.runId, proposal);
  if (
    !noChanges &&
    sourceConversation.approvalModeForRun(
      event.payload.sessionId,
      event.payload.runId
    ) === "auto-approve"
  ) {
    const queueKey = `${event.payload.sessionId}\u0000${event.payload.runId}\u0000${proposalId}`;
    queuedAutoAgentEdits.set(queueKey, {
      conversation: sourceConversation,
      sessionId: event.payload.sessionId,
      runId: event.payload.runId,
      proposalId
    });
  }
}

function stageLibraryEditProposal(event: LibraryEditorMutationEvent): void {
  if (!rememberWorkspaceMutationEvent(event.id)) return;
  const sourceConversation = allConversations().find((conversation) =>
    conversation.acceptsRunEvent(event.payload.sessionId, event.payload.runId)
  );
  if (!sourceConversation) return;

  const library = findCatalogLibrary(
    event.payload.domain,
    event.payload.libraryId
  );
  const libraryReadOnly =
    !library ||
    (event.payload.domain === "skill" &&
      "isBuiltin" in library &&
      library.isBuiltin);
  let target: WorkspaceDocument | undefined;
  if (event.payload.operation === "edit") {
    const editPayload = event.payload;
    target = liveWorkspaceDocuments.value.find(
      (document) =>
        document.id === editPayload.documentId &&
        document.domain === editPayload.domain &&
        document.libraryId === editPayload.libraryId &&
        document.catalogEntryId === editPayload.entryId
    );
  }
  if (
    libraryReadOnly ||
    (event.payload.operation === "edit" && (!target || target.readOnly))
  ) {
    const message = "目标资料库或条目不可写，本次智能体变更未进入审阅。";
    sourceConversation.markToolConflict(
      event.payload.runId,
      event.payload.toolCallId,
      message
    );
    uiMessage.warning(message);
    return;
  }

  const scopeId = `library:${event.payload.domain}:${event.payload.libraryId}`;
  const documentId =
    event.payload.operation === "edit"
      ? event.payload.documentId
      : `library-create:${event.payload.toolCallId}`;
  const proposalId = agentEditProposalId(
    event.payload.runId,
    scopeId,
    "library",
    documentId
  );
  const existing = sourceConversation.getEditProposal(
    event.payload.runId,
    proposalId
  );
  if (existing?.toolCallIds.includes(event.payload.toolCallId)) return;

  const currentText = target?.content ?? "";
  const currentRevision = createShortWorkspaceContentRevision(currentText);
  const expectedBaseRevision = expectedMutationBaseRevision(
    existing,
    currentText
  );
  if (
    event.payload.baseRevision !== expectedBaseRevision ||
    (existing !== undefined && currentRevision !== existing.baseRevision)
  ) {
    const message =
      "资料库条目版本已变化，本次智能体变更未进入审阅，也没有覆盖你的最新编辑。";
    if (existing) {
      sourceConversation.updateEditProposal(event.payload.runId, proposalId, {
        status: "conflict",
        statusMessage: message,
        updatedAt: event.timestamp
      });
    }
    sourceConversation.markToolConflict(
      event.payload.runId,
      event.payload.toolCallId,
      message
    );
    uiMessage.warning(message);
    return;
  }

  const proposedText = event.payload.text;
  const proposedRevision = createShortWorkspaceContentRevision(proposedText);
  const diff = buildAgentTextDiff(currentText, proposedText);
  const noChanges =
    event.payload.operation === "edit" &&
    proposedRevision === (existing?.baseRevision ?? currentRevision) &&
    event.payload.title === target?.title;
  const proposal: AgentEditProposal = {
    id: proposalId,
    runId: event.payload.runId,
    workspaceId: scopeId,
    stageId: "library",
    documentId,
    title: event.payload.title,
    summary: event.payload.summary,
    status: noChanges ? "accepted" : "pending",
    baseRevision: existing?.baseRevision ?? event.payload.baseRevision,
    proposedRevision,
    ...(noChanges ? {} : { proposedText }),
    toolCallIds: [
      ...new Set([...(existing?.toolCallIds ?? []), event.payload.toolCallId])
    ],
    additions: diff.additions,
    deletions: diff.deletions,
    hunks: diff.hunks,
    ...(diff.truncated ? { truncated: true } : {}),
    ...(noChanges ? { statusMessage: "条目没有实际变化，无需保存。" } : {}),
    createdAt: existing?.createdAt ?? event.timestamp,
    updatedAt: event.timestamp,
    libraryTarget: {
      operation: event.payload.operation,
      domain: event.payload.domain,
      libraryId: event.payload.libraryId,
      stageId: event.payload.stageId,
      ...(event.payload.baseProjectRevision === undefined
        ? {}
        : { baseProjectRevision: event.payload.baseProjectRevision }),
      ...(event.payload.operation === "edit"
        ? { entryId: event.payload.entryId }
        : {})
    }
  };
  sourceConversation.upsertEditProposal(event.payload.runId, proposal);
  if (
    !noChanges &&
    sourceConversation.approvalModeForRun(
      event.payload.sessionId,
      event.payload.runId
    ) === "auto-approve"
  ) {
    const queueKey = `${event.payload.sessionId}\u0000${event.payload.runId}\u0000${proposalId}`;
    queuedAutoAgentEdits.set(queueKey, {
      conversation: sourceConversation,
      sessionId: event.payload.sessionId,
      runId: event.payload.runId,
      proposalId
    });
  }
}

async function applyAgentEdit(
  conversation: AgentConversationController,
  request: AgentEditReviewRequest,
  automatic = false
): Promise<void> {
  const proposal = conversation.getEditProposal(request.runId, request.proposalId);
  if (!proposal) {
    uiMessage.error("待审阅的智能体变更已不存在，请重新生成修改。");
    return;
  }
  if (conversation.isBusy.value) {
    uiMessage.info("请等待本轮智能体完成后再审阅文稿变更");
    return;
  }

  if (request.decision === "reject") {
    if (proposal.status === "accepting" || proposal.status === "accepted") return;
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "rejected",
      proposedText: undefined,
      statusMessage: "已拒绝，原文保持不变。"
    });
    uiMessage.info("已拒绝智能体修改，原文未改变");
    return;
  }

  if (
    proposal.status === "accepting" ||
    proposal.status === "accepted" ||
    proposal.status === "rejected" ||
    proposal.status === "conflict"
  ) {
    return;
  }

  if (proposal.libraryTarget?.operation === "create") {
    await acceptLibraryCreationProposal(
      conversation,
      request,
      proposal,
      automatic
    );
    return;
  }

  const target = liveWorkspaceDocuments.value.find(
    (document) => document.id === proposal.documentId
  );
  const persistedDocument = documents.value.find(
    (document) => document.id === proposal.documentId
  );
  if (!target || !persistedDocument || target.readOnly) {
    const message = "目标文稿已不可用，无法接受这项智能体修改。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "error",
      statusMessage: message
    });
    uiMessage.error(message);
    return;
  }

  if (proposal.libraryTarget) {
    const library = findCatalogLibrary(
      proposal.libraryTarget.domain,
      proposal.libraryTarget.libraryId
    );
    if (
      !library ||
      !currentLibraryProjectRevisionMatches(proposal, library.projectRevision)
    ) {
      const message =
        "资料库目录已在审阅期间发生变化，未接受智能体修改。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
  }

  if (
    acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId) ||
    documents.value.some(
      (document) =>
        (document.workspaceId === proposal.workspaceId ||
          (proposal.libraryTarget !== undefined &&
            document.domain === proposal.libraryTarget.domain &&
            document.libraryId === proposal.libraryTarget.libraryId)) &&
        savingDocumentIds.value.has(document.id)
    )
  ) {
    uiMessage.info("同一作品正在保存其他修改，请稍候再接受");
    return;
  }

  const currentDraft = editorDrafts.value[target.id];
  const persistedRevision = createShortWorkspaceContentRevision(
    persistedDocument.content
  );
  if (
    persistedRevision === proposal.proposedRevision &&
    (!proposal.libraryTarget || persistedDocument.title === proposal.title)
  ) {
    const draftRevision = currentDraft
      ? createShortWorkspaceContentRevision(currentDraft.content)
      : undefined;
    const staleRecoveryDraft = Boolean(
      currentDraft &&
        currentDraft.title === persistedDocument.title &&
        (draftRevision === proposal.baseRevision ||
          draftRevision === proposal.proposedRevision)
    );
    if (staleRecoveryDraft) {
      const nextDrafts = { ...editorDrafts.value };
      delete nextDrafts[target.id];
      editorDrafts.value = nextDrafts;
    }
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepted",
      proposedText: undefined,
      statusMessage:
        currentDraft && !staleRecoveryDraft
          ? "修改已在本地 Markdown 中；检测到另一份未保存草稿，已为你保留。"
          : "修改已经存在于本地 Markdown 中。"
    });
    uiMessage.success(
      automatic
        ? "已自动批准，智能体修改已经保存在本地文稿中"
        : "智能体修改已经保存在本地文稿中"
    );
    return;
  }

  const acceptance = classifyAgentEditAcceptance(proposal, target.content);
  if (acceptance === "missing-proposed-text") {
    const message = "待审阅变更缺少完整修改稿，请重新生成修改。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "error",
      statusMessage: message
    });
    uiMessage.error(message);
    return;
  }
  if (acceptance === "conflict") {
    const message =
      "文稿已在审阅期间发生变化，未接受智能体修改，也没有覆盖最新内容。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "conflict",
      statusMessage: message
    });
    uiMessage.warning(message);
    return;
  }

  const proposedText = proposal.proposedText!;
  const payload = {
    id: target.id,
    title: proposal.title,
    content: proposedText
  };
  conversation.updateEditProposal(request.runId, request.proposalId, {
    status: "accepting",
    statusMessage: automatic
      ? "正在自动批准、校验版本并保存到本地 Markdown…"
      : "正在校验版本并保存到本地 Markdown…"
  });
  setAgentEditDocumentAccepting(target.id, true);
  setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
  const draftAtAccept = currentDraft;

  try {
    let persisted = false;
    let newerDraftPreserved = false;
    if (persistedDocument.workspaceId && persistedDocument.catalogDocumentId) {
      if (!window.deepwrite) {
        throw new Error("桌面文件服务当前不可用。");
      }
      const projectRevision =
        currentDraft?.baseProjectRevision ?? persistedDocument.catalogProjectRevision;
      const saved = await window.deepwrite.catalog.saveDocument({
        bookId: persistedDocument.workspaceId,
        documentId: persistedDocument.catalogDocumentId,
        title: payload.title,
        content: payload.content,
        baseRevision:
          currentDraft?.baseRevision ??
          createShortWorkspaceContentRevision(persistedDocument.content),
        ...(projectRevision === undefined
          ? {}
          : { baseProjectRevision: projectRevision })
      });
      const normalizedPayload = {
        id: payload.id,
        title: saved.title,
        content: saved.content
      };
      applySavedCatalogDocument(persistedDocument.workspaceId, saved, undefined);
      applyAcceptedAgentDocumentLocally(
        normalizedPayload,
        undefined,
        draftAtAccept
      );
      const expectedDocuments = captureWorkspaceDocumentBaselines(
        documents.value,
        persistedDocument.workspaceId
      );
      await refreshBookAfterSuccessfulDocumentSave(
        persistedDocument.workspaceId,
        expectedDocuments
      );
      newerDraftPreserved = Boolean(editorDrafts.value[payload.id]);
      persisted = true;
    } else if (
      proposal.libraryTarget?.operation === "edit" &&
      persistedDocument.catalogEntryId &&
      persistedDocument.libraryId &&
      (persistedDocument.domain === "material" ||
        persistedDocument.domain === "skill")
    ) {
      if (!window.deepwrite) {
        throw new Error("桌面文件服务当前不可用。");
      }
      const library = findCatalogLibrary(
        persistedDocument.domain,
        persistedDocument.libraryId
      );
      if (!library) {
        throw new Error("目标资料库已不存在。");
      }
      const projectRevision = library.projectRevision;
      const saved = await window.deepwrite.catalog.saveLibraryEntry({
        domain: persistedDocument.domain,
        libraryId: persistedDocument.libraryId,
        entryId: persistedDocument.catalogEntryId,
        title: payload.title,
        content: payload.content,
        baseRevision:
          currentDraft?.baseRevision ??
          createShortWorkspaceContentRevision(persistedDocument.content),
        ...(projectRevision === undefined
          ? {}
          : { baseProjectRevision: projectRevision })
      });
      const savedProjectRevision =
        projectRevision === undefined ? undefined : projectRevision + 1;
      const normalizedPayload = {
        id: payload.id,
        title: saved.title,
        content: saved.body
      };
      applySavedLibraryEntry(
        persistedDocument.domain,
        persistedDocument.libraryId,
        saved,
        savedProjectRevision
      );
      applyAcceptedAgentDocumentLocally(
        normalizedPayload,
        savedProjectRevision,
        draftAtAccept
      );
      rememberAcceptedLibraryMutation(proposal);
      newerDraftPreserved = Boolean(editorDrafts.value[payload.id]);
      persisted = true;
    } else {
      applyAcceptedAgentDocumentLocally(payload, undefined, draftAtAccept);
      newerDraftPreserved = Boolean(editorDrafts.value[payload.id]);
    }

    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepted",
      proposedText: undefined,
      statusMessage: newerDraftPreserved
        ? `${automatic ? "已自动批准并" : "已"}保存审阅时的智能体修改；保存期间出现的更新草稿已保留。`
        : persisted
          ? `${automatic ? "已自动批准并" : "已接受并"}保存到本地 Markdown。`
          : `${automatic ? "已自动批准并写入" : "已接受到"}当前工作区；该预览资源没有对应的本地文件。`
    });
    uiMessage.success(
      automatic
        ? persisted
          ? "已自动批准并保存智能体修改"
          : "已自动批准并写入智能体修改"
        : persisted
          ? "已接受并保存智能体修改"
          : "已接受智能体修改"
    );
  } catch (error: unknown) {
    const conflict = isCatalogConflict(error);
    const message = conflict
      ? "本地 Markdown 已在其他位置更新，未保存智能体修改；请基于最新文稿重新生成。"
      : error instanceof Error
        ? error.message
        : "保存智能体修改失败，原文保持不变。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: conflict ? "conflict" : "error",
      statusMessage: message
    });
    if (conflict) {
      await loadCatalogSnapshot();
      uiMessage.warning(message);
    } else {
      uiMessage.error(message);
    }
  } finally {
    setAgentEditDocumentAccepting(target.id, false);
    setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
  }
}

async function reviewAgentEdit(request: AgentEditReviewRequest): Promise<void> {
  await applyAgentEdit(activeConversation.value, request);
}

function scheduleQueuedAutoAgentEdits(
  matches: (queued: QueuedAutoAgentEdit) => boolean
): void {
  autoAgentEditFlush = autoAgentEditFlush
    .then(async () => {
      const entries = [...queuedAutoAgentEdits.entries()].filter(([, queued]) =>
        matches(queued)
      );
      for (const [key, queued] of entries) {
        if (queued.conversation.isBusy.value) continue;
        queuedAutoAgentEdits.delete(key);
        await applyAgentEdit(
          queued.conversation,
          {
            runId: queued.runId,
            proposalId: queued.proposalId,
            decision: "accept"
          },
          true
        );
      }
    })
    .catch((error: unknown) => {
      uiMessage.error(
        error instanceof Error ? error.message : "自动批准智能体修改失败。"
      );
    });
}

function handleSystemEvent(event: SystemEventEnvelope): void {
  learningImitation.handleEvent(event);
  if (event.type === "workspace.editor_mutation") {
    stageAgentEditProposal(event);
  }
  if (event.type === "library.editor_mutation") {
    stageLibraryEditProposal(event);
  }
  if (event.type === "workspace.stage_selection") {
    const sourceConversation = allConversations().find((conversation) =>
      conversation.acceptsRunEvent(event.payload.sessionId, event.payload.runId)
    );
    const target = liveWorkspaceDocuments.value.find(
      (document) =>
        document.workspaceId === event.payload.workspaceId &&
        document.stageId === event.payload.stageId
    );
    if (sourceConversation && target) {
      selectedResourceId.value = target.id;
      activeCreationResourceId.value = target.id;
      rightCollapsed.value = false;
    }
  }
  for (const conversation of allConversations()) {
    conversation.handleEvent(event);
  }
  if (event.type === "agent.message_completed" || event.type === "agent.error") {
    scheduleQueuedAutoAgentEdits(
      (queued) =>
        queued.sessionId === event.payload.sessionId &&
        queued.runId === event.payload.runId
    );
  }
}

async function loadModelSettings(): Promise<void> {
  if (!window.deepwrite) {
    return;
  }
  modelLoading.value = true;
  modelError.value = null;
  try {
    const settings = await window.deepwrite.models.list();
    modelSettings.value = settings;
    learningImitation.setConfiguredModels(
      settings.models,
      settings.defaultModelId
    );
    applyModelSettingsToConversations(settings);
  } catch (error: unknown) {
    modelError.value = error instanceof Error ? error.message : "加载模型配置失败。";
  } finally {
    modelLoading.value = false;
  }
}

watch(dialogMode, (mode) => {
  if (mode === "models") {
    void loadModelSettings();
  }
});

async function saveModelSettings(settings: ModelSettingsInput): Promise<void> {
  if (!window.deepwrite || modelSaving.value) {
    return;
  }
  modelSaving.value = true;
  modelError.value = null;
  modelTestMessage.value = null;
  try {
    const saved = await window.deepwrite.models.save(settings);
    modelSettings.value = saved;
    learningImitation.setConfiguredModels(saved.models, saved.defaultModelId);
    applyModelSettingsToConversations(saved);
    modelTestMessage.value = "模型配置已保存，并已同步到后续对话。";
  } catch (error: unknown) {
    modelError.value = error instanceof Error ? error.message : "保存模型配置失败。";
  } finally {
    modelSaving.value = false;
  }
}

async function testModel(model: ModelConfigInput): Promise<void> {
  if (!window.deepwrite || testingModelId.value) {
    return;
  }
  testingModelId.value = model.id;
  modelError.value = null;
  modelTestMessage.value = null;
  try {
    const result = await window.deepwrite.models.test(model);
    modelTestMessage.value = result.message;
  } catch (error: unknown) {
    modelError.value = error instanceof Error ? error.message : "模型连接测试失败。";
  } finally {
    testingModelId.value = null;
  }
}

function showWorkspaceAgentFeedback(
  kind: "error" | "status",
  message: string
): void {
  if (workspaceAgentFeedbackTimer !== undefined) {
    window.clearTimeout(workspaceAgentFeedbackTimer);
  }
  workspaceAgentError.value = kind === "error" ? message : null;
  workspaceAgentStatus.value = kind === "status" ? message : null;
  workspaceAgentFeedbackTimer = window.setTimeout(() => {
    workspaceAgentError.value = null;
    workspaceAgentStatus.value = null;
    workspaceAgentFeedbackTimer = undefined;
  }, 3_600);
}

async function loadWorkspaceAgentSettings(): Promise<void> {
  if (!window.deepwrite || workspaceAgentLoading.value) return;
  workspaceAgentLoading.value = true;
  workspaceAgentError.value = null;
  try {
    workspaceAgentSettings.value = await window.deepwrite.workspaceAgents.list("short");
  } catch (error: unknown) {
    showWorkspaceAgentFeedback(
      "error",
      error instanceof Error ? error.message : "加载创作空间智能体设置失败。"
    );
  } finally {
    workspaceAgentLoading.value = false;
  }
}

async function saveWorkspaceAgentSettings(
  settings: ShortWorkspaceAgentSettingsInput
): Promise<void> {
  if (!window.deepwrite || workspaceAgentSaving.value) return;
  workspaceAgentSaving.value = true;
  try {
    workspaceAgentSettings.value = await window.deepwrite.workspaceAgents.save(settings);
    showWorkspaceAgentFeedback("status", "短篇智能体提示词、欢迎快捷与读取范围已保存，下一轮对话立即生效。");
  } catch (error: unknown) {
    showWorkspaceAgentFeedback(
      "error",
      error instanceof Error ? error.message : "保存创作空间智能体设置失败。"
    );
  } finally {
    workspaceAgentSaving.value = false;
  }
}

async function loadLibraryAgentSettings(): Promise<void> {
  if (!window.deepwrite || libraryAgentLoading.value) return;
  libraryAgentLoading.value = true;
  try {
    libraryAgentSettings.value = await window.deepwrite.libraryAgents.list();
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "加载资料库智能体设置失败。"
    );
  } finally {
    libraryAgentLoading.value = false;
  }
}

async function saveLibraryAgentSettings(
  settings: LibraryAgentSettingsInput
): Promise<void> {
  if (!window.deepwrite || libraryAgentSaving.value) return;
  libraryAgentSaving.value = true;
  try {
    libraryAgentSettings.value = await window.deepwrite.libraryAgents.save(
      settings
    );
    uiMessage.success("资料库智能体设置已保存，下一轮对话立即生效。");
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "保存资料库智能体设置失败。"
    );
  } finally {
    libraryAgentSaving.value = false;
  }
}

async function resetLibraryAgentSettings(
  domain: LibraryAgentDomain
): Promise<void> {
  if (!window.deepwrite || libraryAgentSaving.value) return;
  libraryAgentSaving.value = true;
  try {
    libraryAgentSettings.value = await window.deepwrite.libraryAgents.reset(
      domain
    );
    uiMessage.success(
      `${domain === "skill" ? "技能库" : "素材库"}智能体已恢复默认设置。`
    );
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "恢复资料库智能体默认设置失败。"
    );
  } finally {
    libraryAgentSaving.value = false;
  }
}

async function loadLearningImitationSettings(): Promise<void> {
  if (!window.deepwrite || learningImitationLoading.value) return;
  learningImitationLoading.value = true;
  try {
    learningImitationSettings.value =
      await window.deepwrite.learningImitationSettings.list();
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "加载学习仿写设置失败。"
    );
  } finally {
    learningImitationLoading.value = false;
  }
}

async function saveLearningImitationSettings(
  settings: LearningImitationSettingsInput
): Promise<void> {
  if (!window.deepwrite || learningImitationSaving.value) return;
  learningImitationSaving.value = true;
  try {
    learningImitationSettings.value =
      await window.deepwrite.learningImitationSettings.save(settings);
    uiMessage.success("学习仿写提示词已保存，下一次运行对应阶段时生效。");
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "保存学习仿写设置失败。"
    );
  } finally {
    learningImitationSaving.value = false;
  }
}

async function resetLearningImitationSettings(
  stageId: LearningImitationStageId
): Promise<void> {
  if (!window.deepwrite || learningImitationSaving.value) return;
  learningImitationSaving.value = true;
  try {
    learningImitationSettings.value =
      await window.deepwrite.learningImitationSettings.reset(stageId);
    uiMessage.success("当前阶段已恢复默认提示词。");
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "恢复学习仿写默认设置失败。"
    );
  } finally {
    learningImitationSaving.value = false;
  }
}

function synchronizeActiveAgentRunPreferences(): void {
  synchronizeAgentRunPreferences(
    agentRunScopeForDocument(activeAgentDocument.value),
    activeConversation.value
  );
}

function selectModel(modelId: string): void {
  activeConversation.value.selectModel(modelId);
  synchronizeActiveAgentRunPreferences();
}

function selectThinking(level: ThinkingLevel): void {
  activeConversation.value.selectThinkingLevel(level);
  synchronizeActiveAgentRunPreferences();
}

function selectTemperature(value: number): void {
  activeConversation.value.selectTemperature(value);
  synchronizeActiveAgentRunPreferences();
}

function selectApprovalMode(mode: AgentRunSettings["approvalMode"]): void {
  activeConversation.value.selectApprovalMode(mode);
  synchronizeActiveAgentRunPreferences();
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
    event.preventDefault();
    newConversation();
  }
  if (event.key === "Escape") {
    dialogMode.value = null;
    createShortBookDialogOpen.value = false;
    libraryProjectDialog.value = null;
    libraryGroupDialog.value = null;
    saveConflict.value = null;
    closeBookDialog();
    if (currentView.value === "settings") {
      closeSettings();
    }
  }
}

function currentDraftRecovery(): CatalogDraftRecovery {
  return Object.fromEntries(
    Object.entries(editorDrafts.value).flatMap(([id, draft]) =>
      draft.dirty
        ? [[id, { ...draft, dirty: true as const }]]
        : []
    )
  );
}

async function loadEditorDraftRecovery(): Promise<void> {
  const emergencyDrafts = loadEmergencyEditorDrafts();
  let coreDrafts: CatalogDraftRecovery = {};
  if (window.deepwrite) {
    try {
      coreDrafts = await window.deepwrite.catalog.loadDraftRecovery();
    } catch (error: unknown) {
      uiMessage.warning(
        error instanceof Error
          ? `草稿恢复文件读取失败：${error.message}`
          : "草稿恢复文件暂时无法读取"
      );
    }
  }
  const recoveredDrafts = mergeRecoveredEditorDrafts(
    coreDrafts,
    emergencyDrafts,
    {}
  );
  recoveredEditorDraftCount = Object.keys(recoveredDrafts).length;
  editorDrafts.value = mergeRecoveredEditorDrafts(
    coreDrafts,
    emergencyDrafts,
    currentDraftRecovery()
  );
}

function persistEmergencyDraftRecovery(): void {
  const dirtyDrafts = currentDraftRecovery();
  try {
    if (Object.keys(dirtyDrafts).length) {
      localStorage.setItem(EDITOR_DRAFT_RECOVERY_KEY, JSON.stringify(dirtyDrafts));
    } else {
      localStorage.removeItem(EDITOR_DRAFT_RECOVERY_KEY);
    }
  } catch {
    // The Core recovery file is the primary store; localStorage is only a
    // synchronous last-chance fallback during window teardown.
  }
}

async function flushEditorDraftRecovery(showWarning = true): Promise<void> {
  if (!window.deepwrite) {
    persistEmergencyDraftRecovery();
    return;
  }
  const draftsToSave = currentDraftRecovery();
  const savedFingerprint = JSON.stringify(draftsToSave);
  try {
    await window.deepwrite.catalog.saveDraftRecovery(draftsToSave);
    if (JSON.stringify(currentDraftRecovery()) === savedFingerprint) {
      localStorage.removeItem(EDITOR_DRAFT_RECOVERY_KEY);
    } else {
      persistEmergencyDraftRecovery();
    }
    draftPersistenceWarningShown = false;
  } catch {
    persistEmergencyDraftRecovery();
    if (showWarning && !draftPersistenceWarningShown) {
      draftPersistenceWarningShown = true;
      uiMessage.warning("未保存草稿暂时无法写入恢复文件，请先保存文稿再关闭应用");
    }
  }
}

function scheduleEditorDraftRecovery(): void {
  if (draftRecoveryTimer !== undefined) {
    window.clearTimeout(draftRecoveryTimer);
  }
  draftRecoveryTimer = window.setTimeout(() => {
    draftRecoveryTimer = undefined;
    void flushEditorDraftRecovery();
  }, 250);
}

function handleBeforeUnload(): void {
  persistEmergencyDraftRecovery();
  void flushEditorDraftRecovery(false);
}

function refreshCatalogOnWindowFocus(): void {
  if (window.deepwrite) {
    void loadCatalogSnapshot();
  }
}

watch([leftCollapsed, rightCollapsed, currentView], () => {
  void nextTick(reconcilePaneWidths);
});

watch(editorDrafts, () => {
  scheduleEditorDraftRecovery();
});

onMounted(async () => {
  window.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("resize", reconcilePaneWidths);
  window.addEventListener("focus", refreshCatalogOnWindowFocus);
  window.addEventListener("beforeunload", handleBeforeUnload);
  reconcilePaneWidths();
  await loadEditorDraftRecovery();
  if (!window.deepwrite) {
    if (recoveredEditorDraftCount > 0) {
      uiMessage.info(`已恢复 ${recoveredEditorDraftCount} 份未保存草稿`, {
        duration: 1500
      });
    }
    return;
  }

  removeSystemListener = window.deepwrite.events.subscribe(handleSystemEvent);
  await Promise.all([
    loadCatalogSnapshot(),
    loadModelSettings(),
    loadWorkspaceAgentSettings(),
    loadLearningImitationSettings(),
    loadWorkspaceDirectory()
  ]);
  if (recoveredEditorDraftCount > 0) {
    uiMessage.info(`已恢复 ${recoveredEditorDraftCount} 份未保存草稿`, {
      duration: 1500
    });
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleGlobalKeydown);
  window.removeEventListener("resize", reconcilePaneWidths);
  window.removeEventListener("focus", refreshCatalogOnWindowFocus);
  window.removeEventListener("beforeunload", handleBeforeUnload);
  stopPaneResize();
  removeSystemListener?.();
  if (draftRecoveryTimer !== undefined) {
    window.clearTimeout(draftRecoveryTimer);
    draftRecoveryTimer = undefined;
  }
  persistEmergencyDraftRecovery();
  void flushEditorDraftRecovery(false);
  if (workspaceAgentFeedbackTimer !== undefined) {
    window.clearTimeout(workspaceAgentFeedbackTimer);
  }
  for (const conversation of allConversations()) {
    conversation.dispose();
  }
  learningImitation.dispose();
});
</script>

<template>
  <NConfigProvider :theme="naiveTheme" :theme-overrides="themeOverrides">
      <SettingsPage
        v-if="currentView === 'settings'"
        :workspace-agent-settings="workspaceAgentSettings"
        :workspace-agent-loading="workspaceAgentLoading"
        :workspace-agent-saving="workspaceAgentSaving"
        :workspace-agent-error="workspaceAgentError"
        :workspace-agent-status="workspaceAgentStatus"
        :library-agent-settings="libraryAgentSettings"
        :library-agent-loading="libraryAgentLoading"
        :library-agent-saving="libraryAgentSaving"
        :learning-imitation-settings="learningImitationSettings"
        :learning-imitation-loading="learningImitationLoading"
        :learning-imitation-saving="learningImitationSaving"
        :runtime-available="hasDesktopRuntime"
        @back="closeSettings"
        @save-workspace-agents="saveWorkspaceAgentSettings"
        @save-library-agents="saveLibraryAgentSettings"
        @reset-library-agent="resetLibraryAgentSettings"
        @save-learning-imitation="saveLearningImitationSettings"
        @reset-learning-imitation="resetLearningImitationSettings"
      />

    <div
      v-else
      ref="desktopShell"
      class="desktop-shell"
      :class="shellClasses"
      :style="shellStyle"
      data-testid="desktop-shell"
    >
      <LeftSidebar
        v-if="!leftCollapsed"
        :sections="resourceTreeSections"
        :selected-id="selectedResourceId"
        :imitation-running="learningImitationRunning"
        @collapse="leftCollapsed = true"
        @new-conversation="newConversation"
        @open-dialog="openWorkspaceDialog"
        @open-settings="openSettings"
        @select-resource="selectResource"
        @book-action="openBookDialog"
        @export-book="openBookExportDialog"
        @resource-action="handleResourceAction"
        @resource-node-action="handleResourceNodeAction"
        @create-expert-section="addExpertSection"
        @remove-expert-section="requestRemoveExpertSection"
      />

      <AgentConversation
        v-model:draft="composerDraft"
        :messages="messages"
        :conversation-history="conversationHistory"
        :current-session-id="currentSessionId"
        :responding="responding"
        :can-send="canSend"
        :can-send-attachments="canSendAttachments"
        :can-stop="canStop"
        :runtime-available="hasDesktopRuntime"
        :models="configuredModels"
        :selected-model-id="selectedModelId"
        :thinking-level="thinkingLevel"
        :temperature="temperature"
        :approval-mode="approvalMode"
        :context-title="activeAgentDocument.title"
        :book-title="composerBookTitle"
        :stage-label="composerStageLabel"
        :agent-label="activeAgentLabel"
        :agent-id="activeAgentId"
        :library-domain="activeLibraryDomain"
        :library-skills="activeLibraryWelcomeSkills"
        :welcome-shortcuts="activeWelcomeShortcuts"
        :available-skills="availableSkillReferences"
        :available-materials="availableMaterialReferences"
        :editor-references="pendingEditorReferences"
        :left-collapsed="leftCollapsed"
        :right-collapsed="rightCollapsed"
        @new-conversation="newConversation"
        @select-conversation="selectConversation"
        @send="sendMessage"
        @stop="stopGeneration"
        @suggestion="useSuggestion"
        @toggle-left="leftCollapsed = !leftCollapsed"
        @toggle-right="rightCollapsed = !rightCollapsed"
        @select-model="selectModel"
        @select-thinking="selectThinking"
        @select-temperature="selectTemperature"
        @select-approval="selectApprovalMode"
        @review-edit="reviewAgentEdit"
        @clear-editor-references="clearEditorSelectionReferences"
        @remove-editor-reference="removeEditorSelectionReference"
        @locate-editor-reference="locateEditorSelectionReference"
      />

      <RightEditorPane
        v-if="!rightCollapsed"
        :document="activeDocument"
        :resource-id="selectedResourceId"
        :draft-state="activeEditorDraft"
        :locate-reference="editorReferenceNavigation"
        :locked="editorLocked"
        :locked-label="editorLockedLabel"
        :saving="editorSaving"
        :bound-to-current-book="activeLibraryBoundToBook"
        :section-tabs="activeExpertSectionTabs"
        :active-section-id="activeExpertSectionId"
        @collapse="rightCollapsed = true"
        @save="applyDocument"
        @live-change="handleLiveDocumentChange"
        @insert-selection="insertEditorSelectionReference"
        @select-section="selectExpertSection"
        @select-draft-file="selectDraftFile"
      />

      <div
        v-if="!leftCollapsed"
        class="pane-resizer pane-resizer-left"
        role="separator"
        aria-label="调整左侧栏宽度"
        aria-orientation="vertical"
        :aria-valuemin="LEFT_PANE_MIN"
        :aria-valuemax="LEFT_PANE_MAX"
        :aria-valuenow="leftPaneWidth"
        tabindex="0"
        @pointerdown="startPaneResize('left', $event)"
        @keydown="handleResizeKeydown('left', $event)"
      />

      <div
        v-if="!rightCollapsed"
        class="pane-resizer pane-resizer-right"
        role="separator"
        aria-label="调整右侧栏宽度"
        aria-orientation="vertical"
        :aria-valuemin="RIGHT_PANE_MIN"
        :aria-valuemax="RIGHT_PANE_MAX"
        :aria-valuenow="rightPaneWidth"
        tabindex="0"
        @pointerdown="startPaneResize('right', $event)"
        @keydown="handleResizeKeydown('right', $event)"
      />
    </div>

    <WorkspaceDialog
      :mode="dialogMode"
      :model-settings="modelSettings"
      :model-loading="modelLoading"
      :model-saving="modelSaving"
      :model-error="modelError"
      :model-test-message="modelTestMessage"
      :testing-model-id="testingModelId"
      :workspace-directory-path="workspaceDirectoryPath"
      :workspace-directory-loading="workspaceDirectoryLoading"
      @close="dialogMode = null"
      @seed-prompt="seedPrompt"
      @save-models="saveModelSettings"
      @test-model="testModel"
      @choose-workspace-directory="chooseWorkspaceDirectory"
    />
    <LearningImitationDialog
      :open="learningImitationOpen"
      :controller="learningImitation"
      :models="modelSettings?.models ?? []"
      :catalog-snapshot="catalogSnapshot"
      @close="learningImitationOpen = false"
      @refresh-catalog="loadCatalogSnapshot"
    />
    <BookResourceDialog
      :mode="bookDialogMode"
      :book="activeBook"
      :skill-libraries="skillLibraries"
      :material-libraries="materialLibraries"
      :material-groups="catalogSnapshot?.materialGroups ?? []"
      :skill-groups="catalogSnapshot?.skillGroups ?? []"
      :loading="catalogLoading"
      :submitting="catalogMutationPending"
      @close="closeBookDialog"
      @rename="renameBook"
      @remove="removeBook"
      @delete="deleteBook"
      @update-bindings="updateBookBindings"
    />
    <ExportShortManuscriptDialog
      :open="Boolean(exportBookTarget)"
      :book-title="exportBookTarget?.label ?? ''"
      :submitting="manuscriptExportPending"
      @close="closeBookExportDialog"
      @export="exportBookManuscript"
    />
    <LibraryRemovalDialog
      :open="Boolean(libraryRemovalDialog)"
      :action="libraryRemovalDialog?.action ?? 'remove'"
      :domain="libraryRemovalDialog?.payload.domain ?? 'material'"
      :label="libraryRemovalDialog?.payload.node.label ?? ''"
      :submitting="catalogMutationPending"
      @close="libraryRemovalDialog = null"
      @confirm="confirmLibraryRemoval"
    />
    <CreateShortBookDialog
      :open="createShortBookDialogOpen"
      :materials="catalogSnapshot?.materials ?? []"
      :material-groups="catalogSnapshot?.materialGroups ?? []"
      :skills="catalogSnapshot?.skills ?? []"
      :skill-groups="catalogSnapshot?.skillGroups ?? []"
      :loading="catalogLoading"
      :submitting="catalogMutationPending"
      @close="createShortBookDialogOpen = false"
      @submit="createShortBook"
    />
    <LibraryProjectDialog
      :open="Boolean(libraryProjectDialog)"
      :operation="libraryProjectDialog?.operation ?? null"
      :domain="libraryProjectDialog?.domain ?? 'material'"
      :library-id="libraryProjectDialog?.libraryId"
      :library-title="libraryProjectDialog?.libraryTitle"
      :material-kind="libraryProjectDialog?.materialKind"
      :entry-id="libraryProjectDialog?.entryId"
      :entry-title="libraryProjectDialog?.entryTitle"
      :submitting="catalogMutationPending"
      @close="libraryProjectDialog = null"
      @create-library="createCatalogLibrary"
      @create-entry="createCatalogLibraryEntry"
      @remove-entry="removeCatalogLibraryEntry"
    />
    <LibraryGroupDialog
      :open="Boolean(libraryGroupDialog)"
      :domain="libraryGroupDialog?.domain ?? 'material'"
      :group="activeLibraryGroup"
      :materials="catalogSnapshot?.materials ?? []"
      :material-groups="catalogSnapshot?.materialGroups ?? []"
      :skills="catalogSnapshot?.skills ?? []"
      :skill-groups="catalogSnapshot?.skillGroups ?? []"
      :submitting="catalogMutationPending"
      @close="libraryGroupDialog = null"
      @submit="saveCatalogLibraryGroup"
    />
    <SaveConflictDialog
      :open="Boolean(saveConflict)"
      :title="saveConflict?.payload.title ?? ''"
      :draft-content="saveConflict?.payload.content ?? ''"
      :disk-content="saveConflict?.diskContent ?? ''"
      :submitting="saveConflictSubmitting"
      @keep="keepSaveConflictDraft"
      @reload="reloadSaveConflictFromDisk"
      @overwrite="overwriteSaveConflictOnDisk"
    />
    <DeleteExpertSectionDialog
      :open="Boolean(pendingExpertSectionDeletion)"
      :section-title="pendingExpertSectionDeletion?.sectionTitle ?? ''"
      :has-content="pendingExpertSectionDeletion?.hasContent ?? false"
      @close="pendingExpertSectionDeletion = null"
      @confirm="confirmRemoveExpertSection"
    />
  </NConfigProvider>
</template>
