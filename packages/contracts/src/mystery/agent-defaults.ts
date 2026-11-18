import { MYSTERY_AGENT_SYSTEM_PROMPTS } from "../agent-prompts/mystery";
import {
  BUILTIN_AGENT_METADATA,
  DEFAULT_MYSTERY_AGENT_WELCOME_SHORTCUTS
} from "../builtin-agent-metadata";
import { DEFAULT_PROMPT_LOCALE } from "../prompt-locale";
import type {
  MysteryAgentId,
  MysteryAgentProfile,
  MysteryAgentSettings
} from "./agent-settings";

export const DEFAULT_MYSTERY_AGENT_PROFILES: readonly MysteryAgentProfile[] = [
  {
    workspaceType: "mystery",
    id: "mystery",
    label: BUILTIN_AGENT_METADATA.mystery.label,
    description: BUILTIN_AGENT_METADATA.mystery.description,
    systemPrompt: MYSTERY_AGENT_SYSTEM_PROMPTS[DEFAULT_PROMPT_LOCALE],
    welcomeShortcuts: [...DEFAULT_MYSTERY_AGENT_WELCOME_SHORTCUTS]
  }
];

export function getDefaultMysteryAgentProfile(
  id: MysteryAgentId = "mystery"
): MysteryAgentProfile {
  const found = DEFAULT_MYSTERY_AGENT_PROFILES.find(
    (profile) => profile.id === id
  );
  if (!found) {
    throw new Error(`Unknown mystery agent id: ${id}`);
  }
  return structuredClone(found);
}

export const DEFAULT_MYSTERY_AGENT_SETTINGS: MysteryAgentSettings = {
  workspaceType: "mystery",
  agents: DEFAULT_MYSTERY_AGENT_PROFILES.map((profile) => ({
    ...profile,
    welcomeShortcuts: [
      profile.welcomeShortcuts[0],
      profile.welcomeShortcuts[1],
      profile.welcomeShortcuts[2]
    ]
  }))
};
