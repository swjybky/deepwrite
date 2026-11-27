import { computed, ref } from "vue";
import {
  agentTeamCustomModelCount,
  agentTeamMemberCount
} from "@deepwrite/contracts/renderer";
import type {
  AgentTeamCatalogSnapshot,
  AgentTeamMarketplaceSummary,
  ShortAgentSubagentDefinition
} from "@deepwrite/contracts";
import { createScopedTranslator } from "../../i18n";
import { uiMessage } from "../../ui-feedback";
import { marketplaceAccountError } from "../../utils/marketplaceAccountError";
import type { PopupSelectOption } from "../../types/popupSelect";
import type { TeamPlazaApi } from "./useTeamPlaza";
import { workspaceTypeLabel } from "./teamPlazaLabels";

const t = createScopedTranslator("extras.agentTeamMarketplace");

export interface TeamPlazaPublishOptions {
  api(): TeamPlazaApi | undefined;
  catalog(): AgentTeamCatalogSnapshot | null;
  onSubmitted(): Promise<void>;
}

export function useTeamPlazaPublish(options: TeamPlazaPublishOptions) {
  const editing = ref<AgentTeamMarketplaceSummary | null>(null);
  const teamId = ref("");
  const title = ref("");
  const overview = ref("");
  const pending = ref(false);

  const teams = computed(() =>
    (options.catalog()?.teams ?? []).filter((team) => !team.isBuiltin)
  );
  const selectedTeam = computed(() =>
    teams.value.find((team) => team.id === teamId.value)
  );
  const teamOptions = computed<PopupSelectOption[]>(() =>
    teams.value.map((team) => {
      const count = agentTeamMemberCount(team.settings);
      return {
        value: team.id,
        label: team.name,
        description: t("localTeamOption", {
          type: workspaceTypeLabel(team.workspaceType),
          count
        }),
        // Only whole teams with members can be published.
        disabled: count === 0
      };
    })
  );
  const members = computed(() =>
    selectedTeam.value
      ? (
          selectedTeam.value.settings.teams as readonly {
            subagents: ShortAgentSubagentDefinition[];
          }[]
        ).flatMap((team) => team.subagents)
      : []
  );
  const customModelCount = computed(() =>
    selectedTeam.value
      ? agentTeamCustomModelCount(selectedTeam.value.settings)
      : 0
  );

  function selectTeam(id: string): void {
    const previousName = selectedTeam.value?.name ?? "";
    teamId.value = id;
    const name = selectedTeam.value?.name ?? "";
    if (!title.value.trim() || title.value === previousName) title.value = name;
  }

  function reset(): void {
    editing.value = null;
    teamId.value = "";
    title.value = "";
    overview.value = "";
  }

  /** Updating a publication uploads a local team as its next version. */
  function startEdit(item: AgentTeamMarketplaceSummary): void {
    editing.value = item;
    title.value = item.title;
    overview.value = item.overview;
    teamId.value =
      teams.value.find(
        (team) =>
          team.workspaceType === item.workspaceType && team.name === item.title
      )?.id ?? "";
  }

  async function submit(): Promise<void> {
    const api = options.api();
    const team = selectedTeam.value;
    if (!api || pending.value) return;
    const warning = !team
      ? t("selectTeamFirst")
      : members.value.length === 0
        ? t("teamHasNoMembers")
        : !title.value.trim()
          ? t("enterTitle")
          : "";
    if (!team || warning) {
      uiMessage.warning(warning);
      return;
    }
    const input = {
      teamId: team.id,
      title: title.value.trim(),
      overview: overview.value.trim()
    };
    const editingId = editing.value?.id;
    pending.value = true;
    try {
      if (editingId) {
        await api.agentTeamMarketplace.update({ ...input, id: editingId });
        uiMessage.success(t("updateSubmitted"));
      } else {
        const published = await api.agentTeamMarketplace.publish(input);
        if (!published.enabled) {
          uiMessage.warning(t("submittedButEnableFailed"));
        } else {
          uiMessage.success(
            published.status === "published"
              ? t("enabledPublished")
              : t("submittedForReview")
          );
        }
      }
      reset();
      await options.onSubmitted();
    } catch (error: unknown) {
      uiMessage.error(marketplaceAccountError(error, t("submitFailed")));
    } finally {
      pending.value = false;
    }
  }

  return {
    editing,
    teamId,
    title,
    overview,
    pending,
    teamOptions,
    selectedTeam,
    members,
    customModelCount,
    selectTeam,
    reset,
    startEdit,
    submit
  };
}

export type TeamPlazaPublishController = ReturnType<typeof useTeamPlazaPublish>;
