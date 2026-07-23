import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_LIBRARY_AGENT_PROFILES,
  LIBRARY_AGENT_DOMAINS,
  LibraryAgentDomainSchema,
  LibraryAgentSettingsInputSchema,
  LibraryAgentSettingsSchema,
  type LibraryAgentDomain,
  type LibraryAgentProfile,
  type LibraryAgentSettings,
  type LibraryAgentSettingsInput
} from "@deepwrite/contracts";

interface DiskLibraryAgentSettings {
  version: 1;
  agents: LibraryAgentSettingsInput["agents"];
}

function cloneProfile(profile: LibraryAgentProfile): LibraryAgentProfile {
  return { ...profile };
}

function defaultProfile(domain: LibraryAgentDomain): LibraryAgentProfile {
  const profile = DEFAULT_LIBRARY_AGENT_PROFILES.find(
    (candidate) => candidate.domain === domain
  );
  if (!profile) {
    throw new Error(`Missing builtin library agent profile: ${domain}`);
  }
  return cloneProfile(profile);
}

function defaultsAsInput(): LibraryAgentSettingsInput {
  return {
    agents: DEFAULT_LIBRARY_AGENT_PROFILES.map((profile) => ({
      domain: profile.domain,
      systemPrompt: profile.systemPrompt
    }))
  };
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error: unknown) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      error instanceof SyntaxError
    ) {
      return undefined;
    }
    throw error;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(temporary, path);
}

function normalizeDiskSettings(raw: unknown): LibraryAgentSettingsInput {
  if (!raw || typeof raw !== "object") {
    return defaultsAsInput();
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.version !== 1) {
    return defaultsAsInput();
  }
  const parsed = LibraryAgentSettingsInputSchema.safeParse({
    agents: candidate.agents
  });
  if (!parsed.success) {
    return defaultsAsInput();
  }
  return {
    agents: parsed.data.agents.map((agent) => ({ ...agent }))
  };
}

export class LibraryAgentConfigStore {
  private readonly settingsPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.settingsPath = join(userDataPath, "config", "library-agents.json");
  }

  async list(): Promise<LibraryAgentSettings> {
    await this.writeChain;
    return this.toPublicSettings(await this.readInput());
  }

  async save(rawInput: LibraryAgentSettingsInput): Promise<LibraryAgentSettings> {
    const input = LibraryAgentSettingsInputSchema.parse(rawInput);
    let saved: LibraryAgentSettings | undefined;
    const operation = this.writeChain.then(async () => {
      const normalized: LibraryAgentSettingsInput = {
        agents: input.agents.map((agent) => ({ ...agent }))
      };
      await this.writeInput(normalized);
      saved = this.toPublicSettings(normalized);
    });
    this.trackWrite(operation);
    await operation;
    return saved!;
  }

  async reset(rawDomain?: LibraryAgentDomain): Promise<LibraryAgentSettings> {
    const domain = rawDomain
      ? LibraryAgentDomainSchema.parse(rawDomain)
      : undefined;
    let saved: LibraryAgentSettings | undefined;
    const operation = this.writeChain.then(async () => {
      const next = domain ? await this.readInput() : defaultsAsInput();
      if (domain) {
        const builtin = defaultProfile(domain);
        const replacement = {
          domain: builtin.domain,
          systemPrompt: builtin.systemPrompt
        };
        const index = next.agents.findIndex(
          (candidate) => candidate.domain === domain
        );
        if (index >= 0) {
          next.agents[index] = replacement;
        } else {
          next.agents.push(replacement);
        }
      }
      const validated = LibraryAgentSettingsInputSchema.parse(next);
      await this.writeInput(validated);
      saved = this.toPublicSettings(validated);
    });
    this.trackWrite(operation);
    await operation;
    return saved!;
  }

  async resolve(rawDomain: LibraryAgentDomain): Promise<LibraryAgentProfile> {
    const domain = LibraryAgentDomainSchema.parse(rawDomain);
    const settings = await this.list();
    const profile = settings.agents.find(
      (candidate) => candidate.domain === domain
    );
    return profile ? cloneProfile(profile) : defaultProfile(domain);
  }

  private trackWrite(operation: Promise<unknown>): void {
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
  }

  private async readInput(): Promise<LibraryAgentSettingsInput> {
    return normalizeDiskSettings(await readJson(this.settingsPath));
  }

  private async writeInput(input: LibraryAgentSettingsInput): Promise<void> {
    const disk: DiskLibraryAgentSettings = {
      version: 1,
      agents: input.agents.map((agent) => ({ ...agent }))
    };
    await atomicWriteJson(this.settingsPath, disk);
  }

  private toPublicSettings(
    input: LibraryAgentSettingsInput
  ): LibraryAgentSettings {
    const byDomain = new Map(
      input.agents.map((profile) => [profile.domain, profile])
    );
    const settings: LibraryAgentSettings = {
      agents: LIBRARY_AGENT_DOMAINS.map((domain) => {
        const builtin = defaultProfile(domain);
        const override = byDomain.get(domain);
        return {
          ...builtin,
          ...(override &&
          override.systemPrompt !== builtin.systemPrompt.trim()
            ? { systemPrompt: override.systemPrompt }
            : {})
        };
      })
    };
    // Validate the public shape without replacing byte-exact builtin prompts
    // with the schema's trimmed copies.
    LibraryAgentSettingsSchema.parse(settings);
    return settings;
  }
}
