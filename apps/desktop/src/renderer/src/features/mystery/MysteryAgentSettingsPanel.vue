<script setup lang="ts">
import { deepwriteApi } from "../../api/deepwrite";
import {
  MysteryAgentSettingsInputSchema,
  getDefaultMysteryAgentProfile,
  type MysteryAgentSettings
} from "@deepwrite/contracts/renderer";
import { computed, onMounted, ref } from "vue";
import { formatError } from "../../i18n/errors";
import { uiMessage } from "../../ui-feedback";
import { mysteryT } from "./messages";

defineProps<{
  runtimeAvailable: boolean;
}>();

const loading = ref(false);
const saving = ref(false);
const loadError = ref<string | null>(null);
const settings = ref<MysteryAgentSettings | null>(null);

const systemPrompt = ref("");
const shortcuts = ref<[string, string, string]>(["", "", ""]);

const dirty = computed(() => {
  const current = settings.value?.agents[0];
  if (!current) return false;
  return (
    systemPrompt.value !== current.systemPrompt ||
    shortcuts.value.some((val, i) => val !== current.welcomeShortcuts[i])
  );
});

async function loadSettings(): Promise<void> {
  const api = deepwriteApi()?.mystery;
  if (!api) return;
  loading.value = true;
  loadError.value = null;
  try {
    const loaded = await api.listAgents();
    settings.value = loaded;
    const primary = loaded.agents[0];
    if (primary) {
      systemPrompt.value = primary.systemPrompt;
      shortcuts.value = [...primary.welcomeShortcuts];
    }
  } catch (error: unknown) {
    loadError.value = formatError(error, mysteryT("actionFailed"));
  } finally {
    loading.value = false;
  }
}

function resetPrompt(): void {
  const defaults = getDefaultMysteryAgentProfile("mystery");
  systemPrompt.value = defaults.systemPrompt;
  shortcuts.value = [...defaults.welcomeShortcuts];
}

async function save(): Promise<void> {
  const api = deepwriteApi()?.mystery;
  if (!api || saving.value) return;
  const parsed = MysteryAgentSettingsInputSchema.safeParse({
    workspaceType: "mystery",
    agents: [
      {
        id: "mystery",
        systemPrompt: systemPrompt.value,
        welcomeShortcuts: [
          shortcuts.value[0].trim(),
          shortcuts.value[1].trim(),
          shortcuts.value[2].trim()
        ]
      }
    ]
  });
  if (!parsed.success) {
    uiMessage.warning(
      parsed.error.issues[0]?.message ?? mysteryT("saveFailed")
    );
    return;
  }
  saving.value = true;
  try {
    const updated = await api.saveAgents(parsed.data);
    settings.value = updated;
    uiMessage.success(mysteryT("settingsSaved"));
  } catch (error: unknown) {
    uiMessage.error(formatError(error, mysteryT("saveFailed")));
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void loadSettings();
});
</script>

<template>
  <div v-if="loading" class="mystery-settings-state">
    {{ mysteryT("loadingTitle") }}
  </div>
  <div
    v-else-if="loadError && !settings"
    class="mystery-settings-error"
    role="alert"
  >
    <p>{{ loadError }}</p>
    <button type="button" class="mystery-btn-secondary" @click="loadSettings">
      {{ mysteryT("backToList") }}
    </button>
  </div>
  <section v-else class="mystery-agent-settings-card">
    <header class="mystery-settings-header">
      <h3>{{ mysteryT("agentSettingsTitle") }}</h3>
      <p>{{ mysteryT("agentSettingsSubtitle") }}</p>
    </header>

    <div class="mystery-field-row">
      <label for="mystery-agent-system-prompt">
        {{ mysteryT("systemPromptLabel") }}
      </label>
      <textarea
        id="mystery-agent-system-prompt"
        v-model="systemPrompt"
        class="mystery-textarea mystery-prompt-textarea"
        :disabled="!runtimeAvailable || saving"
      />
    </div>

    <fieldset class="mystery-shortcuts-fieldset">
      <legend>{{ mysteryT("welcomeShortcutsLabel") }}</legend>
      <div class="mystery-shortcuts-grid">
        <label
          v-for="idx in [0, 1, 2] as const"
          :key="idx"
          class="mystery-field-row"
        >
          <span>{{ mysteryT("shortcutIndex", { index: idx + 1 }) }}</span>
          <input
            v-model="shortcuts[idx]"
            type="text"
            class="mystery-input"
            maxlength="200"
            :disabled="!runtimeAvailable || saving"
          />
        </label>
      </div>
    </fieldset>

    <footer class="mystery-settings-actions">
      <button
        type="button"
        class="mystery-btn-secondary"
        :disabled="!runtimeAvailable || saving"
        @click="resetPrompt"
      >
        {{ mysteryT("resetDefaultPrompt") }}
      </button>
      <button
        type="button"
        class="mystery-btn-primary"
        :disabled="!runtimeAvailable || saving || !dirty"
        @click="save"
      >
        {{ saving ? mysteryT("saving") : mysteryT("saveSettings") }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.mystery-agent-settings-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
  padding: 20px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-raised);
}

.mystery-settings-header h3 {
  margin: 0;
  font-size: 1.05em;
  color: var(--text-primary);
}

.mystery-settings-header p {
  margin: 6px 0 0;
  color: var(--text-secondary);
  line-height: 1.5;
}

.mystery-field-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mystery-field-row label,
.mystery-shortcuts-fieldset legend {
  font-weight: 600;
  color: var(--text-primary);
}

.mystery-shortcuts-fieldset {
  margin: 0;
  padding: 0;
  border: 0;
}

.mystery-shortcuts-grid {
  display: grid;
  gap: 10px;
  margin-top: 8px;
}

.mystery-input,
.mystery-textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  background: var(--surface-main);
  color: var(--text-primary);
  font: inherit;
}

.mystery-prompt-textarea {
  min-height: 240px;
  line-height: 1.55;
  resize: vertical;
}

.mystery-settings-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.mystery-btn-primary,
.mystery-btn-secondary {
  min-height: 36px;
  padding: 8px 14px;
  border-radius: 8px;
  font: inherit;
  cursor: pointer;
}

.mystery-btn-secondary {
  border: 1px solid var(--theme-line);
  background: var(--surface-raised);
  color: var(--text-primary);
}

.mystery-btn-primary {
  border: 1px solid var(--neutral-solid);
  background: var(--neutral-solid);
  color: var(--surface-main);
}

.mystery-btn-primary:disabled,
.mystery-btn-secondary:disabled {
  opacity: 0.56;
  cursor: not-allowed;
}
</style>
