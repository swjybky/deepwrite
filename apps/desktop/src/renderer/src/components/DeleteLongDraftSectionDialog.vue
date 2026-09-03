<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import AppIcon from "./AppIcon.vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    sectionTitle: string;
    pending?: boolean;
    eyebrow?: string;
    itemLabel?: string;
    description?: string;
  }>(),
  {
    pending: false,
    eyebrow: "正文",
    itemLabel: "小节",
    description:
      "将永久删除该小节及对应章卡、章节正文、章末人物状态、下一章接续包，以及相关剧情落点和伏笔触点。"
  }
);

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();

function close(): void {
  if (!props.pending) emit("close");
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === "Escape") close();
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="dialog-backdrop delete-long-draft-section-overlay"
      @mousedown.self="close"
    >
      <section
        class="delete-long-draft-section-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-long-draft-section-title"
        aria-describedby="delete-long-draft-section-description"
      >
        <header>
          <div>
            <span>{{ eyebrow }}</span>
            <h2 id="delete-long-draft-section-title">删除{{ itemLabel }}</h2>
          </div>
          <button
            class="close-button"
            type="button"
            :aria-label="`关闭删除${itemLabel}弹窗`"
            :disabled="pending"
            @click="close"
          >
            <AppIcon name="close" :size="16" />
          </button>
        </header>

        <div class="dialog-body">
          <strong>确认删除“{{ sectionTitle }}”？</strong>
          <p id="delete-long-draft-section-description" tabindex="0">
            {{ description }}
          </p>
        </div>

        <footer>
          <button type="button" :disabled="pending" @click="close">取消</button>
          <button
            class="danger-button"
            type="button"
            :disabled="pending"
            @click="emit('confirm')"
          >
            {{ pending ? "删除中…" : "确认删除" }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.delete-long-draft-section-overlay {
  z-index: 2400;
  padding: 1rem;
}

.delete-long-draft-section-dialog {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(32rem, 94vw);
  height: min(420px, calc(100vh - 2rem));
  overflow: hidden;
  border: 1px solid var(--theme-line);
  border-radius: 1rem;
  background: var(--surface-raised);
  box-shadow: 0 1.4rem 4rem
    color-mix(in srgb, var(--text-primary) 18%, transparent);
  color: var(--text-primary);
}

header,
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

header {
  padding: 1rem 1.1rem;
  border-bottom: 1px solid var(--theme-line-soft);
}

header span {
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

h2 {
  margin: 0.2rem 0 0;
  font-size: 1.05rem;
}

.close-button {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
}

.dialog-body {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  gap: 0.5rem;
  padding: 1.1rem;
  overflow: hidden;
}

.dialog-body strong {
  font-size: 0.95rem;
}

.dialog-body p {
  min-height: 0;
  margin: 0;
  padding-right: 0.5rem;
  overflow-y: auto;
  overflow-wrap: anywhere;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  color: var(--text-secondary);
  font-size: 0.82rem;
  line-height: 1.55;
}

footer {
  justify-content: flex-end;
  padding: 0.9rem 1.1rem;
  border-top: 1px solid var(--theme-line-soft);
  border-radius: 0 0 1rem 1rem;
  background: var(--surface-muted);
}

button {
  min-height: 2.25rem;
  padding: 0.45rem 0.85rem;
  border: 1px solid var(--theme-line);
  border-radius: 0.65rem;
  background: var(--surface-main);
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
}

button:hover:not(:disabled) {
  background: var(--surface-hover);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.danger-button {
  border-color: var(--danger);
  background: var(--danger);
  color: #fff;
}

.danger-button:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--danger) 86%, var(--text-primary));
  background: color-mix(in srgb, var(--danger) 86%, var(--text-primary));
}
</style>
