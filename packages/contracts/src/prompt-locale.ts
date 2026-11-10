import { z } from "zod";

/**
 * Language of the agent system prompts. Main resolves it from the app
 * language setting ("auto" follows the system) and sends it with each run.
 */
export const PROMPT_LOCALES = ["zh-CN", "en-US"] as const;
export const PromptLocaleSchema = z.enum(PROMPT_LOCALES);
export type PromptLocale = z.infer<typeof PromptLocaleSchema>;
export const DEFAULT_PROMPT_LOCALE: PromptLocale = "zh-CN";

/** One text per prompt language. */
export type LocalizedText = Readonly<Record<PromptLocale, string>>;

export function localizedText(
  text: LocalizedText,
  locale: PromptLocale | undefined
): string {
  return text[locale ?? DEFAULT_PROMPT_LOCALE];
}
