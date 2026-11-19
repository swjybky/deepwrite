<script setup lang="ts">
import type {
  MysteryBookManifest,
  MysteryOperation
} from "@deepwrite/contracts";
import { computed, nextTick, ref, watch } from "vue";
import BookResourceDialog from "../../components/BookResourceDialog.vue";
import PopupSelect from "../../components/PopupSelect.vue";
import { createScopedTranslator } from "../../i18n";
import type { ResourceTreeNode } from "../../types/workspace";
import { mysteryT } from "./messages";

type StructureItem = NonNullable<ResourceTreeNode["mysteryItem"]>;

export type MysteryStructureItemDialog =
  | { kind: "createStructure"; targetKind: StructureItem["kind"] }
  | {
      kind: "renameStructure" | "deleteStructure";
      targetKind: StructureItem["kind"];
      id: string;
      title: string;
      tag?: string | undefined;
    };

export type MysteryDialogState =
  | { kind: "manage-structure" }
  | { kind: "rename" | "unregister" | "delete" }
  | { kind: "bind" }
  | { kind: "export" | "discardBoard" }
  | MysteryStructureItemDialog;

const props = defineProps<{
  dialog: Exclude<
    MysteryDialogState,
    { kind: "manage-structure" | "bind" }
  > | null;
  manifest: MysteryBookManifest;
  busy: boolean;
  nested: boolean;
}>();

const emit = defineEmits<{
  close: [];
  discardBoard: [];
  applyOperation: [op: MysteryOperation];
  exportBundle: [
    payload: {
      format: "md" | "docx";
      playerScriptLayout: "by-role" | "by-role-act";
    }
  ];
  renameBook: [title: string];
  unregisterBook: [];
  deleteBook: [];
}>();

const treeT = createScopedTranslator("components.treeNodeItem");
const discardT = createScopedTranslator("components.agentTeamCatalogDialogs");
const titleInput = ref("");
const tagInput = ref("");
const exportFormat = ref<"md" | "docx">("docx");
const exportLayout = ref<"by-role" | "by-role-act">("by-role");
const dialogElement = ref<HTMLElement>();
const firstInput = ref<HTMLInputElement>();
let previousFocus: HTMLElement | null = null;

const bookDialogMode = computed(() => {
  const kind = props.dialog?.kind;
  if (kind === "unregister") return "remove";
  return kind === "rename" || kind === "delete" ? kind : null;
});
const book = computed<ResourceTreeNode>(() => ({
  id: props.manifest.id,
  label: props.manifest.title,
  workspaceType: "mystery"
}));
const isStructureForm = computed(
  () =>
    props.dialog?.kind === "createStructure" ||
    props.dialog?.kind === "renameStructure"
);
const title = computed(() => {
  const dialog = props.dialog;
  if (!dialog) return "";
  switch (dialog.kind) {
    case "export":
      return mysteryT("exportDialogTitle");
    case "renameStructure":
      return treeT("rename");
    case "deleteStructure":
      return mysteryT("deleteItemConfirmTitle", { name: dialog.title });
    case "discardBoard":
      return discardT("discardUnsavedChanges");
    case "createStructure":
      return mysteryT(
        (
          {
            truth_doc: "createItemTitleTruth",
            role: "createItemTitleRole",
            act: "createItemTitleAct",
            clue_round: "createItemTitleClue"
          } as const
        )[dialog.targetKind]
      );
    default:
      return "";
  }
});
const formats = computed(() => [
  { value: "docx" as const, label: mysteryT("exportFormatDocx") },
  { value: "md" as const, label: mysteryT("exportFormatMd") }
]);
const layouts = computed(() => [
  { value: "by-role" as const, label: mysteryT("exportLayoutByRole") },
  { value: "by-role-act" as const, label: mysteryT("exportLayoutByRoleAct") }
]);
const deleteWarning = computed(() => {
  if (props.dialog?.kind !== "deleteStructure") return "";
  return mysteryT(
    props.dialog.targetKind === "role"
      ? "deleteRoleWarning"
      : props.dialog.targetKind === "act"
        ? "deleteActWarning"
        : "deleteDocumentWarning"
  );
});

watch(
  () => props.dialog,
  async (dialog, previous) => {
    if (dialog && !previous)
      previousFocus = document.activeElement as HTMLElement | null;
    if (!dialog) {
      await nextTick();
      previousFocus?.focus({ preventScroll: true });
      previousFocus = null;
      return;
    }
    titleInput.value = dialog.kind === "renameStructure" ? dialog.title : "";
    tagInput.value =
      dialog.kind === "renameStructure" ? (dialog.tag ?? "") : "";
    await nextTick();
    (firstInput.value ?? dialogElement.value)?.focus({ preventScroll: true });
    firstInput.value?.select();
  }
);

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function submit(): void {
  const dialog = props.dialog;
  if (!dialog || props.busy) return;
  const label = titleInput.value.trim();
  const tag = tagInput.value.trim();
  switch (dialog.kind) {
    case "export":
      emit("exportBundle", {
        format: exportFormat.value,
        playerScriptLayout: exportLayout.value
      });
      break;
    case "createStructure":
      if (!label) return;
      switch (dialog.targetKind) {
        case "truth_doc":
          emit("applyOperation", {
            type: "truthDoc.create",
            doc: { id: generateId("truth"), title: label }
          });
          break;
        case "role":
          emit("applyOperation", {
            type: "role.create",
            role: { id: generateId("role"), name: label, tag }
          });
          break;
        case "act":
          emit("applyOperation", {
            type: "act.create",
            act: { id: generateId("act"), title: label }
          });
          break;
        case "clue_round":
          emit("applyOperation", {
            type: "clueRound.create",
            round: { id: generateId("round"), title: label }
          });
          break;
      }
      break;
    case "renameStructure":
      if (!label) return;
      switch (dialog.targetKind) {
        case "truth_doc":
          emit("applyOperation", {
            type: "truthDoc.updateMeta",
            docId: dialog.id,
            title: label
          });
          break;
        case "role":
          emit("applyOperation", {
            type: "role.updateMeta",
            roleId: dialog.id,
            name: label,
            tag
          });
          break;
        case "act":
          emit("applyOperation", {
            type: "act.updateMeta",
            actId: dialog.id,
            title: label
          });
          break;
        case "clue_round":
          emit("applyOperation", {
            type: "clueRound.updateMeta",
            roundId: dialog.id,
            title: label
          });
          break;
      }
      break;
    case "deleteStructure":
      switch (dialog.targetKind) {
        case "truth_doc":
          emit("applyOperation", { type: "truthDoc.delete", docId: dialog.id });
          break;
        case "role":
          emit("applyOperation", { type: "role.delete", roleId: dialog.id });
          break;
        case "act":
          emit("applyOperation", { type: "act.delete", actId: dialog.id });
          break;
        case "clue_round":
          emit("applyOperation", {
            type: "clueRound.delete",
            roundId: dialog.id
          });
          break;
      }
      break;
    case "discardBoard":
      emit("discardBoard");
      break;
  }
}

function close(): void {
  if (!props.busy) emit("close");
}
</script>

<template>
  <BookResourceDialog
    v-if="bookDialogMode"
    :mode="bookDialogMode"
    :book="book"
    :submitting="busy"
    :backdrop-class="nested ? 'book-management-child' : undefined"
    @close="close"
    @rename="emit('renameBook', $event.label)"
    @remove="emit('unregisterBook')"
    @delete="emit('deleteBook')"
  />

  <Teleport to="body">
    <div
      v-if="dialog && !bookDialogMode"
      class="dialog-backdrop"
      :class="{ 'book-management-child': nested }"
      @mousedown.self="close"
    >
      <section
        ref="dialogElement"
        class="workspace-dialog"
        :role="dialog.kind === 'deleteStructure' ? 'alertdialog' : 'dialog'"
        aria-modal="true"
        aria-labelledby="mystery-dialog-title"
        tabindex="-1"
        @keydown.esc.stop="close"
      >
        <header>
          <div>
            <span v-if="!nested" class="dialog-eyebrow">{{
              manifest.title
            }}</span>
            <h2 id="mystery-dialog-title">{{ title }}</h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="mysteryT('close')"
            :disabled="busy"
            @click="close"
          >
            ×
          </button>
        </header>

        <form class="dialog-content mystery-fields" @submit.prevent="submit">
          <template v-if="dialog.kind === 'export'">
            <p class="dialog-description">{{ mysteryT("exportSubtitle") }}</p>
            <div class="mystery-field-row">
              <span class="mystery-field-label">{{
                mysteryT("exportFormatLabel")
              }}</span>
              <PopupSelect
                :model-value="exportFormat"
                @update:model-value="
                  exportFormat = $event === 'md' ? 'md' : 'docx'
                "
                :options="formats"
                :accessible-label="mysteryT('exportFormatLabel')"
              />
            </div>
            <div class="mystery-field-row">
              <span class="mystery-field-label">{{
                mysteryT("exportLayoutLabel")
              }}</span>
              <PopupSelect
                :model-value="exportLayout"
                @update:model-value="
                  exportLayout =
                    $event === 'by-role-act' ? 'by-role-act' : 'by-role'
                "
                :options="layouts"
                :accessible-label="mysteryT('exportLayoutLabel')"
              />
            </div>
          </template>

          <template v-else-if="isStructureForm && 'targetKind' in dialog">
            <label class="mystery-field-row">
              <span class="mystery-field-label">{{
                mysteryT("itemTitleLabel")
              }}</span>
              <input
                ref="firstInput"
                v-model="titleInput"
                type="text"
                maxlength="256"
                class="mystery-input"
                required
              />
            </label>
            <label
              v-if="dialog.targetKind === 'role'"
              class="mystery-field-row"
            >
              <span class="mystery-field-label">{{
                mysteryT("itemTagLabel")
              }}</span>
              <input
                v-model="tagInput"
                type="text"
                maxlength="80"
                class="mystery-input"
              />
            </label>
          </template>

          <p v-else-if="deleteWarning" class="dialog-description">
            {{ deleteWarning }}
          </p>

          <div class="dialog-actions">
            <button
              type="button"
              class="dialog-secondary-button"
              :disabled="busy"
              @click="close"
            >
              {{ mysteryT("cancel") }}
            </button>
            <button
              type="submit"
              class="dialog-primary-button"
              :class="{ 'is-danger': dialog.kind === 'deleteStructure' }"
              :disabled="busy || (isStructureForm && !titleInput.trim())"
            >
              {{
                dialog.kind === "export"
                  ? mysteryT("startExport")
                  : dialog.kind === "deleteStructure"
                    ? treeT("delete")
                    : dialog.kind === "discardBoard"
                      ? discardT("discardAndLeave")
                      : dialog.kind === "createStructure"
                        ? treeT("addEntry")
                        : mysteryT("save")
              }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>
