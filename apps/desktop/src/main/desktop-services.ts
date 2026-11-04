import {
  CatalogInstallMarketplaceSkillContentResultSchema,
  CatalogSnapshotSchema,
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import { app, safeStorage } from "electron";
import { createCloudBackupFeature } from "../extras/cloud-backup/create-service";
import { createDesktopDeviceSync } from "../extras/device-sync";
import type { ConversationSyncLease } from "../extras/device-sync/conversations/lease";
import { AgentTeamConfigStore } from "./agent-team-config-store";
import { AppAlertStore } from "./app-alert-store";
import { AppearanceService } from "./appearance-service";
import { createExtrasAgentService } from "../extras/agents";
import { AgentTeamMarketplaceClient } from "../extras/agent-team-marketplace";
import { FeedbackClient } from "../extras/feedback";
import { GeneralSettingsStore } from "./general-settings-store";
import { VoiceService } from "./voice/voice-service";
import { ImageService } from "./image/image-service";
import { WebSearchService } from "./web-search/web-search-service";
import { testWebSearch } from "./web-search/web-search-tester";
import { imageSmokeOptions } from "./image/image-smoke-transport";
import { CoverRenderService } from "../extras/book-identity/cover-render-service";
import { voiceSmokeOptions } from "./smoke-voice-transport";
import { modelSmokeOptions } from "./smoke-model-config";
import { LibraryAgentConfigStore } from "./library-agent-config-store";
import { LongAgentConfigStore } from "./long-agent-config-store";
import { MarketplaceClient } from "./marketplace-client";
import { ModelConfigStore } from "./model-config-store";
import { ModelUsageStore } from "./model-usage-store";
import { SoftwareTokenUsageReporter } from "./software-token-usage-reporter";
import type { StartupLog } from "./startup-log";
import { UpdateService } from "./update-service";
import { WorkspaceAgentConfigStore } from "./workspace-agent-config-store";
import { WorkspaceDirectoryStore } from "./workspace-directory-store";
import { installationDirectory } from "./installation-directory-guard";

interface DesktopServiceOptions {
  userDataPath: string;
  appVersion: string;
  command: (command: CommandEnvelope) => Promise<CommandResult>;
  busy: () => boolean;
  /** Lets device sync hold the conversations the window has open while it writes them. */
  conversationLease: ConversationSyncLease;
  installUpdate: () => void;
}

/** Construction has no network dependency; optional refreshes start separately. */
export function createDesktopServices(options: DesktopServiceOptions) {
  const { userDataPath, command } = options;
  const modelConfigStore = new ModelConfigStore(userDataPath, {
    appVersion: options.appVersion,
    ...modelSmokeOptions()
  });
  const modelUsageStore = new ModelUsageStore(userDataPath);
  const workspaceDirectoryStore = new WorkspaceDirectoryStore(
    userDataPath,
    installationDirectory(process.execPath)
  );
  const workspaceDirectory = async () =>
    (await workspaceDirectoryStore.list()).path;
  const imageService = new ImageService(
    userDataPath,
    process.env.DEEPWRITE_SMOKE === "1" ? imageSmokeOptions() : undefined
  );
  const webSearchService = new WebSearchService(userDataPath, {
    secureStorage: safeStorage,
    keySources: modelConfigStore,
    tester: testWebSearch
  });
  const agentTeamConfigStore = new AgentTeamConfigStore(userDataPath);
  const marketplaceClient = new MarketplaceClient(userDataPath, {
    loadCatalogSnapshot: async () => {
      const id = createId("cmd_marketplace_snapshot");
      const result = await command(
        CommandEnvelopeSchema.parse(
          createEnvelope("catalog.snapshot", {}, { id, correlationId: id })
        )
      );
      if (result.status === "rejected") throw new Error(result.error.message);
      return CatalogSnapshotSchema.parse(result.payload);
    },
    installPackage: async (input) => {
      const id = createId("cmd_marketplace_install");
      const result = await command(
        CommandEnvelopeSchema.parse(
          createEnvelope("catalog.installMarketplaceSkillContent", input, {
            id,
            correlationId: id
          })
        )
      );
      if (result.status === "rejected") throw new Error(result.error.message);
      return CatalogInstallMarketplaceSkillContentResultSchema.parse(
        result.payload
      );
    }
  });
  return {
    imageService,
    webSearchService,
    coverRenderService: new CoverRenderService(command, imageService),
    modelConfigStore,
    modelUsageStore,
    softwareTokenUsageReporter: new SoftwareTokenUsageReporter(
      userDataPath,
      modelUsageStore
    ),
    workspaceAgentConfigStore: new WorkspaceAgentConfigStore(userDataPath),
    agentTeamConfigStore,
    libraryAgentConfigStore: new LibraryAgentConfigStore(userDataPath),
    longAgentConfigStore: new LongAgentConfigStore(userDataPath),
    extrasAgentService: createExtrasAgentService(userDataPath),
    workspaceDirectoryStore,
    appearanceService: new AppearanceService(userDataPath),
    generalSettingsStore: new GeneralSettingsStore(userDataPath),
    voiceService: new VoiceService(
      userDataPath,
      process.env.DEEPWRITE_SMOKE === "1" ? voiceSmokeOptions() : undefined
    ),
    updateService: new UpdateService(options.installUpdate),
    appAlertStore: new AppAlertStore(userDataPath),
    cloudBackupService: createCloudBackupFeature(
      userDataPath,
      workspaceDirectory,
      command,
      marketplaceClient.fetchBackup.bind(marketplaceClient)
    ),
    deviceSyncService: createDesktopDeviceSync(userDataPath, {
      workspaceDirectory,
      command,
      busy: options.busy,
      models: modelConfigStore,
      conversationLease: options.conversationLease
    }),
    marketplaceClient,
    agentTeamMarketplaceClient: new AgentTeamMarketplaceClient(
      marketplaceClient,
      agentTeamConfigStore
    ),
    feedbackClient: new FeedbackClient(marketplaceClient, {
      version: app.getVersion(),
      platform: process.platform
    })
  };
}

export function refreshDesktopServices(
  services: ReturnType<typeof createDesktopServices>,
  log: StartupLog
): void {
  void services.softwareTokenUsageReporter
    .reportAtStartup()
    .catch((error: unknown) => {
      log.write("usage-report.failed", { error });
    });
  void services.modelConfigStore.initialize().catch((error: unknown) => {
    log.write("model-config.failed", { error });
  });
  void services.modelConfigStore
    .list()
    .then((settings) =>
      services.modelUsageStore.syncConfiguredModels(settings.models)
    )
    .catch((error: unknown) => {
      log.write("model-usage.failed", { error });
    });
}
