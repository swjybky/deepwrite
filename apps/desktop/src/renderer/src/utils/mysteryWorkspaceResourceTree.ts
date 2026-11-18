import type {
  MysteryDocumentTarget,
  MysteryStageId,
  MysteryWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { mysteryLabels } from "../features/mystery/mysterySharedLabels";
import { mysteryDocumentResourceId } from "../stores/mysteryWorkspaceStore";
import type { IconName, ResourceTreeNode } from "../types/workspace";

const stagePresentation = {
  truth: ["stageTruth", "brain"],
  characters: ["stageCharacters", "user"],
  scripts: ["stageScripts", "book"],
  clues: ["stageClues", "search"],
  dm: ["stageDm", "ledger"]
} as const satisfies Record<
  MysteryStageId,
  readonly [Parameters<typeof mysteryLabels>[0], IconName]
>;

export function mysteryStagePresentation(stage: MysteryStageId) {
  const [label, icon] = stagePresentation[stage];
  return { label: mysteryLabels(label), icon };
}

export function buildMysteryWorkspaceResourceTree(
  index: MysteryWorkspaceIndexSnapshot
): ResourceTreeNode[] {
  const bookId = index.bookId;
  const document = (
    target: MysteryDocumentTarget,
    label: string,
    count: number
  ): ResourceTreeNode => ({
    id: mysteryDocumentResourceId(bookId, target),
    label,
    icon: "file",
    badge: String(count),
    workspaceType: "mystery",
    mysteryBookId: bookId,
    mysteryTarget: target
  });
  const stage = (
    id: MysteryStageId,
    children: ResourceTreeNode[],
    collection?: ResourceTreeNode["mysteryCollection"]
  ): ResourceTreeNode => ({
    id: `mystery-stage:${encodeURIComponent(bookId)}:${id}`,
    ...mysteryStagePresentation(id),
    workspaceType: "mystery",
    mysteryBookId: bookId,
    children,
    ...(collection ? { mysteryCollection: collection } : {})
  });
  const item = (
    kind: NonNullable<ResourceTreeNode["mysteryItem"]>["kind"],
    id: string,
    title: string,
    position: number,
    deleteDisabled = false
  ): NonNullable<ResourceTreeNode["mysteryItem"]> => ({
    kind,
    id,
    title,
    moveUpDisabled: position === 0,
    deleteDisabled
  });
  return [
    stage(
      "truth",
      [
        ...index.truthDocuments.map((doc, position) => ({
          ...document(
            { kind: "truth_doc", docId: doc.id },
            doc.title,
            doc.charCount
          ),
          ...(!doc.builtin
            ? { mysteryItem: item("truth_doc", doc.id, doc.title, position) }
            : {})
        })),
        document(
          { kind: "agents_md" },
          mysteryLabels("agentsMdItem"),
          index.agentsMdChars
        )
      ],
      "truth_doc"
    ),
    stage(
      "characters",
      [
        document(
          { kind: "character_relations" },
          mysteryLabels("characterRelationsItem"),
          index.characterRelations.charCount
        ),
        ...index.roles.map((role, position) => ({
          id: `mystery-role:${encodeURIComponent(bookId)}:${role.id}`,
          label: role.name,
          icon: "folder" as const,
          workspaceType: "mystery" as const,
          mysteryBookId: bookId,
          mysteryItem: {
            ...item(
              "role",
              role.id,
              role.name,
              position,
              index.roles.length <= 1
            ),
            tag: role.tag
          },
          children: [
            document(
              { kind: "role", roleId: role.id, document: "profile" },
              mysteryLabels("roleProfileTab"),
              role.profileChars
            ),
            document(
              { kind: "role", roleId: role.id, document: "pitch" },
              mysteryLabels("rolePitchTab"),
              role.pitchChars
            )
          ]
        }))
      ],
      "role"
    ),
    stage(
      "scripts",
      index.roles.map((role) => ({
        id: `mystery-scripts:${encodeURIComponent(bookId)}:${role.id}`,
        label: role.name,
        icon: "folder",
        workspaceType: "mystery",
        mysteryBookId: bookId,
        children: index.acts.map((act, position) => {
          const cell = index.actMatrix.find(
            (entry) => entry.roleId === role.id && entry.actId === act.id
          );
          return {
            id: `mystery-act:${encodeURIComponent(bookId)}:${role.id}:${act.id}`,
            label: act.title,
            icon: "folder",
            workspaceType: "mystery",
            mysteryBookId: bookId,
            mysteryItem: item(
              "act",
              act.id,
              act.title,
              position,
              index.acts.length <= 1
            ),
            children: [
              document(
                {
                  kind: "player_act",
                  roleId: role.id,
                  actId: act.id,
                  document: "brief"
                },
                mysteryLabels("actBriefTab"),
                cell?.briefChars ?? 0
              ),
              document(
                {
                  kind: "player_act",
                  roleId: role.id,
                  actId: act.id,
                  document: "body"
                },
                mysteryLabels("actBodyTab"),
                cell?.bodyChars ?? 0
              )
            ]
          };
        })
      })),
      "act"
    ),
    stage(
      "clues",
      [
        document(
          { kind: "public_doc", docId: "public_openings" },
          mysteryLabels("publicOpeningsItem"),
          index.publicOpenings.charCount
        ),
        ...index.clueRounds.map((round, position) => ({
          ...document(
            { kind: "clue_round", roundId: round.id },
            round.title,
            round.charCount
          ),
          mysteryItem: item("clue_round", round.id, round.title, position)
        })),
        document(
          { kind: "public_doc", docId: "endings" },
          mysteryLabels("endingsItem"),
          index.endings.charCount
        )
      ],
      "clue_round"
    ),
    stage("dm", [
      document(
        { kind: "dm_manual" },
        mysteryLabels("dmManualItem"),
        index.dmManual.charCount
      )
    ])
  ];
}
