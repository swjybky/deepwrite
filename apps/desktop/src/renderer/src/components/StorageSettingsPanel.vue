<script setup lang="ts">
import { formatBytes } from "@deepwrite/shared";
import { deepwriteApi } from "../api/deepwrite";
import { createScopedTranslator } from "../i18n";
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { useStorageSettings } from "../composables/useStorageSettings";
import { useLocalBackup } from "../composables/useLocalBackup";
import { uiConfirm } from "../ui-confirm";
import { uiMessage } from "../ui-feedback";
import LocalBackupExportDialog from "./LocalBackupExportDialog.vue";
import LocalBackupImportDialog from "./LocalBackupImportDialog.vue";

const t = createScopedTranslator("components.storageSettingsPanel");

const props = defineProps<{
  workspaceDirectoryPath: string | null;
  workspaceDirectoryLoading: boolean;
  runtimeAvailable: boolean;
}>();
const emit = defineEmits<{
  chooseWorkspaceDirectory: [];
  resetWorkspaceDirectory: [];
}>();
const storage = useStorageSettings({
  api: () => deepwriteApi()?.storageSettings,
  notifications: uiMessage
});
const backup = useLocalBackup({
  api: () => deepwriteApi()?.localBackup,
  notifications: uiMessage,
  confirm: uiConfirm
});
const {
  settings,
  loading,
  migrating,
  restarting,
  compacting,
  releasingBackup,
  load
} = storage;
const disabled = computed(
  () =>
    !props.runtimeAvailable ||
    !settings.value ||
    loading.value ||
    migrating.value ||
    restarting.value ||
    backup.busy.value ||
    props.workspaceDirectoryLoading
);
const compaction = computed(() => settings.value?.conversationCompaction);
const compactionBusy = computed(
  () =>
    compacting.value ||
    releasingBackup.value ||
    compaction.value?.phase === "running" ||
    compaction.value?.phase === "verifying" ||
    compaction.value?.phase === "swapping"
);

function formatSignedBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return "—";
  return bytes < 0 ? `-${formatBytes(Math.abs(bytes))}` : formatBytes(bytes);
}

const compactionStatusText = computed(() => {
  const status = compaction.value;
  if (!status) return "";
  switch (status.phase) {
    case "skipped_new":
      return t("compactionStatusSkippedNew");
    case "idle":
      return t("compactionStatusIdle");
    case "needed":
      return t("compactionStatusNeeded", {
        calls: String(status.legacyCallsFound),
        reclaimable: formatBytes(status.estimatedReclaimableBytes)
      });
    case "running":
      return t("compactionStatusRunning", {
        processed: String(status.processedSessions),
        total: String(status.totalSessions)
      });
    case "verifying":
      return t("compactionStatusVerifying");
    case "swapping":
      return t("compactionStatusSwapping");
    case "completed_with_backup":
      return t("compactionStatusCompletedWithBackup");
    case "backup_released":
      return t("compactionStatusBackupReleased");
    case "rolled_back":
      return t("compactionStatusRolledBack");
    case "failed":
      return t("compactionStatusFailed");
    default:
      return "";
  }
});

const compactionHintText = computed(() => {
  const status = compaction.value;
  if (!status) return "";
  if (status.phase === "completed_with_backup") {
    return t("compactionHintBackup");
  }
  if (status.failureCode === "disk_full") {
    return t("compactionHintDiskFull", {
      required: formatBytes(status.requiredDiskBytes),
      available: formatBytes(status.availableDiskBytes)
    });
  }
  if (
    status.failureCode === "database_locked" ||
    status.failureCode === "old_process_active"
  ) {
    return status.failureDetail || t("compactionHintLocked");
  }
  return status.failureDetail ?? "";
});
const directories = computed(() => {
  const workspace = settings.value?.workspace;
  const workspacePath = props.workspaceDirectoryPath ?? workspace?.path;
  return [
    {
      kind: "workspace" as const,
      title: t("workspaceFolder"),
      description: t("setsTheDefaultLocationForNewAndImportedWorks"),
      note: t("changingWorkspaceLocationDoesNotMoveExistingProjects"),
      path: workspacePath,
      isDefault: workspace
        ? workspacePath === workspace.path
          ? workspace.isDefault
          : workspacePath === workspace.defaultPath
        : undefined
    },
    {
      kind: "user-data" as const,
      title: t("userDataFolder"),
      description: t("storesHistoryModelsAndKeysAgentSettingsGeneralAnd"),
      note: t("changingTheLocationMigratesExistingDataAndRestartsThe"),
      path: settings.value?.userData.path,
      isDefault: settings.value?.userData.isDefault
    }
  ];
});

function changeDirectory(kind: "user-data" | "workspace", reset = false): void {
  if (disabled.value) return;
  if (kind === "user-data") {
    void storage.changeUserData(reset);
  } else if (reset) {
    emit("resetWorkspaceDirectory");
  } else {
    emit("chooseWorkspaceDirectory");
  }
}

watch(
  () => props.workspaceDirectoryPath,
  () => void load()
);
let unsubscribeEvents: (() => void) | undefined;
onMounted(() => {
  void load();
  unsubscribeEvents = deepwriteApi()?.events.subscribe((event) => {
    if (event.type === "rendererState.compactionUpdated") {
      storage.applyCompactionStatus(event.payload.status);
    }
  });
});
onBeforeUnmount(() => {
  unsubscribeEvents?.();
  unsubscribeEvents = undefined;
  storage.dispose();
});
</script>

<template>
  <div class="storage-sections">
    <section
      class="settings-group"
      aria-labelledby="backup-settings-title"
      :aria-busy="backup.busy.value"
    >
      <div class="storage-heading">
        <h2 id="backup-settings-title" class="settings-group-title">
          {{ t("backupSectionTitle") }}
        </h2>
      </div>
      <article
        class="settings-card storage-backup-card"
        :aria-label="t('backupCardTitle')"
      >
        <div class="storage-description">
          <h3>{{ t("backupCardTitle") }}</h3>
          <p>{{ t("backupCardDesc") }}</p>
        </div>
        <p class="storage-note">{{ t("backupMobileNote") }}</p>
        <div v-if="backup.lastExportResult.value" class="local-backup-receipt">
          <span>{{
            t("exportSuccess", {
              count: String(backup.lastExportResult.value.itemCount),
              size: formatBytes(backup.lastExportResult.value.archiveBytes)
            })
          }}</span>
          <button
            type="button"
            class="storage-refresh"
            @click="backup.openExportFolder()"
          >
            {{ t("openExportDir") }}
          </button>
        </div>
        <div v-if="backup.lastImportResult.value" class="local-backup-receipt">
          <span>{{
            t("importDone", {
              added: String(backup.lastImportResult.value.added),
              dup: String(backup.lastImportResult.value.duplicated),
              rep: String(backup.lastImportResult.value.replaced),
              skip: String(backup.lastImportResult.value.skipped),
              dangling: String(
                backup.lastImportResult.value.danglingBindingsRemoved
              )
            })
          }}</span>
        </div>
        <div class="storage-actions">
          <button
            class="storage-button is-primary"
            type="button"
            :disabled="
              !runtimeAvailable || migrating || restarting || backup.busy.value
            "
            @click="backup.openExportDialog()"
          >
            {{ t("exportBtn") }}
          </button>
          <button
            class="storage-button"
            type="button"
            :disabled="
              !runtimeAvailable || migrating || restarting || backup.busy.value
            "
            @click="backup.chooseImportPackage()"
          >
            {{ t("importBtn") }}
          </button>
        </div>
      </article>
    </section>

    <section
      class="settings-group"
      aria-labelledby="storage-settings-title"
      :aria-busy="loading || migrating || restarting"
    >
      <div class="storage-heading">
        <h2 id="storage-settings-title" class="settings-group-title">
          {{ t("locationsSectionTitle") }}
        </h2>
        <button
          class="storage-refresh"
          type="button"
          :disabled="
            loading ||
            migrating ||
            restarting ||
            backup.busy.value ||
            !runtimeAvailable
          "
          @click="load"
        >
          {{ loading ? t("reading") : t("refreshLocations") }}
        </button>
      </div>
      <article
        v-for="directory in directories"
        :key="directory.kind"
        class="settings-card storage-card"
        :aria-label="directory.title"
      >
        <div class="storage-description">
          <h3>{{ directory.title }}</h3>
          <p>{{ directory.description }}</p>
        </div>
        <dl class="storage-paths">
          <div>
            <dt>{{ t("currentLocation") }}</dt>
            <dd>{{ directory.path ?? "—" }}</dd>
          </div>
        </dl>
        <p class="storage-note">{{ directory.note }}</p>
        <div class="storage-actions">
          <button
            class="storage-button is-primary"
            type="button"
            :disabled="disabled"
            :aria-label="
              t('changeValue', {
                arg0: directory.title
              })
            "
            @click="changeDirectory(directory.kind)"
          >
            {{
              directory.kind === "user-data" && restarting
                ? t("restarting")
                : directory.kind === "user-data" && migrating
                  ? t("processing")
                  : t("changeLocation")
            }}
          </button>
          <button
            class="storage-button"
            type="button"
            :disabled="disabled"
            :aria-label="
              t('openValue', {
                arg0: directory.title
              })
            "
            @click="storage.openDirectory(directory.kind)"
          >
            {{ t("openFolder") }}
          </button>
          <button
            class="storage-button"
            type="button"
            :disabled="disabled || directory.isDefault"
            :aria-label="
              t('restoreDefaultValueLocation', {
                arg0: directory.title
              })
            "
            @click="changeDirectory(directory.kind, true)"
          >
            {{ t("restoreDefaultLocation") }}
          </button>
        </div>
      </article>
    </section>

    <section
      v-if="compaction"
      class="settings-group"
      aria-labelledby="compaction-settings-title"
    >
      <div class="storage-heading">
        <h2 id="compaction-settings-title" class="settings-group-title">
          {{ t("compactionSectionTitle") }}
        </h2>
      </div>
      <article
        class="settings-card storage-compaction-card"
        :aria-label="t('conversationCompactionTitle')"
      >
        <div class="storage-description">
          <h3>{{ t("conversationCompactionTitle") }}</h3>
          <p>{{ t("conversationCompactionDescription") }}</p>
        </div>
        <dl class="storage-paths storage-compaction-metrics">
          <div>
            <dt>{{ compactionStatusText }}</dt>
            <dd class="storage-metrics-grid">
              <span class="storage-metric-item">
                <span class="storage-metric-label">{{
                  t("compactionOriginalSize")
                }}</span>
                <span>{{ formatBytes(compaction.bytesBefore) }}</span>
              </span>
              <span
                v-if="compaction.bytesAfter !== undefined"
                class="storage-metric-item"
              >
                <span class="storage-metric-label">{{
                  t("compactionCurrentSize")
                }}</span>
                <span>{{ formatBytes(compaction.bytesAfter) }}</span>
              </span>
              <span
                v-if="
                  compaction.backupBytes !== undefined &&
                  compaction.backupBytes > 0
                "
                class="storage-metric-item"
              >
                <span class="storage-metric-label">{{
                  t("compactionBackupSize")
                }}</span>
                <span>{{ formatBytes(compaction.backupBytes) }}</span>
              </span>
              <span
                v-if="compaction.netFreedBytes !== undefined"
                class="storage-metric-item"
              >
                <span class="storage-metric-label">{{
                  t("compactionNetFreedSize")
                }}</span>
                <span>{{ formatSignedBytes(compaction.netFreedBytes) }}</span>
              </span>
            </dd>
          </div>
        </dl>
        <p v-if="compactionHintText" class="storage-note">
          {{ compactionHintText }}
        </p>
        <div
          v-if="
            compaction.canRetry ||
            compaction.phase === 'needed' ||
            compaction.canReleaseBackup
          "
          class="storage-actions"
        >
          <button
            v-if="compaction.canRetry || compaction.phase === 'needed'"
            class="storage-button is-primary"
            type="button"
            :disabled="disabled || compactionBusy"
            @click="storage.compactConversations()"
          >
            {{
              compactionBusy
                ? t("compactionCompactingButton")
                : compaction.phase === "failed"
                  ? t("compactionRetryButton")
                  : t("compactionStartButton")
            }}
          </button>
          <button
            v-if="compaction.canReleaseBackup"
            class="storage-button"
            type="button"
            :disabled="disabled || compactionBusy"
            @click="storage.releaseConversationBackup()"
          >
            {{
              releasingBackup
                ? t("compactionReleasingBackupButton")
                : t("compactionReleaseBackupButton")
            }}
          </button>
        </div>
      </article>
    </section>

    <LocalBackupExportDialog
      :open="backup.exportDialogOpen.value"
      :loading="backup.loadingInventory.value"
      :exporting="backup.exporting.value"
      :groups="backup.exportGroups.value"
      :selected-keys="backup.selectedExportKeys.value"
      :selected-bytes="backup.selectedExportBytes.value"
      :missing-linked-titles="backup.missingLinkedTitles.value"
      :dependency-labels-for="backup.dependencyLabelsFor"
      @close="backup.closeExportDialog()"
      @update:selected-keys="backup.selectedExportKeys.value = $event"
      @toggle-group="backup.setGroupExportSelection"
      @submit="backup.submitExport()"
      @cancel-export="backup.cancelExport()"
    />

    <LocalBackupImportDialog
      :preview="backup.importPreview.value"
      :selected-keys="backup.selectedImportKeys.value"
      :conflict-policy="backup.conflictPolicy.value"
      :importing="backup.importing.value"
      :is-replace-danger="backup.isReplaceDanger.value"
      @close="backup.closeImportDialog()"
      @update:selected-keys="backup.selectedImportKeys.value = $event"
      @update:conflict-policy="backup.conflictPolicy.value = $event"
      @submit="backup.submitImport()"
    />
  </div>
</template>

<style scoped src="./settings-page.css"></style>
<style scoped src="./storage-settings.css"></style>
