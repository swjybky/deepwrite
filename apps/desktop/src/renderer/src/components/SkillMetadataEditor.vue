<script setup lang="ts">
import { computed } from "vue";
import {
  parseSkillMarkdown,
  readSkillMarkdownMetadata,
  updateSkillMarkdownMetadata
} from "@deepwrite/contracts/renderer";
import { uiMessage } from "../ui-feedback";
import LibraryMetadataPopover from "./LibraryMetadataPopover.vue";

const props = defineProps<{
  content: string;
  title: string;
  entryId: string;
  readOnly: boolean;
}>();
const emit = defineEmits<{ change: [content: string] }>();
const fields = computed(() => readSkillMarkdownMetadata(props.content));
const preview = computed(() => ({
  title: parseSkillMarkdown(props.content).valid
    ? "当前智能体目录"
    : "当前技能说明",
  name: fields.value.name || "尚未填写名称",
  nameSource: fields.value.name ? "使用配置名称" : "需要填写名称",
  description: fields.value.description || "尚未填写使用说明",
  descriptionSource: fields.value.description
    ? "使用配置说明"
    : "需要填写使用说明"
}));
function applyMetadata(values: { name: string; description: string }): boolean {
  if (props.readOnly) return false;
  const result = updateSkillMarkdownMetadata(props.content, values);
  if (!result.updated) {
    uiMessage.info(result.message);
    return false;
  }
  emit("change", result.content);
  return true;
}
</script>

<template>
  <LibraryMetadataPopover
    :content="content"
    :entry-id="entryId"
    :read-only="readOnly"
    label="技能说明"
    hint="填写名称和使用说明，帮助智能体识别技能及其适用场景。技能还需要正文才可使用。"
    :optional="false"
    :initial-name="fields.name ?? title"
    :initial-description="fields.description ?? ''"
    placeholder="例如：在设计人物关系时使用，检查人物动机、关系冲突和成长变化。"
    :preview="preview"
    :apply-metadata="applyMetadata"
  />
</template>
