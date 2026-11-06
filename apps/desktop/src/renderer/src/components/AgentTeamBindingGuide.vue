<script setup lang="ts">
import { ref, useId } from "vue";
import { createScopedTranslator } from "../i18n";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator("components.agentTeamBindingGuide");
const expanded = ref(false);
const titleId = useId();
const contentId = useId();
const rules = [
  { title: "byDefaultTitle", body: "byDefaultBody" },
  { title: "bookBindingTitle", body: "bookBindingBody" },
  { title: "multipleTeamsTitle", body: "multipleTeamsBody" },
  { title: "whereItAppliesTitle", body: "whereItAppliesBody" }
] as const;
</script>

<template>
  <section class="binding-guide" :aria-labelledby="titleId">
    <header class="binding-guide-header">
      <h3 :id="titleId">{{ t("howTeamsApply") }}</h3>
      <button
        type="button"
        class="binding-guide-toggle"
        :aria-expanded="expanded"
        :aria-controls="contentId"
        @click="expanded = !expanded"
      >
        {{ expanded ? t("collapse") : t("expand") }}
        <AppIcon
          class="binding-guide-chevron"
          :class="{ 'is-open': expanded }"
          name="chevron"
          :size="14"
        />
      </button>
    </header>
    <dl v-if="expanded" :id="contentId">
      <div v-for="rule in rules" :key="rule.title">
        <dt>{{ t(rule.title) }}</dt>
        <dd>{{ t(rule.body) }}</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.binding-guide {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-raised);
}
.binding-guide-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.binding-guide h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 650;
}
.binding-guide-toggle {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.857143rem;
  cursor: pointer;
}
.binding-guide-toggle:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}
.binding-guide-toggle:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 45%, transparent);
  outline-offset: 2px;
}
.binding-guide-chevron {
  transition: transform 150ms ease;
}
.binding-guide-chevron.is-open {
  transform: rotate(90deg);
}
.binding-guide dl {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  margin: 0;
}
.binding-guide dt {
  color: var(--text-primary);
  font-size: 0.892857rem;
  font-weight: 600;
}
.binding-guide dd {
  margin: 2px 0 0;
  color: var(--text-secondary);
  font-size: 0.857143rem;
  line-height: 1.55;
}
</style>
