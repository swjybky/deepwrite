<script setup lang="ts">
import { computed, onMounted } from "vue";
import type { MarketplaceSession } from "@deepwrite/contracts";
import MarketplaceAuthForm from "../../components/MarketplaceAuthForm.vue";
import { createScopedTranslator } from "../../i18n";
import FeedbackComposer from "./FeedbackComposer.vue";
import FeedbackHistory from "./FeedbackHistory.vue";
import { useFeedback, type FeedbackTab } from "./useFeedback";

const t = createScopedTranslator("extras.feedback");
const emit = defineEmits<{
  close: [];
  sessionChange: [session: MarketplaceSession];
}>();

const feedback = useFeedback({
  api: () => window.deepwrite,
  onSessionChange: (session) => emit("sessionChange", session),
  onUnavailable: () => emit("close")
});
const {
  session,
  authenticated,
  tab,
  capturing,
  submitting,
  processingImages,
  imagesFull,
  canSubmit,
  history,
  historyLoading,
  imageSources,
  openImageSets
} = feedback;

const tabs = computed<{ id: FeedbackTab; label: string }[]>(() => [
  { id: "compose", label: t("tabCompose") },
  { id: "history", label: t("tabHistory") }
]);

onMounted(() => void feedback.restoreSession());
</script>

<template>
  <Teleport to="body">
    <div
      v-show="!capturing"
      class="dialog-backdrop"
      @mousedown.self="emit('close')"
    >
      <section
        class="workspace-dialog feedback-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-dialog-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">DeepWrite</span>
            <h2 id="feedback-dialog-title">{{ t("title") }}</h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div class="dialog-content feedback-body">
          <p v-if="!session" class="feedback-history-placeholder">
            {{ t("historyLoading") }}
          </p>
          <template v-else-if="!authenticated">
            <MarketplaceAuthForm @authenticated="feedback.applySession" />
          </template>
          <template v-else>
            <div class="feedback-tabs" role="tablist">
              <button
                v-for="item in tabs"
                :key="item.id"
                type="button"
                role="tab"
                :aria-selected="tab === item.id"
                @click="feedback.selectTab(item.id)"
              >
                {{ item.label }}
              </button>
            </div>
            <FeedbackComposer
              v-if="tab === 'compose'"
              :submitting="submitting"
              :processing-images="processingImages"
              :capturing="capturing"
              :images-full="imagesFull"
              :can-submit="canSubmit"
              @add-images="feedback.addImages"
              @remove-image="feedback.removeImage"
              @capture-window="feedback.captureWindow"
              @submit="feedback.submit"
            />
            <FeedbackHistory
              v-else
              :history="history"
              :loading="historyLoading"
              :image-sources="imageSources"
              :open-image-sets="openImageSets"
              @change-page="feedback.loadHistory"
              @retry="feedback.retryHistory"
              @toggle-images="feedback.toggleImages"
            />
          </template>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style src="./feedback.css"></style>
