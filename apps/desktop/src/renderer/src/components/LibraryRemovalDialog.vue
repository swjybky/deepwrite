<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import AppIcon from "./AppIcon.vue";

const props = withDefaults(defineProps<{
  open: boolean;
  action: "remove" | "delete";
  domain: "material" | "skill";
  label: string;
  submitting?: boolean;
}>(), {
  submitting: false
});

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();

const resourceName = computed(() =>
  props.domain === "material" ? "素材库" : "技能库"
);

function requestClose(): void {
  if (!props.submitting) emit("close");
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === "Escape") requestClose();
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @mousedown.self="requestClose">
      <section
        class="workspace-dialog book-resource-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-removal-dialog-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{ label }}</span>
            <h2 id="library-removal-dialog-title">
              {{ action === "delete" ? "删除" : "移除" }}{{ resourceName }}
            </h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            aria-label="关闭"
            :disabled="submitting"
            @click="requestClose"
          >×</button>
        </header>

        <form class="dialog-content" @submit.prevent="emit('confirm')">
          <div class="book-remove-warning">
            <AppIcon name="trash" :size="20" />
            <div>
              <strong>确认{{ action === "delete" ? "删除" : "移除" }}“{{ label }}”？</strong>
              <p v-if="action === 'delete'">
                会从当前{{ resourceName }}列表移除，并永久删除本地项目文件夹及其中所有文件。此操作无法撤销。
              </p>
              <p v-else>
                只会从当前{{ resourceName }}列表解除注册，不会删除本地文件夹；之后可通过“打开已存在{{ resourceName }}”恢复。
              </p>
            </div>
          </div>

          <div class="dialog-actions">
            <button class="dialog-secondary-button" type="button" :disabled="submitting" @click="requestClose">
              取消
            </button>
            <button class="dialog-primary-button is-danger" type="submit" :disabled="submitting">
              {{ submitting ? "处理中…" : action === "delete" ? "确认删除" : "确认移除" }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>
