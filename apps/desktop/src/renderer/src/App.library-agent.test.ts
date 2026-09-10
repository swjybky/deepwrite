import libraryStagingSource from "./composables/proposal-coordinator/library-staging.ts?raw";
import { describe, expect, it } from "vitest";
import appSource from "./WorkspaceShell.vue?raw";
import coordinatorSource from "./composables/useProposalCoordinator.ts?raw";
import resourceSource from "./composables/useWorkspaceResourceCoordinator.ts?raw";
import eventRoutesSource from "./events/registerWorkspaceSystemEventRoutes.ts?raw";
import settingsCoordinatorSource from "./composables/useSettingsFeatureCoordinator.ts?raw";
import shortConversationSource from "./composables/useShortConversationCoordinator.ts?raw";

describe("library management agent wiring", () => {
  it("routes selected libraries into a bounded management context", () => {
    expect(resourceSource).toContain("activeAgentDocumentForSelection(");
    expect(shortConversationSource).toContain(
      "function libraryEntryReferences("
    );
    expect(shortConversationSource).toContain("按需加载的方法");
    expect(shortConversationSource).toContain(
      "await options.resource.ensureDocumentsLoaded("
    );
    expect(shortConversationSource).toContain(
      "libraryWorkspace: libraryAgentContext"
    );
    expect(shortConversationSource).toContain(
      "const agentDocument = options.resource.activeAgentDocument.value"
    );
  });

  it("stages library tool mutations and persists accepted entry or overview changes", () => {
    expect(eventRoutesSource).toContain(
      'center.subscribe("library.editor_mutation"'
    );
    expect(eventRoutesSource).toContain(
      "dependencies.stageLibraryEditProposal(event)"
    );
    expect(appSource).toContain("stageLibraryEditProposal,");
    expect(coordinatorSource).toContain(
      "currentApi.catalog.saveLibraryEntry({"
    );
    expect(coordinatorSource).toContain(
      "currentApi.catalog.createLibraryEntry({"
    );
    expect(coordinatorSource).toContain(
      "currentLibraryProjectRevisionMatches("
    );
    expect(coordinatorSource).toContain("applySavedLibraryEntry(");
    expect(coordinatorSource).toContain("applyCreatedLibraryEntry(");
    expect(coordinatorSource).toContain("entryId: created.id");
    expect(coordinatorSource).toContain(
      "...(createdDocument ? { documentId: createdDocument.id } : {})"
    );
    expect(libraryStagingSource).toContain(
      'event.payload.operation === "edit-overview"'
    );
    expect(coordinatorSource).toContain(
      'proposal.libraryTarget?.operation === "edit-overview"'
    );
    expect(coordinatorSource).toContain("currentApi.catalog.updateLibrary({");
    expect(coordinatorSource).toContain("applyUpdatedCatalogLibrary(");
  });

  it("loads and saves both library agent settings without loading the catalog again", () => {
    expect(appSource).toContain("loadLibraryAgentSettings,");
    expect(appSource).toContain("saveLibraryAgentSettings,");
    expect(appSource).toContain("resetLibraryAgentSettings,");
    expect(settingsCoordinatorSource).toContain("api.libraryAgents.list()");
    expect(settingsCoordinatorSource).toContain(
      "settingsStore.ensureLibraryAgentsLoaded"
    );
    expect(settingsCoordinatorSource).toContain(
      "api.libraryAgents.save(settings)"
    );
    expect(settingsCoordinatorSource).toContain(
      "api.libraryAgents.reset(domain)"
    );
    expect(settingsCoordinatorSource).not.toMatch(
      /saveLibraryAgentSettings[\s\S]{0,900}catalog\.snapshot\(/u
    );
  });
});
