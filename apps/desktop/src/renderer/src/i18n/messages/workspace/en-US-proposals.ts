export default {
  longProposalRuntimeCoordinator: {
    currentNovelEditsAreUnsavedTheAgentProposalWas:
      "Current novel edits are unsaved. The agent proposal was not applied automatically. Resolve the editor save state and retry.",
    theNovelAgentIsStartingTheProjectCannotBe:
      "The novel agent is starting. The project cannot be safely removed yet. Please try again shortly.",
    novelGenerationStopped: "Novel generation stopped.",
    failedToStopNovelGenerationPleaseTryAgainShortly:
      "Failed to stop novel generation. Please try again shortly.",
    theActiveNovelChangedApprovalWasCanceled:
      "The active novel changed. Approval was canceled.",
    novelProposalRejectedNoFilesWereWritten:
      "Novel proposal rejected. No files were written.",
    theTargetFileOrItemNoLongerExistsAnd:
      "The target file or item no longer exists and cannot be opened."
  },
  index: {
    thePreviousEditWasDiscardedRegenerateThisEditUsing:
      "The previous edit was undone. Regenerate this edit using the current file.",
    otherEditsToThisProjectAreBeingSavedWait:
      "Other edits to this project are being saved. Wait before undoing.",
    discardingThisEdit: "Undoing this edit…",
    editDiscardedThePreviousContentHasBeenRestored:
      "Edit undone. The previous content has been restored.",
    editDiscarded: "Edit undone",
    failedToDiscardThisEdit: "Failed to undo this edit."
  },
  short: {
    theFullPreviousContentIsMissingThisEditCannot:
      "The full previous content is missing. This edit cannot be safely discarded.",
    theTargetFileHasUnsavedEditsResolveTheCurrent:
      "The target file has unsaved edits. Resolve the current draft before discarding this edit.",
    theTargetFileHasNewerChangesTheyWerePreserved:
      "The target file has newer changes. They were preserved, and this edit was not discarded.",
    theDesktopFileServiceIsUnavailable:
      "The desktop file service is unavailable.",
    theTargetLibraryNoLongerExists: "The target library no longer exists.",
    theTargetProjectNoLongerExists: "The target project no longer exists.",
    theTargetChapterIsUnavailableThisRenameCannotBe:
      "The target chapter is unavailable. This rename cannot be discarded.",
    theChapterHasBeenRenamedAgainThisRenameWas:
      "The chapter has been renamed again. This rename was not discarded.",
    theCharacterStructureIsUnavailableThisEditCannotBe:
      "The character structure is unavailable. This edit cannot be discarded.",
    theCharacterHasBeenRenamedAgainThisEditWas:
      "The character has been renamed again. This edit was not discarded.",
    theCharacterOrderHasChangedAgainThisMoveWas:
      "The character order has changed again. This move was not discarded.",
    thisProposalCannotBeDiscarded: "This proposal cannot be discarded.",
    thePlotStructureIsUnavailableThisEditCannotBe:
      "The plot structure is unavailable. This edit cannot be discarded.",
    thePlotStructureHasNewerChangesThisEditWas:
      "The plot structure has newer changes. This edit was not discarded."
  },
  lazyProposalCoordinator: {
    failedToLoadTheAgentEditCoordinator:
      "Failed to load the agent edit coordinator."
  },
  longWorkspaceProposals: {
    foreshadowingChanges: "Foreshadowing changes",
    currentCharacterState: "Current character state",
    characterHistory: "Character history",
    chapterEndingState: "Chapter ending state",
    continuationPack: "Continuation pack",
    theContinuityProposalRefersToAChapterCardThat:
      "The continuity proposal refers to a chapter card that does not exist.",
    theContinuityProposalHasAnIncompleteCharacterFileIdentity:
      "The continuity proposal has an incomplete character file identity.",
    theContinuityProposalRefersToACharacterThatDoes:
      "The continuity proposal refers to a character that does not exist.",
    theNovelWorkspaceContainsDuplicateContinuityFileIdentifiers:
      "The novel workspace contains duplicate continuity file identifiers.",
    theContinuityProposalSFilePathChapterRoleOr:
      "The continuity proposal’s file path, chapter, role, or character does not match the current workspace.",
    theNovelWorkspaceIndexReturnedTheWrongProject:
      "The novel workspace index returned the wrong project.",
    theContinuityFileAlreadyExistsAndCannotBeCreated:
      "The continuity file already exists and cannot be created again: {fileId}",
    theContinuityCreationProposalHasAnInconsistentIdentityOr:
      "The continuity creation proposal has an inconsistent identity or initial content.",
    theContinuityFileNoLongerExists:
      "The continuity file no longer exists: {fileId}",
    theTargetFileAlreadyExistsAndCannotBeCreated:
      "The target file already exists and cannot be created again: {filePath}",
    theTargetFileNoLongerExists: "The target file no longer exists: {filePath}",
    theTargetWorldbuildingCategoryNoLongerExistsOrIs:
      "The target worldbuilding category no longer exists or is no longer list-based.",
    theStructuralImpactPreviewReturnedTheWrongNovelProject:
      "The structural impact preview returned the wrong novel project.",
    failedToPreviewNovelStructuralImpact:
      "Failed to preview novel structural impact.",
    failedToArchiveContinuityFiles: "Failed to archive continuity files.",
    continuityFilesForThisChapterHaveBeenArchived:
      "Continuity files for this chapter have been archived.",
    continuityFilesWereArchivedButTheSubsequentRefreshFailed:
      "Continuity files were archived, but the subsequent refresh failed: {value}",
    refreshTheNovelWorkspaceManually: "Refresh the novel workspace manually.",
    thePreSaveCheckForAutomaticNovelFileSaving:
      "The pre-save check for automatic novel file saving failed.",
    thisProposalDeletesItemsOrUnlinksRelatedRecordsReview:
      "This proposal deletes items or unlinks related records. Review it and confirm manually.",
    thePreSaveCheckForAutomaticNovelProposalSaving:
      "The pre-save check for automatic novel proposal saving failed.",
    cannotGenerateAUniqueEventIdForTheManual:
      "Cannot generate a unique event ID for the manual novel structure proposal.",
    theManualNovelStructureProposalEventIdConflictsPlease:
      "The manual novel structure proposal event ID conflicts. Please try again.",
    relatedImpactsHaveBeenCheckedReviewTheLatestImpacts:
      "Related impacts have been checked. Review the latest impacts and confirm again.",
    chapterProseMustBeSavedThroughAConversationDiff:
      "Chapter prose must be saved through a conversation diff approval card, not the legacy novel proposal queue.",
    relationshipsOrDeletionImpactsChangedReviewTheLatestImpacts:
      "Relationships or deletion impacts changed. Review the latest impacts and confirm again.",
    failedToProcessNovelProposal: "Failed to process novel proposal.",
    novelStructureProposalApplied: "Novel structure proposal applied.",
    worldbuildingFileChangesSavedToLocalMarkdown:
      "Worldbuilding file changes saved to local Markdown.",
    characterFileChangesSavedToLocalMarkdown:
      "Character file changes saved to local Markdown.",
    chapterContinuityRecordsSavedToLocalMarkdown:
      "Chapter continuity records saved to local Markdown.",
    novelProposalSavedButTheSubsequentRefreshFailed:
      "Novel proposal saved, but the subsequent refresh failed: {value}",
    anEarlierContinuityFileProposalWasRejectedThisChapter:
      "An earlier continuity file proposal was rejected. This chapter’s ledger was not archived."
  },
  proposalCoordinator: {
    failedToApproveAgentEdits: "Failed to approve agent edits.",
    thePendingNewEntryIsMissingCompleteContentGenerate:
      "The pending new entry is missing complete content. Generate it again.",
    theDestinationLibraryIsUnavailableOrReadOnlyThe:
      "The destination library is unavailable or read-only. The entry cannot be created.",
    theLibraryDirectoryChangedNoEntryWasCreatedGenerate:
      "The library directory changed. No entry was created. Generate it again.",
    otherEditsToThisLibraryAreBeingSavedWait:
      "Other edits to this library are being saved. Wait before accepting.",
    automaticallyApprovingAndCreatingTheLibraryEntry:
      "Automatically approving and creating the library entry…",
    checkingTheLibraryVersionAndCreatingTheEntry:
      "Checking the library version and creating the entry…",
    libraryEntryAutomaticallyApprovedAndCreated:
      "Library entry automatically approved and created.",
    createdAndSavedToLocalMarkdown: "Created and saved to local Markdown.",
    libraryEntryAutomaticallyApprovedAndCreated2:
      "Library entry automatically approved and created",
    libraryEntryCreated: "Library entry created",
    theLibraryWasUpdatedExternallyNoEntryWasCreated:
      "The library was updated externally. No entry was created. Generate it again.",
    linkedToTheNewlyCreatedChapterFileContentWill:
      "Linked to the newly created chapter file. Content will be saved after acceptance.",
    anEarlierEditWasRejectedThisChangeIsBlocked:
      "An earlier edit was rejected. This change is blocked to prevent rejected content from being restored by a later full-document update.",
    anEarlierEditHasConflictsThisSubsequentChangeIs:
      "An earlier edit has conflicts. This subsequent change is blocked, and the current manuscript was preserved.",
    anEarlierManuscriptEditWasRejectedThisSubsequentEdit:
      "An earlier manuscript edit was rejected. This subsequent edit contains rejected content and was not written to local files.",
    theTargetCharacterStructureIsUnavailableThisChangeCannot:
      "The target character structure is unavailable. This change cannot be applied.",
    characterCreationIsMissingAStableEntryIdOrdered:
      "Character creation is missing a stable entry ID. Ordered writes cannot be completed.",
    automaticallySavingCharacterStructure:
      "Automatically saving character structure…",
    savingCharacterStructure: "Saving character structure…",
    characterEntryCreatedButItsFileCouldNotBe:
      "Character entry created, but its file could not be located after refreshing. Retry to finish mapping the content.",
    characterStructureChangesAutomaticallyApprovedAndSaved:
      "Character structure changes automatically approved and saved.",
    characterStructureChangesSavedLocally:
      "Character structure changes saved locally.",
    characterStructureChangesSaved: "Character structure changes saved",
    failedToSaveCharacterStructureChanges:
      "Failed to save character structure changes.",
    theCurrentCharacterStructureIsNotListBasedThis:
      "The current character structure is not list-based. This entry operation was not submitted for review.",
    createCharacterEntry: "Create character entry: {title}",
    renameCharacter: "Rename character: {previousItemTitle} → {title}",
    characterEntry: "{value} character entry: {title}",
    moveUp: "Move up",
    moveDown: "Move down",
    deleteCharacterEntry: "Delete character entry: {title}",
    theManuscriptDirectoryIsUnavailableChapterCreationWasNot:
      "The manuscript directory is unavailable. Chapter creation was not submitted for review.",
    createBlankChapters: "Create {length} blank chapters",
    theTargetChapterIsUnavailableRenamingWasNotSubmitted:
      "The target chapter is unavailable. Renaming was not submitted for review.",
    renameChapter: "Rename chapter: {previousTitle} → {title}",
    chapter: "Chapter",
    theTargetIsUnavailableDeletingTheWasNotSubmitted:
      "The target {draftUnit} is unavailable. Deleting the {draftUnit2} was not submitted for review.",
    delete: "Delete {draftUnit}: {title}",
    theTargetChapterHasNotBeenCreatedOrIs:
      "The target chapter has not been created or is unavailable. This agent change was not submitted for review.",
    theTextHasNotChangedNoSaveIsNeeded:
      "The text has not changed. No save is needed.",
    newChapter: "New chapter",
    characterState: "{sectionTitle} · Character state",
    theTargetCharacterEntryHasNotBeenCreatedOr:
      "The target character entry has not been created or is unavailable. This agent change was not submitted for review.",
    theTargetManuscriptIsNotWritableThisAgentChange:
      "The target manuscript is not writable. This agent change was not submitted for review.",
    plotDesignChanges: "Plot design changes",
    worldbuildingFileToolsMustProduceOneIndependentFileChange:
      "Worldbuilding file tools must produce one independent file change at a time. This result was not submitted for approval.",
    characterFileToolsMustCreateOneCompleteCharacterOr:
      "Character file tools must create one complete character or edit one profile at a time. This result was not submitted for approval.",
    newCharacter: "{characterName} / New character",
    manuscript: "{chapterTitle} / Manuscript",
    theManuscriptHasNotChangedNoSaveIsNeeded:
      "The manuscript has not changed. No save is needed.",
    thePendingChapterCreationIsMissingRequiredParametersGenerate:
      "The pending chapter creation is missing required parameters. Generate it again.",
    theManuscriptDirectoryIsUnavailableChaptersCannotBeCreated:
      "The manuscript directory is unavailable. Chapters cannot be created.",
    otherContentInThisProjectIsBeingSavedAutomatic:
      "Other content in this project is being saved. Automatic chapter creation is paused. Retry manually shortly.",
    otherEditsToThisProjectAreBeingSavedWait:
      "Other edits to this project are being saved. Wait before accepting.",
    automaticallyApprovingAndCreatingBlankChapterFiles:
      "Automatically approving and creating blank chapter files…",
    creatingChapterFiles: "Creating chapter files…",
    chaptersCreatedButTheNewChaptersCouldNotBe:
      "Chapters created, but the new chapters could not be located after refreshing. Retry to finish mapping the content.",
    automaticallyApprovedAndCreatedChaptersIncludingTheirSubmittedProse:
      "Automatically approved and created {createdCount} chapters, including their submitted prose and character states.",
    createdChaptersAndSavedTheirSubmittedProseAndCharacter:
      "Created {createdCount} chapters and saved their submitted prose and character states.",
    createdBlankChapterFiles: "Created {createdCount} blank chapter files",
    failedToCreateBlankChapters: "Failed to create blank chapters.",
    theAssociatedBlankChapterCouldNotBeCreatedRelated:
      "The associated blank chapter could not be created. Related prose writes were canceled.",
    chapterCreationHasNotBeenConfirmedTheProseIs:
      "Chapter creation has not been confirmed. The prose is preserved. Retry chapter creation first.",
    thePendingChapterRenameIsMissingRequiredParametersGenerate:
      "The pending chapter rename is missing required parameters. Generate it again.",
    theTargetChapterIsUnavailableAndCannotBeRenamed:
      "The target chapter is unavailable and cannot be renamed.",
    theTargetChapterNoLongerExistsAndCannotBe:
      "The target chapter no longer exists and cannot be renamed.",
    otherContentInThisProjectIsBeingSavedAutomatic2:
      "Other content in this project is being saved. Automatic renaming is paused. Retry manually shortly.",
    automaticallyApprovingAndRenamingTheChapter:
      "Automatically approving and renaming the chapter…",
    renamingTheChapter: "Renaming the chapter…",
    automaticallyApprovedAndRenamedChapterTo:
      "Automatically approved and renamed chapter “{previousTitle}” to “{title}”.",
    renamedChapterToAndSavedItLocally:
      "Renamed chapter “{previousTitle}” to “{title}” and saved it locally.",
    chapterRenamedTo: "Chapter renamed to “{title}”",
    failedToRenameChapter: "Failed to rename chapter.",
    thePendingDeletionIsMissingRequiredParametersGenerateIt:
      "The pending {draftUnit} deletion is missing required parameters. Generate it again.",
    theManuscriptDirectoryIsUnavailableTheCannotBeDeleted:
      "The manuscript directory is unavailable. The {draftUnit} cannot be deleted.",
    noLongerExistsNoFurtherDeletionIsNeeded:
      "{draftUnit} “{title}” no longer exists. No further deletion is needed.",
    theTargetWasDeletedRelatedProseChangesCannotBe:
      "The target {draftUnit} was deleted. Related prose changes cannot be saved.",
    atLeastOneMustRemainInTheManuscriptNothing:
      "At least one {draftUnit} must remain in the manuscript. Nothing was deleted.",
    otherContentInThisProjectIsBeingSavedAutomatic3:
      "Other content in this project is being saved. Automatic deletion is paused. Retry manually shortly.",
    automaticallyApprovingAndDeleting:
      "Automatically approving and deleting {draftUnit}…",
    deleting: "Deleting {draftUnit}…",
    noLongerExists: "{draftUnit} “{title}” no longer exists.",
    automaticallyApprovedAndDeletedAndItsManuscriptAndCharacter:
      "Automatically approved and deleted {draftUnit} “{title}” and its manuscript and character state files.",
    deletedAndItsManuscriptAndCharacterStateFiles:
      "Deleted {draftUnit} “{title}” and its manuscript and character state files.",
    deletedAndItsCharacterStateFile:
      "Deleted {draftUnit} “{title}” and its character state file",
    failedToDelete: "Failed to delete {draftUnit}.",
    theNovelPlotDesignServiceIsUnavailable:
      "The novel plot design service is unavailable.",
    otherContentInThisBookIsBeingSavedAutomatic:
      "Other content in this book is being saved. Automatic plot design saving is paused. Retry shortly.",
    otherEditsToThisBookAreBeingSavedWait:
      "Other edits to this book are being saved. Wait before accepting.",
    automaticallyApprovingCheckingImpactsAndSavingPlotDesign:
      "Automatically approving, checking impacts, and saving plot design…",
    checkingImpactsAndSavingPlotDesign:
      "Checking impacts and saving plot design…",
    currentNovelEditsAreUnsavedPlotDesignWasNot:
      "Current novel edits are unsaved. Plot design was not overwritten.",
    structuralAndRelatedImpactsHaveBeenLoadedReviewThe:
      "Structural and related impacts have been loaded. Review the impacts below and confirm saving again.",
    reviewThePlotDesignAndRelatedImpactsBeforeConfirming:
      "Review the plot design and related impacts before confirming the save again",
    savedPlotDesign: "{value}saved plot design.",
    automaticallyApprovedAnd: "Automatically approved and ",
    acceptedAnd: "Accepted and ",
    plotDesignSavedButTheInterfaceRefreshFailedRefresh:
      "Plot design saved, but the interface refresh failed. Refresh the novel workspace manually.",
    plotDesignAcceptedAndSaved: "Plot design accepted and saved",
    relatedImpactsChangedAndHaveBeenUpdatedBelowReview:
      "Related impacts changed and have been updated below. Review them and confirm saving again.",
    plotDesignImpactsChangedConfirmAgain:
      "Plot design impacts changed. Confirm again.",
    failedToSavePlotDesignTheCurrentStructureIs:
      "Failed to save plot design. The current structure is unchanged.",
    plotDesignSavedButRefreshFailed:
      "Plot design saved, but refresh failed: {message}",
    theNovelCharacterFileServiceIsUnavailable:
      "The novel character file service is unavailable.",
    otherContentInThisBookIsBeingSavedAutomatic2:
      "Other content in this book is being saved. Automatic saving is paused. Retry shortly.",
    automaticallyApprovingAndCreatingCharacterProfiles:
      "Automatically approving and creating character profiles…",
    creatingCharacterProfiles: "Creating character profiles…",
    automaticallyApprovingAndSavingCharacterProfiles:
      "Automatically approving and saving character profiles…",
    savingCharacterProfiles: "Saving character profiles…",
    currentNovelEditsAreUnsavedCharacterProfilesWereNot:
      "Current novel edits are unsaved. Character profiles were not overwritten.",
    someProfilesForThisCharacterAlreadyExistNoDuplicate:
      "Some profiles for this character already exist. No duplicate was created.",
    theTargetCharacterProfileNoLongerExistsTheseChanges:
      "The target character profile no longer exists. These changes cannot be saved.",
    characterProfile: "Character profile",
    profileAndRelatedImpactsHaveBeenLoadedReviewThe:
      "Profile and related impacts have been loaded. Review the impacts below and confirm saving again.",
    reviewTheCharacterProfileAndRelatedImpactsBeforeConfirming:
      "Review the character profile and related impacts before confirming the save again",
    characterAndBothProfilesAutomaticallyApprovedAndCreated:
      "Character and both profiles automatically approved and created.",
    characterAndBothProfilesCreatedAndSavedToLocal:
      "Character and both profiles created and saved to local Markdown.",
    savedToLocalMarkdown: "{value}saved to local Markdown.",
    savedToLocalMarkdownButTheInterfaceRefreshFailed:
      "Saved to local Markdown, but the interface refresh failed. Refresh the novel workspace manually.",
    characterProfilesCreated: "Character profiles created",
    characterProfilesAcceptedAndSaved: "Character profiles accepted and saved",
    characterProfileImpactsChangedConfirmAgain:
      "Character profile impacts changed. Confirm again.",
    failedToSaveCharacterProfilesTheOriginalFilesAre:
      "Failed to save character profiles. The original files are unchanged.",
    characterProfilesSavedButRefreshFailed:
      "Character profiles saved, but refresh failed: {message}",
    theNovelManuscriptServiceIsUnavailable:
      "The novel manuscript service is unavailable.",
    otherContentInThisBookIsBeingSavedAutomatic3:
      "Other content in this book is being saved. Automatic manuscript saving is paused. Retry shortly.",
    automaticallyApprovingAndSavingChapterProse:
      "Automatically approving and saving chapter prose…",
    savingChapterProse: "Saving chapter prose…",
    currentNovelEditsAreUnsavedChapterProseWasNot:
      "Current novel edits are unsaved. Chapter prose was not overwritten.",
    theTargetChapterCardOrProseNoLongerExists:
      "The target chapter card or prose no longer exists. These changes were not saved.",
    chapterProse: "Chapter prose",
    manuscriptAndRelatedImpactsHaveBeenLoadedReviewThe:
      "Manuscript and related impacts have been loaded. Review the impacts below and confirm saving again.",
    reviewTheChapterProseAndRelatedImpactsBeforeConfirming:
      "Review the chapter prose and related impacts before confirming the save again",
    savedChapterProseToLocalMarkdown:
      "{value}saved chapter prose to local Markdown.",
    chapterProseSavedButTheInterfaceRefreshFailedRefresh:
      "Chapter prose saved, but the interface refresh failed. Refresh the novel workspace manually.",
    chapterProseAcceptedAndSaved: "Chapter prose accepted and saved",
    chapterProseImpactsChangedConfirmAgain:
      "Chapter prose impacts changed. Confirm again.",
    failedToSaveChapterProseTheOriginalFilesAre:
      "Failed to save chapter prose. The original files are unchanged.",
    chapterProseSavedButRefreshFailed:
      "Chapter prose saved, but refresh failed: {message}",
    thePendingAgentChangeNoLongerExistsGenerateIt:
      "The pending agent change no longer exists. Generate it again.",
    waitForTheCurrentAgentTurnToFinishBefore:
      "Wait for the current agent turn to finish before reviewing manuscript changes",
    rejectedPlotDesignIsUnchanged: "Rejected. Plot design is unchanged.",
    rejectedChapterProseIsUnchanged: "Rejected. Chapter prose is unchanged.",
    rejectedTheOriginalTextIsUnchanged:
      "Rejected. The original text is unchanged.",
    creationOfTheEmptyChapterWasRejectedItsManuscript:
      "Creation of the empty chapter was rejected. Its manuscript changes cannot be saved.",
    creationOfTheEmptyWorldbuildingFileWasRejectedIts:
      "Creation of the empty worldbuilding file was rejected. Its content cannot be saved.",
    characterCreationWasRejectedTheAssociatedCharacterProfileCannot:
      "Character creation was rejected. The associated character profile cannot be saved.",
    plotDesignChangesRejectedTheCurrentStructureIsUnchanged:
      "Plot design changes rejected. The current structure is unchanged.",
    chapterChangesRejectedTheManuscriptIsUnchanged:
      "Chapter changes rejected. The manuscript is unchanged.",
    agentEditsRejectedTheOriginalTextIsUnchanged:
      "Agent edits rejected. The original text is unchanged.",
    anEarlierAgentEditCouldNotBeSavedThis:
      "An earlier agent edit could not be saved. This dependent change is blocked and has not overwritten the manuscript.",
    waitingForEarlierEditsToFinishSaving:
      "Waiting for earlier edits to finish saving…",
    theTemporaryChapterAwaitingReviewHasAnInvalidFile:
      "The temporary chapter awaiting review has an invalid file ID. Generate it again.",
    waitingForTheAssociatedChapterToBeCreated:
      "Waiting for the associated chapter to be created…",
    theEmptyTargetChapterHasNotBeenSavedYet:
      "The empty target chapter has not been saved yet. Accept its creation before writing content, or generate it again.",
    characterCreationHasNotBeenConfirmedTheContentHas:
      "Character creation has not been confirmed. The content has been preserved. Retry creating the character first.",
    waitingForTheAssociatedCharacterEntryToBeCreated:
      "Waiting for the associated character entry to be created…",
    theAssociatedCharacterEntryCouldNotBeCreatedIts:
      "The associated character entry could not be created. Its content update was canceled.",
    theTargetCharacterEntryHasNotBeenSavedYet:
      "The target character entry has not been saved yet. Accept its creation before writing content, or generate it again.",
    theTargetManuscriptIsNoLongerAvailableThisAgent:
      "The target manuscript is no longer available. This agent edit cannot be accepted.",
    theLibraryDirectoryChangedDuringReviewTheAgentEdit:
      "The library directory changed during review. The agent edit was not accepted.",
    theProjectIsSavingOtherContentAutomaticSavingIs:
      "The project is saving other content. Automatic saving is paused. Retry manually in a moment.",
    theseEditsAreAlreadyInTheLocalMarkdownFile:
      "These edits are already in the local Markdown file. A separate unsaved draft was found and preserved.",
    theseEditsAreAlreadyInTheLocalMarkdownFile2:
      "These edits are already in the local Markdown file.",
    theAgentEditsAreAlreadySavedInTheLocal:
      "The agent edits are already saved in the local manuscript.",
    thePendingChangesAreMissingTheCompleteRevisedText:
      "The pending changes are missing the complete revised text. Generate the edits again.",
    theLibraryContentChangedDuringReviewTheAgentEdit:
      "The library content changed during review. The agent edit was not accepted and the latest content was not overwritten.",
    automaticallyApprovingAndSavingToLocalMarkdown:
      "Automatically approving and saving to local Markdown…",
    savingToLocalMarkdown: "Saving to local Markdown…",
    savedTheReviewedAgentEditsNewerChangesMadeDuring:
      "{value} saved the reviewed agent edits. Newer changes made during saving have been preserved.",
    successfully: "Successfully",
    savedToTheLocalFile: "{value} saved to the local file.",
    theCurrentWorkspaceThisPreviewHasNoCorrespondingLocal:
      "{value} the current workspace. This preview has no corresponding local file.",
    automaticallyApprovedAndWrittenTo: "Automatically approved and written to",
    acceptedInto: "Accepted into",
    agentEditsAcceptedAndSaved: "Agent edits accepted and saved.",
    agentEditsAccepted: "Agent edits accepted.",
    theLocalMarkdownFileWasUpdatedElsewhereTheAgent:
      "The local Markdown file was updated elsewhere. The agent edits were not saved. Generate new edits based on the latest manuscript.",
    couldNotSaveTheAgentEditsTheOriginalText:
      "Could not save the agent edits. The original text is unchanged.",
    userEditedAgentTarget:
      "You edited “{title}” after the agent read it. This change is paused; keep yours or overwrite it in the conversation.",
    waitingForYourSaveToFinish:
      "Waiting for your save to finish before saving automatically…"
  },
  plotStructureLane: {
    theTargetProjectIsNoLongerAvailableThePlot:
      "The target project is no longer available. The plot structure changes were not submitted for review.",
    theTargetPlotStructureNoLongerExistsTheseChanges:
      "The target plot structure no longer exists. These changes were not submitted for review.",
    createPlotStructure: "Create plot structure: {title}",
    renamePlotStructure: "Rename plot structure: {value} → {title}",
    thePlotStructureTargetIsUnavailableTheseChangesCannot:
      "The plot structure target is unavailable. These changes cannot be applied.",
    theProjectIsSavingOtherContentAutomaticPlotStructure:
      "The project is saving other content. Automatic plot structure creation is paused. Try again shortly.",
    automaticallyApprovingAndSavingThePlotStructure:
      "Automatically approving and saving the plot structure…",
    savingThePlotStructure: "Saving the plot structure…",
    thePlotStructureWasCreatedButItsContentFile:
      "The plot structure was created, but its content file could not be found.",
    theNewPlotStructureAlreadyHasDifferentContentThe:
      "The new plot structure already has different content. The existing file was not overwritten.",
    thePlotStructureWasCreatedButItsContentFile2:
      "The plot structure was created, but its content file could not be found after refreshing the workspace. Retry to complete the content mapping.",
    automaticallyApprovedAndCreatedPlotStructureIncludingItsContent:
      "Automatically approved and created plot structure “{title}”, including its content.",
    createdPlotStructureIncludingItsContent:
      "Created plot structure “{title}”, including its content.",
    automaticallyApprovedAndUpdatedPlotStructure:
      "Automatically approved and updated plot structure “{title}”.",
    updatedPlotStructure: "Updated plot structure “{title}”.",
    createdPlotStructure: "Created plot structure “{title}”.",
    updatedPlotStructure2: "Updated plot structure “{title}”.",
    couldNotSaveThePlotStructure: "Could not save the plot structure."
  },
  queue: {
    unknownError: "Unknown error",
    theApprovalSaveQueueFailedThisItemIsPaused:
      "The approval save queue failed: {detail}. This item is paused and can be retried. Subsequent independent tasks will continue.",
    approvedWaitingForThisProjectSSaveQueue:
      "Approved. Waiting for this project's save queue…",
    thisApprovalIsWaitingForARelatedTaskThe:
      "This approval is waiting for a related task. The content has been preserved and will continue automatically when its dependency finishes.",
    addedToTheAutomaticSaveQueue: "Added to the automatic save queue…"
  },
  creationContent: {
    theNewCharacterEntryAlreadyHasDifferentContentThe:
      "The new character entry already has different content. The existing file was not overwritten.",
    theNewChapterAlreadyHasDifferentContentTheExisting:
      "The new chapter {label} already has different content. The existing file was not overwritten."
  },
  libraryLane: {
    theTargetLibraryOrEntryIsNotWritableThese:
      "The target library or entry is not writable. These agent changes were not submitted for review.",
    theLibraryContentVersionChangedTheseAgentChangesWere:
      "The library content version changed. These agent changes were not submitted for review, and your latest edits were not overwritten.",
    theLibraryContentHasNotChangedNoSaveIs:
      "The library content has not changed. No save is needed."
  },
  refreshSavedLongProposal: {
    theWorldbuildingFileWasSavedButTheInterfaceCould:
      "The worldbuilding file was saved, but the interface could not refresh. Refresh the long-form workspace manually."
  },
  libraryStaging: {
    theLibraryChangesCouldNotBeSubmittedForReview:
      "The library changes could not be submitted for review."
  },
  libraryHydration: {
    theLibraryFileServiceIsCurrentlyUnavailable:
      "The library file service is currently unavailable.",
    theLibraryContentVersionChangedGenerateTheContentAgain:
      "The library content version changed. Generate the content again."
  },
  longImpactApproval: {
    theImpactPreviewForDoesNotMatchTheCurrent:
      "The impact preview for {label} does not match the current project."
  },
  draftSectionLane: {
    creatingThisChapterWouldExceedTheLimitOfManuscript:
      "Creating this chapter would exceed the limit of 100 manuscript chapters.",
    aChapterNamedAlreadyExistsInTheManuscriptDirectory:
      "A chapter named “{duplicateTitle}” already exists in the manuscript directory. No duplicate was created.",
    theRequestedChapterInsertionPositionNoLongerExistsNo:
      "The requested chapter insertion position no longer exists. No chapter was created.",
    creatingAnEmptyChapterFile: "Creating an empty chapter file…"
  },
  longWorldbuildingLane: {
    theLongFormWorldbuildingFileServiceIsCurrentlyUnavailable:
      "The long-form worldbuilding file service is currently unavailable.",
    automaticallyApprovingAndCreatingTheWorldbuildingFile:
      "Automatically approving and creating the worldbuilding file…",
    creatingTheWorldbuildingFile: "Creating the worldbuilding file…",
    automaticallyApprovingAndSavingTheWorldbuildingFile:
      "Automatically approving and saving the worldbuilding file…",
    savingTheWorldbuildingFile: "Saving the worldbuilding file…",
    theCurrentLongFormEditsAreUnsavedTheWorldbuilding:
      "The current long-form edits are unsaved. The worldbuilding file was not overwritten.",
    thisFileAlreadyExistsInTheWorldbuildingDirectoryNo:
      "This file already exists in the worldbuilding directory. No duplicate was created.",
    theTargetWorldbuildingFileNoLongerExistsTheseChanges:
      "The target worldbuilding file no longer exists. These changes cannot be saved.",
    theWorldbuildingFileSTargetCategoryNoLongerExists:
      "The worldbuilding file's target category no longer exists or is no longer list-based.",
    worldbuildingFile: "worldbuilding file",
    theFileAndRelationshipImpactHaveBeenLoadedReview:
      "The file and relationship impact have been loaded. Review the impact below, then confirm saving again.",
    reviewTheWorldbuildingFileAndItsRelationshipImpactThen:
      "Review the worldbuilding file and its relationship impact, then confirm saving again.",
    automaticallyApprovedAndCreatedTheWorldbuildingFile:
      "Automatically approved and created the worldbuilding file.",
    createdTheWorldbuildingFileAndSavedItToLocal:
      "Created the worldbuilding file and saved it to local Markdown.",
    worldbuildingFileCreated: "Worldbuilding file created.",
    worldbuildingFileAcceptedAndSaved: "Worldbuilding file accepted and saved.",
    theWorldbuildingFileSRelationshipImpactHasChangedConfirm:
      "The worldbuilding file's relationship impact has changed. Confirm again.",
    couldNotSaveTheWorldbuildingFileTheOriginalFile:
      "Could not save the worldbuilding file. The original file is unchanged.",
    theWorldbuildingFileWasSavedButTheRefreshFailed:
      "The worldbuilding file was saved, but the refresh failed: {message}"
  }
};
