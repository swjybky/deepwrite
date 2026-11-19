<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import type {
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import type { LongStructureMutationCompletion } from "../types/longWorkspace";
import type {
  LongWorldbuildingSyncCompletion,
  LongWorldbuildingSyncRequest
} from "../types/longWorkspace";
import AppIcon from "./AppIcon.vue";
import BookManagementName from "./BookManagementName.vue";
import LongStructureManager from "./LongStructureManager.vue";

const t = createScopedTranslator("components.longStructureDialog");
const actionT = createScopedTranslator("components.longBookActionMenu");

const props = defineProps<{
  open: boolean;
  bookTitle: string;
  bookId?: string | null;
  agentsMd?: string | null;
  agentsMdPending?: boolean;
  syncBookOptions?: ReadonlyArray<{
    id: string;
    title: string;
    categoryCount: number;
  }>;
  snapshot: LongWorkspaceIndexSnapshot | null;
  pending?: boolean;
  heading?: string;
  childOpen?: boolean;
  showBookActions?: boolean;
  showRename?: boolean;
}>();

type BookManagementAction = "rename" | "sync-legacy" | "resolve-conflicts";

const emit = defineEmits<{
  close: [];
  bookAction: [action: BookManagementAction];
  mutation: [
    batch: LongWorkspaceOperationBatch,
    completion: LongStructureMutationCompletion
  ];
  syncWorldbuilding: [
    payload: LongWorldbuildingSyncRequest,
    completion: LongWorldbuildingSyncCompletion
  ];
  saveAgentsMd: [content: string, completion: LongStructureMutationCompletion];
}>();

const dialogElement = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const manager = ref<{
  flushAgentsMdIfNeeded(): Promise<boolean>;
} | null>(null);
const managerModalActive = ref(false);
const childModalActive = computed(
  () => props.childOpen || managerModalActive.value
);
let previousFocus: HTMLElement | null = null;

async function close(): Promise<void> {
  if (props.pending) return;
  if (manager.value && !(await manager.value.flushAgentsMdIfNeeded())) {
    return;
  }
  emit("close");
}

async function activateBookAction(action: BookManagementAction): Promise<void> {
  if (props.pending) return;
  if (
    action !== "resolve-conflicts" &&
    manager.value &&
    !(await manager.value.flushAgentsMdIfNeeded())
  )
    return;
  emit("bookAction", action);
}

function forwardMutation(
  batch: LongWorkspaceOperationBatch,
  completion: LongStructureMutationCompletion
): void {
  emit("mutation", batch, completion);
}

function forwardSyncWorldbuilding(
  payload: LongWorldbuildingSyncRequest,
  completion: LongWorldbuildingSyncCompletion
): void {
  emit("syncWorldbuilding", payload, completion);
}

function forwardSaveAgentsMd(
  content: string,
  completion: LongStructureMutationCompletion
): void {
  emit("saveAgentsMd", content, completion);
}

function focusableElements(): HTMLElement[] {
  return dialogElement.value
    ? Array.from(
        dialogElement.value.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hasAttribute("hidden"))
    : [];
}

function handleKeydown(event: KeyboardEvent): void {
  if (!props.open || childModalActive.value) return;
  if (event.key === "Escape") {
    close();
    return;
  }
  if (
    event.key !== "Tab" ||
    !(event.target instanceof Node) ||
    !dialogElement.value?.contains(event.target)
  ) {
    return;
  }
  const focusable = focusableElements();
  if (!focusable.length) {
    event.preventDefault();
    dialogElement.value.focus({ preventScroll: true });
    return;
  }
  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      previousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      await nextTick();
      (closeButton.value ?? dialogElement.value)?.focus({
        preventScroll: true
      });
      return;
    }
    const target = previousFocus;
    previousFocus = null;
    await nextTick();
    if (target?.isConnected) target.focus({ preventScroll: true });
  },
  { immediate: true }
);

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="dialog-backdrop long-structure-dialog-overlay"
      @mousedown.self="close"
    >
      <section
        ref="dialogElement"
        class="long-structure-dialog"
        :class="{
          'is-suspended': childModalActive,
          'has-book-name': showBookActions || showRename,
          'has-book-actions': showBookActions
        }"
        :role="childModalActive ? undefined : 'dialog'"
        :aria-modal="childModalActive ? undefined : 'true'"
        :aria-hidden="childModalActive ? 'true' : undefined"
        :inert="childModalActive ? true : undefined"
        aria-labelledby="long-structure-dialog-title"
        tabindex="-1"
      >
        <header class="long-structure-dialog-header">
          <div>
            <span>{{ heading ? bookTitle : t("novelSettings") }}</span>
            <strong id="long-structure-dialog-title">
              {{
                heading ??
                t("structureManagementMessage", {
                  arg0: bookTitle ?? ""
                })
              }}
            </strong>
          </div>
          <button
            ref="closeButton"
            type="button"
            :aria-label="t('closeStructureManagement')"
            :disabled="pending"
            @click="close"
          >
            <AppIcon name="close" :size="16" />
          </button>
        </header>
        <BookManagementName
          v-if="showBookActions || showRename"
          :title="bookTitle"
          :pending="pending"
          @rename="activateBookAction('rename')"
        />
        <slot>
          <LongStructureManager
            v-if="snapshot"
            ref="manager"
            :snapshot="snapshot"
            :current-book-id="bookId"
            :agents-md="agentsMd"
            :agents-md-pending="agentsMdPending"
            :sync-book-options="syncBookOptions"
            :disabled="pending"
            @mutation="forwardMutation"
            @modal-active-change="managerModalActive = $event"
            @sync-worldbuilding="forwardSyncWorldbuilding"
            @save-agents-md="forwardSaveAgentsMd"
          />
        </slot>
        <footer
          v-if="showBookActions"
          class="dialog-actions book-management-actions"
        >
          <button
            class="dialog-secondary-button"
            type="button"
            :disabled="pending"
            @click="activateBookAction('sync-legacy')"
          >
            {{ actionT("syncLegacyVersion") }}
          </button>
          <button
            class="dialog-secondary-button"
            type="button"
            :title="actionT('keepChangesOnDiskResolveFileConflictsAndRefresh')"
            :disabled="pending"
            @click="activateBookAction('resolve-conflicts')"
          >
            {{ actionT("resolveConflicts") }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.long-structure-dialog-overlay {
  z-index: 2200;
  padding: clamp(12px, 3vw, 32px);
}

.long-structure-dialog {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: min(1040px, 96vw);
  max-height: min(880px, 92vh);
  overflow: hidden;
  border: 1px solid var(--theme-line);
  border-radius: 16px;
  background: var(--surface-raised);
  box-shadow: 0 22px 70px
    color-mix(in srgb, var(--text-primary) 18%, transparent);
  color: var(--text-primary);
}

.long-structure-dialog.has-book-name {
  grid-template-rows: auto auto minmax(0, 1fr);
}

.long-structure-dialog.has-book-actions {
  grid-template-rows: auto auto minmax(0, 1fr) auto;
}

.long-structure-dialog.is-suspended {
  visibility: hidden;
  pointer-events: none;
}

.long-structure-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}

.long-structure-dialog-header > div {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.long-structure-dialog-header span {
  color: var(--text-tertiary);
  font-size: 0.714286rem;
}

.long-structure-dialog-header strong {
  overflow: hidden;
  font-size: 1rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.long-structure-dialog-header button {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.long-structure-dialog-header button:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-structure-dialog :deep(.long-structure-manager) {
  min-height: 0;
  overflow: auto;
}

@media (max-height: 680px), (max-width: 760px) {
  .long-structure-dialog-overlay {
    padding: 8px;
  }

  .long-structure-dialog {
    width: 100%;
    max-height: calc(100vh - 16px);
    border-radius: 12px;
  }
}

.book-management-actions {
  flex: none;
  margin: 0;
  padding: 10px 22px;
  border-top: 1px solid var(--theme-line-soft);
}
</style>
