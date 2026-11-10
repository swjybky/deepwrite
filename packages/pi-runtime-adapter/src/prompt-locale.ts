import { DEFAULT_PROMPT_LOCALE, type PromptLocale } from "@deepwrite/contracts";

/** The run's system prompt language; runs without one keep Chinese. */
export function promptLocaleOf(input: {
  promptLocale?: PromptLocale | undefined;
}): PromptLocale {
  return input.promptLocale ?? DEFAULT_PROMPT_LOCALE;
}

export function isEnglishPrompt(locale: PromptLocale | undefined): boolean {
  return locale === "en-US";
}

/** Joins tool or item names the way each language lists them. */
export function joinNames(
  names: readonly string[],
  locale: PromptLocale | undefined
): string {
  return names.join(isEnglishPrompt(locale) ? ", " : "、");
}
