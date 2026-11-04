import {
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import { loadCloudBackupApiConfig } from "./config";
import { DeepwriteApiObjectStore } from "./api-client";
import { CloudBackupService } from "./service";

export function createCloudBackupFeature(
  userDataPath: string,
  getWorkspaceDirectory: () => Promise<string | null>,
  execute: (command: CommandEnvelope) => Promise<CommandResult>,
  fetchBackup: typeof fetch
): CloudBackupService {
  const register = async (
    type: "catalog.openProjectAtPath" | "long.openAtPath",
    payload: unknown
  ) => {
    const id = createId("cmd_cloud_backup_open");
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(type, payload, { id, correlationId: id })
    );
    const result = await execute(command);
    if (result.status === "rejected") throw new Error(result.error.message);
  };
  const config = loadCloudBackupApiConfig();
  return new CloudBackupService(
    userDataPath,
    {
      getWorkspaceDirectory,
      registerCatalogProject: ({ projectDirectory, domain }) =>
        register("catalog.openProjectAtPath", { projectDirectory, domain }),
      registerLongBook: (projectDirectory) =>
        register("long.openAtPath", { projectDirectory })
    },
    config ? new DeepwriteApiObjectStore(config, fetchBackup) : null
  );
}
