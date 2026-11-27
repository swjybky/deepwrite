<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed } from "vue";
import { formatBytes } from "@deepwrite/shared";
import type { UpdateState } from "@deepwrite/contracts";

const t = createScopedTranslator("components.versionUpdateDialog");

const props = defineProps<{
  updateState: UpdateState;
  announcedVersion?: string | undefined;
  officialDocsUrl?: string | undefined;
  manualUpdateRequired: boolean;
}>();
const emit = defineEmits<{ close: []; check: []; download: []; install: [] }>();
const updateChecking = computed(() => props.updateState.status === "checking");
const updateDownloading = computed(
  () => props.updateState.status === "downloading"
);
const updateInstalling = computed(
  () => props.updateState.status === "installing"
);
const updateProgressLabel = computed(
  () => `${Math.round(props.updateState.percent ?? 0)}%`
);
function close(): void {
  if (!updateInstalling.value) emit("close");
}
</script>

<template>
  <div class="dialog-backdrop" @mousedown.self="close">
    <section
      class="workspace-dialog profile-dialog update-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="version-update-dialog-title"
    >
      <header>
        <div>
          <span class="dialog-eyebrow">DeepWrite</span>
          <h2 id="version-update-dialog-title">
            {{ t("updates") }}
          </h2>
        </div>
        <button
          class="dialog-close"
          type="button"
          :aria-label="t('close')"
          :disabled="updateInstalling"
          @click="close"
        >
          ×
        </button>
      </header>

      <div class="dialog-content update-dialog-content">
        <div class="update-version-summary">
          <div>
            <span>{{ t("currentVersion") }}</span>
            <strong>v{{ updateState.currentVersion }}</strong>
          </div>
          <div v-if="announcedVersion">
            <span>{{ t("latestAnnouncedVersion") }}</span>
            <strong>v{{ announcedVersion }}</strong>
          </div>
          <div v-if="updateState.latestVersion">
            <span>{{ t("updateSourceVersion") }}</span>
            <strong>v{{ updateState.latestVersion }}</strong>
          </div>
          <span v-if="updateState.mandatory" class="update-required-badge">{{
            t("importantUpdate")
          }}</span>
        </div>

        <div v-if="updateChecking" class="update-checking" aria-live="polite">
          <span class="update-spinner" aria-hidden="true" />
          <span>{{ t("checkingForUpdates") }}</span>
        </div>

        <div
          v-else-if="updateInstalling"
          class="update-checking"
          aria-live="assertive"
        >
          <span class="update-spinner" aria-hidden="true" />
          <span>{{ t("savingAndPreparingToInstall") }}</span>
        </div>

        <template v-else>
          <div v-if="updateState.title" class="update-release-copy">
            <strong>{{ updateState.title }}</strong>
            <ul v-if="updateState.releaseNotes.length">
              <li v-for="note in updateState.releaseNotes" :key="note">
                {{ note }}
              </li>
            </ul>
          </div>

          <div
            v-if="updateDownloading"
            class="update-progress"
            aria-live="polite"
          >
            <div class="update-progress-heading">
              <span>{{ t("downloadingInBackground") }}</span>
              <strong>{{ updateProgressLabel }}</strong>
            </div>
            <div
              class="update-progress-track"
              role="progressbar"
              :aria-valuenow="updateState.percent ?? 0"
            >
              <span :style="{ width: `${updateState.percent ?? 0}%` }" />
            </div>
            <small>
              {{ formatBytes(updateState.transferred) }} /
              {{ formatBytes(updateState.total) }}
              <template v-if="updateState.bytesPerSecond">
                · {{ formatBytes(updateState.bytesPerSecond) }}/s
              </template>
            </small>
          </div>

          <p
            v-if="manualUpdateRequired"
            class="update-status-message"
            role="status"
          >
            {{
              officialDocsUrl
                ? t("theUpdateSourceIsOlderThanTheAnnouncedVersion")
                : t(
                    "theUpdateSourceIsOlderThanTheAnnouncedVersionNoOfficialDocumentationLinkIsConfigured"
                  )
            }}
          </p>
          <p
            v-else-if="updateState.message && updateState.status !== 'error'"
            class="update-status-message"
            :data-status="updateState.status"
          >
            {{ updateState.message }}
          </p>
        </template>

        <div class="dialog-actions">
          <a
            v-if="manualUpdateRequired && officialDocsUrl"
            class="dialog-primary-button"
            :href="officialDocsUrl"
            target="_blank"
            rel="noopener noreferrer"
            >{{ t("openOfficialDocumentation") }}</a
          >
          <button
            v-if="
              manualUpdateRequired ||
              updateState.status === 'error' ||
              updateState.status === 'not-available' ||
              updateState.status === 'unsupported'
            "
            class="dialog-secondary-button"
            type="button"
            :disabled="updateChecking"
            @click="emit('check')"
          >
            {{ t("checkAgain") }}
          </button>
          <button
            v-if="updateState.canDownload && !manualUpdateRequired"
            class="dialog-primary-button"
            type="button"
            @click="emit('download')"
          >
            {{ t("downloadUpdateInBackground") }}
          </button>
          <button
            v-else-if="updateState.canInstall && !manualUpdateRequired"
            class="dialog-primary-button"
            type="button"
            @click="emit('install')"
          >
            {{
              updateState.status === "error"
                ? t("retryInstallation")
                : t("restartAndInstall")
            }}
          </button>
          <button
            v-else-if="updateInstalling"
            class="dialog-primary-button"
            type="button"
            disabled
          >
            {{ t("installing") }}
          </button>
          <button
            v-else-if="
              !updateChecking && !updateDownloading && !updateInstalling
            "
            class="dialog-primary-button"
            type="button"
            @click="close"
          >
            {{ t("close") }}
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
