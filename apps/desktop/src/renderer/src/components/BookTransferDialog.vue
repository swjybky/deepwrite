<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import AppIcon from "./AppIcon.vue";

export type BookTransferDialogMode = "open" | "import";
export type BookTransferAction =
  "open-book" | "open-long-book" | "import-continuation-long-book";

const props = defineProps<{
  mode: BookTransferDialogMode | null;
  pending?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  select: [action: BookTransferAction];
}>();

const options = computed(() =>
  props.mode === "open"
    ? [
        {
          action: "open-book" as const,
          icon: "folder" as const,
          title: "普通书籍或剧本",
          description: "打开 DeepWrite 短篇或剧本项目文件夹"
        },
        {
          action: "open-long-book" as const,
          icon: "book" as const,
          title: "长篇作品",
          description: "打开 DeepWrite 长篇作品文件夹"
        }
      ]
    : [
        {
          action: "import-continuation-long-book" as const,
          icon: "edit" as const,
          title: "续写导入（TXT 章节）",
          description: "从章节文件夹新建长篇，并封存除最后一章外的历史正文"
        }
      ]
);

function requestClose(): void {
  if (!props.pending) emit("close");
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.mode && event.key === "Escape") requestClose();
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="mode" class="dialog-backdrop" @mousedown.self="requestClose">
      <section
        class="workspace-dialog book-transfer-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-transfer-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">创作空间</span>
            <h2 id="book-transfer-title">
              {{ mode === "open" ? "打开已有作品" : "导入已有作品" }}
            </h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            aria-label="关闭"
            :disabled="pending"
            @click="requestClose"
          >
            ×
          </button>
        </header>

        <div class="dialog-content book-transfer-content">
          <p>
            请选择{{
              mode === "open" ? "作品类型" : "来源格式"
            }}，随后将在系统窗口中选择对应文件。
          </p>
          <div class="book-transfer-options">
            <button
              v-for="option in options"
              :key="option.action"
              class="book-transfer-option"
              type="button"
              :disabled="pending"
              @click="emit('select', option.action)"
            >
              <span class="book-transfer-option-icon">
                <AppIcon :name="option.icon" :size="20" />
              </span>
              <span>
                <strong>{{ option.title }}</strong>
                <small>{{ option.description }}</small>
              </span>
              <AppIcon name="chevron" :size="14" />
            </button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.book-transfer-dialog {
  width: min(520px, calc(100vw - 40px));
  border-color: var(--theme-line);
  background: var(--surface-main);
}

.book-transfer-content {
  display: grid;
  gap: 14px;
}

.book-transfer-content > p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.785714rem;
  line-height: 1.6;
}

.book-transfer-options {
  display: grid;
  gap: 8px;
}

.book-transfer-option {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  width: 100%;
  min-height: 64px;
  padding: 10px 12px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-family: var(--ui-font);
  text-align: left;
  cursor: pointer;
}

.book-transfer-option:hover {
  border-color: var(--theme-line);
  background: var(--surface-hover);
  color: var(--text-primary);
}

.book-transfer-option:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
  outline-offset: 1px;
}

.book-transfer-option:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.book-transfer-option-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 9px;
  background: var(--surface-muted);
  color: var(--text-secondary);
}

.book-transfer-option > span:nth-child(2) {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.book-transfer-option strong {
  color: var(--text-primary);
  font-size: 0.857143rem;
}

.book-transfer-option small {
  color: var(--text-tertiary);
  font-size: 0.714286rem;
  line-height: 1.45;
}
</style>
