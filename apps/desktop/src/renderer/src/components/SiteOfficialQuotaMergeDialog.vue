<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{ pending: boolean }>();
const sourceKey = defineModel<string>("sourceKey", { required: true });
const emit = defineEmits<{ close: []; submit: [] }>();
const form = ref<HTMLFormElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
let previousFocus: HTMLElement | null = null;

function close(): void {
  if (!props.pending) emit("close");
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    close();
  }
  if (event.key === "Tab") {
    const elements = Array.from(
      form.value?.querySelectorAll<HTMLElement>(
        "input:not(:disabled), button:not(:disabled)"
      ) ?? []
    );
    const first = elements[0];
    const last = elements.at(-1);
    if (!first || !last) {
      event.preventDefault();
      form.value?.focus();
      return;
    }
    if (!form.value?.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

watch(
  () => props.pending,
  async (pending) => {
    await nextTick();
    if (pending) form.value?.focus();
    else input.value?.focus();
  }
);

onMounted(() => {
  document.addEventListener("keydown", onKeydown, true);
  previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  input.value?.focus();
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown, true);
  sourceKey.value = "";
  previousFocus?.focus();
});
</script>

<template>
  <Teleport to="body">
    <div
      class="dialog-backdrop site-quota-merge-backdrop"
      @mousedown.self="close"
    >
      <form
        ref="form"
        tabindex="-1"
        class="workspace-dialog site-quota-merge-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="site-quota-merge-title"
        aria-describedby="site-quota-merge-description"
        :aria-busy="pending"
        @submit.prevent="emit('submit')"
      >
        <header>
          <h2 id="site-quota-merge-title">增加额度</h2>
          <button
            type="button"
            class="dialog-close"
            aria-label="关闭"
            :disabled="pending"
            @click="close"
          >
            ×
          </button>
        </header>
        <div class="dialog-content">
          <p id="site-quota-merge-description">
            来源 Key
            的全部未使用额度将转入当前已保存的密钥。当前密钥和有效期保持不变。转入成功后，来源
            Key 将永久注销，无法再使用或再次转入。
          </p>
          <label for="site-quota-source-key">来源 Key</label>
          <input
            id="site-quota-source-key"
            ref="input"
            v-model="sourceKey"
            type="password"
            autocomplete="new-password"
            :spellcheck="false"
            :maxlength="1024"
            placeholder="请输入提供额度的来源 Key"
            :disabled="pending"
          />
          <small>来源 Key 仅用于本次转入，不会保存到本机。</small>
        </div>
        <footer>
          <button type="button" :disabled="pending" @click="close">取消</button>
          <button class="is-danger" type="submit" :disabled="pending">
            {{ pending ? "正在转入…" : "转入额度并注销来源 Key" }}
          </button>
        </footer>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.site-quota-merge-backdrop {
  z-index: 1200;
  padding: 16px;
}
.site-quota-merge-dialog {
  width: min(480px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  border: 1px solid var(--theme-line);
  background: var(--surface-main);
  color: var(--text-primary);
  font-size: 1rem;
}
h2 {
  font-size: 1.2rem;
}
.dialog-content {
  display: grid;
  gap: 12px;
}
p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.7;
}
label {
  color: var(--text-primary);
}
small {
  color: var(--text-tertiary);
  line-height: 1.6;
}
input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 40px;
  padding: 10px 12px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
}
input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
footer {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 20px;
}
footer button {
  min-height: 38px;
  padding: 8px 12px;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
}
footer .is-danger {
  background: var(--danger);
  border-color: var(--danger);
  color: var(--on-danger, white);
}
button:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
