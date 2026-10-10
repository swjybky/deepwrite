export default {
  emptyWorkspaceDocument: {
    noBookOpen: "No book open",
    workspace: "Workspace"
  },
  agentWelcome: {
    startWithAWritingGoal: "Start with a writing goal",
    tellMeWhatYouWantToWriteWeWill:
      "Tell me what you want to write. We will work on it together using your current manuscript.",
    helpMeClarifyMyWritingGoal: "Help me clarify my writing goal",
    reviewTheCurrentManuscript: "Review the current manuscript",
    suggestWhatToWorkOnNext: "Suggest what to work on next",
    startWithTheCurrentShortStoryStage:
      "Start with the current short story stage",
    iAmYourShortStoryAgentIHelpWith:
      "I am your short story agent. I help with characters, plot, and prose using the context of your current stage.",
    startWithTheCurrentScreenplayStage:
      "Start with the current screenplay stage",
    iAmYourScreenplayAgentIHelpWithCharacters:
      "I am your screenplay agent. I help with characters, plot, and scripts using the context of your current stage.",
    startByCreatingASkill: "Start by creating a skill",
    iManageYourSkillLibraryAndHelpCreateAnd:
      "I manage your skill library and help create and organize reusable writing methods, checklists, and workflows.",
    initializeTheLibraryIntroduction: "Initialize the library introduction",
    createASkill: "Create a skill",
    organizeASkill: "Organize a skill",
    startByCreatingAMaterial: "Start by creating a material",
    iManageYourMaterialLibraryAndHelpCreateAnd:
      "I manage your material library and help create and organize reusable materials for short stories, screenplays, and novels.",
    createAMaterial: "Create a material",
    organizeAMaterial: "Organize a material",
    startWith: "Start with {replace}"
  },
  catalogWorkspace: {
    characterMaterialLibrary: "Character material library",
    storyIdeaLibrary: "Story idea library",
    plotMaterialLibrary: "Plot material library",
    proseMaterialLibrary: "Prose material library",
    otherMaterialLibrary: "Other material library",
    generalMaterialLibrary: "General material library",
    storyIdeas: "Story ideas",
    characterConcepts: "Character concepts",
    plotDesign: "Plot design",
    openingDesign: "Opening design",
    plotRefinement: "Plot refinement",
    proseExcerpts: "Prose excerpts",
    otherMaterials: "Other materials",
    generalSkillLibrary: "General skill library",
    plotDesignSkillLibrary: "Plot design skill library",
    writingStyleSkillLibrary: "Writing style skill library",
    otherSkillLibrary: "Other skill library",
    characterSkills: "Character skills",
    plotSkills: "Plot skills",
    outlineSkills: "Outline skills",
    proseWritingSkills: "Prose writing skills",
    sectionWritingSkills: "Section writing skills",
    plot: "Plot",
    manuscript: "Manuscript",
    other: "Other",
    general: "General",
    writingStyle: "Writing style",
    shortStory: "Short story",
    novel: "Novel",
    screenplay: "Screenplay",
    overview: "Overview",
    characters: "Characters",
    otherDocuments: "{value} · Other documents",
    characterState: "Character state",
    message: "{value} · {value2}",
    episodeScript: "Episode script",
    sectionManuscript: "Section manuscript",
    characterState2: "{value} · Character state",
    libraryIntroduction: "Library introduction",
    material: "Material",
    libraryIntroduction2: "{title} · Library introduction",
    missingLibrary: "Missing {value} library ({libraryId})",
    skill: "Skill",
    missing: "Missing",
    libraryDescription: "Library description",
    libraryDescription2: "{title} · Library description",
    unreadableBook: "Unreadable book ({projectId})",
    unavailable: "Unavailable",
    invalidConfiguration: "Invalid configuration",
    unreadableSkillLibrary: "Unreadable skill library ({projectId})",
    unreadableMaterialLibrary: "Unreadable material library ({projectId})",
    skillLibrary: "Skill library",
    materialLibrary: "Material library"
  },
  libraryAgentSkillAttachments: {
    deepwriteAttachmentTruncatedAtCharactersOriginalLengthCharacters:
      "\n\n[DeepWrite: Attachment truncated at {toLocaleString} characters; original length: {toLocaleString2} characters.]",
    exceedsTheAttachmentLimitATruncationNoticeHasBeen:
      "“{name}” exceeds the attachment limit. A truncation notice has been included.",
    theLibraryAgentSupportsUpToSkillsAnotherSkills:
      "The library agent supports up to {itemLimit} skills. Another {length} skills were not attached."
  },
  libraryAgentContext: {
    group: "Group · {value}",
    librariesInThisGroup: "Libraries in this group",
    currentLibrary: "Current {domainLabel} library · {groupTitle}",
    currentLibrary2: "Current {domainLabel} library"
  },
  libraryAttachments: {
    cannotBuildMaterialAndSkillAttachmentsForMissingBook:
      "Cannot build material and skill attachments for missing book “{bookId}”."
  },
  bookTemplateReferences: {
    aPlotStageInThisTemplateIsNoLonger:
      "A plot stage in this template is no longer valid. Edit the template and try again.",
    aMaterialLibraryInThisTemplateIsNoLonger:
      "A material library in this template is no longer available. Select another library.",
    aSkillLibraryInThisTemplateIsNoLonger:
      "A skill library in this template is no longer available. Select another library."
  },
  shortLibraryReferences: {
    linkedToThisBook: "{value} · Linked to this book"
  },
  catalogDocumentContent: {
    catalogContentDoesNotMatchTheWorkspaceDocument:
      "Catalog content does not match the workspace document.",
    theCatalogContentTargetDoesNotMatchTheWorkspace:
      "The catalog content target does not match the workspace document."
  },
  shared: {
    exceedsTheAttachmentLimitATruncationNoticeHasBeen:
      "“{title}” exceeds the attachment limit. A truncation notice has been included.",
    theAttachmentLimitIsAnotherEntriesAreListedIn:
      "The {value} attachment limit is {limit}. Another {length} entries are listed in omittedAttachments."
  },
  candidates: {
    materialLibraryIsLinkedMoreThanOnceUnderAnd:
      "Material library “{libraryId}” is linked more than once under {selectedKind} and was read once.",
    linkedMaterialLibraryDoesNotExist:
      "Linked material library “{libraryId}” does not exist.",
    materialLibraryIsCategorizedAsButThisBookLinks:
      "Material library “{title}” is categorized as {materialKind}, but this book links it under {selectedKind}.",
    skillLibraryIsLinkedUnderBothAndItWas:
      "Skill library “{libraryId}” is linked under both {previousKind} and {selectedKind}. It was read once under {previousKind2}.",
    linkedSkillLibraryDoesNotExist:
      "Linked skill library “{libraryId}” does not exist.",
    skillLibraryIsCategorizedAsButThisBookLinks:
      "Skill library “{title}” is categorized as {skillKind}, but this book links it under {selectedKind}."
  },
  creativeBookCreation: {
    theBrowserPreviewCannotSaveProjectsCreateProjectsIn:
      "The browser preview cannot save projects. Create projects in the desktop app."
  },
  bookLibrarySelection: {
    longFormPlotAndStructureReferences:
      "Long-form plot and structure references",
    customNovelMaterials: "Custom novel materials",
    plotDesignAndRefinement: "Plot design and refinement",
    availableAcrossMultipleNovelStages:
      "Available across multiple novel stages",
    chapterAndSectionWritingMethods: "Chapter and section writing methods",
    manuscriptAndEpisodeWritingMethods:
      "Manuscript and episode writing methods",
    official: "{title} · Official",
    noAssociation: "No association",
    materialLibraryUnavailableSelectAgain:
      "Material library unavailable (select again)",
    notLinked: "Not linked",
    skillLibraryUnavailableSelectAgain:
      "Skill library unavailable (select again)"
  },
  shortBookCreation: {
    createdButFailedToRefreshTheProjectListRefresh:
      "Created {value} “{title}”, but failed to refresh the project list. Refresh will be retried automatically.",
    createdAndSavedTheMaterialAndSkillLibraryLinks:
      "Created {value} “{title}” and saved the material and skill library links",
    createdProjectButFailedToRefreshTheLocalList:
      "Created project “{title}”, but failed to refresh the local list. Refresh will be retried automatically.",
    failedToCreateProject: "Failed to create project."
  },
  catalogLibraryTransactionsCoordinator: {
    createdLibrary: "Created {value} library “{title}”",
    failedToCreateLibrary: "Failed to create library.",
    createdGroup: "Created {value} group “{title}”",
    failedToCreateLibraryGroup: "Failed to create library group.",
    savedGroup: "Saved group “{title}”",
    theGroupWasUpdatedExternallyAndHasBeenReloaded:
      "The group was updated externally and has been reloaded. Review it before editing again.",
    failedToUpdateGroupLinks: "Failed to update group links.",
    createdEntry: "Created {value} entry “{title}”",
    theLibraryWasUpdatedExternallyAndHasBeenReloaded:
      "The library was updated externally and has been reloaded. Create the entry again using the refreshed directory.",
    failedToCreateLibraryEntry: "Failed to create library entry.",
    theLibraryToEditWasNotFound: "The library to edit was not found",
    libraryRenamed: "Library renamed",
    failedToRenameLibrary: "Failed to rename library.",
    theEntryToEditWasNotFound: "The entry to edit was not found",
    entryRenamed: "Entry renamed",
    failedToRenameEntry: "Failed to rename entry.",
    theDestinationLibraryNoLongerExistsRefreshAndTry:
      "The destination library no longer exists. Refresh and try again.",
    entryOrderUpdated: "Entry order updated",
    entryMovedToTheDestinationLibrary: "Entry moved to the destination library",
    failedToMoveLibraryEntry: "Failed to move library entry.",
    theMaterialEntryToMoveNoLongerExistsRefresh:
      "The material entry to move no longer exists. Refresh and try again.",
    theEntryNoLongerExistsTheDirectoryHasBeen:
      "The entry no longer exists. The directory has been reloaded.",
    deletedEntryFile: "Deleted {value} entry file",
    theLibraryWasUpdatedExternallyAndHasBeenReloaded2:
      "The library was updated externally and has been reloaded. Review it before deleting again.",
    failedToDeleteLibraryEntry: "Failed to delete library entry.",
    theEntryToCopyWasNotFound: "The entry to copy was not found",
    theEntryContentToCopyWasNotFound: "The entry content to copy was not found",
    copiedEntry: "Copied {value} entry “{title}”",
    theClipboardHasNoEntryToPaste: "The clipboard has no entry to paste",
    theDestinationLibraryWasNotFound: "The destination library was not found",
    materialEntriesCanOnlyBePastedIntoMaterialLibraries:
      "Material entries can only be pasted into material libraries",
    skillEntriesCanOnlyBePastedIntoSkillLibraries:
      "Skill entries can only be pasted into skill libraries",
    entriesCannotBePastedAcrossLibrariesOfDifferentProject:
      "Entries cannot be pasted across libraries of different project types",
    theDestinationLibraryIsReadOnlyOrUnavailableThe:
      "The destination library is read-only or unavailable. The entry cannot be pasted.",
    builtInSkillLibrariesAreReadOnlyEntriesCannot:
      "Built-in skill libraries are read-only. Entries cannot be pasted here.",
    pastedEntryInto: "Pasted {value} entry “{title}” into “{label}”",
    theLibraryWasUpdatedExternallyAndHasBeenReloaded3:
      "The library was updated externally and has been reloaded. Paste again.",
    failedToPasteLibraryEntry: "Failed to paste library entry.",
    theLibraryIsNoLongerInTheCurrentDirectory:
      "The library is no longer in the current directory.",
    removedFromTheListItsLocalFolderIsPreserved:
      "Removed “{label}” from the list. Its local folder is preserved.",
    failedToRemoveLibrary: "Failed to remove library.",
    deletedAndItsLocalFolder: "Deleted “{label}” and its local folder",
    failedToDeleteLibrary: "Failed to delete library.",
    theGroupWasNotFound: "The group was not found",
    theLibraryWasNotFound: "The library was not found",
    copiedGroupAsIncludingMemberLibraries:
      "Copied group “{label}” as “{title}”, including {length} member libraries",
    copiedAs: "Copied “{label}” as “{title}”",
    failedToDuplicateLibraryProject: "Failed to duplicate library project.",
    theGroupIsNoLongerInTheCurrentDirectory:
      "The group is no longer in the current directory.",
    dissolvedGroupItsLibrariesAreBackInTheirOriginal:
      "Dissolved group “{label}”. Its libraries are back in their original categories.",
    failedToDissolveGroup: "Failed to dissolve group.",
    theLocalLibraryWasNotFound: "The local library was not found",
    builtInSkillLibrariesAreReadOnlyEntriesCannot2:
      "Built-in skill libraries are read-only. Entries cannot be edited.",
    library: "Library",
    theEntryFileToDeleteWasNotFound: "The entry file to delete was not found"
  },
  catalogWorkspaceProjectionCoordinator: {
    projectCannotCurrentlyBeRead:
      "Project “{projectId}” cannot currently be read: {message}{value}",
    additionalProjects: " ({value} additional projects)",
    theLegacyRecoveryDraftDoesNotMatchTheCurrent:
      "The legacy recovery draft does not match the current disk version or episode/section structure. It has been preserved. Review the current manuscript directory{value}",
    inTotal: " ({length} in total)",
    theDirectoryVersionChangedWhileMigratingLegacyRecoveryDrafts:
      "The directory version changed while migrating legacy recovery drafts. The original drafts are preserved and will be reloaded.",
    legacyRecoveryDraftsCannotCurrentlyBeMigrated:
      "Legacy recovery drafts cannot currently be migrated: {message}",
    legacyRecoveryDraftsCannotCurrentlyBeMigratedTheOriginal:
      "Legacy recovery drafts cannot currently be migrated. The original drafts have been preserved.",
    failedToLoadMaterialAndSkillLibraries:
      "Failed to load material and skill libraries.",
    restoredUnsavedDrafts: "Restored {recoveredDraftCount} unsaved drafts"
  },
  bookLibraryKinds: {
    charactersAndRelationships: "Characters and relationships",
    coreIdeasAndHooks: "Core ideas and hooks",
    plotOpeningAndRefinement: "Plot, opening, and refinement",
    proseExcerptsAndWritingReferences: "Prose excerpts and writing references",
    materialsOutsideTheCategoriesAbove:
      "Materials outside the categories above",
    availableAcrossMultipleStages: "Available across multiple stages",
    characterPlotAndOutlineMethods: "Character, plot, and outline methods",
    manuscriptAndSectionWritingMethods:
      "Manuscript and section writing methods",
    customWritingMethods: "Custom writing methods"
  },
  catalogDocumentPersistence: {
    theLatestDirectorySnapshotCouldNotBeReadAfter:
      "The latest directory snapshot could not be read after saving.",
    theSavedBookIsMissingFromTheLatestDirectory:
      "The saved book is missing from the latest directory snapshot.",
    theDirectoryHasNotReachedTheSavedVersionYet:
      "The directory has not reached the saved version yet.",
    theDirectoryVersionReadAfterSavingMovedBackwards:
      "The directory version read after saving moved backwards.",
    theLatestManuscriptContentCouldNotBeReadAfter:
      "The latest manuscript content could not be read after saving.",
    manuscriptSavedButTheLatestDirectoryVersionHasNot:
      "Manuscript saved, but the latest directory version has not synced. Sync will retry when the window regains focus.",
    libraryChangesSavedToDiskButTheLatestDirectory:
      "Library changes saved to disk, but the latest directory has not synced. Sync will retry when the window regains focus.",
    libraryEntryCreatedButItsDirectoryLocationHasNot:
      "Library entry created, but its directory location has not synced. Sync will retry when the window regains focus.",
    cannotRefreshTheDirectoryIndexTheCurrentDraftRemains:
      "Cannot refresh the directory index. The current draft remains in recovery storage.",
    theDiskVersionChangedAgainWhileReadingPleaseTry:
      "The disk version changed again while reading. Please try again.",
    theDiskVersionReturnedInvalidContentTheCurrentDraft:
      "The disk version returned invalid content. The current draft remains in recovery storage.",
    theDiskVersionNoLongerExistsTheCurrentDraft:
      "The disk version no longer exists. The current draft remains in recovery storage.",
    earlierEditsAreAlreadyOnDiskYourNewerDraft:
      "Earlier edits are already on disk. Your newer draft has been preserved.",
    theDiskVersionAlreadyContainsTheseChangesNoAdditional:
      "The disk version already contains these changes. No additional save is needed.",
    failedToReadTheConflictingDiskVersionTheCurrent:
      "Failed to read the conflicting disk version. The current draft is preserved.",
    manuscriptSavedLocally: "Manuscript saved locally",
    failedToSaveManuscript: "Failed to save manuscript.",
    contentSavedToTheLocalFolder: "{value} content saved to the local folder",
    failedToSaveLibraryContent: "Failed to save library content.",
    libraryIntroductionSavedToTheLocalFolder:
      "Library introduction saved to the local folder",
    failedToSaveLibraryIntroduction: "Failed to save library introduction.",
    resolveTheCurrentSaveConflictBeforeSavingOtherDocuments:
      "Resolve the current save conflict before saving other documents",
    enterADocumentTitleBeforeSaving: "Enter a document title before saving",
    agentEditsForTheSameProjectAreBeingSaved:
      "Agent edits for the same project are being saved. Please wait.",
    newEditsWereDetectedWhileReadingTheCurrentDraft:
      "New edits were detected while reading. The current draft has been preserved.",
    diskVersionReloaded: "Disk version reloaded",
    failedToReloadDiskVersion: "Failed to reload disk version",
    failedToOverwriteDiskVersion: "Failed to overwrite disk version"
  },
  lazyLongBookLifecycleCoordinator: {
    failedToLoadTheNovelLifecycleCoordinator:
      "Failed to load the novel lifecycle coordinator."
  },
  libraryPackageCoordinator: {
    desktopNeedsRestart:
      "Library import and export are not ready. Fully quit and restart DeepWrite, then try again.",
    browserPreviewCannotExport:
      "The browser preview cannot export local libraries. Use the desktop app.",
    browserPreviewCannotImport:
      "The browser preview cannot import local files. Use the desktop app.",
    exportedTo: "Exported to {path}",
    exportedToWithSkipped:
      "Exported to {path} ({count} unavailable member libraries were skipped)",
    exportFailed: "Export failed",
    recognitionFailed: "Could not recognize the source",
    importFailed: "Import failed",
    imported: "Imported {libraries} libraries and {entries} entries",
    sourceChanged:
      "The source changed after it was recognized. Choose it again.",
    headlineWithReason: "{headline}: {reason}"
  },
  externalLibraryImportCoordinator: {
    theBrowserPreviewCannotReadLocalFilesUseThe:
      "The browser preview cannot read local files. Use the desktop app.",
    noImportableTextWasFoundAtTheSelectedLocation:
      "No importable text was found at the selected location",
    failedToScanExternalFiles: "Failed to scan external files.",
    theDestinationLibraryIsUnavailableOrReadOnly:
      "The destination library is unavailable or read-only",
    theSelectedEntriesExceedTheRemainingLibraryCapacity:
      "The selected entries exceed the remaining library capacity",
    importedEntriesWereRenamedToAvoidDuplicates:
      "Imported {length} entries; {renamedCount} were renamed to avoid duplicates",
    importedEntriesInto: "Imported {length} entries into “{title}”",
    theDestinationLibraryWasUpdatedExternallyDuplicateNamesHave:
      "The destination library was updated externally. Duplicate names have been refreshed. Review and retry.",
    failedToImportMaterialsInBulk: "Failed to import materials in bulk."
  },
  bookTemplates: {
    failedToLoadTemplates: "Failed to load templates",
    templateSaved: "Template saved",
    failedToSaveTemplate: "Failed to save template",
    templateDeleted: "Template deleted",
    failedToDeleteTemplate: "Failed to delete template"
  },
  lazyShortBookLifecycleCoordinator: {
    failedToLoadTheShortStoryLifecycleCoordinator:
      "Failed to load the short story lifecycle coordinator."
  },
  catalogProjectActions: {
    theBrowserPreviewCannotOpenLocalFoldersUseThe:
      "The browser preview cannot open local folders. Use the desktop app.",
    opened: "Opened {value} “{title}”",
    book: "Book",
    failedToOpenLocalProject: "Failed to open local project."
  },
  shortBookLifecycleCoordinator: {
    theCurrentHasNoVersionIdentifierCannotSafelyPerform:
      "The current {value} has no version identifier. Cannot safely perform: {operationLabel}.",
    theConfigurationWasUpdatedElsewhereReopenTheDialogBefore:
      "The {value} configuration was updated elsewhere. Reopen the dialog before performing: {operationLabel}.",
    couldNotFindTheBookToEdit: "Could not find the book to edit.",
    rename: "Rename",
    renamedTo: "Renamed “{label}” to “{label2}”.",
    theCurrentBookHasNoVersionIdentifierItCannot:
      "The current book has no version identifier. It cannot be renamed safely.",
    renamedToButTheProjectListCouldNotBe:
      "Renamed “{label}” to “{title}”, but the project list could not be refreshed. An automatic retry will follow.",
    renamedTo2: "Renamed “{label}” to “{title}”.",
    theBookConfigurationWasUpdatedElsewhereAndHasBeen:
      "The book configuration was updated elsewhere and has been reloaded. Review it before making another change.",
    couldNotRenameTheBook: "Could not rename the book.",
    couldNotFindTheBookWhoseLibraryLinksShould:
      "Could not find the book whose library links should be updated.",
    updateLinks: "Update links",
    updatedTheLinkFor: "Updated the {bindingLabel} link for “{label}”.",
    theCurrentBookHasNoVersionIdentifierItsLibrary:
      "The current book has no version identifier. Its library links cannot be updated safely.",
    updatedTheLinkForButTheProjectListCould:
      "Updated the {bindingLabel} link for “{label}”, but the project list could not be refreshed. An automatic retry will follow.",
    theBookSLibraryLinksWereUpdatedElsewhereAnd:
      "The book's library links were updated elsewhere and have been reloaded. Review them before saving again.",
    couldNotUpdateTheLibraryLinks: "Could not update the library links.",
    thisBookHasAlreadyBeenRemovedFromTheCurrent:
      "This book has already been removed from the current writing workspace.",
    thisBookHasNoLocalProjectFolderToDelete:
      "This book has no local project folder to delete.",
    couldNotFindTheRequestedBook: "Could not find the requested book.",
    couldNotFindTheTo: "Could not find the {value2} to {value}.",
    remove: "remove",
    theWasRemovedButItsLocalRuntimeStateCould:
      "The {value} was removed, but its local runtime state could not be cleared.",
    butTheProjectListCouldNotBeRefreshedAn:
      "{value} “{label}”, but the project list could not be refreshed. An automatic retry will follow.",
    deleted: "Deleted",
    removed: "Removed",
    removed2: "Removed “{label}”.",
    couldNot: "Could not {value} {value2}.",
    theOperationCompletedButTheLocalStateCouldNot:
      "The {value} operation completed, but the local state could not be refreshed. An automatic retry will follow.",
    couldNotFindTheBookToExport: "Could not find the book to export.",
    allEpisodes: "all episodes",
    theIntroductionAndAllSections: "the introduction and all sections",
    copiedTheManuscriptOfItIsReadyToPaste:
      "Copied the manuscript of “{title}” ({scope}). It is ready to paste.",
    exportedAs: "Exported “{title}” ({scope}) as {value}.",
    couldNotCopyTheManuscript: "Could not copy the manuscript.",
    couldNotExportTheManuscript: "Could not export the manuscript."
  }
};
