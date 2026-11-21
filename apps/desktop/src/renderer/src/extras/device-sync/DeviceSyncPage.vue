<script setup lang="ts">
import { syncText } from "./displayText";
import { createScopedTranslator, locale } from "../../i18n";
import { ref } from "vue";
import QRCode from "qrcode/lib/browser.js";
import type { SyncHistory } from "@deepwrite/contracts/renderer";
import AppIcon from "../../components/AppIcon.vue";
import { useDeviceSync } from "./useDeviceSync";
import SyncConnectionForm from "./SyncConnectionForm.vue";
import SyncConflictCard from "./SyncConflictCard.vue";
import SyncStatusCard from "./SyncStatusCard.vue";
import SyncChangesPanel from "./SyncChangesPanel.vue";
import SyncInitializationPanel from "./SyncInitializationPanel.vue";
import SyncContentPanel from "./SyncContentPanel.vue";
import { uiMessage } from "../../ui-feedback";
import "./device-sync.css";

const t = createScopedTranslator("extras");
const props = defineProps<{
  prepareSync(): Promise<boolean>;
  refreshSync(): Promise<void>;
}>();
const { status, pending, initialLoading, loadInitialStatus, run, scope } =
  useDeviceSync(props.refreshSync, props.prepareSync);
const tab = ref("overview");
const qr = ref("");
const restoring = ref<Omit<SyncHistory, "item"> | null>(null);
const tabs = [
  {
    id: "overview",
    get label() {
      return t("deviceSync.pendingSync");
    }
  },
  {
    id: "content",
    get label() {
      return t("deviceSync.syncScope");
    }
  },
  {
    id: "devices",
    get label() {
      return t("deviceSync.devices");
    }
  },
  {
    id: "history",
    get label() {
      return t("deviceSync.historyRecovery");
    }
  },
  {
    id: "initialization",
    get label() {
      return t("deviceSync.initializeFromRemote");
    }
  },
  {
    id: "connection",
    get label() {
      return t("deviceSync.connectionSettings");
    }
  }
];
async function connectPhone() {
  const result = await run({ operation: "code" });
  if (result?.kind !== "code") return;
  try {
    qr.value = await QRCode.toDataURL(result.code, {
      width: 256,
      margin: 2,
      errorCorrectionLevel: "M"
    });
  } catch {
    uiMessage.error(t("deviceSync.connectionCodeFailed"));
  }
}
async function restore() {
  const entry = restoring.value;
  if (!entry) return;
  restoring.value = null;
  await run({ operation: "restore", historyId: entry.id });
}
</script>
<template>
  <section class="device-sync-page" :aria-label="t('deviceSync.deviceSync')">
    <header class="sync-page-heading">
      <div>
        <p class="sync-eyebrow">{{ t("deviceSync.syncEyebrow") }}</p>
        <h1>{{ t("deviceSync.deviceSync") }}</h1>
        <p>{{ t("deviceSync.syncDescription") }}</p>
      </div>
      <button
        v-if="status?.config?.spaceId"
        class="sync-button secondary"
        :disabled="pending"
        @click="connectPhone"
      >
        {{ t("deviceSync.connectPhone") }}
      </button>
    </header>
    <button
      v-if="status?.config?.spaceId && tab === 'connection'"
      class="sync-button quiet sync-back-button"
      @click="tab = 'overview'"
    >
      <AppIcon name="arrow-left" />
      <span>{{ t("deviceSync.backToSync") }}</span>
    </button>
    <section
      v-if="!status"
      class="sync-card"
      :aria-busy="initialLoading"
      :aria-label="t('deviceSync.readSyncStatus')"
    >
      <p role="status">
        {{
          initialLoading
            ? t("deviceSync.loadingSyncStatus")
            : t("deviceSync.statusNotLoaded")
        }}
      </p>
      <button
        v-if="!initialLoading"
        class="sync-button secondary"
        @click="loadInitialStatus"
      >
        {{ t("deviceSync.reload") }}
      </button>
    </section>
    <SyncConnectionForm
      v-else-if="!status.config?.spaceId || tab === 'connection'"
      :config="status?.config ?? null"
      :pending="pending"
      :request="run"
      @done="tab = 'overview'"
    />
    <template v-else>
      <SyncStatusCard :status="status" :pending="pending" @request="run" />
      <nav class="sync-tabs" :aria-label="t('deviceSync.syncPages')">
        <button
          v-for="entry in tabs"
          :key="entry.id"
          :aria-current="tab === entry.id ? 'page' : undefined"
          @click="tab = entry.id"
        >
          {{ entry.label }}
        </button>
      </nav>
      <template v-if="tab === 'overview'">
        <section
          v-if="status.issues.some((entry) => entry.reason === 'unsupported')"
          class="sync-card"
        >
          <h2>{{ t("deviceSync.localWorksUnavailable") }}</h2>
          <p>{{ t("deviceSync.initializeHelp") }}</p>
          <button
            class="sync-button secondary"
            :disabled="pending"
            @click="tab = 'initialization'"
          >
            {{ t("deviceSync.initializeFromRemote") }}
          </button>
        </section>
        <SyncChangesPanel
          :status="status"
          :pending="pending"
          @resolve="
            (key, side) =>
              run({ operation: 'sync', adoption: { side, keys: [key] } })
          "
        />
        <SyncConflictCard
          v-for="issue in status.issues.filter(
            (entry) => entry.reason !== 'first-sync'
          )"
          :key="issue.token || issue.key"
          :issue="issue"
          :pending="pending"
          @resolve="
            (side) =>
              run({
                operation: 'sync',
                adoption: { side, keys: [issue.key] }
              })
          "
        />
      </template>
      <SyncInitializationPanel
        v-if="tab === 'initialization'"
        :status="status"
        :pending="pending"
        :request="run"
      />
      <SyncContentPanel
        v-if="tab === 'content'"
        :items="scope.items.value"
        @toggle="(key, included) => scope.toggle([key], included)"
        @toggle-many="scope.toggle"
      />
      <section v-if="tab === 'devices'" class="sync-card">
        <h2>{{ t("deviceSync.connectedDevices") }}</h2>
        <p>
          {{
            t("deviceSync.deviceStatusAsOf", {
              date: status.lastCheckedAt
                ? new Date(status.lastCheckedAt).toLocaleString(locale)
                : t("deviceSync.notChecked")
            })
          }}
        </p>
        <div
          v-for="device in status.devices"
          :key="device.id"
          class="sync-list-row"
        >
          <strong
            >{{ device.name
            }}{{
              device.id === status.deviceId ? t("deviceSync.thisDevice") : ""
            }}</strong
          ><span
            >{{
              device.receivedCurrent
                ? t("deviceSync.latestRetrieved")
                : t("deviceSync.retrievalUnconfirmed")
            }}<small>{{
              new Date(device.updatedAt).toLocaleString(locale)
            }}</small></span
          >
        </div>
      </section>
      <section v-if="tab === 'history'" class="sync-card">
        <h2>{{ t("deviceSync.historyRecovery") }}</h2>
        <p>{{ t("deviceSync.restoreDescription") }}</p>
        <div
          v-for="entry in status.history"
          :key="entry.id"
          class="sync-list-row"
        >
          <span
            >{{ entry.title
            }}<small
              >{{
                entry.descriptionText
                  ? syncText(entry.descriptionText)
                  : entry.description
              }}
              · {{ new Date(entry.at).toLocaleString(locale) }}</small
            ></span
          ><button
            class="sync-button secondary"
            :disabled="pending || !entry.canRestore"
            @click="restoring = entry"
          >
            {{ t("deviceSync.restoreVersion") }}
          </button>
        </div>
      </section>
    </template>
    <section v-if="qr" class="sync-card sync-pairing">
      <div>
        <h2>{{ t("deviceSync.scanConnectionCode") }}</h2>
        <p>{{ t("deviceSync.scanInstructions") }}</p>
        <p>{{ t("deviceSync.codeContainsNoPassword") }}</p>
        <button class="sync-button quiet" @click="qr = ''">
          {{ t("deviceSync.hideConnectionCode") }}
        </button>
      </div>
      <img
        :src="qr"
        width="256"
        height="256"
        :alt="t('deviceSync.connectionQrCode')"
      />
    </section>
    <div
      v-if="restoring"
      class="sync-modal-backdrop"
      @click.self="restoring = null"
    >
      <section
        class="sync-card"
        role="dialog"
        aria-modal="true"
        :aria-label="t('deviceSync.restoreLocally')"
      >
        <h2>{{ t("deviceSync.restoreLocally") }}</h2>
        <p>
          {{
            t("deviceSync.restoreConfirmation", {
              title: restoring.title
            })
          }}
        </p>
        <div class="sync-tabs">
          <button class="sync-button secondary" @click="restoring = null">
            {{ t("cloudBackup.cancel") }}</button
          ><button class="sync-button" @click="restore">
            {{ t("deviceSync.restore") }}
          </button>
        </div>
      </section>
    </div>
  </section>
</template>
