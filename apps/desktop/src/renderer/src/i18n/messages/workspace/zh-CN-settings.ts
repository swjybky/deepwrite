export default {
  settingsStore: {
    failedToLoadSettings: "加载设置失败。",
    officialSiteModelsAvailableWithYourKey:
      "添加新官方小站模型密钥，即可使用官方小站模型。"
  },
  voiceRecorder: {
    recordingCanceled: "已取消录音"
  },
  batchModelSettings: {
    modelConfigurationIdsMustBeUnique: "模型配置 ID 不能重复。",
    selectAtLeastOneModelToSave: "请至少选择一个要保存的模型。"
  },
  voiceAudio: {
    noAudioWasRecordedCheckYourMicrophoneAndTry:
      "没有录到声音，请检查麦克风后重新录音。"
  },
  customModelProvider: {
    enterAProviderName: "请输入提供商名称",
    providerNamesCannotExceedCharacters: "提供商名称不能超过 120 个字符",
    thisIsABuiltInProviderSelectItFrom: "这是内置提供商，请直接从列表选择"
  },
  appearanceFonts: {
    fontImportIsNotAvailableInThisEnvironment: "当前环境不支持导入字体",
    unnamedFont: "未命名字体",
    fontDeletionIsNotAvailableInThisEnvironment: "当前环境不支持删除字体",
    notARegularFile: "不是普通文件",
    onlyTtfAndOtfAreSupported: "仅支持 TTF 或 OTF",
    invalidFontFile: "字体文件无效",
    fileTooLarge: "文件过大",
    fontStorageLimitReached: "已达字体存储上限",
    cannotReadFile: "无法读取文件"
  },
  settingsFeatureCoordinator: {
    failedToLoadWorkspaceAgentSettings: "加载创作空间智能体设置失败。",
    failedToLoadNovelAgentSettings: "加载长篇智能体设置失败。",
    savedAgentPromptsWelcomeShortcutsAndReadPermissionsChanges:
      "{value}智能体提示词、欢迎快捷与读取范围已保存，下一轮对话立即生效。",
    failedToSaveWorkspaceAgentSettings: "保存创作空间智能体设置失败。",
    savedPromptsWelcomeShortcutsAndMaterialSkillReadPermissions:
      "长篇四个阶段智能体的提示词、欢迎快捷与素材/技能读取范围已保存，下一轮对话立即生效。",
    failedToSaveNovelAgentSettings: "保存长篇智能体设置失败。",
    failedToLoadAgentTeamSettings: "加载智能体团队设置失败。",
    agentTeamCreated: "智能体团队已创建。",
    failedToCreateAgentTeam: "创建智能体团队失败。",
    agentTeamRenamed: "智能体团队已重命名。",
    failedToRenameAgentTeam: "重命名智能体团队失败。",
    agentTeamDeleted: "智能体团队已删除。",
    failedToDeleteAgentTeam: "删除智能体团队失败。",
    teamEnabledItWillBeUsedForTheNext:
      "团队已启用，下一轮对应类型的对话开始使用。",
    teamDisabledItWillNoLongerBeUsedFor:
      "团队已关闭，下一轮对应类型的对话不再使用团队配置。",
    failedToUpdateTeamStatus: "更新团队启用状态失败。",
    agentTeamSaved: "智能体团队已保存。",
    failedToSaveAgentTeamSettings: "保存智能体团队设置失败。",
    agentTeamArchiveDownloaded: "智能体团队文件已下载。",
    failedToDownloadAgentTeam: "下载智能体团队失败。",
    agentTeamInstalled: "智能体团队“{teamName}”已导入。",
    failedToInstallAgentTeam: "导入智能体团队失败。",
    failedToLoadLibraryAgentSettings: "加载资料库智能体设置失败。",
    libraryAgentSettingsSavedChangesApplyToTheNext:
      "资料库智能体设置已保存，下一轮对话立即生效。",
    failedToSaveLibraryAgentSettings: "保存资料库智能体设置失败。",
    agentSettingsRestoredToDefaults: "{value}智能体已恢复默认设置。",
    failedToRestoreLibraryAgentDefaults: "恢复资料库智能体默认设置失败。"
  },
  modelApiTestFixture: {
    connectionSuccessful: "连接成功"
  },
  workspaceDirectorySettings: {
    failedToLoadTheWorkingDirectory: "加载工作目录失败。",
    failedToChangeTheWorkingDirectory: "切换工作目录失败。",
    workingDirectoryChangedExistingProjectsRemainInTheirOriginal:
      "工作目录已切换；现有项目保持原位置不变",
    workingDirectoryRestoredToItsDefaultLocationExistingProjects:
      "工作目录已恢复默认位置；现有项目保持原位置不变"
  },
  modelProviderGroups: {
    deepwriteFreeModels: "DeepWrite 免费模型"
  },
  modelSettingsCoordinator: {
    failedToLoadModelUsage: "加载模型用量失败。",
    failedToUpdateModelStatus: "更新模型启用状态失败。",
    modelSettingsSavedAndAppliedToSubsequentConversations:
      "模型配置已保存，并已同步到后续对话。",
    failedToSaveModelSettings: "保存模型配置失败。",
    freeModelListRefreshed: "免费模型列表已刷新。",
    failedToRefreshFreeModelSettings: "刷新免费模型配置失败。",
    freeModelEnabledAndAddedToModelSettings:
      "免费模型已启用，并显示在模型配置中。",
    freeModelDisabledAndHiddenFromModelSettings:
      "免费模型已停用，并从模型配置中隐藏。",
    failedToUpdateFreeModelStatus: "更新免费模型启用状态失败。",
    modelConnectionTestFailed: "模型连接测试失败。",
    modelConnectionTestFailedWithReason: "模型连接测试失败：{reason}"
  },
  appearanceThemeRuntime: {
    warmPaper: "暖纸",
    seaMist: "海雾",
    eyeCare: "护眼",
    invalidThemeFileFormat: "主题文件格式无效"
  },
  storageSettings: {
    failedToReadStorageSettingsPleaseTryAgain: "读取存储设置失败，请重试。",
    dataMigrationIsReadyTheAppWillRestart: "数据迁移已准备完成，应用即将重启。",
    failedToChangeTheUserDataDirectoryPleaseTry:
      "更改用户数据目录失败，请重试。",
    failedToChangeTheUserDataDirectoryWithReason:
      "更改用户数据目录失败：{reason}",
    failedToOpenDirectoryPleaseTryAgain: "打开目录失败，请重试。",
    storageBusy: "有任务正在运行或存储操作尚未结束，请完成后再更改存储位置。",
    invalidDirectory:
      "请选择本机上的普通文件夹，不能使用快捷方式、符号链接或目录联接。",
    unresolvablePath:
      "无法识别所选文件夹的真实路径。虚拟盘、云盘挂载盘等位置可能不受支持，请选择本机磁盘上的普通文件夹。",
    overlapsInstallation:
      "用户数据目录不能位于应用安装目录内，也不能包含安装目录，请选择其他文件夹。",
    nestedLocation:
      "新位置不能位于当前用户数据目录内，也不能包含当前目录，请选择独立文件夹。",
    targetNotEmpty:
      "所选位置中的 DeepWriteData 文件夹已有文件。为避免覆盖，请选择其他位置。",
    notWritable: "没有所选位置的写入权限，请选择其他文件夹。",
    saveFailed: "当前对话尚未保存完成，已取消迁移，请稍后重试。",
    openFailed: "无法打开存储目录，请检查目录是否存在且可访问。"
  },
  modelEditor: {
    automaticRecommended: "自动（推荐）",
    ollamaUsesCompatibilityModeOtherProvidersUseTheNative:
      "Ollama 自动使用兼容模式，其它服务使用 PI 原生结构",
    piNative: "PI 原生",
    keepAllParameterConstraintsForOfficialAndFullyCompatible:
      "保留完整参数约束，适合官方和能力完整的服务",
    compatibilityMode: "兼容模式",
    simplifyParameterConstraintsThatMayCauseLocalModelGrammar:
      "简化容易导致本地模型语法失败的参数约束",
    thinkingMode: "思考模式",
    nonThinkingMode: "不思考模式",
    thinkingModeRequiresAtLeastOneReasoningLevel:
      "思考模式至少需要保留一个思考等级。",
    enterTheProviderAndModelId: "请填写 Provider 和模型 ID。",
    customReasoningLevelsMustDifferFromBuiltInLevels:
      "自定义思考等级不能与内置等级重复，且只能包含英文字母、数字、点、下划线或连字符。",
    enterDifferentTemperaturesBetweenAnd:
      "请填写 3 个不同的温度值，范围为 0 到 2。",
    configureAtLeastOneReasoningLevelAndChooseA:
      "请配置至少一个思考等级，并选择有效的默认等级。",
    enterTheProviderAndModelIdBeforeTestingThe:
      "请先填写 Provider 和模型 ID，再测试连接。"
  },
  appearanceFontRuntime: {
    deepwrite: "DeepWrite 深度写作"
  },
  voiceSettings: {
    systemDefaultMicrophone: "系统默认麦克风",
    failedToReadVoiceSettingsPleaseTryAgain: "语音模型配置读取失败，请重试。",
    failedToReadVoiceUsagePleaseTryAgain: "语音用量读取失败，请重试。",
    microphone: "麦克风 {value}",
    selectedMicrophoneNotCurrentlyDetected: "已选麦克风（暂未检测到）",
    cannotReadMicrophoneDevices: "无法读取麦克风设备。",
    enterAnHttpsEndpointWithoutCredentialsQueryParametersOr:
      "请输入不含账号密码、查询参数和片段的 HTTPS 接口地址。",
    enterTheSpeechRecognitionModel: "请填写语音识别模型。",
    voiceSettingsSaved: "语音模型配置已保存。",
    failedToSaveVoiceSettingsPleaseTryAgain: "语音模型配置保存失败，请重试。"
  },
  voiceUsageSummary: {
    today: "今日",
    thisMonth: "本月",
    allTime: "累计",
    s: "{seconds} 秒",
    mS: "{minutes} 分 {value} 秒",
    hM: "{floor} 小时 {value} 分",
    notReported: "未返回"
  },
  voiceSettingsOptions: {
    xiaomiMimo: "小米 MiMo",
    alibabaQwen: "阿里千问",
    openPlatformPayAsYouGo: "开放平台 · 按量付费",
    autoDetect: "自动识别",
    chinese: "中文",
    english: "英语",
    mimoOpenPlatform: "MiMo · 开放平台",
    alibabaQwenTokenPlan: "阿里千问 · Token Plan",
    alibabaQwenOpenPlatform: "阿里千问 · 开放平台"
  },
  builtinSubagentSettings: {
    enterACallingDescriptionOfUpToCharacters:
      "请输入调用描述，长度不超过 1,000 字。",
    builtInManagementSubagentSettingsSaved: "已保存内置管理工具设置",
    failedToSavePleaseTryAgain: "保存失败，请重试。"
  },
  remoteModelListing: {
    enterTheApiUrlAndApiKeyBeforeFetching:
      "请先填写 API 地址和 API Key，再拉取可用模型。",
    enterTheApiUrlBeforeFetchingAvailableModels:
      "请先填写 API 地址，再拉取可用模型。",
    enterTheApiKeyBeforeFetchingAvailableModels:
      "请先填写 API Key，再拉取可用模型。",
    modelListingIsNotAvailableInThisEnvironment: "当前环境无法拉取模型列表。",
    thisEndpointReturnedNoAvailableModels: "当前接口没有返回可用模型。",
    foundAvailableModelsSelectTheModelsToSave:
      "已拉取 {length} 个可用模型，请勾选要保存的模型。",
    failedToFetchModelList: "拉取模型列表失败。"
  },
  modelSettingsDraft: {
    invalidModelConfiguration: "模型配置无效。"
  },
  voiceInput: {
    microphoneAccessIsDisabledAllowDeepwriteToUseThe:
      "麦克风权限未开启，请在系统设置中允许 DeepWrite 使用麦克风。",
    theSelectedMicrophoneWasNotFoundSelectAnotherIn:
      "找不到所选麦克风，请在语音模型配置中重新选择。",
    theMicrophoneIsUnavailableCheckWhetherItIsDisconnected:
      "麦克风暂时无法使用，请检查设备是否已断开或被其他应用占用。",
    speechRecognitionFailedPleaseTryAgain: "语音识别失败，请重试。",
    voiceInputIsOnlyAvailableInTheDesktopApp: "语音输入仅支持桌面客户端。",
    saveTheSelectedProviderSApiKeyInSettings:
      "请先在“设置 → 语音模型配置”中保存所选服务的 API Key。",
    theMicrophoneDisconnectedThisRecordingWasCanceled:
      "麦克风已断开，本次录音已取消。",
    theSpeechRecognitionResponseDoesNotMatchPleaseTry:
      "语音识别返回结果不匹配，请重试。",
    noSpeechWasRecognizedTryAgainOrRecordA: "未识别到文字，请重试或重新录音。"
  },
  modelUsagePanel: {
    lastHours: "近 24 小时",
    lastDays: "近 7 天",
    lastDays2: "近 30 天",
    allTime: "全部",
    noTrendDataYet: "{value}暂无趋势数据",
    totalModelTokenTrendInTotal: "{value}模型总 Token 趋势，共 {value2}",
    unused: "未使用",
    currentConfiguration: "当前配置",
    historicalModel: "历史模型",
    localSimulation: "本地模拟",
    newOfficialSite: "新官方小站",
    deepwriteFree: "DeepWrite 免费",
    subagent: "子智能体",
    connectionTest: "连接测试",
    mainAgent: "主智能体",
    error: "错误",
    aborted: "已中止",
    completed: "完成"
  },
  siteOfficialModelSettings: {
    couldNotRetrieveTheNewOfficialSiteSBalance: "查询新官方小站额度失败。",
    theNewOfficialSiteSModelKeyHasBeen:
      "新官方小站模型密钥已安全保存，模型现在可以直接使用。",
    couldNotSaveTheNewOfficialSiteSModel: "保存新官方小站模型密钥失败。",
    theNewOfficialSiteSModelKeyWasRemoved:
      "新官方小站模型密钥已移除，历史用量仍保留在本机账本中。",
    couldNotRemoveTheNewOfficialSiteSModel: "移除新官方小站模型密钥失败。",
    couldNotRefreshTheNewOfficialSiteSModels: "刷新新官方小站模型失败。",
    theNewOfficialSiteSModelPageHasBeen: "新官方小站模型页面已刷新。",
    modelEnabledAndAddedToTheModelSelector: "模型已启用，并显示在模型选择中。",
    modelDisabledAndHiddenFromTheModelSelector:
      "模型已停用，并从模型选择中隐藏。"
  }
};
