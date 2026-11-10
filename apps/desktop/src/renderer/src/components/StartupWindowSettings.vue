<script setup lang="ts">
import { ref } from "vue";
import { createScopedTranslator } from "../i18n";
import { useAppearance } from "../composables/useAppearance";
import { uiMessage } from "../ui-feedback";

const t = createScopedTranslator("components.appearanceThemeSettings");
const appearance = useAppearance();
const pending = ref<"capture" | "reset" | null>(null);

async function save(capture: boolean): Promise<void> {
  if (pending.value) return;
  pending.value = capture ? "capture" : "reset";
  try {
    await appearance.saveStartupWindowSize(capture);
    uiMessage.success(t(capture ? "windowSizeSaved" : "windowSizeReset"));
  } catch {
    uiMessage.error(t("windowSizeSaveFailed"));
  } finally {
    pending.value = null;
  }
}
</script>

<template>
  <section
    class="startup-window-settings"
    aria-labelledby="window-size-heading"
  >
    <h2 id="window-size-heading">{{ t("startupWindowSize") }}</h2>
    <div class="window-size-card">
      <div class="window-size-row">
        <span class="window-size-copy">
          <strong>
            {{
              appearance.state.startupWindowSize
                ? `${appearance.state.startupWindowSize.width} × ${appearance.state.startupWindowSize.height}`
                : t("defaultWindowSize")
            }}
          </strong>
          <small>{{ t("startupWindowSizeHelp") }}</small>
        </span>
        <div class="window-size-actions">
          <button
            type="button"
            class="primary"
            :disabled="pending === 'capture'"
            @click="save(true)"
          >
            {{ t("useCurrentWindowSize") }}
          </button>
          <button
            type="button"
            :disabled="pending === 'reset'"
            @click="save(false)"
          >
            {{ t("restoreDefaultWindowSize") }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.startup-window-settings {
  margin-top: 40px;
  color: var(--text-primary);
}
h2 {
  margin: 0 0 14px;
  font-size: 1.07143rem;
  font-weight: 640;
}
.window-size-card {
  padding: 6px 0;
  border: 1px solid var(--theme-line-soft);
  border-radius: 13px;
  background: var(--surface-raised);
}
.window-size-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 18px;
}
.window-size-copy {
  display: flex;
  min-width: min(240px, 100%);
  flex: 1;
  flex-direction: column;
  gap: 3px;
}
.window-size-copy strong {
  font-size: 1rem;
  font-weight: 590;
}
.window-size-copy small {
  color: var(--text-secondary);
  font-size: 0.892857rem;
  line-height: 1.45;
}
.window-size-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  flex: 0 1 240px;
  gap: 8px;
}
button {
  min-width: 112px;
  min-height: 36px;
  padding: 7px 14px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.892857rem;
  font-weight: 570;
  cursor: pointer;
}
button:hover:not(:disabled) {
  background: var(--surface-hover);
}
button.primary {
  background: var(--neutral-solid);
  border-color: color-mix(in srgb, var(--neutral-solid) 88%, transparent);
  color: var(--accent-contrast, #fff);
}
button.primary:hover:not(:disabled) {
  background: color-mix(
    in srgb,
    var(--neutral-solid) 88%,
    var(--theme-foreground)
  );
}
button:disabled {
  opacity: 0.52;
  cursor: not-allowed;
}
@media (max-width: 760px) {
  .window-size-row {
    align-items: stretch;
    flex-direction: column;
  }
  .window-size-actions {
    flex-basis: auto;
  }
}
</style>
