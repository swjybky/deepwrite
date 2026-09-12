<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from "vue";
const props = defineProps<{ title: string; busy: boolean }>();
const emit = defineEmits<{ close: []; confirm: [] }>();
const titleId = useId();
const descriptionId = useId();
const cancelButton = ref<HTMLButtonElement>();
const confirmButton = ref<HTMLButtonElement>();
let previousFocus: HTMLElement | null = null;
function close(): void {
  if (!props.busy) emit("close");
}
function keydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.stopPropagation();
    close();
  }
  if (event.key === "Tab") {
    event.preventDefault();
    if (document.activeElement === cancelButton.value)
      confirmButton.value?.focus();
    else cancelButton.value?.focus();
  }
}
onMounted(() => {
  previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  cancelButton.value?.focus();
});
onBeforeUnmount(() => {
  if (previousFocus?.isConnected) previousFocus.focus();
});
</script>
<template>
  <Teleport to="body">
    <div
      class="conversation-delete-backdrop"
      @mousedown.self="close"
      @keydown="keydown"
    >
      <section
        class="conversation-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="descriptionId"
      >
        <h2 :id="titleId">删除“{{ title }}”？</h2>
        <p :id="descriptionId">
          对话会移入“已删除”，可从历史对话中恢复。正在运行或有待处理提案的对话需要先完成处理。
        </p>
        <footer>
          <button
            ref="cancelButton"
            type="button"
            :disabled="busy"
            @click="close"
          >
            取消
          </button>
          <button
            ref="confirmButton"
            class="is-danger"
            type="button"
            :disabled="busy"
            @click="emit('confirm')"
          >
            {{ busy ? "正在删除…" : "确认删除" }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.conversation-delete-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1600;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, var(--text-primary) 24%, transparent);
}
.conversation-delete-dialog {
  width: min(460px, 100%);
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: 24px;
  border: 1px solid var(--theme-line);
  border-radius: 16px;
  color: var(--text-primary);
  background: var(--surface-raised);
  font-family: var(--ui-font);
}
h2 {
  margin: 0;
  font-size: 1.142857rem;
  overflow-wrap: anywhere;
}
p {
  margin: 16px 0 24px;
  color: var(--text-secondary);
  line-height: 1.6;
}
footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
button {
  min-width: 86px;
  min-height: 36px;
  padding: 7px 14px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  background: var(--surface-main);
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
}
button:hover:not(:disabled) {
  background: var(--surface-hover);
}
button.is-danger {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
}
button.is-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 86%, var(--text-primary));
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
</style>
