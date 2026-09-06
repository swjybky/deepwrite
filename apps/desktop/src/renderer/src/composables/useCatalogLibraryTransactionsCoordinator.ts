import {
  MaterialStageIdSchema,
  SkillStageIdSchema,
  createShortWorkspaceContentRevision,
  type CatalogIndexSnapshot,
  type CatalogLibrary,
  type CatalogLibraryGroup,
  type CreateLibraryEntryInput,
  type CreateLibraryGroupInput,
  type CreateLibraryInput,
  type DeepWriteApi,
  type MaterialLibraryKind,
  type MaterialStageId,
  type SkillStageId,
  type UpdateLibraryGroupInput
} from "@deepwrite/contracts";
import { computed, ref, type Ref, type ShallowRef } from "vue";
import type {
  CatalogLibraryEntryDragPayload,
  CatalogResourceNodeActionPayload,
  EditorDraftState,
  ResourceTreeNode,
  WorkspaceDocument
} from "../types/workspace";
import { useExternalLibraryImportCoordinator } from "./useExternalLibraryImportCoordinator";

export interface LibraryProjectDialogState {
  operation:
    | "create-library"
    | "create-entry"
    | "rename-library"
    | "rename-entry"
    | "remove-entry";
  domain: "material" | "skill";
  libraryId?: string;
  libraryTitle?: string;
  entryId?: string;
  entryTitle?: string;
  documentId?: string;
  materialKind?: MaterialLibraryKind;
  workspaceType?: "short" | "script" | "long";
}

export type CreateLibraryEntryDraft =
  | Omit<Extract<CreateLibraryEntryInput, { domain: "material" }>, "content">
  | Omit<Extract<CreateLibraryEntryInput, { domain: "skill" }>, "content">;

export interface LibraryGroupDialogState {
  domain: "material" | "skill";
  groupId?: string;
}

export interface LibraryRemovalDialogState {
  action: "remove" | "delete";
  payload: CatalogResourceNodeActionPayload;
}

export interface LibraryEntryClipboard {
  domain: "material" | "skill";
  title: string;
  content: string;
  stageId: MaterialStageId | SkillStageId;
  sourceLibraryId: string;
  sourceEntryId: string;
  workspaceType: "short" | "script" | "long";
}

export interface PendingLibraryEntryMove extends CatalogLibraryEntryDragPayload {
  entryTitle: string;
  targetLibraryTitle: string;
  targetMaterialKind: MaterialLibraryKind;
  initialStageId: MaterialStageId;
}

export const MATERIAL_KIND_ALLOWED_STAGES: Record<
  MaterialLibraryKind,
  readonly MaterialStageId[]
> = {
  character: ["character"],
  gimmick: ["gimmick"],
  plot: ["pacing", "intro", "plot_refine"],
  draft: ["draft_excerpt"],
  other: ["other"],
  mixed: [
    "gimmick",
    "character",
    "pacing",
    "intro",
    "plot_refine",
    "draft_excerpt",
    "other"
  ]
};

export interface CatalogLibraryTransactionNotifications {
  error(message: string): void;
  success(message: string): void;
  warning(message: string): void;
}

export interface CatalogLibraryTransactionsContext {
  api(): DeepWriteApi["catalog"] | undefined;
  snapshot: Readonly<Ref<CatalogIndexSnapshot | null>>;
  documents: ShallowRef<WorkspaceDocument[]>;
  drafts: ShallowRef<Record<string, EditorDraftState>>;
  mutationPending: Ref<boolean>;
  findLibrary(
    domain: "material" | "skill",
    libraryId: string
  ): CatalogLibrary | undefined;
  ensureDocumentLoaded(document: WorkspaceDocument): Promise<WorkspaceDocument>;
  refreshCatalog(): Promise<boolean>;
  refreshWorkspaceDirectory(): Promise<void>;
  advanceDraftProjectRevision(
    domain: "material" | "skill",
    libraryId: string,
    expectedProjectRevision: number | undefined
  ): void;
  isConflict(error: unknown): boolean;
  prepareProjectsForDuplicate(
    libraryIds: ReadonlySet<string>
  ): Promise<boolean>;
  selectDocument(documentId: string, revealEditor: boolean): void;
  navigateToDocumentResource(documentId: string): Promise<void>;
  collectResourceNodeIds(node: ResourceTreeNode): string[];
  disposeLibraryConversation(
    domain: "material" | "skill",
    libraryId: string
  ): void;
  notifications: CatalogLibraryTransactionNotifications;
}

/**
 * Owns catalog-library CRUD and its modal transactions. Catalog loading,
 * durable document saves, resource navigation, and conversation lifetime stay
 * outside this boundary behind explicit ports.
 */
export function useCatalogLibraryTransactionsCoordinator(
  context: CatalogLibraryTransactionsContext
) {
  const {
    snapshot,
    documents,
    drafts: editorDrafts,
    mutationPending: catalogMutationPending,
    notifications: uiMessage
  } = context;

  const libraryProjectDialog = ref<LibraryProjectDialogState | null>(null);
  const externalLibraryImport = useExternalLibraryImportCoordinator(context);
  const libraryGroupDialog = ref<LibraryGroupDialogState | null>(null);
  const libraryRemovalDialog = ref<LibraryRemovalDialogState | null>(null);
  const libraryEntryClipboard = ref<LibraryEntryClipboard | null>(null);
  const pendingLibraryEntryMove = ref<PendingLibraryEntryMove | null>(null);
  const libraryEntryClipboardDomain = computed(
    () => libraryEntryClipboard.value?.domain
  );
  const activeLibraryGroup = computed<CatalogLibraryGroup | null>(() => {
    const state = libraryGroupDialog.value;
    if (!state?.groupId) return null;
    const groups =
      state.domain === "material"
        ? snapshot.value?.materialGroups
        : snapshot.value?.skillGroups;
    return groups?.find((group) => group.id === state.groupId) ?? null;
  });

  async function createCatalogLibrary(
    payload: CreateLibraryInput
  ): Promise<void> {
    const api = context.api();
    if (!api || catalogMutationPending.value) return;
    catalogMutationPending.value = true;
    try {
      const created = await api.createLibrary(payload);
      if (!created) return;
      await context.refreshWorkspaceDirectory();
      await context.refreshCatalog();
      libraryProjectDialog.value = null;
      const target = documents.value.find(
        (document) => document.libraryId === created.id
      );
      if (target) context.selectDocument(target.id, true);
      uiMessage.success(
        `已创建${payload.domain === "material" ? "素材" : "技能"}库“${created.title}”`
      );
    } catch (error: unknown) {
      uiMessage.error(
        error instanceof Error ? error.message : "创建资料库失败。"
      );
    } finally {
      catalogMutationPending.value = false;
    }
  }

  async function createCatalogLibraryGroup(
    payload: CreateLibraryGroupInput
  ): Promise<void> {
    const api = context.api();
    if (!api || catalogMutationPending.value) return;
    catalogMutationPending.value = true;
    try {
      const created = await api.createLibraryGroup(payload);
      if (!created) return;
      await context.refreshWorkspaceDirectory();
      await context.refreshCatalog();
      libraryGroupDialog.value = null;
      uiMessage.success(
        `已创建${payload.domain === "material" ? "素材" : "技能"}分组“${created.title}”`
      );
    } catch (error: unknown) {
      await context.refreshCatalog();
      uiMessage.error(
        error instanceof Error ? error.message : "创建资料库分组失败。"
      );
    } finally {
      catalogMutationPending.value = false;
    }
  }

  async function updateCatalogLibraryGroup(
    payload: UpdateLibraryGroupInput
  ): Promise<void> {
    const api = context.api();
    if (!api || catalogMutationPending.value) return;
    catalogMutationPending.value = true;
    try {
      const updated = await api.updateLibraryGroup(payload);
      await context.refreshWorkspaceDirectory();
      await context.refreshCatalog();
      libraryGroupDialog.value = null;
      uiMessage.success(`已保存分组“${updated.title}”`);
    } catch (error: unknown) {
      if (context.isConflict(error)) {
        await context.refreshCatalog();
        libraryGroupDialog.value = null;
        uiMessage.warning("分组配置已在外部更新，已重新加载；请确认后再次编辑");
      } else {
        await context.refreshCatalog();
        uiMessage.error(
          error instanceof Error ? error.message : "更新分组绑定失败。"
        );
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
    const api = context.api();
    if (!api || catalogMutationPending.value) return;
    catalogMutationPending.value = true;
    try {
      const baseProjectRevision = context.findLibrary(
        payload.domain,
        payload.libraryId
      )?.projectRevision;
      const created = await api.createLibraryEntry({
        ...payload,
        content: "",
        ...(baseProjectRevision === undefined ? {} : { baseProjectRevision })
      });
      await context.refreshCatalog();
      context.advanceDraftProjectRevision(
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
      if (target) context.selectDocument(target.id, true);
      uiMessage.success(
        `已创建${payload.domain === "material" ? "素材" : "技能"}条目“${created.title}”`
      );
    } catch (error: unknown) {
      if (context.isConflict(error)) {
        await context.refreshCatalog();
        libraryProjectDialog.value = null;
        uiMessage.warning(
          "资料库已在外部更新，已重新加载；请从新目录状态重新创建条目"
        );
      } else {
        uiMessage.error(
          error instanceof Error ? error.message : "创建资料库条目失败。"
        );
      }
    } finally {
      catalogMutationPending.value = false;
    }
  }

  async function renameCatalogLibrary(payload: {
    domain: "material" | "skill";
    libraryId: string;
    title: string;
  }): Promise<void> {
    const api = context.api();
    if (!api || catalogMutationPending.value) return;
    const library = context.findLibrary(payload.domain, payload.libraryId);
    if (!library) {
      uiMessage.error("未找到要修改的资料库");
      return;
    }
    catalogMutationPending.value = true;
    try {
      await api.updateLibrary({
        ...payload,
        baseProjectRevision: library.projectRevision
      });
      await context.refreshCatalog();
      libraryProjectDialog.value = null;
      uiMessage.success("资料库名称已更新");
    } catch (error: unknown) {
      await context.refreshCatalog();
      uiMessage.error(
        error instanceof Error ? error.message : "修改资料库名称失败。"
      );
    } finally {
      catalogMutationPending.value = false;
    }
  }

  async function renameCatalogLibraryEntry(payload: {
    domain: "material" | "skill";
    libraryId: string;
    entryId: string;
    title: string;
  }): Promise<void> {
    const api = context.api();
    if (!api || catalogMutationPending.value) return;
    let document = documents.value.find(
      (item) =>
        item.libraryId === payload.libraryId &&
        item.catalogEntryId === payload.entryId
    );
    const library = context.findLibrary(payload.domain, payload.libraryId);
    if (!document || !library) {
      uiMessage.error("未找到要修改的条目");
      return;
    }
    document = await context.ensureDocumentLoaded(document);
    if (document.catalogContentLoaded === false) return;
    const draft = editorDrafts.value[document.id];
    catalogMutationPending.value = true;
    try {
      await api.saveLibraryEntry({
        ...payload,
        content: draft?.dirty ? draft.content : document.content,
        baseRevision:
          draft?.baseRevision ??
          createShortWorkspaceContentRevision(document.content),
        baseProjectRevision:
          draft?.baseProjectRevision ?? library.projectRevision
      });
      await context.refreshCatalog();
      libraryProjectDialog.value = null;
      uiMessage.success("条目名称已更新");
    } catch (error: unknown) {
      await context.refreshCatalog();
      uiMessage.error(
        error instanceof Error ? error.message : "修改条目名称失败。"
      );
    } finally {
      catalogMutationPending.value = false;
    }
  }

  async function moveCatalogLibraryEntry(
    payload: CatalogLibraryEntryDragPayload
  ): Promise<void> {
    const api = context.api();
    if (!api || catalogMutationPending.value) return;
    const source = context.findLibrary(payload.domain, payload.sourceLibraryId);
    const target = context.findLibrary(payload.domain, payload.targetLibraryId);
    if (!source || !target) {
      uiMessage.error("拖拽目标资料库已不存在，请刷新后重试");
      return;
    }
    catalogMutationPending.value = true;
    try {
      await api.moveLibraryEntry({
        ...payload,
        sourceBaseProjectRevision: source.projectRevision,
        targetBaseProjectRevision: target.projectRevision
      });
      await context.refreshCatalog();
      const targetDocument = documents.value.find(
        (document) =>
          document.domain === payload.domain &&
          document.libraryId === payload.targetLibraryId &&
          document.catalogEntryId === payload.entryId
      );
      if (targetDocument) context.selectDocument(targetDocument.id, false);
      uiMessage.success(
        payload.sourceLibraryId === payload.targetLibraryId
          ? "条目顺序已更新"
          : "条目已移动到目标资料库"
      );
    } catch (error: unknown) {
      await context.refreshCatalog();
      uiMessage.error(
        error instanceof Error ? error.message : "移动资料库条目失败。"
      );
    } finally {
      catalogMutationPending.value = false;
    }
  }

  function requestCatalogLibraryEntryMove(
    payload: CatalogLibraryEntryDragPayload
  ): void {
    const source = context.findLibrary(payload.domain, payload.sourceLibraryId);
    const target = context.findLibrary(payload.domain, payload.targetLibraryId);
    if (!source || !target) {
      uiMessage.error("拖拽目标资料库已不存在，请刷新后重试");
      return;
    }
    if (
      payload.domain !== "material" ||
      payload.sourceLibraryId === payload.targetLibraryId
    ) {
      void moveCatalogLibraryEntry(payload);
      return;
    }
    if (!("materialKind" in source) || !("materialKind" in target)) return;
    const entry = source.entries.find(({ id }) => id === payload.entryId);
    if (!entry) {
      uiMessage.error("要移动的素材条目已不存在，请刷新后重试");
      return;
    }
    if (source.materialKind === target.materialKind) {
      void moveCatalogLibraryEntry(payload);
      return;
    }
    pendingLibraryEntryMove.value = {
      ...payload,
      entryTitle: entry.title,
      targetLibraryTitle: target.title,
      targetMaterialKind: target.materialKind,
      initialStageId: entry.stageId
    };
  }

  function confirmCatalogLibraryEntryMove(
    targetStageId: MaterialStageId
  ): void {
    const pending = pendingLibraryEntryMove.value;
    if (!pending) return;
    pendingLibraryEntryMove.value = null;
    void moveCatalogLibraryEntry({ ...pending, targetStageId });
  }

  async function removeCatalogLibraryEntry(payload: {
    domain: "material" | "skill";
    libraryId: string;
    entryId: string;
  }): Promise<void> {
    const api = context.api();
    if (!api || catalogMutationPending.value) return;
    catalogMutationPending.value = true;
    const dialogState = libraryProjectDialog.value;
    try {
      const library = context.findLibrary(payload.domain, payload.libraryId);
      const baseProjectRevision = library?.projectRevision;
      let persistedDocument = documents.value.find(
        (document) =>
          document.libraryId === payload.libraryId &&
          document.catalogEntryId === payload.entryId
      );
      if (persistedDocument) {
        persistedDocument =
          await context.ensureDocumentLoaded(persistedDocument);
        if (persistedDocument.catalogContentLoaded === false) return;
      }
      const result = await api.removeLibraryEntry({
        ...payload,
        ...(persistedDocument === undefined
          ? {}
          : {
              baseRevision: createShortWorkspaceContentRevision(
                persistedDocument.content
              )
            }),
        ...(baseProjectRevision === undefined ? {} : { baseProjectRevision })
      });
      if (!result.deleted) {
        await context.refreshCatalog();
        libraryProjectDialog.value = null;
        uiMessage.warning("条目已经不存在，目录已重新加载");
        return;
      }
      if (dialogState?.documentId) {
        const nextDrafts = { ...editorDrafts.value };
        delete nextDrafts[dialogState.documentId];
        editorDrafts.value = nextDrafts;
      }
      await context.refreshCatalog();
      context.advanceDraftProjectRevision(
        payload.domain,
        payload.libraryId,
        baseProjectRevision === undefined ? undefined : baseProjectRevision + 1
      );
      libraryProjectDialog.value = null;
      uiMessage.success(
        `已删除${payload.domain === "material" ? "素材" : "技能"}条目文件`
      );
    } catch (error: unknown) {
      if (context.isConflict(error)) {
        await context.refreshCatalog();
        libraryProjectDialog.value = null;
        uiMessage.warning("资料库已在外部更新，已重新加载；请确认后再次删除");
      } else {
        uiMessage.error(
          error instanceof Error ? error.message : "删除资料库条目失败。"
        );
      }
    } finally {
      catalogMutationPending.value = false;
    }
  }

  function resolveLibraryEntryClipboardPayload(
    domain: "material" | "skill",
    libraryId: string,
    entryId: string,
    fallbackTitle: string
  ): LibraryEntryClipboard | null {
    const library = context.findLibrary(domain, libraryId);
    if (!library) return null;
    const entry = library.entries.find((item) => item.id === entryId);
    const document = documents.value.find(
      (item) => item.libraryId === libraryId && item.catalogEntryId === entryId
    );
    const draft = document ? editorDrafts.value[document.id] : undefined;
    const title = (
      draft?.dirty
        ? draft.title
        : (document?.title ?? entry?.title ?? fallbackTitle)
    ).trim();
    if (!title) return null;
    const content = draft?.dirty
      ? draft.content
      : (document?.content ?? entry?.body ?? "");
    const stageIdRaw =
      entry?.stageId ??
      document?.stageCategoryId ??
      (domain === "material" ? "other" : "draft");
    const materialStage = MaterialStageIdSchema.safeParse(stageIdRaw);
    const skillStage = SkillStageIdSchema.safeParse(stageIdRaw);
    const stageId =
      domain === "material"
        ? materialStage.success
          ? materialStage.data
          : ("other" as MaterialStageId)
        : skillStage.success
          ? skillStage.data
          : ("draft" as SkillStageId);
    return {
      domain,
      title,
      content,
      stageId,
      sourceLibraryId: libraryId,
      sourceEntryId: entryId,
      workspaceType:
        "materialType" in library ? library.materialType : library.skillType
    };
  }

  function resolvePasteMaterialStageId(
    stageId: MaterialStageId | SkillStageId,
    materialKind: MaterialLibraryKind | undefined
  ): MaterialStageId {
    const parsed = MaterialStageIdSchema.safeParse(stageId);
    const candidate = parsed.success
      ? parsed.data
      : ("other" as MaterialStageId);
    const allowed = MATERIAL_KIND_ALLOWED_STAGES[materialKind ?? "mixed"];
    if (allowed.includes(candidate)) return candidate;
    return allowed[0] ?? "other";
  }

  function copyCatalogLibraryEntry(
    payload: CatalogResourceNodeActionPayload
  ): void {
    const libraryId = payload.node.libraryId;
    const entryId = payload.node.catalogEntryId;
    if (!libraryId || !entryId) {
      uiMessage.error("未找到要复制的条目");
      return;
    }
    const clipboard = resolveLibraryEntryClipboardPayload(
      payload.domain,
      libraryId,
      entryId,
      payload.node.label
    );
    if (!clipboard) {
      uiMessage.error("未找到要复制的条目内容");
      return;
    }
    libraryEntryClipboard.value = clipboard;
    uiMessage.success(
      `已复制${payload.domain === "material" ? "素材" : "技能"}条目“${clipboard.title}”`
    );
  }

  async function pasteCatalogLibraryEntry(
    payload: CatalogResourceNodeActionPayload
  ): Promise<void> {
    const api = context.api();
    if (!api || catalogMutationPending.value) return;
    const clipboard = libraryEntryClipboard.value;
    const libraryId = payload.node.libraryId;
    if (!clipboard) {
      uiMessage.warning("剪贴板中没有可粘贴的条目");
      return;
    }
    if (!libraryId) {
      uiMessage.error("未找到要粘贴到的资料库");
      return;
    }
    if (clipboard.domain !== payload.domain) {
      uiMessage.warning(
        clipboard.domain === "material"
          ? "当前复制的是素材条目，只能粘贴到素材库"
          : "当前复制的是技能条目，只能粘贴到技能库"
      );
      return;
    }
    if (
      payload.node.workspaceType &&
      clipboard.workspaceType !== payload.node.workspaceType
    ) {
      uiMessage.warning("不同创作类型的资料库条目不能直接交叉粘贴");
      return;
    }
    if (payload.node.readOnly || payload.node.unavailable) {
      uiMessage.warning("目标资料库为只读或不可用，无法粘贴条目");
      return;
    }
    const library = context.findLibrary(payload.domain, libraryId);
    if (!library) {
      uiMessage.error("未找到要粘贴到的资料库");
      return;
    }
    if (
      payload.domain === "skill" &&
      "isBuiltin" in library &&
      library.isBuiltin
    ) {
      uiMessage.warning("内置技能库为只读内容，不能粘贴条目");
      return;
    }

    catalogMutationPending.value = true;
    try {
      const baseProjectRevision = library.projectRevision;
      const materialKind =
        "materialKind" in library ? library.materialKind : undefined;
      const created =
        clipboard.domain === "material"
          ? await api.createLibraryEntry({
              domain: "material",
              libraryId,
              title: clipboard.title,
              content: clipboard.content,
              stageId: resolvePasteMaterialStageId(
                clipboard.stageId,
                materialKind
              ),
              ...(baseProjectRevision === undefined
                ? {}
                : { baseProjectRevision })
            })
          : await api.createLibraryEntry({
              domain: "skill",
              libraryId,
              title: clipboard.title,
              content: clipboard.content,
              stageId: SkillStageIdSchema.parse(clipboard.stageId),
              ...(baseProjectRevision === undefined
                ? {}
                : { baseProjectRevision })
            });
      await context.refreshCatalog();
      context.advanceDraftProjectRevision(
        payload.domain,
        libraryId,
        baseProjectRevision === undefined ? undefined : baseProjectRevision + 1
      );
      const target = documents.value.find(
        (document) =>
          document.libraryId === libraryId &&
          document.catalogEntryId === created.id
      );
      if (target) context.selectDocument(target.id, true);
      uiMessage.success(
        `已粘贴${payload.domain === "material" ? "素材" : "技能"}条目“${created.title}”到“${payload.node.label}”`
      );
    } catch (error: unknown) {
      if (context.isConflict(error)) {
        await context.refreshCatalog();
        uiMessage.warning("资料库已在外部更新，已重新加载；请再次粘贴");
      } else {
        uiMessage.error(
          error instanceof Error ? error.message : "粘贴资料库条目失败。"
        );
      }
    } finally {
      catalogMutationPending.value = false;
    }
  }

  async function unregisterCatalogLibrary(
    payload: CatalogResourceNodeActionPayload
  ): Promise<void> {
    const api = context.api();
    if (!api || catalogMutationPending.value || !payload.node.libraryId) return;
    catalogMutationPending.value = true;
    try {
      const result = await api.unregisterProject({
        domain: payload.domain,
        projectId: payload.node.libraryId
      });
      if (!result.unregistered) {
        throw new Error("资料库已经不在当前目录中。");
      }
      context.disposeLibraryConversation(
        payload.domain,
        payload.node.libraryId
      );
      await context.refreshCatalog();
      libraryRemovalDialog.value = null;
      uiMessage.success(
        `已从列表移除“${payload.node.label}”，本地文件夹仍完整保留`
      );
    } catch (error: unknown) {
      uiMessage.error(
        error instanceof Error ? error.message : "移除资料库失败。"
      );
    } finally {
      catalogMutationPending.value = false;
    }
  }

  async function deleteCatalogLibrary(
    payload: CatalogResourceNodeActionPayload
  ): Promise<void> {
    const api = context.api();
    if (!api || catalogMutationPending.value || !payload.node.libraryId) return;
    catalogMutationPending.value = true;
    try {
      const result = await api.deleteProject({
        domain: payload.domain,
        projectId: payload.node.libraryId
      });
      if (!result.deleted) {
        throw new Error("资料库已经不在当前目录中。");
      }
      const removedDocumentIds = new Set(
        context.collectResourceNodeIds(payload.node)
      );
      editorDrafts.value = Object.fromEntries(
        Object.entries(editorDrafts.value).filter(
          ([documentId]) => !removedDocumentIds.has(documentId)
        )
      );
      context.disposeLibraryConversation(
        payload.domain,
        payload.node.libraryId
      );
      await context.refreshCatalog();
      libraryRemovalDialog.value = null;
      uiMessage.success(`已删除“${payload.node.label}”及其本地文件夹`);
    } catch (error: unknown) {
      uiMessage.error(
        error instanceof Error ? error.message : "删除资料库失败。"
      );
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

  async function duplicateCatalogLibraryProject(
    payload: CatalogResourceNodeActionPayload
  ): Promise<void> {
    const api = context.api();
    if (!api || catalogMutationPending.value || payload.node.unavailable)
      return;
    const isGroup = payload.action === "duplicate-group";
    const projectId = isGroup ? payload.node.groupId : payload.node.libraryId;
    if (!projectId) {
      uiMessage.error(isGroup ? "未找到对应的分组" : "未找到对应的资料库");
      return;
    }
    const sourceLibraryIds = new Set<string>();
    if (isGroup) {
      const group =
        payload.domain === "material"
          ? snapshot.value?.materialGroups.find(({ id }) => id === projectId)
          : snapshot.value?.skillGroups.find(({ id }) => id === projectId);
      for (const libraryId of Object.values(group?.members ?? {})) {
        if (libraryId) sourceLibraryIds.add(libraryId);
      }
    } else {
      sourceLibraryIds.add(projectId);
    }
    if (!(await context.prepareProjectsForDuplicate(sourceLibraryIds))) return;

    catalogMutationPending.value = true;
    try {
      const duplicated = await api.duplicateProject({
        domain: isGroup
          ? payload.domain === "material"
            ? "material-group"
            : "skill-group"
          : payload.domain,
        projectId
      });
      await context.refreshWorkspaceDirectory();
      await context.refreshCatalog();
      if (!isGroup) {
        const target = documents.value.find(
          (document) => document.libraryId === duplicated.projectId
        );
        if (target) await context.navigateToDocumentResource(target.id);
      }
      uiMessage.success(
        isGroup
          ? `已复制分组“${payload.node.label}”为“${duplicated.title}”，同时复制 ${duplicated.copiedMemberLibraryIds.length} 个成员库`
          : `已复制“${payload.node.label}”为“${duplicated.title}”`
      );
    } catch (error: unknown) {
      uiMessage.error(
        error instanceof Error ? error.message : "复制资料库项目失败。"
      );
    } finally {
      catalogMutationPending.value = false;
    }
  }

  async function dissolveCatalogLibraryGroup(
    payload: CatalogResourceNodeActionPayload
  ): Promise<void> {
    const api = context.api();
    if (!api || catalogMutationPending.value || !payload.node.groupId) return;
    catalogMutationPending.value = true;
    try {
      const result = await api.unregisterProject({
        domain:
          payload.domain === "material" ? "material-group" : "skill-group",
        projectId: payload.node.groupId
      });
      if (!result.unregistered) {
        throw new Error("分组已经不在当前目录中。");
      }
      await context.refreshCatalog();
      uiMessage.success(
        `已解散分组“${payload.node.label}”，成员库已回到原分类`
      );
    } catch (error: unknown) {
      uiMessage.error(
        error instanceof Error ? error.message : "解散分组失败。"
      );
    } finally {
      catalogMutationPending.value = false;
    }
  }

  function handleResourceNodeAction(
    payload: CatalogResourceNodeActionPayload
  ): void {
    if (
      payload.action === "duplicate-library" ||
      payload.action === "duplicate-group"
    ) {
      void duplicateCatalogLibraryProject(payload);
      return;
    }
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
    if (payload.action === "copy-entry") {
      copyCatalogLibraryEntry(payload);
      return;
    }
    if (payload.action === "rename-library") {
      libraryProjectDialog.value = {
        operation: "rename-library",
        domain: payload.domain,
        libraryId,
        libraryTitle: payload.node.label
      };
      return;
    }
    if (
      (payload.node.readOnly || payload.node.unavailable) &&
      (payload.action === "create-entry" ||
        payload.action === "import-external-skills" ||
        payload.action === "paste-entry" ||
        payload.action === "remove-entry")
    ) {
      uiMessage.warning("内置技能库为只读内容，不能修改条目");
      return;
    }
    if (payload.action === "paste-entry") {
      void pasteCatalogLibraryEntry(payload);
      return;
    }
    if (payload.action === "import-external-skills") {
      if (payload.domain !== "skill") return;
      externalLibraryImport.open("skill", libraryId);
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
        ...(payload.node.workspaceType
          ? { workspaceType: payload.node.workspaceType }
          : {}),
        ...(payload.domain === "material" && payload.node.materialKind
          ? { materialKind: payload.node.materialKind }
          : {})
      };
      return;
    }
    if (payload.action === "rename-entry") {
      if (!payload.node.catalogEntryId) {
        uiMessage.error("未找到要修改的条目");
        return;
      }
      libraryProjectDialog.value = {
        operation: "rename-entry",
        domain: payload.domain,
        libraryId,
        libraryTitle:
          context.findLibrary(payload.domain, libraryId)?.title ?? "资料库",
        entryId: payload.node.catalogEntryId,
        entryTitle: payload.node.label
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
        context.findLibrary(payload.domain, libraryId)?.title ?? "资料库",
      entryId: payload.node.catalogEntryId,
      entryTitle: payload.node.label,
      documentId: payload.node.id,
      ...(payload.node.workspaceType
        ? { workspaceType: payload.node.workspaceType }
        : {})
    };
  }

  return {
    libraryProjectDialog,
    externalLibraryImport,
    libraryGroupDialog,
    libraryRemovalDialog,
    libraryEntryClipboard,
    pendingLibraryEntryMove,
    libraryEntryClipboardDomain,
    activeLibraryGroup,
    createCatalogLibrary,
    saveCatalogLibraryGroup,
    createCatalogLibraryEntry,
    renameCatalogLibrary,
    renameCatalogLibraryEntry,
    removeCatalogLibraryEntry,
    requestCatalogLibraryEntryMove,
    confirmCatalogLibraryEntryMove,
    confirmLibraryRemoval,
    handleResourceNodeAction
  };
}
