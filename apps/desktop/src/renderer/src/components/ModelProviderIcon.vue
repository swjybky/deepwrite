<script setup lang="ts">
import { computed } from "vue";

type ProviderIconKind =
  | "official"
  | "free"
  | "default"
  | "anthropic"
  | "google"
  | "openai"
  | "deepseek"
  | "qwen"
  | "kimi"
  | "zhipu"
  | "volcengine"
  | "minimax"
  | "xiaomi"
  | "ollama"
  | "openrouter"
  | "opencode"
  | "generic";

const props = withDefaults(
  defineProps<{
    groupKey?: string | undefined;
    provider?: string | undefined;
    modelId?: string | undefined;
    label?: string | undefined;
    size?: number;
  }>(),
  {
    groupKey: undefined,
    provider: undefined,
    modelId: undefined,
    label: undefined,
    size: 16
  }
);

function matchFamilyByText(text: string): ProviderIconKind | null {
  if (!text) return null;
  if (text.includes("claude") || text.includes("anthropic")) return "anthropic";
  if (text.includes("gemini") || text.includes("google")) return "google";
  if (
    text.includes("openai") ||
    /\bgpt\b/.test(text) ||
    /\bgpt[-_.\d]/.test(text) ||
    /\bo[134](?:[-_.\s]|$)/.test(text)
  ) {
    return "openai";
  }
  if (text.includes("deepseek")) return "deepseek";
  if (text.includes("qwen") || text.includes("dashscope")) return "qwen";
  if (text.includes("kimi") || text.includes("moonshot")) return "kimi";
  if (
    text.includes("glm") ||
    text.includes("zhipu") ||
    text.includes("zai-coding")
  ) {
    return "zhipu";
  }
  if (
    text.includes("doubao") ||
    text.includes("volcengine") ||
    text.includes("ark")
  ) {
    return "volcengine";
  }
  if (text.includes("minimax")) return "minimax";
  if (text.includes("mimo") || text.includes("xiaomi")) return "xiaomi";
  if (text.includes("ollama")) return "ollama";
  if (text.includes("openrouter")) return "openrouter";
  if (text.includes("opencode")) return "opencode";
  return null;
}

function resolveProviderKind(value: string): ProviderIconKind | null {
  const normalized = value.replace(/^custom:/, "").toLowerCase();
  if (normalized === "official") return "official";
  if (normalized === "free") return "free";
  if (normalized === "default") return "default";
  return matchFamilyByText(normalized);
}

const iconKind = computed<ProviderIconKind>(() => {
  const provider = props.provider?.toLowerCase() ?? "";
  const groupKey = props.groupKey?.toLowerCase() ?? "";

  const familyText =
    `${props.modelId ?? ""} ${props.label ?? ""}`.toLowerCase();
  const isCatalogAggregator =
    provider === "deepwrite-site" ||
    provider === "openrouter" ||
    provider === "custom" ||
    groupKey === "official" ||
    groupKey === "free";

  if (isCatalogAggregator) {
    const matched = matchFamilyByText(familyText);
    if (matched) return matched;
  }

  return (
    resolveProviderKind(provider) ??
    resolveProviderKind(groupKey) ??
    matchFamilyByText(familyText) ??
    "generic"
  );
});
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="iconKind === 'official'">
      <path
        d="M12 3.2 14.3 9.7 20.8 12 14.3 14.3 12 20.8 9.7 14.3 3.2 12 9.7 9.7Z"
      />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="iconKind === 'free'">
      <path
        d="M19.5 4.5c-4.8.4-9.1 3.1-11.5 7.4L5 19l7.1-3c4.3-2.4 7-6.7 7.4-11.5Z"
      />
      <path d="M9.5 14.5 4.5 19.5M12 9.5l2.5 2.5" />
    </template>
    <template v-else-if="iconKind === 'default'">
      <path d="M9.5 14.5 14.5 9.5" />
      <path d="M13 6.5 14.8 4.7a3.2 3.2 0 0 1 4.5 4.5L17.5 11" />
      <path d="M11 17.5 9.2 19.3a3.2 3.2 0 0 1-4.5-4.5L6.5 13" />
    </template>
    <template v-else-if="iconKind === 'anthropic'">
      <path d="M12 3.5v17M4.6 7.8l14.8 8.4M19.4 7.8 4.6 16.2" />
      <path d="M8.5 4.6 15.5 19.4M15.5 4.6 8.5 19.4" stroke-width="1.5" />
    </template>
    <template v-else-if="iconKind === 'google'">
      <path
        d="M12 3.5c.8 4.8 3.7 7.7 8.5 8.5-4.8.8-7.7 3.7-8.5 8.5-.8-4.8-3.7-7.7-8.5-8.5 4.8-.8 7.7-3.7 8.5-8.5Z"
      />
    </template>
    <template v-else-if="iconKind === 'openai'">
      <circle cx="12" cy="12" r="3.2" />
      <path
        d="M12 3.5a3.8 3.8 0 0 1 3.6 5.1M19.4 7.8a3.8 3.8 0 0 1-1.3 6.1M19.4 16.2a3.8 3.8 0 0 1-5.8 1.4M12 20.5a3.8 3.8 0 0 1-3.6-5.1M4.6 16.2a3.8 3.8 0 0 1 1.3-6.1M4.6 7.8a3.8 3.8 0 0 1 5.8-1.4"
      />
    </template>
    <template v-else-if="iconKind === 'deepseek'">
      <path
        d="M4.5 13.8c1.7 3 5.2 4.7 8.9 4.2 3.4-.5 6.1-3.2 6.4-6.7.2-2.2-1.1-4.1-3.1-4.3-2-.2-3.4 1.3-4.2 3-.8-1.7-2.2-2.6-3.9-2.2-2 .5-3.2 2.4-4.1 6Z"
      />
      <circle cx="15.2" cy="10.8" r="1" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="iconKind === 'qwen'">
      <circle cx="11.5" cy="11.5" r="6.8" />
      <path d="M16 16l4 4" />
      <path d="M11.5 8.3v6.4M8.3 11.5h6.4" stroke-width="1.5" />
    </template>
    <template v-else-if="iconKind === 'kimi'">
      <path d="M15.8 4.8a7.8 7.8 0 1 0 3.4 13.1 6.4 6.4 0 0 1-3.4-13.1Z" />
      <circle cx="17.8" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="iconKind === 'zhipu'">
      <polygon points="12,3.5 19.5,7.8 19.5,16.2 12,20.5 4.5,16.2 4.5,7.8" />
      <path d="M8.8 8.8h6.4l-6.4 6.4h6.4" />
    </template>
    <template v-else-if="iconKind === 'volcengine'">
      <path d="M4.5 17 12 4.5 19.5 17H4.5Z" />
      <path d="m8.2 17 3.8-6.2 3.8 6.2" />
    </template>
    <template v-else-if="iconKind === 'minimax'">
      <path d="M4 16.5V8.5l4 4.5 4-4.5 4 4.5 4-4.5v8" />
    </template>
    <template v-else-if="iconKind === 'xiaomi'">
      <rect x="4" y="4" width="16" height="16" rx="4.5" />
      <path
        d="M8.2 15.5v-5a2 2 0 0 1 2-2h2.2a2 2 0 0 1 2 2v5M11.3 11.5v4M16.2 8.5v7"
      />
    </template>
    <template v-else-if="iconKind === 'ollama'">
      <rect x="6.5" y="7" width="11" height="12.5" rx="5.5" />
      <path
        d="M9 7.5V4.8a1.2 1.2 0 0 1 2.2-.6L12 5.8l.8-1.6A1.2 1.2 0 0 1 15 4.8v2.7"
      />
      <circle cx="10" cy="12" r=".9" fill="currentColor" stroke="none" />
      <circle cx="14" cy="12" r=".9" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="iconKind === 'openrouter'">
      <circle cx="6" cy="12" r="2" />
      <circle cx="18" cy="6.5" r="2" />
      <circle cx="18" cy="17.5" r="2" />
      <path d="M8 11.2 16 7.3M8 12.8l8 3.9" />
    </template>
    <template v-else-if="iconKind === 'opencode'">
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path
        d="m8.5 9.5-2.5 2.5 2.5 2.5M15.5 9.5 18 12l-2.5 2.5M13 8.8 11 15.2"
      />
    </template>
    <template v-else>
      <path d="m12 3 7 4v10l-7 4-7-4V7z" />
      <path d="m5 7 7 4 7-4M12 11v10" />
    </template>
  </svg>
</template>
