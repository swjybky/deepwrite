<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
const props = defineProps<{
  content: string;
  entryId: string;
  readOnly: boolean;
  label: string;
  hint: string;
  optional: boolean;
  initialName: string;
  initialDescription: string;
  placeholder: string;
  preview: {
    title: string;
    name: string;
    nameSource: string;
    description: string;
    descriptionSource: string;
  };
  applyMetadata: (values: { name: string; description: string }) => boolean;
}>();
const open = ref(false);
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const nameInput = ref<HTMLInputElement>();
const name = ref("");
const description = ref("");
const top = ref(8);
const left = ref(8);
function position(): void {
  if (!open.value || !trigger.value) return;
  const rect = trigger.value.getBoundingClientRect();
  left.value = Math.max(8, Math.min(rect.right - 380, window.innerWidth - 388));
  top.value = Math.max(
    8,
    Math.min(
      rect.bottom + 6,
      window.innerHeight - (panel.value?.offsetHeight ?? 360) - 8
    )
  );
}

function close(returnFocus = false): void {
  open.value = false;
  if (returnFocus) void nextTick(() => trigger.value?.focus());
}

async function toggle(): Promise<void> {
  if (open.value) return close();
  name.value = props.initialName;
  description.value = props.initialDescription;
  open.value = true;
  await nextTick();
  position();
  nameInput.value?.focus();
}

function apply(): void {
  if (props.readOnly) return;
  if (props.applyMetadata({ name: name.value, description: description.value }))
    close(true);
}

function outside(event: PointerEvent): void {
  if (
    event.target instanceof Node &&
    !panel.value?.contains(event.target) &&
    !trigger.value?.contains(event.target)
  )
    close();
}

watch(
  () => [
    props.entryId,
    props.content,
    props.initialName,
    props.initialDescription
  ],
  () => close()
);
onMounted(() => {
  document.addEventListener("pointerdown", outside);
  window.addEventListener("resize", position);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside);
  window.removeEventListener("resize", position);
});
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="library-metadata-trigger"
    aria-haspopup="dialog"
    :aria-expanded="open"
    @click="toggle"
    @keydown.esc.stop="close(true)"
  >
    {{ label }}
  </button>
  <Teleport to="body">
    <section
      v-if="open"
      ref="panel"
      class="library-metadata-panel"
      :style="{ top: `${top}px`, left: `${left}px` }"
      role="dialog"
      :aria-label="label"
      @keydown.esc.stop.prevent="close(true)"
    >
      <header>
        <strong>{{ label }}</strong
        ><button
          type="button"
          :aria-label="`关闭${label}`"
          @click="close(true)"
        >
          关闭
        </button>
      </header>
      <p>{{ hint }}</p>
      <form @submit.prevent="apply">
        <label
          >名称（{{ optional ? "可选" : "必填" }}）<input
            ref="nameInput"
            v-model="name"
            :aria-label="`${label}名称`"
            :aria-required="!optional"
            :readonly="readOnly"
        /></label>
        <label
          >使用说明（{{ optional ? "可选" : "必填" }}）<textarea
            v-model="description"
            rows="3"
            :aria-label="`${label}使用说明`"
            :aria-required="!optional"
            :placeholder="placeholder"
            :readonly="readOnly"
          />
        </label>
        <div class="library-metadata-preview">
          <span>{{ preview.title }}</span>
          <strong>{{ preview.name }}</strong>
          <span>{{ preview.nameSource }}</span>
          <p>{{ preview.description }}</p>
          <span>{{ preview.descriptionSource }}</span>
        </div>
        <footer>
          <button type="button" @click="close(true)">取消</button
          ><button
            class="library-metadata-submit"
            type="submit"
            :disabled="readOnly"
          >
            添加名称与说明
          </button>
        </footer>
      </form>
    </section>
  </Teleport>
</template>

<style scoped>
.library-metadata-trigger {
  border: 1px solid var(--theme-line-soft);
  border-radius: 7px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  padding: 4px 8px;
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.library-metadata-panel {
  position: fixed;
  z-index: 1500;
  width: min(380px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
  overflow: auto;
  box-sizing: border-box;
  border: 1px solid var(--theme-line);
  border-radius: 12px;
  padding: 16px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font-size: 0.928571rem;
  box-shadow: 0 12px 36px #0002;
}
header,
footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
header button,
footer > button:not(.library-metadata-submit) {
  border: 0;
  border-radius: 7px;
  padding: 6px 10px;
  background: var(--surface-muted);
  color: var(--text-secondary);
  font: inherit;
  cursor: pointer;
}
p {
  color: var(--text-secondary);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
form,
label,
.library-metadata-preview {
  display: grid;
  gap: 8px;
}
form {
  gap: 14px;
}
input,
textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  color: var(--text-primary);
  background: var(--surface-main);
  font: inherit;
}
textarea {
  resize: vertical;
}
input:focus-visible,
textarea:focus-visible,
button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.library-metadata-preview {
  border: 1px solid var(--theme-line-soft);
  border-radius: 8px;
  padding: 10px;
  background: var(--surface-muted);
  overflow-wrap: anywhere;
}
.library-metadata-preview span {
  color: var(--text-tertiary);
  font-size: 0.857143rem;
}
.library-metadata-preview p {
  margin: 0;
}
.library-metadata-submit {
  min-height: 32px;
  height: auto;
  padding: 6px 12px;
  border: 1px solid var(--theme-line);
  border-radius: 7px;
  background: var(--neutral-solid);
  color: #fff;
  font: inherit;
  cursor: pointer;
}
:global(
  html[data-theme="dark"] .library-metadata-panel .library-metadata-submit
) {
  background: var(--surface-selected);
  color: var(--text-primary);
}
.library-metadata-submit:hover {
  filter: brightness(0.95);
}
.library-metadata-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
footer {
  justify-content: flex-end;
  flex-wrap: wrap;
}
</style>
