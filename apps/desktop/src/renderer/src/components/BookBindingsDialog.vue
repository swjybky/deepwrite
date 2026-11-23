<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
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
import { useBookLibrarySelection } from "../composables/useBookLibrarySelection";
import { createScopedTranslator } from "../i18n";
import { formatError } from "../i18n/errors";
import {
  bookBindingsTarget,
  type BookBindingsTarget
} from "../stores/bookBindingsDialog";
import { useCatalogIndexStore } from "../stores/catalogIndexStore";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";
import BookBindingsPicker, {
  type BookBindingsPickerItem,
  type BookBindingsPickerSection
} from "./BookBindingsPicker.vue";
import { bindingsT } from "./bookBindingsLabels";
import { sharingT } from "./librarySharingLabels";

const props = defineProps<{ target: BookBindingsTarget }>();
const t = createScopedTranslator("components.bookAgentTeamBindings");
const libraryT = createScopedTranslator("components.bookLibraryBindings");
const menuT = createScopedTranslator("components.longBookActionMenu");
const discardT = createScopedTranslator("components.agentTeamCatalogDialogs");
const index = useCatalogIndexStore();
const { catalog, loaded } = useBookAgentTeamCatalog();
const selection = reactive(
  useBookLibrarySelection({
    get skills() {
      return index.snapshot?.skills ?? [];
    },
    get materials() {
      return index.snapshot?.materials ?? [];
    },
    get skillGroups() {
      return index.snapshot?.skillGroups ?? [];
    },
    get materialGroups() {
      return index.snapshot?.materialGroups ?? [];
    },
    workspaceType: props.target.workspaceType,
    initialSkills: props.target.initialSkills,
    initialMaterials: props.target.initialMaterials,
    initialSkillIds: props.target.initialSkillIds,
    initialMaterialIds: props.target.initialMaterialIds,
    preserveMissing: true
  })
);

const sections = [
  { id: "skill", label: "skillLibrary", icon: "library" },
  { id: "material", label: "materialLibrary", icon: "archive" },
  { id: "team", label: "team", icon: "brain" }
] as const;
type Section = (typeof sections)[number]["id"];
const active = ref<Section>("skill");
const root = ref<HTMLElement>();
const keepEditingButton = ref<HTMLButtonElement>();
const confirmDialog = ref<HTMLElement>();
const saving = ref(false);
const confirming = ref(false);
const previousFocus = document.activeElement as HTMLElement | null;
const overflowingBindingKey = ref<string | null>(null);
let bindingTitleObserver: ResizeObserver | undefined;

function hideBindingName(): void {
  bindingTitleObserver?.disconnect();
  bindingTitleObserver = undefined;
  overflowingBindingKey.value = null;
}

function showBindingName(event: MouseEvent, key: string): void {
  hideBindingName();
  const row = event.currentTarget as HTMLElement;
  const title = row.querySelector<HTMLElement>(".book-bindings-item-title");
  if (!title) return;
  const measure = () => {
    overflowingBindingKey.value =
      title.scrollWidth > title.clientWidth ? key : null;
  };
  measure();
  bindingTitleObserver = new ResizeObserver(measure);
  bindingTitleObserver.observe(title);
}

const saved = shallowReactive<Record<Section, readonly string[]>>({
  skill:
    props.target.initialSkillIds ??
    flattenSkillIdsByKind(props.target.initialSkills),
  material:
    props.target.initialMaterialIds ??
    flattenMaterialIdsByKind(props.target.initialMaterials),
  team: []
});
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

const teams = computed(() =>
  (catalog.value?.teams ?? []).filter(
    (team) => team.workspaceType === props.target.workspaceType
  )
);
const enabledTeamId = computed(
  () => catalog.value?.enabledTeamIds[props.target.workspaceType]
);

function idsFor(section: Section): readonly string[] {
  if (section === "team") return teamIds.value;
  return section === "skill"
    ? selection.selectedFlatSkillIds()
    : selection.selectedFlatMaterialIds();
}

function dirty(section: Section): boolean {
  const ids = idsFor(section);
  return (
    ids.length !== saved[section].length ||
    ids.some((id) => !saved[section].includes(id))
  );
}

const changed = computed(() => sections.some(({ id }) => dirty(id)));

function loadingFor(section: Section): boolean {
  return section === "team" ? !loaded.value : !index.snapshot;
}

interface BoundItem {
  id: string;
  title: string;
  missing: boolean;
}

const bound = computed<Record<Section, BoundItem[]>>(() => {
  const list = (
    ids: readonly string[],
    titles: ReadonlyMap<string, string>,
    fallback: (id: string) => string
  ) =>
    ids.map((id) => {
      const title = titles.get(id);
      return { id, title: title ?? fallback(id), missing: title === undefined };
    });
  const titlesOf = (items: readonly { id: string; title: string }[]) =>
    new Map(items.map((item) => [item.id, item.title]));
  return {
    skill: list(
      selection.selectedSkillLibraryIds,
      titlesOf(selection.skillItems),
      (id) => id
    ),
    material: list(
      selection.selectedMaterialLibraryIds,
      titlesOf(selection.materialItems),
      (id) => id
    ),
    team: list(
      teamIds.value,
      new Map((catalog.value?.teams ?? []).map((team) => [team.id, team.name])),
      () => t("unavailableTeam")
    )
  };
});

function emptyText(section: Section): string {
  if (section !== "team") return bindingsT("notBound");
  const name = teams.value.find(
    (team) => team.id === enabledTeamId.value
  )?.name;
  return name
    ? bindingsT("usesEnabledTeam", { name })
    : bindingsT("noEnabledTeam");
}

function toggle(section: Section, id: string): void {
  if (section === "skill") selection.toggleSkillLibrary(id);
  else if (section === "material") selection.toggleMaterialLibrary(id);
  else
    teamIds.value = teamIds.value.includes(id)
      ? teamIds.value.filter((candidate) => candidate !== id)
      : [...teamIds.value, id];
}

function boundFirst<T extends { id: string }>(
  items: readonly T[],
  ids: readonly string[]
): T[] {
  return [
    ...items.filter((item) => ids.includes(item.id)),
    ...items.filter((item) => !ids.includes(item.id))
  ];
}

function libraryPickerSections(
  kind: "skill" | "material",
  libraries: readonly BookBindingsPickerItem[],
  emptyLibraryText: string
): BookBindingsPickerSection[] {
  const skill = kind === "skill";
  const search = skill
    ? selection.skillSearchQuery
    : selection.materialSearchQuery;
  const query = search.trim().toLocaleLowerCase();
  const tag = skill ? selection.skillTagFilter : selection.materialTagFilter;
  const matchesName = (title: string) =>
    title.toLocaleLowerCase().includes(query);
  const libraryItems = skill ? selection.skillItems : selection.materialItems;
  const availableGroups = skill
    ? selection.availableSkillGroups
    : selection.availableMaterialGroups;
  const validMemberIds = skill
    ? selection.validSkillGroupMemberIds
    : selection.validMaterialGroupMemberIds;
  const isGroupSelected = skill
    ? selection.isSkillGroupSelected
    : selection.isMaterialGroupSelected;
  const selected = skill
    ? selection.selectedSkillSet
    : selection.selectedMaterialSet;
  const taggedLibraryIds = new Set(
    libraryItems.filter((item) => item.tag === tag).map(({ id }) => id)
  );
  const groups = availableGroups.flatMap((group) => {
    const memberIds = validMemberIds(group);
    if (
      !matchesName(group.title) ||
      (tag && !memberIds.some((id) => taggedLibraryIds.has(id)))
    )
      return [];
    const checked = isGroupSelected(group);
    return [
      {
        id: group.id,
        title: group.title,
        meta: sharingT("groupMemberCount", { count: memberIds.length }),
        checked,
        indeterminate: !checked && memberIds.some((id) => selected.has(id))
      }
    ];
  });
  const sections: BookBindingsPickerSection[] = [
    {
      id: "group",
      label: bindingsT("groups"),
      items: groups,
      emptyText: availableGroups.length
        ? bindingsT("noMatches")
        : libraryT(
            skill ? "noSkillGroupsAvailable" : "noMaterialGroupsAvailable"
          )
    },
    {
      id: "library",
      label: t(skill ? "skillLibrary" : "materialLibrary"),
      items: libraries,
      emptyText: emptyLibraryText
    }
  ];
  if (!skill) return sections;

  const individualSkills = (index.snapshot?.skills ?? [])
    .filter((library) => library.isUnbound)
    .flatMap((library) =>
      library.entries.map((entry) => ({
        id: `${library.id}\u0000${entry.id}`,
        title: entry.title
      }))
    );
  const entries = tag
    ? []
    : individualSkills.filter((entry) => matchesName(entry.title));
  sections.push({
    id: "entry",
    label: bindingsT("individualSkills"),
    ...(entries.length ? { note: bindingsT("individualSkillHint") } : {}),
    items: entries,
    emptyText: bindingsT(
      individualSkills.length ? "noMatches" : "noIndividualSkills"
    )
  });
  return sections;
}

const picker = computed(() => {
  const section = active.value;
  const loading = loadingFor(section);
  if (section === "team") {
    return {
      title: t("team"),
      description: t("optionalBindOneOrMoreTeams"),
      label: t("bindAgentTeams"),
      loading,
      items: boundFirst(teams.value, saved.team).map((team) => ({
        id: team.id,
        title: team.name,
        tag: team.id === enabledTeamId.value ? bindingsT("enabled") : undefined
      })),
      selected: new Set(teamIds.value),
      emptyText: loading ? bindingsT("loading") : bindingsT("noTeams")
    };
  }
  const skill = section === "skill";
  const all = skill ? selection.skillItems : selection.materialItems;
  const items = boundFirst(
    skill ? selection.filteredSkillItems : selection.filteredMaterialItems,
    saved[section]
  ).map((item) => ({
    id: item.id,
    title: item.title,
    tag: item.tag,
    meta: sharingT("entryCount", { count: item.entryCount })
  }));
  const emptyText = loading
    ? bindingsT("loading")
    : sharingT(all.length ? "noMatchingLibraries" : "noLibrariesAvailable");
  return {
    title: t(skill ? "skillLibrary" : "materialLibrary"),
    description: skill
      ? libraryT("linkedSkillsCanBeLoadedAsNeededAtAny")
      : bindingsT("materialHint"),
    label: skill ? libraryT("linkSkillLibraries") : t("materialLibrary"),
    loading,
    items,
    selected: skill
      ? selection.selectedSkillSet
      : selection.selectedMaterialSet,
    emptyText,
    sections: loading
      ? undefined
      : libraryPickerSections(section, items, emptyText),
    search: skill ? selection.skillSearchQuery : selection.materialSearchQuery,
    searchPlaceholder: bindingsT(skill ? "searchSkills" : "searchMaterials"),
    tag: skill ? selection.skillTagFilter : selection.materialTagFilter,
    tagOptions: skill
      ? selection.skillTagFilterOptions
      : selection.materialTagFilterOptions
  };
});

function setSearch(value: string): void {
  if (active.value === "skill") selection.skillSearchQuery = value;
  else if (active.value === "material") selection.materialSearchQuery = value;
}

function setTag(value: string): void {
  if (active.value === "skill") selection.skillTagFilter = value;
  else if (active.value === "material") selection.materialTagFilter = value;
}

function toggleGroup(id: string): void {
  if (active.value === "skill") selection.toggleSkillGroup(id);
  else if (active.value === "material") selection.toggleMaterialGroup(id);
}

function focusSection(): void {
  root.value
    ?.querySelector<HTMLElement>('[aria-current="true"]')
    ?.focus({ preventScroll: true });
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
  void nextTick(focusSection);
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
  const changes = sections
    .filter(({ id }) => dirty(id))
    .map(({ id }) => ({
      id,
      ids: [...idsFor(id)],
      library:
        id === "skill"
          ? {
              domain: id,
              ids: [...idsFor(id)],
              linksByKind: selection.selectedSkillLinks()
            }
          : id === "material"
            ? {
                domain: id,
                ids: [...idsFor(id)],
                linksByKind: selection.selectedMaterialLinks()
              }
            : undefined
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

onMounted(focusSection);
onBeforeUnmount(() => {
  hideBindingName();
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
        <form class="book-bindings-form" @submit.prevent="save">
          <div class="book-bindings-layout">
            <aside
              class="book-bindings-overview"
              aria-labelledby="book-bindings-overview-title"
            >
              <h3 id="book-bindings-overview-title">
                {{ bindingsT("currentBindings") }}
              </h3>
              <section
                v-for="{ id, label, icon } in sections"
                :key="id"
                class="book-bindings-card"
                :class="{ 'is-active': active === id }"
              >
                <button
                  :id="`book-bindings-tab-${id}`"
                  class="book-bindings-card-head"
                  type="button"
                  aria-controls="book-bindings-editor"
                  :aria-current="active === id || undefined"
                  :aria-label="
                    dirty(id) ? t('unsavedTab', { label: t(label) }) : t(label)
                  "
                  @click="active = id"
                >
                  <AppIcon :name="icon" :size="15" />
                  <span class="book-bindings-card-label">{{ t(label) }}</span>
                  <span
                    class="book-bindings-count"
                    :class="{ 'is-empty': !bound[id].length }"
                    >{{ bound[id].length }}</span
                  >
                  <span
                    v-if="dirty(id)"
                    class="book-bindings-dirty"
                    aria-hidden="true"
                  />
                  <AppIcon
                    class="book-bindings-card-chevron"
                    name="chevron"
                    :size="14"
                  />
                </button>
                <p v-if="loadingFor(id)" class="book-bindings-card-empty">
                  {{ bindingsT("loading") }}
                </p>
                <ul v-else-if="bound[id].length" class="book-bindings-items">
                  <li
                    v-for="item in bound[id]"
                    :key="item.id"
                    :class="{ 'is-missing': item.missing }"
                    @mouseenter="showBindingName($event, `${id}:${item.id}`)"
                    @mouseleave="hideBindingName"
                  >
                    <AppIcon
                      class="book-bindings-item-icon"
                      :name="item.missing ? 'close' : 'check'"
                      :size="13"
                    />
                    <span class="book-bindings-item-title">{{
                      item.title
                    }}</span>
                    <span v-if="item.missing" class="book-bindings-item-flag">{{
                      bindingsT("unavailable")
                    }}</span>
                    <button
                      type="button"
                      :aria-label="t('unbindValue', { name: item.title })"
                      @click="toggle(id, item.id)"
                    >
                      ×
                    </button>
                    <span
                      v-if="overflowingBindingKey === `${id}:${item.id}`"
                      class="book-bindings-item-tooltip"
                      aria-hidden="true"
                    >
                      {{ item.title }}
                    </span>
                  </li>
                </ul>
                <p v-else class="book-bindings-card-empty">
                  {{ emptyText(id) }}
                </p>
              </section>
            </aside>
            <section
              id="book-bindings-editor"
              class="book-bindings-editor"
              aria-labelledby="book-bindings-editor-title"
            >
              <header>
                <h3 id="book-bindings-editor-title">
                  {{ picker.title }}
                </h3>
                <p>{{ picker.description }}</p>
              </header>
              <BookBindingsPicker
                :key="active"
                :label="picker.label"
                :items="picker.items"
                :selected="picker.selected"
                :empty-text="picker.emptyText"
                :sections="picker.sections"
                :loading="picker.loading"
                :search="picker.search"
                :search-placeholder="picker.searchPlaceholder"
                :tag="picker.tag"
                :tag-options="picker.tagOptions"
                @toggle="toggle(active, $event)"
                @toggle-group="toggleGroup"
                @update:search="setSearch"
                @update:tag="setTag"
              />
            </section>
          </div>
          <div class="dialog-actions book-bindings-actions">
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

<style scoped src="./book-bindings-dialog.css"></style>
