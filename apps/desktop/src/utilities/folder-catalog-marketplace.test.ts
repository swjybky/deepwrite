import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MarketplaceInstallPackage } from "@deepwrite/contracts";
import { FolderCatalogStore } from "./folder-catalog-store";

const NOW = "2026-08-11T08:00:00.000Z";
const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-marketplace-install-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

function singlePackage(version = 1): MarketplaceInstallPackage {
  return {
    source: { contentType: "skill", contentId: "remote-skill", version },
    title: "转折留白",
    overview: "在转折前控制节奏",
    createGroup: false,
    buckets: [
      {
        kind: "style",
        libraryType: "short",
        availableLibraryTypes: ["short"],
        entries: [
          {
            marketplaceSkillId: "remote-skill",
            title: "转折留白",
            stageId: "draft",
            content: "转折前先留出一个短场景。"
          }
        ]
      }
    ]
  };
}

describe("FolderCatalogStore marketplace installation", () => {
  it("installs a single skill into the selected existing skill library", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: () => NOW
    });
    const target = await store.createLibrary({
      domain: "skill",
      name: "我的文风库",
      libraryType: "short",
      skillKind: "style"
    });
    const input = {
      ...singlePackage(),
      targetLibraryId: target.resource.id
    };

    const installed = await store.installMarketplaceSkillContent(input);
    const duplicate = await store.installMarketplaceSkillContent(input);
    const snapshot = await store.snapshot();
    const library = snapshot.skills.find(
      ({ id }) => id === target.resource.id
    )!;

    expect(installed).toMatchObject({
      alreadyInstalled: false,
      libraryIds: [target.resource.id],
      title: "转折留白"
    });
    expect(duplicate).toMatchObject({
      alreadyInstalled: true,
      libraryIds: [target.resource.id]
    });
    expect(snapshot.skills).toHaveLength(1);
    expect(library.title).toBe("我的文风库");
    expect(library.entries[0]).toMatchObject({
      title: "转折留白",
      body: "转折前先留出一个短场景。",
      marketplaceSource: {
        contentType: "skill",
        contentId: "remote-skill",
        version: 1,
        installedAt: NOW
      }
    });
  });

  it("installs a single skill atomically and disables the same remote version", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: () => NOW
    });

    const installed =
      await store.installMarketplaceSkillContent(singlePackage());
    const duplicate =
      await store.installMarketplaceSkillContent(singlePackage());
    const snapshot = await store.snapshot();
    const library = snapshot.skills.find(
      ({ id }) => id === installed.libraryIds[0]
    )!;

    expect(installed).toMatchObject({
      alreadyInstalled: false,
      source: { contentType: "skill", id: "remote-skill" },
      version: 1
    });
    expect(duplicate).toMatchObject({
      alreadyInstalled: true,
      libraryIds: installed.libraryIds
    });
    expect(snapshot.skills).toHaveLength(1);
    expect(library).toMatchObject({
      title: "转折留白",
      marketplaceSource: {
        contentType: "skill",
        contentId: "remote-skill",
        version: 1,
        installedAt: NOW
      },
      entries: [
        {
          title: "转折留白",
          body: "转折前先留出一个短场景。",
          sourceSkillId: "remote-skill"
        }
      ]
    });
  });

  it("installs a newer version as a deterministic independent copy", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: () => NOW
    });
    await store.installMarketplaceSkillContent(singlePackage(1));
    const next = await store.installMarketplaceSkillContent(singlePackage(2));
    const snapshot = await store.snapshot();

    expect(next.alreadyInstalled).toBe(false);
    expect(snapshot.skills.map(({ title }) => title)).toEqual([
      "转折留白",
      "转折留白 (2)"
    ]);
    expect(
      snapshot.skills.map(({ marketplaceSource }) => marketplaceSource?.version)
    ).toEqual([1, 2]);
  });

  it("buckets a mixed group into ordered local libraries and creates a source group", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: () => NOW
    });
    const input: MarketplaceInstallPackage = {
      source: { contentType: "group", contentId: "remote-group", version: 3 },
      title: "完整工作流",
      overview: "混合分类技能组",
      createGroup: true,
      buckets: [
        {
          kind: "plot",
          libraryType: "long",
          availableLibraryTypes: ["short", "long"],
          entries: [
            {
              marketplaceSkillId: "p1",
              title: "因果",
              stageId: "plot_design",
              content: "一"
            },
            {
              marketplaceSkillId: "p2",
              title: "因果",
              stageId: "outline",
              content: "二"
            }
          ]
        },
        {
          kind: "style",
          libraryType: "script",
          availableLibraryTypes: ["script"],
          entries: [
            {
              marketplaceSkillId: "s1",
              title: "对白",
              stageId: "draft",
              content: "三"
            }
          ]
        }
      ]
    };

    const result = await store.installMarketplaceSkillContent(input);
    const snapshot = await store.snapshot();
    const group = snapshot.skillGroups.find(({ id }) => id === result.groupId)!;
    const plot = snapshot.skills.find(
      ({ id, skillKind }) =>
        group.memberIds.includes(id) && skillKind === "plot"
    )!;
    const style = snapshot.skills.find(
      ({ id, skillKind }) =>
        group.memberIds.includes(id) && skillKind === "style"
    )!;

    expect(result.libraryIds).toHaveLength(2);
    expect(group.marketplaceSource).toMatchObject({
      contentType: "group",
      contentId: "remote-group",
      version: 3
    });
    expect(plot).toMatchObject({
      skillType: "long",
      skillKind: "plot",
      marketplaceSource: { bucketKind: "plot" }
    });
    expect(
      plot.entries.map(({ title, sourceSkillId }) => [title, sourceSkillId])
    ).toEqual([
      ["因果", "p1"],
      ["因果 (2)", "p2"]
    ]);
    expect(style).toMatchObject({ skillType: "script", skillKind: "style" });
  });

  it("removes every new directory when a later bucket write fails", async () => {
    const root = await temporaryRoot();
    const userDataPath = join(root, "user-data");
    const store = new FolderCatalogStore({
      userDataPath,
      now: () => NOW,
      maxMarkdownBytes: 5
    });
    const input: MarketplaceInstallPackage = {
      source: { contentType: "group", contentId: "failure-group", version: 1 },
      title: "失败测试",
      overview: "",
      createGroup: true,
      buckets: [
        {
          kind: "plot",
          libraryType: "short",
          availableLibraryTypes: ["short"],
          entries: [
            {
              marketplaceSkillId: "ok",
              title: "短",
              stageId: "draft",
              content: "ok"
            }
          ]
        },
        {
          kind: "style",
          libraryType: "short",
          availableLibraryTypes: ["short"],
          entries: [
            {
              marketplaceSkillId: "fail",
              title: "长",
              stageId: "draft",
              content: "too-long"
            }
          ]
        }
      ]
    };

    await expect(store.installMarketplaceSkillContent(input)).rejects.toThrow(
      /Markdown/u
    );
    expect((await store.snapshot()).skills).toEqual([]);
    const skillDirectory = store.defaultProjectParents["skill-library"];
    expect(await readdir(skillDirectory).catch(() => [])).toEqual([]);
  });

  it("removes promoted projects when the registry commit fails", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: () => NOW
    });
    await store.snapshot();

    const mutableStore = store as unknown as {
      writeRegistry: (...args: unknown[]) => Promise<void>;
    };
    const originalWriteRegistry = mutableStore.writeRegistry.bind(store);
    mutableStore.writeRegistry = async () => {
      throw new Error("invalid test registry failure");
    };

    await expect(
      store.installMarketplaceSkillContent(singlePackage())
    ).rejects.toThrow("invalid test registry failure");
    mutableStore.writeRegistry = originalWriteRegistry;

    expect((await store.snapshot()).skills).toEqual([]);
    const skillDirectory = store.defaultProjectParents["skill-library"];
    expect(await readdir(skillDirectory).catch(() => [])).toEqual([]);
  });
});
