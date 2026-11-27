<script setup lang="ts">
import { uiConfirm } from "../../ui-confirm";
import { presetLabel } from "../analysis-ui/preset-labels";
import { createScopedTranslator } from "../../i18n";
import { computed, nextTick, ref, useId, watch } from "vue";
import type { LongBookAnalysisPreset } from "@deepwrite/contracts/renderer";
import { createId } from "@deepwrite/shared";
import PresetManagerShell from "../analysis-ui/PresetManagerShell.vue";
import PresetEditor from "./PresetEditor.vue";
import { uiMessage } from "../../ui-feedback";
import {
  MATERIAL_KIND_LABELS,
  SKILL_KIND_LABELS
} from "../../data/catalogWorkspace";
import { usePresetDraft } from "../analysis-ui/usePresetDraft";
import { cloneLongBookAnalysisPreset } from "./preset-draft";

const t = createScopedTranslator("extras");

const props = defineProps<{
  short?: boolean;
  open: boolean;
  presets: readonly LongBookAnalysisPreset[];
  saving: boolean;
  loadDefaults: () => Promise<PresetDraft[]>;
}>();
const emit = defineEmits<{
  close: [];
  save: [presets: LongBookAnalysisPreset[]];
}>();

type PresetDraft = LongBookAnalysisPreset & {
  selectionMode?: "single" | "multiple";
};
const shell = ref<InstanceType<typeof PresetManagerShell> | null>(null);
const { draft, dirty, resetting, reset, snapshot } =
  usePresetDraft<PresetDraft>({
    open: () => props.open,
    presets: () => props.presets,
    loadDefaults: () => props.loadDefaults()
  });
const busy = computed(() => props.saving || resetting.value);
const expandedId = ref<string | null>(null);
const editorId = useId();
const draggedIndex = ref<number | null>(null);

watch(
  () => props.open,
  () => {
    expandedId.value = null;
    draggedIndex.value = null;
  },
  { immediate: true }
);

function addPreset(): void {
  if (draft.value.length >= 50) {
    uiMessage.warning(t("longBookAnalysis.maxPresets"));
    return;
  }
  const id = createId("analysis_preset");
  draft.value.push({
    ...(props.short ? { selectionMode: "single" as const } : {}),
    id,
    name: t("longBookAnalysis.newPresetName", {
      number: draft.value.length + 1
    }),
    description: props.short
      ? t("longBookAnalysis.shortPresetDescription")
      : t("longBookAnalysis.longPresetDescription"),
    systemPrompt: props.short
      ? t("longBookAnalysis.shortPresetPrompt")
      : t("longBookAnalysis.longPresetPrompt"),
    output: { domain: "material", kind: "other", stageId: "other" }
  });
  void editPreset(id);
}

function copyPreset(index: number): void {
  const current = draft.value[index];
  if (!current || draft.value.length >= 50) return;
  const id = createId("analysis_preset");
  draft.value.splice(index + 1, 0, {
    ...cloneLongBookAnalysisPreset(current),
    id,
    name: t("longBookAnalysis.copyName", { name: presetLabel(current) }),
    builtin: false
  });
  void editPreset(id);
}

async function removePreset(index: number): Promise<void> {
  const current = draft.value[index];
  if (!current) return;
  if (
    !(await uiConfirm({
      message: t("longBookAnalysis.deletePresetConfirmation", {
        name: presetLabel(current)
      }),
      danger: true
    }))
  )
    return;
  draft.value.splice(index, 1);
  if (expandedId.value === current.id) expandedId.value = null;
}

function dropAt(targetIndex: number): void {
  const sourceIndex = draggedIndex.value;
  draggedIndex.value = null;
  if (sourceIndex === null || sourceIndex === targetIndex) return;
  const [preset] = draft.value.splice(sourceIndex, 1);
  if (preset) draft.value.splice(targetIndex, 0, preset);
}

async function editPreset(id: string): Promise<void> {
  expandedId.value = id;
  await nextTick();
  const editor = document.getElementById(`${editorId}-${id}`);
  editor?.scrollIntoView({ block: "nearest" });
  editor?.querySelector("input")?.focus({ preventScroll: true });
}
</script>

<template>
  <PresetManagerShell
    ref="shell"
    :dirty="dirty"
    :busy="busy"
    @reset="reset()"
    :open="open"
    :title="t('longBookAnalysis.presetManagement')"
    :description="
      t('longBookAnalysis.presetConfiguration', {
        kind: short
          ? t('longBookAnalysis.shortAnalysis')
          : t('longBookAnalysis.longAnalysis')
      })
    "
    :close-label="t('cloudBackup.close')"
    @close="emit('close')"
  >
    <div class="preset-toolbar" :inert="busy">
      <button type="button" :disabled="draft.length >= 50" @click="addPreset">
        {{ t("longBookAnalysis.addPreset") }}
      </button>
      <button type="button" @click="shell?.requestReset()">
        {{ t("longBookAnalysis.restoreAllDefaults") }}
      </button>
      <small>{{ t("longBookAnalysis.presetEditingHelp") }}</small>
      <span>{{ draft.length }} / 50</span>
    </div>
    <div class="preset-list" :inert="busy">
      <article
        v-for="(preset, index) in draft"
        :key="preset.id"
        :class="{ 'is-expanded': expandedId === preset.id }"
        @dragover.prevent
        @drop.prevent="dropAt(index)"
      >
        <div class="preset-card-heading">
          <span
            class="drag-handle"
            draggable="true"
            :title="t('longBookAnalysis.reorderPresets')"
            @dragstart="draggedIndex = index"
            @dragend="draggedIndex = null"
            >⋮⋮</span
          >
          <button
            class="preset-summary"
            type="button"
            :aria-expanded="expandedId === preset.id"
            :aria-controls="`${editorId}-${preset.id}`"
            @click="expandedId = expandedId === preset.id ? null : preset.id"
          >
            <span class="preset-title-row">
              <strong>{{
                presetLabel(preset) || t("longBookAnalysis.unnamedPreset")
              }}</strong>
              <span class="preset-badge">{{
                preset.builtin
                  ? t("longBookAnalysis.defaultPreset")
                  : t("longBookAnalysis.custom")
              }}</span>
            </span>
            <span class="preset-description">{{
              presetLabel(preset, "description") ||
              t("longBookAnalysis.noDescription")
            }}</span>
            <span class="preset-meta">
              <span v-if="short">{{
                preset.selectionMode === "multiple"
                  ? t("longBookAnalysis.multipleBooksCompact")
                  : t("longBookAnalysis.singleBookCompact")
              }}</span>
              <span
                >{{
                  preset.output.domain === "material"
                    ? t("cloudBackup.materialLibrary")
                    : t("cloudBackup.skillLibrary")
                }}
                ·
                {{
                  preset.output.domain === "material"
                    ? MATERIAL_KIND_LABELS[preset.output.kind]
                    : SKILL_KIND_LABELS[preset.output.kind]
                }}</span
              >
            </span>
            <span class="preset-toggle">{{
              expandedId === preset.id
                ? t("longBookAnalysis.collapseEditor")
                : t("longBookAnalysis.expandEditor")
            }}</span>
          </button>
          <div class="preset-card-actions">
            <button
              type="button"
              :disabled="draft.length >= 50"
              @click="copyPreset(index)"
            >
              {{ t("longBookAnalysis.copy") }}
            </button>
            <button
              v-if="preset.builtin"
              type="button"
              @click="reset(preset.id)"
            >
              {{ t("longBookAnalysis.restoreDefault") }}
            </button>
            <button
              v-if="!preset.builtin"
              class="delete-button"
              type="button"
              @click="removePreset(index)"
            >
              {{ t("longBookAnalysis.delete") }}
            </button>
          </div>
        </div>
        <PresetEditor
          v-if="expandedId === preset.id"
          :id="`${editorId}-${preset.id}`"
          :preset="preset"
          :short="short"
        />
      </article>
    </div>
    <template #footer="{ requestClose }">
      <button type="button" @click="requestClose">
        {{ t("cloudBackup.cancel") }}
      </button>
      <button
        class="analysis-primary-button"
        type="button"
        :disabled="busy"
        @click="!busy && emit('save', snapshot())"
      >
        {{
          saving
            ? t("longBookAnalysis.saving")
            : t("longBookAnalysis.savePreset")
        }}
      </button>
    </template>
  </PresetManagerShell>
</template>

<style scoped src="./preset-manager.css"></style>
