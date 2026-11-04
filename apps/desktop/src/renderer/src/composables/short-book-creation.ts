import { createScopedTranslator } from "../i18n";
import type { Book } from "@deepwrite/contracts";
import { bindCreatedBookAgentTeams } from "./useBookAgentTeamBinding";
import type {
  CreateShortOrScriptBookInput,
  ShortBookLifecycleCoordinatorOptions
} from "./useShortBookLifecycleCoordinator";

const t = createScopedTranslator("workspace");
export function createShortBookCreator<Lease>(
  options: Pick<
    ShortBookLifecycleCoordinatorOptions,
    "catalog" | "state" | "resources" | "notifications"
  > & {
    acquirePendingLease(lane: "catalog"): Lease | null;
    runWithLease(lease: Lease, task: () => Promise<void>): Promise<void>;
    leaseIsOwned(lease: Lease): boolean;
    leaseCanPublish(lease: Lease): boolean;
    refreshAfterDurableMutation(): Promise<boolean>;
    errorMessage(error: unknown, fallback: string): string;
  }
) {
  const {
    catalog,
    state,
    resources,
    notifications,
    acquirePendingLease,
    runWithLease,
    leaseIsOwned,
    leaseCanPublish,
    refreshAfterDurableMutation,
    errorMessage
  } = options;
  function createBook(input: CreateShortOrScriptBookInput): Promise<void> {
    const api = catalog.api();
    if (!api) {
      notifications.warning(
        t(
          "creativeBookCreation.theBrowserPreviewCannotSaveProjectsCreateProjectsIn"
        )
      );
      return Promise.resolve();
    }
    const lease = acquirePendingLease("catalog");
    if (!lease) return Promise.resolve();
    return runWithLease(lease, async () => {
      let created: Book | null = null;
      try {
        created = input.templateId
          ? await api.createBookFromTemplate({
              templateId: input.templateId,
              title: input.title
            })
          : input.workspaceType === "script"
            ? await api.createScriptBook({
                defaultPlotStageIds: input.defaultPlotStageIds,
                title: input.title,
                genre: input.genre,
                characterFormat: input.characterFormat,
                linkedMaterialIdsByKind: input.linkedMaterialIdsByKind,
                linkedSkillIdsByKind: input.linkedSkillIdsByKind
              })
            : await api.createShortBook({
                title: input.title,
                genre: input.genre,
                characterFormat: input.characterFormat,
                defaultPlotStageIds: input.defaultPlotStageIds,
                linkedMaterialIdsByKind: input.linkedMaterialIdsByKind,
                linkedSkillIdsByKind: input.linkedSkillIdsByKind
              });
        if (created) {
          await bindCreatedBookAgentTeams(
            created.id,
            input.workspaceType,
            input.linkedAgentTeamIds
          );
        }
        if (!created || !leaseIsOwned(lease)) return;

        let directoryRefreshFailed = false;
        try {
          await catalog.refreshWorkspaceDirectory();
        } catch {
          directoryRefreshFailed = true;
        }
        if (!leaseIsOwned(lease)) return;
        const refreshed = await refreshAfterDurableMutation();
        if (!leaseIsOwned(lease)) return;

        state.createBookDialogOpen.value = false;
        if (!refreshed || directoryRefreshFailed) {
          if (leaseCanPublish(lease)) {
            notifications.warning(
              t(
                "shortBookCreation.createdButFailedToRefreshTheProjectListRefresh",
                {
                  value:
                    input.workspaceType === "script"
                      ? t("catalogWorkspace.screenplay")
                      : t("catalogWorkspace.shortStory"),
                  title: created.title
                }
              )
            );
          }
          return;
        }
        await resources.settleUi();
        if (!leaseCanPublish(lease)) return;
        await resources.selectPreferredBook(created.id);
        if (leaseCanPublish(lease)) {
          notifications.success(
            t(
              "shortBookCreation.createdAndSavedTheMaterialAndSkillLibraryLinks",
              {
                value:
                  input.workspaceType === "script"
                    ? t("catalogWorkspace.screenplay")
                    : t("catalogWorkspace.shortStory"),
                title: created.title
              }
            )
          );
        }
      } catch (error: unknown) {
        if (!leaseCanPublish(lease)) return;
        if (created) {
          state.createBookDialogOpen.value = false;
          notifications.warning(
            t(
              "shortBookCreation.createdProjectButFailedToRefreshTheLocalList",
              { title: created.title }
            )
          );
        } else {
          notifications.error(
            errorMessage(error, t("shortBookCreation.failedToCreateProject"))
          );
        }
      }
    });
  }

  return createBook;
}
