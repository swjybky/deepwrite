<script setup lang="ts">
import { computed } from "vue";
import type { AgentTeamWorkspaceType } from "@deepwrite/contracts";
import { useBookAgentTeamCatalog } from "../composables/useBookAgentTeamBinding";
import { createScopedTranslator } from "../i18n";
import AppIcon from "./AppIcon.vue";
import PopupSelect from "./PopupSelect.vue";

const t = createScopedTranslator("components.bookAgentTeamBindings");

const props = defineProps<{
  workspaceType: AgentTeamWorkspaceType;
  modelValue: readonly string[];
  disabled?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [teamIds: string[]] }>();

const { catalog, loaded } = useBookAgentTeamCatalog();
const teams = computed(() =>
  (catalog.value?.teams ?? []).filter(
    (team) => team.workspaceType === props.workspaceType
  )
);
const options = computed(() => [
  { value: "", label: t("addATeam") },
  ...teams.value
    .filter((team) => !props.modelValue.includes(team.id))
    .map((team) => ({ value: team.id, label: team.name }))
]);
const enabledTeamName = computed(() => {
  const enabledId = catalog.value?.enabledTeamIds[props.workspaceType];
  return teams.value.find((team) => team.id === enabledId)?.name;
});
const hint = computed(() => {
  if (props.modelValue.length > 0) return t("onlyTheBoundTeamsRun");
  return enabledTeamName.value
    ? t("usesTheEnabledTeam", { name: enabledTeamName.value })
    : t("usesTheEnabledTeamNoneEnabled");
});

function teamLabel(id: string): string {
  return (
    catalog.value?.teams.find((team) => team.id === id)?.name ??
    t("unavailableTeam")
  );
}

function add(value: unknown): void {
  const id = String(value ?? "").trim();
  if (id && !props.modelValue.includes(id)) {
    emit("update:modelValue", [...props.modelValue, id]);
  }
}

function remove(id: string): void {
  emit(
    "update:modelValue",
    props.modelValue.filter((candidate) => candidate !== id)
  );
}
</script>

<template>
  <section
    class="create-short-binding-panel"
    aria-labelledby="book-agent-team-heading"
  >
    <div class="create-short-binding-heading">
      <span class="create-short-binding-icon"
        ><AppIcon name="brain" :size="17"
      /></span>
      <div>
        <h3 id="book-agent-team-heading">{{ t("bindAgentTeams") }}</h3>
        <p>{{ t("optionalBindOneOrMoreTeams") }}</p>
      </div>
    </div>

    <div v-if="modelValue.length" class="book-agent-team-chips">
      <span v-for="id in modelValue" :key="id" class="book-agent-team-chip">
        {{ teamLabel(id) }}
        <button
          type="button"
          :aria-label="t('unbindValue', { name: teamLabel(id) })"
          :disabled="disabled"
          @click="remove(id)"
        >
          ×
        </button>
      </span>
    </div>
    <PopupSelect
      model-value=""
      :options="options"
      :accessible-label="t('addATeam')"
      size="large"
      :disabled="disabled || !loaded || options.length <= 1"
      :menu-min-width="260"
      :menu-z-index="230"
      @update:model-value="add"
    />
    <p class="create-short-stable-hint">{{ hint }}</p>
  </section>
</template>

<style scoped src="./book-agent-team-bindings.css"></style>
