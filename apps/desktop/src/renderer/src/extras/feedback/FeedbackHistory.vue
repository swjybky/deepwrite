<script setup lang="ts">
import type {
  FeedbackItem,
  FeedbackPage,
  FeedbackStatus
} from "@deepwrite/contracts";
import { createScopedTranslator, locale } from "../../i18n";

const t = createScopedTranslator("extras.feedback");

defineProps<{
  history: FeedbackPage | null;
  loading: boolean;
  imageSources: Record<string, string>;
  openImageSets: ReadonlySet<string>;
}>();
const emit = defineEmits<{
  changePage: [page: number];
  toggleImages: [item: FeedbackItem];
  retry: [];
}>();

const statusLabels: Record<FeedbackStatus, () => string> = {
  open: () => t("statusOpen"),
  processing: () => t("statusProcessing"),
  done: () => t("statusDone")
};

function formatTime(value: string): string {
  return new Date(value).toLocaleString(locale.value, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}
</script>

<template>
  <div class="feedback-history" :aria-busy="loading">
    <div class="dialog-actions">
      <button
        type="button"
        class="dialog-secondary-button"
        :disabled="loading"
        @click="emit('retry')"
      >
        {{ t("refreshHistory") }}
      </button>
    </div>
    <p v-if="!history && loading" class="feedback-history-placeholder">
      {{ t("historyLoading") }}
    </p>
    <p
      v-else-if="history && !history.items.length"
      class="feedback-history-placeholder"
    >
      {{ t("historyEmpty") }}
    </p>
    <template v-else-if="history">
      <article
        v-for="item in history.items"
        :key="item.id"
        class="feedback-item"
      >
        <header>
          <span class="feedback-status" :data-status="item.status">
            {{ statusLabels[item.status]() }}
          </span>
          <span v-if="item.tag" class="feedback-item-tag">
            {{ item.tag === "bug" ? t("tagBug") : t("tagFeature") }}
          </span>
          <time :datetime="item.createdAt">{{
            formatTime(item.createdAt)
          }}</time>
        </header>
        <p class="feedback-item-content">{{ item.content }}</p>
        <button
          v-if="item.images.length"
          type="button"
          class="feedback-link-button"
          :aria-expanded="openImageSets.has(item.id)"
          @click="emit('toggleImages', item)"
        >
          {{
            openImageSets.has(item.id)
              ? t("hideScreenshots")
              : t("viewScreenshots", { count: item.images.length })
          }}
        </button>
        <div v-if="openImageSets.has(item.id)" class="feedback-item-images">
          <template v-for="(image, index) in item.images" :key="image.id">
            <img
              v-if="imageSources[image.id]"
              :src="imageSources[image.id]"
              :alt="t('screenshotAlt', { index: index + 1 })"
            />
            <span v-else class="feedback-image-placeholder">
              {{ t("historyLoading") }}
            </span>
          </template>
        </div>
        <section v-if="item.reply" class="feedback-reply">
          <h3>
            {{ t("replyLabel") }}
            <time v-if="item.repliedAt" :datetime="item.repliedAt">{{
              formatTime(item.repliedAt)
            }}</time>
          </h3>
          <p>{{ item.reply }}</p>
        </section>
      </article>
      <nav
        v-if="history.totalPages > 1"
        class="feedback-pagination"
        :aria-label="t('pagination')"
      >
        <button
          type="button"
          class="dialog-secondary-button"
          :disabled="history.page <= 1"
          @click="emit('changePage', history.page - 1)"
        >
          {{ t("previousPage") }}
        </button>
        <span>{{ history.page }} / {{ history.totalPages }}</span>
        <button
          type="button"
          class="dialog-secondary-button"
          :disabled="history.page >= history.totalPages"
          @click="emit('changePage', history.page + 1)"
        >
          {{ t("nextPage") }}
        </button>
      </nav>
    </template>
  </div>
</template>
