<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed, onMounted, ref, watch } from "vue";
import type {
  LongApplyLegacySyncResult,
  LongChooseLegacySyncSourceResult,
  LongLegacySyncModule
} from "@deepwrite/contracts";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator("components.longLegacySyncDialog");

const props = defineProps<{
  preview: LongChooseLegacySyncSourceResult | null;
  result?: LongApplyLegacySyncResult | null;
  pending?: boolean;
  nested?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [modules: LongLegacySyncModule[]];
}>();

const selected = ref<LongLegacySyncModule[]>([]);
const dialog = ref<HTMLElement>();

onMounted(() => {
  if (props.nested && !dialog.value?.contains(document.activeElement))
    dialog.value?.focus({ preventScroll: true });
});

const options = computed(() => {
  const counts = props.preview?.counts;
  return [
    {
      id: "worldbuilding" as const,
      title: t("worldbuilding"),
      description: t("categoriesOverviewsContentAndEntriesValueCategories", {
        arg0: counts?.worldbuilding ?? 0
      }),
      count: counts?.worldbuilding ?? 0
    },
    {
      id: "characters" as const,
      title: t("characters"),
      description: t(
        "characterProfilesRelationshipsStateAndHistoryValueCharacters",
        { arg0: counts?.characters ?? 0 }
      ),
      count: counts?.characters ?? 0
    },
    {
      id: "plot" as const,
      title: t("plot"),
      description:
        t("outlinesValueVolumeOutlinesValuePlotPointsValue", {
          arg0: counts?.outline ?? 0,
          arg1: counts?.volumes ?? 0,
          arg2: counts?.plotPoints ?? 0
        }) +
        t("storyEventsValueChapterCardsValue", {
          arg0: counts?.storyEvents ?? 0,
          arg1: counts?.chapterCards ?? 0
        }),
      count:
        (counts?.outline ?? 0) +
        (counts?.volumes ?? 0) +
        (counts?.plotPoints ?? 0) +
        (counts?.storyEvents ?? 0) +
        (counts?.chapterCards ?? 0)
    }
  ];
});

watch(
  () => props.preview?.previewId,
  () => {
    selected.value = options.value
      .filter(({ count }) => count > 0)
      .map(({ id }) => id);
  },
  { immediate: true }
);

function toggle(module: LongLegacySyncModule): void {
  if (props.pending || props.result) return;
  selected.value = selected.value.includes(module)
    ? selected.value.filter((candidate) => candidate !== module)
    : [...selected.value, module];
}

function confirm(): void {
  if (props.pending || props.result || selected.value.length === 0) return;
  emit("confirm", [...selected.value]);
}

function total(counts: LongApplyLegacySyncResult["imported"]): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="preview"
      class="dialog-backdrop"
      :class="{ 'book-management-child': nested }"
      @keydown.esc.stop="!pending && emit('close')"
      @mousedown.self="!pending && emit('close')"
    >
      <section
        ref="dialog"
        class="workspace-dialog legacy-sync-dialog"
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legacy-sync-title"
      >
        <header>
          <div>
            <span>{{ t("syncLegacyVersion") }}</span>
            <h2 id="legacy-sync-title">{{ preview.sourceTitle }}</h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            :disabled="pending"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div class="dialog-content legacy-sync-content">
          <template v-if="!result">
            <p>
              {{ t("chooseContentToAppendToThisNovelExistingContent") }}
            </p>
            <div class="legacy-sync-options">
              <button
                v-for="option in options"
                :key="option.id"
                type="button"
                class="legacy-sync-option"
                :class="{ 'is-selected': selected.includes(option.id) }"
                :disabled="pending || option.count === 0"
                @click="toggle(option.id)"
              >
                <span class="legacy-sync-checkbox" aria-hidden="true">
                  <AppIcon
                    v-if="selected.includes(option.id)"
                    name="check"
                    :size="14"
                  />
                </span>
                <span
                  ><strong>{{ option.title }}</strong
                  ><small>{{ option.description }}</small></span
                >
              </button>
            </div>
            <p v-if="preview.warnings.length" class="legacy-sync-warning">
              {{
                t("theArchiveHasParsingNotesThatWillMessage", {
                  arg0: preview.warnings.length ?? ""
                })
              }}
            </p>
          </template>
          <template v-else>
            <div class="legacy-sync-result">
              <AppIcon name="check" :size="24" />
              <strong>{{ t("syncComplete") }}</strong>
              <span>{{
                t("addedSkippedMessage", {
                  arg0: total(result.imported) ?? "",
                  arg1: total(result.skipped) ?? ""
                })
              }}</span>
            </div>
            <details v-if="result.warnings.length">
              <summary>
                {{
                  t("syncNotesMessage", {
                    arg0: result.warnings.length ?? ""
                  })
                }}
              </summary>
              <ul>
                <li v-for="warning in result.warnings" :key="warning">
                  {{ warning }}
                </li>
              </ul>
            </details>
          </template>
          <footer class="dialog-actions">
            <button
              v-if="!result"
              class="dialog-secondary-button"
              type="button"
              :disabled="pending"
              @click="emit('close')"
            >
              {{ t("cancel") }}
            </button>
            <button
              v-if="!result"
              class="dialog-primary-button"
              type="button"
              :disabled="pending || selected.length === 0"
              @click="confirm"
            >
              {{ pending ? t("syncing") : t("sync") }}
            </button>
            <button
              v-else
              class="dialog-primary-button"
              type="button"
              @click="emit('close')"
            >
              {{ t("done") }}
            </button>
          </footer>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.legacy-sync-dialog {
  width: min(620px, calc(100vw - 40px));
}
.legacy-sync-content {
  display: grid;
  gap: 14px;
}
.legacy-sync-content > p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.6;
}
.legacy-sync-options {
  display: grid;
  gap: 8px;
}
.legacy-sync-option {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-raised);
  color: var(--text-primary);
  text-align: left;
}
.legacy-sync-option.is-selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.legacy-sync-option:disabled {
  opacity: 0.5;
}
.legacy-sync-checkbox {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: 1px solid var(--theme-line);
  border-radius: 5px;
}
.legacy-sync-option > span:last-child {
  display: grid;
  gap: 4px;
}
.legacy-sync-option small {
  color: var(--text-tertiary);
  line-height: 1.45;
}
.legacy-sync-warning {
  font-size: 0.785714rem;
}
.legacy-sync-result {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 22px;
  border-radius: 12px;
  background: var(--surface-muted);
}
details {
  color: var(--text-secondary);
}
details ul {
  max-height: 220px;
  overflow: auto;
  padding-left: 22px;
}
</style>
