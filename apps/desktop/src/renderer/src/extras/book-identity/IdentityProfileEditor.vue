<script setup lang="ts">
import { jsonClone } from "@deepwrite/shared";
import { computed, ref, useId, watch } from "vue";
import { createId } from "@deepwrite/shared";
import type { BookIdentityField } from "@deepwrite/contracts/renderer";
import type { IdentityProfileCatalogs } from "./useIdentityProfiles";
import PresetManagerShell from "../analysis-ui/PresetManagerShell.vue";
import IdentityFieldTabs from "./IdentityFieldTabs.vue";
import PopupSelect from "../../components/PopupSelect.vue";
import { fields, countLimits, identityT as t } from "./book-identity-utils";
const props = defineProps<{
  open: boolean;
  catalogs: IdentityProfileCatalogs;
  saving: boolean;
}>();
const emit = defineEmits<{
  close: [];
  save: [catalogs: IdentityProfileCatalogs];
  reset: [field: BookIdentityField];
}>();
const field = defineModel<BookIdentityField>("field", { required: true });
const panelId = useId();
const drafts = ref<IdentityProfileCatalogs>({
  title: [],
  synopsis: [],
  cover: []
});
const currentDrafts = computed(() => drafts.value[field.value]);
watch(
  () => props.open,
  (open) => {
    if (open) drafts.value = jsonClone(props.catalogs);
  },
  { immediate: true }
);
for (const value of fields)
  watch(
    () => props.catalogs[value],
    (profiles) => {
      if (props.open) drafts.value[value] = jsonClone(profiles);
    }
  );
function add() {
  const first = currentDrafts.value[0];
  if (first && currentDrafts.value.length < 20)
    currentDrafts.value.push({
      ...jsonClone(first),
      id: createId("identity_profile"),
      name: t("newProfile"),
      builtin: false
    });
}
</script>
<template>
  <PresetManagerShell
    :open="open"
    :title="t('manageProfiles')"
    :description="t('profileHelp')"
    :close-label="t('close')"
    @close="emit('close')"
  >
    <IdentityFieldTabs
      v-model="field"
      :label="t('manageProfiles')"
      :panel-id="panelId"
      :disabled="saving"
    />
    <div
      :id="panelId"
      class="identity-profile-panel"
      role="tabpanel"
      :aria-labelledby="`${panelId}-${field}-tab`"
    >
      <div class="preset-toolbar">
        <button :disabled="saving || currentDrafts.length >= 20" @click="add">
          {{ t("addProfile") }}</button
        ><button :disabled="saving" @click="emit('reset', field)">
          {{ t("reset") }}</button
        ><small>{{ currentDrafts.length }} / 20</small>
      </div>
      <div class="preset-list">
        <details
          v-for="(profile, index) in currentDrafts"
          :key="`${field}:${profile.id}`"
          class="identity-profile"
        >
          <summary>{{ profile.name }}</summary>
          <div class="identity-profile-fields">
            <label
              ><span>{{ t("profileName") }}</span
              ><input v-model="profile.name" maxlength="80"
            /></label>
            <label
              ><span>{{ t("count") }}</span
              ><input
                v-model.number="profile.candidateCount"
                type="number"
                min="1"
                :max="countLimits[field]"
            /></label>
            <template v-if="'titleLength' in profile"
              ><label
                ><span>{{ t("titleMin") }}</span
                ><input
                  v-model.number="profile.titleLength.min"
                  type="number"
                  min="1"
                  max="60" /></label
              ><label
                ><span>{{ t("titleMax") }}</span
                ><input
                  v-model.number="profile.titleLength.max"
                  type="number"
                  min="1"
                  max="60" /></label
              ><label
                ><span>{{ t("subtitlePolicy") }}</span
                ><PopupSelect
                  :menu-z-index="3200"
                  v-model="profile.subtitle"
                  :options="
                    (['never', 'optional', 'always'] as const).map((value) => ({
                      value,
                      label: t(value)
                    }))
                  "
                  :accessible-label="t('subtitlePolicy')" /></label
            ></template>
            <template v-if="'targetLength' in profile"
              ><label
                ><span>{{ t("targetLength") }}</span
                ><input
                  v-model.number="profile.targetLength"
                  type="number"
                  min="30"
                  max="1000" /></label
              ><label class="identity-check"
                ><input v-model="profile.includeHook" type="checkbox" />{{
                  t("includeHook")
                }}</label
              ></template
            >
            <template v-if="'imagesPerCandidate' in profile"
              ><label
                ><span>{{ t("imagesPerCandidate") }}</span
                ><input
                  v-model.number="profile.imagesPerCandidate"
                  type="number"
                  min="1"
                  max="4" /></label
              ><label
                ><span>{{ t("aspectRatio") }}</span
                ><PopupSelect
                  :menu-z-index="3200"
                  v-model="profile.aspectRatio"
                  :options="
                    ['3:4', '2:3', '9:16', '1:1', '16:9'].map((value) => ({
                      value,
                      label: value
                    }))
                  "
                  :accessible-label="t('aspectRatio')" /></label
              ><label
                ><span>{{ t("titleRendering") }}</span
                ><PopupSelect
                  :menu-z-index="3200"
                  v-model="profile.titleRendering"
                  :options="[
                    { value: 'model', label: t('modelText') },
                    { value: 'overlay', label: t('overlay') }
                  ]"
                  :accessible-label="t('titleRendering')" /></label
              ><label class="identity-check"
                ><input v-model="profile.autoRender" type="checkbox" />{{
                  t("autoRender")
                }}</label
              ><label
                ><span>{{ t("styleHint") }}</span
                ><input v-model="profile.styleHint" maxlength="200" /></label
            ></template>
            <label class="identity-span"
              ><span>{{ t("systemPrompt") }}</span
              ><textarea
                v-model="profile.systemPrompt"
                rows="8"
                maxlength="60000"
              />
            </label>
            <button
              v-if="!profile.builtin"
              class="identity-danger"
              @click="currentDrafts.splice(index, 1)"
            >
              {{ t("remove") }}
            </button>
          </div>
        </details>
      </div>
    </div>
    <template #footer
      ><button @click="emit('close')">{{ t("cancel") }}</button
      ><button
        class="analysis-primary-button"
        :disabled="saving"
        @click="emit('save', drafts)"
      >
        {{ t("save") }}
      </button></template
    >
  </PresetManagerShell>
</template>
<style scoped src="./book-identity.css"></style>
<style scoped src="../long-book-analysis/preset-manager.css"></style>
<style scoped>
.identity-profile-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.identity-profile-panel .preset-toolbar {
  justify-content: flex-start;
}
.identity-profile-panel .preset-toolbar small {
  margin-left: auto;
}
</style>
