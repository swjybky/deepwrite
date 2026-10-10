import type { AppLanguage } from "@deepwrite/contracts";
import { createI18n } from "vue-i18n";
import { resolveAppLocale } from "../../../localization/locale";
import type { MessageSchema, TranslationKey } from "./messages";
import type { AppLocale } from "../../../localization/locale";
import foundationZh from "./messages/foundation/zh-CN";
import foundationEn from "./messages/foundation/en-US";

export const i18n = createI18n({
  legacy: false,
  globalInjection: false,
  locale: "zh-CN",
  fallbackLocale: "zh-CN",
  messages: {
    "zh-CN": { foundation: foundationZh } as MessageSchema,
    "en-US": { foundation: foundationEn } as MessageSchema
  }
});

type FeatureCatalog = Record<string, string>;
const featureCatalogs: {
  scope: string;
  catalogs: Partial<Record<AppLocale, FeatureCatalog>>;
}[] = [];

function mergeFeatureCatalog(
  language: AppLocale,
  scope: string,
  messages: FeatureCatalog
): void {
  const nested = scope
    .split(".")
    .reduceRight<unknown>((value, part) => ({ [part]: value }), messages);
  i18n.global.mergeLocaleMessage(language, nested as never);
}

export function registerMessageCatalog(
  language: AppLocale,
  messages: MessageSchema
): void {
  i18n.global.setLocaleMessage(language, messages);
  // Replacing the catalog must not drop strings a loaded feature added.
  for (const { scope, catalogs } of featureCatalogs) {
    const feature = catalogs[language];
    if (feature) mergeFeatureCatalog(language, scope, feature);
  }
}

/**
 * Messages that only a lazily loaded feature uses. They ship in the feature's
 * chunk and are merged under `scope` when it loads, so they do not add to
 * the language data every window downloads at startup.
 */
export function registerFeatureMessages<M extends FeatureCatalog>(
  scope: string,
  catalogs: Record<AppLocale, M>
): (key: keyof M & string, params?: Record<string, string | number>) => string {
  featureCatalogs.push({ scope, catalogs });
  for (const [language, messages] of Object.entries(catalogs) as [
    AppLocale,
    M
  ][])
    mergeFeatureCatalog(language, scope, messages);
  return (key, params) =>
    params
      ? i18n.global.t(`${scope}.${key}`, params)
      : i18n.global.t(`${scope}.${key}`);
}

export const locale = i18n.global.locale;

/** Also usable in computed values, stores, and event-driven notifications. */
export function t(
  key: TranslationKey,
  params?: Record<string, string | number>
): string {
  return params ? i18n.global.t(key, params) : i18n.global.t(key);
}

export function setAppLanguage(
  language: AppLanguage,
  systemLocale: string
): void {
  locale.value = resolveAppLocale(language, systemLocale);
}

type Namespace<Key extends string> = Key extends `${infer Head}.${infer Tail}`
  ? Head | `${Head}.${Namespace<Tail>}`
  : never;
type ScopedKey<Scope extends string> = TranslationKey extends infer Key
  ? Key extends `${Scope}.${infer Relative}`
    ? Relative
    : never
  : never;

/** Keep semantic keys typed while avoiding repeated domain prefixes per module. */
export function createScopedTranslator<Scope extends Namespace<TranslationKey>>(
  scope: Scope
): (key: ScopedKey<Scope>, params?: Record<string, string | number>) => string {
  return (key, params) => t(`${scope}.${key}` as TranslationKey, params);
}
