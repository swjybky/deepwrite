import { ref } from "vue";
import { createScopedTranslator } from "../i18n";
import { formatError } from "../i18n/errors";
import type { CatalogResourceNodeActionPayload } from "../types/workspace";
import type { CatalogLibraryTransactionsContext } from "./useCatalogLibraryTransactionsCoordinator";

const t = createScopedTranslator(
  "workspace.catalogLibraryTransactionsCoordinator"
);

export interface LibraryRemovalDialogState {
  action: "remove" | "delete";
  payload: CatalogResourceNodeActionPayload;
}

/** Owns confirmation, removal, disk deletion and cleanup for libraries and groups. */
export function useLibraryRemovalCoordinator(
  context: CatalogLibraryTransactionsContext
) {
  const libraryRemovalDialog = ref<LibraryRemovalDialogState | null>(null);

  async function unregisterLibrary(
    payload: CatalogResourceNodeActionPayload
  ): Promise<void> {
    const api = context.api();
    if (!api || context.mutationPending.value || !payload.node.libraryId)
      return;
    context.mutationPending.value = true;
    try {
      const result = await api.unregisterProject({
        domain: payload.domain,
        projectId: payload.node.libraryId
      });
      if (!result.unregistered) {
        throw new Error(t("theLibraryIsNoLongerInTheCurrentDirectory"));
      }
      context.disposeLibraryConversation(
        payload.domain,
        payload.node.libraryId
      );
      await context.refreshCatalog();
      libraryRemovalDialog.value = null;
      context.notifications.success(
        t("removedFromTheListItsLocalFolderIsPreserved", {
          label: payload.node.label
        })
      );
    } catch (error: unknown) {
      context.notifications.error(
        formatError(error, t("failedToRemoveLibrary"))
      );
    } finally {
      context.mutationPending.value = false;
    }
  }

  async function deleteProject(
    payload: CatalogResourceNodeActionPayload
  ): Promise<void> {
    const api = context.api();
    const isGroup = payload.action === "delete-group";
    const projectId = isGroup ? payload.node.groupId : payload.node.libraryId;
    if (!api || context.mutationPending.value || !projectId) return;
    context.mutationPending.value = true;
    try {
      const result = await api.deleteProject({
        domain: isGroup
          ? payload.domain === "material"
            ? "material-group"
            : "skill-group"
          : payload.domain,
        projectId,
        ...(isGroup && payload.node.projectRevision !== undefined
          ? { baseProjectRevision: payload.node.projectRevision }
          : {})
      });
      if (!result.deleted) {
        throw new Error(
          t(
            isGroup
              ? "theGroupIsNoLongerInTheCurrentDirectory"
              : "theLibraryIsNoLongerInTheCurrentDirectory"
          )
        );
      }
      const removedLibraryIds = new Set(
        isGroup ? (result.deletedMemberLibraryIds ?? []) : [projectId]
      );
      const removedDocumentIds = new Set(
        context.collectResourceNodeIds(payload.node)
      );
      for (const document of context.documents.value) {
        if (
          document.domain === payload.domain &&
          document.libraryId &&
          removedLibraryIds.has(document.libraryId)
        ) {
          removedDocumentIds.add(document.id);
        }
      }
      context.drafts.value = Object.fromEntries(
        Object.entries(context.drafts.value).filter(
          ([documentId]) => !removedDocumentIds.has(documentId)
        )
      );
      for (const libraryId of removedLibraryIds) {
        context.disposeLibraryConversation(payload.domain, libraryId);
      }
      await context.refreshWorkspaceDirectory();
      await context.refreshCatalog();
      libraryRemovalDialog.value = null;
      context.notifications.success(
        t(
          isGroup
            ? "deletedGroupAndMemberLibraries"
            : "deletedAndItsLocalFolder",
          {
            label: payload.node.label,
            length: removedLibraryIds.size
          }
        )
      );
    } catch (error: unknown) {
      if (isGroup && context.isConflict(error)) {
        await context.refreshCatalog();
        libraryRemovalDialog.value = null;
        context.notifications.warning(t("groupChangedBeforeDeletion"));
      } else {
        context.notifications.error(
          formatError(
            error,
            t(isGroup ? "failedToDeleteGroup" : "failedToDeleteLibrary")
          )
        );
      }
    } finally {
      context.mutationPending.value = false;
    }
  }

  async function dissolveGroup(
    payload: CatalogResourceNodeActionPayload
  ): Promise<void> {
    const api = context.api();
    if (!api || context.mutationPending.value || !payload.node.groupId) return;
    context.mutationPending.value = true;
    try {
      const result = await api.unregisterProject({
        domain:
          payload.domain === "material" ? "material-group" : "skill-group",
        projectId: payload.node.groupId
      });
      if (!result.unregistered) {
        throw new Error(t("theGroupIsNoLongerInTheCurrentDirectory"));
      }
      await context.refreshCatalog();
      context.notifications.success(
        t("dissolvedGroupItsLibrariesAreBackInTheirOriginal", {
          label: payload.node.label
        })
      );
    } catch (error: unknown) {
      context.notifications.error(
        formatError(error, t("failedToDissolveGroup"))
      );
    } finally {
      context.mutationPending.value = false;
    }
  }

  function confirmLibraryRemoval(): void {
    const dialog = libraryRemovalDialog.value;
    if (!dialog) return;
    if (dialog.action === "delete") void deleteProject(dialog.payload);
    else void unregisterLibrary(dialog.payload);
  }

  function handleRemovalAction(
    payload: CatalogResourceNodeActionPayload
  ): boolean {
    if (payload.action === "dissolve-group") {
      if (payload.node.readOnly) {
        context.notifications.warning(
          t("builtInSkillLibrariesAreReadOnlyEntriesCannot2")
        );
        return true;
      }
      void dissolveGroup(payload);
      return true;
    }
    if (
      payload.action !== "delete-group" &&
      payload.action !== "delete-library" &&
      payload.action !== "unregister-library"
    ) {
      return false;
    }
    if (payload.node.readOnly) {
      context.notifications.warning(
        t("builtInSkillLibrariesAreReadOnlyEntriesCannot2")
      );
      return true;
    }
    if (context.mutationPending.value) return true;
    const isGroup = payload.action === "delete-group";
    const projectId = isGroup ? payload.node.groupId : payload.node.libraryId;
    if (!projectId) {
      context.notifications.error(
        t(isGroup ? "theGroupWasNotFound" : "theLocalLibraryWasNotFound")
      );
      return true;
    }
    const groups =
      payload.domain === "material"
        ? context.snapshot.value?.materialGroups
        : context.snapshot.value?.skillGroups;
    const revision = isGroup
      ? (groups?.find(({ id }) => id === projectId)?.projectRevision ??
        payload.node.projectRevision)
      : undefined;
    libraryRemovalDialog.value = {
      action: payload.action === "unregister-library" ? "remove" : "delete",
      payload: {
        ...payload,
        node: {
          ...payload.node,
          ...(revision === undefined ? {} : { projectRevision: revision })
        }
      }
    };
    return true;
  }

  return { libraryRemovalDialog, confirmLibraryRemoval, handleRemovalAction };
}
