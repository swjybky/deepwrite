import { formatError, getErrorDetail } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import {
  withAgentTeamEnabled,
  type AgentTeamProfileCreateInput,
  type AgentTeamProfileRenameInput,
  type AgentTeamProfileSaveInput,
  type AgentTeamProfileSetEnabledInput,
  type AgentTeamProfileTargetInput,
  type DeepWriteApi
} from "@deepwrite/contracts";
import { systemEventCenter } from "../events/systemEventCenter";
import type { useSettingsStore } from "../stores/settingsStore";
import type { ModelSettingsNotifications } from "./useModelSettingsCoordinator";

const t = createScopedTranslator("workspace");

export interface AgentTeamCatalogCoordinatorContext {
  api(): DeepWriteApi | undefined;
  settingsStore: ReturnType<typeof useSettingsStore>;
  notifications: ModelSettingsNotifications;
}

export function useAgentTeamCatalogCoordinator(
  context: AgentTeamCatalogCoordinatorContext
) {
  const { settingsStore, notifications: uiMessage } = context;
  let enabledRevision = 0;

  // Teams live in Main, so an external change is only seen by asking again.
  systemEventCenter.subscribe("externalControl.resource_changed", (event) => {
    const api = context.api();
    if (api && event.payload.domain === "agent_team") {
      void restoreAgentTeamCatalog(api);
    }
  });

  async function loadAgentTeamSettings(): Promise<void> {
    const api = context.api();
    if (!api) return;
    try {
      await settingsStore.ensureAgentTeamsLoaded(() => api.agentTeams.list());
    } catch (error: unknown) {
      uiMessage.error(
        formatError(
          error,
          t("settingsFeatureCoordinator.failedToLoadAgentTeamSettings")
        )
      );
    }
  }

  async function mutateAgentTeamCatalog(
    operation: () => ReturnType<DeepWriteApi["agentTeams"]["list"]>,
    successMessage: string,
    fallbackMessage: string
  ): Promise<void> {
    const api = context.api();
    if (!api || settingsStore.agentTeamSaving) return;
    settingsStore.agentTeamSaving = true;
    try {
      settingsStore.markLoaded("agentTeams", await operation());
      uiMessage.success(successMessage);
    } catch (error: unknown) {
      uiMessage.error(formatError(error, fallbackMessage));
    } finally {
      settingsStore.agentTeamSaving = false;
    }
  }

  async function createAgentTeam(
    input: AgentTeamProfileCreateInput
  ): Promise<void> {
    const api = context.api();
    if (!api) return;
    await mutateAgentTeamCatalog(
      () => api.agentTeams.create(input),
      t("settingsFeatureCoordinator.agentTeamCreated"),
      t("settingsFeatureCoordinator.failedToCreateAgentTeam")
    );
  }

  async function renameAgentTeam(
    input: AgentTeamProfileRenameInput
  ): Promise<void> {
    const api = context.api();
    if (!api) return;
    await mutateAgentTeamCatalog(
      () => api.agentTeams.rename(input),
      t("settingsFeatureCoordinator.agentTeamRenamed"),
      t("settingsFeatureCoordinator.failedToRenameAgentTeam")
    );
  }

  async function deleteAgentTeam(
    input: AgentTeamProfileTargetInput
  ): Promise<void> {
    const api = context.api();
    if (!api) return;
    await mutateAgentTeamCatalog(
      () => api.agentTeams.delete(input),
      t("settingsFeatureCoordinator.agentTeamDeleted"),
      t("settingsFeatureCoordinator.failedToDeleteAgentTeam")
    );
  }

  /**
   * Switching a team on or off is quick and reversible, so it must not raise
   * the page-wide saving flag: every control binds that flag to `disabled`,
   * and a round trip would grey the whole page out and back. Show the result
   * at once, then settle on Main's snapshot; Main serializes catalog writes,
   * so only the newest reply needs to be applied.
   */
  async function setAgentTeamEnabled(
    input: AgentTeamProfileSetEnabledInput
  ): Promise<void> {
    const api = context.api();
    const catalog = settingsStore.agentTeamCatalog;
    const team = catalog?.teams.find(
      (candidate) => candidate.id === input.teamId
    );
    if (!api || !catalog || !team || settingsStore.agentTeamSaving) return;
    const revision = ++enabledRevision;
    settingsStore.markLoaded("agentTeams", {
      ...catalog,
      enabledTeamIds: withAgentTeamEnabled(
        catalog.enabledTeamIds,
        team,
        input.enabled
      )
    });
    try {
      const snapshot = await api.agentTeams.setEnabled(input);
      if (revision === enabledRevision) {
        settingsStore.markLoaded("agentTeams", snapshot);
      }
      uiMessage.success(
        input.enabled
          ? t("settingsFeatureCoordinator.teamEnabledItWillBeUsedForTheNext")
          : t("settingsFeatureCoordinator.teamDisabledItWillNoLongerBeUsedFor")
      );
    } catch (error: unknown) {
      uiMessage.error(
        formatError(
          error,
          t("settingsFeatureCoordinator.failedToUpdateTeamStatus")
        )
      );
      await restoreAgentTeamCatalog(api);
    }
  }

  /** Drop the optimistic switch state by reading Main's authoritative catalog. */
  async function restoreAgentTeamCatalog(api: DeepWriteApi): Promise<void> {
    try {
      settingsStore.markLoaded("agentTeams", await api.agentTeams.list());
    } catch {
      // Keep the current view; the failure toast has already been shown.
    }
  }

  async function saveAgentTeamSettings(
    input: AgentTeamProfileSaveInput
  ): Promise<void> {
    const api = context.api();
    if (!api) return;
    await mutateAgentTeamCatalog(
      () => api.agentTeams.save(input),
      t("settingsFeatureCoordinator.agentTeamSaved"),
      t("settingsFeatureCoordinator.failedToSaveAgentTeamSettings")
    );
  }

  async function downloadAgentTeam(
    input: AgentTeamProfileTargetInput
  ): Promise<void> {
    const api = context.api();
    if (!api || settingsStore.agentTeamSaving) return;
    settingsStore.agentTeamSaving = true;
    try {
      const result = await api.agentTeams.download(input);
      if (result.status === "saved") {
        uiMessage.success(
          t("settingsFeatureCoordinator.agentTeamArchiveDownloaded")
        );
      }
    } catch (error: unknown) {
      uiMessage.error(
        formatError(
          error,
          t("settingsFeatureCoordinator.failedToDownloadAgentTeam")
        )
      );
    } finally {
      settingsStore.agentTeamSaving = false;
    }
  }

  async function installAgentTeam(): Promise<void> {
    const api = context.api();
    if (
      !api ||
      settingsStore.agentTeamSaving ||
      settingsStore.agentTeamInstalling
    )
      return;
    settingsStore.agentTeamInstalling = true;
    try {
      const result = await api.agentTeams.install();
      if (result.status === "installed") {
        settingsStore.markLoaded("agentTeams", result.catalog);
        uiMessage.success(
          t("settingsFeatureCoordinator.agentTeamInstalled", {
            teamName: result.teamName
          })
        );
      }
    } catch (error: unknown) {
      const fallback = t("settingsFeatureCoordinator.failedToInstallAgentTeam");
      const detail = getErrorDetail(error);
      uiMessage.error(detail ? `${fallback} ${detail}` : fallback);
    } finally {
      settingsStore.agentTeamInstalling = false;
    }
  }

  return {
    loadAgentTeamSettings,
    createAgentTeam,
    renameAgentTeam,
    deleteAgentTeam,
    setAgentTeamEnabled,
    saveAgentTeamSettings,
    downloadAgentTeam,
    installAgentTeam
  };
}
