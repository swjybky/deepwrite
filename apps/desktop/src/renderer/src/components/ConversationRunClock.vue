<script setup lang="ts">
import { useConversationActivityClock } from "../composables/useConversationActivityClock";
const props = defineProps<{ active: boolean }>();
const now = useConversationActivityClock(() => props.active);
</script>

<template>
  <slot :now="now" />
</template>
