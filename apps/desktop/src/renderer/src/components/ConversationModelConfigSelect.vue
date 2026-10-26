<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type CSSProperties
} from "vue";
import type { ThinkingLevel } from "@deepwrite/contracts/renderer";
import { createId } from "@deepwrite/shared";
import AppIcon from "./AppIcon.vue";
import { scrollSelectedIntoView } from "../utils/scrollSelectedIntoView";
import type { ModelSelectOption } from "../utils/modelSelectOptions";

const t = createScopedTranslator("components.conversationModelConfigSelect");

type ConfigPage = "main" | "thinking" | "temperature";
type ConfigValue = string | number;

interface ConfigOption {
  value: ConfigValue;
  label: string;
}

const props = defineProps<{
  selectedModelId: string;
  modelOptions: ModelSelectOption[];
  thinkingLevel: ThinkingLevel;
  thinkingOptions: Array<{ value: ThinkingLevel; label: string }>;
  temperature: number;
  temperatureOptions: Array<{ value: number; label: string }>;
  showsTemperature: boolean;
  webSearchEnabled: boolean;
  webSearchAvailable: boolean;
  webSearchDisabledReason: string;
  responding: boolean;
}>();

const emit = defineEmits<{
  selectModel: [modelId: string];
  selectThinking: [level: ThinkingLevel];
  selectTemperature: [temperature: number];
  toggleWebSearch: [enabled: boolean];
}>();

const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const open = ref(false);
const page = ref<ConfigPage>("main");
const menuStyle = ref<CSSProperties>({});
const menuId = createId("conversation-model-config");

const selectedModelLabel = computed(
  () =>
    props.modelOptions.find((option) => option.value === props.selectedModelId)
      ?.label ?? t("selectModel")
);
const modelGroups = computed(() => {
  const groups = new Map<
    string,
    {
      provider: string;
      label: string;
      options: typeof props.modelOptions;
    }
  >();
  for (const option of props.modelOptions) {
    let group = groups.get(option.group.key);
    if (!group) {
      group = {
        provider: option.group.key,
        label: option.group.label,
        options: []
      };
      groups.set(option.group.key, group);
    }
    group.options.push(option);
  }
  return [...groups.values()];
});
const thinkingLabel = computed(
  () =>
    props.thinkingOptions.find((option) => option.value === props.thinkingLevel)
      ?.label ?? t("off")
);
const temperatureLabel = computed(
  () =>
    props.temperatureOptions.find(
      (option) => option.value === props.temperature
    )?.label ?? String(props.temperature)
);
const activeParameterLabel = computed(() =>
  props.showsTemperature
    ? t("temperatureValue", {
        arg0: temperatureLabel.value
      })
    : thinkingLabel.value
);
const submenuTitle = computed(() => {
  if (page.value === "thinking") return t("reasoningLevel");
  return t("temperature");
});
const submenuOptions = computed<ConfigOption[]>(() => {
  if (page.value === "thinking") return props.thinkingOptions;
  if (page.value === "temperature") return props.temperatureOptions;
  return [];
});
const selectedSubmenuValue = computed<ConfigValue>(() => {
  if (page.value === "thinking") return props.thinkingLevel;
  return props.temperature;
});
const webSearchTitle = computed(() => {
  if (props.responding)
    return t("changeWebAccessAfterTheCurrentReplyFinishesOr");
  if (!props.webSearchAvailable) return props.webSearchDisabledReason;
  return props.webSearchEnabled ? t("disableWebAccess") : t("enableWebAccess");
});

function positionMenu(): void {
  if (!open.value || !trigger.value) return;
  const rect = trigger.value.getBoundingClientRect();
  const viewportMargin = 8;
  const gap = 7;
  const width = Math.min(304, window.innerWidth - viewportMargin * 2);
  const models = menu.value?.querySelector<HTMLElement>(
    ".conversation-model-config-models"
  );
  const footer = menu.value?.querySelector<HTMLElement>(
    ".conversation-model-config-footer"
  );
  const submenu = menu.value?.querySelector<HTMLElement>(
    ".conversation-model-config-submenu"
  );
  const height =
    20 +
    (models
      ? models.scrollHeight + (footer?.offsetHeight ?? 0)
      : (submenu?.scrollHeight ?? 0));
  const spaceBelow = window.innerHeight - rect.bottom - gap - viewportMargin;
  const spaceAbove = rect.top - gap - viewportMargin;
  const opensUpward =
    spaceBelow < Math.min(height, 190) && spaceAbove > spaceBelow;
  const maxHeight = Math.max(
    120,
    Math.min(520, opensUpward ? spaceAbove : spaceBelow)
  );
  const renderedHeight = Math.min(height, maxHeight);
  const left = Math.min(
    Math.max(viewportMargin, rect.left),
    window.innerWidth - width - viewportMargin
  );
  const top = opensUpward ? rect.top - gap - renderedHeight : rect.bottom + gap;
  menuStyle.value = {
    top: `${Math.max(viewportMargin, top)}px`,
    left: `${left}px`,
    width: `${width}px`,
    maxHeight: `${maxHeight}px`,
    transformOrigin: opensUpward ? "bottom" : "top"
  };
}

async function openMenu(): Promise<void> {
  if (open.value || props.modelOptions.length === 0) return;
  page.value = "main";
  open.value = true;
  await nextTick();
  positionMenu();
  revealCurrentSelection();
}

function closeMenu(returnFocus = false): void {
  if (!open.value) return;
  open.value = false;
  page.value = "main";
  if (returnFocus) nextTick(() => trigger.value?.focus());
}

function toggleMenu(): void {
  if (open.value) closeMenu();
  else void openMenu();
}

function revealCurrentSelection(): void {
  void nextTick(() => {
    const selected = menu.value?.querySelector<HTMLElement>(
      ".conversation-model-config-options > button.is-selected"
    );
    const scroller =
      menu.value?.querySelector<HTMLElement>(
        ".conversation-model-config-models"
      ) ??
      menu.value?.querySelector<HTMLElement>(
        ".conversation-model-config-options"
      );
    scrollSelectedIntoView(scroller, selected);
  });
}

function showPage(nextPage: Exclude<ConfigPage, "main">): void {
  page.value = nextPage;
  nextTick(() => {
    positionMenu();
    revealCurrentSelection();
  });
}

function showMainPage(): void {
  page.value = "main";
  nextTick(() => {
    positionMenu();
    revealCurrentSelection();
  });
}

function selectOption(value: ConfigValue): void {
  if (page.value === "thinking") {
    emit("selectThinking", String(value) as ThinkingLevel);
  }
  if (page.value === "temperature") {
    emit("selectTemperature", Number(value));
  }
  showMainPage();
}

function handleTriggerKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && open.value) {
    event.preventDefault();
    closeMenu();
    return;
  }
  if (["Enter", " ", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    if (!open.value) void openMenu();
  }
}

function handleMenuKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  if (page.value === "main") closeMenu(true);
  else showMainPage();
}

function handleDocumentPointerdown(event: PointerEvent): void {
  const target = event.target;
  if (
    target instanceof Node &&
    !trigger.value?.contains(target) &&
    !menu.value?.contains(target)
  ) {
    closeMenu();
  }
}

function handleViewportChange(event: Event): void {
  if (event.target instanceof Node && menu.value?.contains(event.target))
    return;
  if (open.value) positionMenu();
}

watch(
  () => [props.modelOptions.length, props.showsTemperature] as const,
  ([modelCount]) => {
    if (modelCount === 0) closeMenu();
    else if (open.value) nextTick(positionMenu);
  }
);

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerdown);
  window.addEventListener("resize", handleViewportChange);
  document.addEventListener("scroll", handleViewportChange, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerdown);
  window.removeEventListener("resize", handleViewportChange);
  document.removeEventListener("scroll", handleViewportChange, true);
});
</script>

<template>
  <span class="conversation-model-config" :class="{ 'is-open': open }">
    <button
      ref="trigger"
      class="conversation-model-config-trigger"
      type="button"
      aria-haspopup="dialog"
      :aria-label="t('modelSettings')"
      :title="`${selectedModelLabel} · ${activeParameterLabel}`"
      :aria-controls="open ? menuId : undefined"
      :aria-expanded="open"
      :disabled="modelOptions.length === 0"
      @click="toggleMenu"
      @keydown="handleTriggerKeydown"
    >
      <span class="conversation-model-config-icons">
        <AppIcon name="model" :size="14" />
        <AppIcon
          v-if="webSearchEnabled"
          class="conversation-model-config-network-indicator"
          name="globe"
          :size="11"
        />
      </span>
      <span class="conversation-model-config-label">{{
        selectedModelLabel
      }}</span>
      <span class="conversation-model-config-summary">
        · {{ activeParameterLabel }}
      </span>
      <AppIcon
        class="conversation-model-config-chevron"
        name="chevron"
        :size="11"
      />
    </button>

    <Teleport to="body">
      <Transition name="conversation-model-config-menu">
        <section
          v-if="open"
          :id="menuId"
          ref="menu"
          class="conversation-model-config-menu"
          :style="menuStyle"
          role="dialog"
          :aria-label="t('modelSettings')"
          @keydown="handleMenuKeydown"
        >
          <div v-if="page === 'main'" class="conversation-model-config-main">
            <div
              class="conversation-model-config-models"
              role="listbox"
              :aria-label="t('model')"
            >
              <div
                v-for="group in modelGroups"
                :key="group.provider"
                class="conversation-model-config-provider"
                role="group"
                :aria-label="group.label"
              >
                <div class="conversation-model-config-provider-label">
                  {{ group.label }}
                </div>
                <div class="conversation-model-config-options">
                  <button
                    v-for="option in group.options"
                    :key="option.value"
                    type="button"
                    role="option"
                    :aria-selected="option.value === selectedModelId"
                    :class="{ 'is-selected': option.value === selectedModelId }"
                    @click="emit('selectModel', option.value)"
                  >
                    <span>{{ option.label }}</span>
                    <AppIcon
                      v-if="option.value === selectedModelId"
                      name="check"
                      :size="15"
                    />
                  </button>
                </div>
              </div>
            </div>
            <div class="conversation-model-config-footer">
              <button
                type="button"
                :aria-label="t('reasoningLevel')"
                @click="showPage('thinking')"
              >
                <span>{{ t("reasoningLevel") }}</span>
                <span class="conversation-model-config-value">{{
                  thinkingLabel
                }}</span>
                <AppIcon name="chevron" :size="16" />
              </button>
              <button
                v-if="showsTemperature"
                type="button"
                @click="showPage('temperature')"
              >
                <span>{{ t("temperature") }}</span>
                <span class="conversation-model-config-value">{{
                  temperatureLabel
                }}</span>
                <AppIcon name="chevron" :size="16" />
              </button>
              <button
                class="conversation-model-config-network"
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

          <div v-else class="conversation-model-config-submenu">
            <header>
              <button
                type="button"
                :aria-label="t('backToModelSettings')"
                @click="showMainPage"
              >
                <AppIcon name="chevron" :size="16" />
              </button>
              <strong>{{ submenuTitle }}</strong>
            </header>
            <div
              class="conversation-model-config-options"
              role="listbox"
              :aria-label="submenuTitle"
            >
              <button
                v-for="option in submenuOptions"
                :key="`${typeof option.value}:${option.value}`"
                type="button"
                role="option"
                :aria-selected="Object.is(option.value, selectedSubmenuValue)"
                :class="{
                  'is-selected': Object.is(option.value, selectedSubmenuValue)
                }"
                @click="selectOption(option.value)"
              >
                <span>{{ option.label }}</span>
                <AppIcon
                  v-if="Object.is(option.value, selectedSubmenuValue)"
                  name="check"
                  :size="15"
                />
              </button>
            </div>
          </div>
        </section>
      </Transition>
    </Teleport>
  </span>
</template>

<style scoped src="../styles/conversation-model-config-select.css"></style>
