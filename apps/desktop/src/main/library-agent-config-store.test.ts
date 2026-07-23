import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LIBRARY_AGENT_PROFILES,
  type LibraryAgentDomain,
  type LibraryAgentSettingsInput
} from "@deepwrite/contracts";
import { LibraryAgentConfigStore } from "./library-agent-config-store";

const temporaryRoots = new Set<string>();

async function makeTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-library-agent-store-"));
  temporaryRoots.add(root);
  return root;
}

function defaultInput(): LibraryAgentSettingsInput {
  return {
    agents: DEFAULT_LIBRARY_AGENT_PROFILES.map((profile) => ({
      domain: profile.domain,
      systemPrompt: profile.systemPrompt
    }))
  };
}

function customizedInput(prefix: string): LibraryAgentSettingsInput {
  return {
    agents: defaultInput().agents.map((agent) => ({
      ...agent,
      systemPrompt: `${prefix}:${agent.domain}`
    }))
  };
}

function byDomain<T extends { domain: LibraryAgentDomain }>(
  agents: readonly T[],
  domain: LibraryAgentDomain
): T {
  const profile = agents.find((candidate) => candidate.domain === domain);
  if (!profile) {
    throw new Error(`Missing test library agent: ${domain}`);
  }
  return profile;
}

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) => rm(root, { recursive: true, force: true }))
  );
  temporaryRoots.clear();
});

describe("LibraryAgentConfigStore", () => {
  it("returns cloned builtin settings when no persisted config exists", async () => {
    const store = new LibraryAgentConfigStore(await makeTemporaryRoot());

    const settings = await store.list();

    expect(settings.agents).toEqual(DEFAULT_LIBRARY_AGENT_PROFILES);
    expect(settings.agents).not.toBe(DEFAULT_LIBRARY_AGENT_PROFILES);
    expect(settings.agents[0]).not.toBe(DEFAULT_LIBRARY_AGENT_PROFILES[0]);
  });

  it("persists validated version 1 settings and resolves a cloned profile", async () => {
    const root = await makeTemporaryRoot();
    const store = new LibraryAgentConfigStore(root);

    const saved = await store.save(customizedInput("custom"));
    const resolved = await store.resolve("material");
    const disk = JSON.parse(
      await readFile(join(root, "config", "library-agents.json"), "utf8")
    ) as { version: number; agents: LibraryAgentSettingsInput["agents"] };

    expect(disk.version).toBe(1);
    expect(byDomain(disk.agents, "skill").systemPrompt).toBe("custom:skill");
    expect(resolved).toEqual(byDomain(saved.agents, "material"));
    expect(resolved).not.toBe(byDomain(saved.agents, "material"));
  });

  it("falls back to builtin settings for malformed or unsupported disk data", async () => {
    const root = await makeTemporaryRoot();
    const configDirectory = join(root, "config");
    const settingsPath = join(configDirectory, "library-agents.json");
    await mkdir(configDirectory);
    const store = new LibraryAgentConfigStore(root);

    await writeFile(settingsPath, "{not-json", "utf8");
    await expect(store.list()).resolves.toMatchObject({
      agents: DEFAULT_LIBRARY_AGENT_PROFILES
    });

    await writeFile(
      settingsPath,
      JSON.stringify({ version: 2, agents: customizedInput("ignored").agents }),
      "utf8"
    );
    await expect(store.list()).resolves.toMatchObject({
      agents: DEFAULT_LIBRARY_AGENT_PROFILES
    });

    await writeFile(
      settingsPath,
      JSON.stringify({ version: 1, agents: [{ domain: "material" }] }),
      "utf8"
    );
    await expect(store.list()).resolves.toMatchObject({
      agents: DEFAULT_LIBRARY_AGENT_PROFILES
    });
  });

  it("resets only the requested domain and preserves the other override", async () => {
    const store = new LibraryAgentConfigStore(await makeTemporaryRoot());
    await store.save(customizedInput("custom"));

    const reset = await store.reset("material");

    expect(byDomain(reset.agents, "material")).toEqual(
      byDomain(DEFAULT_LIBRARY_AGENT_PROFILES, "material")
    );
    expect(byDomain(reset.agents, "skill").systemPrompt).toBe("custom:skill");
    expect(await store.list()).toEqual(reset);
  });

  it("resets every profile to the builtin settings", async () => {
    const store = new LibraryAgentConfigStore(await makeTemporaryRoot());
    await store.save(customizedInput("discarded"));

    const reset = await store.reset();

    expect(reset.agents).toEqual(DEFAULT_LIBRARY_AGENT_PROFILES);
    expect(await store.list()).toEqual(reset);
  });

  it("continues the write queue after a failed persistence operation", async () => {
    const root = await makeTemporaryRoot();
    const blockingConfigPath = join(root, "config");
    await writeFile(blockingConfigPath, "not-a-directory", "utf8");
    const store = new LibraryAgentConfigStore(root);

    await expect(store.save(customizedInput("failed"))).rejects.toMatchObject({
      code: expect.stringMatching(/EEXIST|ENOTDIR/u)
    });

    await unlink(blockingConfigPath);
    await mkdir(blockingConfigPath);
    const recovered = await store.save(customizedInput("recovered"));

    expect(byDomain(recovered.agents, "skill").systemPrompt).toBe(
      "recovered:skill"
    );
    expect(await store.list()).toEqual(recovered);
  });
});
