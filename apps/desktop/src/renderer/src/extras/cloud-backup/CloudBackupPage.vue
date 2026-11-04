<script setup lang="ts">
import { formatError } from "../../i18n/errors";
import { createScopedTranslator, locale } from "../../i18n";
import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import MarketplaceAuthForm from "../../components/MarketplaceAuthForm.vue";
import type {
  MarketplaceSession,
  CloudBackupPreview
} from "@deepwrite/contracts";
import { useSettingsStore } from "../../stores/settingsStore";
import { uiMessage } from "../../ui-feedback";
import CloudBackupPreviewDialog from "./CloudBackupPreviewDialog.vue";

const t = createScopedTranslator("extras");

const props = defineProps<{
  active: boolean;
}>();

const emit = defineEmits<{
  refreshCatalog: [];
}>();

const settingsStore = useSettingsStore();
const { cloudBackupStatus: status, cloudBackupLoading: loading } =
  storeToRefs(settingsStore);
const session = ref<MarketplaceSession | null>(null);
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
  return formatError(error, fallback);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value: string | null): string {
  if (!value) return t("cloudBackup.neverBackedUp");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale.value);
}

async function ensureStatusLoaded(): Promise<void> {
  if (!window.deepwrite?.cloudBackup) return;
  try {
    session.value = await window.deepwrite.marketplace.session();
    if (!session.value.authenticated) {
      settingsStore.invalidate("cloudBackup");
      preview.value = null;
      return;
    }
    await settingsStore.ensureCloudBackupLoaded(() =>
      window.deepwrite!.cloudBackup!.status()
    );
  } catch (error: unknown) {
    uiMessage.error(errorMessage(error, t("cloudBackup.loadStatusFailed")));
  }
}

async function signedIn(value: MarketplaceSession): Promise<void> {
  session.value = value;
  await refreshStatus();
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
    uiMessage.success(t("cloudBackup.keyCopied"));
    window.setTimeout(() => {
      copied.value = false;
    }, 1600);
  } catch {
    uiMessage.error(t("cloudBackup.copyKeyFailed"));
  }
}

async function startBackup(): Promise<void> {
  if (!window.deepwrite?.cloudBackup || pending.value) return;
  pending.value = true;
  try {
    preview.value = await window.deepwrite.cloudBackup.previewBackup();
  } catch (error: unknown) {
    uiMessage.error(errorMessage(error, t("cloudBackup.previewFailed")));
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
    uiMessage.error(errorMessage(error, t("cloudBackup.readBackupFailed")));
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
        ? t("cloudBackup.backupComplete", {
            size: formatBytes(result.sizeBytes)
          })
        : t("cloudBackup.downloadComplete", {
            added: result.added,
            overwritten: result.overwritten
          })
    );
    await refreshStatus();
  } catch (error: unknown) {
    uiMessage.error(errorMessage(error, t("cloudBackup.syncFailed")));
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
  <section class="backup-page" :aria-label="t('cloudBackup.cloudBackup')">
    <header class="backup-header">
      <div>
        <span class="backup-eyebrow">{{ t("analysisUi.moreFeatures") }}</span>
        <h1>{{ t("cloudBackup.cloudBackup") }}</h1>
        <p>{{ t("cloudBackup.cloudBackupDescription") }}</p>
      </div>
      <button
        class="secondary-button"
        type="button"
        :disabled="loading"
        @click="refreshStatus"
      >
        {{
          loading ? t("cloudBackup.refreshing") : t("cloudBackup.refreshStatus")
        }}
      </button>
    </header>

    <div v-if="!apiAvailable" class="backup-empty">
      <strong>{{ t("cloudBackup.desktopUnavailable") }}</strong>
      <span>{{ t("cloudBackup.openDesktop") }}</span>
    </div>

    <MarketplaceAuthForm
      v-else-if="session && !session.authenticated"
      @authenticated="signedIn"
    />
    <template v-else-if="session?.authenticated && status">
      <section v-if="!status.configured" class="backup-card warning-card">
        <strong>{{ t("cloudBackup.cloudNotConfigured") }}</strong>
        <p>{{ t("cloudBackup.configureEnvironment") }}</p>
      </section>

      <section class="backup-grid">
        <article class="backup-card">
          <span class="card-label">{{ t("cloudBackup.localBackupKey") }}</span>
          <strong class="machine-key">{{ status.machineKey }}</strong>
          <p>{{ t("cloudBackup.backupKeyDescription") }}</p>
          <button class="primary-button" type="button" @click="copyMachineKey">
            {{ copied ? t("cloudBackup.copied") : t("cloudBackup.copyKey") }}
          </button>
        </article>

        <article class="backup-card">
          <span class="card-label">{{ t("cloudBackup.usage") }}</span>
          <strong
            >{{ formatBytes(status.usedBytes) }} /
            {{ formatBytes(status.quotaBytes) }}</strong
          >
          <div class="quota-track" aria-hidden="true">
            <i :style="{ width: `${usedPercent}%` }" />
          </div>
          <p>
            {{
              t("cloudBackup.backupSummary", {
                date: formatTime(status.lastBackupAt),
                local: status.localItemCount,
                remote: status.remoteItemCount
              })
            }}
          </p>
        </article>
      </section>

      <section class="backup-card action-card">
        <div>
          <h2>{{ t("cloudBackup.uploadBackup") }}</h2>
          <p>{{ t("cloudBackup.uploadDescription") }}</p>
        </div>
        <button
          class="primary-button"
          type="button"
          :disabled="pending || !status.configured"
          @click="startBackup"
        >
          {{
            pending && !preview
              ? t("cloudBackup.previewing")
              : t("cloudBackup.uploadBackup")
          }}
        </button>
      </section>

      <section class="backup-card action-card restore-card">
        <div>
          <h2>{{ t("cloudBackup.syncFromDevice") }}</h2>
          <p>{{ t("cloudBackup.downloadDescription") }}</p>
          <label>
            <span>{{ t("cloudBackup.remoteBackupKey") }}</span>
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
          {{ t("cloudBackup.previewSync") }}
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
