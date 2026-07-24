<script setup lang="ts">
import {
  AgentTeamSettingsInputSchema,
  SHORT_AGENT_SUBAGENT_DESCRIPTION_MAX_LENGTH,
  SHORT_AGENT_SUBAGENT_MAX_COUNT,
  SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH,
  SHORT_AGENT_SUBAGENT_SYSTEM_PROMPT_MAX_LENGTH,
  SHORT_WORKSPACE_AGENT_IDS,
  type AgentTeamSettings,
  type AgentTeamSettingsInput,
  type ShortAgentSubagentDefinition,
  type ShortWorkspaceAgentId
} from "@deepwrite/contracts";
import { computed, ref, watch } from "vue";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";

interface ParentAgentMeta {
  id: ShortWorkspaceAgentId;
  label: string;
  description: string;
}

const props = defineProps<{
  settings: AgentTeamSettings | null;
  loading: boolean;
  saving: boolean;
  loadError?: string | null;
  runtimeAvailable: boolean;
}>();

const emit = defineEmits<{
  retry: [];
  save: [settings: AgentTeamSettingsInput];
}>();

const PARENT_AGENTS = [
  {
    id: "character_design",
    label: "人设",
    description: "为人物设计主智能体配置研究、审阅和设定补全助手。"
  },
  {
    id: "plot_design",
    label: "剧情",
    description: "为剧情主智能体配置结构、因果和钩子等专项助手。"
  },
  {
    id: "outline",
    label: "大纲",
    description: "为大纲主智能体配置拆分、连续性和逻辑审阅助手。"
  },
  {
    id: "expert_draft_coordinator",
    label: "正文",
    description: "为正文总控配置审阅、润色和一致性检查助手。"
  },
  {
    id: "expert_section_writer",
    label: "分节",
    description: "为分节写手配置场景、对白和细节等专项助手。"
  }
] as const satisfies readonly ParentAgentMeta[];

const activeParentAgentId = ref<ShortWorkspaceAgentId>(PARENT_AGENTS[0].id);
const draftTeams = ref<AgentTeamSettingsInput["teams"]>([]);
const editingSubagentId = ref<string | null>(null);
let generatedIdSequence = 0;

const formDisabled = computed(
  () =>
    props.loading ||
    props.saving ||
    Boolean(props.loadError) ||
    !props.runtimeAvailable
);

const activeParentMeta = computed(
  () =>
    PARENT_AGENTS.find((agent) => agent.id === activeParentAgentId.value) ??
    PARENT_AGENTS[0]
);

const activeTeam = computed(() =>
  draftTeams.value.find(
    (team) => team.parentAgentId === activeParentAgentId.value
  )
);

watch(
  () => props.settings,
  (settings) => {
    draftTeams.value = settings
      ? settings.teams.map((team) => ({
          parentAgentId: team.parentAgentId,
          subagents: team.subagents.map((subagent) => ({ ...subagent }))
        }))
      : [];
    editingSubagentId.value = null;
  },
  { immediate: true, deep: true }
);

function selectParentAgent(parentAgentId: ShortWorkspaceAgentId): void {
  activeParentAgentId.value = parentAgentId;
  editingSubagentId.value = null;
}

function nextSubagentId(): string {
  generatedIdSequence += 1;
  return `subagent_${Date.now().toString(36)}_${generatedIdSequence.toString(36)}`;
}

function addSubagent(): void {
  const team = activeTeam.value;
  if (!team || formDisabled.value) return;
  if (team.subagents.length >= SHORT_AGENT_SUBAGENT_MAX_COUNT) {
    uiMessage.warning(`每个主智能体最多配置 ${SHORT_AGENT_SUBAGENT_MAX_COUNT} 个子智能体`);
    return;
  }
  const id = nextSubagentId();
  team.subagents.push({
    id,
    name: `新子智能体 ${team.subagents.length + 1}`,
    description: "",
    systemPrompt: "",
    enabled: true
  });
  editingSubagentId.value = id;
}

function editSubagent(id: string): void {
  editingSubagentId.value = id;
}

function finishEditing(): void {
  editingSubagentId.value = null;
}

function removeSubagent(index: number): void {
  const team = activeTeam.value;
  if (!team || formDisabled.value) return;
  const [removed] = team.subagents.splice(index, 1);
  if (removed && editingSubagentId.value === removed.id) {
    editingSubagentId.value = null;
  }
  if (removed) {
    uiMessage.info("已从当前草稿移除；保存智能体团队后生效");
  }
}

function toggleSubagent(
  subagent: ShortAgentSubagentDefinition,
  event: Event
): void {
  if (formDisabled.value) return;
  subagent.enabled = (event.target as HTMLInputElement).checked;
}

function validationMessage(
  teams: AgentTeamSettingsInput["teams"]
): string | null {
  for (const team of teams) {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const subagent of team.subagents) {
      if (!subagent.name.trim()) return "子智能体名称不能为空";
      if (!subagent.description.trim()) return "子智能体能力说明不能为空";
      if (!subagent.systemPrompt.trim()) return "子智能体系统提示词不能为空";
      const id = subagent.id.toLocaleLowerCase();
      const name = subagent.name.trim().toLocaleLowerCase();
      if (ids.has(id)) return "同一主智能体下的子智能体 ID 不能重复";
      if (names.has(name)) return "同一主智能体下的子智能体名称不能重复";
      ids.add(id);
      names.add(name);
    }
  }
  return null;
}

function saveSettings(): void {
  if (formDisabled.value) return;
  const teams: AgentTeamSettingsInput["teams"] = SHORT_WORKSPACE_AGENT_IDS.map(
    (parentAgentId) => {
      const team = draftTeams.value.find(
        (candidate) => candidate.parentAgentId === parentAgentId
      );
      return {
        parentAgentId,
        subagents: (team?.subagents ?? []).map((subagent) => ({
          ...subagent,
          name: subagent.name.trim(),
          description: subagent.description.trim(),
          systemPrompt: subagent.systemPrompt.trim()
        }))
      };
    }
  );
  const message = validationMessage(teams);
  if (message) {
    uiMessage.warning(message);
    return;
  }
  const parsed = AgentTeamSettingsInputSchema.safeParse({
    workspaceType: "short",
    teams
  });
  if (!parsed.success) {
    uiMessage.warning(parsed.error.issues[0]?.message ?? "智能体团队配置不完整");
    return;
  }
  emit("save", parsed.data);
}
</script>

<template>
  <section class="agent-team-settings" aria-labelledby="agent-team-title">
    <header class="panel-header">
      <div>
        <span class="panel-kicker">学习仿写 · 智能体团队</span>
        <h2 id="agent-team-title">智能体团队</h2>
        <p>提前为每个主智能体配置可调用的专项子智能体。</p>
        <p class="inheritance-note">
          子智能体继承所属主智能体的模型、工具与审批策略；每次调用使用独立上下文，且不能继续创建子智能体。
        </p>
        <p v-if="!runtimeAvailable" class="runtime-note">
          当前环境仅支持查看；保存设置需要使用 DeepWrite 桌面端。
        </p>
      </div>
    </header>

    <div class="workspace-tabs" role="tablist" aria-label="创作类型">
      <button class="workspace-tab is-active" type="button" role="tab" aria-selected="true">
        短篇
      </button>
      <button
        class="workspace-tab"
        type="button"
        role="tab"
        aria-selected="false"
        disabled
      >
        <span>剧本</span><small>尚未接入</small>
      </button>
      <button
        class="workspace-tab"
        type="button"
        role="tab"
        aria-selected="false"
        disabled
      >
        <span>长篇</span><small>尚未接入</small>
      </button>
    </div>

    <div v-if="loading" class="panel-state" aria-live="polite">
      正在加载智能体团队设置…
    </div>
    <div v-else-if="loadError" class="panel-state panel-load-error" role="alert">
      <strong>智能体团队设置未加载</strong>
      <p>{{ loadError }}</p>
      <button
        type="button"
        class="secondary-button"
        :disabled="loading"
        @click="emit('retry')"
      >
        重新加载
      </button>
    </div>
    <div v-else-if="!settings || !activeTeam" class="panel-state">
      暂无可用的智能体团队设置。
    </div>

    <div v-else class="team-layout">
      <nav class="parent-agent-tabs" aria-label="短篇主智能体">
        <button
          v-for="agent in PARENT_AGENTS"
          :key="agent.id"
          type="button"
          class="parent-agent-tab"
          :class="{ 'is-active': activeParentAgentId === agent.id }"
          :aria-current="activeParentAgentId === agent.id ? 'page' : undefined"
          @click="selectParentAgent(agent.id)"
        >
          {{ agent.label }}
          <span>{{ draftTeams.find((team) => team.parentAgentId === agent.id)?.subagents.length ?? 0 }}</span>
        </button>
      </nav>

      <div class="team-editor">
        <header class="team-heading">
          <div>
            <span>主智能体</span>
            <h3>{{ activeParentMeta.label }}</h3>
            <p>{{ activeParentMeta.description }}</p>
          </div>
          <button
            type="button"
            class="secondary-button"
            :disabled="formDisabled || activeTeam.subagents.length >= SHORT_AGENT_SUBAGENT_MAX_COUNT"
            @click="addSubagent"
          >
            <AppIcon name="plus" :size="15" />
            新增子智能体
          </button>
        </header>

        <div v-if="!activeTeam.subagents.length" class="empty-team">
          <strong>还没有子智能体</strong>
          <p>新增后，主智能体会根据能力说明决定何时委派任务。</p>
        </div>

        <div v-else class="subagent-list">
          <article
            v-for="(subagent, index) in activeTeam.subagents"
            :key="subagent.id"
            class="subagent-card"
            :class="{ 'is-editing': editingSubagentId === subagent.id }"
          >
            <header class="subagent-summary">
              <div class="subagent-copy">
                <div class="subagent-title-row">
                  <strong>{{ subagent.name || "未命名子智能体" }}</strong>
                  <span :class="{ 'is-disabled': !subagent.enabled }">
                    {{ subagent.enabled ? "已启用" : "已停用" }}
                  </span>
                </div>
                <p>{{ subagent.description || "补充能力说明，让主智能体知道何时调用它。" }}</p>
              </div>
              <label class="enable-toggle" :title="subagent.enabled ? '停用' : '启用'">
                <input
                  type="checkbox"
                  :checked="subagent.enabled"
                  :disabled="formDisabled"
                  :aria-label="`${subagent.name || '子智能体'}启用状态`"
                  @change="toggleSubagent(subagent, $event)"
                />
              </label>
              <button
                type="button"
                class="icon-button"
                :disabled="formDisabled"
                :aria-label="`编辑${subagent.name}`"
                @click="editSubagent(subagent.id)"
              >
                <AppIcon name="edit" :size="15" />
              </button>
              <button
                type="button"
                class="icon-button is-danger"
                :disabled="formDisabled"
                :aria-label="`删除${subagent.name}`"
                @click="removeSubagent(index)"
              >
                <AppIcon name="trash" :size="15" />
              </button>
            </header>

            <div v-if="editingSubagentId === subagent.id" class="subagent-form">
              <label class="form-field">
                <span>名称</span>
                <input
                  v-model="subagent.name"
                  type="text"
                  :maxlength="SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH"
                  :disabled="formDisabled"
                  placeholder="例如：连续性审阅"
                />
              </label>
              <label class="form-field">
                <span>能力说明</span>
                <textarea
                  v-model="subagent.description"
                  class="description-input"
                  :maxlength="SHORT_AGENT_SUBAGENT_DESCRIPTION_MAX_LENGTH"
                  :disabled="formDisabled"
                  placeholder="说明擅长处理什么任务，供主智能体选择调用。"
                />
              </label>
              <label class="form-field">
                <span>系统提示词</span>
                <textarea
                  v-model="subagent.systemPrompt"
                  class="prompt-input"
                  :maxlength="SHORT_AGENT_SUBAGENT_SYSTEM_PROMPT_MAX_LENGTH"
                  :disabled="formDisabled"
                  spellcheck="false"
                  placeholder="定义子智能体的职责、工作方法和交接要求。"
                />
              </label>
              <div class="form-meta">
                <span>ID：<code>{{ subagent.id }}</code></span>
                <button type="button" :disabled="formDisabled" @click="finishEditing">
                  完成编辑
                </button>
              </div>
            </div>
          </article>
        </div>

        <footer class="panel-actions">
          <span>当前主智能体 {{ activeTeam.subagents.length }}/{{ SHORT_AGENT_SUBAGENT_MAX_COUNT }}</span>
          <button
            type="button"
            class="primary-button"
            :disabled="formDisabled"
            @click="saveSettings"
          >
            <AppIcon name="save" :size="15" />
            {{ saving ? "保存中…" : "保存智能体团队" }}
          </button>
        </footer>
      </div>
    </div>
  </section>
</template>

<style scoped>
.agent-team-settings {
  width: min(100%, 980px);
  color: var(--text-primary);
}

.panel-header { margin-bottom: 18px; }
.panel-kicker,
.team-heading > div > span {
  color: var(--text-tertiary);
  font-size: 0.785714rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.panel-header h2 { margin: 4px 0 5px; font-size: 1.57143rem; font-weight: 650; }
.panel-header p,
.team-heading p,
.subagent-copy p,
.empty-team p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.892857rem;
  line-height: 1.55;
}
.inheritance-note { margin-top: 7px !important; }
.runtime-note { margin-top: 5px !important; color: var(--warning-text, #8a6731) !important; }

.workspace-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 18px;
  padding: 5px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-muted);
}
.workspace-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 108px;
  padding: 8px 14px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-weight: 600;
}
.workspace-tab.is-active { background: var(--surface-raised); color: var(--text-primary); box-shadow: 0 1px 3px rgb(0 0 0 / 0.08); }
.workspace-tab:disabled { color: var(--text-tertiary); }
.workspace-tab small { font-size: 0.714286rem; font-weight: 520; }

.panel-state,
.empty-team {
  padding: 42px 20px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  text-align: center;
}
.panel-load-error strong { display: block; margin-bottom: 6px; color: var(--text-primary); }
.panel-load-error p { margin: 0 0 14px; color: var(--text-secondary); }
.panel-load-error .secondary-button { margin: 0 auto; }
.empty-team strong { display: block; margin-bottom: 5px; color: var(--text-primary); }

.team-layout {
  display: grid;
  grid-template-columns: 164px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.parent-agent-tabs {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-muted);
}
.parent-agent-tab {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 42px;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-weight: 590;
  cursor: pointer;
}
.parent-agent-tab:hover { background: var(--surface-hover); color: var(--text-primary); }
.parent-agent-tab.is-active { background: var(--surface-raised); color: var(--text-primary); box-shadow: 0 1px 3px rgb(0 0 0 / 0.08); }
.parent-agent-tab span { min-width: 22px; padding: 2px 6px; border-radius: 999px; background: var(--surface-selected); color: var(--text-tertiary); font-size: 0.75rem; text-align: center; }

.team-editor { min-width: 0; }
.team-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 14px; }
.team-heading h3 { margin: 3px 0 4px; font-size: 1.28571rem; font-weight: 640; }
.secondary-button,
.primary-button,
.icon-button,
.form-meta button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.secondary-button { flex: none; padding: 8px 11px; background: var(--surface-raised); color: var(--text-primary); }
.secondary-button:hover:not(:disabled), .form-meta button:hover:not(:disabled) { background: var(--surface-hover); }
.primary-button {
  padding: 9px 14px;
  border-color: color-mix(in srgb, var(--theme-foreground) 18%, #15171a);
  background: color-mix(in srgb, var(--theme-foreground) 18%, #15171a);
  color: #fff;
}
.primary-button:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--theme-foreground) 12%, #0f1113);
  background: color-mix(in srgb, var(--theme-foreground) 12%, #0f1113);
}
button:disabled { cursor: not-allowed; opacity: 0.5; }

.subagent-list { display: flex; flex-direction: column; gap: 10px; }
.subagent-card { overflow: hidden; border: 1px solid var(--theme-line-soft); border-radius: 12px; background: var(--surface-raised); }
.subagent-card.is-editing { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.subagent-summary { display: flex; align-items: center; gap: 9px; padding: 13px 14px; }
.subagent-copy { flex: 1; min-width: 0; }
.subagent-title-row { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
.subagent-title-row strong { overflow: hidden; font-size: 1rem; font-weight: 630; text-overflow: ellipsis; white-space: nowrap; }
.subagent-title-row span { flex: none; padding: 2px 7px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 0.714286rem; font-weight: 620; }
.subagent-title-row span.is-disabled { background: var(--surface-selected); color: var(--text-tertiary); }
.subagent-copy p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icon-button { width: 32px; height: 32px; padding: 0; background: transparent; color: var(--text-secondary); }
.icon-button:hover:not(:disabled) { background: var(--surface-hover); color: var(--text-primary); }
.icon-button.is-danger:hover:not(:disabled) { border-color: var(--danger, #d65353); background: color-mix(in srgb, var(--danger, #d65353) 12%, transparent); color: var(--danger, #d65353); }

.enable-toggle input { position: relative; width: 38px; height: 22px; margin: 0; appearance: none; border-radius: 12px; background: var(--surface-selected); cursor: pointer; transition: background-color 150ms ease; }
.enable-toggle input::after { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: var(--surface-main); box-shadow: 0 1px 3px rgb(0 0 0 / 0.22); content: ""; transition: transform 150ms ease; }
.enable-toggle input:checked { background: var(--accent); }
.enable-toggle input:checked::after { transform: translateX(16px); }

.subagent-form { display: grid; gap: 12px; padding: 15px; border-top: 1px solid var(--theme-line-soft); background: var(--surface-muted); }
.form-field { display: grid; gap: 6px; }
.form-field > span { color: var(--text-secondary); font-size: 0.821429rem; font-weight: 620; }
.form-field input,
.form-field textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  outline: 0;
  background: var(--surface-main);
  color: var(--text-primary);
  font: inherit;
  line-height: 1.55;
  resize: vertical;
}
.form-field input { min-height: 38px; padding: 8px 10px; }
.form-field textarea { padding: 9px 10px; }
.description-input { min-height: 76px; }
.prompt-input { min-height: 180px; font-family: var(--code-font); font-size: 0.892857rem; }
.form-field input:focus, .form-field textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.form-field input::placeholder, .form-field textarea::placeholder { color: var(--text-tertiary); }
.form-meta { display: flex; align-items: center; justify-content: space-between; gap: 16px; color: var(--text-tertiary); font-size: 0.75rem; }
.form-meta code { overflow-wrap: anywhere; color: var(--text-secondary); }
.form-meta button { flex: none; padding: 7px 10px; background: var(--surface-raised); color: var(--text-primary); font-size: 0.821429rem; }

.panel-actions { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--theme-line-soft); }
.panel-actions > span { color: var(--text-tertiary); font-size: 0.821429rem; }

@media (max-width: 900px) {
  .team-layout { grid-template-columns: 1fr; }
  .parent-agent-tabs { position: static; flex-direction: row; overflow-x: auto; }
  .parent-agent-tab { flex: 1 0 104px; }
}

@media (max-width: 680px) {
  .workspace-tabs { overflow-x: auto; }
  .workspace-tab { min-width: 96px; }
  .team-heading, .panel-actions { align-items: stretch; flex-direction: column; }
  .secondary-button, .primary-button { width: 100%; }
  .subagent-summary { align-items: flex-start; flex-wrap: wrap; }
  .subagent-copy { flex-basis: calc(100% - 50px); }
  .form-meta { align-items: flex-start; flex-direction: column; }
}
</style>
