import { computed, onMounted } from "vue";
import type { AgentTeamBookBindingInput } from "@deepwrite/contracts";
import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import { useSettingsStore } from "../stores/settingsStore";
import { uiMessage } from "../ui-feedback";

const t = createScopedTranslator("workspace.bookAgentTeamBinding");

/** Team catalog for the binding controls, which can open before any team page. */
export function useBookAgentTeamCatalog() {
  const settingsStore = useSettingsStore();
  onMounted(async () => {
    const api = window.deepwrite;
    if (!api) return;
    try {
      await settingsStore.ensureAgentTeamsLoaded(() => api.agentTeams.list());
    } catch (error: unknown) {
      uiMessage.error(formatError(error, t("failedToLoadAgentTeams")));
    }
  });
  return {
    catalog: computed(() => settingsStore.agentTeamCatalog),
    loaded: computed(() => settingsStore.agentTeamLoaded)
  };
}

export async function saveBookAgentTeamBinding(
  input: AgentTeamBookBindingInput
): Promise<void> {
  const api = window.deepwrite;
  if (!api) throw new Error(t("availableInTheDesktopAppOnly"));
  useSettingsStore().markLoaded(
    "agentTeams",
    await api.agentTeams.setBookBinding(input)
  );
}

/**
 * Binds a book that already exists on disk. Creation has succeeded by now, so
 * a failure here warns instead of reporting the book as not created.
 */
export async function bindCreatedBookAgentTeams(
  bookId: string,
  workspaceType: AgentTeamBookBindingInput["workspaceType"],
  teamIds: readonly string[] | undefined
): Promise<void> {
  if (!teamIds?.length) return;
  try {
    await saveBookAgentTeamBinding({
      bookId,
      workspaceType,
      teamIds: [...teamIds]
    });
  } catch (error: unknown) {
    uiMessage.warning(formatError(error, t("createdButTeamBindingFailed")));
  }
}

/** A copy keeps its source's team binding, like its library bindings. */
export async function copyBookAgentTeamBinding(
  sourceBookId: string,
  bookId: string,
  workspaceType: AgentTeamBookBindingInput["workspaceType"]
): Promise<void> {
  const api = window.deepwrite?.agentTeams;
  if (!api) return;
  try {
    const catalog = await api.list();
    await bindCreatedBookAgentTeams(
      bookId,
      workspaceType,
      catalog.bookBindings?.[sourceBookId]
    );
  } catch (error: unknown) {
    uiMessage.warning(formatError(error, t("createdButTeamBindingFailed")));
  }
}
