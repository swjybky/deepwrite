<script setup lang="ts">
import type { AgentEditProposal } from "../types/conversation";
import AppIcon from "./AppIcon.vue";
import ConversationDetails from "./ConversationDetails.vue";
defineProps<{ proposal: AgentEditProposal }>();

function diffLineMark(type: "context" | "addition" | "deletion"): string {
  if (type === "addition") return "+";
  if (type === "deletion") return "−";
  return " ";
}
</script>

<template>
  <ConversationDetails
    v-if="proposal.hunks.length"
    :detail-id="`${proposal.id}:diff`"
    class="edit-proposal-diff"
  >
    <template #summary>
      <span>查看差异</span>
      <small>{{ proposal.hunks.length }} 个变更块</small>
      <AppIcon name="chevron" :size="13" />
    </template>
    <div class="edit-diff-content">
      <div
        v-for="(hunk, hunkIndex) in proposal.hunks"
        :key="`${proposal.id}-hunk-${hunkIndex}`"
        class="edit-diff-hunk"
      >
        <div class="edit-diff-hunk-header">
          @@ -{{ hunk.oldStart }},{{ hunk.oldLines }} +{{ hunk.newStart }},{{
            hunk.newLines
          }}
          @@
        </div>
        <div
          v-for="(line, lineIndex) in hunk.lines"
          :key="`${proposal.id}-${hunkIndex}-${lineIndex}`"
          class="edit-diff-line"
          :class="`is-${line.type}`"
        >
          <span class="edit-diff-line-number">{{
            line.oldLineNumber ?? ""
          }}</span>
          <span class="edit-diff-line-number">{{
            line.newLineNumber ?? ""
          }}</span>
          <span class="edit-diff-line-mark" aria-hidden="true">
            {{ diffLineMark(line.type) }}
          </span>
          <code>{{ line.text }}</code>
        </div>
      </div>
      <p v-if="proposal.truncated" class="edit-diff-truncated">
        差异较大，仅显示部分变更；行数统计包含完整提案。
      </p>
    </div>
  </ConversationDetails>
  <p v-else class="edit-proposal-empty">没有可显示的行级差异。</p>
</template>
