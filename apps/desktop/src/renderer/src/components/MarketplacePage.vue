<script setup lang="ts">
import { ref, watch } from "vue";
import type {
  AgentTeamCatalogSnapshot,
  CatalogSnapshot,
  MarketplaceSession
} from "@deepwrite/contracts";
import { createScopedTranslator } from "../i18n";
import {
  SkillMarketplacePage,
  AgentTeamMarketplacePage
} from "./lazyAppComponents";

const props = defineProps<{
  initialTab: "skills" | "teams";
  catalogSnapshot: CatalogSnapshot | null;
  catalog: AgentTeamCatalogSnapshot | null;
  initialSession: MarketplaceSession | null;
}>();
const emit = defineEmits<{
  refreshCatalog: [];
  sessionChange: [session: MarketplaceSession];
  catalogChange: [catalog: AgentTeamCatalogSnapshot];
}>();
const t = createScopedTranslator("components.workspaceFeatureModules");
const tab = ref(props.initialTab);
const session = ref(props.initialSession);
watch(
  () => props.initialTab,
  (next) => {
    tab.value = next;
  }
);
watch(
  () => props.initialSession,
  (next) => {
    session.value = next;
  }
);
function updateSession(next: MarketplaceSession) {
  session.value = next;
  emit("sessionChange", next);
}
function moveTab(event: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  tab.value =
    event.key === "Home"
      ? "skills"
      : event.key === "End"
        ? "teams"
        : tab.value === "skills"
          ? "teams"
          : "skills";
  document.getElementById(`marketplace-tab-${tab.value}`)?.focus();
}
</script>

<template>
  <section class="combined-marketplace">
    <nav
      class="combined-marketplace-tabs"
      role="tablist"
      :aria-label="t('marketplace')"
      @keydown="moveTab"
    >
      <button
        v-for="item in ['skills', 'teams'] as const"
        :id="`marketplace-tab-${item}`"
        :key="item"
        type="button"
        role="tab"
        :aria-selected="tab === item"
        aria-controls="marketplace-panel"
        :tabindex="tab === item ? 0 : -1"
        @click="tab = item"
      >
        {{ t(item) }}
      </button>
    </nav>
    <div
      id="marketplace-panel"
      class="combined-marketplace-panel"
      role="tabpanel"
      :aria-labelledby="`marketplace-tab-${tab}`"
    >
      <SkillMarketplacePage
        v-if="tab === 'skills'"
        active
        :catalog-snapshot="catalogSnapshot"
        :initial-session="session"
        @refresh-catalog="emit('refreshCatalog')"
        @session-change="updateSession"
      />
      <AgentTeamMarketplacePage
        v-else
        :catalog="catalog"
        :initial-session="session"
        @session-change="updateSession"
        @catalog-change="emit('catalogChange', $event)"
      />
    </div>
  </section>
</template>

<style scoped>
.combined-marketplace {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
}
.combined-marketplace-tabs {
  display: flex;
  flex-shrink: 0;
  gap: 28px;
  margin: 12px clamp(22px, 4vw, 54px) 0;
  border-bottom: 1px solid var(--theme-line-soft);
}
.combined-marketplace-tabs button {
  position: relative;
  min-height: 40px;
  padding: 10px 2px 12px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-weight: 600;
  line-height: 1.5;
  cursor: pointer;
}
.combined-marketplace-tabs button[aria-selected="true"] {
  color: var(--text-primary);
}
.combined-marketplace-tabs button[aria-selected="true"]::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  border-radius: 2px;
  background: var(--accent);
  content: "";
}
.combined-marketplace-tabs button:hover {
  color: var(--text-primary);
}
.combined-marketplace-tabs button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 4px;
  border-radius: 2px;
}
.combined-marketplace-panel {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.combined-marketplace-panel :deep(.marketplace-page),
.combined-marketplace-panel :deep(.team-plaza-page) {
  padding-top: 24px;
}
</style>
