import { describe, expect, it } from "vitest";
import componentSource from "./AgentTeamSettingsPanel.vue?raw";
import templateSource from "./AgentTeamSettingsPanel.template.html?raw";
import longComponentSource from "./LongAgentTeamSettingsPanel.vue?raw";
import longTemplateSource from "./LongAgentTeamSettingsPanel.template.html?raw";
import metaSource from "./agentTeamSettingsMeta.ts?raw";
import parallelSwitchSource from "./AgentTeamParallelSwitch.vue?raw";
import switchSource from "./AgentTeamSwitch.vue?raw";
import segmentedSource from "./AgentTeamSegmented.vue?raw";
import modeFieldSource from "./SubagentModeField.vue?raw";
import modelFieldSource from "./SubagentModelField.vue?raw";
import cardSource from "./AgentTeamSubagentCard.vue?raw";
import editorSource from "./AgentTeamSubagentEditor.vue?raw";
import sectionSource from "./AgentTeamSubagentSection.vue?raw";
import saveBarSource from "./AgentTeamSaveBar.vue?raw";
import { SUBAGENT_AGENT_MODE_LABELS } from "./agentTeamSettingsMeta";

const longSource = `${longComponentSource}\n${longTemplateSource}`;

const source = `${componentSource}\n${templateSource}\n${metaSource}`;

describe("AgentTeamSettingsPanel", () => {
  it("explains the isolated subagent prompt and skill boundary", () => {
    expect(templateSource).toContain(
      ":note=\"t('subagentsUseThePrimaryAgentSModelByDefault')\""
    );
    expect(longTemplateSource).toContain(
      ":note=\"t('subagentsUseThePrimaryAgentSModelByDefault')\""
    );
    expect(sectionSource).toContain('class="section-note"');
    expect(sectionSource).toContain("loadFromSkillLibrary");
  });

  it("enables short, script and independent long-form teams", () => {
    expect(source).toContain("shortStory");
    expect(source).toContain("screenplay");
    expect(source).toContain("novel");
    expect(source).not.toContain("尚未接入");
    expect(source).toContain("@click=\"activeWorkspaceType = 'script'\"");
    expect(source).toContain(
      ":aria-selected=\"activeWorkspaceType === 'script'\""
    );
    expect(source).toContain("@click=\"activeWorkspaceType = 'long'\"");
    expect(source).toContain(':settings="longSettings"');
    expect(source.match(/role="tab"/g)?.length).toBe(5);
    expect(source).toContain(
      "const activeSkills = computed(() => props.skills ?? [])"
    );
    expect(source).not.toContain(
      "skill.skillType === activeWorkspaceType.value"
    );
  });

  it("maps the unified long parent agent and preserves approval boundaries", () => {
    expect(longSource).toContain("LONG_AGENT_IDS");
    expect(longSource).toContain(
      "parentAgentId: LongAgentId = LONG_AGENT_IDS[0]"
    );
    expect(longSource).not.toContain('id: "setting"');
    expect(longSource).not.toContain("expert_section_writer");
    expect(longSource).toContain(
      "configureSpecialistAssistantsForWorldbuildingCharactersPlotManuscriptAnd"
    );
    expect(longSource).toContain("LongAgentTeamSettingsInputSchema.safeParse");
  });

  it("keeps long-form subagent editing aligned with short and script teams", () => {
    for (const marker of [
      "<AgentTeamSubagentSection",
      "<AgentTeamSubagentCard",
      "<AgentTeamSubagentEditor",
      "<AgentTeamSaveBar",
      "LoadSubagentFromSkillDialog",
      "subagentModelSummary",
      "editingSubagentId"
    ]) {
      expect(longSource).toContain(marker);
      expect(source).toContain(marker);
    }
    expect(longSource).toContain(
      '@toggle="toggleSubagent(definition, $event)"'
    );
    expect(longSource).toContain('@duplicate="duplicateSubagent(index)"');
    expect(longSource).toContain('@remove="removeSubagent(index)"');
    expect(longSource).toContain('@save="saveSettings"');
    expect(cardSource).toContain('<AppIcon name="copy" :size="15" />');
    expect(cardSource).toContain('<AppIcon name="trash" :size="15" />');
  });

  it("uses one parent team for short and script workspaces", () => {
    expect(source).toContain('id: "short"');
    expect(source).toContain("shortStoryAgent");
    expect(source).toContain('id: "script"');
    expect(source).toContain("screenplayAgent");
    expect(source).toContain('v-if="visibleParentAgents.length > 1"');
    expect(source).toContain("SCRIPT_PARENT_AGENTS");
    expect(source).toContain("SHORT_PARENT_AGENT");
    expect(source).toContain("activeSubagentLimit");
    expect(source).toContain("SCRIPT_AGENT_SUBAGENT_MAX_COUNT");
    expect(source).not.toContain('label: "人设"');
    expect(source).not.toContain('label: "剧情"');
    expect(source).not.toContain('label: "正文"');
    expect(source).not.toContain('label: "大纲"');
    expect(source).not.toContain('label: "分节"');
  });

  it("stacks the editor in one column and drops the stale learn-and-imitate heading", () => {
    expect(templateSource).not.toContain("team-layout");
    expect(templateSource).not.toContain("learnAndImitate");
    expect(templateSource).toContain('class="team-editor"');
    expect(longTemplateSource).toContain('class="team-editor"');
  });

  it("supports model mode inherit or custom with PopupSelect", () => {
    expect(modelFieldSource).toContain("usePrimaryAgentModel");
    expect(modelFieldSource).toContain("configureModelSeparately");
    expect(modelFieldSource).toContain('"inherit" as const');
    expect(modelFieldSource).toContain('"custom" as const');
    expect(modelFieldSource).toContain("PopupSelect");
    expect(modelFieldSource).toContain("v-if=\"thinkingLevel === 'off'\"");
    expect(modelFieldSource).toContain("emit('setThinkingLevel'");
    expect(modelFieldSource).toContain("emit('setTemperature'");
    expect(source).toContain("models:");
    expect(source).toContain(
      '@set-model-mode="setSubagentModelMode(subagent, $event)"'
    );
    expect(source).toContain("setSubagentThinkingLevel");
    expect(source).toContain("setSubagentTemperature");
    expect(longSource).toContain(
      '@set-model-mode="setModelMode(definition, $event)"'
    );
  });

  it("groups the editor as basics, system prompt and a folded advanced section", () => {
    const basics = editorSource.indexOf("t('basics')");
    const prompt = editorSource.indexOf("t('systemPrompt')");
    const advanced = editorSource.indexOf("t('advancedSettings')");
    expect(basics).toBeGreaterThan(-1);
    expect(basics).toBeLessThan(prompt);
    expect(prompt).toBeLessThan(advanced);
    expect(editorSource).toContain("const advancedOpen = ref(false)");
    expect(editorSource).toContain('v-if="advancedOpen"');
    expect(editorSource).toContain(':aria-expanded="advancedOpen"');
    expect(editorSource.indexOf("t('name')")).toBeLessThan(
      editorSource.indexOf("<SubagentModeField")
    );
    expect(editorSource.indexOf("<SubagentModeField")).toBeLessThan(
      editorSource.indexOf("<SubagentModelField")
    );
    expect(advanced).toBeLessThan(editorSource.indexOf("<SubagentModeField"));
  });

  it("supports adding, editing, enabling, copying, deleting and saving subagents", () => {
    expect(templateSource).toContain('@add="addSubagent()"');
    expect(templateSource).toContain('@load-from-skill="openLoadFromSkill"');
    expect(templateSource).toContain('@edit="editSubagent(subagent.id)"');
    expect(templateSource).toContain('@duplicate="duplicateSubagent(index)"');
    expect(templateSource).toContain(
      '@toggle="toggleSubagent(subagent, $event)"'
    );
    expect(templateSource).toContain('@remove="removeSubagent(index)"');
    expect(templateSource).toContain('@save="saveSettings"');
    expect(templateSource).toContain('@discard="discardChanges"');
    expect(sectionSource).toContain("emit('add')");
    expect(sectionSource).toContain("emit('loadFromSkill')");
    expect(source).toContain("WorkspaceAgentTeamSettingsInputSchema.safeParse");
  });

  it("puts the team-wide parallel switch before the subagent list for every writing type", () => {
    for (const [panel, template] of [
      [source, templateSource],
      [longSource, longTemplateSource]
    ] as const) {
      expect(panel).toContain("<AgentTeamParallelSwitch");
      expect(panel).toContain('v-model="draftParallelSubagents"');
      expect(panel).toContain(
        "const parallel = settings?.parallelSubagents ?? false"
      );
      expect(panel).toContain("draftParallelSubagents.value = parallel");
      expect(panel).toContain(
        "parallelSubagents: draftParallelSubagents.value"
      );
      const parallel = template.indexOf("<AgentTeamParallelSwitch");
      expect(parallel).toBeGreaterThan(-1);
      expect(parallel).toBeLessThan(
        template.indexOf("<AgentTeamSubagentSection")
      );
      expect(parallel).toBeLessThan(template.indexOf("<AgentTeamSaveBar"));
    }
    expect(parallelSwitchSource).toContain("SUBAGENT_PARALLEL_MAX_CONCURRENCY");
    expect(parallelSwitchSource).toContain("<AgentTeamSwitch");
    expect(parallelSwitchSource).toContain(':disabled="disabled"');
    expect(switchSource).toContain('role="switch"');
  });

  it("keeps every switch tied to its data instead of the native checkbox state", () => {
    expect(switchSource).toContain(':checked="modelValue"');
    expect(switchSource).toContain("input.checked = props.modelValue");
    expect(switchSource).not.toContain("defineModel");
    expect(switchSource).not.toContain('v-model="');
  });

  it("edits, shows and saves the subagent run mode for every writing type", () => {
    for (const [panel, item] of [
      [source, "subagent"],
      [longSource, "definition"]
    ] as const) {
      expect(panel).toContain(`v-model:agent-mode="${item}.agentMode"`);
      expect(panel).toContain(`agentMode: ${item}.agentMode ?? "standard"`);
      expect(panel).toContain('agentMode: "standard"');
    }
    expect(editorSource).toContain("<SubagentModeField");
    expect(cardSource).toContain("subagent.agentMode !== 'standard'");
    expect(cardSource).toContain("SUBAGENT_AGENT_MODE_LABELS");
    expect(modeFieldSource).toContain("<AgentTeamSegmented");
    expect(modeFieldSource).toContain(':disabled="disabled"');
    expect(segmentedSource).toContain('role="radiogroup"');
    expect(segmentedSource).toContain('type="radio"');
    for (const mode of ["standard", "pure-read", "pure-bare"]) {
      expect(modeFieldSource).toContain(`"${mode}"`);
    }
  });

  it("labels all three run modes distinctly", () => {
    const labels = Object.values(SUBAGENT_AGENT_MODE_LABELS);
    expect(Object.keys(SUBAGENT_AGENT_MODE_LABELS)).toEqual([
      "standard",
      "pure-read",
      "pure-bare"
    ]);
    expect(new Set(labels).size).toBe(3);
    expect(
      labels.every((label) => label && !label.startsWith("agentMode"))
    ).toBe(true);
  });

  it("tracks unsaved edits, reports them to the host and can discard them", () => {
    for (const panel of [source, longSource]) {
      expect(panel).toContain("agentTeamDraftSignature");
      expect(panel).toContain("const baselineSignature = ref(");
      expect(panel).toContain('emit("dirtyChange"');
      expect(panel).toContain("function discardChanges()");
      expect(panel).toContain("syncDraft(true)");
    }
    expect(templateSource).toContain(':dirty="dirty"');
    expect(longTemplateSource).toContain(':dirty="dirty"');
    expect(templateSource).toContain(
      "@dirty-change=\"emit('dirtyChange', $event)\""
    );
  });

  it("keeps unsaved edits when the saved settings did not actually change", () => {
    expect(componentSource).toContain("signature === baselineSignature.value");
    expect(longComponentSource).toContain(
      "signature === baselineSignature.value"
    );
    expect(componentSource).toContain("{ immediate: true, deep: true }");
  });

  it("saves only a changed draft and shows progress in the sticky save bar", () => {
    expect(saveBarSource).toContain(':disabled="disabled || !dirty"');
    expect(saveBarSource).toContain("position: sticky");
    expect(saveBarSource).toContain('v-if="dirty"');
    expect(saveBarSource).toContain('t("saving")');
    expect(saveBarSource).toContain("var(--neutral-solid)");
  });

  it("isolates long loading failures and keeps a successfully loaded sibling editable", () => {
    expect(source).not.toContain("Boolean(props.loadError)");
    expect(source).toContain('v-else-if="loadError && !activeSettings"');
    expect(source).toContain(':loading="longLoading"');
    expect(source).toContain(':saving="longSaving"');
    expect(source).toContain(':load-error="longLoadError ?? null"');
    expect(source).toContain("emit('retry')");
  });
});
