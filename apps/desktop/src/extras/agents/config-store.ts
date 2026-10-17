import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ExtrasAgentSettingsInputSchema,
  ExtrasAgentSettingsSchema,
  type ExtrasAgentId,
  type ExtrasAgentProfile,
  type ExtrasAgentSettings,
  type ExtrasAgentSettingsInput,
  type ExtrasAgentSettingsOf
} from "@deepwrite/contracts";
import {
  EXTRAS_AGENT_PROFILE_CATALOGS,
  type ExtrasAgentProfileCatalog
} from "./profile-catalogs";
import { previousLongBookPrompts } from "./previous-long-book-prompts";
import { mergeSettingsById } from "../../main/merge-agent-settings";

interface StoredProfile {
  id: string;
  name: string;
  systemPrompt: string;
}

interface DiskSettings {
  version: 1;
  profiles: StoredProfile[];
  updatedAt?: string;
  promptRevisions?: Record<string, number>;
}

const previousShortCharacterPrompt =
  "你是短篇拆书分析师。基于完整短篇，分析人物目标、冲突、关系、关键选择及人物弧光，提炼可复用的人物设计方法。多本输入时比较共性与差异，并标明书名证据。";
const previousShortStylePrompt =
  "你是短篇拆书分析师。分析完整短篇的叙述视角、句式、用词、对白和描写，提炼可执行的写作规则及检查清单。多本输入时比较共性与差异，并标明书名证据。避免大段照抄正文。";

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function atomicWrite(path: string, value: DiskSettings): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(temporary, path);
}

function validTimestamp(value: unknown): string | undefined {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

/**
 * The one settings service for every "更多功能" agent. Each agent keeps its
 * profiles in `config/extras-agents/<agentId>.json`; built-in profiles that
 * are missing on disk are restored on every read.
 */
export class ExtrasAgentConfigStore {
  private readonly directory: string;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly diskCache = new Map<ExtrasAgentId, DiskSettings>();

  constructor(private readonly userDataPath: string) {
    this.directory = join(userDataPath, "config", "extras-agents");
  }

  async list<A extends ExtrasAgentId>(
    agentId: A
  ): Promise<ExtrasAgentSettingsOf<A>> {
    await this.writeChain;
    const disk = await this.readDisk(agentId);
    const settings = this.publicSettings(agentId, disk);
    this.cacheDisk(agentId, disk, settings);
    return settings;
  }

  async save(rawInput: ExtrasAgentSettingsInput): Promise<ExtrasAgentSettings> {
    const input = ExtrasAgentSettingsInputSchema.parse(rawInput);
    const baseline = this.diskCache.get(input.agentId);
    return this.enqueue(input.agentId, async () => {
      const profiles = this.withDefaults(input.agentId, input.profiles);
      const current = baseline ? await this.readDisk(input.agentId) : undefined;
      const mergedProfiles =
        current && baseline
          ? mergeSettingsById(
              current.profiles,
              profiles,
              baseline.profiles,
              (profile) => profile.id
            )
          : profiles;
      return {
        version: 1,
        profiles: mergedProfiles,
        updatedAt: new Date().toISOString(),
        ...this.currentPromptRevisions(input.agentId)
      };
    });
  }

  async reset(
    agentId: ExtrasAgentId,
    profileId?: string
  ): Promise<ExtrasAgentSettings> {
    const catalog = this.catalog(agentId);
    return this.enqueue(agentId, async () => {
      if (!profileId) {
        return {
          version: 1,
          profiles: catalog.defaults.map((profile) => structuredClone(profile)),
          updatedAt: new Date().toISOString(),
          ...this.currentPromptRevisions(agentId)
        };
      }
      const replacement = catalog.defaults.find(
        (profile) => profile.id === profileId
      );
      if (!replacement) throw new Error("该自定义预设没有可恢复的默认版本。");
      const profiles = (await this.readDisk(agentId)).profiles.map((profile) =>
        structuredClone(profile)
      );
      const index = profiles.findIndex((profile) => profile.id === profileId);
      if (index >= 0) profiles.splice(index, 1, structuredClone(replacement));
      else profiles.push(structuredClone(replacement));
      return {
        version: 1,
        profiles,
        updatedAt: new Date().toISOString(),
        ...this.currentPromptRevisions(agentId)
      };
    });
  }

  /** The saved profile with this id, if any. */
  async find<A extends ExtrasAgentId>(
    agentId: A,
    profileId: string
  ): Promise<ExtrasAgentProfile<A> | undefined> {
    const profiles: readonly ExtrasAgentProfile[] = (await this.list(agentId))
      .profiles;
    return profiles.find((candidate) => candidate.id === profileId) as
      ExtrasAgentProfile<A> | undefined;
  }

  /** The authoritative profile for a run; Renderer only sends its id. */
  async resolve<A extends ExtrasAgentId>(
    agentId: A,
    profileId: string
  ): Promise<ExtrasAgentProfile<A>> {
    const profile = await this.find(agentId, profileId);
    if (!profile) throw new Error(this.catalog(agentId).missingProfileMessage);
    return profile;
  }

  private catalog(
    agentId: ExtrasAgentId
  ): ExtrasAgentProfileCatalog<ExtrasAgentId> {
    return EXTRAS_AGENT_PROFILE_CATALOGS[
      agentId
    ] as ExtrasAgentProfileCatalog<ExtrasAgentId>;
  }

  private path(agentId: ExtrasAgentId): string {
    return join(this.directory, `${agentId}.json`);
  }

  private withDefaults(
    agentId: ExtrasAgentId,
    profiles: readonly StoredProfile[]
  ): StoredProfile[] {
    const existingIds = new Set(profiles.map((profile) => profile.id));
    return [
      ...this.catalog(agentId).defaults.filter(
        (profile) => !existingIds.has(profile.id)
      ),
      ...profiles
    ].map((profile) => {
      const stored = structuredClone(profile) as StoredProfile & {
        builtin?: boolean;
      };
      delete stored.builtin;
      return stored;
    });
  }

  private currentPromptRevisions(
    agentId: ExtrasAgentId
  ): Pick<DiskSettings, "promptRevisions"> {
    const updates = this.catalog(agentId).promptUpdates;
    return updates?.length
      ? {
          promptRevisions: Object.fromEntries(
            updates.map(({ profileId, revision }) => [profileId, revision])
          )
        }
      : {};
  }

  private applyPromptUpdates(
    agentId: ExtrasAgentId,
    profiles: StoredProfile[],
    revisions: unknown
  ): StoredProfile[] {
    const catalog = this.catalog(agentId);
    const saved =
      revisions && typeof revisions === "object"
        ? (revisions as Record<string, unknown>)
        : {};
    return profiles.map((profile) => {
      const update = catalog.promptUpdates?.find(
        ({ profileId, revision }) =>
          profileId === profile.id &&
          (typeof saved[profileId] !== "number" || saved[profileId] < revision)
      );
      if (!update) return profile;
      const builtin = catalog.defaults.find(
        (candidate) => candidate.id === update.profileId
      );
      return builtin
        ? { ...profile, systemPrompt: builtin.systemPrompt }
        : profile;
    });
  }

  /** Validated stored profiles, or undefined when they cannot be trusted. */
  private parseProfiles(
    agentId: ExtrasAgentId,
    profiles: unknown
  ): StoredProfile[] | undefined {
    const parsed = ExtrasAgentSettingsInputSchema.safeParse({
      agentId,
      // Older files may contain response-only flags. Identity is derived by
      // publicSettings from the authoritative built-in catalog on every read.
      profiles: Array.isArray(profiles)
        ? profiles.map((profile: unknown) => {
            if (
              !profile ||
              typeof profile !== "object" ||
              Array.isArray(profile)
            )
              return profile;
            const { builtin: _builtin, ...stored } = profile as Record<
              string,
              unknown
            >;
            return stored;
          })
        : profiles
    });
    if (!parsed.success) return undefined;
    const upgradedProfiles = parsed.data.profiles.map((profile) => {
      if (
        agentId === "long-book-analysis" &&
        profile.systemPrompt === previousLongBookPrompts[profile.id]
      ) {
        const builtin = EXTRAS_AGENT_PROFILE_CATALOGS[
          "long-book-analysis"
        ].defaults.find((candidate) => candidate.id === profile.id);
        return builtin
          ? { ...profile, systemPrompt: builtin.systemPrompt }
          : profile;
      }
      if (agentId !== "short-book-analysis") return profile;
      const isPreviousBuiltin =
        (profile.id === "character" &&
          profile.systemPrompt === previousShortCharacterPrompt) ||
        (profile.id === "style" &&
          profile.systemPrompt === previousShortStylePrompt);
      if (!isPreviousBuiltin) return profile;
      const builtin = EXTRAS_AGENT_PROFILE_CATALOGS[
        "short-book-analysis"
      ].defaults.find((candidate) => candidate.id === profile.id);
      return builtin
        ? { ...profile, systemPrompt: builtin.systemPrompt }
        : profile;
    });
    return this.withDefaults(agentId, upgradedProfiles);
  }

  private async readDisk(agentId: ExtrasAgentId): Promise<DiskSettings> {
    const raw = await readJson(this.path(agentId));
    if (raw !== undefined) {
      const candidate =
        raw && typeof raw === "object"
          ? (raw as {
              version?: unknown;
              profiles?: unknown;
              updatedAt?: unknown;
              promptRevisions?: unknown;
            })
          : {};
      const profiles =
        candidate.version === 1
          ? this.parseProfiles(agentId, candidate.profiles)
          : undefined;
      if (profiles) {
        const updatedAt = validTimestamp(candidate.updatedAt);
        return {
          version: 1,
          profiles: this.applyPromptUpdates(
            agentId,
            profiles,
            candidate.promptRevisions
          ),
          ...(updatedAt ? { updatedAt } : {})
        };
      }
      return { version: 1, profiles: this.withDefaults(agentId, []) };
    }
    const legacy = this.catalog(agentId).legacy;
    if (legacy) {
      const legacyRaw = await readJson(join(this.userDataPath, ...legacy.path));
      const profiles =
        legacyRaw === undefined
          ? undefined
          : this.parseProfiles(agentId, legacy.profiles(legacyRaw));
      if (profiles) {
        return {
          version: 1,
          profiles: this.applyPromptUpdates(agentId, profiles, undefined)
        };
      }
    }
    return { version: 1, profiles: this.withDefaults(agentId, []) };
  }

  private publicSettings<A extends ExtrasAgentId>(
    agentId: A,
    disk: DiskSettings
  ): ExtrasAgentSettingsOf<A> {
    const defaultIds = new Set(
      this.catalog(agentId).defaults.map((profile) => profile.id)
    );
    const settings = ExtrasAgentSettingsSchema.parse({
      agentId,
      profiles: disk.profiles.map((profile) => ({
        ...structuredClone(profile),
        ...(defaultIds.has(profile.id) ? { builtin: true } : {})
      })),
      ...(disk.updatedAt ? { updatedAt: disk.updatedAt } : {})
    });
    return settings as ExtrasAgentSettingsOf<A>;
  }

  private async enqueue(
    agentId: ExtrasAgentId,
    operation: () => Promise<DiskSettings>
  ): Promise<ExtrasAgentSettings> {
    let saved: ExtrasAgentSettings | undefined;
    const pending = this.writeChain.then(async () => {
      const disk = await operation();
      saved = this.publicSettings(agentId, disk);
      await atomicWrite(this.path(agentId), disk);
      this.cacheDisk(agentId, disk, saved);
    });
    this.writeChain = pending.then(
      () => undefined,
      () => undefined
    );
    await pending;
    return saved!;
  }

  private cacheDisk(
    agentId: ExtrasAgentId,
    disk: DiskSettings,
    settings: ExtrasAgentSettings
  ): void {
    this.diskCache.set(agentId, {
      ...disk,
      profiles: settings.profiles.map(({ builtin: _builtin, ...profile }) =>
        structuredClone(profile)
      ) as StoredProfile[]
    });
  }
}
