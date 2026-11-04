<script setup lang="ts">
import { computed, ref } from "vue";
import type { FeedbackTag } from "@deepwrite/contracts";
import {
  FEEDBACK_CONTENT_MAX_LENGTH,
  FEEDBACK_MAX_IMAGES
} from "@deepwrite/contracts/renderer";
import AgentTeamSegmented from "../../components/AgentTeamSegmented.vue";
import { createScopedTranslator } from "../../i18n";
import { pastedImages } from "./feedbackImage";
import { feedbackDraft } from "./feedbackDraft";

const t = createScopedTranslator("extras.feedback");

defineProps<{
  submitting: boolean;
  processingImages: boolean;
  capturing: boolean;
  imagesFull: boolean;
  canSubmit: boolean;
}>();
const emit = defineEmits<{
  addImages: [sources: Blob[]];
  removeImage: [id: string];
  captureWindow: [];
  submit: [];
}>();

const { tag, content, images } = feedbackDraft;
const fileInput = ref<HTMLInputElement | null>(null);
type TagChoice = FeedbackTag | "other";
const tagOptions: { value: TagChoice; label: string }[] = [
  { value: "bug", label: t("tagBug") },
  { value: "feature", label: t("tagFeature") },
  { value: "other", label: t("tagOther") }
];
/** "Other" is the untagged draft, so feedback stays tag-free unless chosen. */
const tagChoice = computed<TagChoice>({
  get: () => tag.value ?? "other",
  set: (choice) => {
    tag.value = choice === "other" ? undefined : choice;
  }
});

function onFilesChosen(event: Event): void {
  const input = event.target as HTMLInputElement;
  emit("addImages", Array.from(input.files ?? []));
  input.value = "";
}

function onPaste(event: ClipboardEvent): void {
  const files = pastedImages(event.clipboardData);
  if (!files.length) return;
  event.preventDefault();
  emit("addImages", files);
}
</script>

<template>
  <form class="feedback-form" @submit.prevent="emit('submit')" @paste="onPaste">
    <div class="feedback-field">
      <span aria-hidden="true">{{ t("tagLabel") }}</span>
      <AgentTeamSegmented
        v-model="tagChoice"
        class="feedback-tag-choice"
        name="feedback-tag"
        :options="tagOptions"
        :label="t('tagLabel')"
        :disabled="submitting"
      />
    </div>

    <label class="feedback-field">
      <span>{{ t("contentLabel") }}</span>
      <textarea
        v-model="content"
        rows="6"
        :maxlength="FEEDBACK_CONTENT_MAX_LENGTH"
        :placeholder="t('contentPlaceholder')"
      />
    </label>

    <div class="feedback-field">
      <span>{{ t("screenshotsLabel", { max: FEEDBACK_MAX_IMAGES }) }}</span>
      <ul v-if="images.length" class="feedback-previews">
        <li v-for="(image, index) in images" :key="image.id">
          <img
            :src="image.previewUrl"
            :alt="t('screenshotAlt', { index: index + 1 })"
          />
          <button
            type="button"
            class="feedback-preview-remove"
            :aria-label="t('removeImage', { index: index + 1 })"
            @click="emit('removeImage', image.id)"
          >
            ×
          </button>
        </li>
      </ul>
      <div class="feedback-image-actions">
        <button
          type="button"
          class="dialog-secondary-button"
          :disabled="imagesFull || processingImages || capturing"
          @click="emit('captureWindow')"
        >
          {{ t("captureWindow") }}
        </button>
        <button
          type="button"
          class="dialog-secondary-button"
          :disabled="imagesFull || processingImages"
          @click="fileInput?.click()"
        >
          {{ t("chooseImage") }}
        </button>
        <input
          ref="fileInput"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          @change="onFilesChosen"
        />
      </div>
      <small>{{ t("screenshotHint") }}</small>
    </div>

    <div class="dialog-actions">
      <button class="dialog-primary-button" :disabled="!canSubmit">
        {{ submitting ? t("submitting") : t("submit") }}
      </button>
    </div>
  </form>
</template>
