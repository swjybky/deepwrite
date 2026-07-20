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
  LinkedMaterialIdsByKind,
  LinkedSkillIdsByKind,
  MaterialKind,
  ModelConfigInput,
  ModelSettings,
  ModelSettingsInput,
  ShortBook,
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
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  MATERIAL_KINDS,
  SKILL_KINDS,
  appendExpertDraftSection,
  createShortWorkspaceContentRevision,
  findExpertDraftSection,
  parseExpertDraftMarkdown,
  removeExpertDraftSection,
  renderExpertDraftReview,
  resolveShortWorkspaceAgentIdForStage,
  serializeExpertDraftMarkdown,
  updateExpertDraftSection
} from "@deepwrite/contracts";
import AgentConversation from "./components/AgentConversation.vue";
import BookResourceDialog from "./components/BookResourceDialog.vue";
import CreateShortBookDialog from "./components/CreateShortBookDialog.vue";
import DeleteExpertSectionDialog from "./components/DeleteExpertSectionDialog.vue";
import LibraryProjectDialog from "./components/LibraryProjectDialog.vue";
import LibraryGroupDialog from "./components/LibraryGroupDialog.vue";
import LeftSidebar from "./components/LeftSidebar.vue";
import RightEditorPane from "./components/RightEditorPane.vue";
import SaveConflictDialog from "./components/SaveConflictDialog.vue";
import SettingsPage from "./components/SettingsPage.vue";
import WorkspaceDialog from "./components/WorkspaceDialog.vue";
import {
  useAgentConversation,
  type AgentConversationController
} from "./composables/useAgentConversation";
import { useAppearance } from "./composables/useAppearance";
import { uiMessage } from "./ui-feedback";
import { resourceSections } from "./data/demoWorkspace";
import {
  MATERIAL_KIND_LABELS,
  SKILL_KIND_LABELS,
  projectCatalogWorkspace
} from "./data/catalogWorkspace";
import type {
  AgentEditProposal,
  ComposerReferenceOption
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
import {
  agentEditProposalId,
  classifyAgentEditAcceptance,
  expectedMutationBaseRevision
} from "./utils/agentEditReview";
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
const acceptingAgentEditDocumentIds = ref<Set<string>>(new Set());
const acceptingAgentEditWorkspaceIds = ref<Set<string>>(new Set());
const savingDocumentIds = ref<Set<string>>(new Set());
let recoveredEditorDraftCount = 0;
const dialogMode = ref<DialogMode | null>(null);
const bookDialogMode = ref<BookResourceDialogMode | null>(null);
const activeBook = ref<ResourceTreeNode | null>(null);
const catalogSnapshot = ref<CatalogSnapshot | null>(null);
const catalogLoading = ref(false);
const catalogMutationPending = ref(false);
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
  documentId: string;
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
const workspaceDirectoryPath = ref<string | null>(null);
const workspaceDirectoryLoading = ref(false);
let workspaceAgentFeedbackTimer: number | undefined;
let draftRecoveryTimer: number | undefined;
let draftPersistenceWarningShown = false;
let conversationPersistenceWarningShown = false;
let removeSystemListener: (() => void) | undefined;
const conversations = new Map<string, AgentConversationController>();
const seenCatalogDiagnosticKeys = new Set<string>();
const handledWorkspaceMutationEventIds = new Set<string>();
interface QueuedAutoAgentEdit {
  conversation: AgentConversationController;
  sessionId: string;
  runId: string;
  proposalId: string;
}
const queuedAutoAgentEdits = new Map<string, QueuedAutoAgentEdit>();
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

function projectLiveExpertSectionNodes(
  nodes: readonly ResourceTreeNode[]
): ResourceTreeNode[] {
  return nodes.map((node) => {
    const children = projectLiveExpertSectionNodes(node.children ?? []);
    if (
      node.shortAgentId !== "expert_draft_coordinator" ||
      node.stageCategoryId !== "draft"
    ) {
      return node.children ? { ...node, children } : node;
    }
    const sourceId = node.targetDocumentId ?? node.id;
    const live = editorDrafts.value[sourceId];
    if (!live) return node.children ? { ...node, children } : node;
    const existingBySectionId = new Map(
      children.flatMap((child) =>
        child.expertSectionId ? [[child.expertSectionId, child] as const] : []
      )
    );
    const expertChildren = parseExpertDraftMarkdown(live.content).sections.map((section) => {
      const existing = existingBySectionId.get(section.id);
      return existing
        ? { ...existing, label: section.title }
        : {
            id: `local:expert-section:${encodeURIComponent(sourceId)}:${encodeURIComponent(section.id)}`,
            label: section.title,
            icon: "file" as const,
            catalogNodeType: "document" as const,
            stageCategoryId: "draft",
            targetDocumentId: sourceId,
            shortAgentId: "expert_section_writer" as const,
            expertSectionId: section.id
          };
    });
    return {
      ...node,
      children: [
        ...children.filter((child) => !child.expertSectionId),
        ...expertChildren
      ]
    };
  });
}

const resourceTreeSections = computed(() =>
  applyBookResourcePreferences(baseResourceSections.value, bookResourcePreferences.value).map(
    (section) => ({ ...section, nodes: projectLiveExpertSectionNodes(section.nodes) })
  )
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
    documents.value.find(
      (document) =>
        document.domain === "creation" &&
        document.workspaceId === previousWorkspaceId &&
        document.stageId === "draft"
    )?.id ??
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

function resourceTargetDocumentId(
  sections: readonly ResourceTreeSection[],
  resourceId: string
): string {
  const node = findResourceNodeIn(sections, resourceId);
  return node?.targetDocumentId ?? resourceId;
}

function applyCatalogSnapshot(snapshot: CatalogSnapshot): void {
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
  editorDrafts.value = Object.fromEntries(
    Object.entries(editorDrafts.value).filter(([documentId, draft]) => {
      if (!draft.dirty) return false;
      const persisted = projectedDocuments.get(documentId);
      return (
        !persisted ||
        persisted.title !== draft.title ||
        persisted.content !== draft.content
      );
    })
  );
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
      projection.workspaceDocuments.find(
        (document) => document.domain === "creation" && document.stageId === "draft"
      )?.id ??
      documents.value.find((document) => document.domain === "creation")?.id ??
      documents.value[0]?.id ??
      "";
  }
  const activeCreationTargetId = resourceTargetDocumentId(
    projection.resourceSections,
    activeCreationResourceId.value
  );
  if (!documents.value.some((document) => document.id === activeCreationTargetId)) {
    activeCreationResourceId.value =
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

function conversationForKey(key: string): AgentConversationController {
  const existing = conversations.get(key);
  if (existing) return existing;
  const created = useAgentConversation({
    api: () => window.deepwrite,
    persistenceKey: `deepwrite:agent-conversations:v1:${encodeURIComponent(key)}`,
    onPersistenceError: () => {
      if (conversationPersistenceWarningShown) return;
      conversationPersistenceWarningShown = true;
      uiMessage.warning("历史对话暂时无法保存到本机，本次运行中仍可继续切换");
    }
  });
  if (modelSettings.value) {
    created.applyModelSettings(modelSettings.value);
  }
  conversations.set(key, created);
  return created;
}

function allConversations(): AgentConversationController[] {
  return [...conversations.values()];
}

conversationForKey("general");

function resourceNode(resourceId: string): ResourceTreeNode | undefined {
  return findResourceNodeIn(resourceTreeSections.value, resourceId);
}

function documentForResourceId(resourceId: string): WorkspaceDocument | undefined {
  const targetId = resourceNode(resourceId)?.targetDocumentId ?? resourceId;
  return documents.value.find((document) => document.id === targetId);
}

function liveDocument(document: WorkspaceDocument): WorkspaceDocument {
  const live = editorDrafts.value[document.id];
  return live ? { ...document, title: live.title, content: live.content } : document;
}

function expertSectionIdForDocument(
  document: WorkspaceDocument,
  node?: ResourceTreeNode
): string | undefined {
  if (document.workspaceType !== "short" || document.stageId !== "draft") {
    return undefined;
  }
  const draft = parseExpertDraftMarkdown(liveDocument(document).content);
  const preferredId = selectedExpertSectionIds.value[document.id] ?? node?.expertSectionId;
  return preferredId && findExpertDraftSection(draft, preferredId)
    ? preferredId
    : draft.sections[0]?.id;
}

function promptDocumentForResourceId(resourceId: string): WorkspaceDocument | undefined {
  const node = resourceNode(resourceId);
  const document = documentForResourceId(resourceId);
  if (!document) return undefined;
  const resolved = liveDocument(document);
  if (!node?.shortAgentId) return resolved;
  if (
    node.expertSectionId &&
    document.stageId === "draft" &&
    !findExpertDraftSection(
      parseExpertDraftMarkdown(resolved.content),
      node.expertSectionId
    )
  ) {
    return resolved;
  }
  return {
    ...resolved,
    shortAgentId: node.shortAgentId,
    ...(node.expertSectionId
      ? {
          expertSectionId: node.expertSectionId,
          title: node.label,
          eyebrow: "短篇 · 小节编写",
          path: [...resolved.path, node.label]
        }
      : {})
  };
}

const activeDocument = computed<WorkspaceDocument>(() => {
  const source =
    documentForResourceId(selectedResourceId.value) ??
    documents.value[0]!;
  const node = resourceNode(selectedResourceId.value);
  const document = liveDocument(source);
  const sectionId = expertSectionIdForDocument(source, node);
  if (!sectionId) return document;
  const section = findExpertDraftSection(
    parseExpertDraftMarkdown(document.content),
    sectionId
  );
  if (!section) return document;
  return {
    ...document,
    title: section.title,
    eyebrow: "短篇 · 小节编写",
    path: [...document.path, section.title],
    content: section.body,
    shortAgentId: "expert_section_writer",
    expertSectionId: section.id
  };
});
const activeEditorDraft = computed<EditorDraftState | undefined>(() => {
  const draft = editorDrafts.value[activeDocument.value.id];
  const sectionId = activeDocument.value.expertSectionId;
  if (!draft) return undefined;
  if (!sectionId) return draft;
  const section = findExpertDraftSection(
    parseExpertDraftMarkdown(draft.content),
    sectionId
  );
  return section
    ? { ...draft, title: section.title, content: section.body }
    : draft;
});
const activeExpertSectionTabs = computed(() => {
  const source = documentForResourceId(selectedResourceId.value);
  if (source?.workspaceType !== "short" || source.stageId !== "draft") return [];
  return parseExpertDraftMarkdown(liveDocument(source).content).sections.map((section) => ({
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
const liveWorkspaceDocuments = computed<WorkspaceDocument[]>(() =>
  documents.value.map((document) => {
    const live = editorDrafts.value[document.id];
    return live ? { ...document, title: live.title, content: live.content } : document;
  })
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
function conversationKeyForDocument(
  document: WorkspaceDocument
): string {
  if (
    document.workspaceType !== "short" ||
    !document.workspaceId ||
    !document.stageId
  ) {
    return "general";
  }
  const agentId =
    document.shortAgentId ?? resolveShortWorkspaceAgentIdForStage(document.stageId);
  return `${document.workspaceId}:${agentId}${
    document.expertSectionId
      ? `:${encodeURIComponent(document.expertSectionId)}`
      : ""
  }`;
}

const activeConversationKey = computed(() =>
  conversationKeyForDocument(activePromptDocument.value)
);
const activeConversation = computed(
  () => conversationForKey(activeConversationKey.value)
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
  const selectedDocument = promptDocumentForResourceId(selectedResourceId.value);
  const key = conversationKeyForDocument(selectedDocument ?? activeDocument.value);
  return (
    acceptingAgentEditDocumentIds.value.has(activeDocument.value.id) ||
    (activeDocument.value.workspaceId !== undefined &&
      acceptingAgentEditWorkspaceIds.value.has(activeDocument.value.workspaceId)) ||
    (key !== "general" && conversationForKey(key).isBusy.value)
  );
});
const editorLockedLabel = computed(() =>
  acceptingAgentEditDocumentIds.value.has(activeDocument.value.id) ||
  (activeDocument.value.workspaceId !== undefined &&
    acceptingAgentEditWorkspaceIds.value.has(activeDocument.value.workspaceId))
    ? "正在接受并保存智能体修改"
    : undefined
);
const editorSaving = computed(() => savingDocumentIds.value.has(activeDocument.value.id));
const activeAgentId = computed<ShortWorkspaceAgentId | undefined>(() => {
  const document = activePromptDocument.value;
  return document.workspaceType === "short" && document.stageId
    ? document.shortAgentId ?? resolveShortWorkspaceAgentIdForStage(document.stageId)
    : undefined;
});
const activeAgentProfile = computed(() => {
  const agentId = activeAgentId.value;
  return agentId
    ? workspaceAgentSettings.value?.agents.find((agent) => agent.id === agentId)
    : undefined;
});
const activeAgentLabel = computed(() => activeAgentProfile.value?.label ?? "智能体对话");
const composerBookTitle = computed(
  () => activePromptDocument.value.workspaceTitle ?? "未选择书籍"
);
const composerStageLabel = computed(() => {
  const agentId = activeAgentId.value;
  return agentId ? COMPOSER_STAGE_LABELS[agentId] : "未选择阶段";
});
const activeLibraryAttachments = computed(() => {
  const workspaceId = activePromptDocument.value.workspaceId;
  return catalogSnapshot.value && workspaceId && catalogBook(workspaceId)
    ? buildLibraryAttachments(catalogSnapshot.value, workspaceId)
    : null;
});
const availableSkillReferences = computed<ComposerReferenceOption[]>(() => {
  const allowedKinds = new Set(activeAgentProfile.value?.readAccess.skill ?? []);
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
  const allowedKinds = new Set(activeAgentProfile.value?.readAccess.material ?? []);
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
  const document = documents.value.find(
    (candidate) => candidate.id === (node.targetDocumentId ?? node.id)
  );
  if (!document) {
    return;
  }
  selectedResourceId.value = node.id;
  if (document.domain === "creation") {
    activeCreationResourceId.value = node.id;
  }
  if (node.expertSectionId) {
    selectedExpertSectionIds.value = {
      ...selectedExpertSectionIds.value,
      [document.id]: node.expertSectionId
    };
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
  }
}

async function removeCatalogBook(book: ResourceTreeNode): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  catalogMutationPending.value = true;
  try {
    const result = await window.deepwrite.catalog.deleteBook(book.id);
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
    uiMessage.success(`已移除“${book.label}”`);
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "移除书籍失败。");
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
    const draftDocument = documents.value.find(
      (document) => document.workspaceId === book.id && document.stageId === "draft"
    );
    const firstDocument = documents.value.find((document) => document.workspaceId === book.id);
    const target = draftDocument ?? firstDocument;
    if (target) {
      selectedResourceId.value = target.id;
      activeCreationResourceId.value = target.id;
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
      const target =
        documents.value.find(
          (document) =>
            document.workspaceId === imported.id && document.stageId === "draft"
        ) ?? documents.value.find((document) => document.workspaceId === imported.id);
      if (target) {
        selectedResourceId.value = target.id;
        activeCreationResourceId.value = target.id;
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
      const target =
        opened.domain === "book"
          ? documents.value.find(
              (document) => document.workspaceId === opened.id && document.stageId === "draft"
            ) ?? documents.value.find((document) => document.workspaceId === opened.id)
          : documents.value.find((document) => document.libraryId === opened.id);
      if (target) {
        selectedResourceId.value = target.id;
        if (opened.domain === "book") {
          activeCreationResourceId.value = target.id;
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
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    uiMessage.success(`已从列表移除“${payload.node.label}”，本地文件夹仍完整保留`);
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "移除资料库失败。");
  } finally {
    catalogMutationPending.value = false;
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
    void unregisterCatalogLibrary(payload);
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

function sourcePayloadForSelectedSection(payload: {
  id: string;
  title: string;
  content: string;
}): { id: string; title: string; content: string } {
  const sectionId = activeDocument.value.expertSectionId;
  if (!sectionId) return payload;
  const sourceId = documentForResourceId(selectedResourceId.value)?.id;
  if (!sourceId) return payload;
  if (payload.id !== sourceId) return payload;
  const source = documents.value.find((document) => document.id === sourceId);
  if (!source || source.workspaceType !== "short" || source.stageId !== "draft") {
    return payload;
  }
  const currentContent = editorDrafts.value[sourceId]?.content ?? source.content;
  const currentDraft = parseExpertDraftMarkdown(currentContent);
  if (!findExpertDraftSection(currentDraft, sectionId)) return payload;
  return {
    id: source.id,
    title: editorDrafts.value[sourceId]?.title ?? source.title,
    content: serializeExpertDraftMarkdown(
      updateExpertDraftSection(currentDraft, sectionId, {
        title: payload.title,
        body: payload.content
      })
    )
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
  stageEditorDraft(sourcePayloadForSelectedSection(rawPayload));
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
  const source = documentForResourceId(selectedResourceId.value);
  if (source?.workspaceType !== "short" || source.stageId !== "draft") return;
  if (!findExpertDraftSection(parseExpertDraftMarkdown(liveDocument(source).content), sectionId)) {
    uiMessage.warning("该小节已不存在，章节列表已刷新");
    return;
  }
  selectedExpertSectionIds.value = {
    ...selectedExpertSectionIds.value,
    [source.id]: sectionId
  };
}

function addExpertSection(draftNode: ResourceTreeNode): void {
  const source = documentForResourceId(draftNode.id);
  if (source?.workspaceType !== "short" || source.stageId !== "draft") return;
  if (
    draftNode.shortAgentId !==
      "expert_draft_coordinator" ||
    expertDraftMutationBlocked(source) ||
    source.readOnly
  ) {
    uiMessage.info("当前正文暂时不能新建小节，请稍候");
    return;
  }
  const current = parseExpertDraftMarkdown(liveDocument(source).content);
  const next = appendExpertDraftSection(current);
  if (next === current) {
    uiMessage.warning("正文最多支持 100 个小节");
    return;
  }
  const added = next.sections.at(-1)!;
  stageEditorDraft({
    id: source.id,
    title: editorDrafts.value[source.id]?.title ?? source.title,
    content: serializeExpertDraftMarkdown(next)
  });
  selectedExpertSectionIds.value = {
    ...selectedExpertSectionIds.value,
    [source.id]: added.id
  };
  uiMessage.success(`已新建“${added.title}”，点击“应用”保存`);
}

function requestRemoveExpertSection(node: ResourceTreeNode): void {
  if (!node.expertSectionId) return;
  const source = documentForResourceId(node.id);
  if (source?.workspaceType !== "short" || source.stageId !== "draft") return;
  const draft = parseExpertDraftMarkdown(liveDocument(source).content);
  const section = findExpertDraftSection(draft, node.expertSectionId);
  if (!section) {
    uiMessage.warning("该小节已经不存在");
    return;
  }
  if (draft.sections.length <= 1) {
    uiMessage.warning("正文至少需要保留一个小节");
    return;
  }
  pendingExpertSectionDeletion.value = {
    documentId: source.id,
    sectionId: section.id,
    sectionTitle: section.title,
    hasContent: Boolean(
      section.body.trim() ||
      section.characterState.trim() ||
      section.wordCountRequirement.trim()
    )
  };
}

function confirmRemoveExpertSection(): void {
  const pending = pendingExpertSectionDeletion.value;
  if (!pending) return;
  const source = documents.value.find((document) => document.id === pending.documentId);
  if (!source) {
    pendingExpertSectionDeletion.value = null;
    uiMessage.warning("该正文已经不存在");
    return;
  }
  const conversationKey = source.workspaceId
    ? `${source.workspaceId}:expert_section_writer:${encodeURIComponent(pending.sectionId)}`
    : undefined;
  if (expertDraftMutationBlocked(source)) {
    uiMessage.info("当前小节正在处理或保存，请稍候再删除");
    return;
  }
  const current = parseExpertDraftMarkdown(liveDocument(source).content);
  const removedIndex = current.sections.findIndex(
    (section) => section.id === pending.sectionId
  );
  const next = removeExpertDraftSection(current, pending.sectionId);
  if (next === current) {
    pendingExpertSectionDeletion.value = null;
    uiMessage.warning("该小节无法删除，正文至少需要保留一个小节");
    return;
  }
  const fallbackSection = next.sections[Math.min(removedIndex, next.sections.length - 1)]!;
  stageEditorDraft({
    id: source.id,
    title: editorDrafts.value[source.id]?.title ?? source.title,
    content: serializeExpertDraftMarkdown(next)
  });
  selectedExpertSectionIds.value = {
    ...selectedExpertSectionIds.value,
    [source.id]: fallbackSection.id
  };
  if (conversationKey) {
    conversations.get(conversationKey)?.dispose();
    conversations.delete(conversationKey);
  }
  pendingExpertSectionDeletion.value = null;
  uiMessage.success(`已删除“${pending.sectionTitle}”，点击“应用”保存`);
}

function applyDocumentLocally(
  payload: { id: string; title: string; content: string },
  savedProjectRevision?: number
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
    return document.id === payload.id
      ? {
          ...withProjectRevision,
          title: payload.title,
          content: payload.content,
          path: withProjectRevision.path.length
            ? [
                ...withProjectRevision.path.slice(0, -1),
                payload.title
              ]
            : withProjectRevision.path
        }
      : withProjectRevision;
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
  if (
    currentDraft &&
    (currentDraft.title !== payload.title || currentDraft.content !== payload.content)
  ) {
    // The user continued typing while an asynchronous save was in flight.
    // Keep that newer draft and advance only its disk base to what just saved.
    nextDrafts[payload.id] = {
      ...currentDraft,
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
  catalogSnapshot.value = {
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
            )
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
    const diskDocument = document.workspaceId && document.catalogDocumentId
      ? latestSnapshot.books
          .find((book) => book.id === document.workspaceId)
          ?.documents.find((candidate) => candidate.id === document.catalogDocumentId)
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
    const savedProjectRevision =
      projectRevision === undefined ? undefined : projectRevision + 1;
    applySavedCatalogDocument(
      document.workspaceId,
      saved,
      savedProjectRevision
    );
    applyDocumentLocally(
      payload,
      savedProjectRevision
    );
    uiMessage.success("文稿已保存到本机");
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
  const payload = sourcePayloadForSelectedSection(rawPayload);
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
  }
}

function useSuggestion(value: string): void {
  activeConversation.value.useSuggestion(value);
}

async function sendMessage(promptAttachments: UserPromptAttachment[] = []): Promise<void> {
  const conversation = activeConversation.value;
  const sendSessionId = conversation.sessionId.value;
  const attachments = activeLibraryAttachments.value;
  if (attachments && !attachments.complete && attachments.diagnostics.length) {
    const first = attachments.diagnostics[0]!;
    uiMessage.warning(
      attachments.diagnostics.length === 1
        ? first.message
        : `${first.message}（另有 ${attachments.diagnostics.length - 1} 项资料库提示）`
    );
  }
  await conversation.sendMessage(
    activePromptDocument.value,
    liveWorkspaceDocuments.value,
    attachments
      ? {
          attachedSkills: attachments.attachedSkills,
          attachedMaterials: attachments.attachedMaterials
        }
      : {},
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

function openSettings(): void {
  currentView.value = "settings";
  if (window.deepwrite) {
    void loadWorkspaceAgentSettings();
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

interface AgentEditReviewRequest {
  runId: string;
  proposalId: string;
  decision: "accept" | "reject";
}

function stageAgentEditProposal(event: WorkspaceEditorMutationEvent): void {
  if (!rememberWorkspaceMutationEvent(event.id)) return;
  const sourceConversation = allConversations().find((conversation) =>
    conversation.acceptsRunEvent(event.payload.sessionId, event.payload.runId)
  );
  if (!sourceConversation) return;

  const target = liveWorkspaceDocuments.value.find(
    (document) =>
      document.workspaceId === event.payload.workspaceId &&
      document.stageId === event.payload.stageId
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
    event.payload.stageId
  );
  const existing = sourceConversation.getEditProposal(
    event.payload.runId,
    proposalId
  );
  const proposedRevision = createShortWorkspaceContentRevision(event.payload.text);
  if (
    existing?.toolCallIds.includes(event.payload.toolCallId) &&
    existing.proposedRevision === proposedRevision
  ) {
    return;
  }
  const currentRevision = createShortWorkspaceContentRevision(target.content);
  const expectedBaseRevision = expectedMutationBaseRevision(existing, target.content);
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

  const diff = buildAgentTextDiff(
    target.workspaceType === "short" && event.payload.stageId === "draft"
      ? renderExpertDraftReview(parseExpertDraftMarkdown(target.content))
      : target.content,
    target.workspaceType === "short" && event.payload.stageId === "draft"
      ? renderExpertDraftReview(parseExpertDraftMarkdown(event.payload.text))
      : event.payload.text
  );
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
    ...(noChanges ? {} : { proposedText: event.payload.text }),
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

  if (
    acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId) ||
    documents.value.some(
      (document) =>
        document.workspaceId === proposal.workspaceId &&
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
  if (persistedRevision === proposal.proposedRevision) {
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
    title: target.title,
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
      const savedProjectRevision =
        projectRevision === undefined ? undefined : projectRevision + 1;
      applySavedCatalogDocument(
        persistedDocument.workspaceId,
        saved,
        savedProjectRevision
      );
      applyAcceptedAgentDocumentLocally(
        payload,
        savedProjectRevision,
        draftAtAccept
      );
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
  if (event.type === "workspace.editor_mutation") {
    stageAgentEditProposal(event);
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
    for (const conversation of allConversations()) {
      conversation.applyModelSettings(settings);
    }
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
    for (const conversation of allConversations()) {
      conversation.applyModelSettings(saved);
    }
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
    showWorkspaceAgentFeedback("status", "短篇智能体提示词与读取范围已保存，下一轮对话立即生效。");
  } catch (error: unknown) {
    showWorkspaceAgentFeedback(
      "error",
      error instanceof Error ? error.message : "保存创作空间智能体设置失败。"
    );
  } finally {
    workspaceAgentSaving.value = false;
  }
}

function selectThinking(level: ThinkingLevel): void {
  activeConversation.value.selectThinkingLevel(level);
}

function selectTemperature(value: number): void {
  activeConversation.value.selectTemperature(value);
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
        :runtime-available="hasDesktopRuntime"
        @back="closeSettings"
        @save-workspace-agents="saveWorkspaceAgentSettings"
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
        @collapse="leftCollapsed = true"
        @new-conversation="newConversation"
        @open-dialog="dialogMode = $event"
        @open-settings="openSettings"
        @select-resource="selectResource"
        @book-action="openBookDialog"
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
        :context-title="activePromptDocument.title"
        :book-title="composerBookTitle"
        :stage-label="composerStageLabel"
        :agent-label="activeAgentLabel"
        :agent-id="activeAgentId"
        :available-skills="availableSkillReferences"
        :available-materials="availableMaterialReferences"
        :left-collapsed="leftCollapsed"
        :right-collapsed="rightCollapsed"
        @new-conversation="newConversation"
        @select-conversation="selectConversation"
        @send="sendMessage"
        @stop="stopGeneration"
        @suggestion="useSuggestion"
        @toggle-left="leftCollapsed = !leftCollapsed"
        @toggle-right="rightCollapsed = !rightCollapsed"
        @select-model="activeConversation.selectModel"
        @select-thinking="selectThinking"
        @select-temperature="selectTemperature"
        @select-approval="activeConversation.selectApprovalMode"
        @review-edit="reviewAgentEdit"
      />

      <RightEditorPane
        v-if="!rightCollapsed"
        :document="activeDocument"
        :draft-state="activeEditorDraft"
        :locked="editorLocked"
        :locked-label="editorLockedLabel"
        :saving="editorSaving"
        :bound-to-current-book="activeLibraryBoundToBook"
        :section-tabs="activeExpertSectionTabs"
        :active-section-id="activeExpertSectionId"
        @collapse="rightCollapsed = true"
        @save="applyDocument"
        @live-change="handleLiveDocumentChange"
        @select-section="selectExpertSection"
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
      @update-bindings="updateBookBindings"
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
