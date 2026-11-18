<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, watch } from "vue";
import {
  ACADEMIC_CITE_KEY_MAX_LENGTH,
  ACADEMIC_REFERENCE_CARD_TYPES,
  AcademicCiteKeySchema,
  type AcademicReferenceCardType
} from "@deepwrite/contracts/renderer";
import AppIcon from "../AppIcon.vue";
import PopupSelect, { type PopupSelectValue } from "../PopupSelect.vue";
import { academicT } from "./academicLabels";
import { academicCardTypeBadge } from "./academicTreeLabels";
import {
  executeCreateAcademicCard,
  executeDeleteAcademicCard,
  executeUpdateAcademicCard
} from "../../composables/useAcademicBookLifecycleCoordinator";
import { academicMutationPending } from "../../stores/academicWorkspaceDialog";
import { uiMessage } from "../../ui-feedback";

const props = defineProps<{
  mode: "create" | "edit" | "delete";
  bookId: string;
  cardId?: string | undefined;
  citeKey?: string | undefined;
  cardType?: AcademicReferenceCardType | undefined;
  title?: string | undefined;
}>();

const emit = defineEmits<{
  close: [];
}>();

const form = reactive({
  citeKey: props.citeKey ?? "",
  cardType: (props.cardType ?? "literature") as AcademicReferenceCardType,
  title: props.title ?? "",
  content: ""
});

watch(
  () => [props.mode, props.cardId, props.citeKey, props.cardType, props.title],
  () => {
    form.citeKey = props.citeKey ?? "";
    form.cardType = props.cardType ?? "literature";
    form.title = props.title ?? "";
    form.content = "";
  }
);

const locked = computed(() => academicMutationPending.value);

const cardTypeOptions = computed(() =>
  ACADEMIC_REFERENCE_CARD_TYPES.map((type) => ({
    value: type,
    label: academicCardTypeBadge(type)
  }))
);

function selectCardType(value: PopupSelectValue): void {
  if ((value === "literature" || value === "evidence") && !locked.value) {
    form.cardType = value;
  }
}

function requestClose(): void {
  if (locked.value) return;
  emit("close");
}

async function submit(): Promise<void> {
  if (locked.value) return;
  if (props.mode === "delete") {
    if (!props.cardId) return;
    const ok = await executeDeleteAcademicCard(props.bookId, props.cardId);
    if (ok) emit("close");
    return;
  }

  const parsedKey = AcademicCiteKeySchema.safeParse(form.citeKey);
  if (!parsedKey.success) {
    uiMessage.warning(academicT("invalidCiteKeyError"));
    return;
  }
  const trimmedTitle = form.title.trim();
  if (!trimmedTitle) {
    uiMessage.warning(academicT("enterCardTitleError"));
    return;
  }

  const ok =
    props.mode === "create"
      ? await executeCreateAcademicCard({
          bookId: props.bookId,
          citeKey: parsedKey.data,
          cardType: form.cardType,
          title: trimmedTitle,
          ...(form.content.trim() ? { content: form.content } : {})
        })
      : props.cardId
        ? await executeUpdateAcademicCard({
            bookId: props.bookId,
            cardId: props.cardId,
            citeKey: parsedKey.data,
            cardType: form.cardType,
            title: trimmedTitle
          })
        : false;
  if (ok) {
    emit("close");
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    requestClose();
  }
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <div
    class="dialog-backdrop academic-dialog-backdrop"
    @mousedown.self="requestClose"
  >
    <section
      class="academic-card-dialog"
      :role="mode === 'delete' ? 'alertdialog' : 'dialog'"
      aria-modal="true"
      aria-labelledby="academic-card-dialog-title"
    >
      <header class="academic-card-dialog-header">
        <div>
          <span class="academic-dialog-eyebrow">
            {{ academicT("cardDialogEyebrow") }}
          </span>
          <h2 id="academic-card-dialog-title">
            {{
              mode === "create"
                ? academicT("newCardTitle")
                : mode === "edit"
                  ? academicT("editCardTitle")
                  : academicT("deleteCardTitle")
            }}
          </h2>
        </div>
        <button
          type="button"
          class="academic-dialog-close"
          :aria-label="academicT('close')"
          :disabled="locked"
          @click="requestClose"
        >
          <AppIcon name="close" :size="16" />
        </button>
      </header>

      <form class="academic-card-dialog-body" @submit.prevent="submit">
        <template v-if="mode === 'delete'">
          <p class="academic-delete-copy">
            {{
              academicT("deleteCardConfirm", {
                title: title ?? "",
                citeKey: citeKey ?? ""
              })
            }}
          </p>
        </template>
        <template v-else>
          <label class="academic-field">
            <span>{{ academicT("cardTypeLabel") }}</span>
            <PopupSelect
              :model-value="form.cardType"
              :options="cardTypeOptions"
              :accessible-label="academicT('cardTypeLabel')"
              :disabled="locked"
              :menu-z-index="2300"
              @update:model-value="selectCardType"
            />
          </label>

          <label class="academic-field">
            <span>{{ academicT("citeKeyLabel") }}</span>
            <input
              v-model="form.citeKey"
              :maxlength="ACADEMIC_CITE_KEY_MAX_LENGTH"
              :placeholder="academicT('citeKeyPlaceholder')"
              autocomplete="off"
              spellcheck="false"
              required
            />
            <small>{{ academicT("citeKeyRuleHint") }}</small>
          </label>

          <label class="academic-field">
            <span>{{ academicT("cardTitleLabel") }}</span>
            <input
              v-model="form.title"
              maxlength="120"
              :placeholder="academicT('cardTitlePlaceholder')"
              autocomplete="off"
              required
            />
          </label>

          <label v-if="mode === 'create'" class="academic-field">
            <span>{{ academicT("cardInitialBodyLabel") }}</span>
            <textarea
              v-model="form.content"
              rows="5"
              :placeholder="academicT('cardInitialBodyPlaceholder')"
            />
          </label>
        </template>

        <footer class="academic-card-dialog-actions">
          <button
            type="button"
            class="academic-secondary-btn"
            :disabled="locked"
            @click="requestClose"
          >
            {{ academicT("cancel") }}
          </button>
          <button
            type="submit"
            :class="
              mode === 'delete' ? 'academic-danger-btn' : 'academic-primary-btn'
            "
            :disabled="locked"
          >
            {{
              locked
                ? academicT("saving")
                : mode === "delete"
                  ? academicT("delete")
                  : mode === "create"
                    ? academicT("create")
                    : academicT("save")
            }}
          </button>
        </footer>
      </form>
    </section>
  </div>
</template>

<style scoped>
.academic-dialog-backdrop {
  z-index: 2100;
}

.academic-card-dialog {
  width: min(520px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg, 14px);
  background: var(--surface-main);
  border: 1px solid var(--theme-line);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.academic-card-dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--theme-line-soft);
}

.academic-dialog-eyebrow {
  display: block;
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}

.academic-card-dialog-header h2 {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 600;
  color: var(--text-primary);
}

.academic-dialog-close {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.academic-dialog-close:hover:not(:disabled) {
  background: var(--surface-muted);
  color: var(--text-primary);
}

.academic-card-dialog-body {
  padding: 18px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.academic-delete-copy {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--text-primary);
}

.academic-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.academic-field > span {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
}

.academic-field input,
.academic-field textarea {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--theme-line);
  background: var(--surface-raised);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-family: inherit;
}

.academic-field small {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.academic-card-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}

.academic-secondary-btn,
.academic-primary-btn,
.academic-danger-btn {
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 0.8125rem;
  cursor: pointer;
}

.academic-secondary-btn {
  border: 1px solid var(--theme-line);
  background: var(--surface-raised);
  color: var(--text-primary);
}

.academic-primary-btn {
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--accent-contrast, #ffffff);
  font-weight: 500;
}

.academic-danger-btn {
  border: 1px solid var(--danger, #c93b3b);
  background: var(--danger, #c93b3b);
  color: #ffffff;
  font-weight: 500;
}

.academic-secondary-btn:disabled,
.academic-primary-btn:disabled,
.academic-danger-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
