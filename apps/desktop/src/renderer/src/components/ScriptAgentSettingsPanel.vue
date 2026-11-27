<script setup lang="ts">
import {
  builtinAgentLabel,
  builtinAgentDescription
} from "../i18n/builtinLabels";
import { createScopedTranslator } from "../i18n";
import {
  DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES,
  ScriptWorkspaceAgentSettingsInputSchema,
  type ScriptWorkspaceAgentSettings,
  type ScriptWorkspaceAgentSettingsInput
} from "@deepwrite/contracts";
import { ref, watch } from "vue";
import { uiMessage } from "../ui-feedback";
import WorkspaceAgentProfileForm from "./WorkspaceAgentProfileForm.vue";
import { patchWorkspaceAgentReadAccess } from "./workspaceAgentProfileDraft";

const t = createScopedTranslator("components.scriptAgentSettingsPanel");

type EditableAgent = ScriptWorkspaceAgentSettingsInput["agents"][number];

const props = defineProps<{
  settings: ScriptWorkspaceAgentSettings | null;
  loading: boolean;
  saving: boolean;
  runtimeAvailable: boolean;
}>();

const emit = defineEmits<{
  save: [input: ScriptWorkspaceAgentSettingsInput];
}>();

const draft = ref<EditableAgent | null>(null);

function cloneAgent(
  agent: ScriptWorkspaceAgentSettings["agents"][number]
): EditableAgent {
  return {
    id: agent.id,
    systemPrompt: agent.systemPrompt,
    welcomeShortcuts: [...agent.welcomeShortcuts],
    readAccess: {
      material: [...agent.readAccess.material],
      skill: [...agent.readAccess.skill]
    }
  };
}

watch(
  () => props.settings,
  (settings) => {
    draft.value = settings?.agents[0] ? cloneAgent(settings.agents[0]) : null;
  },
  { immediate: true, deep: true }
);

function patchAccess(
  scope: "material" | "skill",
  id: string,
  checked: boolean
): void {
  patchWorkspaceAgentReadAccess(draft.value, scope, id, checked);
}

function patchShortcut(index: number, value: string): void {
  if (draft.value) draft.value.welcomeShortcuts[index] = value;
}

function reset(): void {
  const builtin = DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0];
  if (!builtin) return;
  draft.value = cloneAgent(builtin);
  uiMessage.info(t("screenplayAgentResetToBuiltInDefaultsSaveTo"));
}

function save(): void {
  if (!draft.value) return;
  const parsed = ScriptWorkspaceAgentSettingsInputSchema.safeParse({
    workspaceType: "script",
    agents: [
      {
        ...draft.value,
        welcomeShortcuts: draft.value.welcomeShortcuts.map((value) =>
          value.trim()
        )
      }
    ]
  });
  if (!parsed.success) {
    uiMessage.warning(t("screenplayAgentSettingsAreIncomplete"));
    return;
  }
  emit("save", parsed.data);
}
</script>

<template>
  <div v-if="loading" class="panel-state">
    {{ t("loadingScreenplayAgentSettings") }}
  </div>
  <div v-else-if="!settings || !draft" class="panel-state">
    {{ t("noScreenplayAgentSettingsAvailable") }}
  </div>
  <WorkspaceAgentProfileForm
    v-else
    :agent="draft"
    :label="builtinAgentLabel('script', settings.agents[0]?.label)"
    :description="
      builtinAgentDescription('script', settings.agents[0]?.description)
    "
    :eyebrow="t('unifiedAgent')"
    :disabled="saving || !runtimeAvailable"
    :saving="saving"
    :save-label="t('saveScreenplayAgentSettings')"
    @prompt="draft.systemPrompt = $event"
    @shortcut="patchShortcut"
    @access="patchAccess"
    @reset="reset"
    @save="save"
  />
</template>

<style scoped>
.panel-state {
  padding: 48px 20px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  text-align: center;
}
</style>
