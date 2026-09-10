import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  DeviceSyncIntentSchema,
  DeviceSyncTitleSchema,
  sameSyncContent,
  stableSyncJson,
  syncKey,
  type SyncItem
} from "@deepwrite/contracts";
import { writeSyncJson as atomicWriteText } from "../extras/device-sync/atomic-json";
import {
  commitProjectTransaction,
  recoverProjectTransaction,
  projectTransactionContentSha256,
  type ProjectTransactionFileOperation
} from "./project-transaction";
import type { FolderCatalogStore } from "./folder-catalog-store";
import type { LongWorkspaceService } from "./long-workspace-service";
import {
  desktopSyncInventory,
  syncRegistrations
} from "./device-sync-inventory";
import {
  readDeviceSyncFiles,
  validateDesktopSyncItem
} from "./device-sync-files";

export class DesktopSyncWorkspace {
  private readonly intentPath: string;
  constructor(
    private readonly userDataPath: string,
    private readonly catalog: () => Promise<FolderCatalogStore>,
    private readonly long: LongWorkspaceService
  ) {
    this.intentPath = join(userDataPath, "device-sync-workspace-intent.json");
  }
  async list() {
    await this.catalog();
    return desktopSyncInventory(this.userDataPath);
  }
  async validate(item: SyncItem) {
    validateDesktopSyncItem(item);
  }
  async recover(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.intentPath, "utf8");
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
    const intent = DeviceSyncIntentSchema.parse(JSON.parse(raw));
    if (!isAbsolute(intent.root)) throw new Error("同步恢复目录无效。");
    const identity = intent.item ?? intent.previous;
    if (!identity || syncKey(identity) !== intent.key)
      throw new Error("同步恢复身份不一致。");
    if (intent.item) {
      validateDesktopSyncItem(intent.item);
      await mkdir(intent.root, { recursive: true });
      await recoverProjectTransaction(intent.root);
      const current = await readDeviceSyncFiles(intent.root);
      if (!sameSyncContent({ ...identity, files: current }, intent.item)) {
        const previousMatches = intent.previous
          ? sameSyncContent(
              { ...intent.previous, files: current },
              intent.previous
            )
          : Object.keys(current).length === 0;
        if (!previousMatches) await this.pauseChangedIntent(identity, current);
        await this.commit(intent.root, current, intent.item);
      }
      await this.register(intent.root, intent.item);
    } else if (intent.removal) {
      const recoveryRelative = relative(
        resolve(this.userDataPath, "device-sync-recovery"),
        resolve(intent.removal)
      );
      if (
        !recoveryRelative ||
        isAbsolute(recoveryRelative) ||
        recoveryRelative.split(sep).includes("..")
      )
        throw new Error("恢复区路径无效。");
      try {
        await lstat(intent.removal);
      } catch (error) {
        if (!(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
        const current = await readDeviceSyncFiles(intent.root);
        if (
          !intent.previous ||
          !sameSyncContent(
            { ...intent.previous, files: current },
            intent.previous
          )
        )
          await this.pauseChangedIntent(identity, current);
        await mkdir(join(this.userDataPath, "device-sync-recovery"), {
          recursive: true
        });
        await rename(intent.root, intent.removal);
      }
      if (identity.kind === "long-book")
        await this.long.unregister({ bookId: identity.id });
      else {
        const domain =
          identity.kind === "material-library"
            ? "material"
            : identity.kind === "skill-library"
              ? "skill"
              : identity.kind;
        await (
          await this.catalog()
        ).unregisterProject({ projectId: identity.id, domain });
      }
    }
    await rm(this.intentPath);
  }
  private async pauseChangedIntent(
    identity: SyncItem,
    files: Record<string, string>
  ): Promise<never> {
    const manifest = DeviceSyncTitleSchema.parse(
      JSON.parse(files["deepwrite.json"] ?? "null")
    );
    validateDesktopSyncItem({ ...identity, title: manifest.title, files });
    const recovery = join(this.userDataPath, "device-sync-paused");
    await mkdir(recovery, { recursive: true });
    await rename(this.intentPath, join(recovery, `${randomUUID()}.json`));
    throw new Error("正文已发生新修改，请重新同步。");
  }
  private async register(root: string, item: SyncItem): Promise<void> {
    if (item.kind === "long-book") await this.long.openAtPath(root);
    else await (await this.catalog()).openCatalogProject(root, item.kind);
  }
  private async commit(
    root: string,
    old: Record<string, string>,
    item: SyncItem
  ): Promise<void> {
    const files = { ...item.files };
    const manifest: unknown = JSON.parse(files["deepwrite.json"] ?? "null");
    if (manifest && typeof manifest === "object" && "revision" in manifest) {
      const previous: unknown = JSON.parse(old["deepwrite.json"] ?? "null");
      const revision =
        previous &&
        typeof previous === "object" &&
        "revision" in previous &&
        typeof previous.revision === "number"
          ? previous.revision
          : 0;
      files["deepwrite.json"] =
        `${stableSyncJson({ ...manifest, revision: revision + 1 })}\n`;
    }
    const operations: ProjectTransactionFileOperation[] = [];
    for (const [path, content] of Object.entries(files))
      operations.push({
        path,
        content,
        expectedSha256:
          old[path] === undefined
            ? null
            : projectTransactionContentSha256(old[path])
      });
    for (const [path, content] of Object.entries(old))
      if (files[path] === undefined)
        operations.push({
          path,
          action: "delete",
          expectedSha256: projectTransactionContentSha256(content)
        });
    await commitProjectTransaction({ projectRoot: root, operations });
  }
  async apply(
    key: string,
    expected: SyncItem | null,
    next: SyncItem | null,
    workspaceDirectory: string
  ): Promise<void> {
    await this.recover();
    if (next) {
      validateDesktopSyncItem(next);
      if (syncKey(next) !== key) throw new Error("同步目标不一致。");
    }
    const registration = (await syncRegistrations(this.userDataPath)).find(
      (entry) => `${entry.kind}:${entry.id}` === key
    );
    const local = registration
      ? ((await desktopSyncInventory(this.userDataPath)).items.find(
          (item) => syncKey(item) === key
        ) ?? null)
      : null;
    if (registration && !local) throw new Error("本机作品不可读，已停止同步。");
    if (!sameSyncContent(local, expected))
      throw new Error("正文已发生新修改，请重新同步。");
    const identity = next ?? local;
    if (!identity) return;
    const parent =
      identity.kind === "book" || identity.kind === "long-book"
        ? "books"
        : identity.kind === "material-library"
          ? "materials"
          : identity.kind === "skill-library"
            ? "skills"
            : identity.kind === "material-group"
              ? "material-groups"
              : "skill-groups";
    if (!isAbsolute(workspaceDirectory))
      throw new Error("请先选择本机工作目录。");
    const root =
      registration?.root ??
      join(
        workspaceDirectory,
        parent,
        `sync-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`
      );
    if (!registration) {
      try {
        await lstat(root);
        throw new Error("同步目录已被占用。");
      } catch (error) {
        if (!(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
      }
    }
    const removal = next
      ? null
      : join(this.userDataPath, "device-sync-recovery", randomUUID());
    await atomicWriteText(
      this.intentPath,
      stableSyncJson({
        schemaVersion: 1,
        key,
        root,
        item: next,
        previous: local,
        removal
      })
    );
    await this.recover();
  }
}
