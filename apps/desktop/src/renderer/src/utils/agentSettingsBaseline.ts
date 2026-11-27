import type {
  AcademicAgentSettings,
  AcademicAgentSettingsInput,
  LibraryAgentSettings,
  LibraryAgentSettingsInput,
  LongAgentSettings,
  LongAgentSettingsInput,
  WorkspaceAgentSettings,
  WorkspaceAgentSettingsInput
} from "@deepwrite/contracts";
import { jsonClone } from "@deepwrite/shared";

function cloneBaseline<T>(value: T): T {
  return jsonClone(value);
}

export function editableAgentProfileBaseline<
  T extends { builtin?: boolean | undefined }
>(profiles: readonly T[]): Omit<T, "builtin">[] {
  return cloneBaseline(
    profiles.map(({ builtin: _builtin, ...profile }) => profile)
  );
}

/** The saved form snapshot is independent of reads and saves in other windows. */
export function withWorkspaceAgentBaseline(
  input: WorkspaceAgentSettingsInput,
  settings: WorkspaceAgentSettings | undefined
): WorkspaceAgentSettingsInput {
  if (input.workspaceType === "short" && settings?.workspaceType === "short") {
    return {
      ...input,
      baseAgents: cloneBaseline(
        settings.agents.map(
          ({ id, systemPrompt, welcomeShortcuts, readAccess }) => ({
            id,
            systemPrompt,
            welcomeShortcuts,
            readAccess
          })
        )
      ),
      baseDefaultPlotStageIds: [...settings.defaultPlotStageIds]
    };
  }
  if (
    input.workspaceType === "script" &&
    settings?.workspaceType === "script"
  ) {
    return {
      ...input,
      baseAgents: cloneBaseline(
        settings.agents.map(
          ({ id, systemPrompt, welcomeShortcuts, readAccess }) => ({
            id,
            systemPrompt,
            welcomeShortcuts,
            readAccess
          })
        )
      )
    };
  }
  return input;
}

export function withLongAgentBaseline(
  input: LongAgentSettingsInput,
  settings: LongAgentSettings | null
): LongAgentSettingsInput {
  return settings
    ? {
        ...input,
        baseAgents: cloneBaseline(
          settings.agents.map(
            ({ id, systemPrompt, welcomeShortcuts, readAccess }) => ({
              id,
              systemPrompt,
              welcomeShortcuts,
              readAccess
            })
          )
        )
      }
    : input;
}

export function withAcademicAgentBaseline(
  input: AcademicAgentSettingsInput,
  settings: AcademicAgentSettings | null
): AcademicAgentSettingsInput {
  return settings
    ? {
        ...input,
        baseAgents: cloneBaseline(
          settings.agents.map(
            ({
              id,
              systemPrompt,
              welcomeShortcuts,
              modelMode,
              modelId,
              thinkingLevel,
              temperature
            }) => ({
              id,
              systemPrompt,
              welcomeShortcuts,
              modelMode: modelMode ?? "inherit",
              ...(modelId ? { modelId } : {}),
              ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
              ...(temperature !== undefined ? { temperature } : {})
            })
          )
        )
      }
    : input;
}

export function withLibraryAgentBaseline(
  input: LibraryAgentSettingsInput,
  settings: LibraryAgentSettings | null
): LibraryAgentSettingsInput {
  return settings
    ? {
        ...input,
        baseAgents: cloneBaseline(
          settings.agents.map(({ domain, systemPrompt, readAccess }) => ({
            domain,
            systemPrompt,
            readAccess
          }))
        )
      }
    : input;
}
