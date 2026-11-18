import { readFile, realpath, writeFile } from "node:fs/promises";
import {
  CurrentBookProjectManifestSchema,
  CreativePlotStagesSchema,
  DeviceSyncCatalogRegistrySchema,
  sameSyncContent,
  syncKey,
  type SyncItem
} from "@deepwrite/contracts";
import {
  describe,
  expect,
  it,
  join,
  FolderCatalogStore,
  makeTemporaryRoot
} from "./folder-catalog-store.test-support";
import { DesktopSyncWorkspace } from "./device-sync-workspace";
import { LongWorkspaceService } from "./long-workspace-service";
import { desktopSyncInventory } from "./device-sync-inventory";
import { replaceDesktopInitialization } from "./device-sync-initialization";
import { inspectDesktopInitialization } from "./device-sync-initialization-inspection";

const stage = {
  id: "remote_plot_stage",
  title: "对标书籍剧情细化",
  description: "从另一端同步的自定义阶段"
};

function withStage(item: SyncItem): SyncItem {
  const manifest = CurrentBookProjectManifestSchema.parse(
    JSON.parse(item.files["deepwrite.json"]!)
  );
  if (manifest.bookType === "academic") {
    throw new Error("Expected creative book manifest");
  }
  return {
    ...item,
    files: {
      ...item.files,
      "stages/remote.md": "远端正文必须保留",
      "deepwrite.json": JSON.stringify({
        ...manifest,
        plotStages: [...manifest.plotStages, { ...stage, enabled: true }],
        documents: [
          ...manifest.documents,
          {
            id: stage.id,
            title: stage.title,
            path: "stages/remote.md",
            createdAt: manifest.createdAt,
            updatedAt: manifest.updatedAt
          }
        ]
      })
    }
  };
}

async function setup() {
  const root = await realpath(
    await makeTemporaryRoot("deepwrite-sync-stages-")
  );
  const sourcePath = join(root, "source");
  const source = new FolderCatalogStore({ userDataPath: sourcePath });
  await source.createShortBook({ title: "来源作品", genre: "其他" });
  const original = (await desktopSyncInventory(sourcePath)).items[0]!;
  const incoming = withStage(original);
  const userDataPath = join(root, "target");
  const catalog = new FolderCatalogStore({ userDataPath });
  await catalog.indexSnapshot();
  const workspace = new DesktopSyncWorkspace(
    userDataPath,
    async () => catalog,
    new LongWorkspaceService({ userDataPath })
  );
  const registryPath = join(userDataPath, "catalog-registry.json");
  const readRegistry = async () => {
    const registry = DeviceSyncCatalogRegistrySchema.parse(
      JSON.parse(await readFile(registryPath, "utf8"))
    );
    return {
      ...registry,
      creativePlotStages: CreativePlotStagesSchema.parse(
        registry.creativePlotStages
      )
    };
  };
  return {
    root,
    original,
    incoming,
    userDataPath,
    catalog,
    workspace,
    registryPath,
    readRegistry
  };
}

describe("同步剧情阶段与统一管理目录", () => {
  it.each(["new", "existing", "initialization"] as const)(
    "%s 接收时持久化阶段定义，保持同步内容不变并可按模板创建",
    async (mode) => {
      const {
        root,
        original,
        incoming,
        userDataPath,
        workspace,
        readRegistry
      } = await setup();
      if (mode === "initialization") {
        const inspection = await inspectDesktopInitialization(userDataPath);
        await replaceDesktopInitialization(userDataPath, {
          token: "plot_stage_initialization",
          items: [incoming],
          expectedFingerprint: inspection.fingerprint,
          workspaceDirectory: root
        });
      } else {
        if (mode === "existing")
          await workspace.apply(syncKey(original), null, original, root);
        await workspace.apply(
          syncKey(incoming),
          mode === "existing" ? original : null,
          incoming,
          root
        );
      }
      expect((await readRegistry()).creativePlotStages).toContainEqual(stage);
      const received = (await desktopSyncInventory(userDataPath)).items[0]!;
      expect(sameSyncContent(received, incoming)).toBe(true);
      const restarted = new FolderCatalogStore({ userDataPath });
      const created = await restarted.createScriptBook({
        title: "按模板创建",
        genre: "其他",
        defaultPlotStageIds: [stage.id]
      });
      expect(
        created.resource.plotStages.filter((item) => item.enabled)
      ).toEqual([{ ...stage, enabled: true }]);
      expect(
        created.resource.documents.find((item) => item.id === stage.id)?.content
      ).toBe("");
    }
  );

  it.each(["index", "creation"] as const)(
    "%s 自动修复旧版已同步但未落盘的目录",
    async (entry) => {
      const {
        root,
        incoming,
        userDataPath,
        workspace,
        registryPath,
        readRegistry
      } = await setup();
      await workspace.apply(syncKey(incoming), null, incoming, root);
      const registry = await readRegistry();
      registry.creativePlotStages = registry.creativePlotStages.filter(
        (item) => item.id !== stage.id
      );
      await writeFile(registryPath, JSON.stringify(registry));
      const restarted = new FolderCatalogStore({ userDataPath });
      if (entry === "index") {
        expect(
          (await restarted.indexSnapshot()).creativePlotStages
        ).toContainEqual(stage);
        expect((await readRegistry()).creativePlotStages).toContainEqual(stage);
        const persisted = await readFile(registryPath, "utf8");
        await restarted.indexSnapshot();
        expect(await readFile(registryPath, "utf8")).toBe(persisted);
        expect(
          sameSyncContent(
            (await desktopSyncInventory(userDataPath)).items[0]!,
            incoming
          )
        ).toBe(true);
      }
      const created = await restarted.createShortBook({
        title: "恢复后创建",
        genre: "其他",
        defaultPlotStageIds: [stage.id]
      });
      expect(created.resource.plotStages).toContainEqual({
        ...stage,
        enabled: true
      });
      expect((await readRegistry()).creativePlotStages).toContainEqual(stage);
    }
  );
});
