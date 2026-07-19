<script setup lang="ts">
defineProps<{
  open: boolean;
  title: string;
  draftContent: string;
  diskContent: string;
  submitting?: boolean;
}>();

const emit = defineEmits<{
  keep: [];
  reload: [];
  overwrite: [];
}>();
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop">
      <section
        class="workspace-dialog save-conflict-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-conflict-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">外部修改冲突</span>
            <h2 id="save-conflict-title">“{{ title }}”已在其他编辑器中更新</h2>
          </div>
        </header>

        <div class="dialog-content">
          <p class="dialog-description">
            DeepWrite 没有覆盖磁盘内容。可以保留当前草稿、重新加载磁盘版本，或明确确认后用当前草稿覆盖。
          </p>
          <div class="save-conflict-columns">
            <section>
              <strong>当前草稿 · {{ draftContent.length }} 字</strong>
              <pre>{{ draftContent.slice(0, 2000) || "（空内容）" }}</pre>
            </section>
            <section>
              <strong>磁盘版本 · {{ diskContent.length }} 字</strong>
              <pre>{{ diskContent.slice(0, 2000) || "（空内容）" }}</pre>
            </section>
          </div>
          <p v-if="draftContent.length > 2000 || diskContent.length > 2000" class="dialog-note">
            对比预览最多显示前 2,000 字，实际操作仍针对完整内容。
          </p>
          <div class="dialog-actions save-conflict-actions">
            <button class="dialog-secondary-button" type="button" :disabled="submitting" @click="emit('keep')">
              保留当前草稿
            </button>
            <button class="dialog-secondary-button" type="button" :disabled="submitting" @click="emit('reload')">
              重新加载磁盘版
            </button>
            <button class="dialog-primary-button is-danger" type="button" :disabled="submitting" @click="emit('overwrite')">
              {{ submitting ? "覆盖中…" : "覆盖磁盘版" }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.save-conflict-dialog {
  width: min(820px, calc(100vw - 40px));
}

.save-conflict-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.save-conflict-columns section {
  min-width: 0;
}

.save-conflict-columns strong {
  display: block;
  margin-bottom: 8px;
  color: var(--text-primary);
  font-size: 13px;
}

.save-conflict-columns pre {
  box-sizing: border-box;
  height: 240px;
  margin: 0;
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-muted);
  color: var(--text-secondary);
  font: 12px/1.6 var(--mono-font);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.save-conflict-actions {
  flex-wrap: wrap;
}

@media (max-width: 680px) {
  .save-conflict-columns {
    grid-template-columns: 1fr;
  }

  .save-conflict-columns pre {
    height: 170px;
  }
}
</style>
