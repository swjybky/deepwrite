<script setup lang="ts">
import { uiConfirm } from "../../ui-confirm";
import { getErrorDetail } from "../../i18n/errors";
import { createScopedTranslator, locale } from "../../i18n";
import { computed, ref, onMounted, watch } from "vue";
import AppIcon from "../../components/AppIcon.vue";
import PopupSelect from "../../components/PopupSelect.vue";
import { uiMessage } from "../../ui-feedback";
import type { ShortBookAnalysisController } from "./useShortBookAnalysis";

const t = createScopedTranslator("extras");
const props = defineProps<{
  controller: ShortBookAnalysisController;
  resetVersion?: number;
}>();
const emit = defineEmits<{ managePresets: [] }>();
const c = props.controller;
const pasteOpen = ref(false);
const pasteTitle = ref("");
const pasteText = ref("");
const historyId = ref("");
const disabled = computed(() => c.isBusy.value || c.loading.value);
watch(
  () => props.resetVersion,
  () => {
    pasteOpen.value = false;
    pasteTitle.value = "";
    pasteText.value = "";
    historyId.value = "";
  }
);
watch([c.savedSources, c.drafts], ([sources, drafts]) => {
  if (
    !sources.some((source) => source.id === historyId.value) ||
    !drafts.some((source) => source.id === historyId.value)
  )
    historyId.value = "";
});
async function deleteSource(id: string) {
  const source = c.savedSources.value.find((book) => book.id === id);
  if (disabled.value || !source) return;
  if (
    !(await uiConfirm({
      message: t("shortBookAnalysis.deleteStoryConfirmation", {
        title: source.title
      }),
      danger: true
    }))
  )
    return;
  return act(async () => {
    await c.deleteSource(id);
    uiMessage.success(t("shortBookAnalysis.storyDeleted"));
  });
}
async function act(action: () => unknown) {
  try {
    await action();
  } catch (error) {
    uiMessage.warning(
      getErrorDetail(error) ?? t("shortBookAnalysis.sourceOperationFailed")
    );
  }
}
async function paste() {
  await act(async () => {
    await c.addText({ title: pasteTitle.value, text: pasteText.value });
    pasteOpen.value = false;
    pasteTitle.value = "";
    pasteText.value = "";
  });
}
onMounted(() => void act(() => c.loadSources()));
</script>
<template>
  <div class="analysis-page-controls">
    <div class="analysis-source-picker">
      <PopupSelect
        v-model="historyId"
        :options="
          c.savedSources.value.map((b) => ({
            value: b.id,
            label: b.title,
            description: t('longBookAnalysis.characterCount', {
              count: b.characterCount.toLocaleString(locale)
            }),
            actionIcon: 'trash',
            actionLabel: t('shortBookAnalysis.deleteStory', {
              title: b.title
            })
          }))
        "
        :placeholder="
          c.loading.value
            ? t('shortBookAnalysis.loadingImportedStories')
            : c.savedSources.value.length
              ? t('shortBookAnalysis.chooseImportedStory')
              : t('shortBookAnalysis.noImportedStories')
        "
        :accessible-label="t('shortBookAnalysis.savedStories')"
        :disabled="disabled || !c.savedSources.value.length"
        :menu-min-width="320"
        @change="(id) => act(() => c.loadSource(String(id)))"
        @option-action="(id) => deleteSource(String(id))"
        ><template #prefix><AppIcon name="book" :size="15" /></template
      ></PopupSelect>
    </div>
    <div class="analysis-page-actions">
      <button
        type="button"
        :disabled="disabled"
        :title="t('shortBookAnalysis.importTextFormats')"
        @click="act(() => c.chooseSources())"
      >
        <AppIcon name="file" :size="16" />{{
          t("shortBookAnalysis.importText")
        }}
      </button>
      <button type="button" :disabled="disabled" @click="pasteOpen = true">
        <AppIcon name="edit" :size="16" />{{ t("shortBookAnalysis.pasteText") }}
      </button>
      <button
        type="button"
        :title="t('longBookAnalysis.managePresets')"
        :aria-label="t('longBookAnalysis.managePresets')"
        :disabled="disabled"
        @click="emit('managePresets')"
      >
        {{ t("longBookAnalysis.managePresets") }}
      </button>
      <slot />
    </div>
  </div>
  <Teleport to="body"
    ><div
      v-if="pasteOpen"
      class="short-paste-backdrop"
      @click.self="!disabled && (pasteOpen = false)"
    >
      <section
        role="dialog"
        aria-modal="true"
        :aria-label="t('shortBookAnalysis.pasteStory')"
        class="short-paste-dialog"
      >
        <h2>{{ t("shortBookAnalysis.pasteStory") }}</h2>
        <label
          >{{ t("shortBookAnalysis.bookTitle")
          }}<input
            v-model="pasteTitle"
            maxlength="256"
            :disabled="disabled" /></label
        ><label
          >{{ t("shortBookAnalysis.completeText")
          }}<textarea
            v-model="pasteText"
            maxlength="2000000"
            :disabled="disabled"
          />
        </label>
        <footer>
          <button :disabled="disabled" @click="pasteOpen = false">
            {{ t("cloudBackup.cancel") }}</button
          ><button
            class="analysis-primary-button"
            :disabled="disabled"
            @click="paste"
          >
            {{ t("shortBookAnalysis.addStory") }}
          </button>
        </footer>
      </section>
    </div></Teleport
  >
</template>
