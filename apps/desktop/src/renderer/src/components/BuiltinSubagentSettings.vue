<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import type { BuiltinSubagentSettings } from "@deepwrite/contracts/renderer";
import { useBuiltinSubagentSettings } from "../composables/useBuiltinSubagentSettings";
import AgentTeamSwitch from "./AgentTeamSwitch.vue";

const t = createScopedTranslator("components.builtinSubagentSettings");

const MANAGEMENT_TOOL_NAMES = {
  get skill() {
    return t("skillManager");
  },
  get material() {
    return t("materialManager");
  },
  get team() {
    return t("teamManager");
  }
};

defineProps<{
  settings: BuiltinSubagentSettings;
  disabled?: boolean;
}>();
const domains = ["skill", "material", "team"] as const;
const { setEnabled } = useBuiltinSubagentSettings();
</script>

<template>
  <section
    class="builtin-managers"
    :aria-label="t('builtInManagementSubagents')"
  >
    <header>
      <h3>
        {{ t("builtInManagementSubagents") }}
      </h3>
      <p>
        {{ t("sharedByStandardAndTeamModesCalledOnlyWhen") }}
      </p>
    </header>
    <div class="manager-list">
      <article v-for="domain in domains" :key="domain">
        <div class="manager-heading">
          <div class="manager-title">
            <h4>{{ MANAGEMENT_TOOL_NAMES[domain] }}</h4>
            <span class="manager-status">
              <span
                class="status-dot"
                :class="{ 'is-enabled': settings[domain].enabled }"
                aria-hidden="true"
              />
              {{ settings[domain].enabled ? t("enabled") : t("disabled") }}
            </span>
          </div>
          <AgentTeamSwitch
            :model-value="settings[domain].enabled"
            :disabled="disabled"
            :label="
              t('enabledStatus', {
                arg0: MANAGEMENT_TOOL_NAMES[domain]
              })
            "
            @update:model-value="setEnabled(domain, $event)"
          />
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.builtin-managers {
  color: var(--text-primary);
}
h3,
h4 {
  margin: 0;
}
h3 {
  font-size: 1.07143rem;
  font-weight: 650;
}
h4 {
  font-size: 0.928571rem;
  font-weight: 620;
}
p {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 0.892857rem;
  line-height: 1.55;
}
.manager-list {
  margin-top: 12px;
  overflow: hidden;
  border: 1px solid var(--theme-line);
  border-radius: 14px;
  background: var(--surface-raised);
}
article {
  min-width: 0;
  padding: 14px 18px;
}
article + article {
  border-top: 1px solid var(--theme-line-soft);
}
.manager-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.manager-title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex-wrap: wrap;
}
.manager-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 0.8125em;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-tertiary);
}
.status-dot.is-enabled {
  background: var(--accent);
}
</style>
