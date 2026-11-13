<script setup lang="ts">
import { createScopedTranslator, locale } from "../i18n";
import { inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { SHORT_MANUSCRIPT_PREVIEW_KEY } from "../composables/shortManuscriptPreviewContext";
import { useShortManuscriptCharacterCount } from "../composables/useShortManuscriptCharacterCount";
import type { IconName } from "../types/workspace";
import type { ShortManuscriptExportTarget } from "../utils/shortManuscriptExport";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator("components.exportShortManuscriptDialog");

const props = defineProps<{
  open: boolean;
  bookTitle: string;
  workspaceType?: "short" | "script";
  submitting?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  export: [target: ShortManuscriptExportTarget];
}>();

const selectedTarget = ref<ShortManuscriptExportTarget>("docx");
const { characterCount, loading: characterCountLoading } =
  useShortManuscriptCharacterCount(
    inject(SHORT_MANUSCRIPT_PREVIEW_KEY, null),
    () => props.open
  );

const formats: ReadonlyArray<{
  id: ShortManuscriptExportTarget;
  label: string;
  description: string;
  icon: IconName;
}> = [
  {
    id: "docx",
    get label() {
      return t("dOCXDocument");
    },
    get description() {
      return t("forFurtherFormattingEditingAndPrinting");
    },
    icon: "file"
  },
  {
    id: "txt",
    get label() {
      return t("tXTPlainText");
    },
    get description() {
      return t("widelyCompatibleForReadingAndBackups");
    },
    icon: "file"
  },
  {
    id: "epub",
    get label() {
      return t("ePUBEbook");
    },
    get description() {
      return t("forPhonesAndEbookReaders");
    },
    icon: "book"
  },
  {
    id: "clipboard",
    get label() {
      return t("copyManuscript");
    },
    get description() {
      return t("copyTheFullManuscriptToPasteAnywhere");
    },
    icon: "copy"
  }
];

watch(
  () => props.open,
  (open) => {
    if (open) selectedTarget.value = "docx";
  }
);

function requestClose(): void {
  if (!props.submitting) emit("close");
}

function submit(): void {
  if (!props.submitting) emit("export", selectedTarget.value);
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === "Escape") requestClose();
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @mousedown.self="requestClose">
      <section
        class="workspace-dialog export-manuscript-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-manuscript-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{ bookTitle }}</span>
            <h2 id="export-manuscript-title">
              {{
                t("exportMessage", {
                  arg0:
                    (workspaceType === "script"
                      ? t("episodeManuscripts")
                      : t("manuscript")) ?? ""
                })
              }}
            </h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            :disabled="submitting"
            @click="requestClose"
          >
            ×
          </button>
        </header>

        <form
          class="dialog-content export-manuscript-content"
          @submit.prevent="submit"
        >
          <div
            class="export-manuscript-notice"
            role="note"
            :aria-label="t('exportScope')"
          >
            <span class="export-manuscript-notice-icon">
              <AppIcon name="download" :size="18" />
            </span>
            <div>
              <strong>{{ t("exportScope") }}</strong>
              <p v-if="workspaceType === 'script'">
                {{
                  t(
                    "exportsAllEpisodeManuscriptsOnlyExcludingCharacterStatePlot"
                  )
                }}
              </p>
              <p v-else>
                {{
                  t(
                    "exportsTheIntroductionAndAllManuscriptSectionsOnlyExcluding"
                  )
                }}
              </p>
            </div>
          </div>

          <p class="dialog-description">{{ t("imageExportDescription") }}</p>

          <fieldset class="export-manuscript-formats">
            <legend>
              {{ t("selectExportFormat") }}
            </legend>
            <div class="export-manuscript-format-grid">
              <label
                v-for="format in formats"
                :key="format.id"
                class="export-manuscript-format-card"
                :class="{ 'is-selected': selectedTarget === format.id }"
              >
                <input
                  v-model="selectedTarget"
                  type="radio"
                  name="short-manuscript-format"
                  :value="format.id"
                  :disabled="submitting"
                />
                <span class="export-manuscript-format-icon">
                  <AppIcon :name="format.icon" :size="20" />
                </span>
                <span class="export-manuscript-format-copy">
                  <strong>
                    {{ format.label }}
                    <span
                      v-if="format.id === 'clipboard'"
                      class="export-manuscript-character-count"
                      aria-live="polite"
                    >
                      {{
                        characterCount !== null
                          ? t("fullManuscriptValueCharacters", {
                              arg0: characterCount.toLocaleString(locale)
                            })
                          : characterCountLoading
                            ? t("countingFullManuscript")
                            : t("fullManuscriptCountUnavailable")
                      }}
                    </span>
                  </strong>
                  <small>{{ format.description }}</small>
                </span>
                <span class="export-manuscript-format-check" aria-hidden="true"
                  >✓</span
                >
              </label>
            </div>
          </fieldset>

          <div class="dialog-actions export-manuscript-actions">
            <button
              class="dialog-secondary-button"
              type="button"
              :disabled="submitting"
              @click="requestClose"
            >
              {{ t("cancel") }}
            </button>
            <button
              class="dialog-primary-button"
              type="submit"
              :disabled="submitting"
            >
              <AppIcon
                :name="selectedTarget === 'clipboard' ? 'copy' : 'download'"
                :size="15"
              />
              {{
                submitting
                  ? selectedTarget === "clipboard"
                    ? t("copying")
                    : t("exporting")
                  : selectedTarget === "clipboard"
                    ? t("copyManuscript")
                    : t("selectSaveLocation")
              }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.export-manuscript-dialog {
  width: min(650px, calc(100vw - 48px));
}

.export-manuscript-content {
  display: grid;
  gap: 18px;
}

.export-manuscript-notice {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: start;
  gap: 11px;
  padding: 13px 14px;
  border: 1px solid color-mix(in srgb, var(--accent, #7c5c3e) 24%, transparent);
  border-radius: 10px;
  background: color-mix(
    in srgb,
    var(--accent, #7c5c3e) 8%,
    var(--surface-raised, #fff)
  );
}

.export-manuscript-notice-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--accent, #7c5c3e) 14%, transparent);
  color: var(--accent, #7c5c3e);
}

.export-manuscript-notice strong {
  display: block;
  margin-bottom: 3px;
  color: var(--text-primary, #303338);
  font-size: 0.821429rem;
  font-weight: 640;
}

.export-manuscript-notice p {
  margin: 0;
  color: var(--text-secondary, #70747a);
  font-size: 0.75rem;
  line-height: 1.65;
}

.export-manuscript-formats {
  min-width: 0;
  padding: 0;
  border: 0;
}

.export-manuscript-formats legend {
  margin-bottom: 9px;
  color: var(--text-primary, #303338);
  font-size: 0.785714rem;
  font-weight: 620;
}

.export-manuscript-format-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}

.export-manuscript-format-card {
  position: relative;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  min-width: 0;
  min-height: 88px;
  padding: 12px;
  border: 1px solid var(--theme-line, #dededb);
  border-radius: 11px;
  background: var(--surface-raised, #fff);
  cursor: pointer;
  transition:
    border-color 120ms ease,
    background 120ms ease,
    box-shadow 120ms ease;
}

.export-manuscript-format-card:hover {
  border-color: color-mix(
    in srgb,
    var(--accent, #7c5c3e) 45%,
    var(--theme-line, #dededb)
  );
  background: var(--surface-hover, #f7f7f5);
}

.export-manuscript-format-card.is-selected {
  border-color: var(--accent, #7c5c3e);
  background: color-mix(
    in srgb,
    var(--accent, #7c5c3e) 7%,
    var(--surface-raised, #fff)
  );
  box-shadow: 0 0 0 1px
    color-mix(in srgb, var(--accent, #7c5c3e) 18%, transparent);
}

.export-manuscript-format-card input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.export-manuscript-format-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--surface-muted, #f1f1ef);
  color: var(--text-secondary, #60646a);
}

.is-selected .export-manuscript-format-icon {
  background: color-mix(in srgb, var(--accent, #7c5c3e) 14%, transparent);
  color: var(--accent, #7c5c3e);
}

.export-manuscript-format-copy {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.export-manuscript-format-copy strong {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  color: var(--text-primary, #303338);
  font-size: 0.785714rem;
  font-weight: 620;
}

.export-manuscript-character-count {
  color: var(--text-secondary, #70747a);
  font-size: 0.714286rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.export-manuscript-format-copy small {
  color: var(--text-tertiary, #85898e);
  font-size: 0.642857rem;
  line-height: 1.45;
}

.export-manuscript-format-check {
  position: absolute;
  top: 7px;
  right: 8px;
  display: none;
  color: var(--accent, #7c5c3e);
  font-size: 0.714286rem;
  font-weight: 700;
}

.is-selected .export-manuscript-format-check {
  display: block;
}

.export-manuscript-actions {
  margin-top: 0;
  padding-top: 2px;
}

@media (max-width: 680px) {
  .export-manuscript-format-grid {
    grid-template-columns: 1fr;
  }

  .export-manuscript-format-card {
    min-height: 70px;
  }
}
</style>
