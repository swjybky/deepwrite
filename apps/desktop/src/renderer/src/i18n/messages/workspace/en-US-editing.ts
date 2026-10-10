export default {
  docxDocumentText: {
    theWordDocumentZipDirectoryIsCorrupt:
      "The Word document ZIP directory is corrupt.",
    aZipFilenameInTheWordDocumentIsCorrupt:
      "A ZIP filename in the Word document is corrupt.",
    theWordDocumentXmlIsTooLargeToRead:
      "The Word document XML is too large to read safely.",
    passwordProtectedWordDocumentsAreNotSupported:
      "Password-protected Word documents are not supported.",
    theWordDocumentZipContentsAreCorrupt:
      "The Word document ZIP contents are corrupt.",
    theWordDocumentZipDataIsIncomplete:
      "The Word document ZIP data is incomplete.",
    zipCompressionMethodInThisWordDocumentIsNot:
      "ZIP compression method {compressionMethod} in this Word document is not supported.",
    theWordDocumentIsMissingWordDocumentXml:
      "The Word document is missing word/document.xml."
  },
  approvalNavigation: {
    overallStoryline: "Overall storyline",
    foreshadowingOverview: "Foreshadowing overview"
  },
  promptAttachments: {
    imageExceedsMbAndCannotBeSentToThe:
      "Image “{name}” exceeds 10 MB and cannot be sent to the model.",
    pdfHasNoExtractableTextRunOcrOnScanned:
      "PDF “{name}” has no extractable text. Run OCR on scanned PDFs first.",
    fileContainsNoReadableText: "File “{name}” contains no readable text.",
    isTooLongOnlyTheFirstCharactersAreAttached:
      "“{name}” is too long. Only the first {toLocaleString} characters are attached.",
    textFileExceedsMbReduceItsSizeBeforeUploading:
      "Text file “{name}” exceeds 5 MB. Reduce its size before uploading.",
    pdfExceedsMbSplitOrCompressItBeforeUploading:
      "PDF “{name}” exceeds 20 MB. Split or compress it before uploading.",
    unknownPdfParsingError: "Unknown PDF parsing error",
    pdfIsPasswordProtectedAndCannotBeRead:
      "PDF “{name}” is password protected and cannot be read.",
    failedToReadPdf: "Failed to read PDF “{name}”: {message}",
    wordDocumentExceedsMbSplitOrCompressItBefore:
      "Word document “{name}” exceeds 25 MB. Split or compress it before uploading.",
    unknownWordParsingError: "Unknown Word parsing error",
    failedToReadWordDocument:
      "Failed to read Word document “{name}”: {message}",
    theFileTypeOfIsNotSupportedChooseTxt:
      "The file type of “{name}” is not supported. Choose TXT, MD, PDF, Word (.docx), or a common image format."
  },
  editorEntrySearch: {
    manuscript: "{title} · Manuscript",
    characterState: "{title} · Character state",
    characterOverview: "Character overview",
    searching: "Searching…",
    failedToSearchAllEntries: "Failed to search all entries.",
    noMatchingEntriesFound: "No matching entries found",
    enterASearchTerm: "Enter a search term"
  },
  editorFindReplace: {
    noResults: "No results",
    enterTextToFind: "Enter text to find",
    noMatchingTextFound: "No matching text found",
    noTextToReplace: "No text to replace",
    enterTextToReplace: "Enter text to replace",
    findAndReplacementTextAreTheSame: "Find and replacement text are the same",
    replacedMatches: "Replaced {length} matches"
  },
  markdownOutline: {
    untitledHeading: "Untitled heading"
  },
  acceptedEditDiscardPersistence: {
    thePreviousDiscardWasNotConfirmedTheCurrentVersion:
      "The previous discard was not confirmed. The current version will be checked before retrying."
  },
  agentEditReview: {
    manuscriptFileEditsCanOnlyBeAppliedToThe:
      "Manuscript file edits can only be applied to the manuscript directory.",
    characterFileEditsCanOnlyBeAppliedToThe:
      "Character file edits can only be applied to the character design stage."
  },
  agentTeamModeAvailability: {
    loadingAgentTeamConfiguration: "Loading agent team configuration…",
    failedToLoadAgentTeamsRetryFromTheAgent:
      "Failed to load agent teams. Retry from the Agent Teams page.",
    agentTeamConfigurationHasNotLoadedYet:
      "Agent team configuration has not loaded yet.",
    thisAgentHasNoEnabledTeamWithAvailableMembers:
      "This agent has no enabled team with available members. Configure one in Agent Teams first.",
    allowThisMainAgentToCallSubagentsInEnabled:
      "Allow this main agent to call subagents in enabled teams."
  },
  marketplacePublishContent: {
    theSkillHasNoContentAndCannotBePublished:
      "The skill has no content and cannot be published. Add content to the local skill before submitting.",
    skillHasNoContentAndCannotBePublished:
      "Skill “{value}” has no content and cannot be published.",
    andOthersInTotal: " and others ({length} in total)",
    skillsHaveNoContentAndCannotBePublished:
      "Skills “{preview}”{suffix} have no content and cannot be published.",
    validationFailedCheckTheTitleAndSkillContent:
      "Validation failed. Check the title and skill content."
  },
  buildWindowFrameMenus: {
    file: "File",
    newProject: "New project",
    openProject: "Open project…",
    settings: "Settings…",
    view: "View",
    showDirectorySidebar: "Show directory sidebar",
    hideDirectorySidebar: "Hide directory sidebar",
    showManuscriptPanel: "Show manuscript panel",
    hideManuscriptPanel: "Hide manuscript panel",
    appearanceAndTheme: "Appearance and theme…"
  },
  shortManuscriptCharacterCount: {
    failedToReadTheFullCharacterCountReopenThe:
      "Failed to read the full character count. Reopen the export dialog."
  },
  lazyRevisionAnalysis: {
    revisionAnalysis: "Revision analysis"
  },
  subagentAuthoring: {
    agentsAreNotAvailableInThisEnvironment:
      "Agents are not available in this environment.",
    generationIsInProgressStopItOrWaitFor:
      "Generation is in progress. Stop it or wait for completion.",
    addAnAvailableModelInModelSettingsFirst:
      "Add an available model in model settings first.",
    readingSelectedSkillContent: "Reading selected skill content…",
    generatingASubagentDraftFromTheSelectedSkills:
      "Generating a subagent draft from the selected skills…",
    writeDirectlyToDocuments: "Write directly to documents",
    returnFindingsOnly: "Return findings only",
    generateASubagentDraftForUsingTheSelectedSkills:
      "Generate a subagent draft for “{parentAgentLabel}” using the selected skills.",
    outputModeConfirmedByTheUser:
      "Output mode (confirmed by the user): {modeLabel}.",
    selectedSkills: "Selected skills: {skillTitles}.",
    readTheSkillContentFirstThenCallWriteSubagent:
      "Read the skill content first, then call write_subagent_draft to submit a name, capability description, and system prompt.",
    failedToGenerateTheSubagentDraft: "Failed to generate the subagent draft.",
    stopping: "Stopping…",
    failedToStopGeneration: "Failed to stop generation.",
    networkInterruptionRetryingInS:
      "Network interruption. Retrying in {ceil}s ({retryNumber}/{maxRetries})",
    retrying: "Retrying ({retryNumber}/{maxRetries})",
    draftUpdatedConfirmToAddItToTheTeam:
      "Draft updated. Confirm to add it to the team, or wait for generation to finish.",
    calling: "Calling {toolName}…",
    generationFinishedWithoutASubagentDraftPleaseTryAgain:
      "Generation finished without a subagent draft. Please try again.",
    draftReadyConfirmToAddItToTheCurrent:
      "Draft ready. Confirm to add it to the current main agent’s team."
  },
  pendingEditorReferences: {
    thisPassageIsAlreadyInTheInput: "This passage is already in the input",
    eachMessageCanIncludeUpToManuscriptReferences:
      "Each message can include up to {PROMPT_ATTACHMENT_MAX_ITEMS} manuscript references"
  },
  workspaceResourceCoordinator: {
    failedToReadTheManuscriptSelectItAgainAnd:
      "Failed to read the manuscript. Select it again and retry.",
    episode: "Episode",
    section: "Section",
    manuscript: "{workspaceLabel} · Manuscript",
    writing: "{workspaceLabel} · {unitLabel} writing",
    characterEntry: "Character entry",
    newCharacterEntry: "New character entry",
    deleteCurrentCharacterEntry: "Delete current character entry",
    deleteCurrentSection: "Delete current section",
    thisNoLongerExistsTheListHasBeenRefreshed:
      "This {value} no longer exists. The list has been refreshed.",
    theReferencedManuscriptFileNoLongerExistsTheReference:
      "The referenced manuscript file no longer exists. The reference has been removed."
  },
  writingContextCoordinator: {
    failedToReadProjectContext: "Failed to read project context.",
    projectContextSaved: "Project context saved.",
    failedToSaveProjectContext: "Failed to save project context."
  },
  creationResourceOrder: {
    theProjectOrderCouldNotBeSavedButIt:
      "The project order could not be saved, but it is applied for this session"
  },
  foreshadowingFilters: {
    withinAPlotPoint: "Within a plot point",
    withinAVolume: "Within a volume",
    acrossVolumes: "Across volumes",
    planned: "Planned",
    planted: "Planted",
    developing: "Developing",
    resolved: "Resolved",
    abandoned: "Abandoned",
    truthSource: "Truth source",
    plant: "Plant",
    reinforce: "Reinforce",
    misdirect: "Misdirect",
    partialReveal: "Partial reveal",
    reveal: "Reveal",
    resolve: "Resolve",
    aftermath: "Aftermath",
    allScopes: "All scopes",
    allLifecycleStates: "All lifecycle states",
    noActualBeatsHaveBeenRecordedByManuscriptCommits:
      "No actual beats have been recorded by manuscript commits yet",
    keepTheRecordWithoutDevelopingItFurther:
      "Keep the record without developing it further",
    noVolumeSelected: "No volume selected",
    noPlotPointSelected: "No plot point selected",
    missingVolume: "Missing volume ({volumeId})",
    missingPlotPoint: "Missing plot point ({arcId})"
  },
  composerContextNavigation: {
    couldNotSwitchPleaseTryAgain: "Could not switch. Please try again."
  },
  shortManuscriptExportTransaction: {
    manuscriptExportIsUnavailable: "Manuscript export is unavailable."
  },
  siteOfficialQuotaMerge: {
    waitForTheCurrentOperationToFinish:
      "Wait for the current operation to finish.",
    addTheCurrentKeyFirst: "Add the current key first.",
    unlimitedKeysDoNotNeedAdditionalQuota:
      "Unlimited keys do not need additional quota.",
    refreshTheCurrentKeySQuotaFirst: "Refresh the current key’s quota first.",
    enterAValidSourceKey: "Enter a valid source key.",
    theCurrentKeyConfigurationChangedRefreshTheQuotaAnd:
      "The current key configuration changed. Refresh the quota and confirm again.",
    theDesktopServiceIsTemporarilyUnavailablePleaseTryAgain:
      "The desktop service is temporarily unavailable. Please try again shortly.",
    transferredTheSourceKeyHasBeenPermanentlyDeactivated:
      "Transferred ¥{transferred}. The source key has been permanently deactivated.",
    quotaTransferredUsageHasNotRefreshedYetRefreshThe:
      "Quota transferred. Usage has not refreshed yet. Refresh the page shortly.",
    quotaTransferFailedRefreshTheQuotaToCheckThe:
      "Quota transfer failed. Refresh the quota to check the result before trying again."
  },
  popupSelect: {
    modelsSelected: "{length} models selected"
  },
  workspaceResourceTreeCoordinator: {
    unavailableNovel: "Unavailable novel · {bookId}",
    novelFailedToReadProject: "Novel · Failed to read project",
    novelTemporarilyUnavailable: "Novel · Temporarily unavailable",
    bookSettingsCouldNotBeSavedButChangesAre:
      "Book settings could not be saved, but changes are applied for this session"
  },
  applyBodyTextFormatting: {
    theManuscriptAlreadyMatchesTheFormattingRules:
      "The manuscript already matches the formatting rules",
    manuscriptFormattingApplied: "Manuscript formatting applied"
  },
  draftRecoveryPersistence: {
    failedToReadDraftRecoveryFile:
      "Failed to read draft recovery file: {message}",
    theDraftRecoveryFileIsTemporarilyUnreadable:
      "The draft recovery file is temporarily unreadable",
    unsavedDraftsCouldNotBeWrittenToTheRecovery:
      "Unsaved drafts could not be written to the recovery file. Save your manuscript before closing the app."
  },
  approvalNavigationCoordinator: {
    openedTheParentEntryTheTargetFileIsNot:
      "Opened the parent entry. The target file is not ready yet."
  },
  shortWorkspaceStructureCoordinator: {
    waitForTheCurrentAgentToFinishThenAccept:
      "Wait for the current agent to finish, then accept or reject the pending changes.",
    resolveThisProjectSOutstandingSaveConflictsFirst:
      "Resolve this project's outstanding save conflicts first.",
    someDraftsCouldNotBeSavedSafelyTheStructure:
      "Some drafts could not be saved safely. The structure was not changed.",
    couldNotDuplicateTheWritingWorkspace:
      "Could not duplicate the writing workspace.",
    theCurrentProjectIsBeingUpdatedPleaseWait:
      "The current project is being updated. Please wait.",
    theCurrentProjectHasNoVersionIdentifierItsStructure:
      "The current project has no version identifier. Its structure cannot be managed safely.",
    theCurrentProjectHasNoVersionIdentifierItsCharacter:
      "The current project has no version identifier. Its character structure cannot be changed safely.",
    characterStructureConvertedToEntries:
      "Character structure converted to entries.",
    characterStructureConvertedToText: "Character structure converted to text.",
    characterEntryCreated: "Character entry created.",
    characterEntryNameUpdated: "Character entry name updated.",
    characterEntriesReordered: "Character entries reordered.",
    characterEntryDeleted: "Character entry deleted.",
    theProjectWasUpdatedElsewhereAndHasBeenReloaded:
      "The project was updated elsewhere and has been reloaded. Review it and try again.",
    couldNotChangeTheCharacterStructure:
      "Could not change the character structure.",
    couldNotIdentifyTheProjectContainingThisCharacterEntry:
      "Could not identify the project containing this character entry.",
    thisCharacterEntryNoLongerExistsTheListHas:
      "This character entry no longer exists. The list has been refreshed.",
    theCharacterDirectoryCouldNotBeIdentifiedACharacter:
      "The character directory could not be identified. A character entry cannot be created yet.",
    selectACharacterEntryFirst: "Select a character entry first.",
    couldNotIdentifyTheCharacterEntry:
      "Could not identify the character entry.",
    theCurrentProjectHasNoVersionIdentifierItsPlot:
      "The current project has no version identifier. Its plot structure cannot be changed safely.",
    plotStructureCreatedAndSyncedToAllShortStories:
      "Plot structure created and synced to all short stories and scripts.",
    plotStructureUpdatedAcrossAllProjects:
      "Plot structure updated across all projects.",
    plotStructuresReordered: "Plot structures reordered.",
    plotStructureEnabled: "Plot structure enabled.",
    plotStructureDisabled: "Plot structure disabled.",
    plotStructureDeletedFromAllProjects:
      "Plot structure deleted from all projects.",
    couldNotChangeThePlotStructure: "Could not change the plot structure.",
    aNewCannotBeAddedToTheManuscriptYet:
      "A new {unitLabel} cannot be added to the manuscript yet. Please wait.",
    aManuscriptSupportsUpToItemsOfType:
      "A manuscript supports up to 100 items of type {unitLabel}.",
    thisManuscriptNoLongerExists: "This manuscript no longer exists.",
    theCurrentProjectHasNoVersionIdentifierManuscriptStructure:
      "The current project has no version identifier. Manuscript structure cannot be created safely.",
    createdAndSavedItInTheManuscriptFolder:
      "Created “{title}” and saved it in the manuscript folder.",
    couldNotCreateTheManuscript: "Could not create the manuscript {unitLabel}.",
    aNewSectionCannotBeAddedToTheManuscript:
      "A new section cannot be added to the manuscript yet. Please wait.",
    thisManuscriptSectionNoLongerExistsTheListHas:
      "This manuscript section no longer exists. The list has been refreshed.",
    theCurrentIsBeingProcessedOrSavedWaitBefore:
      "The current {unitLabel} is being processed or saved. Wait before reordering it.",
    theCurrentProjectHasNoVersionIdentifierItsManuscript:
      "The current project has no version identifier. Its manuscript structure cannot be reordered safely.",
    message: "{value} “{title}”.",
    couldNotReorderThe: "Could not reorder the {unitLabel}.",
    selectASectionFirst: "Select a section first.",
    thisSectionNoLongerExistsTheListHasBeen:
      "This section no longer exists. The list has been refreshed.",
    thisNoLongerExists: "This {value} no longer exists.",
    theManuscriptMustRetainAtLeastOne:
      "The manuscript must retain at least one {value}.",
    theCurrentIsBeingProcessedOrSavedWaitBefore2:
      "The current {value} is being processed or saved. Wait before deleting it.",
    theCurrentProjectHasNoVersionIdentifierItsManuscript2:
      "The current project has no version identifier. Its manuscript structure cannot be deleted safely.",
    thisNoLongerExists2: "This {value} no longer exists.",
    manuscriptSection: "manuscript section",
    deletedAndItsCharacterStateFiles:
      "Deleted “{sectionTitle}” and its character state files.",
    couldNotDeleteThe: "Could not delete the {value}."
  },
  lazyApprovalNavigationCoordinator: {
    couldNotLoadApprovalNavigation:
      "Could not load approval navigation: {message}",
    couldNotLoadApprovalNavigationTryAgain:
      "Could not load approval navigation. Try again."
  },
  bodyTextFormatting: {
    couldNotFormatTheManuscriptTryAgain:
      "Could not format the manuscript. Try again.",
    finishOtherEditsBeforeFormattingAllBodies:
      "Wait for the current save or edit to finish, then try again.",
    couldNotReadEveryBodyNoChangesWereMade:
      "Could not read every manuscript section. No formatting was changed. Try again.",
    allBodiesAlreadyMatchTheFormattingRules:
      "Every manuscript section already matches the formatting rules.",
    formattedBodies: "Formatted {count} manuscript sections.",
    couldNotFormatAllBodiesTryAgain:
      "Could not format every manuscript section. Try again."
  },
  workspaceFeatureHostCoordinator: {
    couldNotLoadTheRevisionAnalysisModule:
      "Could not load the revision analysis module.",
    couldNotLoadTheShortStoryAnalysisModule:
      "Could not load the short-story analysis module.",
    couldNotLoadTheLongFormAnalysisModule:
      "Could not load the long-form analysis module.",
    couldNotLoadSettingsTryAgainShortlyOrRestart:
      "Could not load settings. Try again shortly or restart the app.",
    couldNotLoadTheAgentTeamsModule: "Could not load the agent teams module."
  },
  workspaceResourceNavigation: {
    couldNotLoadTheSelectionListTryAgain:
      "Could not load the selection list. Try again."
  },
  lazyLongStructureTransactionsCoordinator: {
    theLongFormStructureOperationWasCanceled:
      "The long-form structure operation was canceled.",
    couldNotLoadTheLongFormStructureCoordinator:
      "Could not load the long-form structure coordinator.",
    theLongFormStructureOperationFailed:
      "The long-form structure operation failed."
  }
};
