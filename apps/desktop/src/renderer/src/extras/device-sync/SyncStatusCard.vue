<script setup lang="ts">
import { computed } from "vue";
import type { SyncRequest, SyncStatus } from "@deepwrite/contracts/renderer";
import { syncPresentation } from "./presentation";
import SyncAdoptionButtons from "./SyncAdoptionButtons.vue";
const props = defineProps<{ status: SyncStatus; pending: boolean }>();
const emit = defineEmits<{ request: [input: SyncRequest] }>();
const view = computed(() => syncPresentation(props.status));
const first = computed(() =>
  props.status.issues.some((issue) => issue.reason === "first-sync")
);
</script>
<template>
  <section class="sync-card">
    <h2 aria-live="polite">
      {{ pending ? status.progress.title || "正在检查" : view.title }}
    </h2>
    <p>
      本机 → 远端：{{ view.uploads.length }} 项 · 远端 → 本机：{{
        view.downloads.length
      }}
      项<span v-if="view.both.length">
        · 两端修改：{{ view.both.length }} 项</span
      >
    </p>
    <div v-if="pending">
      <p>
        {{ status.progress.completed }} / {{ status.progress.total }} 项变化
      </p>
      <p v-if="status.progress.filesTotal">
        文件 {{ status.progress.filesCompleted ?? 0 }} /
        {{ status.progress.filesTotal }}
      </p>
      <button
        class="sync-button secondary"
        @click="emit('request', { operation: 'cancel' })"
      >
        取消
      </button>
    </div>
    <div v-else class="sync-actions">
      <button
        v-if="!status.firstSyncConfirmed"
        class="sync-button"
        @click="emit('request', { operation: 'sync', confirmFirst: first })"
      >
        {{ first ? "确认并开始首次同步" : "预览首次同步" }}
      </button>
      <template v-else>
        <button
          class="sync-button"
          :disabled="!view.uploads.length"
          @click="emit('request', { operation: 'sync', direction: 'upload' })"
        >
          上传本机修改{{
            view.uploads.length ? `（${view.uploads.length}）` : ""
          }}
        </button>
        <button
          class="sync-button secondary"
          :disabled="!view.downloads.length"
          @click="emit('request', { operation: 'sync', direction: 'download' })"
        >
          下载远端更新{{
            view.downloads.length ? `（${view.downloads.length}）` : ""
          }}
        </button>
        <SyncAdoptionButtons
          v-if="view.adoptionKeys.length"
          all
          :pending="pending"
          @resolve="
            (side) =>
              emit('request', {
                operation: 'sync',
                adoption: { side, keys: view.adoptionKeys }
              })
          "
        />
      </template>
      <button
        class="sync-button quiet"
        @click="emit('request', { operation: 'check' })"
      >
        检查远端更新
      </button>
    </div>
    <p v-if="view.adoptionKeys.length">
      采用所选端的完整版本处理未完成项。替换前的本机版本可在“历史与恢复”中找回。
    </p>
    <p v-if="!pending && status.progress.title" aria-live="polite">
      {{ status.progress.title }}
    </p>
    <p>
      {{
        status.lastSuccessAt
          ? `上次操作成功：${new Date(status.lastSuccessAt).toLocaleString()}`
          : status.firstSyncConfirmed
            ? "尚无全部成功记录，未完成项可单独处理"
            : "尚未完成首次同步"
      }}
    </p>
    <p v-if="status.firstSyncConfirmed">{{ view.receipt }}</p>
    <p>
      {{
        status.lastCheckedAt
          ? `远端检查：${new Date(status.lastCheckedAt).toLocaleString()}`
          : "尚未检查远端"
      }}。仅核对已上传的数据，另一端未上传的编辑不可见。
    </p>
  </section>
</template>
