import type { ExternalWindowTarget } from "@deepwrite/contracts";
import type { useSettingsStore } from "../../stores/settingsStore";
import { resolveAgentTeamModeAvailability } from "../../utils/agentTeamModeAvailability";

/** The same answer the composer's mode menu gives for this target. */
export function externalTeamAvailable(
  settings: ReturnType<typeof useSettingsStore>,
  target: ExternalWindowTarget,
  longAgentId: string | undefined
): boolean | undefined {
  if (target.kind === "library") return false;
  if (settings.agentTeamLoadError) return false;
  const parentAgentId = target.kind === "long" ? longAgentId : target.kind;
  if (
    !parentAgentId ||
    !settings.agentTeamLoaded ||
    settings.agentTeamLoading
  ) {
    return undefined;
  }
  return resolveAgentTeamModeAvailability({
    catalog: settings.agentTeamCatalog,
    workspaceType: target.kind,
    parentAgentId,
    bookId: target.id,
    loaded: settings.agentTeamLoaded,
    loading: settings.agentTeamLoading,
    loadError: settings.agentTeamLoadError
  }).available;
}
