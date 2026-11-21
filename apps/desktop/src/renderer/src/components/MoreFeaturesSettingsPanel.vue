<script setup lang="ts">
import { computed } from "vue";
import type { MoreFeatureId, MoreFeaturesSettings } from "@deepwrite/contracts";
import { createDefaultMoreFeaturesSettings } from "@deepwrite/contracts/renderer";
import { createScopedTranslator } from "../i18n";
import AgentTeamSwitch from "./AgentTeamSwitch.vue";
import AppIcon from "./AppIcon.vue";
import { configuredMoreFeatures } from "./sidebarMoreFeatures";

const t = createScopedTranslator("components.moreFeaturesSettings");
const props = defineProps<{ settings: MoreFeaturesSettings }>();
const emit = defineEmits<{ update: [settings: MoreFeaturesSettings] }>();
const features = computed(() => configuredMoreFeatures(props.settings));

function setVisible(id: MoreFeatureId, visible: boolean): void {
  emit(
    "update",
    props.settings.map((entry) =>
      entry.id === id ||
      (id === "skill-marketplace" && entry.id === "agent-team-marketplace")
        ? { ...entry, visible }
        : entry
    )
  );
}

function moveFeature(index: number, direction: -1 | 1): void {
  const target = index + direction;
  if (target < 0 || target >= features.value.length) return;
  const next = features.value.map(({ id, visible }) => ({ id, visible }));
  [next[index], next[target]] = [next[target]!, next[index]!];
  next.push({ id: "agent-team-marketplace", visible: false });
  props.settings.forEach((preference, index) => {
    if (!next.some(({ id }) => id === preference.id)) {
      next.splice(index, 0, preference);
    }
  });
  emit("update", next);
}
</script>

<template>
  <section class="settings-group more-features-settings">
    <div class="more-features-heading">
      <div>
        <h2 class="settings-group-title">{{ t("displayAndOrder") }}</h2>
        <p class="more-features-description">{{ t("description") }}</p>
      </div>
      <button
        type="button"
        class="dialog-primary-button"
        @click="emit('update', createDefaultMoreFeaturesSettings())"
      >
        {{ t("restoreDefaults") }}
      </button>
    </div>

    <div class="settings-card">
      <div
        v-for="({ feature, visible }, index) in features"
        :key="feature.id"
        class="settings-item more-features-row"
        :data-more-feature-id="feature.id"
      >
        <span class="more-features-icon"
          ><AppIcon :name="feature.icon" :size="18"
        /></span>
        <span class="settings-item-text">
          <strong>{{ feature.label }}</strong>
          <small>{{ feature.description }}</small>
        </span>
        <div class="more-features-controls">
          <button
            type="button"
            class="more-features-move"
            :disabled="index === 0"
            :aria-label="t('moveUp', { name: feature.label })"
            :title="t('moveUp', { name: feature.label })"
            @click="moveFeature(index, -1)"
          >
            <AppIcon name="arrow-up" :size="15" />
          </button>
          <button
            type="button"
            class="more-features-move more-features-move-down"
            :disabled="index === features.length - 1"
            :aria-label="t('moveDown', { name: feature.label })"
            :title="t('moveDown', { name: feature.label })"
            @click="moveFeature(index, 1)"
          >
            <AppIcon name="arrow-up" :size="15" />
          </button>
          <span class="settings-toggle">
            <AgentTeamSwitch
              :model-value="visible"
              :label="t('showFeature', { name: feature.label })"
              @update:model-value="setVisible(feature.id, $event)"
            />
          </span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped src="./settings-page.css"></style>
<style scoped>
.more-features-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 18px;
}

.more-features-heading > div {
  flex: 1 1 240px;
}

.more-features-heading .settings-group-title {
  margin-bottom: 6px;
}

.more-features-description {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.892857rem;
  line-height: 1.6;
}

.more-features-row {
  cursor: default;
  flex-wrap: wrap;
  gap: 12px;
}

.more-features-row .settings-item-text {
  flex: 1 1 180px;
  overflow-wrap: anywhere;
}

.more-features-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  border: 1px solid var(--theme-line-soft);
  border-radius: 9px;
  background: var(--surface-main);
  color: var(--text-secondary);
}

.more-features-controls {
  display: flex;
  align-items: center;
  flex: none;
  gap: 6px;
  margin-left: auto;
}

.more-features-controls .settings-toggle {
  display: flex;
  margin-left: 8px;
}

.more-features-move {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--theme-line-soft);
  border-radius: 7px;
  background: var(--surface-main);
  color: var(--text-secondary);
  cursor: pointer;
}

.more-features-move:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.more-features-move:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.more-features-move:disabled {
  color: var(--text-tertiary);
  opacity: 0.4;
  cursor: not-allowed;
}

.more-features-move-down :deep(svg) {
  transform: rotate(180deg);
}
</style>
