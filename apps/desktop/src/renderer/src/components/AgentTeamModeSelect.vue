<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed, watch } from "vue";
import type {
  AcademicAgentId,
  AgentTeamRunMode,
  AgentTeamWorkspaceType,
  LongAgentId,
  MysteryAgentId,
  WorkspaceAgentId
} from "@deepwrite/contracts";
import { useSettingsStore } from "../stores/settingsStore";
import { resolveAgentTeamModeAvailability } from "../utils/agentTeamModeAvailability";
import AppIcon from "./AppIcon.vue";
import PopupSelect, { type PopupSelectOption } from "./PopupSelect.vue";

const t = createScopedTranslator("components.agentTeamModeSelect");

const props = withDefaults(
  defineProps<{
    modelValue: AgentTeamRunMode;
    workspaceType: AgentTeamWorkspaceType;
    parentAgentId:
      WorkspaceAgentId | LongAgentId | AcademicAgentId | MysteryAgentId;
    bookId?: string | undefined;
    align?: "start" | "end";
    menuZIndex?: number;
  }>(),
  {
    align: "end",
    menuZIndex: 1000
  }
);

const emit = defineEmits<{
  "update:modelValue": [mode: AgentTeamRunMode];
}>();

const settingsStore = useSettingsStore();
const availability = computed(() =>
  resolveAgentTeamModeAvailability({
    catalog: settingsStore.agentTeamCatalog,
    workspaceType: props.workspaceType,
    parentAgentId: props.parentAgentId,
    bookId: props.bookId,
    loaded: settingsStore.agentTeamLoaded,
    loading: settingsStore.agentTeamLoading,
    loadError: settingsStore.agentTeamLoadError
  })
);
const options = computed<PopupSelectOption[]>(() => [
  {
    value: "normal",
    label: t("standardMode"),
    description: t("useTheCurrentPrimaryAgentWithAccessToEnabled")
  },
  {
    value: "team",
    label: t("teamMode"),
    description: availability.value.description,
    disabled: !availability.value.available,
    ...(availability.value.available
      ? {}
      : { title: availability.value.description })
  }
]);

watch(
  () =>
    [
      props.modelValue,
      settingsStore.agentTeamLoaded && !settingsStore.agentTeamLoading,
      availability.value.available
    ] as const,
  ([mode, settled, available]) => {
    if (mode === "team" && settled && !available) {
      emit("update:modelValue", "normal");
    }
  },
  { immediate: true }
);

function updateMode(value: string | number): void {
  if (value === "normal" || value === "team") {
    emit("update:modelValue", value);
  }
}
</script>

<template>
  <PopupSelect
    :model-value="modelValue"
    :options="options"
    :accessible-label="t('selectAgentMode')"
    variant="compact"
    :align="align"
    :menu-min-width="300"
    :menu-z-index="menuZIndex"
    @update:model-value="updateMode"
  >
    <template #prefix>
      <AppIcon :name="modelValue === 'team' ? 'brain' : 'user'" :size="14" />
    </template>
  </PopupSelect>
</template>
