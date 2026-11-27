<script setup lang="ts">
import { deepwriteApi } from "../api/deepwrite";
import { createScopedTranslator } from "../i18n";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import PopupSelect from "./PopupSelect.vue";
import VoiceProfileFields from "./VoiceProfileFields.vue";
import VoiceInputBar from "./VoiceInputBar.vue";
import VoiceUsagePanel from "./VoiceUsagePanel.vue";
import { useVoiceSettings } from "../composables/useVoiceSettings";
import { useVoiceInput } from "../composables/useVoiceInput";
import {
  VOICE_LANGUAGE_OPTIONS,
  VOICE_PROFILE_LABELS
} from "../composables/voiceSettingsOptions";
import { uiMessage } from "../ui-feedback";

const t = createScopedTranslator("components.voiceSettingsPanel");

const props = defineProps<{ runtimeAvailable: boolean }>();
const configuration = useVoiceSettings({
  api: () => deepwriteApi()?.voice,
  notifications: uiMessage
});
const {
  settings,
  updateSelection,
  currentProfile,
  apiKey,
  keyConfigured,
  loading,
  loaded,
  saving,
  usage,
  usageLoading,
  microphones,
  load,
  save,
  refreshUsage,
  refreshMicrophones
} = configuration;
const testInput = ref<HTMLTextAreaElement | null>(null);
const testText = ref("");
const voice = useVoiceInput({
  sessionKey: () => `voice-settings:${settings.value.activeProfileId}`,
  draft: () => testText.value,
  input: testInput,
  updateDraft: (text) => {
    testText.value = text;
  },
  profileId: () => settings.value.activeProfileId,
  canStart: () => props.runtimeAvailable && loaded.value && !saving.value,
  onTranscribed: () => {
    void refreshUsage();
    void refreshMicrophones();
  }
});
const { active, state, elapsedMs, levels } = voice;
const disabled = computed(
  () => !props.runtimeAvailable || !loaded.value || saving.value || active.value
);
const profileLabel = computed(
  () => VOICE_PROFILE_LABELS[settings.value.activeProfileId]
);

const editing = ref(false);
const configuredOptions = computed(() =>
  settings.value.profiles
    .filter((profile) => profile.hasApiKey)
    .map((profile) => ({
      value: profile.id,
      label: VOICE_PROFILE_LABELS[profile.id]
    }))
);
const canAdd = computed(() =>
  settings.value.profiles.some((profile) => !profile.hasApiKey)
);
function selectProfile(value: string): void {
  const profile = settings.value.profiles.find(
    (profile) => profile.id === value
  );
  if (profile) void updateSelection("activeProfileId", profile.id);
}
function openEditor(add = false): void {
  configuration.beginEdit();
  if (add) {
    const available = settings.value.profiles.find(
      (profile) => !profile.hasApiKey
    );
    if (available) settings.value.activeProfileId = available.id;
  }
  editing.value = true;
}
function cancelEdit(): void {
  configuration.cancelEdit();
  editing.value = false;
}
async function saveSettings(): Promise<void> {
  if (await save()) editing.value = false;
}

async function startTest(): Promise<void> {
  if (disabled.value || editing.value) return;
  if (!apiKey.value.trim() && !keyConfigured.value) {
    uiMessage.warning(t("enterAnAPIKeyForTheCurrentVoiceConfiguration"));
    return;
  }
  if (await save(true)) {
    testText.value = "";
    await voice.start();
  }
}

onMounted(async () => {
  await Promise.allSettled([load(), refreshUsage()]);
  await refreshMicrophones();
});
onBeforeUnmount(configuration.dispose);
</script>

<template>
  <section class="settings-group">
    <h2 class="settings-group-title">
      {{ t("speechRecognition") }}
    </h2>
    <div v-if="!editing" class="settings-card">
      <div class="settings-item settings-select-item">
        <span class="settings-item-text">
          <strong>{{ t("currentVoiceModel") }}</strong>
          <small>{{
            keyConfigured
              ? currentProfile.model
              : t("addAServiceToUseVoiceInput")
          }}</small>
        </span>
        <PopupSelect
          v-if="configuredOptions.length"
          class="general-select-control"
          :model-value="settings.activeProfileId"
          :options="configuredOptions"
          :accessible-label="t('currentVoiceConfiguration')"
          align="end"
          :disabled="disabled"
          @update:model-value="selectProfile(String($event))"
        />
      </div>
      <div class="settings-item">
        <span class="settings-item-text"
          ><strong>{{ t("modelSettings") }}</strong
          ><small>{{
            t("manageServiceKeysEndpointsAndRecognitionModels")
          }}</small></span
        >
        <div class="voice-model-actions">
          <button
            v-if="keyConfigured"
            class="voice-button"
            type="button"
            :disabled="disabled"
            @click="openEditor()"
          >
            {{ t("edit") }}
          </button>
          <button
            v-if="canAdd"
            class="voice-button is-primary"
            type="button"
            :disabled="disabled"
            @click="openEditor(true)"
          >
            {{ t("addConfiguration") }}
          </button>
        </div>
      </div>
      <div v-if="!loaded" class="settings-item">
        <span class="settings-item-text"
          ><strong>{{ t("loadSettings") }}</strong
          ><small>{{
            t("connectToTheLocalVoiceServiceAndLoadSaved")
          }}</small></span
        >
        <button
          class="voice-button"
          type="button"
          :disabled="loading || !runtimeAvailable"
          @click="load"
        >
          {{ loading ? t("loading") : t("reload") }}
        </button>
      </div>
    </div>
    <form
      v-else
      class="settings-card"
      novalidate
      @submit.prevent="saveSettings"
    >
      <fieldset class="voice-profile-fieldset" :disabled="disabled">
        <VoiceProfileFields
          :configuration="configuration"
          :disabled="disabled"
        />
      </fieldset>
      <div class="settings-item">
        <span class="settings-item-text"
          ><small>{{
            t("saveAndUseMessage", {
              arg0: profileLabel ?? ""
            })
          }}</small></span
        >
        <div class="voice-model-actions">
          <button
            class="voice-button"
            type="button"
            :disabled="saving"
            @click="cancelEdit"
          >
            {{ t("cancel") }}
          </button>
          <button
            class="voice-button is-primary"
            type="submit"
            :disabled="disabled"
          >
            {{ saving ? t("saving") : t("saveSettings") }}
          </button>
        </div>
      </div>
    </form>

    <template v-if="!editing">
      <h2 class="settings-group-title">
        {{ t("recordingOptions") }}
      </h2>
      <div class="settings-card">
        <div class="settings-item settings-select-item">
          <span class="settings-item-text"
            ><strong>{{ t("recognitionLanguage") }}</strong
            ><small>{{
              t("chooseTheSpeechRecognitionLanguageChangesApplyImmediately")
            }}</small></span
          >
          <PopupSelect
            class="general-select-control"
            :model-value="settings.language"
            :options="VOICE_LANGUAGE_OPTIONS"
            :accessible-label="t('speechRecognitionLanguage')"
            align="end"
            :disabled="disabled"
            @update:model-value="
              updateSelection(
                'language',
                $event === 'zh' || $event === 'en' ? $event : 'auto'
              )
            "
          />
        </div>
        <div class="settings-item settings-select-item">
          <span class="settings-item-text"
            ><strong>{{ t("microphone") }}</strong
            ><small>{{
              t("chooseARecordingDeviceChangesApplyImmediately")
            }}</small></span
          >
          <PopupSelect
            class="general-select-control"
            :model-value="settings.microphoneId"
            :options="microphones"
            :accessible-label="t('recordingMicrophone')"
            align="end"
            :disabled="disabled"
            @update:model-value="
              updateSelection('microphoneId', String($event))
            "
          />
        </div>
        <div class="settings-item">
          <span class="settings-item-text"
            ><strong>{{ t("recordingDevice") }}</strong
            ><small>{{
              t("microphoneAccessIsRequiredForYourFirstRecordingEach")
            }}</small></span
          >
          <button
            class="voice-button"
            type="button"
            :disabled="disabled"
            @click="refreshMicrophones"
          >
            {{ t("refreshMicrophones") }}
          </button>
        </div>
      </div>
    </template>

    <h2 id="voice-test-title" class="settings-group-title">
      {{ t("recordingTest") }}
    </h2>
    <div class="settings-card" aria-labelledby="voice-test-title">
      <div class="settings-item">
        <span class="settings-item-text"
          ><strong>{{ t("testRecognition") }}</strong
          ><small>{{
            t("recordWithTheCurrentConfigurationTestUsageCountsToward")
          }}</small></span
        >
        <button
          v-if="!active"
          class="voice-button"
          type="button"
          :disabled="disabled || editing || !keyConfigured"
          @click="startTest"
        >
          <AppIcon name="mic" :size="16" />{{ t("startRecordingTest") }}
        </button>
      </div>
      <div class="voice-test-result">
        <textarea
          ref="testInput"
          v-model="testText"
          rows="3"
          :aria-label="t('speechRecognitionTestResult')"
          :placeholder="t('recognitionResultsAppearHere')"
          :readonly="active"
        />
        <VoiceInputBar
          v-if="active"
          :state="state"
          :elapsed-ms="elapsedMs"
          :levels="levels"
          :show-send="false"
          @cancel="voice.cancel"
          @stop="voice.stop"
          @retry="voice.retry"
        />
      </div>
    </div>
    <VoiceUsagePanel
      :records="usage"
      :loading="usageLoading"
      @refresh="refreshUsage"
    />
  </section>
</template>
<style scoped src="./settings-page.css"></style>
<style scoped src="./voice-settings.css"></style>
