import { withConfigurationLock } from "./configuration-lock";
import {
  BuiltinSubagentSettingsSchema,
  type BuiltinSubagentSettings
} from "@deepwrite/contracts";
import { join } from "node:path";
import { applyActiveTeamChange } from "./agent-team-active-management";
import type {
  AgentTeamChange,
  AgentTeamModelChoice
} from "@deepwrite/contracts";
import {
  ACADEMIC_AGENT_SUBAGENT_MAX_COUNT,
  AGENT_TEAM_PROFILE_NAME_MAX_LENGTH,
  AcademicAgentIdSchema,
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
  MysteryAgentIdSchema,
  SHORT_AGENT_SUBAGENT_MAX_COUNT,
  ScriptWorkspaceAgentIdSchema,
  ShortWorkspaceAgentIdSchema,
  type LongAgentId,
  type MysteryAgentId,
  activeAgentTeamMembers,
  activeAgentTeams,
  activeAgentTeamsParallel,
  withoutAgentTeamBindings,
  type AcademicAgentId,
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
  createAgentTeamProfile,
  createCatalogFromLegacyFiles,
  invalidAgentTeamConfig,
  readAgentTeamJson,
  tryMigrateCombinedCatalog,
  tryMigrateStandaloneCatalog,
  type AgentTeamDiskCatalog
} from "./agent-team-config-migration";
import { getBuiltinAgentTeams } from "./builtin-agent-teams";
import { defaultAgentTeamName } from "./agent-team-profile-factory";
import {
  readAgentTeamBookBindings,
  withAgentTeamBookBinding,
  writeAgentTeamBookBindings
} from "./agent-team-book-binding-file";
import { writeJsonAtomic } from "@deepwrite/shared/node";
import { isBuiltinAgentTeamId } from "@deepwrite/contracts";

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

  private seedMissingDefaultTeams(snapshot: AgentTeamCatalogSnapshot): boolean {
    let changed = false;
    for (const workspaceType of ["academic", "mystery"] as const) {
      if (snapshot.teams.some((team) => team.workspaceType === workspaceType)) {
        continue;
      }
      snapshot.teams.push(
        createAgentTeamProfile(
          workspaceType,
          this.availableImportedName(
            snapshot,
            defaultAgentTeamName(workspaceType)
          )
        )
      );
      changed = true;
    }
    return changed;
  }

  private mergeBuiltinTeams(
    stored: { teams?: unknown } & Record<string, unknown>
  ): { merged: Record<string, unknown>; changed: boolean } {
    const builtins = getBuiltinAgentTeams();
    const rawTeams = Array.isArray(stored.teams) ? stored.teams : [];
    const userTeams: unknown[] = [];
    let changed = false;
    for (const candidate of rawTeams) {
      if (!candidate || typeof candidate !== "object") {
        userTeams.push(candidate);
        continue;
      }
      const record = { ...(candidate as Record<string, unknown>) };
      if (
        (typeof record.id === "string" && isBuiltinAgentTeamId(record.id)) ||
        record.isBuiltin === true
      ) {
        changed = true;
        continue;
      }
      userTeams.push(record);
    }
    const occupiedNames = new Set(
      builtins.map((team) => team.name.toLocaleLowerCase())
    );
    for (const entry of userTeams) {
      if (!entry || typeof entry !== "object") continue;
      const userTeam = entry as Record<string, unknown>;
      if (typeof userTeam.name !== "string") continue;
      const trimmed = userTeam.name.trim();
      const lower = trimmed.toLocaleLowerCase();
      if (occupiedNames.has(lower)) {
        const renamed = nextAvailableTeamName(
          occupiedNames,
          `${trimmed} (本地)`
        );
        userTeam.name = renamed;
        occupiedNames.add(renamed.toLocaleLowerCase());
        changed = true;
      } else {
        occupiedNames.add(lower);
      }
    }
    return {
      merged: {
        ...stored,
        teams: [...userTeams, ...builtins]
      },
      changed
    };
  }

  private sortBuiltinsLast(snapshot: AgentTeamCatalogSnapshot): void {
    snapshot.teams = [
      ...snapshot.teams.filter(
        (team) => !team.isBuiltin && !isBuiltinAgentTeamId(team.id)
      ),
      ...snapshot.teams.filter(
        (team) => team.isBuiltin || isBuiltinAgentTeamId(team.id)
      )
    ];
  }

  private async readSnapshot(): Promise<AgentTeamCatalogSnapshot> {
    const raw = await readAgentTeamJson(this.settingsPath);
    if (raw === undefined) {
      const legacy = await this.readLegacyFiles();
      this.seedMissingDefaultTeams(legacy);
      const { merged } = this.mergeBuiltinTeams({ ...legacy });
      const snapshot = AgentTeamCatalogSnapshotSchema.parse(merged);
      await this.writeSnapshot(snapshot);
      return snapshot;
    }
    if (!raw || typeof raw !== "object") throw invalidAgentTeamConfig();
    const { version, ...stored } = raw as Record<string, unknown>;
    const { merged, changed: builtinMergedChanged } =
      this.mergeBuiltinTeams(stored);
    const current = AgentTeamCatalogSnapshotSchema.safeParse(merged);
    if (current.success) {
      const upgraded = current.data;
      const seeded =
        (typeof version !== "number" ||
          version < AGENT_TEAM_CATALOG_DISK_VERSION) &&
        this.seedMissingDefaultTeams(upgraded);
      if (seeded) {
        this.sortBuiltinsLast(upgraded);
      }
      if (
        version !== AGENT_TEAM_CATALOG_DISK_VERSION ||
        seeded ||
        builtinMergedChanged
      ) {
        await this.writeSnapshot(upgraded);
      }
      return upgraded;
    }
    const migrated =
      tryMigrateCombinedCatalog(stored) ?? tryMigrateStandaloneCatalog(stored);
    if (migrated) {
      this.seedMissingDefaultTeams(migrated);
      const { merged: mergedMigrated } = this.mergeBuiltinTeams({
        ...migrated
      });
      const finalized = AgentTeamCatalogSnapshotSchema.parse(mergedMigrated);
      await this.writeSnapshot(finalized);
      return finalized;
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
    await writeJsonAtomic(this.settingsPath, {
      version: AGENT_TEAM_CATALOG_DISK_VERSION,
      ...profiles,
      teams: profiles.teams.filter(
        (team) => !team.isBuiltin && !isBuiltinAgentTeamId(team.id)
      )
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
      this.sortBuiltinsLast(snapshot);
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

  async applyActiveChange(
    input: AgentTeamChange,
    models: readonly AgentTeamModelChoice[]
  ): Promise<AgentTeamCatalogSnapshot> {
    return this.queue(async () => {
      const snapshot = await this.readSnapshot();
      const bindings = await readAgentTeamBookBindings(this.bookBindingsPath);
      applyActiveTeamChange(snapshot, bindings, input, models);
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
      const team = this.requireTeam(snapshot, input.teamId);
      if (team.isBuiltin || isBuiltinAgentTeamId(team.id)) {
        throw new Error("内置智能体团队不能重命名，请先复制后再自定义。");
      }
      team.name = input.name;
      this.assertUniqueName(snapshot, input.name, input.teamId);
    });
  }

  async delete(
    rawInput: AgentTeamProfileTargetInput
  ): Promise<AgentTeamCatalogSnapshot> {
    const input = AgentTeamProfileTargetInputSchema.parse(rawInput);
    await this.mutate((snapshot) => {
      const team = this.requireTeam(snapshot, input.teamId);
      if (team.isBuiltin || isBuiltinAgentTeamId(team.id)) {
        throw new Error("内置智能体团队不能删除。");
      }
      if (snapshot.enabledTeamIds[team.workspaceType] === team.id) {
        throw new Error("已启用的团队不能删除，请先关闭该团队。");
      }
      const editableCount = snapshot.teams.filter(
        (candidate) =>
          !candidate.isBuiltin && !isBuiltinAgentTeamId(candidate.id)
      ).length;
      if (editableCount <= 1) throw new Error("至少需要保留一个智能体团队。");
      snapshot.teams = snapshot.teams.filter(
        (candidate) => candidate.id !== team.id
      );
    });
    return this.updateBookBindings((bindings) =>
      withoutAgentTeamBindings(bindings, input.teamId)
    );
  }

  async duplicate(
    rawInput: AgentTeamProfileTargetInput
  ): Promise<AgentTeamCatalogSnapshot> {
    const input = AgentTeamProfileTargetInputSchema.parse(rawInput);
    return this.mutate((snapshot) => {
      const source = this.requireTeam(snapshot, input.teamId);
      const copyBase =
        source.name.length + 3 <= AGENT_TEAM_PROFILE_NAME_MAX_LENGTH
          ? `${source.name} 副本`
          : source.name;
      snapshot.teams.push(
        createAgentTeamProfile(
          source.workspaceType,
          this.availableImportedName(snapshot, copyBase),
          source.settings
        )
      );
    });
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
      if (team.isBuiltin || isBuiltinAgentTeamId(team.id)) {
        throw new Error("内置智能体团队不能修改，请先复制后再自定义。");
      }
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
    // The plaza origin and built-in marker are local bookkeeping; packages stay readable by older versions.
    const {
      marketplaceSource: _source,
      isBuiltin: _builtin,
      ...team
    } = this.requireTeam(await this.list(), input.teamId);
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
    rawParentAgentId:
      WorkspaceAgentId | LongAgentId | AcademicAgentId | MysteryAgentId,
    bookId?: string
  ): Promise<ShortAgentSubagentDefinition[]> {
    const active = activeAgentTeams(await this.list(), workspaceType, bookId);
    if (active.source === "enabled" && active.teams.length === 0) return [];
    const parentAgentId =
      workspaceType === "long"
        ? LongAgentIdSchema.parse(rawParentAgentId)
        : workspaceType === "academic"
          ? AcademicAgentIdSchema.parse(rawParentAgentId)
          : workspaceType === "mystery"
            ? MysteryAgentIdSchema.parse(rawParentAgentId)
            : workspaceType === "script"
              ? ScriptWorkspaceAgentIdSchema.parse(rawParentAgentId)
              : ShortWorkspaceAgentIdSchema.parse(rawParentAgentId);
    const members = activeAgentTeamMembers(active, parentAgentId);
    if (active.source === "bound" && members.length === 0) {
      throw new Error(
        "本作品绑定的智能体团队已失效或没有当前智能体可用的成员，请在作品菜单的“团队绑定”中调整。"
      );
    }
    const maxCount =
      workspaceType === "academic"
        ? ACADEMIC_AGENT_SUBAGENT_MAX_COUNT
        : SHORT_AGENT_SUBAGENT_MAX_COUNT;
    if (members.length > maxCount) {
      throw new Error(
        `本作品绑定的团队合计 ${members.length} 个成员，超过单次运行 ${maxCount} 个的上限，请减少绑定的团队或关闭部分成员。`
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
    return nextAvailableTeamName(names, sourceName);
  }
}

function nextAvailableTeamName(
  names: ReadonlySet<string>,
  sourceName: string
): string {
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
