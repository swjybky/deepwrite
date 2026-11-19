<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import type { LongWorkspaceImpactConfirmation } from "@deepwrite/contracts";
import BookManagementChildDialog from "./book-management/BookManagementChildDialog.vue";
import LongImpactConfirmationDetails from "./LongImpactConfirmationDetails.vue";
import PopupSelect, {
  type PopupSelectOption,
  type PopupSelectValue
} from "./PopupSelect.vue";

const t = createScopedTranslator("components.longStructureDeleteDialog");

interface DeleteTarget {
  kind: "worldbuilding" | "characterType";
  title: string;
  previewPending: boolean;
  expectedImpact?: LongWorkspaceImpactConfirmation;
}

withDefaults(
  defineProps<{
    open: boolean;
    target: DeleteTarget | null;
    locked?: boolean;
    pending?: boolean;
    worldbuildingFallback?: string;
    characterCount?: number;
    lastCharacterType?: boolean;
    characterDeleteMode?: "move" | "cascade";
    moveTargetId?: string;
    moveOptions?: readonly PopupSelectOption[];
  }>(),
  {
    locked: false,
    pending: false,
    worldbuildingFallback: "",
    characterCount: 0,
    lastCharacterType: false,
    characterDeleteMode: "move",
    moveTargetId: "",
    moveOptions: () => []
  }
);

const emit = defineEmits<{
  close: [];
  confirm: [];
  "update:characterDeleteMode": [mode: "move" | "cascade"];
  "update:moveTargetId": [value: PopupSelectValue];
}>();
</script>

<template>
  <BookManagementChildDialog
    v-if="open && target"
    :title="t('deleteMessage', { arg0: target.title })"
    :pending="locked"
    confirm
    @close="emit('close')"
    @submit="emit('confirm')"
  >
    <fieldset class="book-management-child-fields" :disabled="locked">
      <template v-if="target.kind === 'worldbuilding'">
        <p
          v-if="target.previewPending || !target.expectedImpact"
          class="dialog-description"
        >
          {{ worldbuildingFallback }}
        </p>
        <LongImpactConfirmationDetails
          v-else
          :confirmation="target.expectedImpact"
          :fallback="t('thisCategoryHasNoChildEntriesConfirmationWillDelete')"
        />
      </template>
      <template v-else>
        <div
          v-if="characterCount > 0 && !lastCharacterType"
          class="book-management-delete-options"
        >
          <label>
            <input
              :checked="characterDeleteMode === 'move'"
              type="radio"
              name="character-type-delete-mode"
              @change="emit('update:characterDeleteMode', 'move')"
            />
            <span>
              <strong>{{
                t("moveCharactersBeforeDeletingTypeRecommended")
              }}</strong>
              <small>{{
                t("charactersProfilesAndContinuityRecordsArePreserved")
              }}</small>
            </span>
          </label>
          <label>
            <input
              :checked="characterDeleteMode === 'cascade'"
              type="radio"
              name="character-type-delete-mode"
              @change="emit('update:characterDeleteMode', 'cascade')"
            />
            <span>
              <strong>{{ t("deleteTypeAndItsCharacters") }}</strong>
              <small>{{
                t("characterFilesWillBeDeletedAndContinuityLinksCleaned")
              }}</small>
            </span>
          </label>
        </div>
        <label
          v-if="
            characterCount > 0 &&
            !lastCharacterType &&
            characterDeleteMode === 'move'
          "
          class="book-management-field"
        >
          <span>{{ t("moveTo") }}</span>
          <PopupSelect
            :model-value="moveTargetId"
            :options="moveOptions"
            :accessible-label="t('selectDestinationCharacterType')"
            :menu-z-index="2300"
            @update:model-value="emit('update:moveTargetId', $event)"
          />
        </label>
        <p
          v-if="target.previewPending || !target.expectedImpact"
          class="dialog-description"
        >
          {{
            target.previewPending &&
            (characterDeleteMode === "cascade" || moveTargetId)
              ? t("checkingCharacterMoveAndDeletionImpact")
              : characterDeleteMode === "move" && characterCount > 0
                ? t("selectADestinationToSeeTheExactImpact")
                : t("checkingTheExactImpactOfDeletingThisTypeAnd")
          }}
        </p>
        <LongImpactConfirmationDetails
          v-else
          :confirmation="target.expectedImpact"
          :fallback="
            characterDeleteMode === 'move'
              ? t('charactersMoveToTheSelectedTypeTheirDocumentsRemain')
              : t('confirmationDeletesThisType')
          "
        />
      </template>
    </fieldset>
    <template #actions>
      <button
        class="dialog-secondary-button"
        type="button"
        :disabled="locked"
        autofocus
        @click="emit('close')"
      >
        {{ t("cancel") }}
      </button>
      <button
        class="dialog-primary-button is-danger"
        type="submit"
        :disabled="
          locked ||
          target.previewPending ||
          !target.expectedImpact ||
          (target.kind === 'characterType' &&
            characterCount > 0 &&
            !lastCharacterType &&
            characterDeleteMode === 'move' &&
            !moveTargetId)
        "
      >
        {{
          target.kind === "characterType"
            ? pending
              ? t("deleting")
              : characterCount > 0 &&
                  !lastCharacterType &&
                  characterDeleteMode === "move"
                ? t("moveCharactersAndDelete")
                : characterCount > 0
                  ? t("deleteTypeAndCharacters")
                  : t("deleteLabel")
            : pending
              ? t("deleting")
              : t("deleteCategoryAndItsContent")
        }}
      </button>
    </template>
  </BookManagementChildDialog>
</template>

<style scoped>
.book-management-delete-options {
  display: grid;
  gap: 0.5rem;
}
.book-management-delete-options label {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 0.55rem;
  padding: 0.65rem;
  border: 1px solid var(--theme-line);
  border-radius: 0.65rem;
  background: var(--surface-raised);
  cursor: pointer;
}
.book-management-delete-options input {
  margin-top: 0.2rem;
  accent-color: var(--accent);
}
.book-management-delete-options span {
  display: grid;
  gap: 0.2rem;
}
.book-management-delete-options small {
  color: var(--text-tertiary);
  font-weight: 400;
  line-height: 1.45;
}
</style>
