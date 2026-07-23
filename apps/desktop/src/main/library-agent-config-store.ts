import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_LIBRARY_AGENT_PROFILES,
  LIBRARY_AGENT_DOMAINS,
  LibraryAgentDomainSchema,
  LibraryAgentSettingsInputSchema,
  LibraryAgentSettingsSchema,
  LibraryAgentSkillSchema,
  type LibraryAgentDomain,
  type LibraryAgentProfile,
  type LibraryAgentReadAccess,
  type LibraryAgentSettings,
  type LibraryAgentSettingsInput,
  type LibraryAgentSkill
} from "@deepwrite/contracts";

interface DiskLibraryAgentSettings {
  version: 1;
  agents: LibraryAgentSettingsInput["agents"];
}

function cloneSkill(skill: LibraryAgentSkill): LibraryAgentSkill {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    content: skill.content
  };
}

function cloneReadAccess(value: LibraryAgentReadAccess): LibraryAgentReadAccess {
  return {
    skills: value.skills.map(cloneSkill)
  };
}

function cloneProfile(profile: LibraryAgentProfile): LibraryAgentProfile {
  return {
    ...profile,
    readAccess: cloneReadAccess(profile.readAccess)
  };
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
      systemPrompt: profile.systemPrompt,
      readAccess: cloneReadAccess(profile.readAccess)
    }))
  };
}

function sameSkills(
  left: readonly LibraryAgentSkill[],
  right: readonly LibraryAgentSkill[]
): boolean {
  if (left.length !== right.length) return false;
  return left.every((skill, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      skill.id === other.id &&
      skill.name === other.name &&
      skill.description === other.description &&
      skill.content === other.content
    );
  });
}

function sameSkillAccess(
  left: LibraryAgentReadAccess,
  right: LibraryAgentReadAccess
): boolean {
  return sameSkills(left.skills, right.skills);
}

function normalizeLegacyReadAccess(
  raw: unknown,
  domain: LibraryAgentDomain
): LibraryAgentReadAccess {
  if (!raw || typeof raw !== "object") {
    return cloneReadAccess(defaultProfile(domain).readAccess);
  }
  const record = raw as Record<string, unknown>;
  if (Array.isArray(record.skills)) {
    const parsed = LibraryAgentSkillSchema.array().safeParse(record.skills);
    if (parsed.success && parsed.data.length > 0) {
      return { skills: parsed.data.map(cloneSkill) };
    }
  }
  return cloneReadAccess(defaultProfile(domain).readAccess);
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
  const agents = Array.isArray(candidate.agents)
    ? candidate.agents.map((agent) => {
        if (!agent || typeof agent !== "object") return agent;
        const record = agent as Record<string, unknown>;
        const domain =
          record.domain === "material" || record.domain === "skill"
            ? record.domain
            : undefined;
        if (!domain) return agent;
        return {
          ...record,
          readAccess: normalizeLegacyReadAccess(record.readAccess, domain)
        };
      })
    : candidate.agents;
  const parsed = LibraryAgentSettingsInputSchema.safeParse({
    agents
  });
  if (!parsed.success) {
    return defaultsAsInput();
  }
  return {
    agents: parsed.data.agents.map((agent) => ({
      domain: agent.domain,
      systemPrompt: agent.systemPrompt,
      readAccess: cloneReadAccess(agent.readAccess)
    }))
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
        agents: input.agents.map((agent) => ({
          domain: agent.domain,
          systemPrompt: agent.systemPrompt,
          readAccess: cloneReadAccess(agent.readAccess)
        }))
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
          systemPrompt: builtin.systemPrompt,
          readAccess: cloneReadAccess(builtin.readAccess)
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
      agents: input.agents.map((agent) => ({
        domain: agent.domain,
        systemPrompt: agent.systemPrompt,
        readAccess: cloneReadAccess(agent.readAccess)
      }))
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
        if (!override) return builtin;
        const customizedPrompt =
          override.systemPrompt !== builtin.systemPrompt.trim();
        const customizedAccess = !sameSkillAccess(
          override.readAccess,
          builtin.readAccess
        );
        return {
          ...builtin,
          ...(customizedPrompt ? { systemPrompt: override.systemPrompt } : {}),
          ...(customizedAccess
            ? { readAccess: cloneReadAccess(override.readAccess) }
            : {})
        };
      })
    };
    LibraryAgentSettingsSchema.parse(settings);
    return settings;
  }
}
