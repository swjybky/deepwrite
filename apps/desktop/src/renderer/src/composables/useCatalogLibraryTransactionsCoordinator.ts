import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
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
import { useLibraryPackageCoordinator } from "./useLibraryPackageCoordinator";

const t = createScopedTranslator("workspace");

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
  libraryPackageApi(): DeepWriteApi["libraryPackage"] | undefined;
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
    libraryIds: ReadonlySet<string>,
    operation?: "duplicate" | "export"
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
  const libraryPackage = useLibraryPackageCoordinator({
    ...context,
    api: context.libraryPackageApi,
    isDesktop: () => !!context.api(),
    prepareProjectsForExport: (libraryIds) =>
      context.prepareProjectsForDuplicate(libraryIds, "export")
  });
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
        t("catalogLibraryTransactionsCoordinator.createdLibrary", {
          value:
            payload.domain === "material"
              ? t("catalogWorkspace.material")
              : t("catalogWorkspace.skill"),
          title: created.title
        })
      );
    } catch (error: unknown) {
      uiMessage.error(
        formatError(
          error,
          t("catalogLibraryTransactionsCoordinator.failedToCreateLibrary")
        )
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
        t("catalogLibraryTransactionsCoordinator.createdGroup", {
          value:
            payload.domain === "material"
              ? t("catalogWorkspace.material")
              : t("catalogWorkspace.skill"),
          title: created.title
        })
      );
    } catch (error: unknown) {
      await context.refreshCatalog();
      uiMessage.error(
        formatError(
          error,
          t("catalogLibraryTransactionsCoordinator.failedToCreateLibraryGroup")
        )
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
      uiMessage.success(
        t("catalogLibraryTransactionsCoordinator.savedGroup", {
          title: updated.title
        })
      );
    } catch (error: unknown) {
      if (context.isConflict(error)) {
        await context.refreshCatalog();
        libraryGroupDialog.value = null;
        uiMessage.warning(
          t(
            "catalogLibraryTransactionsCoordinator.theGroupWasUpdatedExternallyAndHasBeenReloaded"
          )
        );
      } else {
        await context.refreshCatalog();
        uiMessage.error(
          formatError(
            error,
            t("catalogLibraryTransactionsCoordinator.failedToUpdateGroupLinks")
          )
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
        t("catalogLibraryTransactionsCoordinator.createdEntry", {
          value:
            payload.domain === "material"
              ? t("catalogWorkspace.material")
              : t("catalogWorkspace.skill"),
          title: created.title
        })
      );
    } catch (error: unknown) {
      if (context.isConflict(error)) {
        await context.refreshCatalog();
        libraryProjectDialog.value = null;
        uiMessage.warning(
          t(
            "catalogLibraryTransactionsCoordinator.theLibraryWasUpdatedExternallyAndHasBeenReloaded"
          )
        );
      } else {
        uiMessage.error(
          formatError(
            error,
            t(
              "catalogLibraryTransactionsCoordinator.failedToCreateLibraryEntry"
            )
          )
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
      uiMessage.error(
        t("catalogLibraryTransactionsCoordinator.theLibraryToEditWasNotFound")
      );
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
      uiMessage.success(
        t("catalogLibraryTransactionsCoordinator.libraryRenamed")
      );
    } catch (error: unknown) {
      await context.refreshCatalog();
      uiMessage.error(
        formatError(
          error,
          t("catalogLibraryTransactionsCoordinator.failedToRenameLibrary")
        )
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
      uiMessage.error(
        t("catalogLibraryTransactionsCoordinator.theEntryToEditWasNotFound")
      );
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
      uiMessage.success(
        t("catalogLibraryTransactionsCoordinator.entryRenamed")
      );
    } catch (error: unknown) {
      await context.refreshCatalog();
      uiMessage.error(
        formatError(
          error,
          t("catalogLibraryTransactionsCoordinator.failedToRenameEntry")
        )
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
      uiMessage.error(
        t(
          "catalogLibraryTransactionsCoordinator.theDestinationLibraryNoLongerExistsRefreshAndTry"
        )
      );
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
          ? t("catalogLibraryTransactionsCoordinator.entryOrderUpdated")
          : t(
              "catalogLibraryTransactionsCoordinator.entryMovedToTheDestinationLibrary"
            )
      );
    } catch (error: unknown) {
      await context.refreshCatalog();
      uiMessage.error(
        formatError(
          error,
          t("catalogLibraryTransactionsCoordinator.failedToMoveLibraryEntry")
        )
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
      uiMessage.error(
        t(
          "catalogLibraryTransactionsCoordinator.theDestinationLibraryNoLongerExistsRefreshAndTry"
        )
      );
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
      uiMessage.error(
        t(
          "catalogLibraryTransactionsCoordinator.theMaterialEntryToMoveNoLongerExistsRefresh"
        )
      );
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
        uiMessage.warning(
          t(
            "catalogLibraryTransactionsCoordinator.theEntryNoLongerExistsTheDirectoryHasBeen"
          )
        );
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
        t("catalogLibraryTransactionsCoordinator.deletedEntryFile", {
          value:
            payload.domain === "material"
              ? t("catalogWorkspace.material")
              : t("catalogWorkspace.skill")
        })
      );
    } catch (error: unknown) {
      if (context.isConflict(error)) {
        await context.refreshCatalog();
        libraryProjectDialog.value = null;
        uiMessage.warning(
          t(
            "catalogLibraryTransactionsCoordinator.theLibraryWasUpdatedExternallyAndHasBeenReloaded2"
          )
        );
      } else {
        uiMessage.error(
          formatError(
            error,
            t(
              "catalogLibraryTransactionsCoordinator.failedToDeleteLibraryEntry"
            )
          )
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
      uiMessage.error(
        t("catalogLibraryTransactionsCoordinator.theEntryToCopyWasNotFound")
      );
      return;
    }
    const clipboard = resolveLibraryEntryClipboardPayload(
      payload.domain,
      libraryId,
      entryId,
      payload.node.label
    );
    if (!clipboard) {
      uiMessage.error(
        t(
          "catalogLibraryTransactionsCoordinator.theEntryContentToCopyWasNotFound"
        )
      );
      return;
    }
    libraryEntryClipboard.value = clipboard;
    uiMessage.success(
      t("catalogLibraryTransactionsCoordinator.copiedEntry", {
        value:
          payload.domain === "material"
            ? t("catalogWorkspace.material")
            : t("catalogWorkspace.skill"),
        title: clipboard.title
      })
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
      uiMessage.warning(
        t("catalogLibraryTransactionsCoordinator.theClipboardHasNoEntryToPaste")
      );
      return;
    }
    if (!libraryId) {
      uiMessage.error(
        t(
          "catalogLibraryTransactionsCoordinator.theDestinationLibraryWasNotFound"
        )
      );
      return;
    }
    if (clipboard.domain !== payload.domain) {
      uiMessage.warning(
        clipboard.domain === "material"
          ? t(
              "catalogLibraryTransactionsCoordinator.materialEntriesCanOnlyBePastedIntoMaterialLibraries"
            )
          : t(
              "catalogLibraryTransactionsCoordinator.skillEntriesCanOnlyBePastedIntoSkillLibraries"
            )
      );
      return;
    }
    if (
      payload.node.workspaceType &&
      clipboard.workspaceType !== payload.node.workspaceType
    ) {
      uiMessage.warning(
        t(
          "catalogLibraryTransactionsCoordinator.entriesCannotBePastedAcrossLibrariesOfDifferentProject"
        )
      );
      return;
    }
    if (payload.node.readOnly || payload.node.unavailable) {
      uiMessage.warning(
        t(
          "catalogLibraryTransactionsCoordinator.theDestinationLibraryIsReadOnlyOrUnavailableThe"
        )
      );
      return;
    }
    const library = context.findLibrary(payload.domain, libraryId);
    if (!library) {
      uiMessage.error(
        t(
          "catalogLibraryTransactionsCoordinator.theDestinationLibraryWasNotFound"
        )
      );
      return;
    }
    if (
      payload.domain === "skill" &&
      "isBuiltin" in library &&
      library.isBuiltin
    ) {
      uiMessage.warning(
        t(
          "catalogLibraryTransactionsCoordinator.builtInSkillLibrariesAreReadOnlyEntriesCannot"
        )
      );
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
        t("catalogLibraryTransactionsCoordinator.pastedEntryInto", {
          value:
            payload.domain === "material"
              ? t("catalogWorkspace.material")
              : t("catalogWorkspace.skill"),
          title: created.title,
          label: payload.node.label
        })
      );
    } catch (error: unknown) {
      if (context.isConflict(error)) {
        await context.refreshCatalog();
        uiMessage.warning(
          t(
            "catalogLibraryTransactionsCoordinator.theLibraryWasUpdatedExternallyAndHasBeenReloaded3"
          )
        );
      } else {
        uiMessage.error(
          formatError(
            error,
            t("catalogLibraryTransactionsCoordinator.failedToPasteLibraryEntry")
          )
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
        throw new Error(
          t(
            "catalogLibraryTransactionsCoordinator.theLibraryIsNoLongerInTheCurrentDirectory"
          )
        );
      }
      context.disposeLibraryConversation(
        payload.domain,
        payload.node.libraryId
      );
      await context.refreshCatalog();
      libraryRemovalDialog.value = null;
      uiMessage.success(
        t(
          "catalogLibraryTransactionsCoordinator.removedFromTheListItsLocalFolderIsPreserved",
          { label: payload.node.label }
        )
      );
    } catch (error: unknown) {
      uiMessage.error(
        formatError(
          error,
          t("catalogLibraryTransactionsCoordinator.failedToRemoveLibrary")
        )
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
        throw new Error(
          t(
            "catalogLibraryTransactionsCoordinator.theLibraryIsNoLongerInTheCurrentDirectory"
          )
        );
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
      uiMessage.success(
        t("catalogLibraryTransactionsCoordinator.deletedAndItsLocalFolder", {
          label: payload.node.label
        })
      );
    } catch (error: unknown) {
      uiMessage.error(
        formatError(
          error,
          t("catalogLibraryTransactionsCoordinator.failedToDeleteLibrary")
        )
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
      uiMessage.error(
        isGroup
          ? t("catalogLibraryTransactionsCoordinator.theGroupWasNotFound")
          : t("catalogLibraryTransactionsCoordinator.theLibraryWasNotFound")
      );
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
          ? t(
              "catalogLibraryTransactionsCoordinator.copiedGroupAsIncludingMemberLibraries",
              {
                label: payload.node.label,
                title: duplicated.title,
                length: duplicated.copiedMemberLibraryIds.length
              }
            )
          : t("catalogLibraryTransactionsCoordinator.copiedAs", {
              label: payload.node.label,
              title: duplicated.title
            })
      );
    } catch (error: unknown) {
      uiMessage.error(
        formatError(
          error,
          t(
            "catalogLibraryTransactionsCoordinator.failedToDuplicateLibraryProject"
          )
        )
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
        throw new Error(
          t(
            "catalogLibraryTransactionsCoordinator.theGroupIsNoLongerInTheCurrentDirectory"
          )
        );
      }
      await context.refreshCatalog();
      uiMessage.success(
        t(
          "catalogLibraryTransactionsCoordinator.dissolvedGroupItsLibrariesAreBackInTheirOriginal",
          { label: payload.node.label }
        )
      );
    } catch (error: unknown) {
      uiMessage.error(
        formatError(
          error,
          t("catalogLibraryTransactionsCoordinator.failedToDissolveGroup")
        )
      );
    } finally {
      catalogMutationPending.value = false;
    }
  }

  function handleResourceNodeAction(
    payload: CatalogResourceNodeActionPayload
  ): void {
    if (
      payload.action === "export-library" ||
      payload.action === "export-group"
    ) {
      void libraryPackage.exportPackage(payload);
      return;
    }
    if (
      payload.action === "duplicate-library" ||
      payload.action === "duplicate-group"
    ) {
      void duplicateCatalogLibraryProject(payload);
      return;
    }
    if (payload.action === "edit-group-bindings") {
      if (!payload.node.groupId) {
        uiMessage.error(
          t("catalogLibraryTransactionsCoordinator.theGroupWasNotFound")
        );
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
      uiMessage.error(
        t("catalogLibraryTransactionsCoordinator.theLocalLibraryWasNotFound")
      );
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
      uiMessage.warning(
        t(
          "catalogLibraryTransactionsCoordinator.builtInSkillLibrariesAreReadOnlyEntriesCannot2"
        )
      );
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
        uiMessage.error(
          t("catalogLibraryTransactionsCoordinator.theEntryToEditWasNotFound")
        );
        return;
      }
      libraryProjectDialog.value = {
        operation: "rename-entry",
        domain: payload.domain,
        libraryId,
        libraryTitle:
          context.findLibrary(payload.domain, libraryId)?.title ??
          t("catalogLibraryTransactionsCoordinator.library"),
        entryId: payload.node.catalogEntryId,
        entryTitle: payload.node.label
      };
      return;
    }
    if (!payload.node.catalogEntryId) {
      uiMessage.error(
        t(
          "catalogLibraryTransactionsCoordinator.theEntryFileToDeleteWasNotFound"
        )
      );
      return;
    }
    libraryProjectDialog.value = {
      operation: "remove-entry",
      domain: payload.domain,
      libraryId,
      libraryTitle:
        context.findLibrary(payload.domain, libraryId)?.title ??
        t("catalogLibraryTransactionsCoordinator.library"),
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
    libraryPackage,
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
