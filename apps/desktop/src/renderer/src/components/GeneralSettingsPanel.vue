<script setup lang="ts">
import type {
  AppLanguage,
  GeneralPermissionMode,
  WorkspacePaneLayout
} from "@deepwrite/contracts";
import { computed } from "vue";
import { createScopedTranslator } from "../i18n";
import PopupSelect from "./PopupSelect.vue";

const t = createScopedTranslator("foundation");

defineProps<{
  permissionMode: GeneralPermissionMode;
  autoApproveCrossStageOperations: boolean;
  autoSaveEnabled: boolean;
  language: AppLanguage;
  showInMenuBar: boolean;
  taskNotification: boolean;
  useNetworkProxy: boolean;
  workspacePaneLayout: WorkspacePaneLayout;
}>();

const emit = defineEmits<{
  updatePermissionMode: [mode: GeneralPermissionMode];
  updateAutoApproveCrossStageOperations: [enabled: boolean];
  updateAutoSave: [enabled: boolean];
  updateLanguage: [language: AppLanguage];
  updateShowInMenuBar: [enabled: boolean];
  updateTaskNotification: [enabled: boolean];
  updateUseNetworkProxy: [enabled: boolean];
  updateWorkspacePaneLayout: [layout: WorkspacePaneLayout];
}>();

const languageOptions = computed<Array<{ value: AppLanguage; label: string }>>(
  () => [
    { value: "auto", label: t("systemLanguage") },
    { value: "zh-CN", label: t("simplifiedChinese") },
    { value: "en-US", label: t("english") }
  ]
);
const workspacePaneLayoutOptions = computed<
  Array<{
    value: WorkspacePaneLayout;
    label: string;
  }>
>(() => [
  { value: "agent-editor", label: t("agentFirst") },
  { value: "editor-agent", label: t("editorFirst") }
]);
</script>

<template>
  <section class="settings-group">
    <h2 class="settings-group-title">{{ t("permissions") }}</h2>
    <div
      class="settings-card"
      role="radiogroup"
      :aria-label="t('approvalLabel')"
    >
      <label class="settings-item">
        <span class="settings-item-text"
          ><strong>{{ t("requestApproval") }}</strong
          ><small>{{ t("requestApprovalDescription") }}</small></span
        >
        <span class="settings-toggle"
          ><input
            type="radio"
            name="general-permission-mode"
            :checked="permissionMode === 'request-approval'"
            :aria-label="t('requestApproval')"
            @change="emit('updatePermissionMode', 'request-approval')"
        /></span>
      </label>
      <label class="settings-item">
        <span class="settings-item-text"
          ><strong>{{ t("autoApproval") }}</strong
          ><small>{{ t("autoApprovalDescription") }}</small></span
        >
        <span class="settings-toggle"
          ><input
            type="radio"
            name="general-permission-mode"
            :checked="permissionMode === 'auto-approve'"
            :aria-label="t('autoApproval')"
            @change="emit('updatePermissionMode', 'auto-approve')"
        /></span>
      </label>
    </div>

    <div class="settings-card">
      <label class="settings-item">
        <span class="settings-item-text"
          ><strong>{{ t("crossStageApproval") }}</strong
          ><small>{{ t("crossStageApprovalDescription") }}</small></span
        >
        <span class="settings-toggle"
          ><input
            type="checkbox"
            :checked="autoApproveCrossStageOperations"
            :aria-label="t('crossStageApproval')"
            @change="
              emit(
                'updateAutoApproveCrossStageOperations',
                ($event.target as HTMLInputElement).checked
              )
            "
        /></span>
      </label>
    </div>

    <h2 class="settings-group-title">{{ t("general") }}</h2>
    <div class="settings-card">
      <label class="settings-item">
        <span class="settings-item-text"
          ><strong>{{ t("autoSave") }}</strong
          ><small>{{ t("autoSaveDescription") }}</small></span
        >
        <span class="settings-toggle"
          ><input
            type="checkbox"
            :checked="autoSaveEnabled"
            @change="
              emit(
                'updateAutoSave',
                ($event.target as HTMLInputElement).checked
              )
            "
        /></span>
      </label>
      <div class="settings-item settings-select-item">
        <span class="settings-item-text"
          ><strong>{{ t("layout") }}</strong
          ><small>{{ t("layoutDescription") }}</small></span
        >
        <PopupSelect
          class="general-select-control"
          :model-value="workspacePaneLayout"
          :options="workspacePaneLayoutOptions"
          :accessible-label="t('layoutLabel')"
          align="end"
          :menu-min-width="238"
          @update:model-value="
            emit(
              'updateWorkspacePaneLayout',
              String($event) as WorkspacePaneLayout
            )
          "
        />
      </div>
      <div class="settings-item settings-select-item">
        <span class="settings-item-text"
          ><strong>{{ t("language") }}</strong
          ><small>{{ t("languageDescription") }}</small></span
        >
        <PopupSelect
          class="general-select-control"
          :model-value="language"
          :options="languageOptions"
          :accessible-label="t('languageLabel')"
          align="end"
          :menu-min-width="210"
          @update:model-value="
            emit('updateLanguage', String($event) as AppLanguage)
          "
        />
      </div>
      <label class="settings-item"
        ><span class="settings-item-text"
          ><strong>{{ t("menuBar") }}</strong
          ><small>{{ t("menuBarDescription") }}</small></span
        ><span class="settings-toggle"
          ><input
            type="checkbox"
            :checked="showInMenuBar"
            @change="
              emit(
                'updateShowInMenuBar',
                ($event.target as HTMLInputElement).checked
              )
            " /></span
      ></label>
      <label class="settings-item"
        ><span class="settings-item-text"
          ><strong>{{ t("taskNotification") }}</strong
          ><small>{{ t("taskNotificationDescription") }}</small></span
        ><span class="settings-toggle"
          ><input
            type="checkbox"
            :checked="taskNotification"
            :aria-label="t('taskNotification')"
            @change="
              emit(
                'updateTaskNotification',
                ($event.target as HTMLInputElement).checked
              )
            " /></span
      ></label>
    </div>

    <h2 class="settings-group-title">{{ t("network") }}</h2>
    <div class="settings-card">
      <label class="settings-item">
        <span class="settings-item-text"
          ><strong>{{ t("proxy") }}</strong
          ><small>{{ t("proxyDescription") }}</small></span
        >
        <span class="settings-toggle"
          ><input
            type="checkbox"
            :checked="useNetworkProxy"
            :aria-label="t('proxy')"
            @change="
              emit(
                'updateUseNetworkProxy',
                ($event.target as HTMLInputElement).checked
              )
            "
        /></span>
      </label>
    </div>
  </section>
</template>

<style scoped src="./settings-page.css"></style>
<style scoped>
.settings-select-item {
  flex-wrap: wrap;
}

.settings-select-item .settings-item-text {
  min-width: min(240px, 100%);
}

.general-select-control {
  width: 210px;
  min-width: 160px;
  max-width: 210px;
  flex: 0 1 210px;
}
</style>
