<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import type { CloudBackupPreview } from "@deepwrite/contracts";
import { useSettingsStore } from "../../stores/settingsStore";
import { uiMessage } from "../../ui-feedback";
import CloudBackupPreviewDialog from "./CloudBackupPreviewDialog.vue";

const props = defineProps<{
  active: boolean;
}>();

const emit = defineEmits<{
  refreshCatalog: [];
}>();

const settingsStore = useSettingsStore();
const { cloudBackupStatus: status, cloudBackupLoading: loading } =
  storeToRefs(settingsStore);
const pending = ref(false);
const remoteKey = ref("");
const preview = ref<CloudBackupPreview | null>(null);
const copied = ref(false);

const apiAvailable = computed(() => Boolean(window.deepwrite?.cloudBackup));

const usedPercent = computed(() => {
  if (!status.value || status.value.quotaBytes <= 0) return 0;
  return Math.min(
    100,
    Math.round((status.value.usedBytes / status.value.quotaBytes) * 100)
  );
});

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value: string | null): string {
  if (!value) return "尚未备份";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

async function ensureStatusLoaded(): Promise<void> {
  if (!window.deepwrite?.cloudBackup) return;
  try {
    await settingsStore.ensureCloudBackupLoaded(() =>
      window.deepwrite!.cloudBackup!.status()
    );
  } catch (error: unknown) {
    uiMessage.error(errorMessage(error, "加载云端备份状态失败。"));
  }
}

async function refreshStatus(): Promise<void> {
  settingsStore.invalidate("cloudBackup");
  await ensureStatusLoaded();
}

async function copyMachineKey(): Promise<void> {
  const key = status.value?.machineKey;
  if (!key) return;
  try {
    await navigator.clipboard.writeText(key);
    copied.value = true;
    uiMessage.success("本机备份密钥已复制。");
    window.setTimeout(() => {
      copied.value = false;
    }, 1600);
  } catch {
    uiMessage.error("复制失败，请手动选择密钥。");
  }
}

async function startBackup(): Promise<void> {
  if (!window.deepwrite?.cloudBackup || pending.value) return;
  pending.value = true;
  try {
    preview.value = await window.deepwrite.cloudBackup.previewBackup();
  } catch (error: unknown) {
    uiMessage.error(errorMessage(error, "生成备份预览失败。"));
  } finally {
    pending.value = false;
  }
}

async function startRestore(): Promise<void> {
  if (!window.deepwrite?.cloudBackup || pending.value) return;
  pending.value = true;
  try {
    preview.value = await window.deepwrite.cloudBackup.previewRestore(
      remoteKey.value
    );
  } catch (error: unknown) {
    uiMessage.error(errorMessage(error, "读取云端备份失败。"));
  } finally {
    pending.value = false;
  }
}

async function confirmPreview(): Promise<void> {
  if (!window.deepwrite?.cloudBackup || !preview.value || pending.value) return;
  const current = preview.value;
  pending.value = true;
  try {
    const result =
      current.direction === "upload"
        ? await window.deepwrite.cloudBackup.applyBackup(current.previewId)
        : await window.deepwrite.cloudBackup.applyRestore(current.previewId);
    preview.value = null;
    if (current.direction === "download") {
      emit("refreshCatalog");
    }
    uiMessage.success(
      current.direction === "upload"
        ? `已备份到云端，共 ${formatBytes(result.sizeBytes)}。`
        : `已同步到本机：新增 ${result.added}，覆盖 ${result.overwritten}。`
    );
    await refreshStatus();
  } catch (error: unknown) {
    uiMessage.error(errorMessage(error, "同步失败。"));
  } finally {
    pending.value = false;
  }
}

watch(
  () => props.active,
  (active) => {
    if (active) void ensureStatusLoaded();
  },
  { immediate: true }
);
</script>

<template>
  <section class="backup-page" aria-label="云端备份">
    <header class="backup-header">
      <div>
        <span class="backup-eyebrow">更多功能</span>
        <h1>云端备份</h1>
        <p>
          把本机创作空间、技能库和素材库备份到云端，或用另一台机器的密钥同步过来。无需登录。
        </p>
      </div>
      <button
        class="secondary-button"
        type="button"
        :disabled="loading"
        @click="refreshStatus"
      >
        {{ loading ? "刷新中…" : "刷新状态" }}
      </button>
    </header>

    <div v-if="!apiAvailable" class="backup-empty">
      <strong>当前环境未连接桌面端能力</strong>
      <span>请在 DeepWrite 桌面客户端中打开云端备份。</span>
    </div>

    <template v-else-if="status">
      <section v-if="!status.configured" class="backup-card warning-card">
        <strong>当前环境未配置云端备份</strong>
        <p>请在本地 `.env` 中填写 OSS 配置后重新启动应用。</p>
      </section>

      <section class="backup-grid">
        <article class="backup-card">
          <span class="card-label">本机备份密钥</span>
          <strong class="machine-key">{{ status.machineKey }}</strong>
          <p>
            把这串密钥发给另一台电脑，即可预览并同步这份备份。知道密钥的人都能读取对应云端数据。
          </p>
          <button class="primary-button" type="button" @click="copyMachineKey">
            {{ copied ? "已复制" : "复制密钥" }}
          </button>
        </article>

        <article class="backup-card">
          <span class="card-label">用量</span>
          <strong
            >{{ formatBytes(status.usedBytes) }} /
            {{ formatBytes(status.quotaBytes) }}</strong
          >
          <div class="quota-track" aria-hidden="true">
            <i :style="{ width: `${usedPercent}%` }" />
          </div>
          <p>
            上次备份 {{ formatTime(status.lastBackupAt) }} · 本地
            {{ status.localItemCount }} 项 · 云端
            {{ status.remoteItemCount }} 项
          </p>
        </article>
      </section>

      <section class="backup-card action-card">
        <div>
          <h2>备份到云端</h2>
          <p>用当前本机数据覆盖该密钥下的云端备份。超过 100 MB 会被拒绝。</p>
        </div>
        <button
          class="primary-button"
          type="button"
          :disabled="pending || !status.configured"
          @click="startBackup"
        >
          {{ pending && !preview ? "正在预览…" : "备份到云端" }}
        </button>
      </section>

      <section class="backup-card action-card restore-card">
        <div>
          <h2>从其他设备同步</h2>
          <p>
            输入另一台机器的备份密钥，先预览会改动哪些内容，确认后再写入本机。
          </p>
          <label>
            <span>对方备份密钥</span>
            <input
              v-model="remoteKey"
              maxlength="64"
              spellcheck="false"
              placeholder="DW-XXXX-XXXX-XXXX-XXXX"
            />
          </label>
        </div>
        <button
          class="secondary-button"
          type="button"
          :disabled="pending || !status.configured || !remoteKey.trim()"
          @click="startRestore"
        >
          预览同步
        </button>
      </section>
    </template>

    <CloudBackupPreviewDialog
      v-if="preview"
      :preview="preview"
      :pending="pending"
      @close="preview = null"
      @confirm="confirmPreview"
    />
  </section>
</template>

<style scoped>
.backup-page {
  min-width: 0;
  height: 100%;
  overflow: auto;
  padding: 30px clamp(22px, 4vw, 54px) 48px;
  color: var(--text-primary);
  background: var(--surface-main);
}
.backup-header,
.action-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.backup-header h1,
.action-card h2 {
  margin: 3px 0 5px;
}
.backup-header h1 {
  font-size: 25px;
}
.backup-header p,
.action-card p,
.backup-card p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.55;
}
.backup-eyebrow {
  color: var(--text-tertiary);
  font-size: 12px;
  letter-spacing: 0.08em;
}
.backup-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 13px;
  margin: 22px 0;
}
.backup-card {
  display: grid;
  gap: 10px;
  padding: 18px;
  border: 1px solid var(--theme-line);
  border-radius: 14px;
  background: var(--surface-raised);
}
.warning-card {
  margin-top: 20px;
  border-color: color-mix(in srgb, var(--danger) 42%, var(--theme-line));
}
.card-label {
  color: var(--text-tertiary);
  font-size: 12px;
}
.machine-key {
  font-size: 20px;
  letter-spacing: 0.04em;
  word-break: break-all;
}
.quota-track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--surface-muted);
}
.quota-track i {
  display: block;
  height: 100%;
  background: var(--accent);
}
.action-card {
  margin-top: 13px;
  align-items: center;
}
.restore-card {
  align-items: flex-end;
}
label {
  display: grid;
  gap: 7px;
  margin-top: 12px;
  color: var(--text-secondary);
  font-size: 12px;
}
input {
  box-sizing: border-box;
  width: min(420px, 100%);
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  padding: 10px 11px;
  color: var(--text-primary);
  background: var(--surface-main);
  font: inherit;
  outline: none;
}
input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.backup-empty {
  min-height: 220px;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 8px;
  color: var(--text-secondary);
  text-align: center;
}
button {
  font: inherit;
}
.primary-button,
.secondary-button,
.danger-button {
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  padding: 8px 13px;
  cursor: pointer;
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
@media (max-width: 820px) {
  .backup-page {
    padding-inline: 16px;
  }
  .backup-header,
  .action-card,
  .restore-card {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
