<script setup lang="ts">
import type {
  SyncAdoptionSide,
  SyncIssue
} from "@deepwrite/contracts/renderer";
import SyncAdoptionButtons from "./SyncAdoptionButtons.vue";
defineProps<{ issue: SyncIssue; pending: boolean }>();
const emit = defineEmits<{ resolve: [side: SyncAdoptionSide] }>();
</script>
<template>
  <section class="sync-card">
    <h3>{{ issue.title }}</h3>
    <p>{{ issue.message }}</p>
    <p v-if="issue.paths.length">涉及文件：{{ issue.paths.join("、") }}</p>
    <template v-if="issue.reason === 'conflict' || issue.reason === 'delete'">
      <p
        v-if="
          issue.local &&
          issue.versions.length > 0 &&
          issue.versions.every((version) => version.item === null)
        "
      >
        远端版本已删除此项，采用远端会同步删除；采用本地会保留并上传。
      </p>
      <div class="sync-actions">
        <SyncAdoptionButtons
          :title="issue.title"
          :pending="pending"
          @resolve="(side) => emit('resolve', side)"
        />
      </div>
    </template>
  </section>
</template>
