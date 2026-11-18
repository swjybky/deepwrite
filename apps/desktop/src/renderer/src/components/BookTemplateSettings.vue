<script setup lang="ts">
import { genreLabel } from "./catalogLabels";
import {
  academicCitationStyleLabel,
  academicSubtypeLabel
} from "./academic/academicTreeLabels";
import { createScopedTranslator } from "../i18n";
import { computed, ref } from "vue";
import type { BookTemplate, SaveBookTemplateInput } from "@deepwrite/contracts";
import BookTemplateEditor from "./BookTemplateEditor.vue";
import { useBookTemplates } from "../composables/useBookTemplates";

const t = createScopedTranslator("components.bookTemplateSettings");
const props = defineProps<{
  workspaceType: "short" | "script" | "academic";
  defaultStageIds: readonly string[];
  disabled: boolean;
}>();
const { templates, catalog, loading, saving, failed, load, save, remove } =
  useBookTemplates();
const items = computed(() =>
  templates.value.filter(
    (item) => item.configuration.workspaceType === props.workspaceType
  )
);
const editing = ref<BookTemplate | null | undefined>(undefined);
const deleting = ref<BookTemplate | null>(null);
async function saveTemplate(input: SaveBookTemplateInput) {
  if (await save(input)) editing.value = undefined;
}
async function deleteTemplate() {
  if (deleting.value && (await remove(deleting.value.id)))
    deleting.value = null;
}
</script>
<template>
  <section
    class="book-template-settings"
    :aria-label="t('newTemplateSettings')"
  >
    <div class="template-settings-heading">
      <h3>{{ t("newTemplate") }}</h3>
      <button
        class="dialog-primary-button"
        :disabled="disabled || loading || saving || !catalog"
        @click="editing = null"
      >
        {{ t("newTemplateSettings") }}
      </button>
    </div>
    <p>
      {{ t("saveGenreCharacterStylePlotStagesAndLibraryLinks") }}
    </p>
    <p v-if="loading">
      {{ t("loadingTemplates") }}
    </p>
    <button v-else-if="failed" class="dialog-secondary-button" @click="load">
      {{ t("reload") }}
    </button>
    <p v-else-if="!items.length">
      {{ t("noTemplatesConfiguredYet") }}
    </p>
    <ul v-else class="book-template-list">
      <li v-for="item in items" :key="item.id">
        <div>
          <strong>{{ item.configuration.name }}</strong
          ><small v-if="item.configuration.workspaceType === 'academic'">
            {{ academicSubtypeLabel(item.configuration.subtype) }} ·
            {{ academicCitationStyleLabel(item.configuration.citationStyle) }}
          </small>
          <small v-else
            >{{ genreLabel(item.configuration.genre) }} ·
            {{
              item.configuration.characterFormat === "text"
                ? t("textStyle")
                : t("entryStyle")
            }}</small
          >
        </div>
        <button
          class="dialog-secondary-button"
          :disabled="disabled || saving"
          @click="editing = item"
        >
          {{ t("edit") }}</button
        ><button
          class="dialog-secondary-button"
          :disabled="disabled || saving"
          @click="deleting = item"
        >
          {{ t("delete") }}
        </button>
      </li>
    </ul>
    <BookTemplateEditor
      v-if="editing !== undefined && catalog"
      :workspace-type="workspaceType"
      :template="editing ?? undefined"
      :catalog="catalog"
      :default-stage-ids="defaultStageIds"
      :saving="saving"
      @close="editing = undefined"
      @save="saveTemplate"
    />
    <Teleport to="body"
      ><div
        v-if="deleting"
        class="dialog-backdrop"
        @keydown.esc.stop="!saving && (deleting = null)"
      >
        <section
          class="workspace-dialog book-template-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-template-title"
        >
          <header>
            <h2 id="delete-template-title">
              {{ t("deleteTemplate") }}
            </h2>
          </header>
          <div class="dialog-content book-template-form">
            <p>
              {{
                t("deleteTemplateExistingWorksWillNotBeMessage", {
                  arg0: deleting.configuration.name ?? ""
                })
              }}
            </p>
            <div class="dialog-actions">
              <button
                class="dialog-secondary-button"
                :disabled="saving"
                @click="deleting = null"
              >
                {{ t("cancel") }}</button
              ><button
                class="template-danger-button"
                :disabled="saving"
                @click="deleteTemplate"
              >
                {{ saving ? t("deleting") : t("deleteTemplate") }}
              </button>
            </div>
          </div>
        </section>
      </div></Teleport
    >
  </section>
</template>
<style src="./book-template.css"></style>
