<script setup lang="ts">
import { formatError } from "../../i18n/errors";
import { computed, onMounted, ref, shallowRef, useId } from "vue";
import type {
  DecompositionContentRef,
  DecompositionUnitView
} from "@deepwrite/contracts/renderer";
import MarkdownContent from "../../components/MarkdownContent.vue";
import { createScopedTranslator } from "../../i18n";
import { getErrorPayload } from "../../i18n/errors";
import { uiMessage } from "../../ui-feedback";
import { decompositionDialogKeydown } from "./dialog-keys";
import { decompositionRecordMarkdown } from "./record-markdown";
import type { LongBookDecompositionController } from "./useLongBookDecomposition";
const t = createScopedTranslator("extras.longBookDecomposition");
const props = defineProps<{
  controller: LongBookDecompositionController;
  unitId: string;
  title: string;
}>();
const emit = defineEmits<{
  close: [];
  open: [ref: DecompositionContentRef];
}>();
const titleId = useId();
const dialog = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const view = shallowRef<DecompositionUnitView | null>(null);
const loading = ref(true);
const markdown = computed(() => {
  const job = props.controller.job.value;
  return view.value && job
    ? decompositionRecordMarkdown(view.value.records, job.profile)
    : "";
});
/** Long books open files; library refs are whole entries. */
const target = computed(() => {
  const refs = view.value?.refs ?? [];
  return props.controller.job.value?.target?.kind === "long"
    ? refs.find(({ fileId }) => fileId)
    : refs[0];
});
onMounted(async () => {
  closeButton.value?.focus();
  try {
    view.value = await props.controller.readUnit(props.unitId);
  } catch (error) {
    uiMessage.error(
      getErrorPayload(error)?.message ??
        formatError(error, t("operationFailed"))
    );
    emit("close");
  } finally {
    loading.value = false;
  }
});
</script>
<template>
  <Teleport to="body">
    <div class="analysis-refresh-backdrop" @mousedown.self="emit('close')">
      <section
        ref="dialog"
        class="decomposition-record-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        @keydown="
          decompositionDialogKeydown($event, dialog, () => emit('close'))
        "
      >
        <h2 :id="titleId">{{ title }}</h2>
        <div class="decomposition-record-body" tabindex="0">
          <p v-if="loading" class="decomposition-record-empty">
            {{ t("recordLoading") }}
          </p>
          <MarkdownContent v-else-if="markdown" :content="markdown" />
          <p v-else class="decomposition-record-empty">
            {{ t("recordEmpty") }}
          </p>
        </div>
        <div class="analysis-refresh-dialog-actions">
          <button ref="closeButton" type="button" @click="emit('close')">
            {{ t("close") }}
          </button>
          <button
            v-if="target"
            type="button"
            class="analysis-refresh-confirm"
            @click="emit('open', target)"
          >
            {{ t("viewTarget") }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
