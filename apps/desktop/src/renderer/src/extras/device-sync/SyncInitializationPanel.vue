<script setup lang="ts">
import { createScopedTranslator, locale } from "../../i18n";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type {
  SyncInitializationPreview,
  SyncRequest,
  SyncResponse,
  SyncStatus
} from "@deepwrite/contracts/renderer";
import PopupSelect from "../../components/PopupSelect.vue";

const t = createScopedTranslator("extras");

const props = defineProps<{
  status: SyncStatus;
  pending: boolean;
  request(input: SyncRequest): Promise<SyncResponse | null>;
  error?: string | null;
  clearError?: () => void;
}>();
const sources = computed(() =>
  props.status.devices.filter((device) => device.id !== props.status.deviceId)
);
const selected = ref("");
const source = computed(
  () =>
    sources.value.find((device) => device.id === selected.value) ??
    sources.value[0]
);
const choices = computed(() =>
  sources.value.map((device) => ({ value: device.id, label: device.name }))
);
const preview = ref<SyncInitializationPreview | null>(null);
const dialog = ref<HTMLDialogElement | null>(null);
const canForceIgnore = computed(() =>
  Boolean(props.error?.includes("未合并") && source.value)
);
let disposed = false;
watch([() => source.value?.id, () => props.status.config?.spaceId], () => {
  preview.value = null;
  dialog.value?.close();
  props.clearError?.();
});
onBeforeUnmount(() => {
  disposed = true;
  dialog.value?.close();
});

async function download(ignoreOtherDevices = false) {
  if (!source.value || props.pending) return;
  preview.value = null;
  props.clearError?.();
  const deviceId = source.value.id;
  const result = await props.request({
    operation: "preview-initialization",
    deviceId,
    ...(ignoreOtherDevices ? { ignoreOtherDevices: true } : {})
  });
  if (
    !disposed &&
    source.value?.id === deviceId &&
    result?.kind === "initialization-preview"
  )
    preview.value = result.preview;
}
function confirm() {
  if (preview.value && !props.pending) dialog.value?.showModal();
}
async function initialize() {
  if (!preview.value || props.pending) return;
  const token = preview.value.token;
  dialog.value?.close();
  preview.value = null;
  await props.request({ operation: "initialize", token });
}
</script>

<template>
  <section class="sync-card" :aria-label="t('deviceSync.initializeFromRemote')">
    <h2>{{ t("deviceSync.initializeDevice") }}</h2>
    <p>{{ t("deviceSync.initializeDescription") }}</p>
    <p>{{ t("deviceSync.initializeSteps") }}</p>
    <p>{{ t("deviceSync.initializeConsequences") }}</p>
    <label class="sync-initialization-source">
      <span>{{ t("deviceSync.sourceDevice") }}</span>
      <PopupSelect
        :model-value="source?.id ?? ''"
        :options="choices"
        :accessible-label="t('deviceSync.initializationSource')"
        :disabled="pending || !sources.length"
        :placeholder="t('deviceSync.noOtherDevices')"
        @update:model-value="selected = String($event)"
      />
    </label>
    <p v-if="source">
      {{
        t("deviceSync.lastUpload", {
          date: new Date(source.updatedAt).toLocaleString(locale)
        })
      }}
    </p>
    <p v-else>{{ t("deviceSync.noRemoteUploads") }}</p>
    <div class="sync-actions">
      <button
        class="sync-button secondary"
        :disabled="pending"
        @click="request({ operation: 'check' })"
      >
        {{ t("deviceSync.checkRemoteUpdates") }}
      </button>
      <button
        class="sync-button"
        :disabled="pending || !source"
        @click="download(false)"
      >
        {{
          preview
            ? t("deviceSync.downloadPreviewAgain")
            : t("deviceSync.downloadPreview")
        }}
      </button>
    </div>
    <section
      v-if="!pending && error"
      class="sync-initialization-preview"
      role="alert"
    >
      <h3>{{ t("deviceSync.initializationFailedTitle") }}</h3>
      <p>{{ error }}</p>
      <button
        v-if="canForceIgnore"
        class="sync-button secondary"
        :disabled="pending"
        @click="download(true)"
      >
        {{ t("deviceSync.ignoreOtherDevicesPreview") }}
      </button>
    </section>
    <section
      v-if="preview"
      class="sync-initialization-preview"
      aria-live="polite"
    >
      <h3>{{ t("deviceSync.remoteVerified") }}</h3>
      <p>
        {{
          t("deviceSync.sourceSummary", {
            device: preview.deviceName,
            date: new Date(preview.remoteUpdatedAt).toLocaleString(locale)
          })
        }}
      </p>
      <p>
        {{
          t("deviceSync.replacementSummary", {
            local: preview.localItemCount,
            remote: preview.itemCount,
            files: preview.fileCount
          })
        }}
      </p>
      <p v-if="preview.ignoredDevices?.length">
        {{
          t("deviceSync.ignoredDevicesSummary", {
            devices: preview.ignoredDevices.join("、"),
            device: preview.deviceName
          })
        }}
      </p>
      <p v-if="preview.skippedUnsupportedCount">
        {{
          t("deviceSync.skippedUnsupportedSummary", {
            count: preview.skippedUnsupportedCount
          })
        }}
      </p>
      <p>{{ t("deviceSync.uploadedVersionOnly") }}</p>
      <button class="sync-button" :disabled="pending" @click="confirm">
        {{ t("deviceSync.initializeWithVersion") }}
      </button>
    </section>
    <dialog
      ref="dialog"
      class="sync-card sync-initialization-dialog"
      aria-labelledby="sync-initialization-title"
    >
      <h2 id="sync-initialization-title">
        {{ t("deviceSync.replaceLocalContents") }}
      </h2>
      <p>
        {{
          t("deviceSync.replaceConfirmation", {
            device: preview?.deviceName ?? "",
            count: preview?.itemCount ?? 0
          })
        }}
      </p>
      <p>{{ t("deviceSync.recoveryPreserved") }}</p>
      <div class="sync-actions">
        <button
          class="sync-button secondary"
          autofocus
          @click="dialog?.close()"
        >
          {{ t("cloudBackup.cancel") }}
        </button>
        <button class="sync-button" :disabled="pending" @click="initialize">
          {{ t("deviceSync.confirmInitialize") }}
        </button>
      </div>
    </dialog>
  </section>
</template>

<style scoped>
.sync-initialization-source {
  display: grid;
  gap: 8px;
}
.sync-initialization-preview {
  padding: 16px;
  border-radius: 8px;
  background: var(--surface-muted);
}
.sync-initialization-dialog {
  color: var(--text-primary);
  width: min(520px, calc(100vw - 40px));
  max-height: calc(100vh - 40px);
  overflow: auto;
  margin: auto;
  font: inherit;
}
.sync-initialization-dialog:not([open]) {
  display: none;
}
.sync-initialization-dialog::backdrop {
  background: color-mix(in srgb, var(--text-primary) 35%, transparent);
}
</style>
