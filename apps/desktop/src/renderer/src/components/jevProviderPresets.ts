import { createScopedTranslator } from "../i18n";
import {
  BUILT_IN_REASONING_LEVELS,
  normalizeJevModelIdentity
} from "@deepwrite/contracts";
import type { DraftModel } from "./modelSettingsDraft";

const t = createScopedTranslator("components.jevModelEditorPanel");

export interface JevModelIdPreset {
  id: string;
  /** Floating aliases (`jev-latest`) move with releases, so scores can drift. */
  kind: "pinned" | "latest" | "preview";
}

export interface JevProviderPreset {
  value: string;
  readonly label: string;
  readonly description?: string;
  /** Empty for the custom entry, which keeps whatever the user typed. */
  baseUrl: string;
  modelIds: readonly JevModelIdPreset[];
  /** Whether `GET {root}/models` lists Jev models on this provider. */
  supportsModelList: boolean;
}

export const JEV_CUSTOM_PROVIDER = "jev-custom";

/**
 * Hosts that serve TypeSafe Jev per their public docs (2026-11). AIMLAPI uses
 * `/v1/decisions`; the others use `/v1/systemone` (under `/api` on OpenRouter).
 */
export const JEV_PROVIDER_PRESETS: readonly JevProviderPreset[] = [
  {
    value: "typesafe",
    get label() {
      return t("providerTypeSafe");
    },
    baseUrl: "https://api.typesafe.ai/v1",
    modelIds: [
      { id: "jev-1.14.0", kind: "pinned" },
      { id: "jev-1.13.0", kind: "pinned" },
      { id: "jev-latest", kind: "latest" },
      { id: "jev-preview", kind: "preview" }
    ],
    supportsModelList: true
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    modelIds: [
      { id: "typesafe/jev-1.14", kind: "pinned" },
      { id: "typesafe/jev-1.13", kind: "pinned" },
      { id: "~typesafe/jev-latest", kind: "latest" }
    ],
    supportsModelList: true
  },
  {
    value: "digitalocean",
    label: "DigitalOcean",
    baseUrl: "https://inference.do-ai.run/v1",
    modelIds: [{ id: "typesafe-jev-1.13.0", kind: "pinned" }],
    supportsModelList: false
  },
  {
    value: "abacus",
    label: "Abacus RouteLLM",
    baseUrl: "https://routellm.abacus.ai/v1",
    modelIds: [
      { id: "jev-latest", kind: "latest" },
      { id: "jev-preview", kind: "preview" }
    ],
    supportsModelList: true
  },
  {
    value: "aimlapi",
    label: "AIMLAPI",
    baseUrl: "https://api.aimlapi.com/v1/decisions",
    modelIds: [
      { id: "typesafe/jev-1.14", kind: "pinned" },
      { id: "typesafe/jev-1.13", kind: "pinned" },
      { id: "typesafe/jev", kind: "latest" }
    ],
    supportsModelList: false
  },
  {
    value: JEV_CUSTOM_PROVIDER,
    get label() {
      return t("providerCustom");
    },
    baseUrl: "",
    modelIds: [],
    supportsModelList: true
  }
];

export function findJevProviderPreset(
  provider: string
): JevProviderPreset | undefined {
  return JEV_PROVIDER_PRESETS.find((preset) => preset.value === provider);
}

export function jevModelIdKindLabel(kind: JevModelIdPreset["kind"]): string {
  if (kind === "latest") return t("modelIdLatest");
  if (kind === "preview") return t("modelIdPreview");
  return t("modelIdPinned");
}

/** A fresh JEV draft on the official TypeSafe host with a pinned version. */
export function createJevDraftModel(id: string): DraftModel {
  const typesafe = JEV_PROVIDER_PRESETS[0]!;
  return {
    ...normalizeJevModelIdentity({
      id,
      label: "",
      provider: typesafe.value,
      modelId: typesafe.modelIds[0]!.id,
      api: "openai-completions",
      baseUrl: typesafe.baseUrl,
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: [...BUILT_IN_REASONING_LEVELS],
      temperatureOptions: [0.1, 0.7, 1],
      hasApiKey: false
    }),
    apiKey: ""
  };
}
