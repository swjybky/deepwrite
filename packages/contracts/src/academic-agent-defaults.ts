import { ACADEMIC_AGENT_SYSTEM_PROMPTS } from "./agent-prompts";
import {
  BUILTIN_AGENT_METADATA,
  DEFAULT_ACADEMIC_AGENT_WELCOME_SHORTCUTS
} from "./builtin-agent-metadata";
import type {
  AcademicAgentId,
  AcademicAgentProfile,
  AcademicAgentSettings
} from "./academic-agent-settings";

export const DEFAULT_ACADEMIC_AGENT_PROFILES: readonly AcademicAgentProfile[] =
  [
    {
      workspaceType: "academic",
      id: "academic",
      label: BUILTIN_AGENT_METADATA.academic.label,
      description: BUILTIN_AGENT_METADATA.academic.description,
      systemPrompt: ACADEMIC_AGENT_SYSTEM_PROMPTS["zh-CN"],
      welcomeShortcuts: [...DEFAULT_ACADEMIC_AGENT_WELCOME_SHORTCUTS],
      modelMode: "inherit",
      builtin: true
    }
  ];

export function getDefaultAcademicAgentProfile(
  id: AcademicAgentId = "academic"
): AcademicAgentProfile {
  return (
    DEFAULT_ACADEMIC_AGENT_PROFILES.find((profile) => profile.id === id) ??
    DEFAULT_ACADEMIC_AGENT_PROFILES[0]!
  );
}

export const DEFAULT_ACADEMIC_AGENT_SETTINGS: AcademicAgentSettings = {
  workspaceType: "academic",
  agents: DEFAULT_ACADEMIC_AGENT_PROFILES.map((profile) => ({
    ...profile,
    welcomeShortcuts: [
      profile.welcomeShortcuts[0],
      profile.welcomeShortcuts[1],
      profile.welcomeShortcuts[2]
    ]
  }))
};
