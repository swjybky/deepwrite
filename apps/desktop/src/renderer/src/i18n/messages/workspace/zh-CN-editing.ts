export default {
  docxDocumentText: {
    theWordDocumentZipDirectoryIsCorrupt: "Word 文档 ZIP 目录损坏。",
    aZipFilenameInTheWordDocumentIsCorrupt: "Word 文档 ZIP 文件名损坏。",
    theWordDocumentXmlIsTooLargeToRead:
      "Word 文档正文 XML 过大，无法安全读取。",
    passwordProtectedWordDocumentsAreNotSupported:
      "受密码保护的 Word 文档暂时无法读取。",
    theWordDocumentZipContentsAreCorrupt: "Word 文档 ZIP 内容损坏。",
    theWordDocumentZipDataIsIncomplete: "Word 文档 ZIP 数据不完整。",
    zipCompressionMethodInThisWordDocumentIsNot:
      "暂不支持 Word 文档使用的 ZIP 压缩方式 {compressionMethod}。",
    theWordDocumentIsMissingWordDocumentXml:
      "Word 文档中缺少 word/document.xml。"
  },
  approvalNavigation: {
    overallStoryline: "全书故事线",
    foreshadowingOverview: "伏笔总览"
  },
  promptAttachments: {
    imageExceedsMbAndCannotBeSentToThe:
      "图片“{name}”超过 10 MB，无法作为模型图片输入。",
    pdfHasNoExtractableTextRunOcrOnScanned:
      "PDF“{name}”没有可提取的文本；扫描版 PDF 请先完成 OCR。",
    fileContainsNoReadableText: "文件“{name}”没有可读取的文本内容。",
    isTooLongOnlyTheFirstCharactersAreAttached:
      "“{name}”文本较长，仅携带前 {toLocaleString} 个字符。",
    textFileExceedsMbReduceItsSizeBeforeUploading:
      "文本文件“{name}”超过 5 MB，请缩小后再上传。",
    pdfExceedsMbSplitOrCompressItBeforeUploading:
      "PDF“{name}”超过 20 MB，请拆分或压缩后再上传。",
    unknownPdfParsingError: "未知 PDF 解析错误",
    pdfIsPasswordProtectedAndCannotBeRead:
      "PDF“{name}”受密码保护，暂时无法读取。",
    failedToReadPdf: "读取 PDF“{name}”失败：{message}",
    wordDocumentExceedsMbSplitOrCompressItBefore:
      "Word“{name}”超过 25 MB，请拆分或压缩后再上传。",
    unknownWordParsingError: "未知 Word 解析错误",
    failedToReadWordDocument: "读取 Word“{name}”失败：{message}",
    theFileTypeOfIsNotSupportedChooseTxt:
      "不支持“{name}”的文件类型；请选择 TXT、MD、PDF、Word（.docx）或常见图片。"
  },
  editorEntrySearch: {
    manuscript: "{title} · 正文",
    characterState: "{title} · 人物状态",
    characterOverview: "人物概览",
    searching: "搜索中…",
    failedToSearchAllEntries: "搜索全部条目失败。",
    noMatchingEntriesFound: "未找到匹配条目",
    enterASearchTerm: "请输入搜索内容"
  },
  editorFindReplace: {
    noResults: "无结果",
    enterTextToFind: "请输入要查找的文字",
    noMatchingTextFound: "未找到匹配文字",
    noTextToReplace: "未找到可替换的文字",
    enterTextToReplace: "请输入要替换的文字",
    findAndReplacementTextAreTheSame: "查找文字与替换文字相同",
    replacedMatches: "已替换 {length} 处文字"
  },
  markdownOutline: {
    untitledHeading: "未命名标题"
  },
  acceptedEditDiscardPersistence: {
    thePreviousDiscardWasNotConfirmedTheCurrentVersion:
      "上次舍弃未确认完成；重试前会重新校验当前版本。"
  },
  agentEditReview: {
    manuscriptFileEditsCanOnlyBeAppliedToThe:
      "正文文件修改只能应用到正文目录。",
    characterFileEditsCanOnlyBeAppliedToThe:
      "人物文件修改只能应用到人物设计阶段。"
  },
  agentTeamModeAvailability: {
    loadingAgentTeamConfiguration: "正在加载智能体团队配置…",
    failedToLoadAgentTeamsRetryFromTheAgent:
      "智能体团队配置加载失败，请到智能体团队页面重试。",
    agentTeamConfigurationHasNotLoadedYet: "智能体团队配置尚未加载。",
    thisAgentHasNoEnabledTeamWithAvailableMembers:
      "当前智能体没有已启用且含可用成员的团队，请先到智能体团队设置中配置。",
    allowThisMainAgentToCallSubagentsInEnabled:
      "允许当前主智能体调用已启用团队中的子智能体。"
  },
  marketplacePublishContent: {
    theSkillHasNoContentAndCannotBePublished:
      "技能正文为空，无法发布。请确认本地技能已填写内容后再提交。",
    skillHasNoContentAndCannotBePublished:
      "技能「{value}」没有正文，无法发布。",
    andOthersInTotal: "等 {length} 条",
    skillsHaveNoContentAndCannotBePublished:
      "技能「{preview}」{suffix}没有正文，无法发布。",
    validationFailedCheckTheTitleAndSkillContent:
      "提交内容未通过校验，请检查标题和技能正文。"
  },
  buildWindowFrameMenus: {
    file: "文件",
    newProject: "新建作品",
    openProject: "打开作品…",
    settings: "设置…",
    view: "视图",
    showDirectorySidebar: "显示目录侧栏",
    hideDirectorySidebar: "隐藏目录侧栏",
    showManuscriptPanel: "显示文稿面板",
    hideManuscriptPanel: "隐藏文稿面板",
    appearanceAndTheme: "外观与主题…"
  },
  shortManuscriptCharacterCount: {
    failedToReadTheFullCharacterCountReopenThe:
      "读取全文字数失败，请重新打开导出窗口。"
  },
  lazyRevisionAnalysis: {
    revisionAnalysis: "修改分析"
  },
  subagentAuthoring: {
    agentsAreNotAvailableInThisEnvironment: "当前环境无法调用智能体。",
    generationIsInProgressStopItOrWaitFor: "生成进行中，请先停止或等待完成。",
    addAnAvailableModelInModelSettingsFirst: "请先在模型配置中添加可用模型。",
    readingSelectedSkillContent: "正在读取已选技能正文…",
    generatingASubagentDraftFromTheSelectedSkills:
      "正在根据技能生成子智能体草稿…",
    writeDirectlyToDocuments: "直接写入文档",
    returnFindingsOnly: "只交回结论",
    generateASubagentDraftForUsingTheSelectedSkills:
      "请根据已选定的技能，为「{parentAgentLabel}」生成一个子智能体草稿。",
    outputModeConfirmedByTheUser: "产出方式（用户已确认）：{modeLabel}。",
    selectedSkills: "选定技能：{skillTitles}。",
    readTheSkillContentFirstThenCallWriteSubagent:
      "请先读取技能正文，再调用 write_subagent_draft 提交名称、能力说明和系统提示词。",
    failedToGenerateTheSubagentDraft: "生成子智能体草稿失败。",
    stopping: "正在停止…",
    failedToStopGeneration: "停止生成失败。",
    networkInterruptionRetryingInS:
      "网络波动，{ceil}s 后重试（第 {retryNumber}/{maxRetries} 次）",
    retrying: "正在重试（第 {retryNumber}/{maxRetries} 次）",
    draftUpdatedConfirmToAddItToTheTeam:
      "草稿已更新，可确认加入团队或继续等待生成完成。",
    calling: "正在调用 {toolName}…",
    generationFinishedWithoutASubagentDraftPleaseTryAgain:
      "生成已结束，但未收到子智能体草稿。请重试。",
    draftReadyConfirmToAddItToTheCurrent:
      "草稿已就绪，确认后加入当前主智能体团队。"
  },
  pendingEditorReferences: {
    thisPassageIsAlreadyInTheInput: "这段正文已经插入输入框",
    eachMessageCanIncludeUpToManuscriptReferences:
      "每条消息最多插入 {PROMPT_ATTACHMENT_MAX_ITEMS} 段正文引用"
  },
  workspaceResourceCoordinator: {
    failedToReadTheManuscriptSelectItAgainAnd:
      "读取正文失败，请重新选择后重试。",
    episode: "剧集",
    section: "小节",
    manuscript: "{workspaceLabel} · 正文",
    writing: "{workspaceLabel} · {unitLabel}编写",
    characterEntry: "人物条目",
    newCharacterEntry: "新建人物条目",
    deleteCurrentCharacterEntry: "删除当前人物条目",
    deleteCurrentSection: "删除当前小节",
    thisNoLongerExistsTheListHasBeenRefreshed: "该{value}已不存在，列表已刷新",
    theReferencedManuscriptFileNoLongerExistsTheReference:
      "引用的正文文件已不存在，已移除这条引用"
  },
  writingContextCoordinator: {
    failedToReadProjectContext: "读取作品上下文失败。",
    projectContextSaved: "作品上下文已保存。",
    failedToSaveProjectContext: "保存作品上下文失败。"
  },
  creationResourceOrder: {
    theProjectOrderCouldNotBeSavedButIt:
      "作品顺序暂时无法保存，但本次操作仍然有效"
  },
  foreshadowingFilters: {
    withinAPlotPoint: "剧情点内",
    withinAVolume: "卷内",
    acrossVolumes: "跨卷",
    planned: "构思中",
    planted: "已埋设",
    developing: "发展中",
    resolved: "已回收",
    abandoned: "已废弃",
    truthSource: "真相源头",
    plant: "埋设",
    reinforce: "强化",
    misdirect: "误导",
    partialReveal: "部分揭示",
    reveal: "揭示",
    resolve: "回收",
    aftermath: "余波",
    allScopes: "全部跨度",
    allLifecycleStates: "全部生命周期",
    noActualBeatsHaveBeenRecordedByManuscriptCommits:
      "尚未由正文提交产生实际触点",
    keepTheRecordWithoutDevelopingItFurther: "保留记录，但不再继续推进",
    noVolumeSelected: "暂不指定分卷",
    noPlotPointSelected: "暂不指定剧情点",
    missingVolume: "缺失分卷（{volumeId}）",
    missingPlotPoint: "缺失剧情点（{arcId}）"
  },
  composerContextNavigation: {
    couldNotSwitchPleaseTryAgain: "切换失败，请重试"
  },
  shortManuscriptExportTransaction: {
    manuscriptExportIsUnavailable: "正文导出服务不可用。"
  },
  siteOfficialQuotaMerge: {
    waitForTheCurrentOperationToFinish: "请等待当前操作完成。",
    addTheCurrentKeyFirst: "请先添加当前密钥。",
    unlimitedKeysDoNotNeedAdditionalQuota: "无限额度密钥无需增加额度。",
    refreshTheCurrentKeySQuotaFirst: "请先刷新当前密钥额度。",
    enterAValidSourceKey: "请输入有效的来源 Key。",
    theCurrentKeyConfigurationChangedRefreshTheQuotaAnd:
      "当前密钥配置已变化，请刷新额度后重新确认。",
    theDesktopServiceIsTemporarilyUnavailablePleaseTryAgain:
      "桌面服务暂不可用，请稍后重试。",
    transferredTheSourceKeyHasBeenPermanentlyDeactivated:
      "已转入 ¥{transferred}，来源 Key 已永久注销。",
    quotaTransferredUsageHasNotRefreshedYetRefreshThe:
      "额度已转入，暂未刷新最新用量，请稍后刷新页面。",
    quotaTransferFailedRefreshTheQuotaToCheckThe:
      "额度转入失败，请刷新额度确认结果后再试。"
  },
  popupSelect: {
    modelsSelected: "已选择 {length} 个模型"
  },
  workspaceResourceTreeCoordinator: {
    unavailableNovel: "不可用长篇 · {bookId}",
    novelFailedToReadProject: "长篇 · 项目读取失败",
    novelTemporarilyUnavailable: "长篇 · 暂不可用",
    bookSettingsCouldNotBeSavedButChangesAre:
      "书籍设置暂时无法保存，但本次操作仍然有效"
  },
  applyBodyTextFormatting: {
    theManuscriptAlreadyMatchesTheFormattingRules: "正文已符合格式规范",
    manuscriptFormattingApplied: "已规范正文格式"
  },
  draftRecoveryPersistence: {
    failedToReadDraftRecoveryFile: "草稿恢复文件读取失败：{message}",
    theDraftRecoveryFileIsTemporarilyUnreadable: "草稿恢复文件暂时无法读取",
    unsavedDraftsCouldNotBeWrittenToTheRecovery:
      "未保存草稿暂时无法写入恢复文件，请先保存文稿再关闭应用"
  },
  approvalNavigationCoordinator: {
    openedTheParentEntryTheTargetFileIsNot:
      "已跳转到所属条目，目标文件暂未就绪。"
  },
  shortWorkspaceStructureCoordinator: {
    waitForTheCurrentAgentToFinishThenAccept:
      "请先等待当前智能体结束，并接受或拒绝待审阅变更。",
    resolveThisProjectSOutstandingSaveConflictsFirst:
      "请先处理该作品尚未解决的保存冲突。",
    someDraftsCouldNotBeSavedSafelyTheStructure:
      "存在无法安全保存的草稿，结构未变更。",
    couldNotDuplicateTheWritingWorkspace: "复制创作空间失败。",
    theCurrentProjectIsBeingUpdatedPleaseWait: "当前作品正在更新，请稍候。",
    theCurrentProjectHasNoVersionIdentifierItsStructure:
      "当前作品缺少项目版本，无法安全管理结构。",
    theCurrentProjectHasNoVersionIdentifierItsCharacter:
      "当前作品缺少项目版本，无法安全变更人物结构。",
    characterStructureConvertedToEntries: "人物结构已转换为条目样式",
    characterStructureConvertedToText: "人物结构已转换为文本样式",
    characterEntryCreated: "人物条目已创建",
    characterEntryNameUpdated: "人物条目名称已更新",
    characterEntriesReordered: "人物条目顺序已更新",
    characterEntryDeleted: "人物条目已删除",
    theProjectWasUpdatedElsewhereAndHasBeenReloaded:
      "作品已在其他位置更新，已重新加载；请确认后重试。",
    couldNotChangeTheCharacterStructure: "人物结构变更失败。",
    couldNotIdentifyTheProjectContainingThisCharacterEntry:
      "无法确定人物条目所属作品。",
    thisCharacterEntryNoLongerExistsTheListHas:
      "该人物条目已不存在，列表已刷新",
    theCharacterDirectoryCouldNotBeIdentifiedACharacter:
      "无法确定人物目录，暂时不能新建人物条目。",
    selectACharacterEntryFirst: "请先选择一个人物条目。",
    couldNotIdentifyTheCharacterEntry: "无法确定人物条目。",
    theCurrentProjectHasNoVersionIdentifierItsPlot:
      "当前作品缺少项目版本，无法安全变更剧情结构。",
    plotStructureCreatedAndSyncedToAllShortStories:
      "剧情结构已创建，并同步到全部短篇与剧本",
    plotStructureUpdatedAcrossAllProjects: "剧情结构已全局更新",
    plotStructuresReordered: "剧情结构顺序已更新",
    plotStructureEnabled: "已启用该剧情结构",
    plotStructureDisabled: "已关闭该剧情结构",
    plotStructureDeletedFromAllProjects: "剧情结构已从全部作品中删除",
    couldNotChangeThePlotStructure: "剧情结构变更失败。",
    aNewCannotBeAddedToTheManuscriptYet:
      "当前正文暂时不能新建{unitLabel}，请稍候",
    aManuscriptSupportsUpToItemsOfType: "正文最多支持 100 个{unitLabel}",
    thisManuscriptNoLongerExists: "该正文已经不存在",
    theCurrentProjectHasNoVersionIdentifierManuscriptStructure:
      "当前作品缺少项目版本，无法安全新建正文结构。",
    createdAndSavedItInTheManuscriptFolder: "已新建“{title}”并保存到正文文件夹",
    couldNotCreateTheManuscript: "新建正文{unitLabel}失败。",
    aNewSectionCannotBeAddedToTheManuscript: "当前正文暂时不能新建小节，请稍候",
    thisManuscriptSectionNoLongerExistsTheListHas:
      "该正文小节已经不存在，列表已刷新",
    theCurrentIsBeingProcessedOrSavedWaitBefore:
      "当前{unitLabel}正在处理或保存，请稍候再调整顺序",
    theCurrentProjectHasNoVersionIdentifierItsManuscript:
      "当前作品缺少项目版本，无法安全调整正文结构。",
    message: "已{value}“{title}”",
    couldNotReorderThe: "调整{unitLabel}顺序失败。",
    selectASectionFirst: "请先选择一个小节",
    thisSectionNoLongerExistsTheListHasBeen: "该小节已经不存在，列表已刷新",
    thisNoLongerExists: "该{value}已经不存在",
    theManuscriptMustRetainAtLeastOne: "正文至少需要保留一个{value}",
    theCurrentIsBeingProcessedOrSavedWaitBefore2:
      "当前{value}正在处理或保存，请稍候再删除",
    theCurrentProjectHasNoVersionIdentifierItsManuscript2:
      "当前作品缺少项目版本，无法安全删除正文结构。",
    thisNoLongerExists2: "该{value}已经不存在。",
    manuscriptSection: "正文小节",
    deletedAndItsCharacterStateFiles:
      "已删除“{sectionTitle}”及对应人物状态文件",
    couldNotDeleteThe: "删除{value}失败。"
  },
  lazyApprovalNavigationCoordinator: {
    couldNotLoadApprovalNavigation: "加载审批跳转能力失败：{message}",
    couldNotLoadApprovalNavigationTryAgain: "加载审批跳转能力失败，请重试。"
  },
  bodyTextFormatting: {
    couldNotFormatTheManuscriptTryAgain: "规范正文格式失败，请重试",
    finishOtherEditsBeforeFormattingAllBodies: "请等待当前保存或编辑完成后重试",
    couldNotReadEveryBodyNoChangesWereMade:
      "未能读取全部正文，尚未修改格式，请重试",
    allBodiesAlreadyMatchTheFormattingRules: "全部正文已符合格式规范",
    formattedBodies: "已规范 {count} 个正文的格式",
    couldNotFormatAllBodiesTryAgain: "规范全部正文格式失败，请重试"
  },
  workspaceFeatureHostCoordinator: {
    couldNotLoadTheRevisionAnalysisModule: "加载修改分析模块失败。",
    couldNotLoadTheShortStoryAnalysisModule: "加载短篇拆书模块失败。",
    couldNotLoadTheLongFormAnalysisModule: "加载长篇拆书模块失败。",
    couldNotLoadSettingsTryAgainShortlyOrRestart:
      "设置页面加载失败，请稍后重试或重新启动应用。",
    couldNotLoadTheAgentTeamsModule: "加载智能体团队模块失败。"
  },
  workspaceResourceNavigation: {
    couldNotLoadTheSelectionListTryAgain: "加载选择列表失败，请重试"
  },
  lazyLongStructureTransactionsCoordinator: {
    theLongFormStructureOperationWasCanceled: "长篇结构操作已取消。",
    couldNotLoadTheLongFormStructureCoordinator: "加载长篇结构协调器失败。",
    theLongFormStructureOperationFailed: "长篇结构操作失败。"
  }
};
