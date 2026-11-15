<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { nextTick, ref, watch } from "vue";

const t = createScopedTranslator("components.startupAlertDialog");

const props = defineProps<{
  open: boolean;
  messages: readonly string[];
  title?: string;
  emptyText?: string;
  loading?: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const confirmButton = ref<HTMLButtonElement | null>(null);

watch(
  () => props.open,
  (open) => {
    if (open) {
      void nextTick(() => confirmButton.value?.focus());
    }
  },
  { immediate: true }
);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && (messages.length > 0 || emptyText)"
      class="dialog-backdrop startup-alert-backdrop"
      role="presentation"
      @keydown.esc.stop="emit('close')"
    >
      <section
        :class="['startup-alert-dialog', { 'has-sidebar': $slots.sidebar }]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="startup-alert-title"
        aria-describedby="startup-alert-content"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">DeepWrite</span>
            <h2 id="startup-alert-title">
              {{ title ?? t("reminder") }}
            </h2>
          </div>
          <button
            class="icon-button startup-alert-close"
            type="button"
            :aria-label="t('closeReminder')"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div class="startup-alert-body">
          <aside v-if="$slots.sidebar" class="startup-alert-sidebar">
            <slot name="sidebar" />
          </aside>
          <div
            id="startup-alert-content"
            class="startup-alert-content"
            :aria-busy="loading"
            aria-live="polite"
          >
            <slot name="content-heading" />
            <p v-if="messages.length === 0" class="startup-alert-empty">
              {{ emptyText }}
            </p>
            <div v-else class="startup-alert-lead">
              <span>{{ t("announcement") }}</span>
              <p>{{ messages[0] }}</p>
            </div>

            <ol
              v-if="messages.length > 1"
              class="startup-alert-list"
              :aria-label="t('moreReminders')"
            >
              <li
                v-for="(message, index) in messages.slice(1)"
                :key="`${index + 1}:${message}`"
              >
                <span class="startup-alert-index" aria-hidden="true">
                  {{ String(index + 1).padStart(2, "0") }}
                </span>
                <p>{{ message }}</p>
              </li>
            </ol>
          </div>
        </div>

        <footer class="dialog-actions">
          <button
            ref="confirmButton"
            class="dialog-primary-button"
            type="button"
            @click="emit('close')"
          >
            {{ t("gotIt") }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.startup-alert-backdrop {
  z-index: 500;
  padding: 24px;
}

.startup-alert-dialog {
  display: flex;
  flex-direction: column;
  width: min(560px, calc(100vw - 48px));
  max-height: min(640px, calc(100vh - 60px));
  overflow: hidden;
  border: 1px solid var(--theme-line);
  border-radius: 15px;
  background: var(--surface-raised);
  color: var(--text-primary);
  box-shadow:
    0 24px 70px rgb(0 0 0 / 20%),
    0 2px 8px rgb(0 0 0 / 8%);
}

.startup-alert-dialog > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 28px 18px;
  border-bottom: 1px solid var(--theme-line-soft);
}

.startup-alert-dialog h2 {
  margin: 4px 0 0;
  font-size: 1.5rem;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.startup-alert-close {
  flex: 0 0 auto;
  color: var(--text-secondary);
  font-size: 1.45rem;
  line-height: 1;
}

.startup-alert-body {
  display: flex;
  min-height: 0;
}

.startup-alert-dialog.has-sidebar {
  width: min(860px, calc(100vw - 48px));
}

.startup-alert-sidebar {
  flex: 0 0 13rem;
  min-width: 0;
  overflow: auto;
  padding: 20px 12px;
  border-right: 1px solid var(--theme-line-soft);
}

.startup-alert-body > .startup-alert-content {
  flex: 1;
  min-width: 0;
}

.startup-alert-content {
  display: grid;
  grid-auto-rows: max-content;
  gap: 22px;
  min-height: 0;
  overflow: auto;
  padding: 26px 28px 24px;
}

.startup-alert-lead {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  padding: 20px 22px 22px;
  border: 1px solid
    color-mix(in srgb, var(--accent) 24%, var(--theme-line-soft));
  border-radius: 13px;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--accent) 12%, var(--surface-raised)),
    color-mix(in srgb, var(--accent) 4%, var(--surface-muted))
  );
}

.startup-alert-empty {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.7;
}

.startup-alert-lead::after {
  position: absolute;
  z-index: -1;
  top: -54px;
  right: -34px;
  width: 132px;
  height: 132px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  content: "";
  filter: blur(2px);
}

.startup-alert-lead > span {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 14%, var(--surface-raised));
  color: var(--accent);
  font-size: 0.714286rem;
  font-weight: 650;
  letter-spacing: 0.08em;
}

.startup-alert-lead p {
  margin: 12px 0 0;
  color: var(--text-primary);
  font-size: 1.08rem;
  font-weight: 590;
  line-height: 1.65;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.startup-alert-list {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.startup-alert-list li {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: start;
  gap: 13px;
  padding: 15px 2px;
  border-bottom: 1px solid var(--theme-line-soft);
}

.startup-alert-list li:first-child {
  padding-top: 0;
}

.startup-alert-list li:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.startup-alert-index {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--theme-line));
  border-radius: 9px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.68rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
}

.startup-alert-list p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.96rem;
  line-height: 1.7;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.startup-alert-dialog > footer {
  padding: 0 28px 24px;
}

@media (max-width: 620px) {
  .startup-alert-sidebar {
    flex-basis: 9rem;
    padding: 14px 8px;
  }

  .startup-alert-backdrop {
    padding: 14px;
  }

  .startup-alert-dialog {
    width: calc(100vw - 28px);
    max-height: calc(100vh - 28px);
  }

  .startup-alert-dialog > header,
  .startup-alert-content {
    padding-right: 18px;
    padding-left: 18px;
  }

  .startup-alert-dialog > footer {
    padding-right: 18px;
    padding-left: 18px;
  }

  .startup-alert-content {
    gap: 18px;
  }

  .startup-alert-lead {
    padding: 17px 18px 19px;
  }
}
</style>
