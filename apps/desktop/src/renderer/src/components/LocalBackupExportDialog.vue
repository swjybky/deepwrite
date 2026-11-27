<script setup lang="ts">
import { formatBytes } from "@deepwrite/shared";
import { nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import type { LocalBackupInventoryItem } from "@deepwrite/contracts";
import { createScopedTranslator } from "../i18n";

const props = defineProps<{
  open: boolean;
  loading: boolean;
  exporting: boolean;
  groups: {
    works: LocalBackupInventoryItem[];
    materials: LocalBackupInventoryItem[];
    skills: LocalBackupInventoryItem[];
  };
  selectedKeys: string[];
  selectedBytes: number;
  missingLinkedTitles: string[];
  dependencyLabelsFor: (item: LocalBackupInventoryItem) => string[];
}>();

const emit = defineEmits<{
  close: [];
  "update:selectedKeys": [keys: string[]];
  toggleGroup: [keys: string[], checked: boolean];
  submit: [];
  cancelExport: [];
}>();

const t = createScopedTranslator("components.storageSettingsPanel");
const titleId = useId();
const panel = ref<HTMLElement>();
let previousFocus: HTMLElement | undefined;

function restoreFocus(): void {
  const target = previousFocus;
  previousFocus = undefined;
  void nextTick(() => target?.focus({ preventScroll: true }));
}

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      restoreFocus();
      return;
    }
    if (document.activeElement instanceof HTMLElement) {
      previousFocus = document.activeElement;
    }
    await nextTick();
    panel.value?.focus({ preventScroll: true });
  },
  { immediate: true }
);
onBeforeUnmount(restoreFocus);

function toggleOne(key: string, event: Event): void {
  const { checked } = event.target as HTMLInputElement;
  emit(
    "update:selectedKeys",
    checked
      ? [...new Set([...props.selectedKeys, key])]
      : props.selectedKeys.filter((item) => item !== key)
  );
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="dialog-backdrop export-dialog-backdrop"
      @mousedown.self="!exporting && emit('close')"
    >
      <section
        ref="panel"
        class="workspace-dialog local-backup-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
        @keydown.esc.stop.prevent="!exporting && emit('close')"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{ t("backupSectionTitle") }}</span>
            <h2 :id="titleId">{{ t("exportTitle") }}</h2>
          </div>
          <button
            type="button"
            class="dialog-close"
            :aria-label="t('close')"
            :disabled="exporting"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div class="dialog-content local-backup-dialog-body">
          <p v-if="loading" class="storage-note">{{ t("reading") }}</p>
          <p
            v-else-if="
              !groups.works.length &&
              !groups.materials.length &&
              !groups.skills.length
            "
            class="storage-note"
          >
            {{ t("emptyInventory") }}
          </p>
          <template v-else>
            <div
              v-if="missingLinkedTitles.length"
              class="local-backup-banner is-warn"
            >
              {{
                t("missingDepWarn", {
                  list: missingLinkedTitles.join("、")
                })
              }}
            </div>

            <section
              v-for="section in [
                { id: 'works', label: t('groupWorks'), items: groups.works },
                {
                  id: 'materials',
                  label: t('groupMaterials'),
                  items: groups.materials
                },
                { id: 'skills', label: t('groupSkills'), items: groups.skills }
              ]"
              :key="section.id"
              class="local-backup-group"
            >
              <template v-if="section.items.length">
                <div class="local-backup-group-head">
                  <h3>{{ section.label }}（{{ section.items.length }}）</h3>
                  <div class="local-backup-group-actions">
                    <button
                      type="button"
                      class="storage-refresh"
                      :disabled="exporting"
                      @click="
                        emit(
                          'toggleGroup',
                          section.items.map((item) => item.key),
                          true
                        )
                      "
                    >
                      {{ t("selectAll") }}
                    </button>
                    <button
                      type="button"
                      class="storage-refresh"
                      :disabled="exporting"
                      @click="
                        emit(
                          'toggleGroup',
                          section.items.map((item) => item.key),
                          false
                        )
                      "
                    >
                      {{ t("clearAll") }}
                    </button>
                  </div>
                </div>
                <ul class="local-backup-list">
                  <li
                    v-for="item in section.items"
                    :key="item.key"
                    class="local-backup-row"
                  >
                    <label class="local-backup-check">
                      <input
                        type="checkbox"
                        :checked="selectedKeys.includes(item.key)"
                        :disabled="exporting"
                        @change="toggleOne(item.key, $event)"
                      />
                      <span class="local-backup-row-text">
                        <strong>
                          {{ item.title }}
                          <em v-if="item.empty" class="local-backup-tag">{{
                            t("emptyTag")
                          }}</em>
                          <em v-if="item.isUnbound" class="local-backup-tag">{{
                            t("unboundTag")
                          }}</em>
                        </strong>
                        <small>
                          {{ formatBytes(item.sizeBytes) }}
                          <template v-if="dependencyLabelsFor(item).length">
                            ·
                            {{
                              t("depHint", {
                                list: dependencyLabelsFor(item).join("、")
                              })
                            }}
                          </template>
                        </small>
                      </span>
                    </label>
                  </li>
                </ul>
              </template>
            </section>
          </template>
        </div>

        <footer class="export-dialog-footer">
          <span class="export-dialog-summary">
            {{
              t("selectedStats", {
                count: String(selectedKeys.length),
                size: formatBytes(selectedBytes)
              })
            }}
          </span>
          <div class="dialog-actions">
            <button
              v-if="exporting"
              type="button"
              class="dialog-secondary-button"
              @click="emit('cancelExport')"
            >
              {{ t("cancelExport") }}
            </button>
            <button
              v-else
              type="button"
              class="dialog-secondary-button"
              @click="emit('close')"
            >
              {{ t("cancel") }}
            </button>
            <button
              type="button"
              class="dialog-primary-button"
              :disabled="loading || exporting || !selectedKeys.length"
              @click="emit('submit')"
            >
              {{ exporting ? t("exporting") : t("exportStart") }}
            </button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="./storage-settings.css"></style>
