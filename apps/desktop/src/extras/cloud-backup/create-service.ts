import {
  CommandEnvelopeSchema,
  ListBackupProjectsResultSchema,
  RestoreBackupFilesResultSchema,
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
    type:
      | "catalog.openProjectAtPath"
      | "long.openAtPath"
      | "catalog.restoreBackupFiles"
      | "catalog.listBackupProjects",
    payload: unknown
  ) => {
    const id = createId("cmd_cloud_backup_open");
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(type, payload, { id, correlationId: id })
    );
    const result = await execute(command);
    if (result.status === "rejected") throw new Error(result.error.message);
    return result.payload;
  };
  const config = loadCloudBackupApiConfig();
  return new CloudBackupService(
    userDataPath,
    {
      getWorkspaceDirectory,
      registerCatalogProject: async ({ projectDirectory, domain }) => {
        await register("catalog.openProjectAtPath", {
          projectDirectory,
          domain
        });
      },
      registerLongBook: async (projectDirectory) => {
        await register("long.openAtPath", { projectDirectory });
      },
      restoreFiles: async (input) =>
        RestoreBackupFilesResultSchema.parse(
          await register("catalog.restoreBackupFiles", input)
        ),
      listRegisteredProjects: async () =>
        ListBackupProjectsResultSchema.parse(
          await register("catalog.listBackupProjects", {})
        ).projects
    },
    config ? new DeepwriteApiObjectStore(config, fetchBackup) : null
  );
}
