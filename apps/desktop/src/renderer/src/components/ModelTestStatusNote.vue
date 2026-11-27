<script setup lang="ts">
import { computed } from "vue";
import { createScopedTranslator } from "../i18n";
import {
  shouldDisplayModelTestStatus,
  type ModelTestStateEntry
} from "../utils/modelTestState";

const tc = createScopedTranslator("workspace.modelSettingsCoordinator");

const props = defineProps<{
  entry: ModelTestStateEntry | undefined;
  currentSignature?: string;
}>();

const visibleEntry = computed(() =>
  shouldDisplayModelTestStatus(props.entry, props.currentSignature)
    ? props.entry
    : undefined
);

const displayMessage = computed(() => {
  const entry = visibleEntry.value;
  if (!entry) return "";
  if (entry.status === "testing") return tc("testingConnection");
  if (entry.status === "cancelling") return tc("cancelingConnectionTest");
  if (entry.status === "cancelled") return tc("modelConnectionTestCanceled");
  if (entry.status === "failed" && entry.errorCode === "models.test_timeout") {
    return tc("modelConnectionTestTimedOut");
  }
  return entry.message;
});
</script>

<template>
  <small
    v-if="visibleEntry"
    class="model-test-status-note"
    :class="`is-${visibleEntry.status}`"
    role="status"
    aria-live="polite"
  >
    <span class="model-test-status-dot" aria-hidden="true" />
    <span>{{ displayMessage }}</span>
  </small>
</template>

<style scoped>
.model-test-status-note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  color: var(--text-secondary);
  font-size: 0.785714rem;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.model-test-status-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
  background: var(--text-tertiary);
}

.model-test-status-note.is-testing .model-test-status-dot,
.model-test-status-note.is-cancelling .model-test-status-dot {
  background: var(--accent);
  animation: model-test-pulse 1.2s ease-in-out infinite;
}

.model-test-status-note.is-succeeded .model-test-status-dot {
  background: var(--success);
}

.model-test-status-note.is-failed {
  color: var(--danger-text);
}

.model-test-status-note.is-failed .model-test-status-dot {
  background: var(--danger);
}

.model-test-status-note.is-cancelled {
  color: var(--text-tertiary);
}

@keyframes model-test-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .model-test-status-note.is-testing .model-test-status-dot,
  .model-test-status-note.is-cancelling .model-test-status-dot {
    animation: none;
  }
}
</style>
