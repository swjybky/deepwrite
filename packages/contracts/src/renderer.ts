export {
  BUILTIN_AGENT_METADATA,
  DEFAULT_LONG_AGENT_WELCOME_SHORTCUTS
} from "./builtin-agent-metadata";
export { ErrorPayloadSchema } from "./error-payload";
/**
 * Renderer-focused contracts entry.
 *
 * The root barrel also exports Node command and utility schemas. Importing it
 * in the browser evaluates that whole Zod graph. Keep the complete public type
 * surface here, but expose only runtime values that Renderer code uses.
 */
export type * from "./book-templates";
export { DEFAULT_NEW_BOOK_ENABLED_PLOT_STAGE_IDS } from "./catalog";
export { loadBookTemplateDraftSchema } from "./load-book-template-schema";
export type * from "./appearance";
export type * from "./voice";
export {
  createDefaultVoiceSettings,
  VOICE_PROFILE_DEFAULTS,
  VOICE_MAX_DURATION_MS,
  VOICE_MAX_BASE64_LENGTH,
  VoiceSettingsInputSchema
} from "./voice";
export type * from "./app-alert";
export type * from "./agent-team";
export type * from "./agent-team-catalog";
export type * from "./agent-team-marketplace";
export type * from "./catalog";
export type * from "./chat-assistant";
export type * from "./cloud-backup";
export type * from "./envelope";
export type * from "./expert-draft";
export type * from "./general-settings";
export type * from "./more-features-settings";
export type * from "./storage-settings";
export {
  StorageLocationSchema,
  StorageSettingsSnapshotSchema,
  StorageDirectoryKindSchema,
  StorageChangeResultSchema
} from "./storage-settings";
export type * from "./body-text-format";
export type * from "./library-agent";
export type * from "./long-agent-settings";
export type * from "./long-agent-team";
export type * from "./long-book-analysis";
export type * from "./long-book-decomposition";
export {
  DEFAULT_DECOMPOSITION_PROFILE,
  LongBookDecompositionProfileSchema
} from "./long-book-decomposition/profile";
export {
  splitDecompositionChunks,
  decompositionInputBudget
} from "./long-book-decomposition/chunking";
export { estimateDecomposition } from "./long-book-decomposition/estimate";
export {
  decompositionUsageLimit,
  decompositionUsageTotal
} from "./long-book-decomposition/usage";
export {
  decompositionTaskUnitIds,
  readyDecompositionUnitIds
} from "./long-book-decomposition/job";
export { decompositionAssetProse } from "./long-book-decomposition/records";
export type * from "./short-book-analysis";
export {
  ShortBookAnalysisPresetSchema,
  ShortBookAnalysisRuntimeContextSchema
} from "./short-book-analysis";
export * from "./short-book-analysis-budget";
export * from "./token-estimate";
export type * from "./style-comparison";
export {
  STYLE_COMPARISON_TEXT_LIMIT,
  STYLE_COMPARISON_METHOD_LIMIT,
  StyleComparisonInputSchema,
  StyleComparisonDimensionSchema,
  StyleComparisonResultSchema,
  StyleComparisonRuntimeContextSchema
} from "./style-comparison";
export { latestCommittedContinuityChapter } from "./long-workspace/latest-continuity";
export type * from "./long-material-pack";
export type * from "./library-package";
export {
  assignLibraryPackageGroup,
  libraryPackageKinds,
  nextLibraryPackageTitle,
  resolveLibraryPackageStage
} from "./library-package/resolve";
export {
  DEFAULT_LONG_MATERIAL_PACK_OPTIONS,
  LONG_MATERIAL_DEFAULT_SAMPLE_CHAPTERS,
  LONG_MATERIAL_GUIDE_MIN_CONTEXT_WINDOW,
  LONG_MATERIAL_SAMPLE_CHAPTER_LIMIT,
  LONG_MATERIAL_SECTIONS
} from "./long-material-pack/constants";
export type * from "./extras-agent";
// Use the defining modules: the extras-agent barrel also evaluates its tasks.
export { ExtrasAgentSettingsInputSchema } from "./extras-agent/profiles";
export { assertExtrasAgentBudget } from "./extras-agent/budget";
export { loadDefaultStyleComparisonMethod } from "./load-style-comparison-method";
export type * from "./long-ledger";
export type * from "./long-manuscript-export";
export type * from "./long-workspace";
export type * from "./long-workspace-api";
export type * from "./long-workspace-commands";
export type * from "./long-project-recovery";
export type * from "./long-worldbuilding-markdown";
export type * from "./long-workspace-operations";
export type * from "./marketplace";
export type * from "./material-markdown";
export type * from "./material-query";
export { MATERIAL_STAGE_KINDS } from "./material-stages";
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

export {
  CHAT_ASSISTANT_ROLEPLAY_PROMPT_SUFFIX,
  CHAT_ASSISTANT_PROJECT_PROMPT_MAX_LENGTH,
  chatAssistantProjectKey
} from "./chat-assistant-base";
export {
  CHAT_PROJECT_DEFAULT_PROFILE_ID,
  ChatRoleplayProfileSchema
} from "./extras-agent/chat";
export {
  parseMaterialMarkdown,
  resolveMaterialMetadata
} from "./material-markdown";
export { updateMaterialMarkdownMetadata } from "./material-markdown-edit";
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
  LONG_AGENT_SUBAGENT_MAX_COUNT,
  SHORT_AGENT_SUBAGENT_DESCRIPTION_MAX_LENGTH,
  SHORT_AGENT_SUBAGENT_MAX_COUNT,
  SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH,
  SHORT_AGENT_SUBAGENT_SYSTEM_PROMPT_MAX_LENGTH,
  SUBAGENT_PARALLEL_MAX_CONCURRENCY,
  DEFAULT_SUBAGENT_DRAW_EVALUATOR_PROMPT,
  SUBAGENT_DRAW_DEFAULT_COUNT,
  SUBAGENT_DRAW_EVALUATOR_PROMPT_MAX_LENGTH,
  SUBAGENT_DRAW_MAX_COUNT,
  SUBAGENT_DRAW_MIN_COUNT,
  activeSubagentDraw,
  WorkspaceAgentTeamSettingsInputSchema
} from "./agent-team";
export {
  AGENT_TEAM_PROFILE_NAME_MAX_LENGTH,
  AgentTeamCatalogSnapshotSchema,
  AgentTeamProfileCreateInputSchema,
  AgentTeamProfileRenameInputSchema,
  AgentTeamProfileSaveInputSchema,
  AgentTeamProfileSetEnabledInputSchema,
  AgentTeamProfileTargetInputSchema,
  withAgentTeamEnabled
} from "./agent-team-catalog";
export {
  AGENT_TEAM_MARKETPLACE_OVERVIEW_MAX_LENGTH,
  agentTeamCustomModelCount,
  agentTeamMemberCount
} from "./agent-team-marketplace";
export {
  CATALOG_LIBRARY_ENTRY_MAX_CHARACTERS,
  CATALOG_LIBRARY_OVERVIEW_MAX_CHARACTERS,
  CATALOG_PROJECT_MAX_CONTENT_ITEMS,
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
export {
  createDefaultGeneralSettings,
  maxTextAttachmentCharactersForBudget
} from "./general-settings";
export {
  MORE_FEATURE_IDS,
  MoreFeaturesSettingsSchema,
  createDefaultMoreFeaturesSettings
} from "./more-features-settings";
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
  LongBookAnalysisSourceSchema
} from "./long-book-analysis";
export {
  LongCommitChapterInputSchema,
  longCommitInputChapterIds,
  longCommitInputCheckpointChapterId
} from "./long-ledger";
export {
  LONG_CHARACTER_CORE_FOCUS_MAX_CHARACTERS,
  LONG_CHARACTER_FOCUS_MAX_CHARACTERS,
  LONG_CHARACTER_OVERVIEW_FOCUS_MAX_CHARACTERS,
  LONG_DOCUMENT_PAGE_MAX_CHARACTERS,
  LONG_FORESHADOWING_DIRECTORY_MAX_ENTRIES,
  LONG_WORLDBUILDING_DIRECTORY_MAX_CATEGORIES,
  LONG_WORLDBUILDING_DIRECTORY_MAX_ITEMS,
  LONG_WORLDBUILDING_FOCUS_MAX_CHARACTERS,
  LONG_WORLDBUILDING_OVERVIEW_FOCUS_MAX_CHARACTERS
} from "./long-workspace-limits";
export { LONG_BOOK_GENRES, LongBookGenreSchema } from "./long-book-genres";
export { LongWorkspaceRuntimeContextSchema } from "./long-workspace-runtime/context";
export {
  LongWorkspaceImpactConfirmationSchema,
  LongWorkspaceOperationBatchSchema,
  applyLongWorkspaceOperations,
  previewLongWorkspaceOperations
} from "./long-workspace-operations";
export {
  longWorkspaceImpactIsDestructive,
  longWorkspaceOperationsRequireImpactConfirmation
} from "./long-workspace-operations/impact-policy";
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
  ScriptWorkspaceAgentSettingsInputSchema
} from "./script-agent-settings";
export {
  SCRIPT_WORKSPACE_AGENT_IDS,
  SCRIPT_WORKSPACE_TEXT_STAGE_IDS,
  ScriptWorkspaceSnapshotSchema,
  resolveScriptWorkspaceAgentIdForStage,
  resolveScriptWorkspaceConversationLaneIdForStage
} from "./script-workspace";
// Use the defining modules: the session barrel also evaluates Agent commands.
export {
  ATTACHED_CONTEXT_MAX_CONTENT_LENGTH,
  ATTACHED_CONTEXT_MAX_ITEMS,
  WorkspaceRuntimeContextSchema
} from "./session/runtime";
export { AgentEvaluationSnapshotSchema } from "./session/evaluation";
export {
  CONTEXT_COMPACTION_BUDGET_MAX_TOKENS,
  CONTEXT_COMPACTION_BUDGET_MIN_TOKENS,
  CONTEXT_COMPACTION_INSTRUCTIONS_MAX_LENGTH,
  DEFAULT_CONTEXT_COMPACTION_BUDGET_TOKENS,
  createDefaultContextCompactionSettings
} from "./session/context-compaction-defaults";
export { ConversationCheckpointSchema } from "./session/context-compaction-state";
export {
  LongChapterBodyChangeSchema,
  LongCharacterFileChangeSchema,
  LongWorldbuildingFileChangeSchema
} from "./session/long-proposals";
export { LongMutationProposalEventEnvelopeSchema } from "./session/envelopes";
export {
  SUBAGENT_DRAW_QUESTION_ID,
  SUBAGENT_DRAW_REJECT_OPTION_ID
} from "./session/user-input";
export {
  PROMPT_ATTACHMENT_MAX_ITEMS,
  PROMPT_IMAGE_ATTACHMENTS_MAX_BYTES,
  PROMPT_IMAGE_ATTACHMENT_MAX_BYTES,
  PROMPT_TEXT_ATTACHMENTS_MAX_CONTENT_LENGTH,
  PROMPT_TEXT_ATTACHMENT_DEFAULT_CONTENT_LENGTH,
  PROMPT_TEXT_ATTACHMENT_MAX_CONTENT_LENGTH,
  PromptImageAttachmentSchema,
  PromptTextAttachmentSchema
} from "./session/attachments";
export { parseSkillMarkdown } from "./skill-markdown";
export {
  readSkillMarkdownMetadata,
  updateSkillMarkdownMetadata
} from "./skill-markdown-edit";
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
  resolveShortWorkspacePhaseId
} from "./workspace";
export {
  WRITING_CONTEXT_MAX_CHARACTERS,
  writingContextCharacterCount
} from "./writing-context";

export type * from "./builtin-subagents";
export type * from "./library-management";
export type * from "./library-management-scope";
export {
  BUILTIN_SUBAGENT_NAMES,
  BuiltinSubagentSettingsSchema,
  defaultBuiltinSubagentSettings
} from "./builtin-subagents";

export { LibraryManagementScopeSchema } from "./library-management-scope";

export type * from "./device-sync";
export { syncRequestSchema } from "./device-sync/api";
export { syncIssueSchema } from "./device-sync/schemas";
export {
  syncConfigSchema,
  syncJoinCodeSchema
} from "./device-sync/connection-schemas";
export { syncVersionPreview, resolveSyncVersion } from "./device-sync/preview";

export type * from "./conversation-history";
export {
  CONVERSATION_HISTORY_PAGE_BYTES,
  CONVERSATION_HISTORY_BATCH_BYTES,
  CONVERSATION_HISTORY_TEXT_CHUNK_SIZE
} from "./conversation-history-limits";
export { conversationHistoryJsonBytes } from "./conversation-history-json-size";

export type * from "./conversation-export";

export * from "./revision-analysis";

export * from "./revision-analysis-defaults";
export * from "./revision-analysis-budget";

export type * from "./text-context-menu";

export * from "./marketplace-email";

export {
  MarketplaceLoginInputSchema,
  MarketplaceRegisterInputSchema
} from "./marketplace";

export { compareVersions } from "./update-version";

export type { WindowFrameAction, WindowFrameState } from "./window-frame";

export {
  SESSION_CONVERSATION_HISTORY_MAX_MESSAGES,
  SESSION_CONVERSATION_HISTORY_MAX_MESSAGE_LENGTH,
  SESSION_CONVERSATION_HISTORY_MAX_CONTENT_LENGTH
} from "./session/history-limits";

export * from "./book-identity";
export * from "./image-models";
export * from "./https-base-url";
export { ChatAssistantProjectRefSchema } from "./chat-assistant-base";
export { ExtrasAgentTaskSchema } from "./extras-agent/tasks";
