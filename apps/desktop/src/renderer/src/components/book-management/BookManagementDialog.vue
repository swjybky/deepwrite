<script lang="ts">
export interface BookManagementSection<Id extends string = string> {
  id: Id;
  group: "structure" | "settings" | "context";
  label: string;
  title?: string;
  description?: string;
}
</script>

<script setup lang="ts" generic="Id extends string">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { createScopedTranslator } from "../../i18n";
import AppIcon from "../AppIcon.vue";
import BookManagementName from "../BookManagementName.vue";

const t = createScopedTranslator("components.plotStructureDialog");
const props = defineProps<{
  open: boolean;
  bookTitle: string;
  bookType: string;
  sections: readonly BookManagementSection<Id>[];
  active: Id;
  pending?: boolean | undefined;
  childOpen?: boolean | undefined;
}>();
const emit = defineEmits<{ close: []; rename: []; select: [id: Id] }>();
const titleId = useId();
const sectionId = useId();
const dialog = ref<HTMLElement>();
const content = ref<HTMLElement>();
let trigger: HTMLElement | null = null;
let childTrigger: HTMLElement | null = null;

const groups = computed(() =>
  (["structure", "settings", "context"] as const)
    .map((id) => ({
      id,
      label: t(id),
      sections: props.sections.filter((section) => section.group === id)
    }))
    .filter(({ sections }) => sections.length)
);
const current = computed(() =>
  props.sections.find(({ id }) => id === props.active)
);

function modal(): HTMLElement | null | undefined {
  return props.childOpen
    ? document.querySelector<HTMLElement>(
        '.book-management-child [role="dialog"], .book-management-child [role="alertdialog"]'
      )
    : dialog.value;
}

function focusable(element: HTMLElement): HTMLElement[] {
  return Array.from(
    element.querySelectorAll<HTMLElement>(
      "button, input, textarea, select, a[href], [tabindex]"
    )
  ).filter(
    (item) =>
      item.tabIndex >= 0 &&
      !item.matches(":disabled") &&
      item.getClientRects().length
  );
}

function focus(element?: HTMLElement | null): void {
  element?.focus({ preventScroll: true });
}

function handleKeys(event: KeyboardEvent): void {
  if (event.defaultPrevented) return;
  const element = modal();
  if (
    !element ||
    (event.target as HTMLElement)?.closest?.(".popup-select-menu")
  )
    return;
  if (event.key === "Escape" && !props.childOpen) {
    event.preventDefault();
    emit("close");
  }
  if (event.key !== "Tab") return;
  const items = focusable(element);
  const first = items[0];
  const last = items.at(-1);
  const active = document.activeElement;
  if (
    !items.length ||
    !element.contains(active) ||
    (event.shiftKey && (active === first || active === element)) ||
    (!event.shiftKey && active === last)
  ) {
    event.preventDefault();
    focus((event.shiftKey ? last : first) ?? element);
  }
}

function restoreTrigger(): void {
  document.removeEventListener("keydown", handleKeys);
  const previous = trigger;
  trigger = null;
  void nextTick(() => {
    if (previous?.isConnected && document.activeElement === document.body)
      focus(previous);
  });
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      restoreTrigger();
      return;
    }
    trigger = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", handleKeys);
    await nextTick();
    focus(
      dialog.value?.querySelector<HTMLElement>(
        ".dialog-close:not(:disabled)"
      ) ?? dialog.value
    );
  },
  { immediate: true }
);
watch(
  () => props.childOpen,
  async (open) => {
    if (open) childTrigger = document.activeElement as HTMLElement | null;
    await nextTick();
    const element = modal();
    if (!element) return;
    if (open) {
      element.tabIndex = -1;
      if (!element.contains(document.activeElement)) {
        const items = focusable(element);
        focus(
          items.find((item) => item.hasAttribute("autofocus")) ??
            items.find((item) =>
              item.matches('input, textarea, [role="combobox"]')
            ) ??
            items[0] ??
            element
        );
      }
    } else {
      focus(childTrigger);
      if (!element.contains(document.activeElement))
        focus(
          element.querySelector<HTMLElement>('[aria-current="true"]') ?? element
        );
      childTrigger = null;
    }
  },
  { flush: "sync" }
);
watch(
  () => props.active,
  () => {
    if (content.value) content.value.scrollTop = 0;
  }
);
onBeforeUnmount(restoreTrigger);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="dialog-backdrop book-management-backdrop"
      @mousedown.self="!childOpen && emit('close')"
    >
      <section
        ref="dialog"
        class="workspace-dialog book-management-dialog"
        role="dialog"
        :aria-modal="childOpen ? undefined : true"
        :aria-hidden="childOpen || undefined"
        :aria-labelledby="titleId"
        :inert="childOpen"
        tabindex="-1"
      >
        <header>
          <h2 :id="titleId">
            {{ t("managementTitle", { arg0: bookType }) }}
          </h2>
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            :disabled="pending"
            @click="emit('close')"
          >
            <AppIcon name="close" :size="16" />
          </button>
        </header>
        <BookManagementName
          :title="bookTitle"
          :pending="pending"
          @rename="emit('rename')"
        />
        <div class="book-management-layout">
          <nav class="book-management-nav" :aria-label="t('manageStructure')">
            <div
              v-for="group in groups"
              :key="group.id"
              class="book-management-nav-group"
            >
              <strong>{{ group.label }}</strong>
              <button
                v-for="section in group.sections"
                :key="section.id"
                type="button"
                :aria-current="section.id === active || undefined"
                @click="emit('select', section.id)"
              >
                {{ section.label }}
              </button>
            </div>
          </nav>
          <section
            v-if="current"
            class="book-management-section"
            :aria-labelledby="sectionId"
          >
            <header class="book-management-section-header">
              <div>
                <h3 :id="sectionId">{{ current.title ?? current.label }}</h3>
                <p v-if="current.description">{{ current.description }}</p>
              </div>
              <div
                v-if="$slots.actions"
                class="book-management-section-actions"
              >
                <slot name="actions" />
              </div>
            </header>
            <div ref="content" class="book-management-content">
              <slot />
            </div>
          </section>
        </div>
        <footer
          v-if="$slots.footer"
          class="dialog-actions book-management-footer"
        >
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style src="./book-management.css"></style>
