import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  DeviceSyncInitializationInspectionSchema,
  DeviceSyncInitializationMetadataIntentSchema,
  type DeviceSyncWorkspaceRequest,
  type SyncInitializationWorkspacePort,
  type SyncMetadata,
  type SyncMetadataStore
} from "@deepwrite/contracts";
import { writeTextFileDurable } from "@deepwrite/shared/node";

/** Main owns sync metadata; Core owns project files and registry transactions. */
export function createInitializationWorkspace(
  root: string,
  metadata: SyncMetadataStore,
  options: {
    request(input: DeviceSyncWorkspaceRequest): Promise<unknown>;
    workspaceDirectory(): Promise<string | null>;
    busy(): boolean;
    /** The recovery copy and the pending intent are plain files, so their API keys must be sealed first. */
    seal(value: SyncMetadata): Promise<SyncMetadata>;
  }
): {
  initialization: SyncInitializationWorkspacePort;
  recover(): Promise<void>;
} {
  const intentPath = join(root, "device-sync-initialization-metadata.json");
  async function recover(): Promise<void> {
    await options.request({ operation: "recover" });
    let raw: string;
    try {
      raw = await readFile(intentPath, "utf8");
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return;
      throw error;
    }
    const intent = DeviceSyncInitializationMetadataIntentSchema.parse(
      JSON.parse(raw)
    );
    const receipt = DeviceSyncInitializationInspectionSchema.parse(
      await options.request({ operation: "inspect-initialization" })
    );
    // A receipt is only durable with the complete Core registry transaction.
    // If Core never started, the old metadata must remain authoritative.
    if (receipt.lastToken === intent.token)
      await metadata.write(intent.metadata);
    await rm(intentPath);
  }
  return {
    recover,
    initialization: {
      inspect: async () =>
        DeviceSyncInitializationInspectionSchema.parse(
          await options.request({ operation: "inspect-initialization" })
        ),
      replace: async (items, next, expectedFingerprint, signal) => {
        if (options.busy())
          throw new Error("作品正在生成或保存，请完成后再同步。");
        const workspaceDirectory = await options.workspaceDirectory();
        if (!workspaceDirectory) throw new Error("请先选择本机工作目录。");
        if (signal.aborted) throw new Error("同步已取消。");
        const token = randomUUID();
        const previous = await metadata.read();
        if (previous)
          await writeTextFileDurable(
            join(
              root,
              "device-sync-recovery",
              `initialization-metadata-${token}.json`
            ),
            JSON.stringify(await options.seal(previous))
          );
        await writeTextFileDurable(
          intentPath,
          JSON.stringify(
            DeviceSyncInitializationMetadataIntentSchema.parse({
              schemaVersion: 1,
              token,
              metadata: await options.seal(next)
            })
          )
        );
        // Cancellation is checked before entering Core. Once registry publication
        // begins, finish/recover it as one transaction instead of stopping halfway.
        if (signal.aborted) {
          await rm(intentPath);
          throw new Error("同步已取消。");
        }
        if (options.busy()) {
          await rm(intentPath);
          throw new Error("作品正在生成或保存，请完成后再同步。");
        }
        await options.request({
          operation: "replace-initialization",
          token,
          items,
          expectedFingerprint,
          workspaceDirectory
        });
        await recover();
      }
    }
  };
}
