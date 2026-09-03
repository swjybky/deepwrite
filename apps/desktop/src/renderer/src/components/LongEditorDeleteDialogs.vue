<script setup lang="ts">
import type { LongNavigationDeleteTarget } from "../composables/useLongEditorDeleteDialogs";

defineProps<{
  pendingStoryPlotDelete: {
    title: string;
    description: string;
    previewPending: boolean;
    pending: boolean;
    canConfirm: boolean;
  } | null;
  pendingWorldbuildingDeleteItem: {
    title: string;
    description: string;
    previewPending: boolean;
    pending: boolean;
    expectedImpact?: unknown;
  } | null;
  navigationDeleteTarget: LongNavigationDeleteTarget | null;
  navigationDeletePending: boolean;
}>();

defineEmits<{
  cancelStoryPlotDelete: [];
  confirmStoryPlotDelete: [];
  closeWorldbuildingItemDelete: [];
  worldbuildingDeleteKeydown: [event: KeyboardEvent];
  confirmWorldbuildingItemDelete: [];
  closeNavigationDelete: [];
  navigationDeleteKeydown: [event: KeyboardEvent];
  confirmNavigationDelete: [];
}>();

const worldbuildingDeleteDialog = defineModel<HTMLElement | undefined>(
  "worldbuildingDeleteDialog"
);
const worldbuildingDeleteCancelButton = defineModel<
  HTMLButtonElement | undefined
>("worldbuildingDeleteCancelButton");
const navigationDeleteDialog = defineModel<HTMLElement | undefined>(
  "navigationDeleteDialog"
);
const navigationDeleteCancelButton = defineModel<HTMLButtonElement | undefined>(
  "navigationDeleteCancelButton"
);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="pendingStoryPlotDelete"
      class="dialog-backdrop long-worldbuilding-delete-overlay"
      @mousedown.self="$emit('cancelStoryPlotDelete')"
    >
      <section
        class="long-worldbuilding-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="long-story-plot-delete-title"
        aria-describedby="long-story-plot-delete-description"
        tabindex="-1"
      >
        <span>删除故事情节</span>
        <h3 id="long-story-plot-delete-title">
          确认删除“{{ pendingStoryPlotDelete.title }}”？
        </h3>
        <p
          id="long-story-plot-delete-description"
          class="delete-impact-description"
          tabindex="0"
        >
          {{
            pendingStoryPlotDelete.previewPending
              ? "正在核对关联关系与删除影响…"
              : pendingStoryPlotDelete.description
          }}
        </p>
        <footer>
          <button
            type="button"
            :disabled="pendingStoryPlotDelete.pending"
            @click="$emit('cancelStoryPlotDelete')"
          >
            取消
          </button>
          <button
            class="is-danger"
            type="button"
            :disabled="
              pendingStoryPlotDelete.pending ||
              pendingStoryPlotDelete.previewPending ||
              !pendingStoryPlotDelete.canConfirm
            "
            @click="$emit('confirmStoryPlotDelete')"
          >
            {{
              pendingStoryPlotDelete.pending
                ? "删除中…"
                : pendingStoryPlotDelete.previewPending
                  ? "核对中…"
                  : "确认删除"
            }}
          </button>
        </footer>
      </section>
    </div>
    <div
      v-if="pendingWorldbuildingDeleteItem"
      class="dialog-backdrop long-worldbuilding-delete-overlay"
      @mousedown.self="$emit('closeWorldbuildingItemDelete')"
      @keydown="$emit('worldbuildingDeleteKeydown', $event)"
    >
      <section
        ref="worldbuildingDeleteDialog"
        class="long-worldbuilding-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="long-worldbuilding-delete-title"
        aria-describedby="long-worldbuilding-delete-description"
        tabindex="-1"
      >
        <span>删除世界观条目</span>
        <h3 id="long-worldbuilding-delete-title">
          确认删除“{{ pendingWorldbuildingDeleteItem.title }}”？
        </h3>
        <p
          id="long-worldbuilding-delete-description"
          class="delete-impact-description"
          tabindex="0"
        >
          {{
            pendingWorldbuildingDeleteItem.previewPending
              ? "正在核对关联关系与删除影响…"
              : pendingWorldbuildingDeleteItem.description
          }}
        </p>
        <footer>
          <button
            ref="worldbuildingDeleteCancelButton"
            type="button"
            :disabled="pendingWorldbuildingDeleteItem.pending"
            @click="$emit('closeWorldbuildingItemDelete')"
          >
            取消
          </button>
          <button
            class="is-danger"
            type="button"
            :disabled="
              pendingWorldbuildingDeleteItem.pending ||
              pendingWorldbuildingDeleteItem.previewPending ||
              !pendingWorldbuildingDeleteItem.expectedImpact
            "
            @click="$emit('confirmWorldbuildingItemDelete')"
          >
            {{
              pendingWorldbuildingDeleteItem.pending
                ? "删除中…"
                : pendingWorldbuildingDeleteItem.previewPending
                  ? "核对中…"
                  : "确认删除"
            }}
          </button>
        </footer>
      </section>
    </div>
    <div
      v-if="navigationDeleteTarget"
      class="dialog-backdrop long-navigation-delete-overlay"
      @mousedown.self="$emit('closeNavigationDelete')"
      @keydown="$emit('navigationDeleteKeydown', $event)"
    >
      <section
        ref="navigationDeleteDialog"
        class="long-navigation-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="long-navigation-delete-title"
        aria-describedby="long-navigation-delete-description"
        tabindex="-1"
      >
        <span>删除{{ navigationDeleteTarget.label }}</span>
        <h3 id="long-navigation-delete-title">
          确认删除“{{ navigationDeleteTarget.title }}”？
        </h3>
        <p
          id="long-navigation-delete-description"
          class="delete-impact-description"
          tabindex="0"
        >
          {{
            navigationDeleteTarget.previewPending
              ? "正在核对关联关系与删除影响…"
              : navigationDeleteTarget.description
          }}
        </p>
        <footer>
          <button
            ref="navigationDeleteCancelButton"
            type="button"
            :disabled="
              navigationDeletePending || navigationDeleteTarget.previewPending
            "
            @click="$emit('closeNavigationDelete')"
          >
            取消
          </button>
          <button
            class="is-danger"
            type="button"
            :disabled="
              navigationDeletePending ||
              navigationDeleteTarget.previewPending ||
              !navigationDeleteTarget.expectedImpact
            "
            @click="$emit('confirmNavigationDelete')"
          >
            {{
              navigationDeletePending
                ? "删除中…"
                : navigationDeleteTarget.previewPending
                  ? "核对中…"
                  : "确认删除"
            }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.long-worldbuilding-delete-overlay,
.long-navigation-delete-overlay {
  z-index: 2400;
  padding: 20px;
}

.long-worldbuilding-delete-dialog,
.long-navigation-delete-dialog {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  width: min(420px, calc(100vw - 32px));
  height: min(420px, calc(100vh - 40px));
  padding: 20px;
  overflow: hidden;
  border: 1px solid var(--theme-line);
  border-radius: 14px;
  background: var(--surface-raised);
  box-shadow: 0 20px 60px
    color-mix(in srgb, var(--text-primary) 22%, transparent);
  color: var(--text-primary);
}

.long-worldbuilding-delete-dialog > span,
.long-navigation-delete-dialog > span {
  color: var(--text-tertiary);
  font-size: 0.714286rem;
}

.long-worldbuilding-delete-dialog h3,
.long-navigation-delete-dialog h3 {
  margin: 6px 0 0;
  font-size: 1.071429rem;
}

.long-worldbuilding-delete-dialog p,
.long-navigation-delete-dialog p {
  min-height: 0;
  margin: 12px 0 0;
  color: var(--text-secondary);
  font-size: 0.785714rem;
  line-height: 1.6;
}

.long-worldbuilding-delete-dialog .delete-impact-description,
.long-navigation-delete-dialog .delete-impact-description {
  padding-right: 8px;
  overflow-y: auto;
  overflow-wrap: anywhere;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.long-worldbuilding-delete-dialog footer,
.long-navigation-delete-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}

.long-worldbuilding-delete-dialog button,
.long-navigation-delete-dialog button {
  min-height: 32px;
  padding: 6px 11px;
  border: 1px solid var(--theme-line);
  border-radius: 7px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  cursor: pointer;
}

.long-worldbuilding-delete-dialog button:hover,
.long-navigation-delete-dialog button:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-worldbuilding-delete-dialog button.is-danger,
.long-navigation-delete-dialog button.is-danger {
  border-color: transparent;
  background: var(--danger);
  color: #ffffff;
}
</style>
