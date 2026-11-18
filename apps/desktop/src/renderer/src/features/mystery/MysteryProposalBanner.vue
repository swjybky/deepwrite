<script setup lang="ts">
import type { MysteryDocumentTarget } from "@deepwrite/contracts";
import { ref } from "vue";
import AppIcon from "../../components/AppIcon.vue";
import type {
  MysteryProposalItem,
  MysteryRestoreNotice
} from "../../stores/mysteryWorkspaceStore";
import { mysteryT } from "./messages";

defineProps<{
  proposals: readonly MysteryProposalItem[];
  lastRestore: MysteryRestoreNotice | undefined;
  busy: boolean;
  canLocate(target: MysteryDocumentTarget): boolean;
}>();

const emit = defineEmits<{
  accept: [proposalId: string];
  reject: [proposalId: string];
  undo: [];
  locate: [target: MysteryDocumentTarget];
}>();

const expandedDiffIds = ref<Record<string, boolean>>({});

function toggleDiff(id: string): void {
  expandedDiffIds.value = {
    ...expandedDiffIds.value,
    [id]: !expandedDiffIds.value[id]
  };
}
</script>

<template>
  <section
    v-if="proposals.length > 0 || lastRestore"
    class="mystery-proposal-stack"
    aria-live="polite"
  >
    <div v-if="proposals.length > 0" class="mystery-proposal-head">
      <strong>{{
        mysteryT("proposalPendingHeader", { count: proposals.length })
      }}</strong>
    </div>

    <article
      v-for="proposal in proposals"
      :key="proposal.id"
      class="mystery-proposal-card"
    >
      <div class="mystery-proposal-head">
        <h4 class="mystery-proposal-title">{{ proposal.summary }}</h4>
        <button
          v-if="proposal.fileChanges.length > 0"
          type="button"
          class="mystery-mini-btn"
          @click="toggleDiff(proposal.id)"
        >
          {{
            expandedDiffIds[proposal.id]
              ? mysteryT("proposalDiffHide")
              : mysteryT("proposalDiffShow")
          }}
        </button>
      </div>

      <ul
        v-if="proposal.structureChanges.length || proposal.fileChanges.length"
        class="mystery-proposal-list"
      >
        <li v-for="(line, i) in proposal.structureChanges" :key="`s-${i}`">
          {{ line }}
        </li>
        <li v-for="(fc, i) in proposal.fileChanges" :key="`f-${i}`">
          <button
            v-if="canLocate(fc.target)"
            class="mystery-proposal-file"
            type="button"
            @click="emit('locate', fc.target)"
          >
            <AppIcon name="file" :size="14" />{{ fc.title }}
          </button>
          <span v-else>{{ fc.title }}</span>
        </li>
      </ul>

      <div v-if="expandedDiffIds[proposal.id]" class="mystery-diff-preview">
        <div v-for="fc in proposal.fileChanges" :key="fc.targetKey">
          <div class="mystery-diff-file-title">{{ fc.title }}</div>
          <pre class="mystery-diff-snippet">{{
            fc.afterText.slice(0, 1200)
          }}</pre>
        </div>
      </div>

      <p
        v-if="proposal.errorMessage"
        class="mystery-proposal-list"
        role="alert"
      >
        {{ proposal.errorMessage }}
      </p>

      <div class="mystery-proposal-actions">
        <button
          type="button"
          class="mystery-btn-secondary"
          :disabled="proposal.status === 'applying' || busy"
          @click="emit('reject', proposal.id)"
        >
          {{ mysteryT("proposalReject") }}
        </button>
        <button
          type="button"
          class="mystery-btn-primary"
          :disabled="proposal.status === 'applying' || busy"
          @click="emit('accept', proposal.id)"
        >
          <AppIcon name="check" :size="14" />
          <span>{{
            proposal.status === "applying"
              ? mysteryT("proposalApplying")
              : mysteryT("proposalAccept")
          }}</span>
        </button>
      </div>
    </article>

    <button
      v-if="lastRestore"
      type="button"
      class="mystery-mini-btn"
      :disabled="busy"
      @click="emit('undo')"
    >
      <AppIcon name="undo" :size="14" />
      <span>{{
        mysteryT("proposalUndoLast", { summary: lastRestore.summary })
      }}</span>
    </button>
  </section>
</template>
