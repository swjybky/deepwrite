<script setup lang="ts">
import { deepwriteApi } from "../../api/deepwrite";
import { ref } from "vue";
import BookResourceDialog from "../../components/BookResourceDialog.vue";
import { formatError } from "../../i18n/errors";
import { useMysteryWorkspaceStore } from "../../stores/mysteryWorkspaceStore";
import type { ResourceTreeNode } from "../../types/workspace";
import { uiMessage } from "../../ui-feedback";
import { mysteryT } from "./messages";

const props = defineProps<{ node: ResourceTreeNode }>();
const emit = defineEmits<{ close: [] }>();
const pending = ref(false);
const store = useMysteryWorkspaceStore();

async function remove(): Promise<void> {
  const api = deepwriteApi()?.mystery;
  const bookId = props.node.mysteryBookId;
  if (!api || !bookId || pending.value) return;
  pending.value = true;
  try {
    await api.unregister({ bookId });
    await store.loadBooks();
    emit("close");
  } catch (error) {
    uiMessage.error(formatError(error, mysteryT("actionFailed")));
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <BookResourceDialog
    mode="remove"
    :book="node"
    :submitting="pending"
    @close="emit('close')"
    @remove="remove"
  />
</template>
