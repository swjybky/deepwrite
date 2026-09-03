import { describe, expect, it } from "vitest";
import appSource from "./WorkspaceShell.vue?raw";
import coordinatorSource from "./composables/useProposalCoordinator.ts?raw";

describe("App character structure agent approvals", () => {
  it("stages character file and structure proposals through the shared review flow", () => {
    expect(coordinatorSource).toContain(
      'mutationTarget?.kind === "character-structure"'
    );
    expect(coordinatorSource).toContain(
      'mutationTarget?.kind === "character-file"'
    );
    expect(coordinatorSource).toContain("characterStructureTarget: {");
    expect(coordinatorSource).toContain("acceptCharacterStructureProposal(");
    expect(coordinatorSource).toContain(
      "await currentApi.catalog.mutateCharacterStructure({"
    );
    expect(coordinatorSource).toContain("provisionalCharacterItemId");
    expect(coordinatorSource).toContain(
      "findPendingCharacterCreationForProvisional("
    );
    expect(coordinatorSource).toContain(
      'target.mutation.type === "createItem" && !createdItemId'
    );
    expect(coordinatorSource).toContain(
      "document.catalogDocumentId === createdItemId"
    );
    expect(coordinatorSource).toContain("force: true");
    expect(coordinatorSource).toContain("await loadCatalogSnapshot()");
    expect(appSource).toContain("useLazyProposalCoordinator({");
  });
});
