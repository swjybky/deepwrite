<script setup lang="ts">
import { formatBytes } from "@deepwrite/shared";
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import type {
  LocalBackupConflictPolicy,
  LocalBackupImportPreview,
  LocalBackupPreviewStatus
} from "@deepwrite/contracts";
import { createScopedTranslator } from "../i18n";

const props = defineProps<{
  preview: LocalBackupImportPreview | null;
  selectedKeys: string[];
  conflictPolicy: LocalBackupConflictPolicy;
  importing: boolean;
  isReplaceDanger: boolean;
}>();

const emit = defineEmits<{
  close: [];
  "update:selectedKeys": [keys: string[]];
  "update:conflictPolicy": [policy: LocalBackupConflictPolicy];
  submit: [];
}>();

const t = createScopedTranslator("components.storageSettingsPanel");
const titleId = useId();
const modalRef = ref<HTMLElement>();
let prevFocusEl: HTMLElement | undefined;

function restoreModalFocus(): void {
  const target = prevFocusEl;
  prevFocusEl = undefined;
  void nextTick(() => target?.focus({ preventScroll: true }));
}

watch(
  () => Boolean(props.preview),
  async (open) => {
    if (!open) {
      restoreModalFocus();
      return;
    }
    if (document.activeElement instanceof HTMLElement) {
      prevFocusEl = document.activeElement;
    }
    await nextTick();
    modalRef.value?.focus({ preventScroll: true });
  },
  { immediate: true }
);
onBeforeUnmount(restoreModalFocus);

const platformLabel = computed(() => {
  const plat = props.preview?.sourcePlatform;
  if (plat === "win32") return t("platWin");
  if (plat === "darwin") return t("platDarwin");
  return t("platLinux");
});

const hasConflictChoices = computed(() =>
  (props.preview?.items ?? []).some(
    (item) => item.status === "conflict_same_id"
  )
);

function statusLabel(status: LocalBackupPreviewStatus): string {
  switch (status) {
    case "new":
      return t("stNew");
    case "conflict_same_id":
      return t("stConflict");
    case "identical":
      return t("stIdentical");
    case "builtin_skipped":
      return t("stBuiltin");
  }
}

function toggleKey(key: string, event: Event): void {
  const { checked } = event.target as HTMLInputElement;
  emit(
    "update:selectedKeys",
    checked
      ? [...new Set([...props.selectedKeys, key])]
      : props.selectedKeys.filter((item) => item !== key)
  );
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="preview"
      class="dialog-backdrop export-dialog-backdrop"
      @mousedown.self="!importing && emit('close')"
    >
      <section
        ref="modalRef"
        class="workspace-dialog local-backup-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
        @keydown.esc.stop.prevent="!importing && emit('close')"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{ t("backupSectionTitle") }}</span>
            <h2 :id="titleId">{{ t("importTitle") }}</h2>
          </div>
          <button
            type="button"
            class="dialog-close"
            :aria-label="t('close')"
            :disabled="importing"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div class="dialog-content local-backup-dialog-body">
          <div class="local-backup-meta">
            <p class="storage-note">
              {{
                t("metaLine", {
                  file: preview.fileName,
                  platform: platformLabel,
                  time: new Date(preview.exportedAt).toLocaleString()
                })
              }}
            </p>
            <p
              class="local-backup-banner"
              :class="preview.diskSpaceSufficient ? 'is-info' : 'is-danger'"
            >
              {{
                t(preview.diskSpaceSufficient ? "spaceOk" : "spaceLow", {
                  need: formatBytes(preview.requiredDiskBytes),
                  avail: formatBytes(preview.availableDiskBytes)
                })
              }}
            </p>
          </div>

          <fieldset
            v-if="hasConflictChoices"
            class="local-backup-policy"
            :disabled="importing"
          >
            <legend>{{ t("conflictPolicy") }}</legend>
            <label>
              <input
                type="radio"
                name="conflict-policy"
                value="keep_both"
                :checked="conflictPolicy === 'keep_both'"
                @change="emit('update:conflictPolicy', 'keep_both')"
              />
              <span>{{ t("policyKeepBoth") }}</span>
            </label>
            <label>
              <input
                type="radio"
                name="conflict-policy"
                value="replace"
                :checked="conflictPolicy === 'replace'"
                @change="emit('update:conflictPolicy', 'replace')"
              />
              <span>{{ t("policyReplace") }}</span>
            </label>
            <p v-if="isReplaceDanger" class="local-backup-banner is-danger">
              {{ t("replaceWarn") }}
            </p>
          </fieldset>

          <ul class="local-backup-list">
            <li
              v-for="item in preview.items"
              :key="item.key"
              class="local-backup-row"
            >
              <label class="local-backup-check">
                <input
                  type="checkbox"
                  :checked="selectedKeys.includes(item.key)"
                  :disabled="
                    importing ||
                    item.status === 'identical' ||
                    item.status === 'builtin_skipped'
                  "
                  @change="toggleKey(item.key, $event)"
                />
                <span class="local-backup-row-text">
                  <strong>
                    {{ item.title }}
                    <span
                      class="local-backup-status"
                      :class="`is-${item.status}`"
                    >
                      {{ statusLabel(item.status) }}
                    </span>
                  </strong>
                  <small>
                    {{ formatBytes(item.sizeBytes) }}
                    <template v-if="item.hasTitleCollision">
                      · {{ t("titleWarn") }}
                    </template>
                  </small>
                </span>
              </label>
            </li>
          </ul>
        </div>

        <footer class="export-dialog-footer">
          <div class="dialog-actions">
            <button
              type="button"
              class="dialog-secondary-button"
              :disabled="importing"
              @click="emit('close')"
            >
              {{ t("cancel") }}
            </button>
            <button
              type="button"
              class="dialog-primary-button"
              :class="{ 'is-danger': isReplaceDanger }"
              :disabled="
                importing ||
                !preview.diskSpaceSufficient ||
                !selectedKeys.length
              "
              @click="emit('submit')"
            >
              {{
                importing
                  ? t("importing")
                  : t("startImport", { count: String(selectedKeys.length) })
              }}
            </button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="./storage-settings.css"></style>
