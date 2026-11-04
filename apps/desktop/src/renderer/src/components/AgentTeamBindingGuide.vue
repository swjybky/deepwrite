<script setup lang="ts">
import { createScopedTranslator } from "../i18n";

const t = createScopedTranslator("components.agentTeamBindingGuide");
const rules = [
  { title: "byDefaultTitle", body: "byDefaultBody" },
  { title: "bookBindingTitle", body: "bookBindingBody" },
  { title: "multipleTeamsTitle", body: "multipleTeamsBody" },
  { title: "whereItAppliesTitle", body: "whereItAppliesBody" }
] as const;
</script>

<template>
  <section class="binding-guide" aria-labelledby="team-binding-guide-title">
    <h3 id="team-binding-guide-title">{{ t("howTeamsApply") }}</h3>
    <dl>
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
.binding-guide h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 650;
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
