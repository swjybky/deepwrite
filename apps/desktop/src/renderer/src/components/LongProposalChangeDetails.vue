<script setup lang="ts">
import { computed } from "vue";
import {
  longProposalChangeSectionTitle,
  type LongProposalChangeRow
} from "../utils/longProposalChangePresentation";

const props = defineProps<{
  rows: readonly LongProposalChangeRow[];
  title?: string;
}>();

const heading = computed(() => props.title ?? longProposalChangeSectionTitle());
</script>

<template>
  <section
    v-if="rows.length > 0"
    class="long-change-details"
    :aria-label="heading"
  >
    <strong class="long-change-heading">{{ heading }}</strong>
    <dl class="long-change-list">
      <div
        v-for="(row, index) in rows"
        :key="`${index}:${row.label}`"
        class="long-change-row"
        :class="row.tone ? `is-${row.tone}` : undefined"
      >
        <dt class="long-change-label">{{ row.label }}</dt>
        <dd class="long-change-value">{{ row.value }}</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.long-change-details {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}

.long-change-heading {
  font-size: 0.785714rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.long-change-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 0;
  min-width: 0;
}

.long-change-row {
  display: grid;
  grid-template-columns: minmax(6.2em, auto) minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
  min-width: 0;
  font-size: 0.785714rem;
  line-height: 1.45;
}

.long-change-label {
  color: var(--text-tertiary);
  white-space: nowrap;
}

.long-change-value {
  margin: 0;
  min-width: 0;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.long-change-row.is-warning .long-change-value {
  color: var(--warning);
}

.long-change-row.is-danger .long-change-label,
.long-change-row.is-danger .long-change-value {
  color: var(--danger);
}

@media (max-width: 480px) {
  .long-change-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
}
</style>
