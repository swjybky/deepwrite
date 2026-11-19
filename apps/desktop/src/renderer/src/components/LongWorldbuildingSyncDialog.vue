<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed } from "vue";
import type { LongWorldbuildingSyncPreparedChange } from "../types/longWorkspace";
import type { LongWorldbuildingSyncBookOption } from "../utils/longWorldbuildingSync";
import BookManagementChildDialog from "./book-management/BookManagementChildDialog.vue";
import LongImpactConfirmationDetails from "./LongImpactConfirmationDetails.vue";
import PopupSelect, {
  type PopupSelectOption,
  type PopupSelectValue
} from "./PopupSelect.vue";

const t = createScopedTranslator("components.longWorldbuildingSyncDialog");

const props = withDefaults(
  defineProps<{
    open: boolean;
    currentBookId?: string | null;
    selectedBookId: string;
    bookOptions: readonly LongWorldbuildingSyncBookOption[];
    prepared: LongWorldbuildingSyncPreparedChange | null;
    locked?: boolean;
    pending?: boolean;
  }>(),
  {
    currentBookId: null,
    locked: false,
    pending: false
  }
);

const emit = defineEmits<{
  close: [];
  confirm: [];
  "update:selectedBookId": [bookId: string];
}>();

const selectOptions = computed<PopupSelectOption[]>(() =>
  props.bookOptions
    .filter(({ id }) => id !== props.currentBookId)
    .map((book) => ({
      value: book.id,
      label:
        book.categoryCount > 0
          ? t("valueValueCategories", {
              arg0: book.title,
              arg1: book.categoryCount
            })
          : book.title
    }))
);
const selectedBook = computed(
  () => props.bookOptions.find(({ id }) => id === props.selectedBookId) ?? null
);

function selectBook(value: PopupSelectValue): void {
  emit("update:selectedBookId", typeof value === "string" ? value : "");
}
</script>

<template>
  <BookManagementChildDialog
    v-if="open"
    :title="t('loadWorldbuildingFromAnotherBook')"
    :pending="locked"
    confirm
    @close="emit('close')"
    @submit="emit('confirm')"
  >
    <fieldset class="book-management-child-fields" :disabled="locked">
      <p class="dialog-description">
        {{ t("syncReplacesAllEditableWorldbuildingInThisBookWith") }}
      </p>
      <label class="book-management-field">
        <span>{{ t("selectSourceNovel") }}</span>
        <PopupSelect
          :model-value="selectedBookId"
          :options="selectOptions"
          :accessible-label="t('selectANovelToSyncWorldbuildingFrom')"
          :menu-z-index="2300"
          @update:model-value="selectBook"
        />
      </label>
      <p v-if="selectedBook" class="dialog-note">
        {{
          t("readAllContentFromTheWorldbuildingCategoriesMessage", {
            arg0: selectedBook.title ?? "",
            arg1: selectedBook.categoryCount ?? ""
          })
        }}
      </p>
      <template v-if="prepared">
        <p class="dialog-note">
          {{
            t("categoriesToAddCategoriesToDeleteContentMessage", {
              arg0: prepared.createdCategoryCount ?? "",
              arg1: prepared.deletedCategoryCount ?? "",
              arg2: prepared.writtenFileCount ?? ""
            })
          }}
        </p>
        <LongImpactConfirmationDetails
          :confirmation="prepared.confirmation"
          :fallback="t('syncWillNotChangeLinksInTheCurrentNovel')"
        />
      </template>
    </fieldset>
    <template #actions>
      <button
        class="dialog-secondary-button"
        type="button"
        :disabled="locked"
        @click="emit('close')"
      >
        {{ t("cancel") }}
      </button>
      <button
        class="dialog-primary-button"
        :class="{ 'is-danger': Boolean(prepared) }"
        type="submit"
        :disabled="locked || !selectedBookId"
      >
        {{
          pending
            ? prepared
              ? t("syncing")
              : t("checking")
            : prepared
              ? t("overwriteWithTheImpactShown")
              : t("reviewSyncImpact")
        }}
      </button>
    </template>
  </BookManagementChildDialog>
</template>
