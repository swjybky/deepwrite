<script setup lang="ts">
import {
  DEFAULT_LIBRARY_AGENT_PROFILES,
  type LibraryAgentDomain,
  type LibraryAgentSettings,
  type LibraryAgentSettingsInput
} from "@deepwrite/contracts";
import { computed, ref, watch } from "vue";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  domain: LibraryAgentDomain;
  settings: LibraryAgentSettings | null;
  loading: boolean;
  saving: boolean;
  runtimeAvailable: boolean;
}>();

const emit = defineEmits<{
  save: [settings: LibraryAgentSettingsInput];
  reset: [domain: LibraryAgentDomain];
}>();

const DOMAIN_COPY = {
  skill: {
    eyebrow: "技能库",
    title: "技能库管理智能体",
    description: "配置技能库管理智能体的职责、工作流程和内容质量要求。",
    saveLabel: "保存技能库配置"
  },
  material: {
    eyebrow: "素材库",
    title: "素材库管理智能体",
    description: "配置素材库管理智能体的职责、工作流程和内容质量要求。",
    saveLabel: "保存素材库配置"
  }
} as const satisfies Record<
  LibraryAgentDomain,
  {
    eyebrow: string;
    title: string;
    description: string;
    saveLabel: string;
  }
>;

const TOOL_CAPABILITIES = {
  skill: [
    { label: "读取", description: "按条目 ID 或标题读取当前技能库中的技能正文。" },
    { label: "搜索", description: "在当前技能库的标题和正文中按关键词搜索。" },
    { label: "写入", description: "在可写技能库中创建条目或写入完整技能内容。" },
    { label: "编辑", description: "读取原文后，对已有技能条目执行受版本保护的局部修改。" }
  ],
  material: [
    { label: "读取", description: "按条目 ID 或标题读取当前素材库中的素材正文。" },
    { label: "搜索", description: "在当前素材库的标题和正文中按关键词搜索。" },
    { label: "写入", description: "在可写素材库中创建条目或写入完整素材内容。" },
    { label: "编辑", description: "读取原文后，对已有素材条目执行受版本保护的局部修改。" }
  ]
} as const satisfies Record<
  LibraryAgentDomain,
  readonly { label: string; description: string }[]
>;

const draftSystemPrompt = ref("");

const activeProfile = computed(() =>
  props.settings?.agents.find((profile) => profile.domain === props.domain)
);

const fallbackProfile = computed(() =>
  DEFAULT_LIBRARY_AGENT_PROFILES.find((profile) => profile.domain === props.domain)
);

const displayProfile = computed(() => activeProfile.value ?? fallbackProfile.value);
const domainCopy = computed(() => DOMAIN_COPY[props.domain]);
const toolCapabilities = computed(() => TOOL_CAPABILITIES[props.domain]);
const formDisabled = computed(
  () => props.loading || props.saving || !props.runtimeAvailable
);
const hasUnsavedChanges = computed(
  () => draftSystemPrompt.value !== activeProfile.value?.systemPrompt
);

watch(
  [() => props.settings, () => props.domain],
  () => {
    draftSystemPrompt.value = activeProfile.value?.systemPrompt ?? "";
  },
  { immediate: true, deep: true }
);

function updateSystemPrompt(event: Event): void {
  if (formDisabled.value) return;
  draftSystemPrompt.value = (event.target as HTMLTextAreaElement).value;
}

function saveSettings(): void {
  if (formDisabled.value || !props.settings || !activeProfile.value) return;
  if (!draftSystemPrompt.value.trim()) {
    uiMessage.warning(`${domainCopy.value.title}的系统提示词不能为空`);
    return;
  }

  emit("save", {
    agents: props.settings.agents.map((profile) => ({
      domain: profile.domain,
      systemPrompt:
        profile.domain === props.domain
          ? draftSystemPrompt.value
          : profile.systemPrompt
    }))
  });
}

function resetSettings(): void {
  if (formDisabled.value) return;
  emit("reset", props.domain);
}
</script>

<template>
  <section class="library-agent-settings" :aria-labelledby="`${domain}-library-agent-title`">
    <header class="panel-header">
      <div>
        <span class="panel-kicker">{{ domainCopy.eyebrow }}</span>
        <h2 :id="`${domain}-library-agent-title`">{{ domainCopy.title }}</h2>
        <p>{{ domainCopy.description }}</p>
        <p v-if="!runtimeAvailable" class="runtime-note">
          当前环境仅支持查看；保存和恢复默认提示词需要使用 DeepWrite 桌面端。
        </p>
      </div>
    </header>

    <div v-if="loading" class="panel-state" aria-live="polite">
      正在加载{{ domainCopy.eyebrow }}配置…
    </div>
    <div v-else-if="!settings || !activeProfile" class="panel-state">
      暂无可用的{{ domainCopy.eyebrow }}智能体配置。
    </div>

    <div v-else class="settings-layout">
      <header class="agent-header">
        <div>
          <span>管理智能体</span>
          <h3>{{ displayProfile?.label ?? domainCopy.title }}</h3>
          <p>{{ displayProfile?.description ?? domainCopy.description }}</p>
        </div>
        <span v-if="hasUnsavedChanges" class="prompt-state">未保存</span>
      </header>

      <section class="settings-card prompt-card">
        <div class="section-heading">
          <div>
            <h4>系统提示词</h4>
            <p>当前库、活动条目和只读状态等动态信息会在运行时自动补充。</p>
          </div>
          <span>{{ draftSystemPrompt.length }} 字符</span>
        </div>
        <textarea
          :value="draftSystemPrompt"
          :disabled="formDisabled"
          spellcheck="false"
          :aria-label="`${domainCopy.title}系统提示词`"
          placeholder="输入资料库管理智能体的系统提示词…"
          @input="updateSystemPrompt"
        />
      </section>

      <section class="settings-card capability-card" aria-label="固定工具能力">
        <div class="section-heading">
          <div>
            <h4>工具能力</h4>
            <p>工具权限由客户端固定校验，不会因提示词内容而扩大。</p>
          </div>
          <span class="readonly-badge">只读配置</span>
        </div>
        <div class="capability-grid">
          <div
            v-for="capability in toolCapabilities"
            :key="capability.label"
            class="capability-item"
          >
            <strong>{{ capability.label }}</strong>
            <p>{{ capability.description }}</p>
          </div>
        </div>
        <p class="capability-note">
          官方只读技能库仅提供读取和搜索能力；所有写入都必须经过客户端版本校验与保存流程。
        </p>
      </section>

      <footer class="panel-actions">
        <button
          type="button"
          class="secondary-button"
          :disabled="formDisabled"
          @click="resetSettings"
        >
          <AppIcon name="history" :size="15" />
          恢复默认提示词
        </button>
        <button
          type="button"
          class="primary-button"
          :disabled="formDisabled"
          @click="saveSettings"
        >
          <AppIcon name="save" :size="15" />
          {{ saving ? "保存中…" : domainCopy.saveLabel }}
        </button>
      </footer>
    </div>
  </section>
</template>

<style scoped>
.library-agent-settings {
  width: min(100%, 920px);
  color: var(--text-primary);
}

.panel-header {
  margin-bottom: 20px;
}

.panel-kicker,
.agent-header > div > span {
  color: var(--text-tertiary);
  font-size: 0.785714rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.panel-header h2 {
  margin: 4px 0 5px;
  font-size: 1.57143rem;
  font-weight: 650;
}

.panel-header p,
.agent-header p,
.section-heading p,
.capability-item p,
.capability-note {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.892857rem;
  line-height: 1.55;
}

.runtime-note {
  margin-top: 5px !important;
  color: var(--warning-text, #8a6731) !important;
}

.panel-state {
  padding: 48px 20px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  text-align: center;
}

.settings-layout {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.agent-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 2px 2px 0;
}

.agent-header h3 {
  margin: 3px 0 4px;
  font-size: 1.28571rem;
  font-weight: 640;
}

.prompt-state,
.readonly-badge {
  flex: none;
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--surface-selected);
  color: var(--text-secondary);
  font-size: 0.785714rem;
  font-weight: 620;
}

.settings-card {
  overflow: hidden;
  border: 1px solid var(--theme-line-soft);
  border-radius: 13px;
  background: var(--surface-raised);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.035);
}

.section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 15px 17px 12px;
  border-bottom: 1px solid var(--theme-line-soft);
}

.section-heading h4 {
  margin: 0 0 3px;
  font-size: 1rem;
  font-weight: 620;
}

.section-heading > span:not(.readonly-badge) {
  flex: none;
  color: var(--text-tertiary);
  font-size: 0.821429rem;
}

.prompt-card textarea {
  display: block;
  width: 100%;
  min-height: 360px;
  padding: 16px 17px;
  resize: vertical;
  border: 0;
  outline: none;
  box-sizing: border-box;
  background: var(--surface-main);
  color: var(--text-primary);
  font-family: var(--code-font);
  font-size: var(--code-font-size);
  line-height: 1.65;
}

.prompt-card textarea:focus {
  box-shadow: inset 0 0 0 2px var(--accent-soft);
}

.prompt-card textarea:disabled {
  color: var(--text-tertiary);
  cursor: not-allowed;
}

.capability-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 15px 17px;
}

.capability-item {
  padding: 11px 12px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 9px;
  background: var(--surface-main);
}

.capability-item strong {
  display: block;
  margin-bottom: 3px;
  font-size: 0.928571rem;
  font-weight: 620;
}

.capability-note {
  padding: 0 17px 15px;
}

.panel-actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  padding-top: 2px;
}

.panel-actions button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 7px 13px;
  border-radius: 8px;
  font-size: 0.892857rem;
  font-weight: 570;
  cursor: pointer;
}

.secondary-button {
  border: 1px solid var(--theme-line);
  background: var(--surface-raised);
  color: var(--text-primary);
}

.primary-button {
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
}

.panel-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.52;
}

@media (max-width: 720px) {
  .capability-grid {
    grid-template-columns: 1fr;
  }

  .panel-actions {
    align-items: stretch;
    flex-direction: column-reverse;
  }

  .panel-actions button {
    justify-content: center;
  }
}
</style>
