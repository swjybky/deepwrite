import {
  AcademicAgentIdSchema,
  AcademicAgentSettingsInputSchema,
  AcademicAgentSettingsSchema,
  ExportAcademicManuscriptInputSchema,
  ExportAcademicManuscriptResultSchema,
  ExportLongManuscriptInputSchema,
  ExportLongManuscriptResultSchema,
  ExportShortManuscriptInputSchema,
  ExportShortManuscriptResultSchema,
  GeneralSettingsSchema,
  GeneralSettingsSnapshotSchema,
  LibraryAgentDomainSchema,
  LibraryAgentSettingsInputSchema,
  LibraryAgentSettingsSchema,
  LongAgentIdSchema,
  LongAgentSettingsInputSchema,
  LongAgentSettingsSchema,
  ScriptWorkspaceAgentIdSchema,
  ShortWorkspaceAgentIdSchema,
  WorkspaceAgentSettingsInputSchema,
  WorkspaceAgentSettingsSchema,
  WorkspaceDirectorySettingsSchema,
  WorkspaceTypeSchema,
  createEnvelope,
  type AcademicAgentId,
  type AcademicAgentSettings,
  type AcademicAgentSettingsInput,
  type ExportAcademicManuscriptInput,
  type ExportAcademicManuscriptResult,
  type ExportLongManuscriptInput,
  type ExportLongManuscriptResult,
  type ExportShortManuscriptInput,
  type ExportShortManuscriptResult,
  type GeneralSettings,
  type GeneralSettingsSnapshot,
  type LibraryAgentDomain,
  type LibraryAgentSettings,
  type LibraryAgentSettingsInput,
  type LongAgentId,
  type LongAgentSettings,
  type LongAgentSettingsInput,
  type ScriptWorkspaceAgentId,
  type ShortWorkspaceAgentId,
  type WorkspaceAgentSettings,
  type WorkspaceAgentSettingsInput,
  type WorkspaceDirectorySettings,
  type WorkspaceType
} from "@deepwrite/contracts";

import { browserId, invokeCommand } from "./invoke";

export {
  appearance,
  installAppearanceFonts,
  listAppearance,
  listAppearanceFonts,
  removeAppearanceFont,
  saveAppearance
} from "./appearance-api";

export async function listWorkspaceAgents(
  rawWorkspaceType: WorkspaceType
): Promise<WorkspaceAgentSettings> {
  const workspaceType = WorkspaceTypeSchema.parse(rawWorkspaceType);
  const id = browserId("cmd_workspace_agents_list");
  return WorkspaceAgentSettingsSchema.parse(
    await invokeCommand<WorkspaceAgentSettings>(
      createEnvelope(
        "workspaceAgents.list",
        { workspaceType },
        { id, correlationId: id }
      )
    )
  );
}
export async function listLongAgents(): Promise<LongAgentSettings> {
  const id = browserId("cmd_long_agents_list");
  return LongAgentSettingsSchema.parse(
    await invokeCommand<LongAgentSettings>(
      createEnvelope("longAgents.list", {}, { id, correlationId: id })
    )
  );
}
export async function saveLongAgents(
  rawSettings: LongAgentSettingsInput
): Promise<LongAgentSettings> {
  const settings = LongAgentSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_long_agents_save");
  return LongAgentSettingsSchema.parse(
    await invokeCommand<LongAgentSettings>(
      createEnvelope("longAgents.save", settings, {
        id,
        correlationId: id
      })
    )
  );
}
export async function resetLongAgents(
  rawAgentId?: LongAgentId
): Promise<LongAgentSettings> {
  const agentId = rawAgentId ? LongAgentIdSchema.parse(rawAgentId) : undefined;
  const id = browserId("cmd_long_agents_reset");
  return LongAgentSettingsSchema.parse(
    await invokeCommand<LongAgentSettings>(
      createEnvelope(
        "longAgents.reset",
        { ...(agentId ? { agentId } : {}) },
        { id, correlationId: id }
      )
    )
  );
}
export async function listAcademicAgents(): Promise<AcademicAgentSettings> {
  const id = browserId("cmd_academic_agents_list");
  return AcademicAgentSettingsSchema.parse(
    await invokeCommand<AcademicAgentSettings>(
      createEnvelope("academicAgents.list", {}, { id, correlationId: id })
    )
  );
}
export async function saveAcademicAgents(
  rawSettings: AcademicAgentSettingsInput
): Promise<AcademicAgentSettings> {
  const settings = AcademicAgentSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_academic_agents_save");
  return AcademicAgentSettingsSchema.parse(
    await invokeCommand<AcademicAgentSettings>(
      createEnvelope("academicAgents.save", settings, {
        id,
        correlationId: id
      })
    )
  );
}
export async function resetAcademicAgents(
  rawAgentId?: AcademicAgentId
): Promise<AcademicAgentSettings> {
  const agentId = rawAgentId
    ? AcademicAgentIdSchema.parse(rawAgentId)
    : undefined;
  const id = browserId("cmd_academic_agents_reset");
  return AcademicAgentSettingsSchema.parse(
    await invokeCommand<AcademicAgentSettings>(
      createEnvelope(
        "academicAgents.reset",
        { ...(agentId ? { agentId } : {}) },
        { id, correlationId: id }
      )
    )
  );
}
export async function saveWorkspaceAgents(
  rawSettings: WorkspaceAgentSettingsInput
): Promise<WorkspaceAgentSettings> {
  const settings = WorkspaceAgentSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_workspace_agents_save");
  return WorkspaceAgentSettingsSchema.parse(
    await invokeCommand<WorkspaceAgentSettings>(
      createEnvelope("workspaceAgents.save", settings, {
        id,
        correlationId: id
      })
    )
  );
}

export async function resetWorkspaceAgents(
  rawWorkspaceType: WorkspaceType,
  rawAgentId?: ShortWorkspaceAgentId | ScriptWorkspaceAgentId
): Promise<WorkspaceAgentSettings> {
  const workspaceType = WorkspaceTypeSchema.parse(rawWorkspaceType);
  const agentId = rawAgentId
    ? workspaceType === "script"
      ? ScriptWorkspaceAgentIdSchema.parse(rawAgentId)
      : ShortWorkspaceAgentIdSchema.parse(rawAgentId)
    : undefined;
  const id = browserId("cmd_workspace_agents_reset");
  const payload =
    workspaceType === "script"
      ? {
          workspaceType,
          ...(agentId
            ? { agentId: ScriptWorkspaceAgentIdSchema.parse(agentId) }
            : {})
        }
      : {
          workspaceType,
          ...(agentId
            ? { agentId: ShortWorkspaceAgentIdSchema.parse(agentId) }
            : {})
        };
  return WorkspaceAgentSettingsSchema.parse(
    await invokeCommand<WorkspaceAgentSettings>(
      createEnvelope("workspaceAgents.reset", payload, {
        id,
        correlationId: id
      })
    )
  );
}

export async function listLibraryAgents(): Promise<LibraryAgentSettings> {
  const id = browserId("cmd_library_agents_list");
  return LibraryAgentSettingsSchema.parse(
    await invokeCommand<LibraryAgentSettings>(
      createEnvelope("libraryAgents.list", {}, { id, correlationId: id })
    )
  );
}

export async function saveLibraryAgents(
  rawSettings: LibraryAgentSettingsInput
): Promise<LibraryAgentSettings> {
  const settings = LibraryAgentSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_library_agents_save");
  return LibraryAgentSettingsSchema.parse(
    await invokeCommand<LibraryAgentSettings>(
      createEnvelope("libraryAgents.save", settings, { id, correlationId: id })
    )
  );
}

export async function resetLibraryAgents(
  rawDomain?: LibraryAgentDomain
): Promise<LibraryAgentSettings> {
  const domain = rawDomain
    ? LibraryAgentDomainSchema.parse(rawDomain)
    : undefined;
  const id = browserId("cmd_library_agents_reset");
  return LibraryAgentSettingsSchema.parse(
    await invokeCommand<LibraryAgentSettings>(
      createEnvelope(
        "libraryAgents.reset",
        { ...(domain ? { domain } : {}) },
        { id, correlationId: id }
      )
    )
  );
}

export async function listWorkspaceDirectory(): Promise<WorkspaceDirectorySettings> {
  const id = browserId("cmd_workspace_directory_list");
  return WorkspaceDirectorySettingsSchema.parse(
    await invokeCommand<WorkspaceDirectorySettings>(
      createEnvelope("workspaceDirectory.list", {}, { id, correlationId: id })
    )
  );
}

export async function chooseWorkspaceDirectory(): Promise<WorkspaceDirectorySettings | null> {
  const id = browserId("cmd_workspace_directory_choose");
  return WorkspaceDirectorySettingsSchema.nullable().parse(
    await invokeCommand<WorkspaceDirectorySettings | null>(
      createEnvelope("workspaceDirectory.choose", {}, { id, correlationId: id })
    )
  );
}

export async function listGeneralSettings(): Promise<GeneralSettingsSnapshot> {
  const id = browserId("cmd_general_settings_list");
  return GeneralSettingsSnapshotSchema.parse(
    await invokeCommand<GeneralSettingsSnapshot>(
      createEnvelope("generalSettings.list", {}, { id, correlationId: id })
    )
  );
}

export async function saveGeneralSettings(
  rawSettings: GeneralSettings
): Promise<GeneralSettingsSnapshot> {
  const settings = GeneralSettingsSchema.parse(rawSettings);
  const id = browserId("cmd_general_settings_save");
  return GeneralSettingsSnapshotSchema.parse(
    await invokeCommand<GeneralSettingsSnapshot>(
      createEnvelope("generalSettings.save", settings, {
        id,
        correlationId: id
      })
    )
  );
}

export async function exportAcademicManuscript(
  rawInput: ExportAcademicManuscriptInput
): Promise<ExportAcademicManuscriptResult> {
  const input = ExportAcademicManuscriptInputSchema.parse(rawInput);
  const id = browserId("cmd_manuscript_export_academic");
  return ExportAcademicManuscriptResultSchema.parse(
    await invokeCommand<ExportAcademicManuscriptResult>(
      createEnvelope("manuscript.exportAcademic", input, {
        id,
        correlationId: id
      })
    )
  );
}

export async function exportShortManuscript(
  rawInput: ExportShortManuscriptInput
): Promise<ExportShortManuscriptResult> {
  const input = ExportShortManuscriptInputSchema.parse(rawInput);
  const id = browserId("cmd_manuscript_export_short");
  return ExportShortManuscriptResultSchema.parse(
    await invokeCommand<ExportShortManuscriptResult>(
      createEnvelope("manuscript.exportShort", input, {
        id,
        correlationId: id
      })
    )
  );
}

export async function exportLongManuscript(
  rawInput: ExportLongManuscriptInput
): Promise<ExportLongManuscriptResult> {
  const input = ExportLongManuscriptInputSchema.parse(rawInput);
  const id = browserId("cmd_manuscript_export_long");
  return ExportLongManuscriptResultSchema.parse(
    await invokeCommand<ExportLongManuscriptResult>(
      createEnvelope("manuscript.exportLong", input, {
        id,
        correlationId: id
      })
    )
  );
}

export {
  listAgentTeams,
  createAgentTeam,
  renameAgentTeam,
  deleteAgentTeam,
  setAgentTeamEnabled,
  saveAgentTeams,
  downloadAgentTeam,
  installAgentTeam,
  saveBuiltinSubagents
} from "./agent-teams-api";
