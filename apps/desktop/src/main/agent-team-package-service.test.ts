import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, Dialog } from "electron";
import { DEFAULT_AGENT_TEAM_SETTINGS } from "@deepwrite/contracts";
import { AgentTeamConfigStore } from "./agent-team-config-store";
import { createAgentTeamPackage } from "./agent-team-package-archive";
import {
  AGENT_TEAM_CONFIG_MAX_BYTES,
  readAgentTeamPackageJson
} from "./agent-team-package-json";
import {
  downloadAgentTeamPackage,
  installAgentTeamPackage
} from "./agent-team-package-service";

const roots = new Set<string>();

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-agent-team-package-"));
  roots.add(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    [...roots].map((root) => rm(root, { recursive: true, force: true }))
  );
  roots.clear();
});

describe("agent team package service", () => {
  it("downloads JSON by default and imports it as a separate disabled copy", async () => {
    const root = await temporaryRoot();
    const store = new AgentTeamConfigStore(root);
    const source = (await store.list()).teams[0]!;
    const before = await store.setEnabled({ teamId: source.id, enabled: true });
    const jsonPath = join(root, "团队.deepwrite-team.json");
    const showSaveDialog = vi
      .fn()
      .mockResolvedValue({ canceled: false, filePath: jsonPath });
    const showOpenDialog = vi
      .fn()
      .mockResolvedValue({ canceled: false, filePaths: [jsonPath] });
    const dialog = { showSaveDialog, showOpenDialog } as unknown as Pick<
      Dialog,
      "showOpenDialog" | "showSaveDialog"
    >;
    const window = {} as BrowserWindow;

    await downloadAgentTeamPackage(
      window,
      dialog,
      store,
      { teamId: source.id },
      root
    );
    expect(showSaveDialog).toHaveBeenCalledWith(
      window,
      expect.objectContaining({
        defaultPath: join(root, `${source.name}.deepwrite-team.json`),
        filters: expect.arrayContaining([
          expect.objectContaining({ extensions: ["json"] }),
          expect.objectContaining({ extensions: ["zip"] })
        ])
      })
    );
    expect(readAgentTeamPackageJson(await readFile(jsonPath))).toEqual(source);

    const result = await installAgentTeamPackage(window, dialog, store, root);
    expect(showOpenDialog).toHaveBeenCalledWith(
      window,
      expect.objectContaining({
        filters: expect.arrayContaining([
          expect.objectContaining({ extensions: ["json", "zip"] })
        ]),
        properties: ["openFile"]
      })
    );
    expect(result.status).toBe("installed");
    if (result.status !== "installed")
      throw new Error("Expected an imported team");
    expect(result.teamId).not.toBe(source.id);
    expect(result.teamName).toBe(`${source.name} (2)`);
    expect(result.catalog.enabledTeamIds).toEqual(before.enabledTeamIds);
    expect(
      result.catalog.teams.find(({ id }) => id === result.teamId)?.settings
    ).toEqual(source.settings);
    expect(await new AgentTeamConfigStore(root).list()).toEqual(result.catalog);
  });

  it.each(["profile", "settings"])(
    "imports an uppercase JSON extension containing %s",
    async (shape) => {
      const root = await temporaryRoot();
      const store = new AgentTeamConfigStore(root);
      const path = join(root, "文件名团队.JSON");
      const raw =
        shape === "profile"
          ? {
              name: "手写团队",
              workspaceType: "short",
              settings: DEFAULT_AGENT_TEAM_SETTINGS
            }
          : DEFAULT_AGENT_TEAM_SETTINGS;
      await writeFile(path, `\ufeff${JSON.stringify(raw)}`, "utf8");
      const dialog = {
        showOpenDialog: vi
          .fn()
          .mockResolvedValue({ canceled: false, filePaths: [path] })
      } as unknown as Pick<Dialog, "showOpenDialog" | "showSaveDialog">;
      expect(
        await installAgentTeamPackage({} as BrowserWindow, dialog, store, root)
      ).toMatchObject({
        status: "installed",
        teamName: shape === "profile" ? "手写团队" : "文件名团队"
      });
    }
  );

  it("keeps the catalog and file unchanged after rejection or cancellation", async () => {
    const root = await temporaryRoot();
    const store = new AgentTeamConfigStore(root);
    const before = await store.list();
    const storedPath = join(root, "config", "agent-team-profiles.json");
    const stored = await readFile(storedPath, "utf8");
    const path = join(root, "invalid.json");
    const showOpenDialog = vi
      .fn()
      .mockResolvedValue({ canceled: false, filePaths: [path] });
    const dialog = { showOpenDialog } as unknown as Pick<
      Dialog,
      "showOpenDialog" | "showSaveDialog"
    >;
    const window = {} as BrowserWindow;

    for (const [contents, message] of [
      ["{broken", "有效 JSON"],
      [JSON.stringify({ workspaceType: "short", teams: [] }), "teams"]
    ]) {
      await writeFile(path, contents!, "utf8");
      await expect(
        installAgentTeamPackage(window, dialog, store, root)
      ).rejects.toThrow(message);
    }
    await writeFile(path, Buffer.alloc(AGENT_TEAM_CONFIG_MAX_BYTES + 1));
    await expect(
      installAgentTeamPackage(window, dialog, store, root)
    ).rejects.toThrow("4 MB");
    showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [root]
    });
    await expect(
      installAgentTeamPackage(window, dialog, store, root)
    ).rejects.toThrow("JSON");
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await expect(
      installAgentTeamPackage(window, dialog, store, root)
    ).resolves.toEqual({ status: "canceled" });
    expect(await store.list()).toEqual(before);
    expect(await readFile(storedPath, "utf8")).toBe(stored);
  });

  it("downloads a selected team and installs the uploaded archive", async () => {
    const root = await temporaryRoot();
    const store = new AgentTeamConfigStore(root);
    const source = (await store.list()).teams[0]!;
    const archivePath = join(root, "团队.deepwrite-team.zip");
    const dialog = {
      showSaveDialog: vi.fn().mockResolvedValue({
        canceled: false,
        filePath: archivePath
      }),
      showOpenDialog: vi.fn().mockResolvedValue({
        canceled: false,
        filePaths: [archivePath]
      })
    } as unknown as Pick<Dialog, "showOpenDialog" | "showSaveDialog">;
    const window = {} as BrowserWindow;

    await expect(
      downloadAgentTeamPackage(
        window,
        dialog,
        store,
        { teamId: source.id },
        root
      )
    ).resolves.toEqual({ status: "saved", filePath: archivePath });
    const installed = await installAgentTeamPackage(
      window,
      dialog,
      store,
      root
    );

    expect(installed).toMatchObject({
      status: "installed",
      teamName: `${source.name} (2)`
    });
    if (installed.status === "installed") {
      expect(installed.catalog.teams).toHaveLength(6);
    }
  });

  it("installs after migrating the earliest persisted five-parent settings", async () => {
    const root = await temporaryRoot();
    const config = join(root, "config");
    await mkdir(config);
    await writeFile(
      join(config, "agent-teams.json"),
      JSON.stringify({
        version: 1,
        workspaceType: "short",
        teams: [
          "character_design",
          "plot_design",
          "outline",
          "expert_draft_coordinator",
          "expert_section_writer"
        ].map((parentAgentId) => ({
          parentAgentId,
          subagents:
            parentAgentId === "outline"
              ? [
                  {
                    id: "legacy_outline_helper",
                    name: "旧版大纲助手",
                    description: "来自最早版本",
                    systemPrompt: "整理大纲。",
                    enabled: true
                  }
                ]
              : []
        }))
      })
    );
    const archivePath = join(root, "待安装.deepwrite-team.zip");
    await writeFile(
      archivePath,
      createAgentTeamPackage({
        id: "team_package_source",
        name: "安装测试团队",
        workspaceType: "short",
        settings: DEFAULT_AGENT_TEAM_SETTINGS
      })
    );
    const dialog = {
      showOpenDialog: vi.fn().mockResolvedValue({
        canceled: false,
        filePaths: [archivePath]
      })
    } as unknown as Pick<Dialog, "showOpenDialog" | "showSaveDialog">;

    const installed = await installAgentTeamPackage(
      {} as BrowserWindow,
      dialog,
      new AgentTeamConfigStore(root),
      root
    );

    expect(installed).toMatchObject({
      status: "installed",
      teamName: "安装测试团队"
    });
    if (installed.status === "installed") {
      const migrated = installed.catalog.teams.find(
        ({ name }) => name === "默认短篇团队"
      );
      expect(migrated?.settings.teams[0]?.subagents[0]).toMatchObject({
        id: "legacy_outline_helper",
        modelMode: "inherit"
      });
    }
    expect(
      JSON.parse(
        await readFile(join(config, "agent-team-profiles.json"), "utf8")
      )
    ).toMatchObject({ version: 6 });
    await expect(
      readFile(join(config, "agent-teams.json"), "utf8")
    ).resolves.toContain("expert_section_writer");
  });
});
