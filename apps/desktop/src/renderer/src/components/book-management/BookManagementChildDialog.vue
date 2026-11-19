<script setup lang="ts">
import { useId } from "vue";
import { createScopedTranslator } from "../../i18n";
import AppIcon from "../AppIcon.vue";

defineProps<{ title: string; pending: boolean; confirm?: boolean }>();
const emit = defineEmits<{ close: []; submit: [] }>();
const titleId = useId();
const t = createScopedTranslator("components.plotStructureDialog");
</script>

<template>
  <Teleport to="body">
    <div
      class="dialog-backdrop book-management-child"
      @mousedown.self="!pending && emit('close')"
      @keydown.esc.stop="!pending && emit('close')"
    >
      <form
        class="workspace-dialog"
        :role="confirm ? 'alertdialog' : 'dialog'"
        aria-modal="true"
        :aria-labelledby="titleId"
        @submit.prevent="!pending && emit('submit')"
      >
        <header>
          <h2 :id="titleId">{{ title }}</h2>
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            :disabled="pending"
            @click="emit('close')"
          >
            <AppIcon name="close" :size="16" />
          </button>
        </header>
        <div class="dialog-content">
          <slot />
        </div>
        <footer class="dialog-actions">
          <slot name="actions" />
        </footer>
      </form>
    </div>
  </Teleport>
</template>
