export default {
  settingsStore: {
    failedToLoadSettings: "Failed to load settings.",
    officialSiteModelsAvailableWithYourKey:
      "Add your official site model key to start using official site models."
  },
  voiceRecorder: {
    recordingCanceled: "Recording canceled"
  },
  batchModelSettings: {
    modelConfigurationIdsMustBeUnique:
      "Model configuration IDs must be unique.",
    selectAtLeastOneModelToSave: "Select at least one model to save."
  },
  voiceAudio: {
    noAudioWasRecordedCheckYourMicrophoneAndTry:
      "No audio was recorded. Check your microphone and try again."
  },
  customModelProvider: {
    enterAProviderName: "Enter a provider name",
    providerNamesCannotExceedCharacters:
      "Provider names cannot exceed 120 characters",
    thisIsABuiltInProviderSelectItFrom:
      "This is a built-in provider. Select it from the list."
  },
  appearanceFonts: {
    fontImportIsNotAvailableInThisEnvironment:
      "Font import is not available in this environment",
    unnamedFont: "Unnamed font",
    fontDeletionIsNotAvailableInThisEnvironment:
      "Font deletion is not available in this environment",
    notARegularFile: "Not a regular file",
    onlyTtfAndOtfAreSupported: "Only TTF and OTF are supported",
    invalidFontFile: "Invalid font file",
    fileTooLarge: "File too large",
    fontStorageLimitReached: "Font storage limit reached",
    cannotReadFile: "Cannot read file"
  },
  settingsFeatureCoordinator: {
    failedToLoadWorkspaceAgentSettings:
      "Failed to load workspace agent settings.",
    failedToLoadNovelAgentSettings: "Failed to load novel agent settings.",
    savedAgentPromptsWelcomeShortcutsAndReadPermissionsChanges:
      "Saved {value} agent prompts, welcome shortcuts, and read permissions. Changes apply to the next conversation turn.",
    failedToSaveWorkspaceAgentSettings:
      "Failed to save workspace agent settings.",
    savedPromptsWelcomeShortcutsAndMaterialSkillReadPermissions:
      "Saved prompts, welcome shortcuts, and material/skill read permissions for the four novel stage agents. Changes apply to the next turn.",
    failedToSaveNovelAgentSettings: "Failed to save novel agent settings.",
    failedToLoadAgentTeamSettings: "Failed to load agent team settings.",
    agentTeamCreated: "Agent team created.",
    failedToCreateAgentTeam: "Failed to create agent team.",
    agentTeamRenamed: "Agent team renamed.",
    failedToRenameAgentTeam: "Failed to rename agent team.",
    agentTeamDeleted: "Agent team deleted.",
    failedToDeleteAgentTeam: "Failed to delete agent team.",
    teamEnabledItWillBeUsedForTheNext:
      "Team enabled. It will be used for the next conversation of this type.",
    teamDisabledItWillNoLongerBeUsedFor:
      "Team disabled. It will no longer be used for the next conversation of this type.",
    failedToUpdateTeamStatus: "Failed to update team status.",
    agentTeamSaved: "Agent team saved.",
    failedToSaveAgentTeamSettings: "Failed to save agent team settings.",
    agentTeamArchiveDownloaded: "Agent team file downloaded.",
    failedToDownloadAgentTeam: "Failed to download agent team.",
    agentTeamInstalled: "Agent team “{teamName}” imported.",
    failedToInstallAgentTeam: "Failed to import agent team.",
    failedToLoadLibraryAgentSettings: "Failed to load library agent settings.",
    libraryAgentSettingsSavedChangesApplyToTheNext:
      "Library agent settings saved. Changes apply to the next conversation turn.",
    failedToSaveLibraryAgentSettings: "Failed to save library agent settings.",
    agentSettingsRestoredToDefaults:
      "{value} agent settings restored to defaults.",
    failedToRestoreLibraryAgentDefaults:
      "Failed to restore library agent defaults."
  },
  modelApiTestFixture: {
    connectionSuccessful: "Connection successful"
  },
  workspaceDirectorySettings: {
    failedToLoadTheWorkingDirectory: "Failed to load the working directory.",
    failedToChangeTheWorkingDirectory:
      "Failed to change the working directory.",
    workingDirectoryChangedExistingProjectsRemainInTheirOriginal:
      "Working directory changed. Existing projects remain in their original locations.",
    workingDirectoryRestoredToItsDefaultLocationExistingProjects:
      "Working directory restored to its default location. Existing projects remain in their original locations."
  },
  modelProviderGroups: {
    deepwriteFreeModels: "DeepWrite free models"
  },
  modelSettingsCoordinator: {
    failedToLoadModelUsage: "Failed to load model usage.",
    failedToUpdateModelStatus: "Failed to update model status.",
    modelSettingsSavedAndAppliedToSubsequentConversations:
      "Model settings saved and applied to subsequent conversations.",
    failedToSaveModelSettings: "Failed to save model settings.",
    freeModelListRefreshed: "Free model list refreshed.",
    failedToRefreshFreeModelSettings: "Failed to refresh free model settings.",
    freeModelEnabledAndAddedToModelSettings:
      "Free model enabled and added to model settings.",
    freeModelDisabledAndHiddenFromModelSettings:
      "Free model disabled and hidden from model settings.",
    failedToUpdateFreeModelStatus: "Failed to update free model status.",
    modelConnectionTestFailed: "Model connection test failed.",
    modelConnectionTestFailedWithReason:
      "Model connection test failed: {reason}"
  },
  appearanceThemeRuntime: {
    warmPaper: "Warm paper",
    seaMist: "Sea mist",
    eyeCare: "Eye care",
    invalidThemeFileFormat: "Invalid theme file format"
  },
  storageSettings: {
    failedToReadStorageSettingsPleaseTryAgain:
      "Failed to read storage settings. Please try again.",
    dataMigrationIsReadyTheAppWillRestart:
      "Data migration is ready. The app will restart.",
    failedToChangeTheUserDataDirectoryPleaseTry:
      "Failed to change the user data directory. Please try again.",
    failedToChangeTheUserDataDirectoryWithReason:
      "Failed to change the user data directory: {reason}",
    failedToOpenDirectoryPleaseTryAgain:
      "Failed to open directory. Please try again.",
    storageBusy:
      "A task or storage operation is still running. Wait for it to finish before changing storage locations.",
    invalidDirectory:
      "Choose a regular folder on this computer. Shortcuts, symbolic links and directory junctions are not supported.",
    unresolvablePath:
      "Could not resolve the real path of this folder. Virtual and cloud-mounted drives may not be supported; choose a regular folder on a local disk.",
    overlapsInstallation:
      "The user data folder cannot be inside the application installation folder or contain it. Choose another folder.",
    nestedLocation:
      "The new location cannot be inside the current user data folder or contain it. Choose a separate folder.",
    targetNotEmpty:
      "The DeepWriteData folder at the selected location already contains files. Choose another location so nothing is overwritten.",
    notWritable:
      "DeepWrite cannot write to the selected location. Choose another folder.",
    saveFailed:
      "Conversations have not finished saving, so the migration was canceled. Try again shortly.",
    openFailed:
      "Could not open the storage folder. Check that it exists and is accessible."
  },
  modelEditor: {
    automaticRecommended: "Automatic (recommended)",
    ollamaUsesCompatibilityModeOtherProvidersUseTheNative:
      "Ollama uses compatibility mode; other providers use the native Pi structure",
    piNative: "Pi native",
    keepAllParameterConstraintsForOfficialAndFullyCompatible:
      "Keep all parameter constraints for official and fully compatible providers",
    compatibilityMode: "Compatibility mode",
    simplifyParameterConstraintsThatMayCauseLocalModelGrammar:
      "Simplify parameter constraints that may cause local model grammar errors",
    thinkingMode: "Thinking mode",
    nonThinkingMode: "Non-thinking mode",
    thinkingModeRequiresAtLeastOneReasoningLevel:
      "Thinking mode requires at least one reasoning level.",
    enterTheProviderAndModelId: "Enter the provider and model ID.",
    customReasoningLevelsMustDifferFromBuiltInLevels:
      "Custom reasoning levels must differ from built-in levels and contain only letters, digits, periods, underscores, or hyphens.",
    enterDifferentTemperaturesBetweenAnd:
      "Enter 3 different temperatures between 0 and 2.",
    configureAtLeastOneReasoningLevelAndChooseA:
      "Configure at least one reasoning level and choose a valid default.",
    enterTheProviderAndModelIdBeforeTestingThe:
      "Enter the provider and model ID before testing the connection."
  },
  appearanceFontRuntime: {
    deepwrite: "DeepWrite"
  },
  voiceSettings: {
    systemDefaultMicrophone: "System default microphone",
    failedToReadVoiceSettingsPleaseTryAgain:
      "Failed to read voice model settings. Please try again.",
    failedToReadVoiceUsagePleaseTryAgain:
      "Failed to read voice usage. Please try again.",
    microphone: "Microphone {value}",
    selectedMicrophoneNotCurrentlyDetected:
      "Selected microphone (not currently detected)",
    cannotReadMicrophoneDevices: "Cannot read microphone devices.",
    enterAnHttpsEndpointWithoutCredentialsQueryParametersOr:
      "Enter an HTTPS endpoint without credentials, query parameters, or fragments.",
    enterTheSpeechRecognitionModel: "Enter the speech recognition model.",
    voiceSettingsSaved: "Voice model settings saved.",
    failedToSaveVoiceSettingsPleaseTryAgain:
      "Failed to save voice model settings. Please try again."
  },
  voiceUsageSummary: {
    today: "Today",
    thisMonth: "This month",
    allTime: "All time",
    s: "{seconds}s",
    mS: "{minutes}m {value}s",
    hM: "{floor}h {value}m",
    notReported: "Not reported"
  },
  voiceSettingsOptions: {
    xiaomiMimo: "Xiaomi MiMo",
    alibabaQwen: "Alibaba Qwen",
    openPlatformPayAsYouGo: "Open platform · Pay as you go",
    autoDetect: "Auto-detect",
    chinese: "Chinese",
    english: "English",
    mimoOpenPlatform: "MiMo · Open platform",
    alibabaQwenTokenPlan: "Alibaba Qwen · Token Plan",
    alibabaQwenOpenPlatform: "Alibaba Qwen · Open platform"
  },
  builtinSubagentSettings: {
    enterACallingDescriptionOfUpToCharacters:
      "Enter a calling description of up to 1,000 characters.",
    builtInManagementSubagentSettingsSaved:
      "Built-in management tool settings saved",
    failedToSavePleaseTryAgain: "Failed to save. Please try again."
  },
  remoteModelListing: {
    enterTheApiUrlAndApiKeyBeforeFetching:
      "Enter the API URL and API key before fetching available models.",
    enterTheApiUrlBeforeFetchingAvailableModels:
      "Enter the API URL before fetching available models.",
    enterTheApiKeyBeforeFetchingAvailableModels:
      "Enter the API key before fetching available models.",
    modelListingIsNotAvailableInThisEnvironment:
      "Model listing is not available in this environment.",
    thisEndpointReturnedNoAvailableModels:
      "This endpoint returned no available models.",
    foundAvailableModelsSelectTheModelsToSave:
      "Found {length} available models. Select the models to save.",
    failedToFetchModelList: "Failed to fetch model list."
  },
  modelSettingsDraft: {
    invalidModelConfiguration: "Invalid model configuration."
  },
  voiceInput: {
    microphoneAccessIsDisabledAllowDeepwriteToUseThe:
      "Microphone access is disabled. Allow DeepWrite to use the microphone in system settings.",
    theSelectedMicrophoneWasNotFoundSelectAnotherIn:
      "The selected microphone was not found. Select another in voice model settings.",
    theMicrophoneIsUnavailableCheckWhetherItIsDisconnected:
      "The microphone is unavailable. Check whether it is disconnected or in use by another app.",
    speechRecognitionFailedPleaseTryAgain:
      "Speech recognition failed. Please try again.",
    voiceInputIsOnlyAvailableInTheDesktopApp:
      "Voice input is only available in the desktop app.",
    saveTheSelectedProviderSApiKeyInSettings:
      "Save the selected provider’s API key in Settings → Voice model settings first.",
    theMicrophoneDisconnectedThisRecordingWasCanceled:
      "The microphone disconnected. This recording was canceled.",
    theSpeechRecognitionResponseDoesNotMatchPleaseTry:
      "The speech recognition response does not match. Please try again.",
    noSpeechWasRecognizedTryAgainOrRecordA:
      "No speech was recognized. Try again or record a new clip."
  },
  modelUsagePanel: {
    lastHours: "Last 24 hours",
    lastDays: "Last 7 days",
    lastDays2: "Last 30 days",
    allTime: "All time",
    noTrendDataYet: "{value}: no trend data yet",
    totalModelTokenTrendInTotal:
      "{value}: total model token trend, {value2} in total",
    unused: "Unused",
    currentConfiguration: "Current configuration",
    historicalModel: "Historical model",
    localSimulation: "Local simulation",
    newOfficialSite: "New official site",
    deepwriteFree: "DeepWrite Free",
    subagent: "Subagent",
    connectionTest: "Connection test",
    mainAgent: "Main agent",
    error: "Error",
    aborted: "Aborted",
    completed: "Completed"
  },
  siteOfficialModelSettings: {
    couldNotRetrieveTheNewOfficialSiteSBalance:
      "Could not retrieve the new official site's balance.",
    theNewOfficialSiteSModelKeyHasBeen:
      "The new official site's model key has been saved securely. Its models are ready to use.",
    couldNotSaveTheNewOfficialSiteSModel:
      "Could not save the new official site's model key.",
    theNewOfficialSiteSModelKeyWasRemoved:
      "The new official site's model key was removed. Historical usage remains in the local ledger.",
    couldNotRemoveTheNewOfficialSiteSModel:
      "Could not remove the new official site's model key.",
    couldNotRefreshTheNewOfficialSiteSModels:
      "Could not refresh the new official site's models.",
    theNewOfficialSiteSModelPageHasBeen:
      "The new official site's model page has been refreshed.",
    modelEnabledAndAddedToTheModelSelector:
      "Model enabled and added to the model selector.",
    modelDisabledAndHiddenFromTheModelSelector:
      "Model disabled and hidden from the model selector."
  }
};
