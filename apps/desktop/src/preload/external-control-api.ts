import {
  createEnvelope,
  ExternalControlOverviewSchema,
  ExternalWindowResponseSchema,
  type ExternalControlOverview,
  type ExternalControlPreloadApi
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";

async function settingsCommand(
  type:
    | "externalControl.overview"
    | "externalControl.revokeClient"
    | "externalControl.restoreTrash"
    | "externalControl.emptyTrash"
    | "externalControl.installSkill",
  payload: Record<string, string>
): Promise<ExternalControlOverview> {
  const id = browserId("cmd_external_settings");
  return ExternalControlOverviewSchema.parse(
    await invokeCommand(
      createEnvelope(type, payload, { id, correlationId: id }) as never
    )
  );
}

export const externalControl: ExternalControlPreloadApi = {
  async respond(rawResponse) {
    const response = ExternalWindowResponseSchema.parse(rawResponse);
    const id = browserId("cmd_external_window_response");
    await invokeCommand(
      createEnvelope("externalControl.window_response", response, {
        id,
        correlationId: id
      })
    );
  },
  overview: () => settingsCommand("externalControl.overview", {}),
  revokeClient: (name) =>
    settingsCommand("externalControl.revokeClient", { name }),
  restoreTrash: (trashId) =>
    settingsCommand("externalControl.restoreTrash", { trashId }),
  emptyTrash: () => settingsCommand("externalControl.emptyTrash", {}),
  installSkill: (targetId) =>
    settingsCommand("externalControl.installSkill", { targetId })
};
