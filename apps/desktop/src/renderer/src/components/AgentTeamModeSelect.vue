<script setup lang="ts">
import { computed, watch } from "vue";
import type {
  AgentTeamRunMode,
  AgentTeamWorkspaceType,
  LongAgentId,
  WorkspaceAgentId
} from "@deepwrite/contracts";
import { useSettingsStore } from "../stores/settingsStore";
import { resolveAgentTeamModeAvailability } from "../utils/agentTeamModeAvailability";
import AppIcon from "./AppIcon.vue";
import PopupSelect, { type PopupSelectOption } from "./PopupSelect.vue";

const props = defineProps<{
  modelValue: AgentTeamRunMode;
  workspaceType: AgentTeamWorkspaceType;
  parentAgentId: WorkspaceAgentId | LongAgentId;
}>();

const emit = defineEmits<{
  "update:modelValue": [mode: AgentTeamRunMode];
}>();

const settingsStore = useSettingsStore();
const availability = computed(() =>
  resolveAgentTeamModeAvailability({
    catalog: settingsStore.agentTeamCatalog,
    workspaceType: props.workspaceType,
    parentAgentId: props.parentAgentId,
    loaded: settingsStore.agentTeamLoaded,
    loading: settingsStore.agentTeamLoading,
    loadError: settingsStore.agentTeamLoadError
  })
);
const options = computed<PopupSelectOption[]>(() => [
  {
    value: "normal",
    label: "普通模式",
    description: "使用当前主智能体，也可调用已启用的内置资料库管理子智能体。"
  },
  {
    value: "team",
    label: "团队模式",
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
      settingsStore.agentTeamLoaded,
      availability.value.available
    ] as const,
  ([mode, loaded, available]) => {
    if (mode === "team" && loaded && !available) {
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
    accessible-label="选择智能体运行模式"
    variant="compact"
    align="end"
    :menu-min-width="300"
    @update:model-value="updateMode"
  >
    <template #prefix>
      <AppIcon :name="modelValue === 'team' ? 'brain' : 'user'" :size="14" />
    </template>
  </PopupSelect>
</template>
