export default {
  conversationPreferenceState: {
    conversationScopeCannotBeEmpty: "会话 scope 不能为空。"
  },
  conversationControllerPersistence: {
    theCurrentStorageCannotSaveConversationUpdatesPleaseTry:
      "当前存储无法保存增量会话，请重试。"
  },
  conversationStore: {
    conversationKeyCannotBeEmpty: "会话 key 不能为空。"
  },
  conversationPersistenceQueue: {
    theConversationPersistenceQueueIsClosed: "会话持久化调度器已经关闭。",
    persistenceKeyCannotBeEmpty: "持久化 key 不能为空。",
    theConversationStorageAdapterHasNotBeenConfigured:
      "会话持久化适配器尚未配置。"
  },
  conversationPersistenceState: {
    failedToSaveConversationState: "保存会话状态失败。"
  },
  agentActivityDescriptors: {
    agentConversation: "智能体对话",
    novelAgent: "长篇智能体",
    novelProject: "长篇作品"
  },
  write: {
    exportCanceled: "导出已取消。",
    deepwriteConversationJson: "DeepWrite-对话-{slice}.json",
    exportConfirmationsAreOutOfOrderPleaseRestartThe:
      "导出确认顺序不一致，请重新导出。"
  },
  action: {
    finishOrCancelTheCurrentExportFirst: "请先完成或取消正在进行的导出。",
    theConversationHasChangedSelectTheConversationToExport:
      "当前对话已切换，请重新选择需要导出的对话。",
    exported: "已导出 {fileName}"
  },
  capture: {
    theConversationContainsNonJsonObjectsAndCannotBe:
      "会话包含非 JSON 对象，无法完整导出。",
    allConversationRecordsCurrentlyLoadedInThisClientIncluding:
      "当前客户端已加载的完整会话记录，包括未确认保存的内容；不包含其他会话或未加载的数据库原始字段，不是完整数据库备份。"
  },
  jsonChunks: {
    theConversationContainsDataThatCannotBeExportedAs:
      "会话中包含无法导出为 JSON 的数据。",
    theConversationContainsCircularReferencesAndCannotBeFully:
      "会话中包含循环引用，无法完整导出。"
  },
  conversationHistoryWriter: {
    conversationSaveAcknowledgmentDoesNotMatch: "会话保存确认编号不匹配。",
    conversationChunkSaveAcknowledgmentDoesNotMatch:
      "会话分块保存确认编号不匹配。"
  },
  conversationHistoryIndex: {
    invalidConversationTimestampTheOriginalRecordHasBeenPreserved:
      "历史对话时间格式无效，原始记录已保留。",
    untitledConversation: "未命名对话",
    theConversationHistoryCursorDidNotAdvance: "历史会话分页游标没有向前移动。"
  },
  bookConversationMigration: {
    someExistingBookHistoryRecordsAreNotRecognizedThe:
      "已有书籍历史包含暂无法识别的记录，原始记录已保留。",
    historyChangedDuringMigrationPleaseTryAgain:
      "历史记录在迁移期间已更新，请重试。"
  },
  conversationHistoryUpload: {
    thisConversationFieldCannotBeSavedInChunks: "无法分块保存此会话字段。"
  },
  conversationHistoryRecordLoader: {
    invalidHistoryFieldPath: "历史字段路径无效。",
    thisConversationNoLongerExistsOrHasBeenDeleted:
      "此历史对话已不存在或已删除。",
    invalidHistoryMetadata: "历史元数据格式无效。",
    invalidHistoryMessageFormat: "历史消息格式无效。",
    historyMessageIdentifiersDoNotMatchTheCurrentConversation:
      "历史消息标识不一致，未替换当前对话。",
    theHistoryPaginationCursorDidNotAdvance: "历史分页游标没有向前移动。",
    historyMessageCountValidationFailedTheCurrentConversationHas:
      "历史消息数量校验失败，未替换当前对话。",
    conversationHistoryCouldNotBeFullyReadTheOriginal:
      "历史对话格式无法完整读取，原始记录已保留。"
  },
  bookConversationPreparation: {
    historyCouldNotBeFullyReadTheOriginalRecords:
      "历史记录暂时无法完整读取，原始记录已保留。"
  },
  conversationModelOptions: {
    officialSite: "官方小站",
    customModels: "自定义模型",
    freeModels: "免费模型",
    minimal: "最低",
    low: "较低",
    medium: "标准",
    high: "深度",
    extraHigh: "极高",
    maximum: "最高",
    off: "关闭",
    custom: "自定义（{level}）",
    requestApproval: "请求批准",
    askForYourApprovalBeforeEditingOrWritingThe: "修改或写入正文前均需你的批准",
    approveAutomatically: "替我审批",
    automaticallyApproveEditsAndSaveThemToTheManuscript:
      "自动批准修改并写入正文"
  },
  conversationTurnNavigator: {
    attachments: "附件：{attachmentNames}",
    noText: "无文字消息"
  },
  longConversationCoordinator: {
    theNovelContextConversationModelSettingsOrInputChanged:
      "长篇上下文、会话、模型设置或输入内容已切换，本次发送已取消。",
    savingAndPreparingToSendWaitBeforeYou:
      "正在保存并准备发送，请稍后再{action}。",
    newConversation: "新建对话",
    stopTheCurrentNovelResponseBeforeStartingANew:
      "请先停止当前长篇回复，再新建对话。",
    switchConversation: "切换对话",
    stopTheCurrentResponseBeforeSwitchingConversations:
      "请先停止当前回复，再切换历史对话。",
    thisNovelConversationIsNoLongerAvailable: "这条长篇历史对话已不可用。",
    thePreviousNovelMessageIsStillBeingPreparedPlease:
      "正在准备上一条长篇消息，请稍候。",
    theNovelWorkspaceContextIsNotReadyPleaseTry:
      "长篇工作区上下文尚未就绪，请稍后重试。",
    waitForTheCurrentResponseApprovalsAndNovelEdits:
      "请先等待当前回复、审批和长篇修改保存全部完成。",
    novelAgentSettingsHaveNotLoadedPleaseTryAgain:
      "长篇智能体设置尚未加载，请重试。",
    theNovelContextChangedSendingWasCanceled:
      "长篇上下文已切换，本次发送已取消。",
    theNovelWorkspaceIsNotConnectedInThisEnvironment:
      "当前环境未连接长篇工作区。",
    failedToReadTheCurrentWorldbuildingStage:
      "当前世界观阶段读取失败：{message}",
    failedToReadTheCurrentWorldbuildingStagePleaseTry:
      "当前世界观阶段读取失败，请重试。",
    failedToReadTheCurrentCharacterStage: "当前人物阶段读取失败：{message}",
    failedToReadTheCurrentCharacterStagePleaseTry:
      "当前人物阶段读取失败，请重试。",
    theNovelContextIsTooLongOnlyATruncated:
      "长篇上下文过长，本轮只注入了截断后的 AGENTS.md。",
    novelContextWasNotIncluded: "长篇上下文未注入：{message}",
    novelContextWasNotIncludedTheMessageWillStill:
      "长篇上下文未注入，本轮仍会发送。",
    theNovelResourceContextChangedSendingWasCanceled:
      "长篇资源上下文已切换，本次发送已取消。",
    additionalNovelResourceNotices: "{message}（另有 {value} 项长篇资源提示）",
    failedToSendTheNovelMessagePleaseTryAgain: "发送长篇消息失败，请稍后重试。",
    changeModelSettings: "修改模型设置"
  },
  conversationHistoryManagement: {
    deletedConversationsCouldNotBeLoadedPleaseTryAgain:
      "暂时无法读取已归档对话，请重试。",
    finishOrStopTheCurrentResponseBeforeManagingConversations:
      "请先完成或停止当前回复，再管理对话。",
    conversationArchived: "对话已归档，可在设置中恢复。",
    conversationRestored: "对话已恢复。",
    theConversationOperationDidNotCompletePleaseTryAgain:
      "对话管理操作未完成，请重试。"
  },
  conversationAttachments: {
    eachMessageCanIncludeUpToAttachments:
      "每条消息最多上传 {PROMPT_ATTACHMENT_MAX_ITEMS} 个附件。",
    textAttachmentsCanContainUpToCharactersInTotal:
      "文本附件合计最多携带 {toLocaleString} 个字符。",
    imageAttachmentsCannotExceedMbInTotal: "图片附件合计不能超过 25 MB。",
    failedToRead: "读取“{name}”失败。",
    additionalAttachmentsWereNotAdded: "{value}（另有 {value2} 个附件未添加）",
    addedAttachments: "已添加 {added} 个附件",
    attachmentsAreBeingReadWaitBeforePastingAgain:
      "正在读取附件，请稍后再粘贴。"
  },
  conversationSelectionInsertion: {
    agentResponse: "智能体回复 {responseNumber}"
  },
  currentConversationExport: {
    chooseAnotherLocationAndTryAgain: "{value} 可重新选择位置重试。",
    exportIncomplete: "导出未完成。"
  },
  conversationRegistryHistoryManagement: {
    thisConversationNoLongerExists: "此历史对话已不存在。",
    historyOperationAcknowledgmentDoesNotMatchPleaseTryAgain:
      "历史管理确认编号不匹配，请重试。",
    conversationStateChangedRefreshHistoryAndTryAgain:
      "会话状态已变化，请刷新历史后重试。"
  },
  shortConversationCoordinator: {
    noStageSelected: "未选择阶段",
    currentLibrary: "当前{value}库 · {title}",
    currentLibrary2: "当前{value}库",
    group: "分组 · {title}",
    methodsLoadedOnDemand: "按需加载的方法",
    noResourceSelected: "未选择资源",
    theCurrentResourceConversationOrInputChangedSendingWas:
      "当前资源、会话或输入内容已切换，本次发送已取消。",
    stopTheCurrentResponseBeforeStartingANewConversation:
      "请先停止当前回复，再新建对话。",
    waitForAgentEditsToFinishSavingBeforeStarting:
      "请等待智能体修改保存完成后再新建对话",
    waitForAgentEditsToFinishSavingBeforeSwitching:
      "请等待智能体修改保存完成后再切换对话",
    stopTheCurrentResponseBeforeSwitchingConversations:
      "请先停止当前回复，再切换历史对话",
    thisConversationIsUnavailableReopenTheHistoryList:
      "这条历史对话已不可用，请重新打开历史列表",
    thePreviousMessageIsStillBeingPreparedPleaseWait:
      "正在准备上一条消息，请稍候。",
    waitForTheCurrentResponseApprovalsAndEditsTo:
      "请先等待当前回复、审批和修改保存全部完成。",
    theLibraryContextIsNotReadySelectTheEntry:
      "当前资料库上下文尚未就绪，请重新选择条目后再发送。",
    additionalLibraryNotices: "{message}（另有 {value} 项资料库提示）",
    additionalSkillNotices: "{message}（另有 {value} 项可用技能提示）",
    failedToSendMessagePleaseTryAgainShortly: "发送消息失败，请稍后重试。",
    generationStopped: "已停止生成",
    failedToStopGenerationPleaseTryAgainShortly: "停止生成失败，请稍后重试。"
  },
  conversationComposer: {
    useSkill: "调用技能",
    referenceSkill: "引用技能",
    referenceMaterial: "引用素材",
    assignTeamMember: "指派团队成员",
    searchSkillsByName: "输入名称搜索技能",
    searchSkillEntriesByName: "输入名称搜索技能条目",
    searchMaterialEntriesByName: "输入名称搜索素材条目",
    searchTeamMembersByName: "输入名称搜索团队成员，任务会交给该成员",
    sendingIsUnavailableInTheBrowserPreviewStartThe:
      "浏览器预览不可发送，请启动桌面客户端",
    describeALibraryTaskTypeToLoadAMethod:
      "描述资料库任务，输入 / 加载方法技能，输入 {'@'} 引用当前库或同分组其它库的技能……",
    describeALibraryTaskTypeToLoadAMethod2:
      "描述资料库任务，输入 / 加载方法技能，输入 {'@'} 引用当前库或同分组其它库的素材……",
    writeAnythingTypeToUseSkillsOrToReference:
      "随心输入，输入 / 调用技能，输入 {'@'} 引用素材……",
    writeAnythingTypeToUseSkillsOrToReferenceOrTeam:
      "随心输入，输入 / 调用技能，输入 {'@'} 引用素材，输入 # 指派团队成员……",
    eachMessageCanIncludeUpToAttachmentsOrManuscript:
      "每条消息最多携带 {PROMPT_ATTACHMENT_MAX_ITEMS} 项附件或正文引用。",
    textAttachmentsAndManuscriptReferencesCanContainUpTo:
      "文本附件与正文引用合计最多携带 {toLocaleString} 个字符。"
  },
  conversationSaveStatus: {
    theConversationCouldNotBeSavedLocallyPleaseTry:
      "对话暂时无法保存到本机，请重试。",
    waitingToSave: "等待保存",
    saving: "正在保存",
    saved: "已保存",
    saveFailed: "保存失败"
  },
  agentActivityCoordinator: {
    theAssociatedAgentContextNoLongerExistsTheNotice:
      "对应的智能体上下文已不存在，已移除该提醒。"
  },
  sessionLifecycle: {
    theConversationWasSwitchedOrClosedSubtasksWereAlso:
      "会话已切换或关闭，子任务同步停止。",
    theConversationWasSwitchedOrClosedBeforeToolCalls:
      "会话已切换或关闭，工具调用未返回完整终态。"
  },
  webSearch: {
    setUpInSettings:
      "联网搜索未启用或未配置密钥，请先在设置 → 个人 → 联网搜索中开启"
  },
  followUpQueue: {
    steerFailed: "插话失败，已放回排队。",
    queueIsFull: "最多排队 {count} 条。"
  },
  history: {
    historicalAttachmentNoteOnlyAttachmentNamesWereRestoredOriginal:
      "{content}\n\n【历史附件说明】{map}。本条只恢复了附件名称，原始附件未在会话记录中保存；需要核对或引用原文、图片时，请用户重新上传。",
    steeringNotes: "{content}\n\n【运行中补充】\n{notes}",
    theConversationHistoryExceedsTheRestorationTransferLimitIt:
      "会话历史超过恢复传输上限，未截断或发送。请从已有检查点新建会话，原对话仍保留。"
  },
  parseSubagent: {
    theSubtaskWasStoppedWhenTheConversationWasRestored:
      "会话恢复时子任务已停止。",
    theSubtaskWasStillRunningWhenTheAppClosed:
      "应用关闭或对话恢复时，子任务仍在运行。",
    theSubtaskHadNotStartedWhenTheAppClosed:
      "应用关闭或对话恢复时，子任务尚未开始。"
  },
  conversationRuntimeRegistryCoordinator: {
    conversationHistoryCouldNotBeSavedLocallyYouCan:
      "历史对话暂时无法保存到本机，本次运行中仍可继续切换",
    conversationHistoryMigrationIsIncompleteTheOriginalRecordsHave:
      "历史对话迁移暂未完成，原始记录已保留",
    conversationHistoryCouldNotBeReadYouCanContinue:
      "历史对话暂时无法读取，请检查用户数据目录；消息需保存成功后才能发送",
    theConversationRuntimeRegistryHasBeenClosed: "会话运行时注册表已经关闭。"
  },
  writingContext: {
    theContextIsTooLongOnlyATruncatedAgents:
      "{label}上下文过长，本轮只注入了截断后的 AGENTS.md。",
    theContextWasNotIncluded: "{label}上下文未注入：{message}",
    theContextWasNotIncludedThisTurnWillStill:
      "{label}上下文未注入，本轮仍会发送。"
  },
  runLifecycle: {
    theParentAgentStoppedSubtasksWereAlsoStopped:
      "父智能体运行已停止，子任务同步停止。",
    theAgentStoppedBeforeToolCallsReturnedTheirFinal:
      "智能体运行已停止，工具调用未返回完整终态。"
  },
  sendMessage: {
    acceptStalled: "接受修改超时，请重试。",
    messageExceedsContextBudget:
      "消息和附件约 {used} token，超过当前可用的 {limit} token。已按压缩上下文上限 {budget} token 预留 10% 余量，请缩短内容或调整设置。",
    messageTooLong:
      "单条消息最多 {limit} 个字符，当前为 {length} 个字符。请将内容分段发送。",
    couldNotSaveBeforeSending:
      "消息尚未保存到本机，暂时无法发送。请检查用户数据目录。",
    pleaseReadAndAnalyzeTheAttachmentsIUploaded: "请阅读并分析我上传的附件。",
    theBrowserPreviewHasNoDesktopAgentRuntimeStart:
      "浏览器预览没有桌面 Agent Runtime，请使用 pnpm dev 启动客户端。",
    couldNotRestoreHistory: "恢复历史失败。",
    theAgentAcceptanceResponseReturnedTheWrongSessionId:
      "智能体受理结果返回了错误的会话标识。",
    theAgentAcceptanceResponseHasADifferentRunId:
      "智能体受理结果与已到达事件的运行标识不一致。",
    theAgentRequestCouldNotBeAccepted: "智能体请求受理失败。"
  },
  runStopping: {
    theAgentStopResponseDoesNotMatchTheCurrent:
      "智能体停止结果与当前运行不一致。"
  },
  events: {
    multipleRunIdsWereReceivedForTheSameRequest:
      "同一次请求收到了多个运行标识。",
    contextCompactionFailedTheOriginalContextWasPreserved:
      "上下文压缩失败：{value}。原上下文已保留。",
    unknownReason: "未知原因",
    theParentAgentCompletedButSubtasksDidNotReturn:
      "父智能体运行已完成，但子任务未返回完整终态。",
    theAgentCompletedButToolCallsDidNotReturn:
      "智能体运行已完成，但工具调用未返回完整终态。"
  },
  historyLoading: {
    theConversationHistoryIsIncompleteCannotSwitchConversationsTry:
      "会话历史不完整，无法切换，请重试。",
    theCurrentStorageDoesNotSupportLoadingThisConversation:
      "当前存储不支持加载此会话。",
    theActiveConversationHasNotFinishedLoading: "活动会话尚未完整加载。"
  },
  messageIdentity: {
    theAgentReturnedInconsistentMessageIdsForTheSame:
      "智能体为同一运行返回了不一致的消息标识。",
    theAgentMessageIdConflictsWithAnExistingMessage:
      "智能体消息标识与现有消息发生冲突。"
  },
  subagentEvents: {
    theParentAgentEndedUnexpectedlySubtasksWereAlsoStopped:
      "父智能体运行异常结束，子任务同步停止。",
    theSubtaskHasAlreadyEnded: "子任务已经结束。",
    theSubtaskEndedWithoutReturningAToolResult: "子任务结束前未返回工具结果。",
    theSubtaskEndedWithoutAFinalStatus:
      "委派已结束，但该子任务没有返回最终状态。"
  },
  subagentIdentity: {
    receivingSubtask: "正在接收子任务…"
  },
  historyManagementErrors: {
    couldNotDeleteTheConversationTryAgain: "归档对话失败，请重试。",
    conversationDeletionHasNotBeenConfirmedRetryDeletingIt:
      "归档结果尚未确认，请先重试归档；新编辑仍保留在本地。"
  },
  persistenceChanges: {
    theConversationContainsNonFiniteNumbersThatCannotBe:
      "会话记录包含无法保存的非有限数值。",
    theConversationContainsDataTypesThatJsonCannotSave:
      "会话记录包含 JSON 无法保存的数据类型。",
    theConversationContainsCircularReferencesAndCannotBeSaved:
      "会话记录包含循环引用，无法保存。",
    conversationsCanContainOnlyJsonArraysAndPlainObjects:
      "会话记录只能包含 JSON 数组和普通对象。",
    aConversationArrayContainsMissingEntriesAndCannotBe:
      "会话记录数组含缺失项，无法保存。"
  },
  userInput: {
    theUserResponseResultDoesNotMatchTheCurrent:
      "用户回答结果与当前请求不一致。",
    couldNotSubmitTheUserResponse: "提交用户回答失败。"
  },
  idleTimeout: {
    theAgentHasNotReturnedNewEventsForAn:
      "智能体长时间没有返回新事件，请稍后重试。"
  },
  sendEntrypoints: {
    longFormWriting: "长篇创作"
  },
  contextCompaction: {
    compactionWasNotCompletedTheRunWasInterrupted: "压缩未完成，运行已中断。"
  },
  conversationTextReferences: {
    theReferencedAgentReplyNoLongerExistsItsReference:
      "引用的智能体回复已不存在，已移除这条引用"
  }
};
