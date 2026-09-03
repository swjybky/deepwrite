/**
 * Renderer-focused contracts entry.
 *
 * The root barrel also exports Node command and utility schemas. Importing it
 * in the browser evaluates that whole Zod graph. Keep the complete public type
 * surface here, but expose only runtime values that Renderer code uses.
 */
export type * from "./appearance";
export type * from "./app-alert";
export type * from "./agent-team";
export type * from "./agent-team-catalog";
export type * from "./catalog";
export type * from "./chat-assistant";
export type * from "./cloud-backup";
export type * from "./envelope";
export type * from "./expert-draft";
export type * from "./general-settings";
export type * from "./learning-imitation";
export type * from "./library-agent";
export type * from "./long-agent-settings";
export type * from "./long-agent-team";
export type * from "./long-book-analysis";
export type * from "./long-ledger";
export type * from "./long-manuscript-export";
export type * from "./long-workspace";
export type * from "./long-workspace-api";
export type * from "./long-worldbuilding-markdown";
export type * from "./long-workspace-operations";
export type * from "./marketplace";
export type * from "./models";
export type * from "./model-usage";
export type * from "./preload-api";
export type * from "./renderer-state";
export type * from "./session";
export type * from "./skill-markdown";
export type * from "./script-workspace";
export type * from "./script-agent-settings";
export type * from "./short-manuscript-export";
export type * from "./subagent-authoring";
export type * from "./system";
export type * from "./utility";
export type * from "./update";
export type * from "./workspace";
export type * from "./workspace-directory";
export type * from "./writing-context";

export { CHAT_ASSISTANT_PROJECT_PROMPT_MAX_LENGTH } from "./chat-assistant-base";
export { isDeepWriteSiteOfficialModel } from "./models";
export {
  APPEARANCE_CUSTOM_FONT_DISPLAY_NAME_MAX_LENGTH,
  APPEARANCE_CUSTOM_FONT_MAX_COUNT,
  APPEARANCE_CUSTOM_FONT_MAX_FILE_BYTES,
  APPEARANCE_CUSTOM_FONT_MAX_FILES_PER_INSTALL,
  APPEARANCE_CUSTOM_FONT_MAX_TOTAL_BYTES,
  APPEARANCE_FONT_SIZE_LIMITS,
  AppearanceCustomFontFormatSchema,
  AppearanceCustomFontIdSchema,
  AppearanceCustomFontSchema,
  AppearanceEditorFontFamilySchema,
  AppearanceEditorFontSelectionSchema,
  AppearanceFontCatalogSnapshotSchema,
  AppearanceFontInstallResultSchema,
  AppearanceFontRemoveResultSchema,
  AppearanceSettingsSchema,
  AppearanceUiFontFamilySchema,
  AppearanceUiFontSelectionSchema,
  appearanceCustomFontCssFamily,
  appearanceCustomFontSourceUrl,
  createDefaultAppearanceSettings,
  createDefaultAppearanceTheme,
  isAppearanceCustomFontId,
  listAppearanceEditorFontFamilyOptions,
  listAppearanceUiFontFamilyOptions,
  resolveAppearanceEditorFontStack,
  resolveAppearanceUiFontStack
} from "./appearance";
export {
  DEFAULT_AGENT_TEAM_SETTINGS,
  DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS,
  SCRIPT_AGENT_SUBAGENT_MAX_COUNT,
  SHORT_AGENT_SUBAGENT_DESCRIPTION_MAX_LENGTH,
  SHORT_AGENT_SUBAGENT_MAX_COUNT,
  SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH,
  SHORT_AGENT_SUBAGENT_SYSTEM_PROMPT_MAX_LENGTH,
  WorkspaceAgentTeamSettingsInputSchema
} from "./agent-team";
export {
  AGENT_TEAM_PROFILE_NAME_MAX_LENGTH,
  AgentTeamCatalogSnapshotSchema,
  AgentTeamProfileCreateInputSchema,
  AgentTeamProfileRenameInputSchema,
  AgentTeamProfileSaveInputSchema,
  AgentTeamProfileSetEnabledInputSchema,
  AgentTeamProfileTargetInputSchema
} from "./agent-team-catalog";
export {
  CATALOG_LIBRARY_ENTRY_MAX_CHARACTERS,
  CATALOG_LIBRARY_OVERVIEW_MAX_CHARACTERS,
  CatalogIndexSnapshotSchema,
  CatalogSnapshotSchema,
  CharacterStructureMutationSchema,
  MATERIAL_KINDS,
  MaterialStageIdSchema,
  SCRIPT_BOOK_GENRES,
  SHORT_BOOK_GENRES,
  SKILL_KINDS,
  ScriptBookGenreSchema,
  ShortBookGenreSchema,
  SkillStageIdSchema,
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  createCatalogDraftDirectory,
  createDefaultBookPlotStages,
  createDefaultCreativePlotStages,
  isBuiltinCreativePlotStageId,
  parseCatalogDraftDocumentId
} from "./catalog";
export { createEnvelope } from "./envelope";
export {
  DraftSectionTitleSchema,
  parseExpertDraftMarkdown,
  serializeExpertDraftMarkdown
} from "./expert-draft";
export { createDefaultGeneralSettings } from "./general-settings";
export {
  LEARNING_IMITATION_DOCUMENT_MAX_CHARACTERS,
  LEARNING_IMITATION_MAX_DOCUMENTS,
  LEARNING_IMITATION_STAGE_DESCRIPTIONS,
  LEARNING_IMITATION_STAGE_IDS,
  LEARNING_IMITATION_STAGE_LABELS,
  LearningImitationDocumentsSchema,
  LearningImitationResultSchema,
  applyLearningImitationWrite,
  cloneEmptyLearningImitationResult,
  learningImitationStageHasResult
} from "./learning-imitation";
export {
  DEFAULT_LIBRARY_AGENT_PROFILES,
  DEFAULT_LIBRARY_AGENT_SETTINGS,
  DEFAULT_MATERIAL_LIBRARY_AGENT_SKILLS,
  DEFAULT_SKILL_LIBRARY_AGENT_SKILLS,
  LIBRARY_AGENT_DOMAINS,
  LIBRARY_AGENT_ENTRY_MAX_CHARACTERS,
  LIBRARY_AGENT_MAX_ENTRIES,
  LIBRARY_AGENT_MAX_SKILLS,
  LIBRARY_AGENT_OVERVIEW_MAX_CHARACTERS,
  LIBRARY_AGENT_TOTAL_SNAPSHOT_MAX_CHARACTERS,
  LibraryAgentWorkspaceSnapshotSchema
} from "./library-agent";
export {
  DEFAULT_LONG_AGENT_SETTINGS,
  LongAgentSettingsInputSchema
} from "./long-agent-settings";
export {
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  LongAgentTeamSettingsInputSchema
} from "./long-agent-team";
export {
  LONG_BOOK_ANALYSIS_DEFAULT_CONTEXT_WINDOW,
  LONG_BOOK_ANALYSIS_MAX_CHAPTER_CHARACTERS,
  LONG_BOOK_ANALYSIS_MAX_NOTE_CHARACTERS,
  LONG_BOOK_ANALYSIS_MAX_PRESETS,
  LONG_BOOK_ANALYSIS_MAX_PROMPT_CHARACTERS,
  LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS,
  LongBookAnalysisChapterSchema,
  LongBookAnalysisPresetSchema,
  LongBookAnalysisResultSchema,
  LongBookAnalysisSavedSourceCatalogSchema,
  LongBookAnalysisSavedSourceIdSchema,
  LongBookAnalysisSavedSourceSummarySchema,
  LongBookAnalysisSettingsInputSchema,
  LongBookAnalysisSourceSchema
} from "./long-book-analysis";
export {
  LongCommitChapterInputSchema,
  longCommitInputChapterIds,
  longCommitInputCheckpointChapterId
} from "./long-ledger";
export {
  LONG_BOOK_GENRES,
  LONG_CHARACTER_CORE_FOCUS_MAX_CHARACTERS,
  LONG_CHARACTER_FOCUS_MAX_CHARACTERS,
  LONG_CHARACTER_OVERVIEW_FOCUS_MAX_CHARACTERS,
  LONG_DOCUMENT_PAGE_MAX_CHARACTERS,
  LONG_FORESHADOWING_DIRECTORY_MAX_ENTRIES,
  LONG_WORLDBUILDING_DIRECTORY_MAX_CATEGORIES,
  LONG_WORLDBUILDING_DIRECTORY_MAX_ITEMS,
  LONG_WORLDBUILDING_FOCUS_MAX_CHARACTERS,
  LONG_WORLDBUILDING_OVERVIEW_FOCUS_MAX_CHARACTERS,
  LongBookGenreSchema,
  LongWorkspaceRuntimeContextSchema
} from "./long-workspace-api";
export {
  LongWorkspaceImpactConfirmationSchema,
  LongWorkspaceOperationBatchSchema,
  applyLongWorkspaceOperations,
  longWorkspaceImpactIsDestructive,
  longWorkspaceOperationsRequireImpactConfirmation,
  previewLongWorkspaceOperations
} from "./long-workspace-operations";
export { MARKETPLACE_CONTENT_MAX_CHARACTERS } from "./marketplace";
export {
  DEFAULT_LONG_AGENT_PROFILES,
  DEFAULT_LONG_CHARACTER_TYPES,
  LONG_AGENTS_MD_MAX_CHARACTERS,
  LONG_AGENT_IDS,
  LONG_BOOK_LINE_FILE_ID,
  LONG_CHARACTER_OVERVIEW_FILE_ID,
  LONG_CHARACTER_OVERVIEW_PATH,
  LongWorkspaceIndexSnapshotSchema,
  LongWorldbuildingListCategorySchema,
  LongWorldbuildingTextCategorySchema,
  createEmptyLongMarkdownFileReference,
  createLongWorkspaceNavigationSnapshot,
  EMPTY_LONG_LINKED_RESOURCE_STAGE_SCOPES,
  getDefaultLongAgentProfile,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  longLedgerCommitChapterIds,
  longCharacterCoreProfileFileId,
  longCharacterCurrentStateFileId,
  longCharacterFilePath,
  longCharacterHistoryFileId,
  longCharacterRelationshipsFileId,
  longStoryPlotBodyFileId,
  longStoryPlotFilePath,
  longWorldbuildingContentPath,
  longWorldbuildingFileId,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  longLinkedResourceIsEnabledForStage,
  LONG_WORKSPACE_ROOTS,
  resolveLongAgentIdForRoot
} from "./long-workspace";
export {
  BUILT_IN_REASONING_LEVELS,
  DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
  DEFAULT_CUSTOM_MODEL_MAX_TOKENS,
  MODEL_CONTEXT_WINDOW_MAX,
  MODEL_CONTEXT_WINDOW_MIN,
  MODEL_MAX_TOKENS_MAX,
  MODEL_MAX_TOKENS_MIN,
  isDeepSeekWebSearchCompatible
} from "./models";
export {
  DEFAULT_SCRIPT_AGENT_WELCOME_SHORTCUTS,
  DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES,
  DEFAULT_SCRIPT_WORKSPACE_AGENT_SETTINGS,
  ScriptWorkspaceAgentSettingsInputSchema,
  resolveScriptWorkspaceStageReadAccess
} from "./script-agent-settings";
export {
  SCRIPT_WORKSPACE_AGENT_IDS,
  SCRIPT_WORKSPACE_TEXT_STAGE_IDS,
  ScriptWorkspaceSnapshotSchema,
  resolveScriptWorkspaceAgentIdForStage,
  resolveScriptWorkspaceConversationLaneIdForStage
} from "./script-workspace";
export {
  ATTACHED_CONTEXT_MAX_CONTENT_LENGTH,
  ATTACHED_CONTEXT_MAX_ITEMS,
  AgentEvaluationSnapshotSchema,
  LongChapterBodyChangeSchema,
  LongCharacterFileChangeSchema,
  LongMutationProposalEventEnvelopeSchema,
  LongWorldbuildingFileChangeSchema,
  PROMPT_ATTACHMENT_MAX_ITEMS,
  PROMPT_IMAGE_ATTACHMENTS_MAX_BYTES,
  PROMPT_IMAGE_ATTACHMENT_MAX_BYTES,
  PROMPT_TEXT_ATTACHMENTS_MAX_CONTENT_LENGTH,
  PROMPT_TEXT_ATTACHMENT_MAX_CONTENT_LENGTH,
  PromptImageAttachmentSchema,
  PromptTextAttachmentSchema,
  WorkspaceRuntimeContextSchema
} from "./session";
export { parseSkillMarkdown } from "./skill-markdown";
export {
  SUBAGENT_AUTHORING_MAX_SKILLS,
  SUBAGENT_AUTHORING_OUTPUT_MODE_LABELS,
  SUBAGENT_AUTHORING_SKILL_BODY_MAX_LENGTH,
  SubagentAuthoringDraftSchema
} from "./subagent-authoring";
export {
  DEFAULT_SHORT_AGENT_WELCOME_SHORTCUTS,
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
  DEFAULT_SHORT_STAGE_READ_ACCESS,
  SHORT_DEFAULT_PLOT_STAGE_IDS,
  SHORT_WORKSPACE_AGENT_IDS,
  SHORT_WORKSPACE_CONVERSATION_LANE_IDS,
  SHORT_WORKSPACE_STAGE_IDS,
  SHORT_WORKSPACE_TEXT_STAGE_IDS,
  ShortWorkspaceAgentSettingsInputSchema,
  ShortWorkspaceSnapshotSchema,
  createExpertDraftDirectoryRevision,
  createShortWorkspaceContentRevision,
  isProvisionalExpertDraftSectionId,
  resolveShortWorkspaceAgentIdForStage,
  resolveShortWorkspaceConversationLaneIdForStage,
  resolveShortWorkspacePhaseId,
  resolveShortWorkspaceStageReadAccess
} from "./workspace";
export {
  WRITING_CONTEXT_MAX_CHARACTERS,
  writingContextCharacterCount
} from "./writing-context";
