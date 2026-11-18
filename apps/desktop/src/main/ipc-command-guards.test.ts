import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectSourceToContain } from "../test-utils/sourceText";

describe("IPC command requestId handling", () => {
  it("main preserves raw command id on early rejects and surfaces validation issues", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(source).toContain("function extractCommandRequestId");
    expect(source).toContain("function summarizeCommandValidationIssues");
    expect(source).toContain(
      "const requestId = extractCommandRequestId(rawCommand)"
    );
    expect(source).toContain("mainWindow.isDestroyed()");
    expect(source).not.toContain('requestId: "unknown"');
    expect(source).toContain('return "unknown"');
    expect(source).toContain("Command envelope failed schema validation.");
  });

  it("preload surfaces rejected IPC errors instead of masking them as requestId mismatches", () => {
    const source = readFileSync(
      new URL("../preload/invoke.ts", import.meta.url),
      "utf8"
    );
    expect(source).toContain("const expectedRequestId = command.id");
    expect(source).toContain('if (result.status === "rejected")');
    expect(source).toContain(
      "`IPC result requestId does not match command id. expected=${expectedRequestId} actual=${result.requestId}`"
    );
    expect(source).not.toContain(
      'throw new Error("IPC result requestId does not match command id.");'
    );
  });

  it("routes screenplay creation through preload, main, and the core utility", () => {
    const mainSource = readFileSync(
      new URL("./index.ts", import.meta.url),
      "utf8"
    );
    const preloadSource = readFileSync(
      new URL("../preload/index.ts", import.meta.url),
      "utf8"
    );
    const coreSource = readFileSync(
      new URL("../utilities/core-entry.ts", import.meta.url),
      "utf8"
    );

    expect(preloadSource).toContain("async function createScriptBook");
    expect(preloadSource).toContain('"catalog.createScriptBook"');
    expect(mainSource).toContain('"catalog.createScriptBookAtPath"');
    const creationSource = readFileSync(
      new URL("./ipc/catalog-project-commands.ts", import.meta.url),
      "utf8"
    );
    expect(mainSource).toContain("await handleCatalogProjectCommands(");
    expect(creationSource).toContain("ScriptBookSchema.parse(result.payload)");
    expect(coreSource).toContain(
      'command.type === "catalog.createScriptBookAtPath"'
    );
    expect(coreSource).toContain("catalogStore.createScriptBook(");
    const sessionSource = readFileSync(
      new URL("./ipc/session-commands.ts", import.meta.url),
      "utf8"
    );
    expect(mainSource).toContain("await handleSessionCommands(");
    expect(sessionSource).toContain(
      "command.payload.workspaceContext?.scriptWorkspace"
    );
    expect(sessionSource).toContain("creativeWorkspaceType");
    expectSourceToContain(
      sessionSource,
      "creativeWorkspace, creativeWorkspaceType"
    );
    expect(sessionSource).toContain("{ scriptAgentProfile: agentProfile }");
  });

  it("routes idempotent draft-section batches through preload, main, and core", () => {
    const mainSource = readFileSync(
      new URL("./index.ts", import.meta.url),
      "utf8"
    );
    const preloadSource = readFileSync(
      new URL("../preload/index.ts", import.meta.url),
      "utf8"
    );
    const coreSource = readFileSync(
      new URL("../utilities/core-entry.ts", import.meta.url),
      "utf8"
    );

    expect(preloadSource).toContain("async function createDraftSections");
    expect(preloadSource).toContain('"catalog.createDraftSections"');
    expect(mainSource).toContain(
      'command.type === "catalog.createDraftSections"'
    );
    expect(mainSource).toContain(
      "CreateDraftSectionsResultSchema.parse(result.payload)"
    );
    expect(coreSource).toContain(
      "await catalogStore.createDraftSections(command.payload)"
    );
  });

  it("routes remote model listing through preload and main", () => {
    const mainSource = readFileSync(
      new URL("./index.ts", import.meta.url),
      "utf8"
    );
    const modelCommandSource = readFileSync(
      new URL("./ipc/model-commands.ts", import.meta.url),
      "utf8"
    );
    const preloadModelSource = readFileSync(
      new URL("../preload/session-models-api.ts", import.meta.url),
      "utf8"
    );

    expect(preloadModelSource).toContain("function listRemoteModels");
    expect(preloadModelSource).toContain('"models.listRemote"');
    expect(preloadModelSource).toContain("listRemote: listRemoteModels");
    expect(mainSource).toContain("handleModelCommands(");
    expect(modelCommandSource).toContain(
      'command.type === "models.listRemote"'
    );
    expect(modelCommandSource).toContain("resolveDraftApiKey(");
    expect(modelCommandSource).toContain("ctx.listRemoteModels({");
    expect(modelCommandSource).toContain(
      "RemoteModelListResultSchema.parse({ models })"
    );
    expect(mainSource).toContain("electronRemoteFetch");
    expect(mainSource).toContain("cachedGeneralSettings.useNetworkProxy");
    expect(mainSource).toContain("applyNetworkProxyPreference(");
    expect(mainSource).toContain('restartWorker("agent"');
    const supervisorSource = readFileSync(
      new URL("./supervisor.ts", import.meta.url),
      "utf8"
    );
    expect(supervisorSource).toContain("env: { ...process.env }");
    expect(supervisorSource).toContain("async restartWorker(");
  });

  it("routes model capacity resolution through preload, main, and the agent utility", () => {
    const mainSource = readFileSync(
      new URL("./index.ts", import.meta.url),
      "utf8"
    );
    const modelCommandSource = readFileSync(
      new URL("./ipc/model-commands.ts", import.meta.url),
      "utf8"
    );
    const preloadModelSource = readFileSync(
      new URL("../preload/session-models-api.ts", import.meta.url),
      "utf8"
    );
    const agentSource = readFileSync(
      new URL("../utilities/agent-entry.ts", import.meta.url),
      "utf8"
    );

    expect(preloadModelSource).toContain("function resolveModelCapacity");
    expect(preloadModelSource).toContain('"models.resolveCapacity"');
    expect(preloadModelSource).toContain(
      "resolveCapacity: resolveModelCapacity"
    );
    expect(mainSource).toContain('command.type === "agent.model_capacity"');
    expect(modelCommandSource).toContain(
      'command.type === "models.resolveCapacity"'
    );
    expect(modelCommandSource).toContain('"agent.model_capacity"');
    expect(agentSource).toContain('command.type === "agent.model_capacity"');
    expect(agentSource).toContain("runtime.resolveModelCapacity(");
  });

  it("routes metadata index and on-demand document reads through every boundary", () => {
    const mainSource = readFileSync(
      new URL("./index.ts", import.meta.url),
      "utf8"
    );
    const preloadSource = readFileSync(
      new URL("../preload/index.ts", import.meta.url),
      "utf8"
    );
    const apiSource = readFileSync(
      new URL(
        "../../../../packages/contracts/src/preload-api.ts",
        import.meta.url
      ),
      "utf8"
    );
    const coreSource = readFileSync(
      new URL("../utilities/core-entry.ts", import.meta.url),
      "utf8"
    );
    const initialization = coreSource.slice(
      coreSource.indexOf("async function requireCatalogStore"),
      coreSource.indexOf("async function handleCatalogCommand")
    );

    expect(apiSource).toContain("index(): Promise<CatalogIndexSnapshot>");
    expectSourceToContain(
      apiSource,
      "readDocument(input: CatalogReadDocumentInput): Promise<CatalogReadDocumentResult>"
    );
    expect(preloadSource).toContain("async function getCatalogIndex");
    expect(preloadSource).toContain("async function readCatalogDocument");
    expect(preloadSource).toContain('"catalog.index"');
    expect(preloadSource).toContain('"catalog.readDocument"');
    expect(mainSource).toContain('command.type === "catalog.index"');
    expect(mainSource).toContain('command.type === "catalog.readDocument"');
    expect(mainSource).toContain(
      "CatalogIndexSnapshotSchema.parse(result.payload)"
    );
    expect(mainSource).toContain(
      "CatalogReadDocumentResultSchema.parse(result.payload)"
    );
    expect(coreSource).toContain("await catalogStore.indexSnapshot()");
    expect(coreSource).toContain(
      "await catalogStore.readDocument(command.payload)"
    );
    expect(initialization).toContain(
      "await existingFolderStore.indexSnapshot()"
    );
    expect(initialization).toContain("await folderStore.indexSnapshot()");
    expect(initialization).not.toContain("existingFolderStore.snapshot()");
    expect(initialization).not.toContain("folderStore.snapshot()");
  });

  it("bounds editor index, reads, saves, and snapshots instead of waiting forever", () => {
    const mainSource = readFileSync(
      new URL("./index.ts", import.meta.url),
      "utf8"
    );
    const catalogForwarding = mainSource.slice(
      mainSource.indexOf('command.type === "catalog.index"'),
      mainSource.indexOf("const modelCommandResult")
    );

    expect(catalogForwarding).toContain(
      "catalogCommandTimeoutMs(command.type)"
    );
    expect(catalogForwarding).toContain(
      "error instanceof UtilityCommandTimeoutError"
    );
    expectSourceToContain(
      catalogForwarding,
      'code: timedOut ? "catalog.command_timeout"'
    );
    expect(catalogForwarding).not.toContain(
      'supervisor.requestCommand("core", command, 0)'
    );
  });

  it("routes academic book creation and mutations through preload, main, and core while forbidding direct AtPath from renderer", () => {
    const preloadSource = readFileSync(
      new URL("../preload/index.ts", import.meta.url),
      "utf8"
    );
    const forbiddenSource = readFileSync(
      new URL("./ipc/forbidden-commands.ts", import.meta.url),
      "utf8"
    );
    const creationSource = readFileSync(
      new URL("./ipc/catalog-project-commands.ts", import.meta.url),
      "utf8"
    );
    const catalogCommandsSource = readFileSync(
      new URL("./ipc/catalog-commands.ts", import.meta.url),
      "utf8"
    );
    const coreSource = readFileSync(
      new URL("../utilities/core-entry.ts", import.meta.url),
      "utf8"
    );

    expect(forbiddenSource).toContain('"catalog.createAcademicBookAtPath"');
    expect(preloadSource).toContain('"catalog.createAcademicBook"');
    expect(preloadSource).toContain('"catalog.mutateAcademicFramework"');
    expect(preloadSource).toContain('"catalog.createAcademicReferenceCard"');
    expect(preloadSource).toContain('"catalog.mutateAcademicManuscript"');
    expect(creationSource).toContain('"catalog.createAcademicBookAtPath"');
    expect(creationSource).toContain(
      "AcademicBookSchema.parse(result.payload)"
    );
    expect(catalogCommandsSource).toContain(
      'command.type === "catalog.mutateAcademicFramework"'
    );
    expect(catalogCommandsSource).toContain(
      'command.type === "catalog.mutateAcademicManuscript"'
    );
    expect(coreSource).toContain(
      'command.type === "catalog.createAcademicBookAtPath"'
    );
    expect(coreSource).toContain(
      "await catalogStore.mutateAcademicManuscript(command.payload)"
    );
  });

  it("routes academic manuscript export through preload and both main IPC entrypoints", () => {
    const preloadSource = readFileSync(
      new URL("../preload/index.ts", import.meta.url),
      "utf8"
    );
    const mainSource = readFileSync(
      new URL("./index.ts", import.meta.url),
      "utf8"
    );
    const manuscriptCommandsSource = readFileSync(
      new URL("./ipc/manuscript-commands.ts", import.meta.url),
      "utf8"
    );

    expect(preloadSource).toContain("async function exportAcademicManuscript");
    expect(preloadSource).toContain('"manuscript.exportAcademic"');
    expect(preloadSource).toContain("exportAcademic: exportAcademicManuscript");
    expect(mainSource).toContain(
      'command.type === "manuscript.exportAcademic"'
    );
    expect(mainSource).toContain("await exportAcademicManuscript(");
    expect(manuscriptCommandsSource).toContain(
      'command.type === "manuscript.exportAcademic"'
    );
    expect(manuscriptCommandsSource).toContain(
      "await ctx.exportAcademicManuscript("
    );
  });
});
