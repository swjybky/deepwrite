<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowReactive,
  watch
} from "vue";
import {
  flattenMaterialIdsByKind,
  flattenSkillIdsByKind
} from "@deepwrite/contracts/renderer";
import {
  saveBookAgentTeamBinding,
  useBookAgentTeamCatalog
} from "../composables/useBookAgentTeamBinding";
import { createScopedTranslator } from "../i18n";
import { formatError } from "../i18n/errors";
import {
  bookBindingsTarget,
  type BookBindingsTarget,
  type BookLibraryBindingChange
} from "../stores/bookBindingsDialog";
import { useCatalogIndexStore } from "../stores/catalogIndexStore";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";
import BookAgentTeamBindings from "./BookAgentTeamBindings.vue";
import BookLibraryBindings from "./BookLibraryBindings.vue";

const props = defineProps<{ target: BookBindingsTarget }>();
const t = createScopedTranslator("components.bookAgentTeamBindings");
const menuT = createScopedTranslator("components.longBookActionMenu");
const discardT = createScopedTranslator("components.agentTeamCatalogDialogs");
const index = useCatalogIndexStore();
const { catalog, loaded } = useBookAgentTeamCatalog();

const tabs = [
  { id: "skill", label: "skillLibrary", icon: "library" },
  { id: "material", label: "materialLibrary", icon: "archive" },
  { id: "team", label: "team", icon: "brain" }
] as const;
type Tab = (typeof tabs)[number]["id"];
const activeTab = ref<Tab>("skill");
const root = ref<HTMLElement>();
const keepEditingButton = ref<HTMLButtonElement>();
const confirmDialog = ref<HTMLElement>();
const saving = ref(false);
const confirming = ref(false);
const previousFocus = document.activeElement as HTMLElement | null;

const saved = shallowReactive<Record<Tab, readonly string[]>>({
  skill:
    props.target.initialSkillIds ??
    flattenSkillIdsByKind(props.target.initialSkills),
  material:
    props.target.initialMaterialIds ??
    flattenMaterialIdsByKind(props.target.initialMaterials),
  team: []
});
const drafts = shallowReactive<
  Partial<Record<"skill" | "material", BookLibraryBindingChange>>
>({});
const teamIds = ref<string[]>([]);
watch(
  loaded,
  (ready) => {
    if (!ready) return;
    const ids = [...(catalog.value?.bookBindings?.[props.target.bookId] ?? [])];
    saved.team = ids;
    teamIds.value = ids;
  },
  { immediate: true }
);

function idsFor(tab: Tab): readonly string[] {
  return tab === "team" ? teamIds.value : (drafts[tab]?.ids ?? saved[tab]);
}

function dirty(tab: Tab): boolean {
  const ids = idsFor(tab);
  return (
    ids.length !== saved[tab].length ||
    ids.some((id) => !saved[tab].includes(id))
  );
}

const changed = computed(() => tabs.some(({ id }) => dirty(id)));

function updateLibraries(
  domain: "skill" | "material",
  value: {
    linkedSkillIds: string[];
    linkedMaterialIds: string[];
    linkedSkillIdsByKind: Extract<
      BookLibraryBindingChange,
      { domain: "skill" }
    >["linksByKind"];
    linkedMaterialIdsByKind: Extract<
      BookLibraryBindingChange,
      { domain: "material" }
    >["linksByKind"];
  }
): void {
  drafts[domain] =
    domain === "skill"
      ? {
          domain,
          ids: value.linkedSkillIds,
          linksByKind: value.linkedSkillIdsByKind
        }
      : {
          domain,
          ids: value.linkedMaterialIds,
          linksByKind: value.linkedMaterialIdsByKind
        };
}

function focusTab(): void {
  root.value
    ?.querySelector<HTMLElement>('[aria-selected="true"]')
    ?.focus({ preventScroll: true });
}

function selectViaKeyboard(event: KeyboardEvent): void {
  const current = tabs.findIndex(({ id }) => id === activeTab.value);
  const positions: Record<string, number> = {
    ArrowLeft: (current + tabs.length - 1) % tabs.length,
    ArrowRight: (current + 1) % tabs.length,
    Home: 0,
    End: tabs.length - 1
  };
  const next = tabs[positions[event.key] ?? -1];
  if (!next) return;
  event.preventDefault();
  activeTab.value = next.id;
  void nextTick(focusTab);
}

function close(): void {
  if (bookBindingsTarget.value !== props.target) return;
  bookBindingsTarget.value = null;
  props.target.close?.();
}

function requestClose(): void {
  if (saving.value) return;
  if (!changed.value) {
    close();
    return;
  }
  confirming.value = true;
  void nextTick(() => keepEditingButton.value?.focus());
}

function keepEditing(): void {
  confirming.value = false;
  void nextTick(focusTab);
}

function handleEscape(event: KeyboardEvent): void {
  event.stopPropagation();
  if (confirming.value) keepEditing();
  else requestClose();
}

function trapFocus(event: KeyboardEvent): void {
  const dialog = confirming.value ? confirmDialog.value : root.value;
  const focusable = [
    ...(dialog?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex="0"]'
    ) ?? [])
  ].filter(
    (element) => element.tabIndex >= 0 && element.getClientRects().length
  );
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first && last) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last && first) {
    event.preventDefault();
    first.focus();
  }
}

async function save(): Promise<void> {
  if (saving.value || !changed.value) return;
  const target = props.target;
  const { bookId, workspaceType, saveLibrary } = target;
  saving.value = true;
  let failed = false;
  const changes = tabs
    .filter(({ id }) => dirty(id))
    .map(({ id }) => ({
      id,
      ids: [...idsFor(id)],
      library: id === "team" ? undefined : drafts[id]
    }));
  try {
    for (const { id, ids, library } of changes) {
      if (bookBindingsTarget.value !== target) return;
      try {
        if (library) {
          if (!(await saveLibrary(library)))
            throw new Error(t("failedToSaveTheBinding"));
        } else {
          await saveBookAgentTeamBinding({
            bookId,
            workspaceType,
            teamIds: ids
          });
        }
        saved[id] = ids;
      } catch (error: unknown) {
        failed = true;
        uiMessage.error(formatError(error, t("failedToSaveTheBinding")));
      }
    }
    if (!failed && bookBindingsTarget.value === target) {
      uiMessage.success(t("bindingSaved"));
      if (!changed.value) close();
    }
  } finally {
    saving.value = false;
  }
}

onMounted(focusTab);
onBeforeUnmount(() => {
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
});
</script>

<template>
  <Teleport to="body">
    <div
      class="dialog-backdrop"
      @keydown.tab="trapFocus"
      @mousedown.self="confirming ? keepEditing() : requestClose()"
    >
      <section
        v-show="!confirming"
        ref="root"
        class="workspace-dialog book-bindings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-bindings-title"
        @keydown.esc.stop="handleEscape"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{ target.title }}</span>
            <h2 id="book-bindings-title">{{ menuT("bindings") }}</h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            @click="requestClose"
          >
            ×
          </button>
        </header>
        <form
          class="dialog-content book-bindings-content"
          @submit.prevent="save"
        >
          <div
            class="book-bindings-tabs"
            role="tablist"
            :aria-label="menuT('bindings')"
            @keydown="selectViaKeyboard"
          >
            <button
              v-for="{ id, label, icon } in tabs"
              :id="`book-bindings-tab-${id}`"
              :key="id"
              type="button"
              role="tab"
              :aria-controls="`book-bindings-panel-${id}`"
              :aria-selected="activeTab === id"
              :aria-label="
                dirty(id) ? t('unsavedTab', { label: t(label) }) : t(label)
              "
              :tabindex="activeTab === id ? 0 : -1"
              @click="activeTab = id"
            >
              <AppIcon :name="icon" :size="14" />
              {{ t(label) }}
              <span v-if="idsFor(id).length" class="book-bindings-tab-count">{{
                idsFor(id).length
              }}</span>
              <span
                v-if="dirty(id)"
                class="book-bindings-tab-dirty"
                aria-hidden="true"
              />
            </button>
          </div>
          <div
            v-for="{ id } in tabs"
            v-show="activeTab === id"
            :id="`book-bindings-panel-${id}`"
            :key="id"
            class="book-bindings-panel"
            role="tabpanel"
            :aria-labelledby="`book-bindings-tab-${id}`"
          >
            <BookAgentTeamBindings
              v-if="id === 'team'"
              v-model="teamIds"
              :workspace-type="target.workspaceType"
            />
            <BookLibraryBindings
              v-else
              :domain="id"
              :workspace-type="target.workspaceType"
              :loading="!index.snapshot"
              :skills="index.snapshot?.skills ?? []"
              :materials="index.snapshot?.materials ?? []"
              :skill-groups="index.snapshot?.skillGroups ?? []"
              :material-groups="index.snapshot?.materialGroups ?? []"
              :initial-skills="target.initialSkills"
              :initial-materials="target.initialMaterials"
              :initial-skill-ids="target.initialSkillIds"
              :initial-material-ids="target.initialMaterialIds"
              preserve-missing
              @change="updateLibraries(id, $event)"
            />
          </div>
          <div class="dialog-actions">
            <button
              class="dialog-secondary-button"
              type="button"
              @click="requestClose"
            >
              {{ t("cancel") }}
            </button>
            <button
              class="dialog-primary-button book-bindings-save"
              type="submit"
              :disabled="saving || !changed"
            >
              <span :class="{ 'book-bindings-save-hidden': saving }">{{
                t("save")
              }}</span>
              <span :class="{ 'book-bindings-save-hidden': !saving }">{{
                t("saving")
              }}</span>
            </button>
          </div>
        </form>
      </section>

      <section
        v-if="confirming"
        ref="confirmDialog"
        class="workspace-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="book-bindings-discard-title"
        @keydown.esc.stop="handleEscape"
      >
        <header>
          <h2 id="book-bindings-discard-title">
            {{ discardT("discardUnsavedChanges") }}
          </h2>
        </header>
        <div class="dialog-content">
          <div class="dialog-actions">
            <button
              ref="keepEditingButton"
              class="dialog-secondary-button"
              type="button"
              @click="keepEditing"
            >
              {{ discardT("keepEditing") }}
            </button>
            <button class="dialog-primary-button" type="button" @click="close">
              {{ discardT("discardAndLeave") }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.book-bindings-dialog > header {
  padding-block: 10px;
}
.book-bindings-dialog > header > div {
  min-width: 0;
}
.book-bindings-dialog .dialog-eyebrow {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.book-bindings-content {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  overflow: hidden;
  padding-block: 10px;
}
.book-bindings-tabs {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  margin-bottom: 8px;
  border-radius: 9px;
  background: var(--surface-hover);
}
.book-bindings-tabs > button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 12px;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.857143rem;
  white-space: nowrap;
  transition: background-color 120ms ease;
}
.book-bindings-tabs > button:hover,
.book-bindings-tabs > button[aria-selected="true"] {
  color: var(--text-primary);
}
.book-bindings-tabs > button[aria-selected="true"] {
  background: var(--surface-main);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--shadow-color) 60%, transparent);
  font-weight: 600;
}
.book-bindings-tab-count {
  color: var(--text-tertiary);
  font-size: 0.714286rem;
  font-variant-numeric: tabular-nums;
}
.book-bindings-tab-dirty {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}
.book-bindings-panel {
  align-self: stretch;
  height: min(420px, calc(100vh - 260px));
  min-height: 0;
  overflow: auto;
}
.book-bindings-content > .dialog-actions {
  align-self: stretch;
  margin-top: 10px;
}
.book-bindings-save {
  display: grid;
}
.book-bindings-save > span {
  grid-area: 1 / 1;
}
.book-bindings-save-hidden {
  visibility: hidden;
}
</style>
