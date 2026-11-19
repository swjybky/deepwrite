import type {
  MysteryDocumentTarget,
  MysteryStageId,
  MysteryWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { mysteryLabels } from "../features/mystery/mysterySharedLabels";
import {
  mysteryDocumentResourceId,
  mysteryStageResourceId
} from "../stores/mysteryWorkspaceStore";
import type { IconName, ResourceTreeNode } from "../types/workspace";

type StructureItem = NonNullable<ResourceTreeNode["mysteryItem"]>;
type Collection = StructureItem["kind"];

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

export function mysteryStructureItems(
  index: MysteryWorkspaceIndexSnapshot
): Record<Collection, StructureItem[]> {
  function item(
    kind: Collection,
    id: string,
    title: string,
    position: number,
    length: number,
    deleteDisabled = false
  ): StructureItem {
    return {
      kind,
      id,
      title,
      moveUpDisabled: position === 0,
      moveDownDisabled: position === length - 1,
      deleteDisabled
    };
  }

  return {
    truth_doc: index.truthDocuments.map((doc, position) => ({
      ...item(
        "truth_doc",
        doc.id,
        doc.title,
        position,
        index.truthDocuments.length,
        doc.builtin
      ),
      renameDisabled: doc.builtin
    })),
    role: index.roles.map((role, position) => ({
      ...item(
        "role",
        role.id,
        role.name,
        position,
        index.roles.length,
        index.roles.length <= 1
      ),
      tag: role.tag
    })),
    act: index.acts.map((act, position) =>
      item(
        "act",
        act.id,
        act.title,
        position,
        index.acts.length,
        index.acts.length <= 1
      )
    ),
    clue_round: index.clueRounds.map((round, position) =>
      item(
        "clue_round",
        round.id,
        round.title,
        position,
        index.clueRounds.length
      )
    )
  };
}

export function buildMysteryWorkspaceResourceTree(
  index: MysteryWorkspaceIndexSnapshot
): ResourceTreeNode[] {
  const bookId = index.bookId;
  const items = mysteryStructureItems(index);
  const document = (
    target: MysteryDocumentTarget,
    label: string
  ): ResourceTreeNode => ({
    id: mysteryDocumentResourceId(bookId, target),
    label,
    icon: "file",
    workspaceType: "mystery",
    mysteryBookId: bookId,
    mysteryTarget: target
  });
  const stage = (
    id: MysteryStageId,
    children: ResourceTreeNode[],
    collection?: Collection
  ): ResourceTreeNode => ({
    id: mysteryStageResourceId(bookId, id),
    ...mysteryStagePresentation(id),
    workspaceType: "mystery",
    mysteryBookId: bookId,
    mysteryStage: id,
    selectableBranch: true,
    children,
    ...(collection ? { mysteryCollection: collection } : {})
  });

  return [
    stage(
      "truth",
      items.truth_doc.map((doc) => ({
        ...document({ kind: "truth_doc", docId: doc.id }, doc.title),
        ...(!doc.renameDisabled ? { mysteryItem: doc } : {})
      })),
      "truth_doc"
    ),
    stage(
      "characters",
      [
        document(
          { kind: "character_relations" },
          mysteryLabels("characterRelationsItem")
        ),
        ...items.role.map((role) => ({
          id: `mystery-role:${encodeURIComponent(bookId)}:${role.id}`,
          label: role.title,
          icon: "folder" as const,
          workspaceType: "mystery" as const,
          mysteryBookId: bookId,
          mysteryItem: role,
          children: [
            document(
              { kind: "role", roleId: role.id, document: "profile" },
              mysteryLabels("roleProfileTab")
            ),
            document(
              { kind: "role", roleId: role.id, document: "pitch" },
              mysteryLabels("rolePitchTab")
            )
          ]
        }))
      ],
      "role"
    ),
    stage(
      "scripts",
      items.role.map((role) => ({
        id: `mystery-scripts:${encodeURIComponent(bookId)}:${role.id}`,
        label: role.title,
        icon: "folder",
        workspaceType: "mystery",
        mysteryBookId: bookId,
        children: items.act.map((act) => ({
          id: `mystery-act:${encodeURIComponent(bookId)}:${role.id}:${act.id}`,
          label: act.title,
          icon: "folder",
          workspaceType: "mystery",
          mysteryBookId: bookId,
          mysteryItem: act,
          children: [
            document(
              {
                kind: "player_act",
                roleId: role.id,
                actId: act.id,
                document: "brief"
              },
              mysteryLabels("actBriefTab")
            ),
            document(
              {
                kind: "player_act",
                roleId: role.id,
                actId: act.id,
                document: "body"
              },
              mysteryLabels("actBodyTab")
            )
          ]
        }))
      })),
      "act"
    ),
    stage(
      "clues",
      [
        document(
          { kind: "public_doc", docId: "public_openings" },
          mysteryLabels("publicOpeningsItem")
        ),
        ...items.clue_round.map((round) => ({
          ...document({ kind: "clue_round", roundId: round.id }, round.title),
          mysteryItem: round
        })),
        document(
          { kind: "public_doc", docId: "endings" },
          mysteryLabels("endingsItem")
        )
      ],
      "clue_round"
    ),
    stage("dm", [
      document({ kind: "dm_manual" }, mysteryLabels("dmManualItem"))
    ])
  ];
}
