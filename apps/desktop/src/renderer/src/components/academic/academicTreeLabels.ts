import type {
  AcademicBookSubtype,
  AcademicCitationStyle,
  AcademicFrameworkStage,
  AcademicReferenceCardType
} from "@deepwrite/contracts/renderer";
import { registerFeatureMessages } from "../../i18n";

export const academicTreeT = registerFeatureMessages("academicTree", {
  "zh-CN": {
    academicWork: "学术",
    academicAgent: "学术主创智能体",
    academicAgentDesc:
      "贯穿研究立意、文献证据卡、论证框架与三联正文的统一学术主创智能体。",
    academicWelcomeTitle: "从研究立意、论证框架或当前小节开始",
    academicWelcomeDesc:
      "我是你的学术主创智能体，协助梳理研究问题、文献与证据卡、论证框架及正文撰写。",
    academicShortcut1: "先讨论研究问题、核心贡献与立题切入点",
    academicShortcut2: "结合研究底座梳理当前论证框架阶段",
    academicShortcut3: "按写作指引与文献证据卡起草或审校当前小节",
    academicWritingModule: "学术写作",
    academicWritingModuleDesc: "学术作品创作与学术团队协作",
    academicContext: "项目指令 (AGENTS.md)",
    zoneFoundation: "研究底座",
    zoneFramework: "论证框架",
    zoneManuscript: "正文编写",
    thesisOverview: "研究立意与核心贡献",
    terminology: "术语与符号表",
    referenceCards: "文献与证据卡",
    cardLiterature: "文献",
    cardEvidence: "证据",
    tabBrief: "写作指引",
    tabBody: "正文",
    tabState: "节末状态",
    briefHint: "本节核心论点、必引 citeKey、图表规划与篇幅目标",
    stateHint: "本节首次定义的符号缩写、实际引用与跨节承诺",
    newCard: "新建文献/证据卡",
    importCardFromMaterials: "从已绑定素材库导入卡片",
    editCard: "编辑卡片信息",
    deleteCard: "删除卡片",
    manageFramework: "配置论证框架",
    newChapter: "新建章",
    newSection: "新建小节",
    exportManuscript: "导出稿件",
    addSectionToChapter: "在本章下新建小节",
    renameChapter: "重命名章",
    deleteChapter: "删除章",
    editSectionMeta: "编辑小节与所属章",
    deleteSection: "删除小节",
    moveUp: "上移",
    moveDown: "下移",
    copyCiteKey: "复制 citeKey",
    copiedCiteKey: "已复制引用键 [{key}]",
    subtype_empirical_paper: "实证 / 理工论文",
    subtype_humanities_paper: "人文社科论文",
    subtype_literature_review: "文献综述",
    subtype_thesis_dissertation: "硕博学位论文",
    subtype_proposal_grant: "开题 / 基金申报",
    subtype_tech_report_article: "学术解读 / 技术报告",
    citation_gbt7714: "GB/T 7714",
    citation_apa: "APA 第 7 版",
    citation_ieee: "IEEE 顺序编码",
    citation_latex: "LaTeX / BibTeX",
    citation_none: "不限制体例",
    stage_problem_and_gap: "立题与文献脉络",
    stage_method_framework: "方法与理论框架",
    stage_evidence_plan: "实验与论据规划",
    stage_argument_outline: "全文论证大纲"
  },
  "en-US": {
    academicWork: "Academic",
    academicAgent: "Academic Lead Agent",
    academicAgentDesc:
      "Unified academic lead agent across research foundation, reference cards, argument framework, and 3-part manuscript sections.",
    academicWelcomeTitle:
      "Start from your thesis, argument framework, or active section",
    academicWelcomeDesc:
      "I am your academic lead agent, helping refine research questions, reference cards, argument stages, and manuscript sections.",
    academicShortcut1:
      "Discuss the research question, core contributions, and framing",
    academicShortcut2:
      "Refine the current argument framework stage from the foundation",
    academicShortcut3:
      "Draft or review the active section using its brief and reference cards",
    academicWritingModule: "Academic Writing",
    academicWritingModuleDesc: "Academic workspace and specialist team runs",
    academicContext: "Project Instructions (AGENTS.md)",
    zoneFoundation: "Foundation",
    zoneFramework: "Argument Framework",
    zoneManuscript: "Manuscript",
    thesisOverview: "Thesis & Core Contributions",
    terminology: "Terminology & Notation",
    referenceCards: "Literature & Evidence Cards",
    cardLiterature: "Lit",
    cardEvidence: "Data",
    tabBrief: "Brief",
    tabBody: "Body",
    tabState: "End State",
    briefHint:
      "Core takeaway, required citeKeys, figure/table plan, and target length",
    stateHint:
      "Newly defined terms/notation, actual citations, and cross-section promises",
    newCard: "New Reference Card",
    importCardFromMaterials: "Import Cards from Linked Materials",
    editCard: "Edit Card Metadata",
    deleteCard: "Delete Card",
    manageFramework: "Configure Argument Framework",
    newChapter: "New Chapter",
    newSection: "New Section",
    exportManuscript: "Export Manuscript",
    addSectionToChapter: "Add Section in Chapter",
    renameChapter: "Rename Chapter",
    deleteChapter: "Delete Chapter",
    editSectionMeta: "Edit Section & Chapter",
    deleteSection: "Delete Section",
    moveUp: "Move up",
    moveDown: "Move down",
    copyCiteKey: "Copy citeKey",
    copiedCiteKey: "Copied citeKey [{key}]",
    subtype_empirical_paper: "Empirical / STEM Paper",
    subtype_humanities_paper: "Humanities & Social Science",
    subtype_literature_review: "Literature Review",
    subtype_thesis_dissertation: "Thesis / Dissertation",
    subtype_proposal_grant: "Proposal / Grant",
    subtype_tech_report_article: "Technical Report / Explainer",
    citation_gbt7714: "GB/T 7714",
    citation_apa: "APA 7th",
    citation_ieee: "IEEE Numeric",
    citation_latex: "LaTeX / BibTeX",
    citation_none: "Unrestricted",
    stage_problem_and_gap: "Problem & Literature Lineage",
    stage_method_framework: "Method & Theoretical Framework",
    stage_evidence_plan: "Evidence & Experiment Plan",
    stage_argument_outline: "Full Argument Outline"
  }
});

const BUILTIN_STAGE_DEFAULT_TITLES = new Map<string, string>([
  ["problem_and_gap", "立题与文献脉络"],
  ["method_framework", "方法与理论框架"],
  ["evidence_plan", "实验与论据规划"],
  ["argument_outline", "全文论证大纲"]
]);

export function academicSubtypeLabel(subtype: AcademicBookSubtype): string {
  return academicTreeT(`subtype_${subtype}`);
}

export function academicCitationStyleLabel(
  style: AcademicCitationStyle
): string {
  return academicTreeT(`citation_${style}`);
}

export function academicCardTypeBadge(
  cardType: AcademicReferenceCardType
): string {
  return cardType === "literature"
    ? academicTreeT("cardLiterature")
    : academicTreeT("cardEvidence");
}

export function academicFrameworkStageLabel(
  stage: Pick<AcademicFrameworkStage, "id" | "title">
): string {
  const builtinTitle = BUILTIN_STAGE_DEFAULT_TITLES.get(stage.id);
  if (builtinTitle && stage.title === builtinTitle) {
    if (
      stage.id === "problem_and_gap" ||
      stage.id === "method_framework" ||
      stage.id === "evidence_plan" ||
      stage.id === "argument_outline"
    ) {
      return academicTreeT(`stage_${stage.id}`);
    }
  }
  return stage.title;
}
