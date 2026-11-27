import { computed, ref, watch, type Ref } from "vue";
import type { ShortAgentSubagentDefinition } from "@deepwrite/contracts";
import { clonedDrawField } from "./agentTeamDrawDraft";
import { agentTeamDraftSignature } from "./agentTeamSettingsEditorHelpers";

interface DraftTeam<ParentId extends string> {
  parentAgentId: ParentId;
  subagents: ShortAgentSubagentDefinition[];
}

interface TeamSettingsLike<ParentId extends string> {
  parallelSubagents?: boolean;
  teams: readonly {
    parentAgentId: ParentId;
    subagents: readonly ShortAgentSubagentDefinition[];
  }[];
}

export function removeDraftSubagent(
  team: DraftTeam<string> | undefined,
  editingSubagentId: Ref<string | null>,
  index: number
): boolean {
  const [removed] = team?.subagents.splice(index, 1) ?? [];
  if (!removed) return false;
  if (editingSubagentId.value === removed.id) editingSubagentId.value = null;
  return true;
}

/** An editable copy of saved teams, with every optional model field normalized. */
export function cloneAgentTeams<ParentId extends string>(
  teams: TeamSettingsLike<ParentId>["teams"]
): DraftTeam<ParentId>[] {
  return teams.map((team) => ({
    parentAgentId: team.parentAgentId,
    subagents: team.subagents.map((definition) => ({
      ...definition,
      ...clonedDrawField(definition.draw),
      agentMode: definition.agentMode ?? "standard",
      modelMode: definition.modelMode ?? "inherit",
      ...(definition.modelId ? { modelId: definition.modelId } : {}),
      ...(definition.thinkingLevel !== undefined
        ? { thinkingLevel: definition.thinkingLevel }
        : {}),
      ...(definition.temperature !== undefined
        ? { temperature: definition.temperature }
        : {})
    }))
  }));
}

/**
 * Draft state for a team settings panel. The draft is re-seeded only when the
 * saved settings really change, and never over unsaved edits.
 */
export function useAgentTeamDraft<ParentId extends string>(options: {
  settings: () => TeamSettingsLike<ParentId> | null | undefined;
  onReseed: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const draftTeams = ref([]) as Ref<DraftTeam<ParentId>[]>;
  const draftParallelSubagents = ref(false);
  const baselineSignature = ref("");
  let seeded = false;
  const dirty = computed(
    () =>
      agentTeamDraftSignature(
        draftParallelSubagents.value,
        draftTeams.value
      ) !== baselineSignature.value
  );

  function syncDraft(force = false): void {
    const settings = options.settings();
    const parallel = settings?.parallelSubagents ?? false;
    const teams = settings ? cloneAgentTeams(settings.teams) : [];
    const signature = agentTeamDraftSignature(parallel, teams);
    if (!force && seeded && signature === baselineSignature.value) return;
    if (
      !force &&
      seeded &&
      dirty.value &&
      signature !==
        agentTeamDraftSignature(draftParallelSubagents.value, draftTeams.value)
    ) {
      return;
    }
    seeded = true;
    draftParallelSubagents.value = parallel;
    draftTeams.value = teams;
    baselineSignature.value = signature;
    options.onReseed();
  }

  watch(options.settings, () => syncDraft(), { immediate: true, deep: true });
  watch(dirty, options.onDirtyChange, { immediate: true });

  return {
    draftTeams,
    draftParallelSubagents,
    dirty,
    discardChanges: () => syncDraft(true)
  };
}
