<script setup lang="ts">
import AppIcon from "./AppIcon.vue";

defineProps<{
  left: number;
  top: number;
}>();

const emit = defineEmits<{
  insert: [];
}>();
</script>

<template>
  <Teleport to="body">
    <div
      class="editor-selection-menu"
      role="menu"
      aria-label="正文选区操作"
      :style="{
        left: `${left}px`,
        top: `${top}px`
      }"
    >
      <button
        type="button"
        role="menuitem"
        @mousedown.prevent
        @click="emit('insert')"
      >
        <AppIcon name="message" :size="15" />
        插入输入框
      </button>
    </div>
  </Teleport>
</template>
