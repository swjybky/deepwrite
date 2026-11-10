import { withConfigurationLock } from "./configuration-lock";
import {
  BuiltinSubagentSettingsSchema,
  type BuiltinSubagentSettings
} from "@deepwrite/contracts";
import { join } from "node:path";
import { applyActiveTeamPrompt } from "./agent-team-prompt-management";
import type { AgentTeamPromptChange } from "@deepwrite/contracts";
import {
  AGENT_TEAM_PROFILE_NAME_MAX_LENGTH,
  AgentTeamBookBindingInputSchema,
  AgentTeamCatalogSnapshotSchema,
  AgentTeamMarketplaceSourceSchema,
  AgentTeamProfileSchema,
  AgentTeamProfileCreateInputSchema,
  AgentTeamProfileRenameInputSchema,
  AgentTeamProfileSaveInputSchema,
  AgentTeamProfileSetEnabledInputSchema,
  AgentTeamProfileTargetInputSchema,
  LongAgentIdSchema,
  SHORT_AGENT_SUBAGENT_MAX_COUNT,
  ScriptWorkspaceAgentIdSchema,
  ShortWorkspaceAgentIdSchema,
  activeAgentTeamMembers,
  activeAgentTeams,
  activeAgentTeamsParallel,
  withoutAgentTeamBindings,
  type AgentTeamBookBindingInput,
  type AgentTeamBookBindings,
  type AgentTeamCatalogSnapshot,
  type AgentTeamMarketplaceSource,
  type AgentTeamProfile,
  type AgentTeamProfileCreateInput,
  type AgentTeamProfileRenameInput,
  type AgentTeamProfileSaveInput,
  type AgentTeamProfileSetEnabledInput,
  type AgentTeamProfileTargetInput,
  type AgentTeamWorkspaceType,
  type ShortAgentSubagentDefinition,
  type WorkspaceAgentId,
  withAgentTeamEnabled
} from "@deepwrite/contracts";
import {
  AGENT_TEAM_CATALOG_DISK_VERSION,
  atomicWriteAgentTeamJson,
  createAgentTeamProfile,
  createCatalogFromLegacyFiles,
  invalidAgentTeamConfig,
  readAgentTeamJson,
  tryMigrateCombinedCatalog,
  tryMigrateStandaloneCatalog,
  type AgentTeamDiskCatalog
} from "./agent-team-config-migration";
import {
  readAgentTeamBookBindings,
  withAgentTeamBookBinding,
  writeAgentTeamBookBindings
} from "./agent-team-book-binding-file";

function cloneSnapshot(
  snapshot: AgentTeamCatalogSnapshot
): AgentTeamCatalogSnapshot {
  return AgentTeamCatalogSnapshotSchema.parse(structuredClone(snapshot));
}

export class AgentTeamConfigStore {
  private readonly settingsPath: string;
  private readonly bookBindingsPath: string;
  private readonly legacyShortPath: string;
  private readonly legacyScriptPath: string;
  private readonly legacyLongPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    const configRoot = join(userDataPath, "config");
    this.settingsPath = join(configRoot, "agent-team-profiles.json");
    this.bookBindingsPath = join(configRoot, "agent-team-book-bindings.json");
    this.legacyShortPath = join(configRoot, "agent-teams.json");
    this.legacyScriptPath = join(configRoot, "agent-teams-script.json");
    this.legacyLongPath = join(configRoot, "long-agent-teams.json");
  }

  private async readLegacyFiles(): Promise<AgentTeamCatalogSnapshot> {
    return createCatalogFromLegacyFiles({
      short: this.legacyShortPath,
      script: this.legacyScriptPath,
      long: this.legacyLongPath
    });
  }

  private async readSnapshot(): Promise<AgentTeamCatalogSnapshot> {
    const raw = await readAgentTeamJson(this.settingsPath);
    if (raw === undefined) {
      const snapshot = await this.readLegacyFiles();
      await this.writeSnapshot(snapshot);
      return snapshot;
    }
    if (!raw || typeof raw !== "object") throw invalidAgentTeamConfig();
    const { version, ...stored } = raw as Record<string, unknown>;
    const current = AgentTeamCatalogSnapshotSchema.safeParse(stored);
    if (current.success) {
      if (version !== AGENT_TEAM_CATALOG_DISK_VERSION) {
        await this.writeSnapshot(current.data);
      }
      return current.data;
    }
    const migrated =
      tryMigrateCombinedCatalog(stored) ?? tryMigrateStandaloneCatalog(stored);
    if (migrated) {
      const snapshot = migrated;
      await this.writeSnapshot(snapshot);
      return snapshot;
    }
    throw invalidAgentTeamConfig(current.error.issues[0]);
  }

  private async writeSnapshot(
    snapshot: AgentTeamCatalogSnapshot
  ): Promise<void> {
    // Bindings have their own file so the profiles file stays readable by
    // older versions, whose schema is strict.
    const { bookBindings: _bookBindings, ...profiles } =
      cloneSnapshot(snapshot);
    await atomicWriteAgentTeamJson(this.settingsPath, {
      version: AGENT_TEAM_CATALOG_DISK_VERSION,
      ...profiles
    } satisfies AgentTeamDiskCatalog);
  }

  private withBookBindings(
    snapshot: AgentTeamCatalogSnapshot,
    bookBindings: AgentTeamBookBindings
  ): AgentTeamCatalogSnapshot {
    return cloneSnapshot(
      Object.keys(bookBindings).length > 0
        ? { ...snapshot, bookBindings }
        : snapshot
    );
  }

  private async queue<Result>(
    operation: () => Promise<Result>
  ): Promise<Result> {
    let result: Result | undefined;
    const pending = this.writeChain.then(() =>
      withConfigurationLock(this.settingsPath, async () => {
        result = await operation();
      })
    );
    this.writeChain = pending.then(
      () => undefined,
      () => undefined
    );
    await pending;
    return result!;
  }

  private async mutate(
    operation: (snapshot: AgentTeamCatalogSnapshot) => void
  ): Promise<AgentTeamCatalogSnapshot> {
    return this.queue(async () => {
      const snapshot = await this.readSnapshot();
      operation(snapshot);
      const parsed = AgentTeamCatalogSnapshotSchema.parse(snapshot);
      await this.writeSnapshot(parsed);
      return this.withBookBindings(
        parsed,
        await readAgentTeamBookBindings(this.bookBindingsPath)
      );
    });
  }

  private async updateBookBindings(
    update: (
      bindings: AgentTeamBookBindings,
      snapshot: AgentTeamCatalogSnapshot
    ) => AgentTeamBookBindings
  ): Promise<AgentTeamCatalogSnapshot> {
    return this.queue(async () => {
      const snapshot = await this.readSnapshot();
      const next = update(
        await readAgentTeamBookBindings(this.bookBindingsPath),
        snapshot
      );
      await writeAgentTeamBookBindings(this.bookBindingsPath, next);
      return this.withBookBindings(snapshot, next);
    });
  }

  async list(): Promise<AgentTeamCatalogSnapshot> {
    return this.queue(async () =>
      this.withBookBindings(
        await this.readSnapshot(),
        await readAgentTeamBookBindings(this.bookBindingsPath)
      )
    );
  }

  async applyActivePrompt(
    input: AgentTeamPromptChange
  ): Promise<AgentTeamCatalogSnapshot> {
    return this.queue(async () => {
      const snapshot = await this.readSnapshot();
      const bindings = await readAgentTeamBookBindings(this.bookBindingsPath);
      applyActiveTeamPrompt(snapshot, bindings, input);
      const parsed = AgentTeamCatalogSnapshotSchema.parse(snapshot);
      await this.writeSnapshot(parsed);
      return this.withBookBindings(parsed, bindings);
    });
  }

  async create(
    rawInput: AgentTeamProfileCreateInput
  ): Promise<AgentTeamCatalogSnapshot> {
    const input = AgentTeamProfileCreateInputSchema.parse(rawInput);
    return this.mutate((snapshot) => {
      this.assertUniqueName(snapshot, input.name);
      snapshot.teams.push(
        createAgentTeamProfile(input.workspaceType, input.name)
      );
    });
  }

  async rename(
    rawInput: AgentTeamProfileRenameInput
  ): Promise<AgentTeamCatalogSnapshot> {
    const input = AgentTeamProfileRenameInputSchema.parse(rawInput);
    return this.mutate((snapshot) => {
      this.requireTeam(snapshot, input.teamId).name = input.name;
      this.assertUniqueName(snapshot, input.name, input.teamId);
    });
  }

  async delete(
    rawInput: AgentTeamProfileTargetInput
  ): Promise<AgentTeamCatalogSnapshot> {
    const input = AgentTeamProfileTargetInputSchema.parse(rawInput);
    await this.mutate((snapshot) => {
      const team = this.requireTeam(snapshot, input.teamId);
      if (snapshot.enabledTeamIds[team.workspaceType] === team.id) {
        throw new Error("已启用的团队不能删除，请先关闭该团队。");
      }
      if (snapshot.teams.length === 1)
        throw new Error("至少需要保留一个智能体团队。");
      snapshot.teams = snapshot.teams.filter(
        (candidate) => candidate.id !== team.id
      );
    });
    return this.updateBookBindings((bindings) =>
      withoutAgentTeamBindings(bindings, input.teamId)
    );
  }

  async setEnabled(
    rawInput: AgentTeamProfileSetEnabledInput
  ): Promise<AgentTeamCatalogSnapshot> {
    const input = AgentTeamProfileSetEnabledInputSchema.parse(rawInput);
    return this.mutate((snapshot) => {
      snapshot.enabledTeamIds = withAgentTeamEnabled(
        snapshot.enabledTeamIds,
        this.requireTeam(snapshot, input.teamId),
        input.enabled
      );
    });
  }

  async setBookBinding(
    rawInput: AgentTeamBookBindingInput
  ): Promise<AgentTeamCatalogSnapshot> {
    const input = AgentTeamBookBindingInputSchema.parse(rawInput);
    return this.updateBookBindings((bindings, snapshot) => {
      for (const teamId of input.teamIds) {
        if (
          this.requireTeam(snapshot, teamId).workspaceType !==
          input.workspaceType
        ) {
          throw new Error("绑定的团队与作品的写作类型不一致。");
        }
      }
      return withAgentTeamBookBinding(bindings, input.bookId, input.teamIds);
    });
  }

  /** Forgets a permanently deleted book; a no-op for books never bound. */
  async removeBookBinding(bookId: string): Promise<void> {
    await this.queue(async () => {
      const bindings = await readAgentTeamBookBindings(this.bookBindingsPath);
      if (!bindings[bookId]) return;
      await writeAgentTeamBookBindings(
        this.bookBindingsPath,
        withAgentTeamBookBinding(bindings, bookId, [])
      );
    });
  }

  async save(
    rawInput: AgentTeamProfileSaveInput
  ): Promise<AgentTeamCatalogSnapshot> {
    const input = AgentTeamProfileSaveInputSchema.parse(rawInput);
    return this.mutate((snapshot) => {
      const team = this.requireTeam(snapshot, input.teamId);
      if (team.workspaceType !== input.settings.workspaceType) {
        throw new Error("团队类型与保存的配置类型不一致。");
      }
      team.settings = input.settings as never;
    });
  }

  async saveBuiltins(
    rawInput: BuiltinSubagentSettings
  ): Promise<AgentTeamCatalogSnapshot> {
    const input = BuiltinSubagentSettingsSchema.parse(rawInput);
    return this.mutate((snapshot) => {
      snapshot.builtinSubagents = input;
    });
  }

  async exportProfile(
    rawInput: AgentTeamProfileTargetInput
  ): Promise<AgentTeamProfile> {
    const input = AgentTeamProfileTargetInputSchema.parse(rawInput);
    // The plaza origin is local bookkeeping; packages stay readable by older versions.
    const { marketplaceSource: _source, ...team } = this.requireTeam(
      await this.list(),
      input.teamId
    );
    return structuredClone(team);
  }

  /** Installs a copy under a new id; `rawProfile.id` is not reused. */
  async installProfile(
    rawProfile: AgentTeamProfile,
    rawMarketplaceSource?: AgentTeamMarketplaceSource
  ): Promise<{
    catalog: AgentTeamCatalogSnapshot;
    team: AgentTeamProfile;
  }> {
    const profile = AgentTeamProfileSchema.parse(rawProfile);
    const marketplaceSource =
      rawMarketplaceSource &&
      AgentTeamMarketplaceSourceSchema.parse(rawMarketplaceSource);
    let installedId = "";
    const catalog = await this.mutate((snapshot) => {
      const installed = createAgentTeamProfile(
        profile.workspaceType,
        this.availableImportedName(snapshot, profile.name),
        profile.settings
      );
      if (marketplaceSource) installed.marketplaceSource = marketplaceSource;
      installedId = installed.id;
      snapshot.teams.push(installed);
    });
    return {
      catalog,
      team: structuredClone(this.requireTeam(catalog, installedId))
    };
  }

  async resolve(
    workspaceType: AgentTeamWorkspaceType,
    rawParentAgentId: WorkspaceAgentId | "long",
    bookId?: string
  ): Promise<ShortAgentSubagentDefinition[]> {
    const active = activeAgentTeams(await this.list(), workspaceType, bookId);
    if (active.source === "enabled" && active.teams.length === 0) return [];
    const parentAgentId =
      workspaceType === "long"
        ? LongAgentIdSchema.parse(rawParentAgentId)
        : workspaceType === "script"
          ? ScriptWorkspaceAgentIdSchema.parse(rawParentAgentId)
          : ShortWorkspaceAgentIdSchema.parse(rawParentAgentId);
    const members = activeAgentTeamMembers(active, parentAgentId);
    if (active.source === "bound" && members.length === 0) {
      throw new Error(
        "本作品绑定的智能体团队已失效或没有当前智能体可用的成员，请在作品菜单的“团队绑定”中调整。"
      );
    }
    if (members.length > SHORT_AGENT_SUBAGENT_MAX_COUNT) {
      throw new Error(
        `本作品绑定的团队合计 ${members.length} 个成员，超过单次运行 ${SHORT_AGENT_SUBAGENT_MAX_COUNT} 个的上限，请减少绑定的团队或关闭部分成员。`
      );
    }
    return members;
  }

  /** Team-wide parallel switch of the teams active for this book. */
  async parallelSubagentsEnabled(
    workspaceType: AgentTeamWorkspaceType,
    bookId?: string
  ): Promise<boolean> {
    return activeAgentTeamsParallel(
      activeAgentTeams(await this.list(), workspaceType, bookId)
    );
  }

  private requireTeam(
    snapshot: AgentTeamCatalogSnapshot,
    teamId: string
  ): AgentTeamProfile {
    const team = snapshot.teams.find((candidate) => candidate.id === teamId);
    if (!team) throw new Error("智能体团队不存在或已被删除。");
    return team;
  }

  private assertUniqueName(
    snapshot: AgentTeamCatalogSnapshot,
    name: string,
    excludedId?: string
  ): void {
    const normalized = name.toLocaleLowerCase();
    if (
      snapshot.teams.some(
        (team) =>
          team.id !== excludedId && team.name.toLocaleLowerCase() === normalized
      )
    ) {
      throw new Error(`智能体团队名称“${name}”已存在。`);
    }
  }

  private availableImportedName(
    snapshot: AgentTeamCatalogSnapshot,
    sourceName: string
  ): string {
    const names = new Set(
      snapshot.teams.map((team) => team.name.toLocaleLowerCase())
    );
    if (!names.has(sourceName.toLocaleLowerCase())) return sourceName;
    for (let copy = 2; ; copy += 1) {
      const suffix = ` (${copy})`;
      const base = sourceName
        .slice(0, AGENT_TEAM_PROFILE_NAME_MAX_LENGTH - suffix.length)
        .trimEnd();
      const candidate = `${base}${suffix}`;
      if (!names.has(candidate.toLocaleLowerCase())) return candidate;
    }
  }
}
