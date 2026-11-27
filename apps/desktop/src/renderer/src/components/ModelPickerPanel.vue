<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch
} from "vue";
import type { ThinkingLevel } from "@deepwrite/contracts/renderer";
import { OFFICIAL_MODEL_REFRESH_CONTEXT_KEY } from "../composables/officialModelRefreshContext";
import { createScopedTranslator } from "../i18n";
import type { ModelSelectOption } from "../utils/modelSelectOptions";
import type { PopupSelectOption } from "../types/popupSelect";
import { useFavoriteModels } from "../utils/favoriteModels";
import { scrollSelectedIntoView } from "../utils/scrollSelectedIntoView";
import AppIcon from "./AppIcon.vue";
import ModelProviderIcon from "./ModelProviderIcon.vue";

const t = createScopedTranslator("components.conversationModelConfigSelect");

const CATEGORY_FAVORITES = "__favorites__";
const CATEGORY_ALL = "__all__";
const GROUP_OFFICIAL = "official";

interface NormalizedModelOption {
  value: string;
  label: string;
  provider?: string;
  modelId?: string;
  disabled?: boolean;
  group: { key: string; label: string };
}

interface ModelGroup {
  key: string;
  label: string;
  provider?: string;
  options: NormalizedModelOption[];
}

const props = withDefaults(
  defineProps<{
    selectedModelId: string;
    modelOptions: readonly (ModelSelectOption | PopupSelectOption)[];
    thinkingLevel?: ThinkingLevel | undefined;
    thinkingOptions?:
      ReadonlyArray<{ value: ThinkingLevel; label: string }> | undefined;
    temperature?: number | undefined;
    temperatureOptions?:
      ReadonlyArray<{ value: number; label: string }> | undefined;
    showsTemperature?: boolean;
    webSearchEnabled?: boolean;
    webSearchAvailable?: boolean;
    webSearchDisabledReason?: string;
    hidesWebSearch?: boolean;
    responding?: boolean;
    showFavorites?: boolean;
    active?: boolean;
    placeholder?: string;
  }>(),
  {
    thinkingLevel: "off",
    thinkingOptions: () => [],
    temperature: 0.7,
    temperatureOptions: () => [],
    showsTemperature: false,
    webSearchEnabled: false,
    webSearchAvailable: false,
    webSearchDisabledReason: "",
    hidesWebSearch: true,
    responding: false,
    showFavorites: true,
    active: true,
    placeholder: ""
  }
);

const emit = defineEmits<{
  selectModel: [modelId: string];
  selectThinking: [level: ThinkingLevel];
  selectTemperature: [temperature: number];
  toggleWebSearch: [enabled: boolean];
}>();

const { isFavorite, toggleFavorite } = useFavoriteModels();

const searchInput = ref<HTMLInputElement | null>(null);
const listElement = ref<HTMLElement | null>(null);
const searchQuery = ref("");
const activeCategory = ref<string>(CATEGORY_ALL);
const highlightedId = ref<string>("");

const normalizedOptions = computed<NormalizedModelOption[]>(() =>
  props.modelOptions.map((option) => {
    const provider =
      "provider" in option && typeof option.provider === "string"
        ? option.provider
        : undefined;
    const modelId =
      "modelId" in option && typeof option.modelId === "string"
        ? option.modelId
        : undefined;
    return {
      value: String(option.value),
      label: option.label,
      ...(provider ? { provider } : {}),
      ...(modelId ? { modelId } : {}),
      ...(option.disabled ? { disabled: true } : {}),
      group: option.group ?? { key: "default", label: t("model") }
    };
  })
);

const allGroups = computed<ModelGroup[]>(() => {
  const groups = new Map<string, ModelGroup>();
  for (const option of normalizedOptions.value) {
    let group = groups.get(option.group.key);
    if (!group) {
      group = {
        key: option.group.key,
        label: option.group.label,
        ...(option.provider ? { provider: option.provider } : {}),
        options: []
      };
      groups.set(option.group.key, group);
    }
    group.options.push(option);
  }
  return [...groups.values()];
});

const trimmedQuery = computed(() => searchQuery.value.trim().toLowerCase());
const isSearching = computed(() => trimmedQuery.value.length > 0);

const visibleOptions = computed<NormalizedModelOption[]>(() => {
  if (isSearching.value) {
    const query = trimmedQuery.value;
    return normalizedOptions.value.filter((option) => {
      const haystack = [
        option.label,
        option.modelId ?? "",
        option.provider ?? "",
        option.group.label
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }
  if (props.showFavorites && activeCategory.value === CATEGORY_FAVORITES) {
    return normalizedOptions.value.filter(
      (option) => option.value !== "" && isFavorite(option.value)
    );
  }
  if (activeCategory.value === CATEGORY_ALL) {
    return normalizedOptions.value;
  }
  return normalizedOptions.value.filter(
    (option) => option.group.key === activeCategory.value
  );
});

const visibleGroups = computed<ModelGroup[]>(() => {
  const groups = new Map<string, ModelGroup>();
  for (const option of visibleOptions.value) {
    let group = groups.get(option.group.key);
    if (!group) {
      group = {
        key: option.group.key,
        label: option.group.label,
        ...(option.provider ? { provider: option.provider } : {}),
        options: []
      };
      groups.set(option.group.key, group);
    }
    group.options.push(option);
  }
  return [...groups.values()];
});

const showGroupHeaders = computed(
  () =>
    visibleGroups.value.length > 1 ||
    (!isSearching.value &&
      (activeCategory.value === CATEGORY_ALL ||
        activeCategory.value === CATEGORY_FAVORITES))
);

const officialModelRefresh = inject(OFFICIAL_MODEL_REFRESH_CONTEXT_KEY, null);
const isOfficialRefreshing = computed(() =>
  Boolean(officialModelRefresh?.refreshing.value)
);
const officialRefreshLabel = computed(() =>
  isOfficialRefreshing.value
    ? t("refreshingOfficialModels")
    : t("refreshOfficialModels")
);
const officialAnnouncementLines = computed(() =>
  (officialModelRefresh?.announcements?.value ?? [])
    .map((message) => message.trim())
    .filter((message) => message.length > 0)
);
const officialAnnouncementText = computed(() =>
  officialAnnouncementLines.value
    .map((message) => message.replace(/\s+/gu, " "))
    .join(" · ")
);
const officialAnnouncementTitle = computed(() =>
  officialAnnouncementLines.value.join("\n")
);

interface TooltipAnchor {
  clientWidth?: number;
  scrollWidth?: number;
  getBoundingClientRect: () =>
    | DOMRect
    | {
        top: number;
        bottom: number;
        left: number;
        right: number;
        width: number;
        height: number;
      };
}

function isTooltipAnchor(target: unknown): target is TooltipAnchor {
  return (
    typeof target === "object" &&
    target !== null &&
    "getBoundingClientRect" in target &&
    typeof target.getBoundingClientRect === "function"
  );
}

const announcementTooltipId = `model-picker-announcement-tooltip-${useId()}`;
const announcementTooltipRef = ref<HTMLElement | null>(null);
const announcementTooltipOpen = ref(false);
const announcementTooltipStyle = ref<{
  left: string;
  top: string;
  visibility: "hidden" | "visible";
}>({ left: "0px", top: "0px", visibility: "hidden" });
let announcementTooltipAnchor: TooltipAnchor | null = null;

function isOfficialAnnouncementHeader(group: ModelGroup): boolean {
  return (
    group.key === GROUP_OFFICIAL && officialAnnouncementText.value.length > 0
  );
}

function groupHeaderText(group: ModelGroup): string {
  if (group.key === GROUP_OFFICIAL) {
    return officialAnnouncementText.value;
  }
  return group.label;
}

function canRefreshGroup(group: ModelGroup): boolean {
  return group.key === GROUP_OFFICIAL && officialModelRefresh !== null;
}

function showGroupHeader(group: ModelGroup): boolean {
  if (group.key === GROUP_OFFICIAL) {
    return officialAnnouncementText.value.length > 0 || canRefreshGroup(group);
  }
  return showGroupHeaders.value;
}

function hideAnnouncementTooltip(): void {
  announcementTooltipOpen.value = false;
  announcementTooltipAnchor = null;
  announcementTooltipStyle.value.visibility = "hidden";
}

async function positionAnnouncementTooltip(
  anchor: TooltipAnchor
): Promise<void> {
  await nextTick();
  const tooltipElement = announcementTooltipRef.value;
  if (
    !announcementTooltipOpen.value ||
    announcementTooltipAnchor !== anchor ||
    !tooltipElement
  ) {
    return;
  }

  const anchorRect = anchor.getBoundingClientRect();
  const tooltipRect =
    typeof tooltipElement.getBoundingClientRect === "function"
      ? tooltipElement.getBoundingClientRect()
      : { width: 0, height: 0 };
  const width = tooltipElement.offsetWidth || tooltipRect.width || 0;
  const height = tooltipElement.offsetHeight || tooltipRect.height || 0;
  const margin = 8;
  const gap = 6;
  const viewportWidth =
    typeof window !== "undefined" ? window.innerWidth : 1280;
  const viewportHeight =
    typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.min(
    Math.max(margin, anchorRect.left),
    Math.max(margin, viewportWidth - width - margin)
  );
  const preferredTop = anchorRect.top - height - gap;
  const top =
    preferredTop >= margin
      ? preferredTop
      : Math.min(
          anchorRect.bottom + gap,
          Math.max(margin, viewportHeight - height - margin)
        );
  announcementTooltipStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    visibility: "visible"
  };
}

function handleGroupLabelMouseEnter(
  group: ModelGroup,
  event: MouseEvent
): void {
  if (
    !isOfficialAnnouncementHeader(group) ||
    !isTooltipAnchor(event.currentTarget)
  ) {
    return;
  }
  const anchor = event.currentTarget;
  const clientWidth = anchor.clientWidth ?? 0;
  const scrollWidth = anchor.scrollWidth ?? 0;
  const hasMeasuredLayout = clientWidth > 0 && scrollWidth > 0;
  const isTruncated =
    !hasMeasuredLayout ||
    scrollWidth > clientWidth + 1 ||
    officialAnnouncementTitle.value !== officialAnnouncementText.value;
  if (!isTruncated) {
    return;
  }
  announcementTooltipAnchor = anchor;
  announcementTooltipOpen.value = true;
  announcementTooltipStyle.value = {
    left: "0px",
    top: "0px",
    visibility: "hidden"
  };
  void positionAnnouncementTooltip(anchor);
}

function handleGroupLabelMouseLeave(group: ModelGroup): void {
  if (isOfficialAnnouncementHeader(group)) {
    hideAnnouncementTooltip();
  }
}

function handleRefreshOfficial(): void {
  if (!officialModelRefresh || isOfficialRefreshing.value) return;
  void officialModelRefresh.refresh();
}

const hasRightPane = computed(
  () =>
    props.thinkingOptions.length > 0 ||
    (props.showsTemperature && props.temperatureOptions.length > 0) ||
    !props.hidesWebSearch
);

const selectedModelLabel = computed(
  () =>
    normalizedOptions.value.find(
      (option) => option.value === props.selectedModelId
    )?.label ??
    (props.placeholder || t("selectModel"))
);

const rightPaneTitle = computed(() =>
  props.thinkingOptions.length > 0 ? t("reasoningLevel") : t("parameters")
);

const webSearchTitle = computed(() => {
  if (props.responding)
    return t("changeWebAccessAfterTheCurrentReplyFinishesOr");
  if (!props.webSearchAvailable) return props.webSearchDisabledReason;
  return props.webSearchEnabled ? t("disableWebAccess") : t("enableWebAccess");
});

const railCategories = computed(() =>
  allGroups.value.map((group) => ({
    key: group.key,
    label: group.label,
    provider: group.provider
  }))
);

function resolveInitialCategory(): string {
  const selected = normalizedOptions.value.find(
    (option) => option.value === props.selectedModelId
  );
  if (
    selected &&
    allGroups.value.some((group) => group.key === selected.group.key)
  ) {
    return selected.group.key;
  }
  return CATEGORY_ALL;
}

function revealSelectedModel(): void {
  void nextTick(() => {
    const selected = listElement.value?.querySelector<HTMLElement>(
      ".model-picker-option.is-selected"
    );
    scrollSelectedIntoView(listElement.value, selected, { block: "center" });
  });
}

function syncForOpen(): void {
  searchQuery.value = "";
  activeCategory.value = resolveInitialCategory();
  highlightedId.value =
    props.selectedModelId || visibleOptions.value[0]?.value || "";
  void nextTick(() => {
    revealSelectedModel();
    searchInput.value?.focus({ preventScroll: true });
  });
}

function selectCategory(key: string): void {
  activeCategory.value = key;
  searchQuery.value = "";
  void nextTick(() => {
    if (
      visibleOptions.value.some(
        (option) => option.value === props.selectedModelId
      )
    ) {
      highlightedId.value = props.selectedModelId;
      revealSelectedModel();
    } else {
      highlightedId.value = visibleOptions.value[0]?.value ?? "";
      if (listElement.value) listElement.value.scrollTop = 0;
    }
  });
}

function selectModelOption(option: NormalizedModelOption): void {
  if (option.disabled) return;
  highlightedId.value = option.value;
  emit("selectModel", option.value);
}

function handleSearchInput(event: Event): void {
  searchQuery.value = (event.target as HTMLInputElement).value;
}

function moveHighlight(delta: 1 | -1): void {
  const enabled = visibleOptions.value.filter((option) => !option.disabled);
  if (enabled.length === 0) return;
  const currentIndex = enabled.findIndex(
    (option) => option.value === highlightedId.value
  );
  const nextIndex =
    currentIndex < 0
      ? delta > 0
        ? 0
        : enabled.length - 1
      : (currentIndex + delta + enabled.length) % enabled.length;
  const target = enabled[nextIndex];
  if (!target) return;
  highlightedId.value = target.value;
  void nextTick(() => {
    const row = [
      ...(listElement.value?.querySelectorAll<HTMLElement>(
        ".model-picker-option"
      ) ?? [])
    ].find((element) => element.dataset.modelValue === target.value);
    scrollSelectedIntoView(listElement.value, row, { block: "nearest" });
    if (
      document.activeElement &&
      listElement.value?.contains(document.activeElement)
    ) {
      row?.focus({ preventScroll: true });
    }
  });
}

function handlePanelKeydown(event: KeyboardEvent): void {
  const target = event.target;
  const inRail =
    target instanceof HTMLElement &&
    Boolean(target.closest(".model-picker-rail"));
  if (inRail && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    const tabs = [
      ...(target
        .closest(".model-picker-rail")
        ?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
    ];
    const index = tabs.indexOf(target as HTMLButtonElement);
    if (index >= 0 && tabs.length > 0) {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = tabs[(index + delta + tabs.length) % tabs.length];
      next?.focus();
    }
    return;
  }

  const inSearchOrList =
    target === searchInput.value ||
    (target instanceof Node && Boolean(listElement.value?.contains(target)));

  if (!inSearchOrList) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveHighlight(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveHighlight(-1);
    return;
  }
  if (event.key === "Enter" && target === searchInput.value) {
    const candidate =
      visibleOptions.value.find(
        (option) => !option.disabled && option.value === highlightedId.value
      ) ?? visibleOptions.value.find((option) => !option.disabled);
    if (candidate) {
      event.preventDefault();
      selectModelOption(candidate);
    }
  }
}

watch(
  () => props.active,
  (active) => {
    if (active) syncForOpen();
  }
);

watch(
  allGroups,
  (groups) => {
    if (
      activeCategory.value !== CATEGORY_ALL &&
      activeCategory.value !== CATEGORY_FAVORITES &&
      !groups.some((group) => group.key === activeCategory.value)
    ) {
      activeCategory.value = CATEGORY_ALL;
    }
  },
  { flush: "post" }
);

watch(visibleOptions, (options) => {
  if (!options.some((option) => option.value === highlightedId.value)) {
    highlightedId.value = options[0]?.value ?? "";
  }
});

watch(
  () => [props.active, officialAnnouncementText.value],
  () => {
    hideAnnouncementTooltip();
  }
);

onMounted(() => {
  if (props.active) syncForOpen();
  if (
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function"
  ) {
    window.addEventListener("resize", hideAnnouncementTooltip);
  }
});

onBeforeUnmount(() => {
  if (
    typeof window !== "undefined" &&
    typeof window.removeEventListener === "function"
  ) {
    window.removeEventListener("resize", hideAnnouncementTooltip);
  }
  hideAnnouncementTooltip();
});
</script>

<template>
  <div
    class="model-picker-panel"
    :class="{ 'has-right-pane': hasRightPane }"
    @keydown="handlePanelKeydown"
  >
    <aside
      class="model-picker-rail"
      role="tablist"
      aria-orientation="vertical"
      :aria-label="t('providerCategories')"
    >
      <button
        v-if="showFavorites"
        type="button"
        role="tab"
        class="model-picker-rail-btn is-favorite-tab"
        :class="{
          'is-active': !isSearching && activeCategory === CATEGORY_FAVORITES
        }"
        :aria-selected="!isSearching && activeCategory === CATEGORY_FAVORITES"
        :aria-label="t('favorites')"
        :title="t('favorites')"
        @click="selectCategory(CATEGORY_FAVORITES)"
      >
        <AppIcon
          :name="
            !isSearching && activeCategory === CATEGORY_FAVORITES
              ? 'star-filled'
              : 'star'
          "
          :size="13"
        />
        <span class="model-picker-rail-label">{{ t("favorites") }}</span>
      </button>
      <button
        type="button"
        role="tab"
        class="model-picker-rail-btn"
        :class="{
          'is-active': !isSearching && activeCategory === CATEGORY_ALL
        }"
        :aria-selected="!isSearching && activeCategory === CATEGORY_ALL"
        :aria-label="t('allModels')"
        :title="t('allModels')"
        @click="selectCategory(CATEGORY_ALL)"
      >
        <AppIcon name="grid" :size="13" />
        <span class="model-picker-rail-label">{{ t("allModels") }}</span>
      </button>
      <div
        v-if="railCategories.length > 0"
        class="model-picker-rail-divider"
        aria-hidden="true"
      />
      <button
        v-for="category in railCategories"
        :key="category.key"
        type="button"
        role="tab"
        class="model-picker-rail-btn"
        :class="{
          'is-active': !isSearching && activeCategory === category.key
        }"
        :aria-selected="!isSearching && activeCategory === category.key"
        :aria-label="category.label"
        :title="category.label"
        @click="selectCategory(category.key)"
      >
        <span class="model-picker-rail-label">{{ category.label }}</span>
      </button>
    </aside>

    <div class="model-picker-main">
      <label class="model-picker-search">
        <AppIcon name="search" :size="14" />
        <input
          ref="searchInput"
          :value="searchQuery"
          type="search"
          :placeholder="t('searchModels')"
          :aria-label="t('searchModels')"
          @input="handleSearchInput"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="model-picker-search-clear"
          :aria-label="t('clearSearch')"
          :title="t('clearSearch')"
          @click="
            searchQuery = '';
            searchInput?.focus();
          "
        >
          <AppIcon name="close" :size="12" />
        </button>
      </label>

      <div
        ref="listElement"
        class="conversation-model-config-models model-picker-list"
        role="listbox"
        :aria-label="t('model')"
        @scroll="hideAnnouncementTooltip"
      >
        <template v-if="visibleGroups.length > 0">
          <div
            v-for="group in visibleGroups"
            :key="group.key"
            class="model-picker-group"
            role="group"
            :aria-label="group.label"
          >
            <div
              v-if="showGroupHeader(group)"
              class="model-picker-group-header"
            >
              <span
                v-if="groupHeaderText(group)"
                class="model-picker-group-label"
                :class="{
                  'is-announcement': isOfficialAnnouncementHeader(group)
                }"
                :aria-describedby="
                  isOfficialAnnouncementHeader(group) && announcementTooltipOpen
                    ? announcementTooltipId
                    : undefined
                "
                @mouseenter="handleGroupLabelMouseEnter(group, $event)"
                @mouseleave="handleGroupLabelMouseLeave(group)"
                >{{ groupHeaderText(group) }}</span
              >
              <button
                v-if="canRefreshGroup(group)"
                type="button"
                class="model-picker-group-refresh"
                :class="{ 'is-refreshing': isOfficialRefreshing }"
                :disabled="isOfficialRefreshing"
                :aria-busy="isOfficialRefreshing"
                :aria-label="officialRefreshLabel"
                :title="officialRefreshLabel"
                @click.stop="handleRefreshOfficial"
              >
                <AppIcon name="refresh" :size="12" />
              </button>
            </div>
            <div
              v-for="option in group.options"
              :key="option.value"
              class="model-picker-row"
              :class="{
                'is-selected': option.value === selectedModelId,
                'is-highlighted': option.value === highlightedId,
                'is-disabled': option.disabled
              }"
            >
              <button
                type="button"
                role="option"
                class="model-picker-option"
                :class="{ 'is-selected': option.value === selectedModelId }"
                :data-model-value="option.value"
                :aria-selected="option.value === selectedModelId"
                :disabled="option.disabled"
                :title="option.label"
                @click="selectModelOption(option)"
                @mouseenter="highlightedId = option.value"
              >
                <ModelProviderIcon
                  class="model-picker-option-icon"
                  :group-key="option.group.key"
                  :provider="option.provider"
                  :model-id="option.modelId"
                  :label="option.label"
                  :size="14"
                />
                <span class="model-picker-option-label">{{
                  option.label
                }}</span>
                <AppIcon
                  v-if="option.value === selectedModelId"
                  class="model-picker-check"
                  name="check"
                  :size="13"
                />
              </button>
              <button
                v-if="showFavorites && option.value !== ''"
                type="button"
                class="model-picker-star"
                :class="{ 'is-favorite': isFavorite(option.value) }"
                :aria-label="
                  isFavorite(option.value)
                    ? t('unfavoriteModel')
                    : t('favoriteModel')
                "
                :aria-pressed="isFavorite(option.value)"
                :title="
                  isFavorite(option.value)
                    ? t('unfavoriteModel')
                    : t('favoriteModel')
                "
                @click.stop="toggleFavorite(option.value)"
              >
                <AppIcon
                  :name="isFavorite(option.value) ? 'star-filled' : 'star'"
                  :size="13"
                />
              </button>
            </div>
          </div>
        </template>
        <div v-else class="model-picker-empty">
          {{
            isSearching
              ? t("noMatchingModels")
              : activeCategory === CATEGORY_FAVORITES
                ? t("noFavoriteModelsHint")
                : t("noMatchingModels")
          }}
        </div>
      </div>
    </div>

    <aside v-if="hasRightPane" class="model-picker-params">
      <header class="model-picker-params-header">
        <strong>{{ rightPaneTitle }}</strong>
        <span class="model-picker-params-model" :title="selectedModelLabel">{{
          selectedModelLabel
        }}</span>
      </header>
      <div class="model-picker-params-body">
        <div
          v-if="thinkingOptions.length > 0"
          class="model-picker-param-list"
          role="listbox"
          :aria-label="t('reasoningLevel')"
        >
          <button
            v-for="option in thinkingOptions"
            :key="option.value"
            type="button"
            role="option"
            class="model-picker-param-option"
            :class="{ 'is-selected': option.value === thinkingLevel }"
            :aria-selected="option.value === thinkingLevel"
            @click="emit('selectThinking', option.value)"
          >
            <span>{{ option.label }}</span>
            <AppIcon
              v-if="option.value === thinkingLevel"
              name="check"
              :size="13"
            />
          </button>
        </div>

        <div
          v-if="showsTemperature && temperatureOptions.length > 0"
          class="model-picker-param-section"
          :class="{ 'has-divider': thinkingOptions.length > 0 }"
        >
          <span class="model-picker-param-section-label">{{
            t("temperature")
          }}</span>
          <div
            class="model-picker-temp-group"
            role="listbox"
            :aria-label="t('temperature')"
          >
            <button
              v-for="option in temperatureOptions"
              :key="option.value"
              type="button"
              role="option"
              class="model-picker-temp-option"
              :class="{ 'is-selected': Object.is(option.value, temperature) }"
              :aria-selected="Object.is(option.value, temperature)"
              @click="emit('selectTemperature', option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div v-if="!hidesWebSearch" class="model-picker-params-footer">
          <button
            class="conversation-model-config-network model-picker-network"
            type="button"
            :disabled="responding || !webSearchAvailable"
            :title="webSearchTitle"
            :aria-label="t('webAccess')"
            :aria-pressed="webSearchEnabled"
            @click="emit('toggleWebSearch', !webSearchEnabled)"
          >
            <span>{{ t("webAccess") }}</span>
            <span
              class="conversation-model-config-switch"
              :class="{ 'is-active': webSearchEnabled }"
            >
              <span />
            </span>
          </button>
        </div>
      </div>
    </aside>

    <div
      v-if="$slots.footer"
      class="conversation-model-config-footer model-picker-footer"
    >
      <slot name="footer" />
    </div>

    <Teleport to="body">
      <div
        v-if="announcementTooltipOpen && officialAnnouncementTitle"
        :id="announcementTooltipId"
        ref="announcementTooltipRef"
        class="model-picker-announcement-tooltip"
        role="tooltip"
        :style="announcementTooltipStyle"
      >
        {{ officialAnnouncementTitle }}
      </div>
    </Teleport>
  </div>
</template>

<style scoped src="../styles/model-picker-panel.css"></style>
