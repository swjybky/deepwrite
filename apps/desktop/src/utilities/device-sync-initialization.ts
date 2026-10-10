import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  DeviceSyncCatalogRegistrySchema,
  DeviceSyncInitializationReceiptSchema,
  sameSyncContent,
  stableSyncJson,
  syncDependencies,
  syncKey,
  projectSyncItems,
  type ProjectSyncItem,
  type SyncItem
} from "@deepwrite/contracts";
import { FolderCatalogStore } from "./folder-catalog-store";
import { LongWorkspaceService } from "./long-workspace-service";
import { desktopSyncInventory } from "./device-sync-inventory";
import {
  syncProjectParentFolder,
  validateDesktopSyncItem
} from "./device-sync-files";
import { availableProjectDirectory } from "./folder-catalog-store/paths-io";
import { writeSyncJson } from "../extras/device-sync/atomic-json";
import {
  commitProjectTransaction,
  recoverProjectTransaction,
  projectTransactionContentSha256,
  type ProjectTransactionFileOperation
} from "./project-transaction";
import {
  INITIALIZATION_RECEIPT,
  INITIALIZATION_REGISTRIES,
  inspectDesktopInitialization,
  optionalInitializationFile
} from "./device-sync-initialization-inspection";

/** Build and open all replacement projects before touching the live registries. */
async function stageProjects(
  stateRoot: string,
  projectsRoot: string,
  items: ProjectSyncItem[]
) {
  const catalog = new FolderCatalogStore({ userDataPath: stateRoot });
  const long = new LongWorkspaceService({ userDataPath: stateRoot });
  await catalog.snapshot();
  await long.list();
  for (const item of items) {
    const root = await availableProjectDirectory(
      join(projectsRoot, syncProjectParentFolder(item.kind)),
      item.title
    );
    await mkdir(root, { recursive: true });
    await commitProjectTransaction({
      projectRoot: root,
      operations: Object.entries(item.files).map(([path, content]) => ({
        path,
        content,
        expectedSha256: null
      }))
    });
    if (item.kind === "long-book") await long.openAtPath(root);
    else await catalog.openCatalogProject(root, item.kind);
  }
  const staged = await desktopSyncInventory(stateRoot);
  if (
    staged.issues.length ||
    staged.items.length !== items.length ||
    items.some(
      (item) =>
        !sameSyncContent(
          staged.items.find(
            (candidate) => syncKey(candidate) === syncKey(item)
          ) ?? null,
          item
        )
    )
  ) {
    throw new Error("远端作品不完整或不兼容，请先在来源设备更新并重新上传。");
  }
  const catalogText = await readFile(
    join(stateRoot, "catalog-registry.json"),
    "utf8"
  );
  // Do not import legacy snapshots again after explicitly replacing the catalog.
  const catalogRegistry = DeviceSyncCatalogRegistrySchema.parse(
    JSON.parse(catalogText)
  );
  const catalogNext = stableSyncJson({
    ...catalogRegistry,
    sourceCatalogMigrated: true
  });
  const longNext = await readFile(
    join(stateRoot, "long-project-registry.json"),
    "utf8"
  );
  return [catalogNext, catalogNext, longNext, longNext];
}

/** Called only through the Core command barrier. Old standalone directories stay intact. */
export async function replaceDesktopInitialization(
  userDataPath: string,
  input: {
    token: string;
    items: SyncItem[];
    expectedFingerprint: string;
    workspaceDirectory: string;
  }
): Promise<void> {
  const items = projectSyncItems(input.items);
  if (!items.length)
    throw new Error("来源设备没有可下载的作品或资料，未清除本机数据。");
  for (const item of items) validateDesktopSyncItem(item);
  const keys = new Set(items.map(syncKey));
  if (
    keys.size !== items.length ||
    items.some((item) => syncDependencies(item).some((key) => !keys.has(key)))
  )
    throw new Error(
      "远端作品绑定的资料不完整，请先在来源设备同步全部作品和资料库。"
    );
  if (!isAbsolute(input.workspaceDirectory))
    throw new Error("请先选择本机工作目录。");
  if (
    (await inspectDesktopInitialization(userDataPath)).fingerprint !==
    input.expectedFingerprint
  )
    throw new Error("本机数据已变化，请重新下载预览后确认。");

  const id = randomUUID();
  const recoveryRelative = `device-sync-recovery/initialization-${id}`;
  const recovery = join(userDataPath, recoveryRelative);
  await mkdir(recovery, { recursive: true });
  await mkdir(input.workspaceDirectory, { recursive: true });
  const projects = join(
    await realpath(input.workspaceDirectory),
    `initialized-${id}`
  );
  const originals = await Promise.all(
    INITIALIZATION_REGISTRIES.map((path) =>
      optionalInitializationFile(join(userDataPath, path))
    )
  );
  // These are durable registry backups pointing to the untouched old folders,
  // including broken registrations. They do not require readable old manifests.
  for (const [index, path] of INITIALIZATION_REGISTRIES.entries()) {
    const value = originals[index];
    if (value != null) await writeSyncJson(join(recovery, path), value);
  }
  await writeSyncJson(
    join(recovery, "README.txt"),
    "初始化前的作品目录未被删除或覆盖。此处注册表记录了原目录位置。新作品位于独立 initialized-* 目录；需要恢复旧作品时可重新打开原目录。不要在应用运行时直接替换注册表。\n"
  );
  const next = await stageProjects(
    join(recovery, "staged-registry"),
    projects,
    items
  );
  if (
    (await inspectDesktopInitialization(userDataPath)).fingerprint !==
    input.expectedFingerprint
  )
    throw new Error("本机数据已变化，请重新下载预览后确认。");
  const operations: ProjectTransactionFileOperation[] =
    INITIALIZATION_REGISTRIES.map((path, index) => ({
      path,
      content: next[index]!,
      expectedSha256:
        originals[index] == null
          ? null
          : projectTransactionContentSha256(originals[index])
    }));
  const previousReceipt = await optionalInitializationFile(
    join(userDataPath, INITIALIZATION_RECEIPT)
  );
  operations.push({
    path: INITIALIZATION_RECEIPT,
    content: stableSyncJson(
      DeviceSyncInitializationReceiptSchema.parse({
        schemaVersion: 1,
        token: input.token,
        recoveryDirectory: recoveryRelative
      })
    ),
    expectedSha256:
      previousReceipt === null
        ? null
        : projectTransactionContentSha256(previousReceipt)
  });
  // Existing durable transaction recovery finishes all registry replacements
  // and the receipt together before Core accepts the next command.
  await commitProjectTransaction({ projectRoot: userDataPath, operations });
}

export async function recoverDesktopInitialization(
  userDataPath: string
): Promise<void> {
  try {
    await access(join(userDataPath, ".deepwrite", "transaction.json"));
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
  await recoverProjectTransaction(userDataPath);
}
