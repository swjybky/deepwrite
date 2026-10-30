<script setup lang="ts">
import { nextTick, ref, useId, watch } from "vue";
import { createId } from "@deepwrite/shared";
import type { LongBookDecompositionProfile } from "@deepwrite/contracts/renderer";
import { usePresetDraft } from "../analysis-ui/usePresetDraft";
import PresetManagerShell from "../analysis-ui/PresetManagerShell.vue";
import { createScopedTranslator } from "../../i18n";
import { formatError } from "../../i18n/errors";
import { uiMessage } from "../../ui-feedback";
import type { LongBookDecompositionController } from "./useLongBookDecomposition";
const t = createScopedTranslator("extras.longBookDecomposition");
const common = createScopedTranslator("extras.longBookAnalysis");
const MAX_PROFILES = 20;
const MAX_CATEGORIES = 20;
const props = defineProps<{
  open: boolean;
  controller: LongBookDecompositionController;
}>();
const emit = defineEmits<{ close: [] }>();
const { draft, dirty, resetting, reset, snapshot } =
  usePresetDraft<LongBookDecompositionProfile>({
    open: () => props.open,
    presets: () => props.controller.profiles.value,
    loadDefaults: () => props.controller.loadProfileDefaults()
  });
const expandedId = ref<string | null>(null);
const editorId = useId();
const saving = ref(false);
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    expandedId.value = null;
  },
  { immediate: true }
);

async function expand(id: string): Promise<void> {
  expandedId.value = id;
  await nextTick();
  const editor = document.getElementById(`${editorId}-${id}`);
  editor?.scrollIntoView({ block: "nearest" });
  editor?.querySelector("input")?.focus({ preventScroll: true });
}
function add(): void {
  const id = createId("decomposition");
  draft.value.push({
    id,
    name: t("createProfile"),
    description: t("newProfileDescription"),
    systemPrompt: "",
    worldCategories: [{ id: "rules", title: t("worldCategories") }]
  });
  void expand(id);
}
function remove(index: number): void {
  const [removed] = draft.value.splice(index, 1);
  if (removed && expandedId.value === removed.id) expandedId.value = null;
}
function addCategory(profile: LongBookDecompositionProfile): void {
  profile.worldCategories.push({
    id: `category_${profile.worldCategories.length + 1}`,
    title: t("categoryTitle")
  });
}
async function save(): Promise<void> {
  if (saving.value || resetting.value) return;
  saving.value = true;
  try {
    await props.controller.saveProfiles(snapshot());
    uiMessage.success(t("profilesSaved"));
    emit("close");
  } catch (error) {
    uiMessage.error(formatError(error, t("operationFailed")));
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <PresetManagerShell
    :dirty="dirty"
    :busy="saving || resetting"
    :open="open"
    :title="t('profiles')"
    :description="t('title')"
    :close-label="t('close')"
    @close="emit('close')"
  >
    <div class="preset-toolbar" :inert="saving || resetting">
      <button
        type="button"
        :disabled="draft.length >= MAX_PROFILES"
        @click="add"
      >
        {{ t("createProfile") }}
      </button>
      <small>{{ t("profileManagerHelp") }}</small>
      <span>{{ draft.length }} / {{ MAX_PROFILES }}</span>
    </div>
    <div class="preset-list" :inert="saving || resetting">
      <article
        v-for="(profile, index) in draft"
        :key="profile.id"
        :class="{ 'is-expanded': expandedId === profile.id }"
      >
        <div class="profile-heading">
          <button
            class="preset-summary"
            type="button"
            :aria-expanded="expandedId === profile.id"
            :aria-controls="`${editorId}-${profile.id}`"
            @click="
              expandedId === profile.id
                ? (expandedId = null)
                : expand(profile.id)
            "
          >
            <span class="preset-title-row">
              <strong>{{ profile.name || t("createProfile") }}</strong>
              <span v-if="profile.builtin" class="preset-badge">{{
                t("builtinBadge")
              }}</span>
            </span>
            <span v-if="profile.description" class="preset-description">{{
              profile.description
            }}</span>
            <span class="preset-meta"
              ><span
                >{{ t("worldCategories") }} ·
                {{ profile.worldCategories.length }}</span
              ></span
            >
            <span class="preset-toggle">{{
              expandedId === profile.id
                ? common("collapseEditor")
                : common("expandEditor")
            }}</span>
          </button>
          <div class="preset-card-actions">
            <button
              v-if="profile.builtin"
              type="button"
              @click="reset(profile.id)"
            >
              {{ t("reset") }}
            </button>
            <button
              v-else
              type="button"
              class="delete-button"
              :disabled="draft.length <= 1"
              @click="remove(index)"
            >
              {{ common("delete") }}
            </button>
          </div>
        </div>
        <div
          v-if="expandedId === profile.id"
          :id="`${editorId}-${profile.id}`"
          class="profile-editor"
        >
          <label class="profile-field">
            <span>{{ t("profileName") }}</span>
            <input v-model="profile.name" :aria-label="t('profileName')" />
          </label>
          <label class="profile-field">
            <span>{{ t("profileDescription") }}</span>
            <input
              v-model="profile.description"
              :aria-label="t('profileDescription')"
            />
          </label>
          <label class="profile-field">
            <span>{{ t("prompt") }}</span>
            <textarea
              v-model="profile.systemPrompt"
              rows="6"
              :aria-label="t('prompt')"
            />
          </label>
          <div class="profile-field">
            <div class="profile-categories-head">
              <span>{{ t("worldCategories") }}</span>
              <button
                type="button"
                :disabled="profile.worldCategories.length >= MAX_CATEGORIES"
                @click="addCategory(profile)"
              >
                {{ t("add") }}
              </button>
            </div>
            <div
              v-for="(category, position) in profile.worldCategories"
              :key="position"
              class="decomposition-category"
            >
              <input
                v-model="category.id"
                :aria-label="t('categoryId')"
                :placeholder="t('categoryId')"
              />
              <input
                v-model="category.title"
                :aria-label="t('categoryTitle')"
                :placeholder="t('categoryTitle')"
              />
              <input
                v-model="category.hint"
                :aria-label="t('categoryHint')"
                :placeholder="t('categoryHint')"
              />
              <button
                type="button"
                :aria-label="common('delete')"
                :disabled="profile.worldCategories.length <= 1"
                @click="profile.worldCategories.splice(position, 1)"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      </article>
    </div>
    <template #footer="{ requestClose }">
      <button type="button" @click="requestClose">{{ t("cancel") }}</button>
      <button
        type="button"
        class="analysis-primary-button"
        :disabled="saving || resetting"
        @click="save"
      >
        {{ saving ? common("saving") : t("save") }}
      </button>
    </template>
  </PresetManagerShell>
</template>

<style scoped src="../long-book-analysis/preset-manager.css"></style>
<style scoped>
.profile-heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
}
.profile-editor {
  display: grid;
  gap: 14px;
  padding-top: 16px;
  border-top: 1px solid var(--theme-line-soft);
}
.profile-field {
  display: grid;
  min-width: 0;
  gap: 6px;
}
.profile-field > span,
.profile-categories-head > span {
  color: var(--text-secondary);
  font-size: 0.85rem;
}
.profile-editor input,
.profile-editor textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--surface-muted);
  color: var(--text-primary);
  font: inherit;
}
.profile-editor textarea {
  min-height: 160px;
  resize: vertical;
  line-height: 1.6;
}
.profile-editor input:focus-visible,
.profile-editor textarea:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.profile-categories-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.profile-editor button {
  border: 0;
  border-radius: 8px;
  padding: 6px 10px;
  background: var(--surface-muted);
  color: var(--text-primary);
  cursor: pointer;
}
.profile-editor button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.decomposition-category {
  display: grid;
  grid-template-columns:
    minmax(90px, 1fr) minmax(90px, 1fr) minmax(140px, 2fr)
    auto;
  gap: 8px;
}
@media (max-width: 720px) {
  .decomposition-category {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
