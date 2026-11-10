import { SCRIPT_AGENT_SYSTEM_PROMPTS } from "./agent-prompts/script";
import { SHORT_AGENT_SYSTEM_PROMPTS } from "./agent-prompts/short";
import { DEFAULT_PROMPT_LOCALE } from "./prompt-locale";

/**
 * Built-in role prompts of the short-form and screenplay agents in the default
 * prompt language. Main serves the variant of the current app language; see
 * `agent-prompts/` for both languages.
 */
export const DEFAULT_SHORT_SYSTEM_PROMPT =
  SHORT_AGENT_SYSTEM_PROMPTS[DEFAULT_PROMPT_LOCALE];

export const DEFAULT_SCRIPT_SYSTEM_PROMPT =
  SCRIPT_AGENT_SYSTEM_PROMPTS[DEFAULT_PROMPT_LOCALE];
