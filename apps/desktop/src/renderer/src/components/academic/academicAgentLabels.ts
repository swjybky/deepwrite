import { registerFeatureMessages } from "../../i18n";

export const academicAgentT = registerFeatureMessages("academicAgent", {
  "zh-CN": {
    tabLabel: "学术写作",
    loadingSettings: "正在加载学术智能体设置…",
    loadFailedTitle: "学术智能体设置尚未加载完成",
    reload: "重新加载",
    unavailable: "暂无可用的学术智能体配置。",
    eyebrow: "学术工作台",
    systemPromptTitle: "角色系统提示词",
    systemPromptDesc:
      "定义学术主创智能体的研究讨论习惯、行文风格与论证偏好。目录索引、引用体例硬约束、反幻觉红线及写入审批边界由系统自动注入，无需也不应写在此处。",
    charCount: "{count} 字",
    systemPromptAria: "学术主创智能体系统提示词",
    systemPromptPlaceholder: "输入学术主创智能体的系统提示词…",
    shortcutsTitle: "欢迎页快捷提问",
    shortcutsDesc: "新建空白对话时展示的 3 条快捷入口提示语。",
    shortcutLabel: "快捷提问 {index}",
    modelTitle: "默认模型配置",
    modelDesc:
      "默认跟随当前会话所选模型；也可为学术主创单独指定默认模型、思考档位与采样温度。",
    modelInherit: "跟随会话模型（默认）",
    modelCustom: "独立指定模型",
    modelSelectLabel: "选择模型",
    thinkingSelectLabel: "思考档位",
    temperatureSelectLabel: "温度",
    boundaryTitle: "固定运行边界（系统强约束）",
    boundaryZones:
      "读写范围：研究基石（研究立意、术语与符号表、文献与证据卡）、论证框架阶段、正文手稿（章与小节三联文档 brief / body / state）及作品已关联的素材库与技能库。",
    boundaryHardLines:
      "硬性红线：强制遵循作品引用体例（GB/T 7714 / APA / IEEE / LaTeX / 无体例）；严禁编造未经卡片或素材库核实的题录、DOI 与实验数据，缺失处强制输出 [待补引用] / [待补数据] 占位。",
    restoreDefaults: "恢复默认",
    saving: "保存中…",
    saveSettings: "保存学术智能体设置",
    incompleteWarning:
      "请完整填写系统提示词、3 条快捷提问及有效模型配置后再保存。",
    savedSuccess: "已保存学术主创智能体设置，将在下一轮对话生效。",
    saveFailed: "保存学术智能体设置失败。",
    restoredSuccess: "学术主创智能体已恢复默认配置。",
    restoreFailed: "恢复默认配置失败。",
    parentAgentDesc:
      "为学术主创智能体配置文献整理、闭卷撰稿、同行审稿、引用一致性核查与学术润色专员。"
  },
  "en-US": {
    tabLabel: "Academic",
    loadingSettings: "Loading academic agent settings…",
    loadFailedTitle: "Academic agent settings have not loaded",
    reload: "Reload",
    unavailable: "No academic agent settings available.",
    eyebrow: "Academic Workspace",
    systemPromptTitle: "Role System Prompt",
    systemPromptDesc:
      "Configure research discussion habits, prose style, and argumentation preferences. Directory trees, citation-style constraints, anti-hallucination hard lines, and write-approval boundaries are injected automatically.",
    charCount: "{count} chars",
    systemPromptAria: "Academic lead agent system prompt",
    systemPromptPlaceholder: "Enter system prompt for the academic lead agent…",
    shortcutsTitle: "Welcome Shortcuts",
    shortcutsDesc:
      "Three quick-start prompts shown on empty academic conversations.",
    shortcutLabel: "Shortcut {index}",
    modelTitle: "Default Model Configuration",
    modelDesc:
      "Follows the active conversation model by default, or uses a dedicated default model, reasoning level, and temperature.",
    modelInherit: "Follow session model (default)",
    modelCustom: "Dedicated model configuration",
    modelSelectLabel: "Model",
    thinkingSelectLabel: "Reasoning level",
    temperatureSelectLabel: "Temperature",
    boundaryTitle: "Runtime Guardrails (Non-Editable)",
    boundaryZones:
      "Scope: Research Foundation (Thesis Overview, Terminology, Reference Cards), Argument Framework Stages, 3-part Manuscript Sections (Brief / Body / State), and linked Material & Skill Libraries.",
    boundaryHardLines:
      "Hard guardrails: Enforces the work's citation style (GB/T 7714 / APA / IEEE / LaTeX / Unrestricted); strictly forbids fabricating unverified citations, DOIs, or empirical numbers, requiring explicit [Citation needed] / [Data needed] placeholders.",
    restoreDefaults: "Restore Defaults",
    saving: "Saving…",
    saveSettings: "Save Academic Agent Settings",
    incompleteWarning:
      "Complete the system prompt, all 3 welcome shortcuts, and valid model settings before saving.",
    savedSuccess: "Saved academic agent settings for subsequent turns.",
    saveFailed: "Failed to save academic agent settings.",
    restoredSuccess: "Restored default academic agent settings.",
    restoreFailed: "Failed to restore default academic agent settings.",
    parentAgentDesc:
      "Configure specialist assistants for literature curation, section drafting, peer review, citation auditing, and academic polishing."
  }
});
