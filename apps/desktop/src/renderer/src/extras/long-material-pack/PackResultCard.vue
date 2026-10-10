<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { ModelConfig } from "@deepwrite/contracts/renderer";
import PopupSelect from "../../components/PopupSelect.vue";
import { formatError } from "../../i18n/errors";
import { uiMessage } from "../../ui-feedback";
import {
  bindPackToWork,
  createImitationBook,
  listPackWorks,
  packGroupLinks,
  type PackWork
} from "./packBindings";
import { packT as t, shortDate, statusLabel } from "./pack-labels";
import { useLongMaterialPackStore } from "./useLongMaterialPack";

const props = defineProps<{ model: ModelConfig | undefined }>();
const emit = defineEmits<{
  openGroup: [groupId: string];
  openLongBook: [bookId: string];
  refreshCatalog: [];
}>();
const store = useLongMaterialPackStore();
const counts = computed(() => {
  const result = store.result;
  if (!result) return [];
  return (
    ["new", "updated", "unchanged", "conflict", "stale", "deleted"] as const
  )
    .filter((status) => result.counts[status])
    .map((status) => ({
      status,
      text: t("countLabel", {
        label: statusLabel(status),
        count: result.counts[status]
      })
    }));
});
const total = computed(
  () =>
    (store.result?.entries ?? []).filter(({ status }) => status !== "stale")
      .length
);
const guideGeneratedAt = computed(() => store.result?.pack.guideGeneratedAt);

const works = ref<PackWork[]>([]);
const workKey = ref("");
const binding = ref(false);
const creating = ref(false);
const workOptions = computed(() =>
  works.value.map((work) => ({
    value: work.key,
    label: `${work.title} · ${t(work.kind === "long" ? "workLong" : work.kind === "script" ? "workScript" : "workShort")}`
  }))
);
async function loadWorks() {
  try {
    works.value = await listPackWorks(window.deepwrite!);
  } catch (error) {
    uiMessage.error(formatError(error, t("bindFailed")));
  }
}
onMounted(() => void loadWorks());
async function bind() {
  const work = works.value.find(({ key }) => key === workKey.value);
  const result = store.result;
  if (!work || !result || binding.value) return;
  binding.value = true;
  try {
    const api = window.deepwrite!;
    await bindPackToWork(
      api,
      work,
      await packGroupLinks(api, result.pack.groupId)
    );
    uiMessage.success(t("bound", { title: work.title }));
    emit("refreshCatalog");
  } catch (error) {
    uiMessage.error(formatError(error, t("bindFailed")));
  } finally {
    binding.value = false;
  }
}
async function createBook() {
  const result = store.result;
  if (!result || creating.value) return;
  creating.value = true;
  try {
    const api = window.deepwrite!;
    const title = t("imitationTitle", { title: result.pack.bookTitle });
    const bookId = await createImitationBook(api, {
      title,
      genre: store.stats?.genre || "其他",
      links: await packGroupLinks(api, result.pack.groupId)
    });
    if (!bookId) return;
    uiMessage.success(t("created", { title }));
    emit("openLongBook", bookId);
  } catch (error) {
    uiMessage.error(formatError(error, t("createFailed")));
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <section
    v-if="store.result"
    class="analysis-card pack-card"
    :aria-label="t('resultTitle')"
  >
    <div class="analysis-card-heading pack-heading">
      <h2>{{ t("resultTitle") }}</h2>
      <span class="pack-muted">
        {{
          t("resultSubtitle", {
            book: store.result.pack.bookTitle,
            group: store.result.pack.groupTitle ?? "",
            date: shortDate(store.result.pack.convertedAt)
          })
        }}
      </span>
    </div>
    <ul class="pack-chips">
      <li>{{ t("countTotal", { count: total }) }}</li>
      <li
        v-for="item in counts"
        :key="item.status"
        :class="`is-${item.status}`"
      >
        {{ item.text }}
      </li>
    </ul>
    <p class="pack-muted">{{ t("resultNote") }}</p>
    <div class="pack-guide-state">
      <span>
        <strong>{{ t("guideState") }}</strong>
        <span class="pack-muted">
          {{
            store.guideStatus === "running" || store.guideStatus === "stopping"
              ? t("guideRunning")
              : store.guideStatus === "applying"
                ? t("guideApplying")
                : guideGeneratedAt
                  ? t("guideGenerated", { date: shortDate(guideGeneratedAt) })
                  : t("guideNotGenerated")
          }}
        </span>
      </span>
      <button
        v-if="store.guideStatus === 'running'"
        type="button"
        @click="store.stopGuide()"
      >
        {{ t("stopGuide") }}
      </button>
      <button
        v-else
        type="button"
        :disabled="store.busy || !store.guideUsable(props.model)"
        @click="store.startGuide(store.result.pack.id, props.model)"
      >
        {{ guideGeneratedAt ? t("rerunGuide") : t("runGuide") }}
      </button>
    </div>
    <p v-if="guideGeneratedAt" class="pack-muted">{{ t("guideRerunHint") }}</p>
    <div class="pack-actions">
      <button
        type="button"
        class="analysis-primary-button"
        @click="emit('openGroup', store.result.pack.groupId)"
      >
        {{ t("openGroup") }}
      </button>
      <button type="button" :disabled="creating" @click="createBook">
        {{ t("createImitation") }}
      </button>
    </div>
    <div class="pack-bind">
      <PopupSelect
        v-model="workKey"
        class="pack-bind-select"
        :options="workOptions"
        :accessible-label="t('bindTarget')"
        :placeholder="t('bindToBook')"
      />
      <button type="button" :disabled="!workKey || binding" @click="bind">
        {{ t("bindConfirm") }}
      </button>
    </div>
    <p class="pack-muted">{{ t("bindHint") }}</p>
  </section>
</template>
