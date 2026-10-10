<script setup lang="ts">
import { createScopedTranslator, locale } from "../i18n";
import {
  libraryPackageKinds,
  resolveLibraryPackageStage
} from "@deepwrite/contracts/renderer";
import type {
  LibraryPackageDomain,
  LibraryPackagePreviewLibrary,
  MaterialLibraryKind,
  MaterialStageId,
  SkillKind,
  SkillStageId
} from "@deepwrite/contracts";
import { computed } from "vue";
import {
  MATERIAL_KIND_LABELS,
  MATERIAL_STAGE_LABELS,
  SKILL_KIND_LABELS,
  SKILL_STAGE_LABELS
} from "../data/catalogWorkspace";
import PopupSelect from "./PopupSelect.vue";

const t = createScopedTranslator("components.importLibraryPackageDialog");

const props = defineProps<{
  domain: LibraryPackageDomain;
  library: LibraryPackagePreviewLibrary;
  include: boolean;
  title: string;
  kind: string;
  /** The title Core will use when another library already has this one. */
  plannedTitle: string;
  disabled: boolean;
}>();

const emit = defineEmits<{
  "update:include": [value: boolean];
  "update:title": [value: string];
  "update:kind": [value: string];
}>();

function kindLabel(kind: string): string {
  return props.domain === "material"
    ? (MATERIAL_KIND_LABELS[kind as MaterialLibraryKind] ?? kind)
    : (SKILL_KIND_LABELS[kind as SkillKind] ?? kind);
}

const kindOptions = computed(() =>
  libraryPackageKinds(props.domain).map((value) => ({
    value,
    label: kindLabel(value)
  }))
);

/** Where entries land for the chosen kind, e.g. "剧情设计 9 · 剧情细化 18". */
const stageSummary = computed(() => {
  const counts = new Map<string, number>();
  for (const { hint, count } of props.library.stageHints) {
    const stage = resolveLibraryPackageStage(
      props.domain,
      props.kind,
      hint ?? undefined
    );
    counts.set(stage, (counts.get(stage) ?? 0) + count);
  }
  if (counts.size < 2) return "";
  return [...counts]
    .map(([stage, count]) => {
      const label =
        props.domain === "material"
          ? MATERIAL_STAGE_LABELS[stage as MaterialStageId]
          : SKILL_STAGE_LABELS[stage as SkillStageId];
      return `${label} ${count}`;
    })
    .join(" · ");
});

const size = computed(() => {
  const bytes = props.library.contentBytes;
  return bytes < 1024 * 1024
    ? t("sizeKB", { value: Math.max(1, Math.ceil(bytes / 1024)) })
    : t("sizeMB", {
        value: (bytes / 1024 / 1024).toLocaleString(locale.value, {
          maximumFractionDigits: 1
        })
      });
});

const blocked = computed(() => props.library.blocked !== null);
const note = computed(() =>
  blocked.value
    ? t("blockedBytes")
    : props.include && props.plannedTitle !== props.title.trim()
      ? t("willRename", { title: props.plannedTitle })
      : ""
);
</script>

<template>
  <div class="package-library-row" :class="{ 'is-excluded': !include }">
    <input
      type="checkbox"
      :checked="include"
      :disabled="disabled || blocked"
      :aria-label="t('includeLibrary', { title: library.title })"
      @change="
        emit('update:include', ($event.target as HTMLInputElement).checked)
      "
    />
    <div class="package-library-main">
      <input
        class="package-library-title"
        type="text"
        maxlength="256"
        :value="title"
        :disabled="disabled || !include"
        :aria-label="t('libraryTitle')"
        @input="emit('update:title', ($event.target as HTMLInputElement).value)"
      />
      <span class="package-library-meta">
        {{ t("entryCount", { count: library.entryCount }) }} · {{ size }}
        <template v-if="stageSummary"> · {{ stageSummary }}</template>
      </span>
      <span v-if="note" class="package-library-note">{{ note }}</span>
    </div>
    <PopupSelect
      v-if="library.kindEditable"
      class="package-library-kind"
      :model-value="kind"
      :options="kindOptions"
      :accessible-label="t('libraryKind')"
      :disabled="disabled || !include"
      size="small"
      align="end"
      @update:model-value="emit('update:kind', String($event))"
    />
    <span v-else class="package-library-kind is-fixed">{{
      kindLabel(kind)
    }}</span>
  </div>
</template>

<style scoped>
.package-library-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--theme-line-soft);
}

.package-library-row:last-child {
  border-bottom: 0;
}

.package-library-row > input[type="checkbox"] {
  margin-top: 8px;
}

.package-library-row.is-excluded .package-library-main {
  opacity: 0.55;
}

.package-library-main {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.package-library-title {
  width: 100%;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--theme-line);
  border-radius: 7px;
  color: var(--text-primary);
  background: var(--surface-raised);
  font: inherit;
  font-size: 0.785714rem;
}

.package-library-title:focus {
  border-color: var(--accent);
  outline: none;
}

.package-library-meta,
.package-library-note {
  color: var(--text-tertiary);
  font-size: 0.678571rem;
  line-height: 1.5;
}

.package-library-note {
  color: var(--text-secondary);
}

.package-library-kind {
  min-width: 132px;
}

.package-library-kind.is-fixed {
  padding-top: 6px;
  color: var(--text-secondary);
  font-size: 0.75rem;
  text-align: right;
}
</style>
