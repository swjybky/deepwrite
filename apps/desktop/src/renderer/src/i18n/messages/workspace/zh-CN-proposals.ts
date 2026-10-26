export default {
  longProposalRuntimeCoordinator: {
    currentNovelEditsAreUnsavedTheAgentProposalWas:
      "当前长篇编辑内容尚未保存，智能体提案未自动覆盖；请处理编辑器保存状态后重试。",
    theNovelAgentIsStartingTheProjectCannotBe:
      "长篇智能体正在启动，暂时无法安全移除项目；请稍后重试。",
    novelGenerationStopped: "已停止长篇生成。",
    failedToStopNovelGenerationPleaseTryAgainShortly:
      "停止长篇生成失败，请稍后重试。",
    theActiveNovelChangedApprovalWasCanceled:
      "活动长篇已切换，本次审批已取消。",
    novelProposalRejectedNoFilesWereWritten:
      "已拒绝该长篇提案，未写入任何文件。",
    theTargetFileOrItemNoLongerExistsAnd:
      "目标文件或所属条目已不存在，无法跳转。"
  },
  index: {
    thePreviousEditWasDiscardedRegenerateThisEditUsing:
      "前一版修改已撤销，请基于当前文件重新生成本项修改。",
    otherEditsToThisProjectAreBeingSavedWait:
      "同一作品正在保存其他修改，请稍候再撤销",
    discardingThisEdit: "正在撤销这次修改…",
    editDiscardedThePreviousContentHasBeenRestored:
      "已撤销这次修改，并恢复修改前的内容。",
    editDiscarded: "已撤销这次修改",
    failedToDiscardThisEdit: "撤销这次修改失败。"
  },
  short: {
    theFullPreviousContentIsMissingThisEditCannot:
      "缺少修改前的完整内容，无法安全舍弃本次修改。",
    theTargetFileHasUnsavedEditsResolveTheCurrent:
      "目标文件有未保存编辑，未舍弃本次修改。请先处理当前草稿。",
    theTargetFileHasNewerChangesTheyWerePreserved:
      "目标文件已有后续修改，未覆盖最新内容；本次修改没有被舍弃。",
    theDesktopFileServiceIsUnavailable: "桌面文件服务当前不可用。",
    theTargetLibraryNoLongerExists: "目标资料库已不存在。",
    theTargetProjectNoLongerExists: "目标作品已不存在。",
    theTargetChapterIsUnavailableThisRenameCannotBe:
      "目标章节已不可用，无法舍弃本次改名。",
    theChapterHasBeenRenamedAgainThisRenameWas:
      "章节名称已有后续修改，未舍弃本次改名。",
    theCharacterStructureIsUnavailableThisEditCannotBe:
      "人物结构已不可用，无法舍弃本次修改。",
    theCharacterHasBeenRenamedAgainThisEditWas:
      "人物名称已有后续修改，未舍弃本次修改。",
    theCharacterOrderHasChangedAgainThisMoveWas:
      "人物顺序已有后续修改，未舍弃本次移动。",
    thisProposalCannotBeDiscarded: "这不是可舍弃的修改提案。",
    thePlotStructureIsUnavailableThisEditCannotBe:
      "剧情结构已不可用，无法舍弃本次修改。",
    thePlotStructureHasNewerChangesThisEditWas:
      "剧情结构已有后续修改，未舍弃本次修改。"
  },
  lazyProposalCoordinator: {
    failedToLoadTheAgentEditCoordinator: "加载智能体修改协调器失败。"
  },
  longWorkspaceProposals: {
    foreshadowingChanges: "伏笔变化",
    currentCharacterState: "人物当前状态",
    characterHistory: "人物历史轨迹",
    chapterEndingState: "章末状态",
    continuationPack: "接续包",
    theContinuityProposalRefersToAChapterCardThat:
      "连续性提案指向了不存在的章卡。",
    theContinuityProposalHasAnIncompleteCharacterFileIdentity:
      "连续性提案的人物文件身份不完整。",
    theContinuityProposalRefersToACharacterThatDoes:
      "连续性提案指向了不存在的人物。",
    theNovelWorkspaceContainsDuplicateContinuityFileIdentifiers:
      "长篇工作区包含重复的连续性文件标识。",
    theContinuityProposalSFilePathChapterRoleOr:
      "连续性提案的文件路径、章节、角色或人物与当前工作区不一致。",
    theNovelWorkspaceIndexReturnedTheWrongProject:
      "长篇工作区索引返回了错误的项目。",
    theContinuityFileAlreadyExistsAndCannotBeCreated:
      "目标连续性文件已存在，无法重复创建：{fileId}",
    theContinuityCreationProposalHasAnInconsistentIdentityOr:
      "连续性文件创建提案的身份或初始内容不一致。",
    theContinuityFileNoLongerExists: "目标连续性文件已经不存在：{fileId}",
    theTargetFileAlreadyExistsAndCannotBeCreated:
      "目标文件已存在，无法重复创建：{filePath}",
    theTargetFileNoLongerExists: "目标文件已经不存在：{filePath}",
    theTargetWorldbuildingCategoryNoLongerExistsOrIs:
      "世界观条目的目标分类已不存在或不再是列表型。",
    theStructuralImpactPreviewReturnedTheWrongNovelProject:
      "结构影响预览返回了错误的长篇项目。",
    failedToPreviewNovelStructuralImpact: "预览长篇结构影响失败。",
    failedToArchiveContinuityFiles: "连续性文件归档失败。",
    continuityFilesForThisChapterHaveBeenArchived: "本章连续性文件已完成归档。",
    continuityFilesWereArchivedButTheSubsequentRefreshFailed:
      "连续性文件已经归档，但后续刷新失败：{value}",
    refreshTheNovelWorkspaceManually: "请手动刷新长篇工作区。",
    thePreSaveCheckForAutomaticNovelFileSaving:
      "长篇文件实时自动保存前检查失败。",
    thisProposalDeletesItemsOrUnlinksRelatedRecordsReview:
      "该提案包含删除或解除关联影响，请核对后手动确认。",
    thePreSaveCheckForAutomaticNovelProposalSaving:
      "长篇提案实时自动保存前检查失败。",
    cannotGenerateAUniqueEventIdForTheManual:
      "无法为手工长篇结构提案生成唯一事件 ID。",
    theManualNovelStructureProposalEventIdConflictsPlease:
      "手工长篇结构提案事件 ID 冲突，请重试。",
    relatedImpactsHaveBeenCheckedReviewTheLatestImpacts:
      "关联影响已完成核对，请查看最新影响后再次确认。",
    chapterProseMustBeSavedThroughAConversationDiff:
      "章节正文必须通过会话 diff 审批卡保存，不能进入旧长篇提案队列。",
    relationshipsOrDeletionImpactsChangedReviewTheLatestImpacts:
      "关联关系或删除影响已变化，请查看最新影响后再次确认。",
    failedToProcessNovelProposal: "处理长篇提案失败。",
    novelStructureProposalApplied: "长篇结构提案已应用。",
    worldbuildingFileChangesSavedToLocalMarkdown:
      "世界观文件变更已保存到本地 Markdown。",
    characterFileChangesSavedToLocalMarkdown:
      "人物文件变更已保存到本地 Markdown。",
    chapterContinuityRecordsSavedToLocalMarkdown:
      "本章连续性记录已保存到本地 Markdown。",
    novelProposalSavedButTheSubsequentRefreshFailed:
      "长篇提案已经写入，但后续刷新失败：{value}",
    anEarlierContinuityFileProposalWasRejectedThisChapter:
      "前序连续性文件提案已被拒绝，本章账本未归档。"
  },
  proposalCoordinator: {
    failedToApproveAgentEdits: "批准智能体修改失败。",
    thePendingNewEntryIsMissingCompleteContentGenerate:
      "待审阅的新条目缺少完整内容，请重新生成。",
    theDestinationLibraryIsUnavailableOrReadOnlyThe:
      "目标资料库已不可用或只读，无法创建条目。",
    theLibraryDirectoryChangedNoEntryWasCreatedGenerate:
      "资料库目录已发生变化，未创建条目，请重新生成。",
    otherEditsToThisLibraryAreBeingSavedWait:
      "同一资料库正在保存其他修改，请稍候再接受",
    automaticallyApprovingAndCreatingTheLibraryEntry:
      "正在自动批准并创建资料库条目…",
    checkingTheLibraryVersionAndCreatingTheEntry:
      "正在校验资料库版本并创建条目…",
    libraryEntryAutomaticallyApprovedAndCreated: "已自动批准并创建资料库条目。",
    createdAndSavedToLocalMarkdown: "已创建并保存到本地 Markdown。",
    libraryEntryAutomaticallyApprovedAndCreated2: "已自动批准并创建资料库条目",
    libraryEntryCreated: "已创建资料库条目",
    theLibraryWasUpdatedExternallyNoEntryWasCreated:
      "资料库已在外部更新，未创建条目；请重新生成。",
    linkedToTheNewlyCreatedChapterFileContentWill:
      "已关联到新创建的章节文件，接受后将写入正文。",
    anEarlierEditWasRejectedThisChangeIsBlocked:
      "前序修改已被拒绝；为避免把被拒内容随后续全文重新带回，本次变更已阻断。",
    anEarlierEditHasConflictsThisSubsequentChangeIs:
      "前序修改存在冲突，本次后续变更已阻断，未覆盖当前文稿。",
    anEarlierManuscriptEditWasRejectedThisSubsequentEdit:
      "前序正文修改已被拒绝；这项后续修改继承了被拒内容，因此未写入本地文件。",
    theTargetCharacterStructureIsUnavailableThisChangeCannot:
      "人物结构目标已不可用，无法应用本次变更。",
    characterCreationIsMissingAStableEntryIdOrdered:
      "人物创建缺少稳定条目 id，无法完成顺序写入。",
    automaticallySavingCharacterStructure: "正在自动保存人物结构…",
    savingCharacterStructure: "正在保存人物结构…",
    characterEntryCreatedButItsFileCouldNotBe:
      "人物条目已创建，但刷新工作区后仍无法定位人物文件；请重试以完成正文映射。",
    characterStructureChangesAutomaticallyApprovedAndSaved:
      "已自动批准并保存人物结构变更。",
    characterStructureChangesSavedLocally: "人物结构变更已保存到本地。",
    characterStructureChangesSaved: "人物结构变更已保存",
    failedToSaveCharacterStructureChanges: "人物结构变更保存失败。",
    theCurrentCharacterStructureIsNotListBasedThis:
      "当前人物结构不是条目样式，本次条目操作未进入审阅。",
    createCharacterEntry: "创建人物条目：{title}",
    renameCharacter: "修改人物名称：{previousItemTitle} → {title}",
    characterEntry: "{value}人物条目：{title}",
    moveUp: "上移",
    moveDown: "下移",
    deleteCharacterEntry: "删除人物条目：{title}",
    theManuscriptDirectoryIsUnavailableChapterCreationWasNot:
      "目标正文目录已不可用，本次章节创建未进入审阅。",
    createBlankChapters: "创建 {length} 个空白章节",
    theTargetChapterIsUnavailableRenamingWasNotSubmitted:
      "目标章节已不可用，本次章节改名未进入审阅。",
    renameChapter: "修改章节名称：{previousTitle} → {title}",
    chapter: "章节",
    theTargetIsUnavailableDeletingTheWasNotSubmitted:
      "目标{draftUnit}已不可用，本次{draftUnit2}删除未进入审阅。",
    delete: "删除{draftUnit}：{title}",
    theTargetChapterHasNotBeenCreatedOrIs:
      "目标章节尚未创建或已失效，本次智能体变更未进入审阅。",
    theTextHasNotChangedNoSaveIsNeeded: "文本没有实际变化，无需保存。",
    newChapter: "新章节",
    characterState: "{sectionTitle} · 人物状态",
    theTargetCharacterEntryHasNotBeenCreatedOr:
      "目标人物条目尚未创建或已失效，本次智能体变更未进入审阅。",
    theTargetManuscriptIsNotWritableThisAgentChange:
      "目标文稿不可写，本次智能体变更未进入审阅。",
    plotDesignChanges: "剧情设计变更",
    worldbuildingFileToolsMustProduceOneIndependentFileChange:
      "世界观文件工具必须一次只形成一个独立文件变更，本次结果未进入审批。",
    characterFileToolsMustCreateOneCompleteCharacterOr:
      "人物文件工具必须形成一名人物的完整创建变更，或一次只修改一份人物档案；本次结果未进入审批。",
    newCharacter: "{characterName} / 新建人物",
    manuscript: "{chapterTitle} / 正文",
    theManuscriptHasNotChangedNoSaveIsNeeded: "正文没有实际变化，无需保存。",
    thePendingChapterCreationIsMissingRequiredParametersGenerate:
      "待审阅的章节创建缺少完整参数，请重新生成。",
    theManuscriptDirectoryIsUnavailableChaptersCannotBeCreated:
      "目标正文目录已不可用，无法创建章节。",
    otherContentInThisProjectIsBeingSavedAutomatic:
      "检测到作品正在保存其他内容，实时自动建章已暂停，请稍后人工重试。",
    otherEditsToThisProjectAreBeingSavedWait:
      "同一作品正在保存其他修改，请稍候再接受",
    automaticallyApprovingAndCreatingBlankChapterFiles:
      "正在自动批准并创建空白章节文件…",
    creatingChapterFiles: "正在创建章节文件…",
    chaptersCreatedButTheNewChaptersCouldNotBe:
      "章节已创建，但刷新工作区后仍无法定位新章节；请重试以完成正文映射。",
    automaticallyApprovedAndCreatedChaptersIncludingTheirSubmittedProse:
      "已自动批准并创建 {createdCount} 个章节；随创建提交的正文与人物状态已一并保存。",
    createdChaptersAndSavedTheirSubmittedProseAndCharacter:
      "已创建 {createdCount} 个章节，并保存随创建提交的正文与人物状态。",
    createdBlankChapterFiles: "已创建 {createdCount} 个空白章节文件",
    failedToCreateBlankChapters: "创建空白章节失败。",
    theAssociatedBlankChapterCouldNotBeCreatedRelated:
      "关联的空白章节确认未能创建，相关正文写入已取消。",
    chapterCreationHasNotBeenConfirmedTheProseIs:
      "章节创建结果尚未确认，正文内容已保留；请先重试章节创建。",
    thePendingChapterRenameIsMissingRequiredParametersGenerate:
      "待审阅的章节改名缺少完整参数，请重新生成。",
    theTargetChapterIsUnavailableAndCannotBeRenamed:
      "目标章节已不可用，无法修改名称。",
    theTargetChapterNoLongerExistsAndCannotBe:
      "目标章节已不存在，无法修改名称。",
    otherContentInThisProjectIsBeingSavedAutomatic2:
      "检测到作品正在保存其他内容，实时自动改名已暂停，请稍后人工重试。",
    automaticallyApprovingAndRenamingTheChapter: "正在自动批准并修改章节名称…",
    renamingTheChapter: "正在修改章节名称…",
    automaticallyApprovedAndRenamedChapterTo:
      "已自动批准并将章节「{previousTitle}」改名为「{title}」。",
    renamedChapterToAndSavedItLocally:
      "已将章节「{previousTitle}」改名为「{title}」并保存到本机。",
    chapterRenamedTo: "已将章节改名为「{title}」",
    failedToRenameChapter: "修改章节名称失败。",
    thePendingDeletionIsMissingRequiredParametersGenerateIt:
      "待审阅的{draftUnit}删除缺少完整参数，请重新生成。",
    theManuscriptDirectoryIsUnavailableTheCannotBeDeleted:
      "目标正文目录已不可用，无法删除{draftUnit}。",
    noLongerExistsNoFurtherDeletionIsNeeded:
      "{draftUnit}「{title}」已不存在，无需重复删除。",
    theTargetWasDeletedRelatedProseChangesCannotBe:
      "目标{draftUnit}已删除，相关正文变更无法落盘。",
    atLeastOneMustRemainInTheManuscriptNothing:
      "正文至少需要保留一个{draftUnit}，未删除。",
    otherContentInThisProjectIsBeingSavedAutomatic3:
      "检测到作品正在保存其他内容，实时自动删除已暂停，请稍后人工重试。",
    automaticallyApprovingAndDeleting: "正在自动批准并删除{draftUnit}…",
    deleting: "正在删除{draftUnit}…",
    noLongerExists: "{draftUnit}「{title}」已经不存在。",
    automaticallyApprovedAndDeletedAndItsManuscriptAndCharacter:
      "已自动批准并删除{draftUnit}「{title}」及其正文与人物状态文件。",
    deletedAndItsManuscriptAndCharacterStateFiles:
      "已删除{draftUnit}「{title}」及其正文与人物状态文件。",
    deletedAndItsCharacterStateFile:
      "已删除{draftUnit}“{title}”及对应人物状态文件",
    failedToDelete: "删除{draftUnit}失败。",
    theNovelPlotDesignServiceIsUnavailable: "长篇剧情设计服务当前不可用。",
    otherContentInThisBookIsBeingSavedAutomatic:
      "检测到本书正在保存其他内容，剧情设计实时自动落盘已暂停，请稍后重试。",
    otherEditsToThisBookAreBeingSavedWait:
      "同一本书正在保存其他修改，请稍候再接受",
    automaticallyApprovingCheckingImpactsAndSavingPlotDesign:
      "正在自动批准、校验影响并保存剧情设计…",
    checkingImpactsAndSavingPlotDesign: "正在校验影响并保存剧情设计…",
    currentNovelEditsAreUnsavedPlotDesignWasNot:
      "当前长篇编辑内容尚未保存，未覆盖剧情设计。",
    structuralAndRelatedImpactsHaveBeenLoadedReviewThe:
      "已读取本次结构与关联影响，请核对下方影响后再次确认保存。",
    reviewThePlotDesignAndRelatedImpactsBeforeConfirming:
      "请核对剧情设计及关联影响后再次确认保存",
    savedPlotDesign: "{value}保存剧情设计。",
    automaticallyApprovedAnd: "已自动批准并",
    acceptedAnd: "已接受并",
    plotDesignSavedButTheInterfaceRefreshFailedRefresh:
      "剧情设计已保存，但界面刷新失败；请手动刷新长篇工作区。",
    plotDesignAcceptedAndSaved: "已接受并保存剧情设计",
    relatedImpactsChangedAndHaveBeenUpdatedBelowReview:
      "关联影响已变化，已更新下方影响；请重新核对并再次确认保存。",
    plotDesignImpactsChangedConfirmAgain:
      "剧情设计的关联影响已变化，请重新确认",
    failedToSavePlotDesignTheCurrentStructureIs:
      "保存剧情设计失败，当前结构保持不变。",
    plotDesignSavedButRefreshFailed: "剧情设计已经保存，但刷新失败：{message}",
    theNovelCharacterFileServiceIsUnavailable: "长篇人物文件服务当前不可用。",
    otherContentInThisBookIsBeingSavedAutomatic2:
      "检测到本书正在保存其他内容，实时自动落盘已暂停，请稍后重试。",
    automaticallyApprovingAndCreatingCharacterProfiles:
      "正在自动批准并创建人物档案…",
    creatingCharacterProfiles: "正在创建人物档案…",
    automaticallyApprovingAndSavingCharacterProfiles:
      "正在自动批准并保存人物档案…",
    savingCharacterProfiles: "正在保存人物档案…",
    currentNovelEditsAreUnsavedCharacterProfilesWereNot:
      "当前长篇编辑内容尚未保存，未覆盖人物档案。",
    someProfilesForThisCharacterAlreadyExistNoDuplicate:
      "人物目录已存在同一人物的部分档案，未重复创建。",
    theTargetCharacterProfileNoLongerExistsTheseChanges:
      "目标人物档案已经不存在，无法保存本次修改。",
    characterProfile: "人物档案",
    profileAndRelatedImpactsHaveBeenLoadedReviewThe:
      "已读取本次档案与关联影响，请核对下方影响后再次确认保存。",
    reviewTheCharacterProfileAndRelatedImpactsBeforeConfirming:
      "请核对人物档案及关联影响后再次确认保存",
    characterAndBothProfilesAutomaticallyApprovedAndCreated:
      "已自动批准并创建人物及两份档案。",
    characterAndBothProfilesCreatedAndSavedToLocal:
      "已创建人物及两份档案并保存到本地 Markdown。",
    savedToLocalMarkdown: "{value}保存到本地 Markdown。",
    savedToLocalMarkdownButTheInterfaceRefreshFailed:
      "已保存到本地 Markdown，但界面刷新失败；请手动刷新长篇工作区。",
    characterProfilesCreated: "已创建人物档案",
    characterProfilesAcceptedAndSaved: "已接受并保存人物档案",
    characterProfileImpactsChangedConfirmAgain:
      "人物档案的关联影响已变化，请重新确认",
    failedToSaveCharacterProfilesTheOriginalFilesAre:
      "保存人物档案失败，原文件保持不变。",
    characterProfilesSavedButRefreshFailed:
      "人物档案已经保存，但刷新失败：{message}",
    theNovelManuscriptServiceIsUnavailable: "长篇正文服务当前不可用。",
    otherContentInThisBookIsBeingSavedAutomatic3:
      "检测到本书正在保存其他内容，正文实时自动落盘已暂停，请稍后重试。",
    automaticallyApprovingAndSavingChapterProse: "正在自动批准并保存章节正文…",
    savingChapterProse: "正在保存章节正文…",
    currentNovelEditsAreUnsavedChapterProseWasNot:
      "当前长篇编辑内容尚未保存，未覆盖章节正文。",
    theTargetChapterCardOrProseNoLongerExists:
      "目标章卡或章节正文已经不存在，未保存本次修改。",
    chapterProse: "章节正文",
    manuscriptAndRelatedImpactsHaveBeenLoadedReviewThe:
      "已读取本次正文与关联影响，请核对下方影响后再次确认保存。",
    reviewTheChapterProseAndRelatedImpactsBeforeConfirming:
      "请核对章节正文及关联影响后再次确认保存",
    savedChapterProseToLocalMarkdown: "{value}保存章节正文到本地 Markdown。",
    chapterProseSavedButTheInterfaceRefreshFailedRefresh:
      "章节正文已保存，但界面刷新失败；请手动刷新长篇工作区。",
    chapterProseAcceptedAndSaved: "已接受并保存章节正文",
    chapterProseImpactsChangedConfirmAgain:
      "章节正文的关联影响已变化，请重新确认",
    failedToSaveChapterProseTheOriginalFilesAre:
      "保存章节正文失败，原文件保持不变。",
    chapterProseSavedButRefreshFailed:
      "章节正文已经保存，但刷新失败：{message}",
    thePendingAgentChangeNoLongerExistsGenerateIt:
      "待审阅的智能体变更已不存在，请重新生成修改。",
    waitForTheCurrentAgentTurnToFinishBefore:
      "请等待本轮智能体完成后再审阅文稿变更",
    rejectedPlotDesignIsUnchanged: "已拒绝，剧情设计保持不变。",
    rejectedChapterProseIsUnchanged: "已拒绝，章节正文保持不变。",
    rejectedTheOriginalTextIsUnchanged: "已拒绝，原文保持不变。",
    creationOfTheEmptyChapterWasRejectedItsManuscript:
      "空白章节创建已被拒绝，相关正文写入无法落盘。",
    creationOfTheEmptyWorldbuildingFileWasRejectedIts:
      "空白世界观文件创建已被拒绝，相关正文写入无法落盘。",
    characterCreationWasRejectedTheAssociatedCharacterProfileCannot:
      "人物创建已被拒绝，相关人物档案写入无法落盘。",
    plotDesignChangesRejectedTheCurrentStructureIsUnchanged:
      "已拒绝剧情设计变更，当前结构未改变",
    chapterChangesRejectedTheManuscriptIsUnchanged:
      "已拒绝章节正文变更，当前正文未改变",
    agentEditsRejectedTheOriginalTextIsUnchanged:
      "已拒绝智能体修改，原文未改变",
    anEarlierAgentEditCouldNotBeSavedThis:
      "前序智能体修改未能落盘，当前这项依赖已阻断，没有覆盖当前文稿。",
    waitingForEarlierEditsToFinishSaving: "正在等待前序修改完成落盘…",
    theTemporaryChapterAwaitingReviewHasAnInvalidFile:
      "待审阅的临时章节文件标识无效，请重新生成。",
    waitingForTheAssociatedChapterToBeCreated: "正在等待关联章节创建完成…",
    theEmptyTargetChapterHasNotBeenSavedYet:
      "目标空白章节尚未落盘，无法写入正文。请先接受章节创建，或重新生成。",
    characterCreationHasNotBeenConfirmedTheContentHas:
      "人物条目创建结果尚未确认，正文内容已保留；请先重试创建操作。",
    waitingForTheAssociatedCharacterEntryToBeCreated:
      "正在等待关联人物条目创建完成…",
    theAssociatedCharacterEntryCouldNotBeCreatedIts:
      "关联人物条目未能创建，相关正文写入已取消。",
    theTargetCharacterEntryHasNotBeenSavedYet:
      "目标人物条目尚未落盘，无法写入正文。请先接受人物条目创建，或重新生成。",
    theTargetManuscriptIsNoLongerAvailableThisAgent:
      "目标文稿已不可用，无法接受这项智能体修改。",
    theLibraryDirectoryChangedDuringReviewTheAgentEdit:
      "资料库目录已在审阅期间发生变化，未接受智能体修改。",
    theProjectIsSavingOtherContentAutomaticSavingIs:
      "检测到作品正在保存其他内容，实时自动落盘已暂停，请稍后人工重试。",
    theseEditsAreAlreadyInTheLocalMarkdownFile:
      "修改已在本地 Markdown 中；检测到另一份未保存草稿，已为你保留。",
    theseEditsAreAlreadyInTheLocalMarkdownFile2:
      "修改已经存在于本地 Markdown 中。",
    theAgentEditsAreAlreadySavedInTheLocal: "智能体修改已经保存在本地文稿中",
    thePendingChangesAreMissingTheCompleteRevisedText:
      "待审阅变更缺少完整修改稿，请重新生成修改。",
    theLibraryContentChangedDuringReviewTheAgentEdit:
      "资料库内容已在审阅期间发生变化，未接受智能体修改，也没有覆盖最新内容。",
    automaticallyApprovingAndSavingToLocalMarkdown:
      "正在自动批准并保存到本地 Markdown…",
    savingToLocalMarkdown: "正在保存到本地 Markdown…",
    savedTheReviewedAgentEditsNewerChangesMadeDuring:
      "{value}保存审阅时的智能体修改；保存期间出现的更新草稿已保留。",
    successfully: "已",
    savedToTheLocalFile: "{value}保存到本地文件。",
    theCurrentWorkspaceThisPreviewHasNoCorrespondingLocal:
      "{value}当前工作区；该预览资源没有对应的本地文件。",
    automaticallyApprovedAndWrittenTo: "已自动批准并写入",
    acceptedInto: "已接受到",
    agentEditsAcceptedAndSaved: "已接受并保存智能体修改",
    agentEditsAccepted: "已接受智能体修改",
    theLocalMarkdownFileWasUpdatedElsewhereTheAgent:
      "本地 Markdown 已在其他位置更新，未保存智能体修改；请基于最新文稿重新生成。",
    couldNotSaveTheAgentEditsTheOriginalText:
      "保存智能体修改失败，原文保持不变。",
    userEditedAgentTarget:
      "你在智能体读取后修改了《{title}》，这条修改已暂停，请在对话中选择保留或覆盖。",
    waitingForYourSaveToFinish: "等待你的保存完成后自动保存…"
  },
  plotStructureLane: {
    theTargetProjectIsNoLongerAvailableThePlot:
      "目标作品已不可用，剧情结构变更未进入审阅。",
    theTargetPlotStructureNoLongerExistsTheseChanges:
      "目标剧情结构已不存在，本次修改未进入审阅。",
    createPlotStructure: "创建剧情结构：{title}",
    renamePlotStructure: "修改剧情结构：{value} → {title}",
    thePlotStructureTargetIsUnavailableTheseChangesCannot:
      "剧情结构目标已不可用，无法应用本次变更。",
    theProjectIsSavingOtherContentAutomaticPlotStructure:
      "作品正在保存其他内容，自动创建剧情结构已暂停，请稍后重试。",
    automaticallyApprovingAndSavingThePlotStructure:
      "正在自动批准并保存剧情结构…",
    savingThePlotStructure: "正在保存剧情结构…",
    thePlotStructureWasCreatedButItsContentFile:
      "剧情结构已创建，但无法定位对应正文文件。",
    theNewPlotStructureAlreadyHasDifferentContentThe:
      "新建剧情结构正文已有不同内容，未覆盖现有文件。",
    thePlotStructureWasCreatedButItsContentFile2:
      "剧情结构已创建，但刷新工作区后仍无法定位结构正文；请重试以完成正文映射。",
    automaticallyApprovedAndCreatedPlotStructureIncludingItsContent:
      "已自动批准并创建剧情结构“{title}”，结构正文已一并保存。",
    createdPlotStructureIncludingItsContent:
      "已创建剧情结构“{title}”，结构正文已一并保存。",
    automaticallyApprovedAndUpdatedPlotStructure:
      "已自动批准并更新剧情结构“{title}”。",
    updatedPlotStructure: "已更新剧情结构“{title}”。",
    createdPlotStructure: "已创建剧情结构“{title}”",
    updatedPlotStructure2: "已更新剧情结构“{title}”",
    couldNotSaveThePlotStructure: "剧情结构保存失败。"
  },
  queue: {
    unknownError: "未知错误",
    theApprovalSaveQueueFailedThisItemIsPaused:
      "审批保存队列执行异常：{detail}。本项已暂停，可重试；后续独立任务将继续。",
    approvedWaitingForThisProjectSSaveQueue:
      "已批准，正在等待本作品的保存队列…",
    thisApprovalIsWaitingForARelatedTaskThe:
      "本次审批正在等待关联任务；内容已保留，依赖完成后将自动继续。",
    addedToTheAutomaticSaveQueue: "已进入自动保存队列…"
  },
  creationContent: {
    theNewCharacterEntryAlreadyHasDifferentContentThe:
      "新建人物条目已有不同内容，未覆盖现有文件。",
    theNewChapterAlreadyHasDifferentContentTheExisting:
      "新建章节{label}已有不同内容，未覆盖现有文件。"
  },
  libraryLane: {
    theTargetLibraryOrEntryIsNotWritableThese:
      "目标资料库或条目不可写，本次智能体变更未进入审阅。",
    theLibraryContentVersionChangedTheseAgentChangesWere:
      "资料库内容版本已变化，本次智能体变更未进入审阅，也没有覆盖你的最新编辑。",
    theLibraryContentHasNotChangedNoSaveIs: "资料库内容没有实际变化，无需保存。"
  },
  refreshSavedLongProposal: {
    theWorldbuildingFileWasSavedButTheInterfaceCould:
      "世界观文件已保存，但界面刷新失败；请手动刷新长篇工作区。"
  },
  libraryStaging: {
    theLibraryChangesCouldNotBeSubmittedForReview: "资料库变更未能进入审阅。"
  },
  libraryHydration: {
    theLibraryFileServiceIsCurrentlyUnavailable: "资料库文件服务当前不可用。",
    theLibraryContentVersionChangedGenerateTheContentAgain:
      "资料库内容版本已变化，请重新生成。"
  },
  longImpactApproval: {
    theImpactPreviewForDoesNotMatchTheCurrent:
      "{label}影响预览与当前作品不匹配。"
  },
  draftSectionLane: {
    creatingThisChapterWouldExceedTheLimitOfManuscript:
      "创建后将超过正文最多 100 个章节的限制。",
    aChapterNamedAlreadyExistsInTheManuscriptDirectory:
      "正文目录已存在同名章节“{duplicateTitle}”，未重复创建。",
    theRequestedChapterInsertionPositionNoLongerExistsNo:
      "指定的章节插入位置已不存在，未创建章节。",
    creatingAnEmptyChapterFile: "正在创建空白章节文件…"
  },
  longWorldbuildingLane: {
    theLongFormWorldbuildingFileServiceIsCurrentlyUnavailable:
      "长篇世界观文件服务当前不可用。",
    automaticallyApprovingAndCreatingTheWorldbuildingFile:
      "正在自动批准并创建世界观文件…",
    creatingTheWorldbuildingFile: "正在创建世界观文件…",
    automaticallyApprovingAndSavingTheWorldbuildingFile:
      "正在自动批准并保存世界观文件…",
    savingTheWorldbuildingFile: "正在保存世界观文件…",
    theCurrentLongFormEditsAreUnsavedTheWorldbuilding:
      "当前长篇编辑内容尚未保存，未覆盖世界观文件。",
    thisFileAlreadyExistsInTheWorldbuildingDirectoryNo:
      "世界观目录已存在同一文件，未重复创建。",
    theTargetWorldbuildingFileNoLongerExistsTheseChanges:
      "目标世界观文件已经不存在，无法保存本次修改。",
    theWorldbuildingFileSTargetCategoryNoLongerExists:
      "世界观文件的目标分类已不存在或不再是列表型。",
    worldbuildingFile: "世界观文件",
    theFileAndRelationshipImpactHaveBeenLoadedReview:
      "已读取本次文件与关联影响，请核对下方影响后再次确认保存。",
    reviewTheWorldbuildingFileAndItsRelationshipImpactThen:
      "请核对世界观文件及关联影响后再次确认保存",
    automaticallyApprovedAndCreatedTheWorldbuildingFile:
      "已自动批准并创建世界观文件。",
    createdTheWorldbuildingFileAndSavedItToLocal:
      "已创建世界观文件并保存到本地 Markdown。",
    worldbuildingFileCreated: "已创建世界观文件",
    worldbuildingFileAcceptedAndSaved: "已接受并保存世界观文件",
    theWorldbuildingFileSRelationshipImpactHasChangedConfirm:
      "世界观文件的关联影响已变化，请重新确认",
    couldNotSaveTheWorldbuildingFileTheOriginalFile:
      "保存世界观文件失败，原文件保持不变。",
    theWorldbuildingFileWasSavedButTheRefreshFailed:
      "世界观文件已经保存，但刷新失败：{message}"
  }
};
