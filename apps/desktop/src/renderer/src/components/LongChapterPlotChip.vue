<script setup lang="ts">
import { computed } from "vue";
import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import { createScopedTranslator } from "../i18n";

const t = createScopedTranslator("components.longChapterPlotBinding");
const props = defineProps<{
  chapterCardId: string;
  snapshot: LongWorkspaceIndexSnapshot;
  editable: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{ edit: [] }>();
const chapter = computed(() =>
  props.snapshot.plot.chapterCards.find(({ id }) => id === props.chapterCardId)
);
const label = computed(
  () =>
    props.snapshot.plot.arcs.find(
      ({ id }) => id === chapter.value?.primaryArcId
    )?.title ?? t("unlinked")
);
</script>

<template>
  <button
    v-if="chapter && editable"
    type="button"
    class="chapter-plot-chip"
    :class="{ 'is-unlinked': !chapter.primaryArcId }"
    :disabled="disabled"
    :title="`${t('primaryPlotPoint')}：${label}`"
    @click="emit('edit')"
  >
    {{ label }}
  </button>
  <span
    v-else-if="chapter"
    class="chapter-plot-chip"
    :class="{ 'is-unlinked': !chapter.primaryArcId }"
    :title="`${t('primaryPlotPoint')}：${label}`"
  >
    {{ label }}
  </span>
</template>

<style scoped>
.chapter-plot-chip {
  flex: 0 0 auto;
  min-width: 0;
  max-width: min(45%, 18rem);
  padding: 2px 0 5px;
  overflow: hidden;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.82rem;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chapter-plot-chip.is-unlinked {
  color: var(--text-tertiary);
}
button.chapter-plot-chip {
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: var(--text-tertiary);
  text-underline-offset: 3px;
}
button.chapter-plot-chip:hover:not(:disabled) {
  color: var(--text-primary);
  text-decoration-color: currentColor;
}
button.chapter-plot-chip:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>
