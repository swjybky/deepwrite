import {
  CommandEnvelopeSchema,
  createEnvelope,
  AgentTeamCatalogSnapshotSchema,
  AgentTeamPackageExportResultSchema,
  AgentTeamPackageInstallResultSchema,
  AgentTeamProfileCreateInputSchema,
  AgentTeamProfileRenameInputSchema,
  AgentTeamProfileSaveInputSchema,
  AgentTeamProfileSetEnabledInputSchema,
  AgentTeamProfileTargetInputSchema,
  BuiltinSubagentSettingsSchema,
  type BuiltinSubagentSettings,
  type AgentTeamCatalogSnapshot,
  type AgentTeamPackageExportResult,
  type AgentTeamPackageInstallResult,
  type AgentTeamProfileCreateInput,
  type AgentTeamProfileRenameInput,
  type AgentTeamProfileSaveInput,
  type AgentTeamProfileSetEnabledInput,
  type AgentTeamProfileTargetInput
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";
export async function listAgentTeams(): Promise<AgentTeamCatalogSnapshot> {
  const id = browserId("cmd_agent_teams_list");
  return AgentTeamCatalogSnapshotSchema.parse(
    await invokeCommand<AgentTeamCatalogSnapshot>(
      createEnvelope("agentTeams.list", {}, { id, correlationId: id })
    )
  );
}

async function mutateAgentTeams(
  type:
    | "agentTeams.create"
    | "agentTeams.rename"
    | "agentTeams.delete"
    | "agentTeams.setEnabled"
    | "agentTeams.save"
    | "agentTeams.saveBuiltins",
  payload: object
): Promise<AgentTeamCatalogSnapshot> {
  const id = browserId(`cmd_${type.replace(".", "_")}`);
  return AgentTeamCatalogSnapshotSchema.parse(
    await invokeCommand<AgentTeamCatalogSnapshot>(
      CommandEnvelopeSchema.parse(
        createEnvelope(type, payload, { id, correlationId: id })
      )
    )
  );
}

export const createAgentTeam = (input: AgentTeamProfileCreateInput) =>
  mutateAgentTeams(
    "agentTeams.create",
    AgentTeamProfileCreateInputSchema.parse(input)
  );
export const renameAgentTeam = (input: AgentTeamProfileRenameInput) =>
  mutateAgentTeams(
    "agentTeams.rename",
    AgentTeamProfileRenameInputSchema.parse(input)
  );
export const deleteAgentTeam = (input: AgentTeamProfileTargetInput) =>
  mutateAgentTeams(
    "agentTeams.delete",
    AgentTeamProfileTargetInputSchema.parse(input)
  );
export const setAgentTeamEnabled = (input: AgentTeamProfileSetEnabledInput) =>
  mutateAgentTeams(
    "agentTeams.setEnabled",
    AgentTeamProfileSetEnabledInputSchema.parse(input)
  );
export const saveAgentTeams = (input: AgentTeamProfileSaveInput) =>
  mutateAgentTeams(
    "agentTeams.save",
    AgentTeamProfileSaveInputSchema.parse(input)
  );

export async function downloadAgentTeam(
  rawInput: AgentTeamProfileTargetInput
): Promise<AgentTeamPackageExportResult> {
  const payload = AgentTeamProfileTargetInputSchema.parse(rawInput);
  const id = browserId("cmd_agent_teams_export_package");
  return AgentTeamPackageExportResultSchema.parse(
    await invokeCommand<AgentTeamPackageExportResult>(
      CommandEnvelopeSchema.parse(
        createEnvelope("agentTeams.exportPackage", payload, {
          id,
          correlationId: id
        })
      )
    )
  );
}

export async function installAgentTeam(): Promise<AgentTeamPackageInstallResult> {
  const id = browserId("cmd_agent_teams_install_package");
  return AgentTeamPackageInstallResultSchema.parse(
    await invokeCommand<AgentTeamPackageInstallResult>(
      CommandEnvelopeSchema.parse(
        createEnvelope(
          "agentTeams.installPackage",
          {},
          {
            id,
            correlationId: id
          }
        )
      )
    )
  );
}

export const saveBuiltinSubagents = (input: BuiltinSubagentSettings) =>
  mutateAgentTeams(
    "agentTeams.saveBuiltins",
    BuiltinSubagentSettingsSchema.parse(input)
  );
