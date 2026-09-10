import {
  DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES,
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  type ScriptWorkspaceSnapshot,
  type ShortWorkspaceSnapshot
} from "@deepwrite/contracts";
import {
  buildRuntimeUserPrompt,
  describe,
  expect,
  it,
  screenplayWorkspace
} from "./index.test-support";

function shortWorkspace(
  activeStageId: ShortWorkspaceSnapshot["activeStageId"]
): ShortWorkspaceSnapshot {
  const { activeSectionId: _activeSectionId, ...script } =
    screenplayWorkspace();
  return {
    ...script,
    id: "short-resource-context",
    title: "雾港回声",
    activeStageId,
    activeAgentId: "short",
    ...(activeStageId === "draft" ? { activeSectionId: "episode-1" } : {})
  };
}

const attachedSkills = [
  {
    id: "skill-general",
    title: "方法库 · 通用检查",
    source: "attached-skill" as const,
    kind: "general" as const,
    content: "不应直接注入的通用技能正文"
  },
  {
    id: "skill-style",
    title: "风格库 · 冷峻文风",
    source: "attached-skill" as const,
    kind: "style" as const,
    content: "不应直接注入的文风技能正文"
  }
];

const attachedMaterials = [
  {
    id: "material-character",
    title: "素材库 · 人物档案",
    source: "attached-material" as const,
    kind: "character" as const,
    content: "人物关系设计参考。\n\n不应直接注入的人物素材正文"
  },
  {
    id: "material-plot",
    title: "素材库 · 反转桥段",
    source: "attached-material" as const,
    kind: "plot" as const,
    content: "剧情反转参考。\n\n不应直接注入的剧情素材正文"
  }
];

function promptFor(stageId: ShortWorkspaceSnapshot["activeStageId"]): string {
  return buildRuntimeUserPrompt({
    runId: `run-${stageId}`,
    sessionId: `session-${stageId}`,
    prompt: "继续当前阶段",
    agentProfile: DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES[0]!,
    workspaceContext: {
      shortWorkspace: shortWorkspace(stageId),
      attachedSkills,
      attachedMaterials
    }
  });
}

function scriptPromptFor(
  activeStageId: ScriptWorkspaceSnapshot["activeStageId"]
): string {
  const workspace = screenplayWorkspace();
  const { activeSectionId: _activeSectionId, ...withoutActiveSection } =
    workspace;
  return buildRuntimeUserPrompt({
    runId: `script-run-${activeStageId}`,
    sessionId: `script-session-${activeStageId}`,
    prompt: "继续当前阶段",
    scriptAgentProfile: DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0]!,
    workspaceContext: {
      scriptWorkspace: {
        ...withoutActiveSection,
        activeStageId,
        ...(activeStageId === "draft" ? { activeSectionId: "episode-1" } : {})
      },
      attachedSkills,
      attachedMaterials
    }
  });
}

describe("short workspace on-demand resource context", () => {
  it("injects only the current-stage intersection as an index", () => {
    const character = promptFor("character_design");
    expect(character).toContain(
      "方法库 · 通用检查 [general]（id=skill-general）"
    );
    expect(character).toContain(
      "素材库 · 人物档案 [character]（id=material-character）"
    );
    expect(character).not.toContain("风格库 · 冷峻文风");
    expect(character).not.toContain("素材库 · 反转桥段");
    expect(character).toContain("正文摘录：人物关系设计参考。");
    expect(character).not.toContain("不应直接注入");

    const plot = promptFor("plot_design");
    expect(plot).toContain("素材库 · 人物档案");
    expect(plot).toContain("素材库 · 反转桥段");
    expect(plot).not.toContain("风格库 · 冷峻文风");

    const draft = promptFor("draft");
    expect(draft).toContain("风格库 · 冷峻文风");
    expect(draft).toContain("素材库 · 人物档案");
    expect(draft).toContain("素材库 · 反转桥段");
    expect(draft).not.toContain("不应直接注入");
  });

  it("applies the same on-demand stage intersection to scripts", () => {
    const character = scriptPromptFor("character_design");
    expect(character).toContain("素材库 · 人物档案");
    expect(character).not.toContain("素材库 · 反转桥段");
    expect(character).not.toContain("风格库 · 冷峻文风");
    expect(character).toContain("正文摘录：人物关系设计参考。");
    expect(character).not.toContain("不应直接注入");

    const draft = scriptPromptFor("draft");
    expect(draft).toContain("素材库 · 人物档案");
    expect(draft).toContain("素材库 · 反转桥段");
    expect(draft).toContain("风格库 · 冷峻文风");
    expect(draft).not.toContain("不应直接注入");
  });
});
