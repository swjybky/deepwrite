<script setup lang="ts">
import { createScopedTranslator } from "../i18n";

const t = createScopedTranslator("components.saveConflictDialog");
defineProps<{
  open: boolean;
  title: string;
  draftContent: string;
  diskContent: string;
  submitting?: boolean;
  nested?: boolean;
}>();

const emit = defineEmits<{
  keep: [];
  reload: [];
  overwrite: [];
}>();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="dialog-backdrop"
      :class="{ 'save-conflict-nested': nested }"
    >
      <section
        class="workspace-dialog save-conflict-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-conflict-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{ t("externalEditConflict") }}</span>
            <h2 id="save-conflict-title">
              {{ t("wasUpdatedInAnotherEditorMessage", { arg0: title ?? "" }) }}
            </h2>
          </div>
        </header>

        <div class="dialog-content">
          <p class="dialog-description">
            {{ t("deepWriteDidNotOverwriteTheDiskContentKeepThe") }}
          </p>
          <div class="save-conflict-columns">
            <section>
              <strong>{{
                t("currentDraftCharactersMessage", {
                  arg0: draftContent.length ?? ""
                })
              }}</strong>
              <pre>{{ draftContent.slice(0, 2000) || t("emptyContent") }}</pre>
            </section>
            <section>
              <strong>{{
                t("diskVersionCharactersMessage", {
                  arg0: diskContent.length ?? ""
                })
              }}</strong>
              <pre>{{ diskContent.slice(0, 2000) || t("emptyContent") }}</pre>
            </section>
          </div>
          <p
            v-if="draftContent.length > 2000 || diskContent.length > 2000"
            class="dialog-note"
          >
            {{ t("theComparisonShowsUpTo2000CharactersActions") }}
          </p>
          <div class="dialog-actions save-conflict-actions">
            <button
              class="dialog-secondary-button"
              type="button"
              :disabled="submitting"
              @click="emit('keep')"
            >
              {{ t("keepCurrentDraft") }}
            </button>
            <button
              class="dialog-secondary-button"
              type="button"
              :disabled="submitting"
              @click="emit('reload')"
            >
              {{ t("reloadDiskVersion") }}
            </button>
            <button
              class="dialog-primary-button is-danger"
              type="button"
              :disabled="submitting"
              @click="emit('overwrite')"
            >
              {{ submitting ? t("overwriting") : t("overwriteDiskVersion") }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.save-conflict-nested {
  z-index: 2300;
}

.save-conflict-dialog {
  width: min(820px, calc(100vw - 40px));
}

.save-conflict-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.save-conflict-columns section {
  min-width: 0;
}

.save-conflict-columns strong {
  display: block;
  margin-bottom: 8px;
  color: var(--text-primary);
  font-size: 13px;
}

.save-conflict-columns pre {
  box-sizing: border-box;
  height: 240px;
  margin: 0;
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-muted);
  color: var(--text-secondary);
  font: 12px/1.6 var(--mono-font);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.save-conflict-actions {
  flex-wrap: wrap;
}

@media (max-width: 680px) {
  .save-conflict-columns {
    grid-template-columns: 1fr;
  }

  .save-conflict-columns pre {
    height: 170px;
  }
}
</style>
