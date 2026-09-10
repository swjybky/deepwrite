import {
  ExportLongManuscriptInputSchema,
  ExportLongManuscriptResultSchema,
  ExportShortManuscriptInputSchema,
  ExportShortManuscriptResultSchema,
  GeneralSettingsSchema,
  GeneralSettingsSnapshotSchema,
  LearningImitationSettingsInputSchema,
  LearningImitationSettingsSchema,
  LearningImitationStageIdSchema,
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
  type ExportLongManuscriptInput,
  type ExportLongManuscriptResult,
  type ExportShortManuscriptInput,
  type ExportShortManuscriptResult,
  type GeneralSettings,
  type GeneralSettingsSnapshot,
  type LearningImitationSettings,
  type LearningImitationSettingsInput,
  type LearningImitationStageId,
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

export async function listLearningImitationSettings(): Promise<LearningImitationSettings> {
  const id = browserId("cmd_learning_imitation_settings_list");
  return LearningImitationSettingsSchema.parse(
    await invokeCommand<LearningImitationSettings>(
      createEnvelope(
        "learningImitationSettings.list",
        {},
        { id, correlationId: id }
      )
    )
  );
}

export async function saveLearningImitationSettings(
  rawSettings: LearningImitationSettingsInput
): Promise<LearningImitationSettings> {
  const settings = LearningImitationSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_learning_imitation_settings_save");
  return LearningImitationSettingsSchema.parse(
    await invokeCommand<LearningImitationSettings>(
      createEnvelope("learningImitationSettings.save", settings, {
        id,
        correlationId: id
      })
    )
  );
}

export async function resetLearningImitationSettings(
  rawStageId?: LearningImitationStageId
): Promise<LearningImitationSettings> {
  const stageId = rawStageId
    ? LearningImitationStageIdSchema.parse(rawStageId)
    : undefined;
  const id = browserId("cmd_learning_imitation_settings_reset");
  return LearningImitationSettingsSchema.parse(
    await invokeCommand<LearningImitationSettings>(
      createEnvelope(
        "learningImitationSettings.reset",
        { ...(stageId ? { stageId } : {}) },
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
