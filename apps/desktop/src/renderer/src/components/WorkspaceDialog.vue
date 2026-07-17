<script setup lang="ts">
import { ref, watch } from "vue";
import type { DialogMode } from "../types/workspace";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{ mode: DialogMode | null }>();
const emit = defineEmits<{
  close: [];
  seedPrompt: [value: string];
}>();

const imitationSample = ref("");

watch(
  () => props.mode,
  (mode) => {
    if (mode !== "imitation") {
      imitationSample.value = "";
    }
  }
);

function addImitationContext(): void {
  const sample = imitationSample.value.trim();
  emit(
    "seedPrompt",
    sample
      ? `请分析下面文字的语言风格，并在不复用原句的前提下仿写：\n\n${sample}`
      : "请分析一段参考文字的语言风格，并建立可复用的仿写规则。"
  );
}
</script>

<template>
  <Teleport to="body">
    <div v-if="mode" class="dialog-backdrop" @mousedown.self="emit('close')">
      <section class="workspace-dialog" role="dialog" aria-modal="true">
        <header>
          <div>
            <span class="dialog-eyebrow">DeepWrite</span>
            <h2>
              {{
                mode === "directory"
                  ? "工作目录"
                  : mode === "models"
                    ? "模型配置"
                    : mode === "imitation"
                      ? "学习仿写"
                      : "更多功能"
              }}
            </h2>
          </div>
          <button class="dialog-close" type="button" aria-label="关闭" @click="emit('close')">×</button>
        </header>

        <div v-if="mode === 'directory'" class="dialog-content">
          <p class="dialog-description">新客户端已为旧项目迁移预留独立工作目录边界。</p>
          <div class="directory-card">
            <AppIcon name="directory" :size="20" />
            <div>
              <strong>当前迁移来源</strong>
              <code>/home/swj/project/swj/yonquan-write/write-claw</code>
            </div>
            <span>已识别</span>
          </div>
          <div class="dialog-note">第一阶段仅建立界面与进程边界，不读取或改写旧项目数据。</div>
        </div>

        <div v-else-if="mode === 'models'" class="dialog-content">
          <p class="dialog-description">本地 Faux 已接入 Pi Agent 流式链路；真实模型、安全存储和连通性测试将在下一切片接入。</p>
          <div class="model-card is-default">
            <span class="model-logo">F</span>
            <div><strong>DeepWrite Faux</strong><small>local · deepwrite-writing-faux · 无需密钥</small></div>
            <span class="model-status"><i />默认</span>
          </div>
          <div class="model-card">
            <span class="model-logo is-neutral">C</span>
            <div><strong>Claude Sonnet</strong><small>anthropic · 尚未配置密钥</small></div>
            <span class="model-status is-muted">待配置</span>
          </div>
          <button class="dialog-secondary-button" type="button"><AppIcon name="plus" :size="15" />添加模型</button>
        </div>

        <div v-else-if="mode === 'imitation'" class="dialog-content">
          <p class="dialog-description">粘贴参考文字，把风格分析任务发送到中间智能体对话。</p>
          <textarea v-model="imitationSample" rows="8" placeholder="在这里粘贴参考文本……" />
          <div class="dialog-actions">
            <button class="dialog-secondary-button" type="button" @click="emit('close')">取消</button>
            <button class="dialog-primary-button" type="button" @click="addImitationContext">
              <AppIcon name="wand" :size="15" />添加到对话
            </button>
          </div>
        </div>

        <div v-else class="dialog-content feature-grid">
          <button type="button"><AppIcon name="history" :size="19" /><strong>版本历史</strong><span>查看文稿修改记录</span></button>
          <button type="button"><AppIcon name="search" :size="19" /><strong>全局检索</strong><span>搜索创作空间内容</span></button>
          <button type="button"><AppIcon name="archive" :size="19" /><strong>导入与导出</strong><span>迁移旧项目和文稿</span></button>
          <button type="button"><AppIcon name="model" :size="19" /><strong>运行设置</strong><span>智能体与工具边界</span></button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
