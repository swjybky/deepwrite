export default {
  emptyWorkspaceDocument: {
    noBookOpen: "尚未打开书籍",
    workspace: "创作空间"
  },
  agentWelcome: {
    startWithAWritingGoal: "从一个创作目标开始",
    tellMeWhatYouWantToWriteWeWill:
      "告诉我你想完成的创作任务，我会结合当前文稿与你一起推进。",
    helpMeClarifyMyWritingGoal: "帮我梳理当前创作目标",
    reviewTheCurrentManuscript: "检查当前文稿的问题",
    suggestWhatToWorkOnNext: "告诉我下一步可以做什么",
    startWithTheCurrentShortStoryStage: "从当前短篇阶段开始",
    iAmYourShortStoryAgentIHelpWith:
      "我是短篇智能体，统一负责人物、剧情和正文，并根据你当前打开的阶段加载对应上下文。",
    startWithTheCurrentScreenplayStage: "从当前剧本阶段开始",
    iAmYourScreenplayAgentIHelpWithCharacters:
      "我是剧本智能体，统一负责人物、剧情和正文，并根据你当前打开的阶段加载对应上下文。",
    startByCreatingASkill: "从创建一个技能开始",
    iManageYourSkillLibraryAndHelpCreateAnd:
      "我是技能库管理智能体，用于创建、整理和维护可复用的写作方法、检查清单与协作流程。",
    initializeTheLibraryIntroduction: "初始化库介绍",
    createASkill: "创建一个技能",
    organizeASkill: "整理一个技能",
    startByCreatingAMaterial: "从创建一个素材开始",
    iManageYourMaterialLibraryAndHelpCreateAnd:
      "我是素材库管理智能体，用于创建、整理和维护可由短篇、剧本和长篇共用的素材条目。",
    createAMaterial: "创建一个素材",
    organizeAMaterial: "整理一个素材",
    startWith: "从{replace}开始"
  },
  catalogWorkspace: {
    characterMaterialLibrary: "人设素材库",
    storyIdeaLibrary: "梗素材库",
    plotMaterialLibrary: "剧情素材库",
    proseMaterialLibrary: "正文素材库",
    otherMaterialLibrary: "其他素材库",
    generalMaterialLibrary: "综合素材库",
    storyIdeas: "梗",
    characterConcepts: "人设",
    plotDesign: "剧情设计",
    openingDesign: "导语设计",
    plotRefinement: "剧情细化",
    proseExcerpts: "优秀正文片段",
    otherMaterials: "其他素材",
    generalSkillLibrary: "通用技能库",
    plotDesignSkillLibrary: "剧情设计技能库",
    writingStyleSkillLibrary: "文风写作技能库",
    otherSkillLibrary: "其他技能库",
    characterSkills: "人物技能",
    plotSkills: "剧情技能",
    outlineSkills: "大纲技能",
    proseWritingSkills: "正文专家编写技能",
    sectionWritingSkills: "分节写手技能",
    plot: "剧情",
    manuscript: "正文",
    other: "其他",
    general: "通用",
    writingStyle: "文风",
    shortStory: "短篇",
    novel: "长篇",
    screenplay: "剧本",
    overview: "概览",
    characters: "人物",
    otherDocuments: "{value} · 其他文稿",
    characterState: "人物状态",
    message: "{value} · {value2}",
    episodeScript: "剧集正文",
    sectionManuscript: "小节正文",
    characterState2: "{value} · 人物状态",
    libraryIntroduction: "库介绍",
    material: "素材",
    libraryIntroduction2: "{title} · 库介绍",
    missingLibrary: "已丢失的{value}库（{libraryId}）",
    skill: "技能",
    missing: "缺失",
    libraryDescription: "库说明",
    libraryDescription2: "{title} · 库说明",
    unreadableBook: "无法读取的书籍（{projectId}）",
    unavailable: "不可用",
    invalidConfiguration: "配置损坏",
    unreadableSkillLibrary: "无法读取的技能库（{projectId}）",
    unreadableMaterialLibrary: "无法读取的素材库（{projectId}）",
    skillLibrary: "技能库",
    materialLibrary: "素材库"
  },
  libraryAgentSkillAttachments: {
    deepwriteAttachmentTruncatedAtCharactersOriginalLengthCharacters:
      "\n\n[DeepWrite：附件内容因 {toLocaleString} 字符上限截断；原文 {toLocaleString2} 字符。]",
    exceedsTheAttachmentLimitATruncationNoticeHasBeen:
      "“{name}”超过附件内容上限，已携带显式截断说明。",
    theLibraryAgentSupportsUpToSkillsAnotherSkills:
      "资料库智能体可用技能超过契约容量 {itemLimit} 条，另有 {length} 条未附加。"
  },
  libraryAgentContext: {
    group: "分组 · {value}",
    librariesInThisGroup: "同组成员库",
    currentLibrary: "当前{domainLabel}库 · {groupTitle}",
    currentLibrary2: "当前{domainLabel}库"
  },
  libraryAttachments: {
    cannotBuildMaterialAndSkillAttachmentsForMissingBook:
      "无法为不存在的书籍“{bookId}”构建素材与技能附件。"
  },
  bookTemplateReferences: {
    aPlotStageInThisTemplateIsNoLonger:
      "模板中的剧情阶段已失效，请编辑模板后重试。",
    aMaterialLibraryInThisTemplateIsNoLonger:
      "模板中的素材库已失效，请重新选择。",
    aSkillLibraryInThisTemplateIsNoLonger: "模板中的技能库已失效，请重新选择。"
  },
  shortLibraryReferences: {
    linkedToThisBook: "{value} · 当前书籍已绑定"
  },
  catalogDocumentContent: {
    catalogContentDoesNotMatchTheWorkspaceDocument:
      "Catalog 正文与工作区文档不匹配。",
    theCatalogContentTargetDoesNotMatchTheWorkspace:
      "Catalog 正文目标与工作区文档不匹配。"
  },
  shared: {
    exceedsTheAttachmentLimitATruncationNoticeHasBeen:
      "“{title}”超过附件内容上限，已携带显式截断说明。",
    theAttachmentLimitIsAnotherEntriesAreListedIn:
      "{value}附件超过契约容量 {limit} 条，另有 {length} 条已在 omittedAttachments 中明确列出。"
  },
  candidates: {
    materialLibraryIsLinkedMoreThanOnceUnderAnd:
      "素材库“{libraryId}”在 {selectedKind} 分类下重复绑定，已只读取一次。",
    linkedMaterialLibraryDoesNotExist: "绑定的素材库“{libraryId}”不存在。",
    materialLibraryIsCategorizedAsButThisBookLinks:
      "素材库“{title}”的用途为 {materialKind}，但书籍将其绑定在 {selectedKind}。",
    skillLibraryIsLinkedUnderBothAndItWas:
      "技能库“{libraryId}”同时绑定在 {previousKind} 与 {selectedKind}，已按 {previousKind2} 读取一次。",
    linkedSkillLibraryDoesNotExist: "绑定的技能库“{libraryId}”不存在。",
    skillLibraryIsCategorizedAsButThisBookLinks:
      "技能库“{title}”的分类为 {skillKind}，但书籍将其绑定在 {selectedKind}。"
  },
  creativeBookCreation: {
    theBrowserPreviewCannotSaveProjectsCreateProjectsIn:
      "浏览器预览不能保存作品，请使用桌面客户端创建。"
  },
  bookLibrarySelection: {
    longFormPlotAndStructureReferences: "长线情节与结构参考",
    customNovelMaterials: "自定义长篇素材",
    plotDesignAndRefinement: "剧情设计与细化",
    availableAcrossMultipleNovelStages: "多个长篇阶段均可使用",
    chapterAndSectionWritingMethods: "章节与分节写作方法",
    manuscriptAndEpisodeWritingMethods: "正文与分集写作方法",
    official: "{title} · 官方",
    noAssociation: "不关联",
    materialLibraryUnavailableSelectAgain: "已失效的素材库（请重新选择）",
    notLinked: "不绑定",
    skillLibraryUnavailableSelectAgain: "已失效的技能库（请重新选择）"
  },
  shortBookCreation: {
    createdButFailedToRefreshTheProjectListRefresh:
      "已创建{value}“{title}”，但作品列表刷新失败；稍后将自动重试。",
    createdAndSavedTheMaterialAndSkillLibraryLinks:
      "已创建{value}“{title}”，素材库和技能库绑定已保存",
    createdProjectButFailedToRefreshTheLocalList:
      "已创建作品“{title}”，但刷新本地列表失败；稍后将自动重试。",
    failedToCreateProject: "创建作品失败。"
  },
  catalogLibraryTransactionsCoordinator: {
    createdLibrary: "已创建{value}库“{title}”",
    failedToCreateLibrary: "创建资料库失败。",
    createdGroup: "已创建{value}分组“{title}”",
    failedToCreateLibraryGroup: "创建资料库分组失败。",
    savedGroup: "已保存分组“{title}”",
    theGroupWasUpdatedExternallyAndHasBeenReloaded:
      "分组配置已在外部更新，已重新加载；请确认后再次编辑",
    failedToUpdateGroupLinks: "更新分组绑定失败。",
    createdEntry: "已创建{value}条目“{title}”",
    theLibraryWasUpdatedExternallyAndHasBeenReloaded:
      "资料库已在外部更新，已重新加载；请从新目录状态重新创建条目",
    failedToCreateLibraryEntry: "创建资料库条目失败。",
    theLibraryToEditWasNotFound: "未找到要修改的资料库",
    libraryRenamed: "资料库名称已更新",
    failedToRenameLibrary: "修改资料库名称失败。",
    theEntryToEditWasNotFound: "未找到要修改的条目",
    entryRenamed: "条目名称已更新",
    failedToRenameEntry: "修改条目名称失败。",
    theDestinationLibraryNoLongerExistsRefreshAndTry:
      "拖拽目标资料库已不存在，请刷新后重试",
    entryOrderUpdated: "条目顺序已更新",
    entryMovedToTheDestinationLibrary: "条目已移动到目标资料库",
    failedToMoveLibraryEntry: "移动资料库条目失败。",
    theMaterialEntryToMoveNoLongerExistsRefresh:
      "要移动的素材条目已不存在，请刷新后重试",
    theEntryNoLongerExistsTheDirectoryHasBeen: "条目已经不存在，目录已重新加载",
    deletedEntryFile: "已删除{value}条目文件",
    theLibraryWasUpdatedExternallyAndHasBeenReloaded2:
      "资料库已在外部更新，已重新加载；请确认后再次删除",
    failedToDeleteLibraryEntry: "删除资料库条目失败。",
    theEntryToCopyWasNotFound: "未找到要复制的条目",
    theEntryContentToCopyWasNotFound: "未找到要复制的条目内容",
    copiedEntry: "已复制{value}条目“{title}”",
    theClipboardHasNoEntryToPaste: "剪贴板中没有可粘贴的条目",
    theDestinationLibraryWasNotFound: "未找到要粘贴到的资料库",
    materialEntriesCanOnlyBePastedIntoMaterialLibraries:
      "当前复制的是素材条目，只能粘贴到素材库",
    skillEntriesCanOnlyBePastedIntoSkillLibraries:
      "当前复制的是技能条目，只能粘贴到技能库",
    entriesCannotBePastedAcrossLibrariesOfDifferentProject:
      "不同创作类型的资料库条目不能直接交叉粘贴",
    theDestinationLibraryIsReadOnlyOrUnavailableThe:
      "目标资料库为只读或不可用，无法粘贴条目",
    builtInSkillLibrariesAreReadOnlyEntriesCannot:
      "内置技能库为只读内容，不能粘贴条目",
    pastedEntryInto: "已粘贴{value}条目“{title}”到“{label}”",
    theLibraryWasUpdatedExternallyAndHasBeenReloaded3:
      "资料库已在外部更新，已重新加载；请再次粘贴",
    failedToPasteLibraryEntry: "粘贴资料库条目失败。",
    theLibraryIsNoLongerInTheCurrentDirectory: "资料库已经不在当前目录中。",
    removedFromTheListItsLocalFolderIsPreserved:
      "已从列表移除“{label}”，本地文件夹仍完整保留",
    failedToRemoveLibrary: "移除资料库失败。",
    deletedAndItsLocalFolder: "已删除“{label}”及其本地文件夹",
    failedToDeleteLibrary: "删除资料库失败。",
    theGroupWasNotFound: "未找到对应的分组",
    theLibraryWasNotFound: "未找到对应的资料库",
    copiedGroupAsIncludingMemberLibraries:
      "已复制分组“{label}”为“{title}”，同时复制 {length} 个成员库",
    copiedAs: "已复制“{label}”为“{title}”",
    failedToDuplicateLibraryProject: "复制资料库项目失败。",
    theGroupIsNoLongerInTheCurrentDirectory: "分组已经不在当前目录中。",
    dissolvedGroupItsLibrariesAreBackInTheirOriginal:
      "已解散分组“{label}”，成员库已回到原分类",
    failedToDissolveGroup: "解散分组失败。",
    theLocalLibraryWasNotFound: "未找到对应的本地资料库",
    builtInSkillLibrariesAreReadOnlyEntriesCannot2:
      "内置技能库为只读内容，不能修改条目",
    library: "资料库",
    theEntryFileToDeleteWasNotFound: "未找到要删除的条目文件"
  },
  catalogWorkspaceProjectionCoordinator: {
    projectCannotCurrentlyBeRead:
      "项目“{projectId}”暂时无法读取：{message}{value}",
    additionalProjects: "（另有 {value} 个项目）",
    theLegacyRecoveryDraftDoesNotMatchTheCurrent:
      "旧版恢复稿与当前正文的磁盘版本或剧集/小节结构不一致，原恢复稿已保留，请核对当前正文目录{value}",
    inTotal: "（共 {length} 份）",
    theDirectoryVersionChangedWhileMigratingLegacyRecoveryDrafts:
      "旧版恢复稿迁移期间目录版本发生变化，原恢复稿已保留并将重新加载。",
    legacyRecoveryDraftsCannotCurrentlyBeMigrated:
      "旧版恢复稿暂时无法迁移：{message}",
    legacyRecoveryDraftsCannotCurrentlyBeMigratedTheOriginal:
      "旧版恢复稿暂时无法迁移，原恢复稿已保留。",
    failedToLoadMaterialAndSkillLibraries: "加载素材库和技能库失败。",
    restoredUnsavedDrafts: "已恢复 {recoveredDraftCount} 份未保存草稿"
  },
  bookLibraryKinds: {
    charactersAndRelationships: "人物与关系设定",
    coreIdeasAndHooks: "核心创意与钩子",
    plotOpeningAndRefinement: "剧情、导语与细化",
    proseExcerptsAndWritingReferences: "正文片段与表达参考",
    materialsOutsideTheCategoriesAbove: "未归入以上分类的素材",
    availableAcrossMultipleStages: "多个阶段均可使用",
    characterPlotAndOutlineMethods: "人物、剧情与大纲方法",
    manuscriptAndSectionWritingMethods: "正文与分节写作方法",
    customWritingMethods: "自定义写作方法"
  },
  catalogDocumentPersistence: {
    theLatestDirectorySnapshotCouldNotBeReadAfter:
      "保存后未能读取最新目录快照。",
    theSavedBookIsMissingFromTheLatestDirectory:
      "保存后的书籍没有出现在最新目录快照中。",
    theDirectoryHasNotReachedTheSavedVersionYet:
      "保存后的目录尚未达到本次写入版本。",
    theDirectoryVersionReadAfterSavingMovedBackwards:
      "保存后读取到的目录版本发生回退。",
    theLatestManuscriptContentCouldNotBeReadAfter:
      "保存后未能读取最新文稿内容。",
    manuscriptSavedButTheLatestDirectoryVersionHasNot:
      "文稿已保存，但最新目录版本暂未同步；下次聚焦窗口时会自动重试",
    libraryChangesSavedToDiskButTheLatestDirectory:
      "资料库修改已写入磁盘，但最新目录暂未同步；窗口重新聚焦后会自动重试",
    libraryEntryCreatedButItsDirectoryLocationHasNot:
      "资料条目已创建，但目录定位暂未同步；窗口重新聚焦后会自动重试",
    cannotRefreshTheDirectoryIndexTheCurrentDraftRemains:
      "无法刷新目录索引，当前草稿仍保留在恢复区",
    theDiskVersionChangedAgainWhileReadingPleaseTry:
      "磁盘版本在读取期间再次变化，请重试。",
    theDiskVersionReturnedInvalidContentTheCurrentDraft:
      "磁盘版本返回了无效内容，当前草稿仍保留在恢复区",
    theDiskVersionNoLongerExistsTheCurrentDraft:
      "磁盘版本已不存在，当前草稿仍保留在恢复区",
    earlierEditsAreAlreadyOnDiskYourNewerDraft:
      "磁盘已包含较早修改；你随后输入的新草稿仍保留",
    theDiskVersionAlreadyContainsTheseChangesNoAdditional:
      "磁盘版本已经包含当前修改，无需重复保存",
    failedToReadTheConflictingDiskVersionTheCurrent:
      "读取磁盘冲突版本失败，当前草稿仍保留",
    manuscriptSavedLocally: "文稿已保存到本机",
    failedToSaveManuscript: "保存文稿失败。",
    contentSavedToTheLocalFolder: "{value}内容已保存到本机文件夹",
    failedToSaveLibraryContent: "保存资料库内容失败。",
    libraryIntroductionSavedToTheLocalFolder: "资料库介绍已保存到本机文件夹",
    failedToSaveLibraryIntroduction: "保存资料库介绍失败。",
    resolveTheCurrentSaveConflictBeforeSavingOtherDocuments:
      "请先处理当前保存冲突，再保存其他文稿",
    enterADocumentTitleBeforeSaving: "请输入文档标题后再保存",
    agentEditsForTheSameProjectAreBeingSaved:
      "正在保存同一作品的智能体修改，请稍候",
    newEditsWereDetectedWhileReadingTheCurrentDraft:
      "读取期间检测到新的编辑，已保留当前草稿",
    diskVersionReloaded: "已重新加载磁盘版本",
    failedToReloadDiskVersion: "重新加载磁盘版本失败",
    failedToOverwriteDiskVersion: "覆盖磁盘版本失败"
  },
  lazyLongBookLifecycleCoordinator: {
    failedToLoadTheNovelLifecycleCoordinator: "加载长篇作品生命周期协调器失败。"
  },
  libraryPackageCoordinator: {
    desktopNeedsRestart:
      "资料库导入导出功能尚未就绪，请完整退出并重新启动 DeepWrite 后重试。",
    browserPreviewCannotExport:
      "浏览器预览不能导出本地资料库，请使用桌面客户端。",
    browserPreviewCannotImport:
      "浏览器预览不能导入本地文件，请使用桌面客户端。",
    exportedTo: "已导出到 {path}",
    exportedToWithSkipped: "已导出到 {path}（{count} 个成员库不可用，未导出）",
    exportFailed: "导出失败",
    recognitionFailed: "识别失败",
    importFailed: "导入失败",
    imported: "已导入 {libraries} 个库、{entries} 个条目",
    sourceChanged: "来源在识别后发生了变化，请重新选择。",
    headlineWithReason: "{headline}：{reason}"
  },
  externalLibraryImportCoordinator: {
    theBrowserPreviewCannotReadLocalFilesUseThe:
      "浏览器预览不能读取本地文件，请使用桌面客户端。",
    noImportableTextWasFoundAtTheSelectedLocation:
      "所选位置中没有可导入的文本内容",
    failedToScanExternalFiles: "扫描外部文件失败。",
    theDestinationLibraryIsUnavailableOrReadOnly:
      "目标资料库已不可用或为只读内容",
    theSelectedEntriesExceedTheRemainingLibraryCapacity:
      "所选条目超过目标资料库剩余容量",
    importedEntriesWereRenamedToAvoidDuplicates:
      "已导入 {length} 条，{renamedCount} 条因重名自动改名",
    importedEntriesInto: "已导入 {length} 条到“{title}”",
    theDestinationLibraryWasUpdatedExternallyDuplicateNamesHave:
      "目标资料库已在外部更新，已刷新重名结果；请确认后重试",
    failedToImportMaterialsInBulk: "批量导入资料失败。"
  },
  bookTemplates: {
    failedToLoadTemplates: "加载模板失败",
    templateSaved: "模板已保存",
    failedToSaveTemplate: "保存模板失败",
    templateDeleted: "模板已删除",
    failedToDeleteTemplate: "删除模板失败"
  },
  lazyShortBookLifecycleCoordinator: {
    failedToLoadTheShortStoryLifecycleCoordinator:
      "加载短篇书籍生命周期协调器失败。"
  },
  catalogProjectActions: {
    theBrowserPreviewCannotOpenLocalFoldersUseThe:
      "浏览器预览不能打开本地文件夹，请使用桌面客户端。",
    opened: "已打开{value}“{title}”",
    book: "书籍",
    failedToOpenLocalProject: "打开本地项目失败。"
  },
  shortBookLifecycleCoordinator: {
    theCurrentHasNoVersionIdentifierCannotSafelyPerform:
      "当前{value}缺少项目版本，无法安全{operationLabel}。",
    theConfigurationWasUpdatedElsewhereReopenTheDialogBefore:
      "{value}配置已在外部更新，请重新打开对话框后再{operationLabel}。",
    couldNotFindTheBookToEdit: "未找到要修改的书籍。",
    rename: "修改名称",
    renamedTo: "已将“{label}”修改为“{label2}”",
    theCurrentBookHasNoVersionIdentifierItCannot:
      "当前书籍缺少项目版本，无法安全修改名称。",
    renamedToButTheProjectListCouldNotBe:
      "已将“{label}”修改为“{title}”，但作品列表刷新失败；稍后将自动重试。",
    renamedTo2: "已将“{label}”修改为“{title}”",
    theBookConfigurationWasUpdatedElsewhereAndHasBeen:
      "书籍配置已在外部更新，已重新加载；请确认后再次修改",
    couldNotRenameTheBook: "修改书名失败。",
    couldNotFindTheBookWhoseLibraryLinksShould: "未找到要更新绑定的书籍。",
    updateLinks: "更新绑定",
    updatedTheLinkFor: "已更新“{label}”的{bindingLabel}绑定",
    theCurrentBookHasNoVersionIdentifierItsLibrary:
      "当前书籍缺少项目版本，无法安全更新绑定。",
    updatedTheLinkForButTheProjectListCould:
      "已更新“{label}”的{bindingLabel}绑定，但作品列表刷新失败；稍后将自动重试。",
    theBookSLibraryLinksWereUpdatedElsewhereAnd:
      "书籍绑定已在外部更新，已重新加载；请确认后再次保存",
    couldNotUpdateTheLibraryLinks: "更新资料库绑定失败。",
    thisBookHasAlreadyBeenRemovedFromTheCurrent:
      "该书籍已经从当前创作空间移除。",
    thisBookHasNoLocalProjectFolderToDelete:
      "该书籍没有可删除的本地项目文件夹。",
    couldNotFindTheRequestedBook: "未找到要处理的书籍。",
    couldNotFindTheTo: "未找到要{value}的{value2}。",
    remove: "移除",
    theWasRemovedButItsLocalRuntimeStateCould:
      "{value}已移除，但本地运行状态清理失败。",
    butTheProjectListCouldNotBeRefreshedAn:
      "{value}“{label}”，但作品列表刷新失败；稍后将自动重试。",
    deleted: "已删除",
    removed: "已移除",
    removed2: "已移除“{label}”",
    couldNot: "{value}{value2}失败。",
    theOperationCompletedButTheLocalStateCouldNot:
      "{value}操作已经完成，但本地状态刷新失败；稍后将自动重试。",
    couldNotFindTheBookToExport: "未找到要导出正文的书籍",
    allEpisodes: "全部剧集",
    theIntroductionAndAllSections: "导语和全部小节",
    copiedTheManuscriptOfItIsReadyToPaste:
      "已复制“{title}”的{scope}正文，可直接粘贴",
    exportedAs: "已将“{title}”的{scope}导出为 {value}",
    couldNotCopyTheManuscript: "复制正文失败。",
    couldNotExportTheManuscript: "导出正文失败。"
  }
};
