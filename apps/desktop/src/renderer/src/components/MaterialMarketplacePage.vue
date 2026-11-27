<script setup lang="ts">
import { deepwriteApi } from "../api/deepwrite";
import { computed, onMounted, ref, watch } from "vue";
import type {
  MarketplaceMaterialDetail,
  MarketplaceMaterialSummary,
  MaterialLibraryKind
} from "@deepwrite/contracts";
import {
  MATERIAL_KIND_LABELS,
  MATERIAL_STAGE_LABELS
} from "../data/catalogWorkspace";
import { createScopedTranslator } from "../i18n";
import { formatError } from "../i18n/errors";
import { uiMessage } from "../ui-feedback";
import PopupSelect from "./PopupSelect.vue";

const emit = defineEmits<{ refreshCatalog: [] }>();
const t = createScopedTranslator("components.workspaceFeatureModules");
const query = ref("");
const kind = ref<MaterialLibraryKind | "">("");
const libraries = ref<MarketplaceMaterialSummary[]>([]);
const detail = ref<MarketplaceMaterialDetail | null>(null);
const loading = ref(false);
const detailPending = ref(false);
const installing = ref(false);
const loadFailed = ref(false);
const installedVersions = ref(new Map<string, number>());
const detailHeading = ref<HTMLElement | null>(null);
let detailTrigger: HTMLElement | null = null;
const kinds = computed(() => [
  { value: "", label: t("allMaterialCategories") },
  ...Object.entries(MATERIAL_KIND_LABELS).map(([value, label]) => ({
    value,
    label
  }))
]);
const alreadyInstalled = computed(
  () =>
    detail.value !== null &&
    installedVersions.value.get(detail.value.id) === detail.value.version
);

async function load(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  loadFailed.value = false;
  try {
    libraries.value = await deepwriteApi()!.marketplace.listMaterials({
      query: query.value,
      ...(kind.value ? { kind: kind.value } : {})
    });
  } catch (error: unknown) {
    loadFailed.value = true;
    uiMessage.error(formatError(error, t("loadMaterialsFailed")));
  } finally {
    loading.value = false;
  }
}

async function openDetail(
  item: MarketplaceMaterialSummary,
  event: MouseEvent
): Promise<void> {
  if (detailPending.value) return;
  detailPending.value = true;
  detailTrigger = event.currentTarget as HTMLElement;
  try {
    detail.value = await deepwriteApi()!.marketplace.materialDetail(item.id);
  } catch (error: unknown) {
    uiMessage.error(formatError(error, t("loadMaterialDetailFailed")));
  } finally {
    detailPending.value = false;
  }
}

function closeDetail(): void {
  if (installing.value) return;
  detail.value = null;
  detailTrigger?.focus();
}

async function install(): Promise<void> {
  if (!detail.value || installing.value || alreadyInstalled.value) return;
  const { id, version } = detail.value;
  installing.value = true;
  try {
    const result = await deepwriteApi()!.marketplace.installMaterial({
      id,
      version
    });
    installedVersions.value.set(id, version);
    if (result.alreadyInstalled) uiMessage.info(t("materialAlreadyInstalled"));
    else {
      uiMessage.success(t("materialInstalled", { title: result.title }));
      emit("refreshCatalog");
    }
  } catch (error: unknown) {
    uiMessage.error(formatError(error, t("installMaterialFailed")));
  } finally {
    installing.value = false;
  }
}

watch(detailHeading, (heading) => heading?.focus());
onMounted(() => void load());
</script>

<template>
  <section class="material-plaza" :aria-label="t('materialMarketplace')">
    <header>
      <h1>{{ t("materialMarketplace") }}</h1>
    </header>
    <form class="material-plaza-filters" @submit.prevent="load">
      <input
        v-model="query"
        type="search"
        maxlength="256"
        :aria-label="t('searchMaterialLibraries')"
        :placeholder="t('searchMaterialLibraries')"
      />
      <PopupSelect
        v-model="kind"
        :options="kinds"
        :accessible-label="t('materialCategory')"
        variant="compact"
        :disabled="loading"
        @update:model-value="load"
      />
      <button class="dialog-secondary-button" type="submit" :disabled="loading">
        {{ t("search") }}
      </button>
    </form>
    <p v-if="loading" role="status">{{ t("loadingMaterials") }}</p>
    <p v-else-if="loadFailed" role="status">{{ t("loadMaterialsFailed") }}</p>
    <p v-else-if="!libraries.length" role="status">
      {{ t("noMaterialLibraries") }}
    </p>
    <ul v-else class="material-plaza-libraries">
      <li v-for="item in libraries" :key="item.id">
        <button
          type="button"
          :disabled="detailPending"
          @click="openDetail(item, $event)"
        >
          <strong>{{ item.title }}</strong>
          <span>{{ MATERIAL_KIND_LABELS[item.kind] }}</span>
          <p v-if="item.overview">{{ item.overview }}</p>
        </button>
      </li>
    </ul>
    <Teleport to="body">
      <div
        v-if="detail"
        class="dialog-backdrop"
        @mousedown.self="closeDetail"
        @keydown.esc.stop="closeDetail"
      >
        <section
          class="workspace-dialog material-plaza-detail"
          role="dialog"
          aria-modal="true"
          aria-labelledby="material-plaza-title"
        >
          <header>
            <h2 id="material-plaza-title" ref="detailHeading" tabindex="-1">
              {{ detail.title }}
            </h2>
            <button
              class="dialog-close"
              type="button"
              :aria-label="t('close')"
              :disabled="installing"
              @click="closeDetail"
            >
              ×
            </button>
          </header>
          <div class="dialog-content">
            <p class="dialog-description">
              {{ MATERIAL_KIND_LABELS[detail.kind] }} · v{{ detail.version }}
            </p>
            <p v-if="detail.overview" class="material-plaza-overview">
              {{ detail.overview }}
            </p>
            <ul v-if="detail.entries.length" class="material-plaza-entries">
              <li v-for="(entry, index) in detail.entries" :key="index">
                <details>
                  <summary>
                    {{ entry.title }} ·
                    {{ MATERIAL_STAGE_LABELS[entry.stageId] }}
                  </summary>
                  <pre>{{ entry.body }}</pre>
                </details>
              </li>
            </ul>
          </div>
          <footer class="dialog-actions">
            <button
              class="dialog-secondary-button"
              type="button"
              :disabled="installing"
              @click="closeDetail"
            >
              {{ t("close") }}
            </button>
            <button
              class="dialog-primary-button"
              type="button"
              :disabled="installing || alreadyInstalled"
              @click="install"
            >
              {{
                alreadyInstalled
                  ? t("materialAlreadyInstalled")
                  : installing
                    ? t("installingMaterial")
                    : t("installMaterial")
              }}
            </button>
          </footer>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.material-plaza {
  height: 100%;
  overflow: auto;
  padding: 24px clamp(22px, 4vw, 54px);
  color: var(--text-primary);
}
.material-plaza h1 {
  margin: 0 0 16px;
  font-size: 1.5rem;
}
.material-plaza-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.material-plaza-filters input {
  width: min(280px, 100%);
  padding: 8px 10px;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  background: var(--surface-main);
  color: inherit;
  font: inherit;
}
.material-plaza-filters :deep(.popup-select) {
  width: auto;
  min-width: 8rem;
  max-width: 100%;
}
.material-plaza-libraries {
  display: grid;
  gap: 8px;
  margin-block: 14px 0;
  padding: 0;
  list-style: none;
}
.material-plaza-libraries button {
  display: grid;
  justify-items: start;
  gap: 4px;
  width: 100%;
  padding: 12px;
  text-align: start;
  border: 1px solid var(--theme-line-soft);
  border-radius: 9px;
  background: var(--surface-raised);
  color: inherit;
  font: inherit;
  overflow-wrap: anywhere;
}
.material-plaza-libraries button:hover {
  background: var(--surface-hover);
}
.material-plaza-libraries span,
.material-plaza-libraries p {
  color: var(--text-secondary);
}
.material-plaza-libraries p {
  margin: 0;
  white-space: pre-wrap;
}
.material-plaza-detail h2 {
  overflow-wrap: anywhere;
}
.material-plaza-detail .dialog-actions {
  padding: 12px 22px;
  border-top: 1px solid var(--theme-line-soft);
}
.material-plaza-overview,
.material-plaza-entries pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.material-plaza-entries {
  padding-inline-start: 1.2em;
}
</style>
