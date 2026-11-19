<script setup lang="ts">
import { computed } from "vue";
import type {
  MysteryDocumentTarget,
  MysteryStageId,
  MysteryWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import AppIcon from "../../components/AppIcon.vue";
import EditorPaneToggle from "../../components/EditorPaneToggle.vue";
import { mysteryDocumentResourceId } from "../../stores/mysteryWorkspaceStore";
import { mysteryStagePresentation } from "../../utils/mysteryWorkspaceResourceTree";
import { mysteryT } from "./messages";
import { mysteryLabels } from "./mysterySharedLabels";

const props = defineProps<{
  index: MysteryWorkspaceIndexSnapshot;
  stage: MysteryStageId;
  leftCollapsed: boolean;
  rightPane: boolean;
  rightPaneCollapsed: boolean;
}>();
const emit = defineEmits<{
  openResource: [id: string];
  expandLeft: [];
  toggleRight: [];
}>();

type OverviewLink = {
  id: string;
  label: string;
  count: number;
};
type OverviewGroup = {
  id: string;
  title?: string;
  tag?: string;
  links: OverviewLink[];
};

const heading = computed(() => mysteryStagePresentation(props.stage).label);
const link = (
  target: MysteryDocumentTarget,
  label: string,
  count: number
): OverviewLink => ({
  id: mysteryDocumentResourceId(props.index.bookId, target),
  label,
  count
});

const groups = computed<OverviewGroup[]>(() => {
  const index = props.index;
  function row(
    target: MysteryDocumentTarget,
    title: string,
    count: number
  ): OverviewGroup {
    const document = link(target, title, count);
    return { id: document.id, links: [document] };
  }

  switch (props.stage) {
    case "truth":
      return index.truthDocuments.map((doc) =>
        row({ kind: "truth_doc", docId: doc.id }, doc.title, doc.charCount)
      );
    case "characters":
      return [
        row(
          { kind: "character_relations" },
          mysteryLabels("characterRelationsItem"),
          index.characterRelations.charCount
        ),
        ...index.roles.map((role) => ({
          id: role.id,
          title: role.name,
          tag: role.tag,
          links: [
            link(
              { kind: "role", roleId: role.id, document: "pitch" },
              mysteryLabels("rolePitchTab"),
              role.pitchChars
            ),
            link(
              { kind: "role", roleId: role.id, document: "profile" },
              mysteryLabels("roleProfileTab"),
              role.profileChars
            )
          ]
        }))
      ];
    case "clues":
      return [
        row(
          { kind: "public_doc", docId: "public_openings" },
          mysteryLabels("publicOpeningsItem"),
          index.publicOpenings.charCount
        ),
        ...index.clueRounds.map((round) =>
          row(
            { kind: "clue_round", roundId: round.id },
            round.title,
            round.charCount
          )
        ),
        row(
          { kind: "public_doc", docId: "endings" },
          mysteryLabels("endingsItem"),
          index.endings.charCount
        )
      ];
    case "dm":
      return [
        row(
          { kind: "dm_manual" },
          mysteryLabels("dmManualItem"),
          index.dmManual.charCount
        )
      ];
    default:
      return [];
  }
});

const matrix = computed(() => {
  if (props.stage !== "scripts") return [];
  const { actMatrix, roles, acts } = props.index;
  const byCell = new Map(
    actMatrix.map((cell) => [`${cell.roleId}:${cell.actId}`, cell])
  );
  return roles.map((role) => ({
    role,
    cells: acts.map((act) => {
      const stats = byCell.get(`${role.id}:${act.id}`);
      return {
        actId: act.id,
        documents: [
          link(
            {
              kind: "player_act",
              roleId: role.id,
              actId: act.id,
              document: "brief"
            },
            mysteryT("matrixBrief"),
            stats?.briefChars ?? 0
          ),
          link(
            {
              kind: "player_act",
              roleId: role.id,
              actId: act.id,
              document: "body"
            },
            mysteryT("matrixScript"),
            stats?.bodyChars ?? 0
          )
        ]
      };
    })
  }));
});

function contentStatus(count: number): string {
  return count ? mysteryT("charsCount", { count }) : mysteryT("unwritten");
}
</script>

<template>
  <aside
    class="editor-pane mystery-overview"
    data-workspace-type="mystery"
    :aria-label="heading"
  >
    <div class="editor-toolbar">
      <div class="editor-toolbar-actions">
        <button
          v-if="leftCollapsed && !rightPane"
          type="button"
          class="icon-button"
          :aria-label="mysteryT('expandStages')"
          @click="emit('expandLeft')"
        >
          <AppIcon name="panel-left" :size="18" />
        </button>
        <h2>{{ heading }}</h2>
      </div>
      <EditorPaneToggle
        :right-pane="rightPane"
        :right-pane-collapsed="rightPaneCollapsed"
        @collapse="emit('toggleRight')"
        @toggle-right="emit('toggleRight')"
      />
    </div>

    <div class="mystery-overview-content">
      <div
        v-if="stage === 'scripts'"
        class="mystery-overview-matrix"
        :aria-label="heading"
        role="region"
        tabindex="0"
      >
        <table :aria-label="heading">
          <thead>
            <tr>
              <th scope="col">{{ mysteryT("roles") }}</th>
              <th v-for="act in index.acts" :key="act.id" scope="col">
                {{ act.title }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="{ role, cells } in matrix" :key="role.id">
              <th scope="row">{{ role.name }}</th>
              <td v-for="cell in cells" :key="cell.actId">
                <button
                  v-for="document in cell.documents"
                  :key="document.id"
                  class="mystery-overview-link"
                  type="button"
                  @click="emit('openResource', document.id)"
                >
                  <span>{{ document.label }}</span>
                  <small>{{ contentStatus(document.count) }}</small>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul v-else class="mystery-overview-list">
        <li v-for="group in groups" :key="group.id">
          <div v-if="group.title" class="mystery-overview-role">
            <h3>{{ group.title }}</h3>
            <span v-if="group.tag">{{ group.tag }}</span>
          </div>
          <button
            v-for="document in group.links"
            :key="document.id"
            class="mystery-overview-link"
            type="button"
            @click="emit('openResource', document.id)"
          >
            <AppIcon name="file" :size="15" />
            <span>{{ document.label }}</span>
            <small>{{ contentStatus(document.count) }}</small>
          </button>
        </li>
      </ul>
    </div>
  </aside>
</template>

<style scoped>
.mystery-overview {
  grid-template-rows: minmax(40px, auto) minmax(0, 1fr);
}

.mystery-overview h2 {
  margin: 0;
  padding-inline: 4px;
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 600;
}

.mystery-overview-content {
  min-width: 0;
  overflow: auto;
  padding: 16px;
}

.mystery-overview-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.mystery-overview-list li {
  overflow: hidden;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-raised);
}

.mystery-overview-role {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--theme-line-soft);
  overflow-wrap: anywhere;
}

.mystery-overview-role h3 {
  margin: 0;
  font-size: 1rem;
}

.mystery-overview-role span,
.mystery-overview-link small {
  color: var(--text-secondary);
  font-size: 0.785714rem;
}

.mystery-overview-link {
  display: flex;
  width: 100%;
  min-height: 32px;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.mystery-overview-link:hover {
  background: var(--surface-hover);
}

.mystery-overview-link span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.mystery-overview-link small {
  flex: 0 0 auto;
}

.mystery-overview-list .mystery-overview-link + .mystery-overview-link {
  border-top: 1px solid var(--theme-line-soft);
}

.mystery-overview-matrix {
  overflow: auto;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
}

.mystery-overview-matrix table {
  width: 100%;
  border-collapse: collapse;
}

.mystery-overview-matrix th {
  min-width: 5rem;
  max-width: 10rem;
  padding: 8px 10px;
  background: var(--surface-muted);
  overflow-wrap: anywhere;
  text-align: start;
}

.mystery-overview-matrix th:first-child {
  position: sticky;
  z-index: 1;
  left: 0;
}

.mystery-overview-matrix td {
  min-width: 8rem;
  padding: 3px;
  background: var(--surface-raised);
}

.mystery-overview-matrix td,
.mystery-overview-matrix th {
  border-bottom: 1px solid var(--theme-line-soft);
}

.mystery-overview-matrix td + td,
.mystery-overview-matrix th + th,
.mystery-overview-matrix td:first-of-type {
  border-left: 1px solid var(--theme-line-soft);
}
</style>
