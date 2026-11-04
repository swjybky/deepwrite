<script setup lang="ts">
import {
  AGENT_TEAM_PROFILE_NAME_MAX_LENGTH,
  type AgentTeamProfile,
  type AgentTeamWorkspaceType
} from "@deepwrite/contracts/renderer";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch
} from "vue";
import { createScopedTranslator } from "../i18n";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";
import PopupSelect, { type PopupSelectOption } from "./PopupSelect.vue";

export type AgentTeamDialogMode = "create" | "rename" | "delete" | "leave";

const t = createScopedTranslator("components.agentTeamCatalogDialogs");

const props = defineProps<{
  mode: AgentTeamDialogMode | null;
  team: AgentTeamProfile | null;
  boundBookCount: number;
  saving: boolean;
}>();

const emit = defineEmits<{
  close: [];
  create: [input: { name: string; workspaceType: AgentTeamWorkspaceType }];
  rename: [name: string];
  confirmDelete: [];
  confirmLeave: [];
}>();

const titleId = useId();
const nameInput = ref<HTMLInputElement | null>(null);
const nameDraft = ref("");
const workspaceType = ref<AgentTeamWorkspaceType>("short");

const workspaceTypeOptions = computed<PopupSelectOption[]>(() => [
  { value: "short", label: t("shortStory") },
  { value: "script", label: t("screenplay") },
  { value: "long", label: t("novel") }
]);
const hasNameField = computed(
  () => props.mode === "create" || props.mode === "rename"
);
const title = computed(() => {
  if (props.mode === "create") return t("newAgentTeam");
  if (props.mode === "rename") return t("renameAgentTeam");
  if (props.mode === "delete") {
    return t("deleteMessageDetail", { arg0: props.team?.name ?? "" });
  }
  return t("discardUnsavedChanges");
});

watch(
  () => props.mode,
  (mode) => {
    if (!mode) return;
    nameDraft.value = mode === "rename" ? (props.team?.name ?? "") : "";
    workspaceType.value = "short";
    if (hasNameField.value) {
      void nextTick(() => {
        nameInput.value?.focus();
        nameInput.value?.select();
      });
    }
  }
);

function requestClose(): void {
  if (!props.saving) emit("close");
}

function submitName(): void {
  if (props.saving) return;
  const name = nameDraft.value.trim();
  if (!name) {
    uiMessage.warning(t("enterATeamName"));
    nameInput.value?.focus();
    return;
  }
  if (props.mode === "create") {
    emit("create", { name, workspaceType: workspaceType.value });
  } else {
    emit("rename", name);
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.mode && event.key === "Escape") requestClose();
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="mode" class="dialog-backdrop" @mousedown.self="requestClose">
      <section
        class="workspace-dialog book-resource-dialog"
        :role="mode === 'delete' ? 'alertdialog' : 'dialog'"
        aria-modal="true"
        :aria-labelledby="titleId"
      >
        <header>
          <div>
            <h2 :id="titleId">{{ title }}</h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            :disabled="saving"
            @click="requestClose"
          >
            ×
          </button>
        </header>

        <form class="dialog-content" @submit.prevent="submitName">
          <template v-if="hasNameField">
            <label class="book-resource-name-field">
              <span>{{ t("teamName") }}</span>
              <input
                ref="nameInput"
                v-model="nameDraft"
                type="text"
                autocomplete="off"
                :maxlength="AGENT_TEAM_PROFILE_NAME_MAX_LENGTH"
              />
            </label>
            <div
              v-if="mode === 'create'"
              class="book-resource-name-field type-field"
            >
              <span>{{ t("writingType") }}</span>
              <PopupSelect
                v-model="workspaceType"
                :options="workspaceTypeOptions"
                :accessible-label="t('teamWritingType')"
                :menu-z-index="230"
              />
            </div>
          </template>
          <div v-else-if="mode === 'delete'" class="book-remove-warning">
            <AppIcon name="trash" :size="18" />
            <div>
              <strong>{{ team?.name }}</strong>
              <p>{{ t("theSubagentSettingsInThisTeamWillBeDeleted") }}</p>
              <p v-if="boundBookCount > 0">
                {{ t("boundBooksWillLoseThisTeam", { arg0: boundBookCount }) }}
              </p>
            </div>
          </div>
          <p v-else class="book-resource-help leave-hint">
            {{ t("yourEditsToThisTeamHaveNotBeenSaved") }}
          </p>

          <div class="dialog-actions">
            <button
              class="dialog-secondary-button"
              type="button"
              :disabled="saving"
              @click="requestClose"
            >
              {{ mode === "leave" ? t("keepEditing") : t("cancel") }}
            </button>
            <button
              v-if="mode === 'delete'"
              class="dialog-primary-button is-danger"
              type="button"
              :disabled="saving"
              @click="emit('confirmDelete')"
            >
              {{ t("deleteMessage") }}
            </button>
            <button
              v-else-if="mode === 'leave'"
              class="dialog-primary-button"
              type="button"
              @click="emit('confirmLeave')"
            >
              {{ t("discardAndLeave") }}
            </button>
            <button
              v-else
              class="dialog-primary-button"
              type="submit"
              :disabled="saving"
            >
              {{ t("confirm") }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.type-field {
  margin-top: 14px;
}
.leave-hint {
  margin-top: 0;
  font-size: 0.857143rem;
}
</style>
