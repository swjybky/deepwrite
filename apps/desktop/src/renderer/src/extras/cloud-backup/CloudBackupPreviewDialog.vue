<script setup lang="ts">
import { computed } from "vue";
import type {
  CloudBackupChange,
  CloudBackupPreview
} from "@deepwrite/contracts";
import {
  CLOUD_BACKUP_CHANGE_LABELS,
  summarizeCloudBackupPreview
} from "./cloudBackupPreviewSummary";

const props = defineProps<{
  preview: CloudBackupPreview;
  pending: boolean;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();

const KIND_LABELS: Record<CloudBackupChange["kind"], string> = {
  book: "创作空间",
  "long-book": "长篇创作空间",
  "material-library": "素材库",
  "material-group": "素材分组",
  "skill-library": "技能库",
  "skill-group": "技能分组"
};

const summary = computed(() =>
  summarizeCloudBackupPreview(props.preview.changes)
);

const previewGroups = computed(() =>
  summary.value.statuses
    .map((status) => ({
      ...status,
      items: props.preview.changes.filter(
        (item) => item.change === status.change
      )
    }))
    .filter((group) => group.items.length > 0)
);

const confirmIsDangerous = computed(() =>
  props.preview.changes.some(
    (change) => change.change === "overwrite" || change.change === "drop"
  )
);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<template>
  <Teleport to="body">
    <div
      class="backup-modal-backdrop"
      @mousedown.self="!pending && emit('close')"
    >
      <section
        class="backup-modal"
        role="dialog"
        aria-modal="true"
        aria-label="确认同步内容"
      >
        <header>
          <div>
            <span>{{
              preview.direction === "upload" ? "备份预览" : "同步预览"
            }}</span>
            <h2>
              {{
                preview.direction === "upload"
                  ? "确认上传到云端"
                  : "确认写入本机"
              }}
            </h2>
          </div>
          <button
            type="button"
            aria-label="关闭"
            :disabled="pending"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div class="preview-meta">
          <p class="modal-summary">
            密钥 {{ preview.machineKey }} ·
            {{ formatBytes(preview.totalBytes) }} /
            {{ formatBytes(preview.quotaBytes) }}
          </p>
          <section class="file-overview" aria-label="文件列表概览">
            <div class="file-total">
              <span>文件总数</span>
              <strong>{{ summary.total }}</strong>
            </div>
            <dl>
              <div v-for="status in summary.statuses" :key="status.change">
                <dt>{{ status.label }}</dt>
                <dd>{{ status.count }}</dd>
              </div>
            </dl>
          </section>
        </div>

        <div class="modal-scroll">
          <section
            v-for="group in previewGroups"
            :key="group.change"
            class="change-group"
          >
            <h3>
              {{ CLOUD_BACKUP_CHANGE_LABELS[group.change] }}（{{
                group.items.length
              }}）
            </h3>
            <ul>
              <li v-for="item in group.items" :key="`${item.kind}:${item.id}`">
                <strong>{{ item.title }}</strong>
                <small
                  >{{ KIND_LABELS[item.kind] }} ·
                  {{ formatBytes(item.sizeBytes) }}</small
                >
              </li>
            </ul>
          </section>
        </div>

        <footer>
          <button
            class="secondary-button"
            type="button"
            :disabled="pending"
            @click="emit('close')"
          >
            取消
          </button>
          <button
            type="button"
            :class="confirmIsDangerous ? 'danger-button' : 'primary-button'"
            :disabled="pending"
            @click="emit('confirm')"
          >
            {{
              pending
                ? "正在同步…"
                : preview.direction === "upload"
                  ? "确认备份"
                  : "确认同步"
            }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.backup-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, var(--text-primary) 28%, transparent);
}
.backup-modal {
  width: min(640px, 100%);
  max-height: min(80vh, 760px);
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  overflow: hidden;
  border: 1px solid var(--theme-line);
  border-radius: 16px;
  background: var(--surface-raised);
  color: var(--text-primary);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.18);
}
.backup-modal header,
.backup-modal footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
}
.backup-modal header {
  border-bottom: 1px solid var(--theme-line-soft);
}
.backup-modal header h2,
.backup-modal header span,
.modal-summary,
.file-overview dl {
  margin: 0;
}
.backup-modal header span,
.modal-summary,
.change-group small,
.file-total span,
.file-overview dt {
  color: var(--text-tertiary);
  font-size: 12px;
}
.backup-modal header button {
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 22px;
  cursor: pointer;
}
.preview-meta {
  display: grid;
  gap: 10px;
  padding: 0 18px 12px;
}
.file-overview {
  display: flex;
  align-items: stretch;
  gap: 10px;
}
.file-total,
.file-overview dl > div {
  display: grid;
  gap: 3px;
  padding: 9px 11px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-main);
}
.file-total {
  min-width: 74px;
}
.file-total strong,
.file-overview dd {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
}
.file-overview dl {
  min-width: 0;
  flex: 1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.modal-scroll {
  overflow: auto;
  padding: 0 18px 12px;
}
.change-group + .change-group {
  margin-top: 14px;
}
.change-group h3 {
  margin: 0 0 8px;
  font-size: 13px;
}
.change-group ul {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.change-group li {
  display: grid;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-main);
}
.backup-modal footer {
  border-top: 1px solid var(--theme-line-soft);
}
.primary-button,
.secondary-button,
.danger-button {
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  padding: 8px 13px;
  cursor: pointer;
  font: inherit;
}
.primary-button {
  border-color: color-mix(in srgb, var(--text-primary) 84%, transparent);
  color: var(--surface-main);
  background: var(--text-primary);
}
.secondary-button {
  color: var(--text-primary);
  background: var(--surface-raised);
}
.danger-button {
  border-color: var(--danger);
  color: #fff;
  background: var(--danger);
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
@media (max-width: 620px) {
  .file-overview {
    display: grid;
  }
  .file-overview dl {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
