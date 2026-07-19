<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  open: boolean;
  sectionTitle: string;
  hasContent: boolean;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();

function handleKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === "Escape") emit("close");
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @mousedown.self="emit('close')">
      <section
        class="workspace-dialog delete-expert-section-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-expert-section-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">正文编写</span>
            <h2 id="delete-expert-section-title">删除小节</h2>
          </div>
          <button class="dialog-close" type="button" aria-label="关闭" @click="emit('close')">×</button>
        </header>

        <div class="dialog-content">
          <div class="book-remove-warning">
            <AppIcon name="trash" :size="20" />
            <div>
              <strong>确认删除“{{ sectionTitle }}”？</strong>
              <p>
                {{ hasContent ? "该小节的标题、正文和人物状态都会删除。" : "该空小节会从正文结构中删除。" }}
                删除后需点击右侧“应用”保存，此操作无法自动撤销。
              </p>
            </div>
          </div>

          <div class="dialog-actions">
            <button class="dialog-secondary-button" type="button" @click="emit('close')">取消</button>
            <button
              class="dialog-primary-button is-danger"
              type="button"
              @click="emit('confirm')"
            >
              确认删除
            </button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
