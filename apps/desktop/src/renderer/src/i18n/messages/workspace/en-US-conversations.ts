export default {
  conversationPreferenceState: {
    conversationScopeCannotBeEmpty: "Conversation scope cannot be empty."
  },
  conversationControllerPersistence: {
    theCurrentStorageCannotSaveConversationUpdatesPleaseTry:
      "The current storage cannot save conversation updates. Please try again."
  },
  conversationStore: {
    conversationKeyCannotBeEmpty: "Conversation key cannot be empty."
  },
  conversationPersistenceQueue: {
    theConversationPersistenceQueueIsClosed:
      "The conversation persistence queue is closed.",
    persistenceKeyCannotBeEmpty: "Persistence key cannot be empty.",
    theConversationStorageAdapterHasNotBeenConfigured:
      "The conversation storage adapter has not been configured."
  },
  conversationPersistenceState: {
    failedToSaveConversationState: "Failed to save conversation state."
  },
  agentActivityDescriptors: {
    agentConversation: "Agent conversation",
    novelAgent: "Novel agent",
    novelProject: "Novel project"
  },
  write: {
    exportCanceled: "Export canceled.",
    deepwriteConversationJson: "DeepWrite-conversation-{slice}.json",
    exportConfirmationsAreOutOfOrderPleaseRestartThe:
      "Export confirmations are out of order. Please restart the export."
  },
  action: {
    finishOrCancelTheCurrentExportFirst:
      "Finish or cancel the current export first.",
    theConversationHasChangedSelectTheConversationToExport:
      "The conversation has changed. Select the conversation to export again.",
    exported: "Exported {fileName}"
  },
  capture: {
    theConversationContainsNonJsonObjectsAndCannotBe:
      "The conversation contains non-JSON objects and cannot be fully exported.",
    allConversationRecordsCurrentlyLoadedInThisClientIncluding:
      "All conversation records currently loaded in this client, including unsaved changes. Other conversations and unloaded database fields are excluded. This is not a full database backup."
  },
  jsonChunks: {
    theConversationContainsDataThatCannotBeExportedAs:
      "The conversation contains data that cannot be exported as JSON.",
    theConversationContainsCircularReferencesAndCannotBeFully:
      "The conversation contains circular references and cannot be fully exported."
  },
  conversationHistoryWriter: {
    conversationSaveAcknowledgmentDoesNotMatch:
      "Conversation save acknowledgment does not match.",
    conversationChunkSaveAcknowledgmentDoesNotMatch:
      "Conversation chunk save acknowledgment does not match."
  },
  conversationHistoryIndex: {
    invalidConversationTimestampTheOriginalRecordHasBeenPreserved:
      "Invalid conversation timestamp. The original record has been preserved.",
    untitledConversation: "Untitled conversation",
    theConversationHistoryCursorDidNotAdvance:
      "The conversation history cursor did not advance."
  },
  bookConversationMigration: {
    someExistingBookHistoryRecordsAreNotRecognizedThe:
      "Some existing book history records are not recognized. The original records have been preserved.",
    historyChangedDuringMigrationPleaseTryAgain:
      "History changed during migration. Please try again."
  },
  conversationHistoryUpload: {
    thisConversationFieldCannotBeSavedInChunks:
      "This conversation field cannot be saved in chunks."
  },
  conversationHistoryRecordLoader: {
    invalidHistoryFieldPath: "Invalid history field path.",
    thisConversationNoLongerExistsOrHasBeenDeleted:
      "This conversation no longer exists or has been deleted.",
    invalidHistoryMetadata: "Invalid history metadata.",
    invalidHistoryMessageFormat: "Invalid history message format.",
    historyMessageIdentifiersDoNotMatchTheCurrentConversation:
      "History message identifiers do not match. The current conversation has been preserved.",
    theHistoryPaginationCursorDidNotAdvance:
      "The history pagination cursor did not advance.",
    historyMessageCountValidationFailedTheCurrentConversationHas:
      "History message count validation failed. The current conversation has been preserved.",
    conversationHistoryCouldNotBeFullyReadTheOriginal:
      "Conversation history could not be fully read. The original records have been preserved."
  },
  bookConversationPreparation: {
    historyCouldNotBeFullyReadTheOriginalRecords:
      "History could not be fully read. The original records have been preserved."
  },
  conversationModelOptions: {
    officialSite: "Official site",
    customModels: "Custom models",
    freeModels: "Free models",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    extraHigh: "Extra high",
    maximum: "Maximum",
    off: "Off",
    custom: "Custom ({level})",
    requestApproval: "Request approval",
    askForYourApprovalBeforeEditingOrWritingThe:
      "Ask for your approval before editing or writing the manuscript",
    approveAutomatically: "Approve automatically",
    automaticallyApproveEditsAndSaveThemToTheManuscript:
      "Automatically approve edits and save them to the manuscript"
  },
  conversationTurnNavigator: {
    attachments: "Attachments: {attachmentNames}",
    noText: "No text"
  },
  longConversationCoordinator: {
    theNovelContextConversationModelSettingsOrInputChanged:
      "The novel context, conversation, model settings, or input changed. Sending was canceled.",
    savingAndPreparingToSendWaitBeforeYou:
      "Saving and preparing to send. Wait before you {action}.",
    newConversation: "New conversation",
    stopTheCurrentNovelResponseBeforeStartingANew:
      "Stop the current novel response before starting a new conversation.",
    switchConversation: "Switch conversation",
    stopTheCurrentResponseBeforeSwitchingConversations:
      "Stop the current response before switching conversations.",
    thisNovelConversationIsNoLongerAvailable:
      "This novel conversation is no longer available.",
    thePreviousNovelMessageIsStillBeingPreparedPlease:
      "The previous novel message is still being prepared. Please wait.",
    theNovelWorkspaceContextIsNotReadyPleaseTry:
      "The novel workspace context is not ready. Please try again shortly.",
    waitForTheCurrentResponseApprovalsAndNovelEdits:
      "Wait for the current response, approvals, and novel edits to finish saving.",
    novelAgentSettingsHaveNotLoadedPleaseTryAgain:
      "Novel agent settings have not loaded. Please try again.",
    theNovelContextChangedSendingWasCanceled:
      "The novel context changed. Sending was canceled.",
    theNovelWorkspaceIsNotConnectedInThisEnvironment:
      "The novel workspace is not connected in this environment.",
    failedToReadTheCurrentWorldbuildingStage:
      "Failed to read the current worldbuilding stage: {message}",
    failedToReadTheCurrentWorldbuildingStagePleaseTry:
      "Failed to read the current worldbuilding stage. Please try again.",
    failedToReadTheCurrentCharacterStage:
      "Failed to read the current character stage: {message}",
    failedToReadTheCurrentCharacterStagePleaseTry:
      "Failed to read the current character stage. Please try again.",
    theNovelContextIsTooLongOnlyATruncated:
      "The novel context is too long. Only a truncated AGENTS.md was included for this turn.",
    novelContextWasNotIncluded: "Novel context was not included: {message}",
    novelContextWasNotIncludedTheMessageWillStill:
      "Novel context was not included. The message will still be sent.",
    theNovelResourceContextChangedSendingWasCanceled:
      "The novel resource context changed. Sending was canceled.",
    additionalNovelResourceNotices:
      "{message} ({value} additional novel resource notices)",
    failedToSendTheNovelMessagePleaseTryAgain:
      "Failed to send the novel message. Please try again shortly.",
    changeModelSettings: "Change model settings"
  },
  conversationHistoryManagement: {
    deletedConversationsCouldNotBeLoadedPleaseTryAgain:
      "Archived conversations could not be loaded. Please try again.",
    finishOrStopTheCurrentResponseBeforeManagingConversations:
      "Finish or stop the current response before managing conversations.",
    conversationArchived: "Conversation archived. Restore it from Settings.",
    conversationRestored: "Conversation restored.",
    theConversationOperationDidNotCompletePleaseTryAgain:
      "The conversation operation did not complete. Please try again."
  },
  conversationAttachments: {
    eachMessageCanIncludeUpToAttachments:
      "Each message can include up to {PROMPT_ATTACHMENT_MAX_ITEMS} attachments.",
    textAttachmentsCanContainUpToCharactersInTotal:
      "Text attachments can contain up to {toLocaleString} characters in total.",
    imageAttachmentsCannotExceedMbInTotal:
      "Image attachments cannot exceed 25 MB in total.",
    failedToRead: "Failed to read “{name}”.",
    additionalAttachmentsWereNotAdded:
      "{value} ({value2} additional attachments were not added)",
    addedAttachments: "Added {added} attachments",
    attachmentsAreBeingReadWaitBeforePastingAgain:
      "Attachments are being read. Wait before pasting again."
  },
  conversationSelectionInsertion: {
    agentResponse: "Agent response {responseNumber}"
  },
  currentConversationExport: {
    chooseAnotherLocationAndTryAgain:
      "{value} Choose another location and try again.",
    exportIncomplete: "Export incomplete."
  },
  conversationRegistryHistoryManagement: {
    thisConversationNoLongerExists: "This conversation no longer exists.",
    historyOperationAcknowledgmentDoesNotMatchPleaseTryAgain:
      "History operation acknowledgment does not match. Please try again.",
    conversationStateChangedRefreshHistoryAndTryAgain:
      "Conversation state changed. Refresh history and try again."
  },
  shortConversationCoordinator: {
    noStageSelected: "No stage selected",
    currentLibrary: "Current {value} library · {title}",
    currentLibrary2: "Current {value} library",
    group: "Group · {title}",
    methodsLoadedOnDemand: "Methods loaded on demand",
    noResourceSelected: "No resource selected",
    theCurrentResourceConversationOrInputChangedSendingWas:
      "The current resource, conversation, or input changed. Sending was canceled.",
    stopTheCurrentResponseBeforeStartingANewConversation:
      "Stop the current response before starting a new conversation.",
    waitForAgentEditsToFinishSavingBeforeStarting:
      "Wait for agent edits to finish saving before starting a new conversation",
    waitForAgentEditsToFinishSavingBeforeSwitching:
      "Wait for agent edits to finish saving before switching conversations",
    stopTheCurrentResponseBeforeSwitchingConversations:
      "Stop the current response before switching conversations",
    thisConversationIsUnavailableReopenTheHistoryList:
      "This conversation is unavailable. Reopen the history list.",
    thePreviousMessageIsStillBeingPreparedPleaseWait:
      "The previous message is still being prepared. Please wait.",
    waitForTheCurrentResponseApprovalsAndEditsTo:
      "Wait for the current response, approvals, and edits to finish saving.",
    theLibraryContextIsNotReadySelectTheEntry:
      "The library context is not ready. Select the entry again before sending.",
    additionalLibraryNotices: "{message} ({value} additional library notices)",
    additionalSkillNotices: "{message} ({value} additional skill notices)",
    failedToSendMessagePleaseTryAgainShortly:
      "Failed to send message. Please try again shortly.",
    generationStopped: "Generation stopped",
    failedToStopGenerationPleaseTryAgainShortly:
      "Failed to stop generation. Please try again shortly."
  },
  conversationComposer: {
    useSkill: "Use skill",
    referenceSkill: "Reference skill",
    referenceMaterial: "Reference material",
    assignTeamMember: "Assign team member",
    searchSkillsByName: "Search skills by name",
    searchSkillEntriesByName: "Search skill entries by name",
    searchMaterialEntriesByName: "Search material entries by name",
    searchTeamMembersByName:
      "Search team members by name. The task goes to that member",
    sendingIsUnavailableInTheBrowserPreviewStartThe:
      "Sending is unavailable in the browser preview. Start the desktop app.",
    describeALibraryTaskTypeToLoadAMethod:
      "Describe a library task. Type / to load a method skill or {'@'} to reference skills in this library or its group…",
    describeALibraryTaskTypeToLoadAMethod2:
      "Describe a library task. Type / to load a method skill or {'@'} to reference materials in this library or its group…",
    writeAnythingTypeToUseSkillsOrToReference:
      "Write anything. Type / to use skills or {'@'} to reference materials…",
    writeAnythingTypeToUseSkillsOrToReferenceOrTeam:
      "Write anything. Type / to use skills, {'@'} to reference materials, or # to assign a team member…",
    eachMessageCanIncludeUpToAttachmentsOrManuscript:
      "Each message can include up to {PROMPT_ATTACHMENT_MAX_ITEMS} attachments or manuscript references.",
    textAttachmentsAndManuscriptReferencesCanContainUpTo:
      "Text attachments and manuscript references can contain up to {toLocaleString} characters in total."
  },
  conversationSaveStatus: {
    theConversationCouldNotBeSavedLocallyPleaseTry:
      "The conversation could not be saved locally. Please try again.",
    waitingToSave: "Waiting to save",
    saving: "Saving",
    saved: "Saved",
    saveFailed: "Save failed"
  },
  agentActivityCoordinator: {
    theAssociatedAgentContextNoLongerExistsTheNotice:
      "The associated agent context no longer exists. The notice has been removed."
  },
  sessionLifecycle: {
    theConversationWasSwitchedOrClosedSubtasksWereAlso:
      "The conversation was switched or closed. Subtasks were also stopped.",
    theConversationWasSwitchedOrClosedBeforeToolCalls:
      "The conversation was switched or closed before tool calls returned their final state."
  },
  webSearch: {
    setUpInSettings:
      "Web search is off or has no key. Turn it on under Settings > Personal > Web search"
  },
  followUpQueue: {
    steerFailed: "Could not add it; it is queued again.",
    queueIsFull: "Up to {count} queued messages."
  },
  history: {
    historicalAttachmentNoteOnlyAttachmentNamesWereRestoredOriginal:
      "{content}\n\n[Historical attachment note] {map}. Only attachment names were restored. Original attachments were not saved in the conversation history. Ask the user to upload them again when checking or citing original text or images.",
    steeringNotes: "{content}\n\n[Added during the reply]\n{notes}",
    theConversationHistoryExceedsTheRestorationTransferLimitIt:
      "The conversation history exceeds the restoration transfer limit. It was neither truncated nor sent. Start a new conversation from an existing checkpoint. The original conversation is preserved."
  },
  parseSubagent: {
    theSubtaskWasStoppedWhenTheConversationWasRestored:
      "The subtask was stopped when the conversation was restored.",
    theSubtaskWasStillRunningWhenTheAppClosed:
      "The subtask was still running when the app closed or the conversation was restored.",
    theSubtaskHadNotStartedWhenTheAppClosed:
      "The subtask had not started when the app closed or the conversation was restored."
  },
  conversationRuntimeRegistryCoordinator: {
    conversationHistoryCouldNotBeSavedLocallyYouCan:
      "Conversation history could not be saved locally. You can still switch conversations during this session.",
    conversationHistoryMigrationIsIncompleteTheOriginalRecordsHave:
      "Conversation history migration is incomplete. The original records have been preserved.",
    conversationHistoryCouldNotBeReadYouCanContinue:
      "Conversation history could not be read. Check the user data folder; messages must be saved before they can be sent.",
    theConversationRuntimeRegistryHasBeenClosed:
      "The conversation runtime registry has been closed."
  },
  writingContext: {
    theContextIsTooLongOnlyATruncatedAgents:
      "The {label} context is too long. Only a truncated AGENTS.md was included this turn.",
    theContextWasNotIncluded: "The {label} context was not included: {message}",
    theContextWasNotIncludedThisTurnWillStill:
      "The {label} context was not included. This turn will still be sent."
  },
  runLifecycle: {
    theParentAgentStoppedSubtasksWereAlsoStopped:
      "The parent agent stopped. Subtasks were also stopped.",
    theAgentStoppedBeforeToolCallsReturnedTheirFinal:
      "The agent stopped before tool calls returned their final state."
  },
  sendMessage: {
    acceptStalled: "Applying the change timed out. Try again.",
    messageExceedsContextBudget:
      "The message and attachments need about {used} tokens, above the available {limit} tokens. A 10% reserve is kept within your {budget}-token compaction budget. Shorten the content or adjust the setting.",
    messageTooLong:
      "Each message can contain up to {limit} characters; this message has {length}. Split the content into multiple messages.",
    couldNotSaveBeforeSending:
      "The message has not been saved locally and cannot be sent yet. Check the user data folder.",
    pleaseReadAndAnalyzeTheAttachmentsIUploaded:
      "Please read and analyze the attachments I uploaded.",
    theBrowserPreviewHasNoDesktopAgentRuntimeStart:
      "The browser preview has no desktop Agent Runtime. Start the desktop app with pnpm dev.",
    couldNotRestoreHistory: "Could not restore history.",
    theAgentAcceptanceResponseReturnedTheWrongSessionId:
      "The agent acceptance response returned the wrong session ID.",
    theAgentAcceptanceResponseHasADifferentRunId:
      "The agent acceptance response has a different run ID from events already received.",
    theAgentRequestCouldNotBeAccepted:
      "The agent request could not be accepted."
  },
  runStopping: {
    theAgentStopResponseDoesNotMatchTheCurrent:
      "The agent stop response does not match the current run."
  },
  events: {
    multipleRunIdsWereReceivedForTheSameRequest:
      "Multiple run IDs were received for the same request.",
    contextCompactionFailedTheOriginalContextWasPreserved:
      "Context compaction failed: {value}. The original context was preserved.",
    unknownReason: "Unknown reason",
    theParentAgentCompletedButSubtasksDidNotReturn:
      "The parent agent completed, but subtasks did not return their final state.",
    theAgentCompletedButToolCallsDidNotReturn:
      "The agent completed, but tool calls did not return their final state."
  },
  historyLoading: {
    theConversationHistoryIsIncompleteCannotSwitchConversationsTry:
      "The conversation history is incomplete. Cannot switch conversations. Try again.",
    theCurrentStorageDoesNotSupportLoadingThisConversation:
      "The current storage does not support loading this conversation.",
    theActiveConversationHasNotFinishedLoading:
      "The active conversation has not finished loading."
  },
  messageIdentity: {
    theAgentReturnedInconsistentMessageIdsForTheSame:
      "The agent returned inconsistent message IDs for the same run.",
    theAgentMessageIdConflictsWithAnExistingMessage:
      "The agent message ID conflicts with an existing message."
  },
  subagentEvents: {
    theParentAgentEndedUnexpectedlySubtasksWereAlsoStopped:
      "The parent agent ended unexpectedly. Subtasks were also stopped.",
    theSubtaskHasAlreadyEnded: "The subtask has already ended.",
    theSubtaskEndedWithoutReturningAToolResult:
      "The subtask ended without returning a tool result.",
    theSubtaskEndedWithoutAFinalStatus:
      "The delegation ended, but this subtask did not report a final status."
  },
  subagentIdentity: {
    receivingSubtask: "Receiving subtask…"
  },
  historyManagementErrors: {
    couldNotDeleteTheConversationTryAgain:
      "Could not archive the conversation. Try again.",
    conversationDeletionHasNotBeenConfirmedRetryDeletingIt:
      "Archiving has not been confirmed. Retry archiving first. Your new edits remain saved locally."
  },
  persistenceChanges: {
    theConversationContainsNonFiniteNumbersThatCannotBe:
      "The conversation contains non-finite numbers that cannot be saved.",
    theConversationContainsDataTypesThatJsonCannotSave:
      "The conversation contains data types that JSON cannot save.",
    theConversationContainsCircularReferencesAndCannotBeSaved:
      "The conversation contains circular references and cannot be saved.",
    conversationsCanContainOnlyJsonArraysAndPlainObjects:
      "Conversations can contain only JSON arrays and plain objects.",
    aConversationArrayContainsMissingEntriesAndCannotBe:
      "A conversation array contains missing entries and cannot be saved."
  },
  userInput: {
    theUserResponseResultDoesNotMatchTheCurrent:
      "The user response result does not match the current request.",
    couldNotSubmitTheUserResponse: "Could not submit the user response."
  },
  idleTimeout: {
    theAgentHasNotReturnedNewEventsForAn:
      "The agent has not returned new events for an extended period. Try again shortly."
  },
  sendEntrypoints: {
    longFormWriting: "Long-form writing"
  },
  contextCompaction: {
    compactionWasNotCompletedTheRunWasInterrupted:
      "Compaction was not completed. The run was interrupted."
  },
  conversationTextReferences: {
    theReferencedAgentReplyNoLongerExistsItsReference:
      "The referenced agent reply no longer exists. Its reference was removed."
  }
};
