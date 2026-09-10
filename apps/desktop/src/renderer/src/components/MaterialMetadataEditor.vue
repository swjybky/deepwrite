<script setup lang="ts">
import { computed } from "vue";
import {
  parseMaterialMarkdown,
  resolveMaterialMetadata,
  updateMaterialMarkdownMetadata
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
const parsed = computed(() => parseMaterialMarkdown(props.content));
const effective = computed(() =>
  resolveMaterialMetadata({
    id: props.entryId,
    title: props.title,
    content: props.content
  })
);
const preview = computed(() => ({
  title: "当前智能体目录",
  name: effective.value.name,
  nameSource:
    effective.value.nameSource === "configured" ? "使用配置名称" : "使用原标题",
  description: effective.value.description,
  descriptionSource:
    effective.value.descriptionSource === "configured"
      ? "使用配置说明"
      : effective.value.descriptionSource === "excerpt"
        ? "使用正文摘录"
        : "可按需读取原文"
}));
function applyMetadata(values: { name: string; description: string }): boolean {
  if (props.readOnly) return false;
  const result = updateMaterialMarkdownMetadata(props.content, values);
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
    label="素材说明"
    hint="建议添加名称和使用说明，帮助智能体更准确地选择素材。不填写也可以正常使用。"
    :optional="true"
    :initial-name="parsed.name ?? title"
    :initial-description="parsed.description ?? ''"
    placeholder="例如：适合悬疑故事，在人物关系设计和身份揭露时参考。"
    :preview="preview"
    :apply-metadata="applyMetadata"
  />
</template>
