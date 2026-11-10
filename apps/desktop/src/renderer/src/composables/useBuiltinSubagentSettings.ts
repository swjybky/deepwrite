import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import type {
  AgentTeamCatalogSnapshot,
  BuiltinSubagentSettings
} from "@deepwrite/contracts/renderer";
import { useSettingsStore } from "../stores/settingsStore";
import { uiMessage } from "../ui-feedback";

const t = createScopedTranslator("workspace.builtinSubagentSettings");

export function useBuiltinSubagentSettings() {
  const settings = useSettingsStore();
  let enabledRevision = 0;

  function applyBuiltins(snapshot: AgentTeamCatalogSnapshot): void {
    settings.markLoaded("agentTeams", {
      ...(settings.agentTeamCatalog ?? snapshot),
      builtinSubagents: snapshot.builtinSubagents
    });
  }

  async function setEnabled(
    domain: keyof BuiltinSubagentSettings,
    enabled: boolean
  ): Promise<void> {
    const api = window.deepwrite;
    const catalog = settings.agentTeamCatalog;
    if (!api || !catalog || settings.agentTeamSaving) return;
    const revision = ++enabledRevision;
    const input = {
      ...catalog.builtinSubagents,
      [domain]: { ...catalog.builtinSubagents[domain], enabled }
    };
    applyBuiltins({ ...catalog, builtinSubagents: input });
    try {
      const snapshot = await api.agentTeams.saveBuiltins(input);
      if (revision === enabledRevision) {
        applyBuiltins(snapshot);
        uiMessage.success(t("builtInManagementSubagentSettingsSaved"));
      }
    } catch (error) {
      uiMessage.error(formatError(error, t("failedToSavePleaseTryAgain")));
      if (revision !== enabledRevision) return;
      try {
        const snapshot = await api.agentTeams.list();
        if (revision === enabledRevision) applyBuiltins(snapshot);
      } catch {
        if (revision === enabledRevision) applyBuiltins(catalog);
      }
    }
  }
  return { setEnabled };
}
