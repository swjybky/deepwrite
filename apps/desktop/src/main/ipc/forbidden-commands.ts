const FORBIDDEN_RENDERER_COMMAND_TYPES = new Set<string>([
  "conversationExport.prepare",
  "agent.prompt",
  "agent.abort",
  "agent.user_input_response",
  "agent.model_test",
  "agent.model_capacity",
  "catalog.createShortBookAtPath",
  "catalog.createScriptBookAtPath",
  "long.createBookAtPath",
  "long.previewLegacySyncAtPath",
  "long.applyLegacySyncAtPath",
  "long.importPortableAtPath",
  "long.previewContinuationImportAtPath",
  "long.importContinuationAtPath",
  "long.openAtPath",
  "catalog.createLibraryAtPath",
  "catalog.createLibraryGroupAtPath",
  "catalog.openProjectAtPath",
  "catalog.importLegacyLibraryAtPath",
  "catalog.installMarketplaceSkillContent"
]);

export function isForbiddenRendererCommand(type: string): boolean {
  return FORBIDDEN_RENDERER_COMMAND_TYPES.has(type);
}
