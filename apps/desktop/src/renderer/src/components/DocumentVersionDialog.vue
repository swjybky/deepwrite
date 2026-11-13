<script setup lang="ts">
import type {
  DocumentVersionTarget,
  RestoreDocumentVersionResult
} from "@deepwrite/contracts";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import { createScopedTranslator, locale, t as translate } from "../i18n";
import { useDocumentVersionHistory } from "../composables/useDocumentVersionHistory";
import AgentEditProposalDiff from "./AgentEditProposalDiff.vue";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator("components.documentVersions");
const props = defineProps<{
  target: DocumentVersionTarget;
  title: string;
  currentContent: string;
  busy: boolean;
  restoreDisabledReason?: string;
  unsaved: boolean;
  autoSave: boolean;
  prepareRestore(): Promise<boolean>;
  applyRestore(result: RestoreDocumentVersionResult): Promise<void> | void;
}>();
const emit = defineEmits<{
  close: [];
  restored: [result: RestoreDocumentVersionResult];
}>();
const dialog = ref<HTMLElement>();
const confirmation = ref<HTMLElement>();
const mode = ref<"diff" | "full">("diff");
const history = useDocumentVersionHistory({
  target: () => props.target,
  content: () => props.currentContent,
  busy: () => props.busy,
  restoreDisabledReason: () => props.restoreDisabledReason ?? "",
  unsaved: () => props.unsaved,
  autoSave: () => props.autoSave,
  prepareRestore: () => props.prepareRestore(),
  async restored(result) {
    await props.applyRestore(result);
    emit("restored", result);
  },
  close: () => emit("close")
});
const {
  versions,
  selectedId,
  selected,
  displayedContent,
  hasComparison,
  diff,
  currentChanged,
  loading,
  restoring,
  confirming,
  blockedReason,
  canRestore,
  select,
  restore,
  label
} = history;
const titleLabel = computed(() =>
  translate("components.editorTextTools.versions")
);
const closeLabel = computed(() =>
  translate("components.editorFindReplacePanel.close")
);
const cancelLabel = computed(() =>
  translate("components.longBookRemovalDialog.cancel")
);
const versionTime = (value: string) =>
  new Date(value).toLocaleString(locale.value, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
let previousFocus: HTMLElement | null = null;

function close(): void {
  if (!restoring.value) emit("close");
}
function keydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    if (confirming.value) {
      if (!restoring.value) confirming.value = false;
    } else close();
    return;
  }
  if (event.key !== "Tab") return;
  const root = confirming.value ? confirmation.value : dialog.value;
  const controls = Array.from(
    root?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [tabindex="0"]'
    ) ?? []
  );
  const first = controls[0];
  const last = controls.at(-1);
  if (
    first &&
    (event.shiftKey
      ? document.activeElement === first
      : document.activeElement === last)
  ) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  }
}
watch(confirming, async (open) => {
  await nextTick();
  (open ? confirmation.value : dialog.value)
    ?.querySelector<HTMLButtonElement>("button")
    ?.focus();
});
onMounted(() => {
  previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  dialog.value?.querySelector<HTMLButtonElement>("button")?.focus();
  void history.refresh();
});
onBeforeUnmount(() => {
  if (previousFocus?.isConnected) previousFocus.focus();
});
</script>

<template>
  <Teleport to="body">
    <div
      class="dialog-backdrop document-version-backdrop"
      @mousedown.self="close"
      @keydown="keydown"
    >
      <section
        ref="dialog"
        class="workspace-dialog document-version-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-version-title"
        :inert="confirming"
      >
        <header>
          <h2 id="document-version-title" :title="`${titleLabel} · ${title}`">
            {{ titleLabel }} · {{ title }}
          </h2>
          <button
            type="button"
            class="dialog-close"
            :aria-label="closeLabel"
            @click="close"
          >
            <AppIcon name="close" :size="16" />
          </button>
        </header>
        <div class="document-version-body">
          <nav class="document-version-list" :aria-label="titleLabel">
            <button
              type="button"
              :class="{ 'is-selected': selectedId === null }"
              :aria-current="selectedId === null ? 'true' : undefined"
              @click="select(null)"
            >
              <strong>{{ t("current") }}</strong>
              <small v-if="currentChanged">{{ t("changed") }}</small>
            </button>
            <p v-if="!versions.length" class="document-version-empty">
              {{ t("empty") }}
            </p>
            <button
              v-for="(version, index) in versions"
              :key="version.id"
              type="button"
              :class="{ 'is-selected': selectedId === version.id }"
              :aria-current="selectedId === version.id ? 'true' : undefined"
              @click="select(version.id)"
            >
              <strong>v{{ version.seq }} {{ label(version) }}</strong>
              <time :datetime="version.updatedAt">{{
                versionTime(version.updatedAt)
              }}</time>
              <small
                v-if="version.origin"
                class="document-version-summary"
                :title="version.origin.summary"
                >{{ version.origin.summary }}</small
              >
              <small
                >{{
                  version.charCount - (versions[index + 1]?.charCount ?? 0) >= 0
                    ? "+"
                    : ""
                }}{{
                  version.charCount - (versions[index + 1]?.charCount ?? 0)
                }}
                {{
                  translate("components.catalogEditorFooterMeta.characters")
                }}</small
              >
            </button>
          </nav>
          <div class="document-version-content" :aria-busy="loading">
            <div
              class="document-version-modes"
              role="group"
              :aria-label="titleLabel"
            >
              <button
                type="button"
                :aria-pressed="mode === 'diff'"
                @click="mode = 'diff'"
              >
                {{ t("compare") }}
              </button>
              <button
                type="button"
                :aria-pressed="mode === 'full'"
                @click="mode = 'full'"
              >
                {{ t("full") }}
              </button>
            </div>
            <div class="document-version-text">
              <AgentEditProposalDiff
                v-if="mode === 'diff' && hasComparison"
                :proposal="diff"
                inline
              />
              <p
                v-else-if="mode === 'diff' && !loading"
                class="document-version-empty"
              >
                {{ versions.length ? t("unavailable") : t("noComparison") }}
              </p>
              <pre v-else-if="mode === 'full'">{{ displayedContent }}</pre>
            </div>
          </div>
        </div>
        <footer class="dialog-actions">
          <small>{{ t("local") }}</small>
          <button type="button" class="dialog-secondary-button" @click="close">
            {{ closeLabel }}
          </button>
          <span :title="blockedReason"
            ><button
              type="button"
              class="dialog-primary-button"
              :disabled="!canRestore"
              @click="confirming = true"
            >
              {{ t("restore") }}
            </button></span
          >
        </footer>
      </section>
    </div>
    <div
      v-if="confirming"
      class="dialog-backdrop document-version-confirm"
      @keydown="keydown"
      @mousedown.self="!restoring && (confirming = false)"
    >
      <section
        ref="confirmation"
        class="workspace-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="document-version-confirm-title"
        aria-describedby="document-version-confirm-description"
      >
        <header>
          <h2 id="document-version-confirm-title">
            {{ t("confirm", { seq: selected?.seq ?? "" }) }}
          </h2>
        </header>
        <div class="dialog-content">
          <p
            id="document-version-confirm-description"
            class="dialog-description"
          >
            {{ t("detail") }}
          </p>
        </div>
        <footer class="dialog-actions">
          <button
            type="button"
            class="dialog-secondary-button"
            :disabled="restoring"
            @click="confirming = false"
          >
            {{ cancelLabel }}
          </button>
          <button
            type="button"
            class="dialog-primary-button"
            :disabled="restoring || !canRestore"
            @click="restore"
          >
            {{ t("action") }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="./document-version-dialog.css"></style>
