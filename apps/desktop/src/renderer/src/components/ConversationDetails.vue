<script setup lang="ts">
import { useConversationDisclosure } from "../composables/conversationDisclosureState";

const props = defineProps<{ detailId: string }>();
const open = useConversationDisclosure(() => props.detailId);

function handleToggle(event: Event): void {
  const details = event.currentTarget;
  if (details instanceof HTMLDetailsElement) open.value = details.open;
}
</script>

<template>
  <details :open="open" @toggle="handleToggle">
    <summary><slot name="summary" /></summary>
    <slot v-if="open" />
  </details>
</template>
