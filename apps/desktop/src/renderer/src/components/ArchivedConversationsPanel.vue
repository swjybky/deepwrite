<script setup lang="ts">
import { deepwriteApi } from "../api/deepwrite";
import { createId } from "@deepwrite/shared";
import type {
  ConversationHistoryApi,
  ConversationHistoryArchiveListResult
} from "@deepwrite/contracts";
import { computed, onMounted, ref } from "vue";
import { createScopedTranslator } from "../i18n";
import { formatError } from "../i18n/errors";
import {
  archivedConversationId,
  useArchivedConversationDeletion,
  type ArchivedConversationEntry
} from "../composables/useArchivedConversationDeletion";
import { useArchivedConversationPresentation } from "../composables/useArchivedConversationPresentation";
import { useConversationStore } from "../stores/conversationStore";
import { uiMessage } from "../ui-feedback";
import {
  conversationHistoryItem,
  withHistoryDates
} from "../utils/conversationHistoryIndex";
import { conversationHistoryPersistenceKey } from "../utils/conversationPersistenceKeys";
import { invalidateConversationHistoryCursor } from "../utils/conversationHistoryWriter";
import ConversationHistoryDeleteDialog from "./ConversationHistoryDeleteDialog.vue";

const t = createScopedTranslator("components.settingsPage");
type Cursor = NonNullable<ConversationHistoryArchiveListResult["next"]>;
const store = useConversationStore();
const { sourceLabel, formatTime } = useArchivedConversationPresentation();
const items = ref<ArchivedConversationEntry[]>([]);
const next = ref<Cursor | null>(null);
const loaded = ref(false);
const loading = ref(false);
const busyId = ref<string | null>(null);

function historyApi(): ConversationHistoryApi | undefined {
  return deepwriteApi()?.conversationPersistence?.history;
}
async function loadMore(): Promise<void> {
  const api = historyApi();
  if (
    !api ||
    loading.value ||
    actionBusy.value ||
    (loaded.value && !next.value)
  )
    return;
  loading.value = true;
  try {
    const page = await api.listArchived({
      ...(next.value ? { after: next.value } : {}),
      limit: 50
    });
    const records = await Promise.all(
      page.entries.map(async ({ key, session }) => ({
        ...conversationHistoryItem(
          await withHistoryDates(api, key, session),
          null
        ),
        key,
        revision: session.revision
      }))
    );
    const seen = new Set(items.value.map(archivedConversationId));
    items.value = [
      ...items.value,
      ...records.filter((item) => !seen.has(archivedConversationId(item)))
    ];
    next.value = page.next;
    loaded.value = true;
  } catch (error) {
    uiMessage.error(formatError(error, t("archivedConversationLoadFailed")));
  } finally {
    loading.value = false;
  }
}

async function reload(): Promise<void> {
  items.value = [];
  next.value = null;
  loaded.value = false;
  await loadMore();
}

const {
  selectedIds,
  selectedItems,
  allLoadedSelected,
  pendingDelete,
  busy: deleting,
  deletedCount,
  clearSelection,
  deselect,
  toggleSelection,
  toggleLoadedSelection,
  requestOne,
  requestSelected,
  requestAll,
  confirmDelete
} = useArchivedConversationDeletion({ items, getApi: historyApi, reload });
const actionBusy = computed(() => !!busyId.value || deleting.value);

function refresh(): void {
  if (loading.value || actionBusy.value) return;
  clearSelection();
  void reload();
}

async function restoreDirect(
  api: ConversationHistoryApi,
  item: ArchivedConversationEntry
) {
  const session = await api.session({
    key: item.key,
    sessionId: item.sessionId,
    maxBytes: 4096
  });
  if (!session) throw new Error(t("archivedConversationActionFailed"));
  if (!session.deleted) return;
  const batchId = createId("history_restore");
  try {
    await api.commit({
      key: item.key,
      sessionId: item.sessionId,
      batchId,
      expectedRevision: session.revision,
      generation: session.generation,
      sequence: session.sequence + 1,
      operations: [{ type: "setDeleted", deleted: false }]
    });
  } catch (error) {
    const current = await api.session({
      key: item.key,
      sessionId: item.sessionId,
      maxBytes: 4096
    });
    if (current?.deleted !== false) throw error;
  }
  invalidateConversationHistoryCursor(api, item.key, item.sessionId);
}

async function restore(item: ArchivedConversationEntry): Promise<void> {
  const api = historyApi();
  if (!api || actionBusy.value) return;
  busyId.value = archivedConversationId(item);
  try {
    const owner = [...store.controllers.entries()].find(
      ([logicalKey]) =>
        conversationHistoryPersistenceKey(logicalKey) === item.key
    )?.[1];
    if (owner?.historyManagementAvailable) {
      if (!(await owner.restoreConversation(item.sessionId)))
        throw new Error(t("archivedConversationActionFailed"));
    } else {
      await restoreDirect(api, item);
    }
    items.value = items.value.filter(
      (entry) => archivedConversationId(entry) !== archivedConversationId(item)
    );
    deselect(item);
    uiMessage.success(t("archivedConversationRestored"));
  } catch (error) {
    uiMessage.error(formatError(error, t("archivedConversationActionFailed")));
  } finally {
    busyId.value = null;
  }
}

onMounted(() => void loadMore());
</script>

<template>
  <section class="settings-group archived-conversations">
    <div class="archive-heading">
      <p>{{ t("archivedConversationsDescription") }}</p>
      <button type="button" :disabled="loading || actionBusy" @click="refresh">
        {{ t("refreshArchivedConversations") }}
      </button>
    </div>
    <div v-if="items.length" class="archive-toolbar">
      <label class="archive-select-all">
        <input
          type="checkbox"
          :checked="allLoadedSelected"
          :disabled="loading || actionBusy"
          @change="toggleLoadedSelection"
        />
        <span>{{ t("selectLoadedConversations") }}</span>
      </label>
      <span v-if="selectedItems.length" class="archive-selected-count">{{
        t("selectedArchivedConversations", { count: selectedItems.length })
      }}</span>
      <div class="archive-bulk-actions">
        <button
          type="button"
          class="archive-delete"
          :disabled="loading || actionBusy || !selectedItems.length"
          @click="requestSelected"
        >
          {{ t("deleteSelectedConversations") }}
        </button>
        <button
          type="button"
          class="archive-delete"
          :disabled="loading || actionBusy"
          @click="requestAll"
        >
          {{ t("deleteAllArchivedConversations") }}
        </button>
      </div>
    </div>
    <div v-if="items.length" class="settings-card archive-list">
      <article
        v-for="item in items"
        :key="archivedConversationId(item)"
        class="archive-row"
      >
        <label class="archive-select">
          <input
            type="checkbox"
            :checked="selectedIds.has(archivedConversationId(item))"
            :disabled="loading || actionBusy"
            :aria-label="
              t('selectArchivedConversationNamed', { title: item.title })
            "
            @change="toggleSelection(item)"
          />
        </label>
        <div class="archive-copy">
          <strong>{{ item.title }}</strong>
          <small
            >{{ sourceLabel(item.key) }} ·
            {{ formatTime(item.updatedAt) }}</small
          >
          <span v-if="item.preview && item.preview !== item.title">{{
            item.preview
          }}</span>
        </div>
        <div class="archive-actions">
          <button
            type="button"
            :disabled="loading || actionBusy"
            :aria-label="
              t('restoreArchivedConversationNamed', { title: item.title })
            "
            @click="restore(item)"
          >
            {{ t("restoreConversation") }}
          </button>
          <button
            type="button"
            class="archive-delete"
            :disabled="loading || actionBusy"
            :aria-label="
              t('deleteArchivedConversationNamed', { title: item.title })
            "
            @click="requestOne(item)"
          >
            {{ t("permanentlyDeleteConversation") }}
          </button>
        </div>
      </article>
    </div>
    <div v-else class="settings-card archive-empty">
      {{
        loading
          ? t("loadingArchivedConversations")
          : t("noArchivedConversations")
      }}
    </div>
    <button
      v-if="next"
      class="archive-more"
      type="button"
      :disabled="loading || actionBusy"
      @click="loadMore"
    >
      {{
        loading ? t("loadingArchivedConversations") : t("loadMoreConversations")
      }}
    </button>
    <ConversationHistoryDeleteDialog
      v-if="pendingDelete"
      :mode="pendingDelete.kind"
      :title="
        pendingDelete.kind === 'one' ? pendingDelete.item.title : undefined
      "
      :count="
        pendingDelete.kind === 'selected'
          ? pendingDelete.items.length
          : undefined
      "
      :busy="deleting"
      :processed="deletedCount"
      @close="pendingDelete = null"
      @confirm="confirmDelete"
    />
  </section>
</template>

<style scoped src="./settings-page.css"></style>
<style scoped src="./archived-conversations-panel.css"></style>
