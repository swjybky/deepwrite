import {
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import { CloudBackupService } from "./service";

export function createCloudBackupFeature(
  userDataPath: string,
  getWorkspaceDirectory: () => Promise<string | null>,
  execute: (command: CommandEnvelope) => Promise<CommandResult>
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
  return new CloudBackupService(userDataPath, {
    getWorkspaceDirectory,
    registerCatalogProject: ({ projectDirectory, domain }) =>
      register("catalog.openProjectAtPath", { projectDirectory, domain }),
    registerLongBook: (projectDirectory) =>
      register("long.openAtPath", { projectDirectory })
  });
}
