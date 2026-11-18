import type { LocalizedText, PromptLocale } from "../prompt-locale";
import { ACADEMIC_AGENT_SYSTEM_PROMPTS } from "./academic";
import {
  MATERIAL_LIBRARY_AGENT_SYSTEM_PROMPTS,
  SKILL_LIBRARY_AGENT_SYSTEM_PROMPTS
} from "./library";
import { LONG_AGENT_SYSTEM_PROMPTS } from "./long";
import { MYSTERY_AGENT_SYSTEM_PROMPTS } from "./mystery";
import { SCRIPT_AGENT_SYSTEM_PROMPTS } from "./script";
import { SHORT_AGENT_SYSTEM_PROMPTS } from "./short";

export {
  ACADEMIC_AGENT_SYSTEM_PROMPTS,
  LONG_AGENT_SYSTEM_PROMPTS,
  MATERIAL_LIBRARY_AGENT_SYSTEM_PROMPTS,
  MYSTERY_AGENT_SYSTEM_PROMPTS,
  SCRIPT_AGENT_SYSTEM_PROMPTS,
  SHORT_AGENT_SYSTEM_PROMPTS,
  SKILL_LIBRARY_AGENT_SYSTEM_PROMPTS
};

/** The main agents whose editable role prompt follows the app language. */
export const BUILTIN_AGENT_PROMPT_KEYS = [
  "short",
  "script",
  "long",
  "academic",
  "mystery",
  "material",
  "skill"
] as const;
export type BuiltinAgentPromptKey = (typeof BUILTIN_AGENT_PROMPT_KEYS)[number];

export const BUILTIN_AGENT_SYSTEM_PROMPTS: Readonly<
  Record<BuiltinAgentPromptKey, LocalizedText>
> = {
  short: SHORT_AGENT_SYSTEM_PROMPTS,
  script: SCRIPT_AGENT_SYSTEM_PROMPTS,
  long: LONG_AGENT_SYSTEM_PROMPTS,
  academic: ACADEMIC_AGENT_SYSTEM_PROMPTS,
  mystery: MYSTERY_AGENT_SYSTEM_PROMPTS,
  material: MATERIAL_LIBRARY_AGENT_SYSTEM_PROMPTS,
  skill: SKILL_LIBRARY_AGENT_SYSTEM_PROMPTS
};

export function builtinAgentSystemPrompt(
  key: BuiltinAgentPromptKey,
  locale: PromptLocale
): string {
  return BUILTIN_AGENT_SYSTEM_PROMPTS[key][locale];
}
