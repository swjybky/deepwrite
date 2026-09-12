<script setup lang="ts">
import type { SyncAdoptionSide } from "@deepwrite/contracts/renderer";
defineProps<{ pending: boolean; all?: boolean; title?: string }>();
const emit = defineEmits<{ resolve: [side: SyncAdoptionSide] }>();
</script>
<template>
  <button
    class="sync-button secondary"
    :disabled="pending"
    :aria-label="title ? `${title}：采用远端` : undefined"
    @click="emit('resolve', 'remote')"
  >
    {{ all ? "全部采用远端" : "采用远端" }}
  </button>
  <button
    class="sync-button secondary"
    :disabled="pending"
    :aria-label="title ? `${title}：采用本地` : undefined"
    @click="emit('resolve', 'local')"
  >
    {{ all ? "全部采用本地" : "采用本地" }}
  </button>
</template>
