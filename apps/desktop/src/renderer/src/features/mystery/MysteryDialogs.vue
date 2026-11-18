<script setup lang="ts">
import type {
  CatalogIndexSnapshot,
  CatalogSnapshot,
  MysteryBookManifest,
  MysteryNarrativePerson,
  MysteryOperation
} from "@deepwrite/contracts";
import { ref, watch } from "vue";
import { mysteryT } from "./messages";

export type MysteryDialogState =
  | { kind: "boardSpec" }
  | { kind: "bindings" }
  | { kind: "export" }
  | { kind: "manageBook" }
  | {
      kind: "createStructure";
      targetKind: "truth_doc" | "role" | "act" | "clue_round";
    }
  | {
      kind: "renameStructure";
      targetKind: "truth_doc" | "role" | "act" | "clue_round";
      id: string;
      title: string;
      tag?: string | undefined;
    }
  | {
      kind: "deleteStructure";
      targetKind: "truth_doc" | "role" | "act" | "clue_round";
      id: string;
      title: string;
    };

const props = defineProps<{
  dialog: MysteryDialogState | null;
  manifest: MysteryBookManifest;
  catalogSnapshot: CatalogIndexSnapshot | CatalogSnapshot | null;
  busy: boolean;
}>();

const emit = defineEmits<{
  close: [];
  applyOperation: [op: MysteryOperation];
  saveBindings: [
    payload: { linkedMaterialIds: string[]; linkedSkillIds: string[] }
  ];
  exportBundle: [
    payload: {
      format: "md" | "docx";
      playerScriptLayout: "by-role" | "by-role-act";
    }
  ];
  renameBook: [title: string];
  duplicateBook: [];
  unregisterBook: [];
  deleteBook: [];
}>();

// Form state
const titleInput = ref("");
const tagInput = ref("");
const playerCount = ref(6);
const actCountTarget = ref(4);
const narrativePerson = ref<MysteryNarrativePerson>("second");
const boardSummary = ref("");
const selectedMaterialIds = ref<string[]>([]);
const selectedSkillIds = ref<string[]>([]);
const exportFormat = ref<"md" | "docx">("docx");
const exportLayout = ref<"by-role" | "by-role-act">("by-role");

watch(
  () => props.dialog,
  (dlg) => {
    if (!dlg) return;
    if (dlg.kind === "boardSpec") {
      playerCount.value = props.manifest.boardSpec.playerCount;
      actCountTarget.value = props.manifest.boardSpec.actCountTarget;
      narrativePerson.value = props.manifest.boardSpec.narrativePerson;
      boardSummary.value = props.manifest.boardSpec.summary ?? "";
    } else if (dlg.kind === "bindings") {
      selectedMaterialIds.value = [...props.manifest.linkedMaterialIds];
      selectedSkillIds.value = [...props.manifest.linkedSkillIds];
    } else if (dlg.kind === "manageBook") {
      titleInput.value = props.manifest.title;
    } else if (dlg.kind === "createStructure") {
      titleInput.value = "";
      tagInput.value = "";
    } else if (dlg.kind === "renameStructure") {
      titleInput.value = dlg.title;
      tagInput.value = dlg.tag ?? "";
    }
  },
  { immediate: true }
);

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function submitStructureCreate(): void {
  if (props.dialog?.kind !== "createStructure") return;
  const label = titleInput.value.trim();
  if (!label) return;
  const k = props.dialog.targetKind;
  if (k === "truth_doc") {
    emit("applyOperation", {
      type: "truthDoc.create",
      doc: { id: generateId("truth"), title: label }
    });
  } else if (k === "role") {
    emit("applyOperation", {
      type: "role.create",
      role: { id: generateId("role"), name: label, tag: tagInput.value.trim() }
    });
  } else if (k === "act") {
    emit("applyOperation", {
      type: "act.create",
      act: { id: generateId("act"), title: label }
    });
  } else {
    emit("applyOperation", {
      type: "clueRound.create",
      round: { id: generateId("round"), title: label }
    });
  }
}

function submitStructureRename(): void {
  if (props.dialog?.kind !== "renameStructure") return;
  const label = titleInput.value.trim();
  if (!label) return;
  const { targetKind: k, id } = props.dialog;
  if (k === "truth_doc") {
    emit("applyOperation", {
      type: "truthDoc.updateMeta",
      docId: id,
      title: label
    });
  } else if (k === "role") {
    emit("applyOperation", {
      type: "role.updateMeta",
      roleId: id,
      name: label,
      tag: tagInput.value.trim()
    });
  } else if (k === "act") {
    emit("applyOperation", { type: "act.updateMeta", actId: id, title: label });
  } else {
    emit("applyOperation", {
      type: "clueRound.updateMeta",
      roundId: id,
      title: label
    });
  }
}

function confirmStructureDelete(): void {
  if (props.dialog?.kind !== "deleteStructure") return;
  const { targetKind: k, id } = props.dialog;
  if (k === "truth_doc")
    emit("applyOperation", { type: "truthDoc.delete", docId: id });
  else if (k === "role")
    emit("applyOperation", { type: "role.delete", roleId: id });
  else if (k === "act")
    emit("applyOperation", { type: "act.delete", actId: id });
  else emit("applyOperation", { type: "clueRound.delete", roundId: id });
}

function toggleSelection(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="dialog"
      class="dialog-backdrop"
      @mousedown.self="!busy && emit('close')"
    >
      <section
        class="workspace-dialog"
        :role="dialog.kind === 'deleteStructure' ? 'alertdialog' : 'dialog'"
        aria-modal="true"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{ manifest.title }}</span>
            <h2>
              <template v-if="dialog.kind === 'boardSpec'">{{
                mysteryT("boardSpecDialogTitle")
              }}</template>
              <template v-else-if="dialog.kind === 'bindings'">{{
                mysteryT("bindingsDialogTitle")
              }}</template>
              <template v-else-if="dialog.kind === 'export'">{{
                mysteryT("exportDialogTitle")
              }}</template>
              <template v-else-if="dialog.kind === 'manageBook'">{{
                mysteryT("manageBookTitle", { title: manifest.title })
              }}</template>
              <template v-else-if="dialog.kind === 'createStructure'">
                {{
                  dialog.targetKind === "truth_doc"
                    ? mysteryT("createItemTitleTruth")
                    : dialog.targetKind === "role"
                      ? mysteryT("createItemTitleRole")
                      : dialog.targetKind === "act"
                        ? mysteryT("createItemTitleAct")
                        : mysteryT("createItemTitleClue")
                }}
              </template>
              <template v-else-if="dialog.kind === 'renameStructure'">{{
                mysteryT("renameTitlePrompt")
              }}</template>
              <template v-else>{{
                mysteryT("deleteItemConfirmTitle", { name: dialog.title })
              }}</template>
            </h2>
          </div>
          <button
            type="button"
            class="dialog-close"
            :aria-label="mysteryT('close')"
            :disabled="busy"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <!-- Board Spec -->
        <form
          v-if="dialog.kind === 'boardSpec'"
          class="mystery-dialog-form"
          @submit.prevent="
            emit('applyOperation', {
              type: 'boardSpec.update',
              boardSpec: {
                playerCount,
                actCountTarget,
                narrativePerson,
                summary: boardSummary
              }
            })
          "
        >
          <div class="mystery-field-grid-2">
            <label class="mystery-field-row">
              <span>{{ mysteryT("playerCountLabel") }}</span>
              <input
                v-model.number="playerCount"
                type="number"
                min="1"
                max="32"
                class="mystery-input"
              />
            </label>
            <label class="mystery-field-row">
              <span>{{ mysteryT("actCountTargetLabel") }}</span>
              <input
                v-model.number="actCountTarget"
                type="number"
                min="1"
                max="24"
                class="mystery-input"
              />
            </label>
          </div>
          <div class="mystery-field-row">
            <span class="mystery-field-label">{{
              mysteryT("narrativePersonLabel")
            }}</span>
            <div class="mystery-segmented">
              <button
                type="button"
                :class="{ 'is-active': narrativePerson === 'second' }"
                @click="narrativePerson = 'second'"
              >
                {{ mysteryT("narrativePersonSecond") }}
              </button>
              <button
                type="button"
                :class="{ 'is-active': narrativePerson === 'first' }"
                @click="narrativePerson = 'first'"
              >
                {{ mysteryT("narrativePersonFirst") }}
              </button>
            </div>
          </div>
          <label class="mystery-field-row">
            <span>{{ mysteryT("boardSummaryLabel") }}</span>
            <textarea
              v-model="boardSummary"
              rows="3"
              class="mystery-textarea"
              maxlength="4000"
            />
          </label>
          <div class="mystery-proposal-actions">
            <button
              type="button"
              class="mystery-btn-secondary"
              @click="emit('close')"
            >
              {{ mysteryT("cancel") }}
            </button>
            <button type="submit" class="mystery-btn-primary" :disabled="busy">
              {{ mysteryT("saveBoardSpec") }}
            </button>
          </div>
        </form>

        <!-- Cross-type library bindings -->
        <form
          v-else-if="dialog.kind === 'bindings'"
          class="mystery-dialog-form"
          @submit.prevent="
            emit('saveBindings', {
              linkedMaterialIds: selectedMaterialIds,
              linkedSkillIds: selectedSkillIds
            })
          "
        >
          <p>{{ mysteryT("bindingsSubtitle") }}</p>
          <div class="mystery-field-row">
            <span class="mystery-field-label">{{
              mysteryT("linkedMaterialsHeading")
            }}</span>
            <div class="mystery-binding-list">
              <label
                v-for="mat in catalogSnapshot?.materials ?? []"
                :key="mat.id"
                class="mystery-binding-check"
              >
                <span class="mystery-binding-check-left">
                  <input
                    type="checkbox"
                    :checked="selectedMaterialIds.includes(mat.id)"
                    @change="
                      selectedMaterialIds = toggleSelection(
                        selectedMaterialIds,
                        mat.id
                      )
                    "
                  />
                  <span>{{ mat.title }}</span>
                </span>
                <span class="mystery-pill-badge">{{ mat.materialType }}</span>
              </label>
              <span v-if="!catalogSnapshot?.materials.length">{{
                mysteryT("noLibrariesAvailable")
              }}</span>
            </div>
          </div>
          <div class="mystery-field-row">
            <span class="mystery-field-label">{{
              mysteryT("linkedSkillsHeading")
            }}</span>
            <div class="mystery-binding-list">
              <label
                v-for="skill in catalogSnapshot?.skills ?? []"
                :key="skill.id"
                class="mystery-binding-check"
              >
                <span class="mystery-binding-check-left">
                  <input
                    type="checkbox"
                    :checked="selectedSkillIds.includes(skill.id)"
                    @change="
                      selectedSkillIds = toggleSelection(
                        selectedSkillIds,
                        skill.id
                      )
                    "
                  />
                  <span>{{ skill.title }}</span>
                </span>
                <span class="mystery-pill-badge">{{ skill.skillType }}</span>
              </label>
              <span v-if="!catalogSnapshot?.skills.length">{{
                mysteryT("noLibrariesAvailable")
              }}</span>
            </div>
          </div>
          <div class="mystery-proposal-actions">
            <button
              type="button"
              class="mystery-btn-secondary"
              @click="emit('close')"
            >
              {{ mysteryT("cancel") }}
            </button>
            <button type="submit" class="mystery-btn-primary" :disabled="busy">
              {{ mysteryT("saveBindings") }}
            </button>
          </div>
        </form>

        <!-- Spoiler-Free Bundle Export -->
        <form
          v-else-if="dialog.kind === 'export'"
          class="mystery-dialog-form"
          @submit.prevent="
            emit('exportBundle', {
              format: exportFormat,
              playerScriptLayout: exportLayout
            })
          "
        >
          <p>{{ mysteryT("exportSubtitle") }}</p>
          <div class="mystery-field-row">
            <span class="mystery-field-label">{{
              mysteryT("exportFormatLabel")
            }}</span>
            <div class="mystery-segmented">
              <button
                type="button"
                :class="{ 'is-active': exportFormat === 'docx' }"
                @click="exportFormat = 'docx'"
              >
                {{ mysteryT("exportFormatDocx") }}
              </button>
              <button
                type="button"
                :class="{ 'is-active': exportFormat === 'md' }"
                @click="exportFormat = 'md'"
              >
                {{ mysteryT("exportFormatMd") }}
              </button>
            </div>
          </div>
          <div class="mystery-field-row">
            <span class="mystery-field-label">{{
              mysteryT("exportLayoutLabel")
            }}</span>
            <div class="mystery-segmented">
              <button
                type="button"
                :class="{ 'is-active': exportLayout === 'by-role' }"
                @click="exportLayout = 'by-role'"
              >
                {{ mysteryT("exportLayoutByRole") }}
              </button>
              <button
                type="button"
                :class="{ 'is-active': exportLayout === 'by-role-act' }"
                @click="exportLayout = 'by-role-act'"
              >
                {{ mysteryT("exportLayoutByRoleAct") }}
              </button>
            </div>
          </div>
          <div class="mystery-proposal-actions">
            <button
              type="button"
              class="mystery-btn-secondary"
              @click="emit('close')"
            >
              {{ mysteryT("cancel") }}
            </button>
            <button type="submit" class="mystery-btn-primary" :disabled="busy">
              {{ mysteryT("startExport") }}
            </button>
          </div>
        </form>

        <!-- Manage Book -->
        <div
          v-else-if="dialog.kind === 'manageBook'"
          class="mystery-dialog-form"
        >
          <form
            class="mystery-field-row"
            @submit.prevent="
              titleInput.trim() && emit('renameBook', titleInput.trim())
            "
          >
            <label for="mystery-rename-input">{{
              mysteryT("manageRenameLabel")
            }}</label>
            <div class="mystery-field-grid-2">
              <input
                id="mystery-rename-input"
                v-model="titleInput"
                type="text"
                maxlength="120"
                class="mystery-input"
              />
              <button
                type="submit"
                class="mystery-btn-primary"
                :disabled="busy"
              >
                {{ mysteryT("manageRenameButton") }}
              </button>
            </div>
          </form>

          <div class="mystery-proposal-card">
            <strong class="mystery-proposal-title">{{
              mysteryT("manageDuplicateTitle")
            }}</strong>
            <span class="mystery-proposal-list">{{
              mysteryT("manageDuplicateDesc")
            }}</span>
            <div class="mystery-proposal-actions">
              <button
                type="button"
                class="mystery-btn-secondary"
                :disabled="busy"
                @click="emit('duplicateBook')"
              >
                {{ mysteryT("manageDuplicateButton") }}
              </button>
            </div>
          </div>

          <div class="mystery-proposal-card">
            <strong class="mystery-proposal-title">{{
              mysteryT("manageUnregisterTitle")
            }}</strong>
            <span class="mystery-proposal-list">{{
              mysteryT("manageUnregisterDesc")
            }}</span>
            <div class="mystery-proposal-actions">
              <button
                type="button"
                class="mystery-btn-secondary"
                :disabled="busy"
                @click="emit('unregisterBook')"
              >
                {{ mysteryT("manageUnregisterButton") }}
              </button>
            </div>
          </div>

          <div class="mystery-proposal-card">
            <strong class="mystery-proposal-title">{{
              mysteryT("manageDeleteTitle")
            }}</strong>
            <span class="mystery-proposal-list">{{
              mysteryT("manageDeleteDesc")
            }}</span>
            <div class="mystery-proposal-actions">
              <button
                type="button"
                class="mystery-btn-danger"
                :disabled="busy"
                @click="emit('deleteBook')"
              >
                {{ mysteryT("manageDeleteButton") }}
              </button>
            </div>
          </div>
        </div>

        <!-- Create / Rename Structure Item -->
        <form
          v-else-if="
            dialog.kind === 'createStructure' ||
            dialog.kind === 'renameStructure'
          "
          class="mystery-dialog-form"
          @submit.prevent="
            dialog.kind === 'createStructure'
              ? submitStructureCreate()
              : submitStructureRename()
          "
        >
          <label class="mystery-field-row">
            <span>{{ mysteryT("itemTitleLabel") }}</span>
            <input
              v-model="titleInput"
              type="text"
              maxlength="120"
              class="mystery-input"
              autofocus
            />
          </label>
          <label v-if="dialog.targetKind === 'role'" class="mystery-field-row">
            <span>{{ mysteryT("itemTagLabel") }}</span>
            <input
              v-model="tagInput"
              type="text"
              maxlength="80"
              class="mystery-input"
            />
          </label>
          <div class="mystery-proposal-actions">
            <button
              type="button"
              class="mystery-btn-secondary"
              @click="emit('close')"
            >
              {{ mysteryT("cancel") }}
            </button>
            <button
              type="submit"
              class="mystery-btn-primary"
              :disabled="busy || !titleInput.trim()"
            >
              {{ mysteryT("confirm") }}
            </button>
          </div>
        </form>

        <!-- Delete Structure Confirmation -->
        <div
          v-else-if="dialog.kind === 'deleteStructure'"
          class="mystery-dialog-form"
        >
          <p v-if="dialog.targetKind === 'role'">
            {{ mysteryT("deleteRoleWarning") }}
          </p>
          <p v-else-if="dialog.targetKind === 'act'">
            {{ mysteryT("deleteActWarning") }}
          </p>
          <div class="mystery-proposal-actions">
            <button
              type="button"
              class="mystery-btn-secondary"
              @click="emit('close')"
            >
              {{ mysteryT("cancel") }}
            </button>
            <button
              type="button"
              class="mystery-btn-danger"
              :disabled="busy"
              @click="confirmStructureDelete"
            >
              {{ mysteryT("delete") }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
