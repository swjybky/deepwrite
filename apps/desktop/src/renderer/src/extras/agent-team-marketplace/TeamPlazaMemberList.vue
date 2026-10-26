<script setup lang="ts">
import { reactive } from "vue";
import { activeSubagentDraw } from "@deepwrite/contracts/renderer";
import type { ShortAgentSubagentDefinition } from "@deepwrite/contracts";
import { createScopedTranslator } from "../../i18n";
import { agentModeLabel } from "./teamPlazaLabels";

const t = createScopedTranslator("extras.agentTeamMarketplace");

defineProps<{ members: readonly ShortAgentSubagentDefinition[] }>();

const expanded = reactive(new Set<string>());

function togglePrompt(id: string): void {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
}
</script>

<template>
  <ul class="member-list">
    <li v-for="member in members" :key="member.id">
      <div class="plaza-row">
        <strong>{{ member.name }}</strong>
        <button
          type="button"
          class="text-button"
          @click="togglePrompt(member.id)"
        >
          {{ expanded.has(member.id) ? t("hidePrompt") : t("showPrompt") }}
        </button>
      </div>
      <div class="member-tags">
        <span class="badge">{{ agentModeLabel(member.agentMode) }}</span>
        <span v-if="activeSubagentDraw(member)" class="badge">
          {{
            activeSubagentDraw(member)?.countMode === "auto"
              ? t("drawModeAuto")
              : t("drawMode", { count: activeSubagentDraw(member)?.count ?? 0 })
          }}
        </span>
        <span class="badge">{{ t("inheritModel") }}</span>
        <span v-if="!member.enabled" class="badge">{{
          t("memberDisabled")
        }}</span>
      </div>
      <p>{{ member.description }}</p>
      <pre v-if="expanded.has(member.id)" class="member-prompt">{{
        member.systemPrompt
      }}</pre>
    </li>
  </ul>
</template>

<style scoped src="./team-plaza.css"></style>
