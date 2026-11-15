<script setup lang="ts">
import type { AppAlertHistoryEntry } from "@deepwrite/contracts/renderer";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { createScopedTranslator, locale } from "../i18n";
import { formatError } from "../i18n/errors";
import { uiMessage } from "../ui-feedback";
import StartupAlertDialog from "./StartupAlertDialog.vue";

const t = createScopedTranslator("components.sidebarProfileMenu");
const emit = defineEmits<{ close: [] }>();
const history = ref<AppAlertHistoryEntry[]>([]);
const selectedRevision = ref("");
const selected = computed(() =>
  history.value.find((entry) => entry.revision === selectedRevision.value)
);
const messages = computed(() => selected.value?.messages ?? []);
function formatDate(value: string): string {
  return new Intl.DateTimeFormat(locale.value, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
const loading = ref(true);
const emptyText = computed(() =>
  loading.value ? t("loadingAnnouncements") : t("noAnnouncements")
);
let disposed = false;

onMounted(async () => {
  try {
    const api = window.deepwrite?.appAlerts;
    if (!api) throw new Error(t("couldNotLoadAnnouncements"));
    const snapshot = await api.get();
    if (!disposed) {
      history.value = [...(snapshot.history ?? [])].sort((a, b) =>
        b.receivedAt.localeCompare(a.receivedAt)
      );
      selectedRevision.value = history.value[0]?.revision ?? "";
    }
  } catch (error: unknown) {
    if (!disposed) {
      uiMessage.error(formatError(error, t("couldNotLoadAnnouncements")));
      emit("close");
    }
  } finally {
    if (!disposed) loading.value = false;
  }
});

onBeforeUnmount(() => {
  disposed = true;
});
</script>

<template>
  <StartupAlertDialog
    :open="true"
    :messages="messages"
    :title="t('announcements')"
    :empty-text="emptyText"
    :loading="loading"
    @close="emit('close')"
  >
    <template #sidebar>
      <nav :aria-label="t('announcementHistory')" class="announcement-history">
        <h3>{{ t("announcementHistory") }}</h3>
        <p class="announcement-history-note">
          {{ t("localAnnouncementHistory") }}
        </p>
        <ol>
          <li v-for="entry in history" :key="entry.revision">
            <button
              type="button"
              :aria-current="
                selectedRevision === entry.revision ? 'true' : undefined
              "
              @click="selectedRevision = entry.revision"
            >
              <time :datetime="entry.receivedAt">{{
                formatDate(entry.receivedAt)
              }}</time>
              <span
                class="announcement-history-preview"
                :title="entry.messages[0]"
                >{{ entry.messages[0] }}</span
              >
            </button>
          </li>
        </ol>
      </nav>
    </template>
    <template #content-heading>
      <time
        v-if="selected"
        class="announcement-received"
        :datetime="selected.receivedAt"
      >
        {{
          t("announcementReceivedAt", { time: formatDate(selected.receivedAt) })
        }}
      </time>
    </template>
  </StartupAlertDialog>
</template>

<style scoped>
.announcement-history h3 {
  margin: 0 8px 8px;
  font-size: 0.93rem;
}
.announcement-history-note {
  margin: 0 8px 18px;
  color: var(--text-tertiary);
  font-size: 0.78rem;
  line-height: 1.6;
}
.announcement-history ol {
  margin: 0 0 0 12px;
  padding: 0;
  border-left: 1px solid var(--theme-line);
  list-style: none;
}
.announcement-history li {
  position: relative;
  padding: 0 0 8px 12px;
}
.announcement-history li::before {
  position: absolute;
  top: 15px;
  left: -4px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-tertiary);
  content: "";
}
.announcement-history li:has([aria-current])::before {
  background: var(--accent);
}
.announcement-history button {
  display: grid;
  gap: 6px;
  width: 100%;
  padding: 10px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  text-align: left;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.announcement-history button:hover {
  background: var(--surface-hover);
}
.announcement-history button[aria-current] {
  background: var(--surface-selected);
  color: var(--accent);
}
.announcement-history time {
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
.announcement-history-preview {
  overflow: hidden;
  color: var(--text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.announcement-received {
  color: var(--text-tertiary);
  font-size: 0.8rem;
}
</style>
