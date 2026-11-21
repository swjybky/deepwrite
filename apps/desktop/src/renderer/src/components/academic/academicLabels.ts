import type {
  AcademicBookSubtype,
  AcademicCitationStyle
} from "@deepwrite/contracts/renderer";
import { registerFeatureMessages } from "../../i18n";
import {
  academicCitationStyleLabel,
  academicSubtypeLabel
} from "./academicTreeLabels";

export const academicT = registerFeatureMessages("academic", {
  "zh-CN": {
    academicWriting: "学术写作",
    academicBookNoun: "学术作品",
    academicWritingDesc: "研究底座、论证框架、文献证据卡与单层/章节三联正文",
    createAcademicBook: "创建学术作品",
    academicWorkTitlePlaceholder: "输入论文、综述、学位论文或申报书标题...",
    subtypeLabel: "学术文体子类型",
    citationStyleLabel: "引用与参考文献体例",
    defaultFrameworkStagesLabel: "默认启用的论证框架阶段",
    defaultFrameworkStagesHint:
      "创建后仍可在作品内随时开关、排序、编辑说明或增删自定义阶段。",
    selectAtLeastOneFrameworkStage: "请至少保留一个启用的论证框架阶段。",
    subtypeDesc_empirical_paper:
      "单层节结构（含摘要与参考文献），适合理工与实证研究论文",
    subtypeDesc_humanities_paper:
      "单层节结构（含摘要与参考文献），适合理论阐释与人文社科论文",
    subtypeDesc_literature_review:
      "单层节结构，聚焦学术演进脉络、分类体系与方法对比矩阵",
    subtypeDesc_thesis_dissertation:
      "默认初始化「章 → 节」两级目录（含中英文摘要与参考文献），支撑数万字大论文",
    subtypeDesc_proposal_grant: "立项依据、研究内容、技术路线与可行性分析结构",
    subtypeDesc_tech_report_article:
      "核心洞见与降维叙事提纲，默认不限制引用体例",
    citationDesc_gbt7714: "国标顺序编码制 [1] 与文末规范题录",
    citationDesc_apa: "作者-出版年制 (Author, Year) 与字母序题录",
    citationDesc_ieee: "方括号编号 [1], [2] 与英文缩写题录",
    citationDesc_latex: "LaTeX \\cite{citeKey} 命令与结构化题录",
    citationDesc_none: "不强制学术引用体例，适合技术报告与解读稿",
    frameworkTabStages: "框架阶段",
    frameworkSettingsDescription: "选择作品的学术文体和参考文献体例。",
    deleteStageTitle: "删除阶段「{title}」？",
    deleteStageDescription: "阶段及其关联文档将从当前作品中永久删除。",
    frameworkTabBookSettings: "写作设置",
    frameworkStageHint:
      "每个学术作品独立维护自己的论证阶段，不会影响其他作品。至少保留一个启用阶段。",
    stageEnabled: "启用",
    stageDisabled: "未启用",
    builtinStageBadge: "内置",
    customStageBadge: "自定义",
    newCustomStageTitle: "新增自定义论证阶段",
    editStageTitle: "编辑阶段名称与交付要求",
    stageNameLabel: "阶段名称",
    stageNamePlaceholder: "例如：形式化证明规划、田野访谈提纲",
    stageDescLabel: "阶段交付说明",
    stageDescPlaceholder: "说明本阶段需要厘清的论证目标、输出结构与边界...",
    addStageButton: "添加阶段",
    saveStageButton: "保存修改",
    cancelEditButton: "取消",
    saveBookMetaButton: "保存文体与体例",
    savingButton: "保存中...",
    closeButton: "关闭",
    cardBarEyebrow: "文献与证据卡",
    cardTypeLiteratureFull: "文献卡（题录与结论）",
    cardTypeEvidenceFull: "数据证据卡（实验/统计/史料）",
    editCardButton: "编辑卡片属性",
    importFromMaterialsButton: "从素材库导入卡片",
    createCardDialogTitle: "新建文献 / 证据卡",
    editCardDialogTitle: "编辑文献 / 证据卡",
    deleteCardDialogTitle: "删除文献 / 证据卡",
    deleteCardWarning:
      "将从当前学术作品移除卡片 [{citeKey}]「{title}」及其本地卡片文件。此操作不可撤销。",
    citeKeyLabel: "唯一引用键 (citeKey)",
    citeKeyPlaceholder: "例如：vaswani2017、exp_ablation_main",
    citeKeyHint: "仅限字母、数字、下划线、连字符与冒号，同一作品内唯一。",
    cardTypeLabel: "卡片类型",
    cardTitleLabel: "展示标题",
    cardTitlePlaceholder:
      "例如：Vaswani et al., 2017 - Attention Is All You Need",
    cardInitialContentLabel: "初始核实摘要 / 题录（可选）",
    cardInitialContentPlaceholder:
      "可填写已核实的题录、DOI、核心结论、实验数值或统计口径...",
    invalidCiteKeyWarning:
      "请输入合法的 citeKey（仅允许字母、数字、下划线、连字符与冒号，不超过 120 字符）。",
    enterCardTitleWarning: "请输入卡片展示标题。",
    duplicateCiteKeyError:
      "当前作品已存在引用键「{citeKey}」，请更换唯一的 citeKey。",
    createCardButton: "创建卡片",
    creatingButton: "创建中...",
    deleteConfirmButton: "确认删除",
    deletingButton: "删除中...",
    importDialogTitle: "从已绑定素材库导入文献 / 证据卡",
    importDialogDesc:
      "勾选素材库条目一键转为本作品的文献卡或数据证据卡，导入前可调整每张卡的 citeKey 与卡片类型。",
    noBoundMaterialsHint:
      "当前学术作品尚未绑定任何素材库，或已绑定的素材库暂无条目。请先在作品菜单「素材库绑定」中关联素材库。",
    searchMaterialEntriesPlaceholder: "搜索素材库或条目标题...",
    selectAllVisible: "全选当前筛选",
    clearSelection: "清空勾选",
    selectedImportCount: "已勾选 {count} 条待导入",
    importButton: "导入为卡片 ({count})",
    importingButton: "导入中...",
    importedCardsSuccess: "已导入 {count} 张文献/证据卡。",
    selectEntriesToImportWarning: "请先勾选至少一条素材条目。",
    manuscriptCreateChapterTitle: "新建章（Chapter）",
    manuscriptCreateChapterDesc:
      "创建章节点后，正文目录可按「章 → 节」两级组织；未分配章的小节（如摘要、参考文献）仍可保留在顶层。",
    manuscriptRenameChapterTitle: "重命名章",
    manuscriptDeleteChapterTitle: "删除章",
    manuscriptDeleteChapterDesc:
      "删除章「{title}」不会删除其下小节，章内小节将自动回到顶层正文列表，正文内容完整保留。",
    chapterTitleLabel: "章标题",
    chapterTitlePlaceholder: "例如：第一章 绪论、Chapter 1 Introduction",
    enterChapterTitleWarning: "请输入章标题。",
    manuscriptCreateSectionTitle: "新建正文小节",
    manuscriptEditSectionTitle: "编辑小节与所属章",
    manuscriptDeleteSectionTitle: "删除正文小节",
    manuscriptDeleteSectionWarning:
      "将删除小节「{title}」及其写作指引、正文与节末状态三份文档。作品至少需保留一个小节。",
    sectionTitleLabel: "小节标题",
    sectionTitlePlaceholder: "例如：1.1 研究背景与问题定义、实验设置",
    enterSectionTitleWarning: "请输入小节标题。",
    parentChapterLabel: "所属章（可选）",
    unchapteredTopLevel: "不归属章（顶层小节，如摘要 / 参考文献）",
    wordCountRequirementLabel: "篇幅与写作目标备注（可选）",
    wordCountRequirementPlaceholder:
      "例如：约 1500 字，重点交代对比基线与评估指标",
    createChapterButton: "创建章",
    createSectionButton: "创建小节",
    saveChangesButton: "保存更改",
    writingContextHint:
      "记录本作品全局写作约定、目标期刊/学位规范、数学符号习惯或审稿红线（保存至项目目录 AGENTS.md）。",
    saveWritingContextButton: "保存项目指令",
    savedFrameworkToast: "已更新论证框架配置。",
    savedBookMetaToast: "已更新学术文体与引用体例。",
    savedCardToast: "已保存文献/证据卡。",
    deletedCardToast: "已删除文献/证据卡。",
    savedManuscriptToast: "已更新正文目录结构。",
    savedWritingContextToast: "已保存项目指令。",
    academicTitlePlaceholder: "输入论文、综述、学位论文或申报书标题...",
    frameworkStagesEnabledLabel: "默认启用的论证框架阶段",
    keepAtLeastOneFrameworkStage: "请至少保留一个启用的论证框架阶段。",
    enterStageName: "请输入论证阶段名称。",
    enterStageDescription: "请输入论证阶段交付说明。",
    duplicateStageName: "阶段名称「{title}」已存在。",
    builtinStageCannotDelete:
      "内置论证阶段不可删除；如不需要可将其设为未启用。",
    close: "关闭",
    cancel: "取消",
    create: "创建",
    save: "保存",
    saving: "保存中...",
    delete: "删除",
    frameworkTabSettings: "体例与文体",
    frameworkPerBookNote:
      "每个学术作品独立维护自己的论证阶段，不会影响其他作品。至少保留一个启用阶段。",
    newStage: "新增阶段",
    editStage: "编辑阶段",
    stageName: "阶段名称",
    stageDescription: "阶段交付说明",
    stageDescriptionHint: "说明本阶段需要厘清的论证目标、输出结构与边界...",
    builtinStage: "内置",
    customStage: "自定义",
    frameworkSaveFailed: "更新论证框架失败。",
    settingsSavedToast: "已保存学术文体与引用体例。",
    settingsSaveFailed: "保存作品设置失败。",
    cardSavedToast: "已保存文献/证据卡。",
    cardDeletedToast: "已删除文献/证据卡。",
    cardSaveFailed: "保存文献/证据卡失败。",
    copiedCiteKey: "已复制引用键 {citeKey}",
    cardDialogEyebrow: "文献与证据卡",
    newCardTitle: "新建文献 / 证据卡",
    editCardTitle: "编辑文献 / 证据卡",
    deleteCardTitle: "删除文献 / 证据卡",
    deleteCardConfirm:
      "确认移除卡片 [{citeKey}]「{title}」及其本地文档？此操作不可撤销。",
    citeKeyRuleHint: "仅限字母、数字、下划线、连字符与冒号，同一作品内唯一。",
    cardInitialBodyLabel: "初始核实摘要 / 题录（可选）",
    cardInitialBodyPlaceholder:
      "可填写已核实的题录、DOI、核心结论、实验数值或统计口径...",
    invalidCiteKeyError:
      "请输入合法的 citeKey（仅允许字母、数字、下划线、连字符与冒号，不超过 120 字符）。",
    enterCardTitleError: "请输入卡片展示标题。",
    importCardsDialogEyebrow: "素材库转卡片",
    importCardsDialogTitle: "从已绑定素材库导入文献 / 证据卡",
    importCardsDialogDesc:
      "勾选素材库条目转为本作品的文献卡或数据证据卡，导入前可调整 citeKey 与卡片类型。",
    noBoundMaterialLibraries:
      "当前学术作品尚未绑定任何素材库。请先在作品菜单「素材库绑定」中关联素材库。",
    noImportableMaterialEntries: "已绑定的素材库中暂无非空条目。",
    importCardsSearchPlaceholder: "搜索素材库或条目标题...",
    importCardsSelectAll: "全选当前筛选",
    importCardsClearAll: "清空勾选",
    importSelectedCount: "导入选中 ({count})",
    importedCardsToast: "已导入 {count} 张文献/证据卡。",
    importCardsFailed: "导入文献/证据卡失败。",
    manuscriptDialogEyebrow: "学术正文结构",
    newChapterTitle: "新建章",
    renameChapterTitle: "重命名章",
    deleteChapterTitle: "删除章",
    newSectionTitle: "新建小节",
    editSectionTitle: "编辑小节与所属章",
    deleteSectionTitle: "删除小节",
    unassignedChapterOption: "顶层小节（不归属章，如摘要 / 参考文献）",
    enterChapterTitleError: "请输入章标题。",
    enterSectionTitleError: "请输入小节标题。",
    keepAtLeastOneSection: "学术作品至少需要保留一个正文小节。",
    deleteChapterWithSectionsConfirm:
      "删除章「{title}」后，其下 {count} 个小节将自动回到顶层正文列表，正文内容完整保留。",
    deleteEmptyChapterConfirm: "确认删除空章「{title}」？",
    deleteSectionConfirm:
      "确认删除小节「{title}」及其写作指引、正文与节末状态三份文档？",
    sectionChapterLabel: "所属章（可选）",
    sectionWordCountLabel: "篇幅与写作目标备注（可选）",
    sectionWordCountPlaceholder: "例如：约 1500 字，交代对比基线与评估指标",
    manuscriptSaveFailed: "更新正文结构失败。",
    exportDialogTitle: "导出学术稿件",
    exportScopeNote:
      "仅导出勾选小节的「正文」，不包含研究底座、论证框架、写作指引与节末状态。默认全选非空正文小节（含摘要与参考文献）。",
    exportSectionsLegend: "导出小节",
    exportSelectNonEmpty: "全选非空",
    exportClearAll: "清空",
    exportIncludeChapterHeadings: "包含章标题层级",
    exportIncludeChapterHeadingsHint:
      "开启后按「章 → 节」输出标题层级；关闭后所有选中节平铺输出。",
    exportFormatDocxTitle: "Word 文档 (.docx)",
    exportFormatDocxDesc:
      "标准多级标题样式、学术三线表、居中插图图注与公式/代码排版",
    exportFormatMdTitle: "Markdown (.md)",
    exportFormatMdDesc:
      "UTF-8 学术 Markdown，完整保留 LaTeX 公式、表格与代码块",
    exportMdImageModeLegend: "图片导出方式",
    exportMdImageAssetsFolderTitle: "同级 .assets 文件夹",
    exportMdImageAssetsFolderDesc:
      "复制正文插图到同名 .assets 目录并改写相对路径",
    exportMdImageSingleFileTitle: "单文件 (.md)",
    exportMdImageSingleFileDesc: "仅输出单个 Markdown 文本文件，不复制图片目录",
    exportedDocxToast: "已导出学术稿件「{title}」(.docx)。",
    exportedMdToast: "已导出学术稿件「{title}」(.md)。",
    exportedWithMissingImagesToast:
      "稿件已导出，其中 {count} 张正文插图在本地缺失。",
    exportSelectAtLeastOneSection: "请至少勾选一个要导出的正文小节。",
    exportManuscriptFailed: "导出学术稿件失败。"
  },
  "en-US": {
    academicWriting: "Academic",
    academicBookNoun: "Academic Work",
    academicWritingDesc:
      "Research foundation, argument framework, reference cards, and 3-part manuscript sections",
    createAcademicBook: "Create Academic Work",
    academicWorkTitlePlaceholder:
      "Enter paper, review, dissertation, or grant proposal title...",
    subtypeLabel: "Academic Subtype",
    citationStyleLabel: "Citation & Bibliography Style",
    defaultFrameworkStagesLabel: "Default Enabled Framework Stages",
    defaultFrameworkStagesHint:
      "You can toggle, reorder, edit instructions, or add custom stages inside the work anytime.",
    selectAtLeastOneFrameworkStage:
      "Keep at least one enabled argument framework stage.",
    subtypeDesc_empirical_paper:
      "Flat sections (with Abstract & References) for STEM and empirical papers",
    subtypeDesc_humanities_paper:
      "Flat sections (with Abstract & References) for humanities and social sciences",
    subtypeDesc_literature_review:
      "Flat sections focused on research lineage, taxonomy, and comparison matrices",
    subtypeDesc_thesis_dissertation:
      "Two-level Chapter → Section tree (with bilingual abstracts & References) for theses",
    subtypeDesc_proposal_grant:
      "Rationale, research content, technical roadmap, and feasibility structure",
    subtypeDesc_tech_report_article:
      "Core insights and accessible outline with unrestricted citation style by default",
    citationDesc_gbt7714:
      "GB/T 7714 sequential numeric [1] and formatted bibliography",
    citationDesc_apa:
      "APA 7th author-date (Author, Year) and alphabetical references",
    citationDesc_ieee:
      "IEEE bracketed numeric [1], [2] and abbreviated references",
    citationDesc_latex: "LaTeX \\cite{citeKey} commands and structured entries",
    citationDesc_none: "No strict citation format required",
    frameworkTabStages: "Framework Stages",
    frameworkSettingsDescription:
      "Choose the academic writing type and citation style for this work.",
    deleteStageTitle: 'Delete stage "{title}"?',
    deleteStageDescription:
      "The stage and its associated document will be permanently deleted from this work.",
    frameworkTabBookSettings: "Writing Settings",
    frameworkStageHint:
      "Each academic work maintains its own independent framework stages. Keep at least one stage enabled.",
    stageEnabled: "Enabled",
    stageDisabled: "Disabled",
    builtinStageBadge: "Built-in",
    customStageBadge: "Custom",
    newCustomStageTitle: "Add Custom Framework Stage",
    editStageTitle: "Edit Stage Title & Deliverable",
    stageNameLabel: "Stage title",
    stageNamePlaceholder: "e.g. Formal Proof Plan, Fieldwork Protocol",
    stageDescLabel: "Deliverable instructions",
    stageDescPlaceholder:
      "Describe the argument goal, expected structure, and boundaries of this stage...",
    addStageButton: "Add stage",
    saveStageButton: "Save stage",
    cancelEditButton: "Cancel",
    saveBookMetaButton: "Save subtype & citation",
    savingButton: "Saving...",
    closeButton: "Close",
    cardBarEyebrow: "Reference Card",
    cardTypeLiteratureFull: "Literature Card (Bibliographic & Takeaways)",
    cardTypeEvidenceFull: "Evidence Card (Verified Data / Results)",
    editCardButton: "Edit Card Metadata",
    importFromMaterialsButton: "Import from Materials",
    createCardDialogTitle: "New Reference / Evidence Card",
    editCardDialogTitle: "Edit Reference / Evidence Card",
    deleteCardDialogTitle: "Delete Reference / Evidence Card",
    deleteCardWarning:
      'Remove card [{citeKey}] "{title}" and its Markdown file from this academic work? This cannot be undone.',
    citeKeyLabel: "Unique citation key (citeKey)",
    citeKeyPlaceholder: "e.g. vaswani2017, exp_ablation_main",
    citeKeyHint:
      "Letters, digits, underscores, hyphens, and colons only; unique within this work.",
    cardTypeLabel: "Card type",
    cardTitleLabel: "Display title",
    cardTitlePlaceholder:
      "e.g. Vaswani et al., 2017 - Attention Is All You Need",
    cardInitialContentLabel: "Initial verified notes / citation (optional)",
    cardInitialContentPlaceholder:
      "Paste verified citation details, DOI, key findings, or experimental figures...",
    invalidCiteKeyWarning:
      "Enter a valid citeKey (letters, digits, _, -, : up to 120 characters).",
    enterCardTitleWarning: "Enter a display title for the card.",
    duplicateCiteKeyError:
      'Citation key "{citeKey}" already exists in this work. Choose a unique citeKey.',
    createCardButton: "Create card",
    creatingButton: "Creating...",
    deleteConfirmButton: "Delete",
    deletingButton: "Deleting...",
    importDialogTitle: "Import Cards from Linked Material Libraries",
    importDialogDesc:
      "Select entries from linked material libraries to create reference or evidence cards. You can customize each citeKey and card type before importing.",
    noBoundMaterialsHint:
      "No material libraries with entries are linked to this work yet. Link material libraries from the work menu first.",
    searchMaterialEntriesPlaceholder:
      "Search material library or entry title...",
    selectAllVisible: "Select visible",
    clearSelection: "Clear",
    selectedImportCount: "{count} selected to import",
    importButton: "Import Cards ({count})",
    importingButton: "Importing...",
    importedCardsSuccess: "Imported {count} reference/evidence cards.",
    selectEntriesToImportWarning:
      "Select at least one material entry to import.",
    manuscriptCreateChapterTitle: "New Chapter",
    manuscriptCreateChapterDesc:
      "Chapters organize sections into a two-level Chapter → Section tree while keeping unchaptered front/back matter at top level.",
    manuscriptRenameChapterTitle: "Rename Chapter",
    manuscriptDeleteChapterTitle: "Delete Chapter",
    manuscriptDeleteChapterDesc:
      'Deleting chapter "{title}" keeps all its sections intact and moves them to top level.',
    chapterTitleLabel: "Chapter title",
    chapterTitlePlaceholder: "e.g. Chapter 1 Introduction",
    enterChapterTitleWarning: "Enter a chapter title.",
    manuscriptCreateSectionTitle: "New Manuscript Section",
    manuscriptEditSectionTitle: "Edit Section & Chapter Assignment",
    manuscriptDeleteSectionTitle: "Delete Manuscript Section",
    manuscriptDeleteSectionWarning:
      'Delete section "{title}" and its Brief, Body, and End State documents?',
    sectionTitleLabel: "Section title",
    sectionTitlePlaceholder: "e.g. 1.1 Background & Problem Statement",
    enterSectionTitleWarning: "Enter a section title.",
    parentChapterLabel: "Parent chapter (optional)",
    unchapteredTopLevel: "Top-level (unchaptered, e.g. Abstract / References)",
    wordCountRequirementLabel: "Target length & notes (optional)",
    wordCountRequirementPlaceholder:
      "e.g. ~1,500 words, cover baselines and metrics",
    createChapterButton: "Create chapter",
    createSectionButton: "Create section",
    saveChangesButton: "Save changes",
    writingContextHint:
      "Project-wide instructions, target venue/degree guidelines, notation rules, or review guardrails (saved in AGENTS.md).",
    saveWritingContextButton: "Save instructions",
    savedFrameworkToast: "Updated argument framework stages.",
    savedBookMetaToast: "Updated academic subtype and citation style.",
    savedCardToast: "Saved reference card.",
    deletedCardToast: "Deleted reference card.",
    savedManuscriptToast: "Updated manuscript structure.",
    savedWritingContextToast: "Saved project instructions.",
    academicTitlePlaceholder:
      "Enter paper, review, dissertation, or grant proposal title...",
    frameworkStagesEnabledLabel: "Default Enabled Framework Stages",
    keepAtLeastOneFrameworkStage:
      "Keep at least one enabled argument framework stage.",
    enterStageName: "Enter a framework stage title.",
    enterStageDescription: "Enter stage deliverable instructions.",
    duplicateStageName: 'Stage title "{title}" already exists.',
    builtinStageCannotDelete:
      "Built-in stages cannot be deleted; disable the stage instead.",
    close: "Close",
    cancel: "Cancel",
    create: "Create",
    save: "Save",
    saving: "Saving...",
    delete: "Delete",
    frameworkTabSettings: "Subtype & Citation",
    frameworkPerBookNote:
      "Each academic work maintains its own independent framework stages. Keep at least one stage enabled.",
    newStage: "Add Stage",
    editStage: "Edit",
    stageName: "Stage title",
    stageDescription: "Deliverable instructions",
    stageDescriptionHint:
      "Describe the argument goal, expected structure, and boundaries...",
    builtinStage: "Built-in",
    customStage: "Custom",
    frameworkSaveFailed: "Failed to update argument framework.",
    settingsSavedToast: "Saved academic subtype and citation style.",
    settingsSaveFailed: "Failed to save academic settings.",
    cardSavedToast: "Saved reference card.",
    cardDeletedToast: "Deleted reference card.",
    cardSaveFailed: "Failed to save reference card.",
    copiedCiteKey: "Copied citation key {citeKey}",
    cardDialogEyebrow: "Reference Card",
    newCardTitle: "New Reference / Evidence Card",
    editCardTitle: "Edit Reference / Evidence Card",
    deleteCardTitle: "Delete Reference / Evidence Card",
    deleteCardConfirm:
      'Remove card [{citeKey}] "{title}" and its file from this work? This cannot be undone.',
    citeKeyRuleHint:
      "Letters, digits, underscores, hyphens, and colons only; unique within this work.",
    cardInitialBodyLabel: "Initial verified notes / citation (optional)",
    cardInitialBodyPlaceholder:
      "Paste verified citation details, DOI, key findings, or experimental figures...",
    invalidCiteKeyError:
      "Enter a valid citeKey (letters, digits, _, -, : up to 120 characters).",
    enterCardTitleError: "Enter a display title for the card.",
    importCardsDialogEyebrow: "Import Reference Cards",
    importCardsDialogTitle: "Import Cards from Linked Material Libraries",
    importCardsDialogDesc:
      "Select entries from linked material libraries to create reference or evidence cards.",
    noBoundMaterialLibraries:
      "No material libraries are linked to this work yet. Link material libraries from the work menu first.",
    noImportableMaterialEntries:
      "Linked material libraries have no non-empty entries yet.",
    importCardsSearchPlaceholder: "Search material library or entry title...",
    importCardsSelectAll: "Select visible",
    importCardsClearAll: "Clear",
    importSelectedCount: "Import Selected ({count})",
    importedCardsToast: "Imported {count} reference/evidence cards.",
    importCardsFailed: "Failed to import reference cards.",
    manuscriptDialogEyebrow: "Manuscript Structure",
    newChapterTitle: "New Chapter",
    renameChapterTitle: "Rename Chapter",
    deleteChapterTitle: "Delete Chapter",
    newSectionTitle: "New Section",
    editSectionTitle: "Edit Section & Chapter",
    deleteSectionTitle: "Delete Section",
    unassignedChapterOption:
      "Top-level section (unchaptered, e.g. Abstract / References)",
    enterChapterTitleError: "Enter a chapter title.",
    enterSectionTitleError: "Enter a section title.",
    keepAtLeastOneSection: "Keep at least one manuscript section.",
    deleteChapterWithSectionsConfirm:
      'Deleting chapter "{title}" keeps its {count} sections intact and moves them to top level.',
    deleteEmptyChapterConfirm: 'Delete empty chapter "{title}"?',
    deleteSectionConfirm:
      'Delete section "{title}" and its Brief, Body, and End State documents?',
    sectionChapterLabel: "Parent chapter (optional)",
    sectionWordCountLabel: "Target length & notes (optional)",
    sectionWordCountPlaceholder:
      "e.g. ~1,500 words, cover baselines and metrics",
    manuscriptSaveFailed: "Failed to update manuscript structure.",
    exportDialogTitle: "Export Academic Manuscript",
    exportScopeNote:
      "Exports only the Body of selected sections (excluding Foundation, Framework, Briefs, and End States). Non-empty sections (including Abstract and References) are selected by default.",
    exportSectionsLegend: "Sections to export",
    exportSelectNonEmpty: "Select non-empty",
    exportClearAll: "Clear",
    exportIncludeChapterHeadings: "Include chapter heading hierarchy",
    exportIncludeChapterHeadingsHint:
      "Emit Chapter → Section heading hierarchy; uncheck to flatten sections.",
    exportFormatDocxTitle: "Word Document (.docx)",
    exportFormatDocxDesc:
      "Heading1–3 styles, three-line academic tables, centered figures, formulas & code blocks",
    exportFormatMdTitle: "Markdown (.md)",
    exportFormatMdDesc:
      "UTF-8 Markdown preserving LaTeX formulas, GFM tables, and fenced code blocks",
    exportMdImageModeLegend: "Markdown Image Handling",
    exportMdImageAssetsFolderTitle: "Sibling .assets folder",
    exportMdImageAssetsFolderDesc:
      "Copy figures into <name>.assets/ next to the .md file and rewrite links",
    exportMdImageSingleFileTitle: "Single file (.md)",
    exportMdImageSingleFileDesc:
      "Write a single .md file directly without copying an assets folder",
    exportedDocxToast: 'Exported "{title}" (.docx).',
    exportedMdToast: 'Exported "{title}" (.md).',
    exportedWithMissingImagesToast:
      "Manuscript exported with {count} missing figure image(s).",
    exportSelectAtLeastOneSection:
      "Select at least one manuscript section to export.",
    exportManuscriptFailed: "Failed to export academic manuscript."
  }
});

export function academicSubtypeDescription(
  subtype: AcademicBookSubtype
): string {
  return academicT(`subtypeDesc_${subtype}`);
}

export function academicCitationStyleDescription(
  style: AcademicCitationStyle
): string {
  return academicT(`citationDesc_${style}`);
}

export { academicCitationStyleLabel, academicSubtypeLabel };
