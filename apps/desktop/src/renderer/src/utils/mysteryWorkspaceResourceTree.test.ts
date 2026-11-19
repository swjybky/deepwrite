import { describe, expect, it } from "vitest";
import {
  buildEmptyMysteryWorkspaceIndex,
  createDefaultMysteryTruthDocuments,
  mysteryDocumentTargetKey
} from "@deepwrite/contracts";
import type { ResourceTreeNode } from "../types/workspace";
import {
  buildMysteryWorkspaceResourceTree,
  mysteryStructureItems
} from "./mysteryWorkspaceResourceTree";

function fixture() {
  return buildEmptyMysteryWorkspaceIndex({
    kind: "deepwrite.mystery-book",
    schemaVersion: 1,
    id: "mystery_tree",
    title: "树形目录验证",
    genre: "硬核推理",
    status: "editing",
    boardSpec: {
      playerCount: 6,
      actCountTarget: 3,
      narrativePerson: "second",
      summary: ""
    },
    linkedMaterialIds: [],
    linkedSkillIds: [],
    truthDocuments: createDefaultMysteryTruthDocuments(),
    roles: [
      { id: "role_one", name: "角色一", tag: "医生", order: 1 },
      { id: "role_two", name: "角色二", tag: "", order: 2 }
    ],
    acts: [
      { id: "act_one", title: "第一幕", order: 1 },
      { id: "act_two", title: "第二幕", order: 2 }
    ],
    clueRounds: [{ id: "round_one", title: "第一轮搜证", order: 1 }],
    revision: 1,
    createdAt: "2026-11-18T00:00:00.000Z",
    updatedAt: "2026-11-18T00:00:00.000Z"
  });
}

function flatten(nodes: readonly ResourceTreeNode[]): ResourceTreeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

describe("mystery resource tree", () => {
  it("lists each manuscript once and leaves the writing context in management", () => {
    const index = fixture();
    const stages = buildMysteryWorkspaceResourceTree(index);
    expect(stages.map(({ icon }) => icon)).toEqual([
      "brain",
      "user",
      "book",
      "search",
      "ledger"
    ]);
    expect(stages.map(({ mysteryStage }) => mysteryStage)).toEqual([
      "truth",
      "characters",
      "scripts",
      "clues",
      "dm"
    ]);
    expect(stages.every(({ selectableBranch }) => selectableBranch)).toBe(true);
    const nodes = flatten(stages);
    expect(nodes.every(({ badge }) => badge === undefined)).toBe(true);
    expect(new Set(nodes.map(({ id }) => id)).size).toBe(nodes.length);
    const targets = nodes.flatMap(({ mysteryTarget }) =>
      mysteryTarget ? [mysteryTarget] : []
    );
    expect(targets).toHaveLength(20);
    expect(targets).not.toContainEqual({ kind: "agents_md" });
    expect(new Set(targets.map(mysteryDocumentTargetKey)).size).toBe(
      targets.length
    );
    for (const role of index.roles) {
      for (const act of index.acts) {
        for (const document of ["brief", "body"] as const) {
          expect(targets).toContainEqual({
            kind: "player_act",
            roleId: role.id,
            actId: act.id,
            document
          });
        }
      }
    }
    expect(
      nodes.every(({ mysteryBookId }) => mysteryBookId === index.bookId)
    ).toBe(true);
  });

  it("preserves role and act identity when names change, without adding document counters to the tree", () => {
    const index = fixture();
    index.actMatrix[0]!.bodyChars = 123;
    const before = flatten(buildMysteryWorkspaceResourceTree(index));
    index.roles[0]!.name = "新角色名";
    index.acts[0]!.title = "新幕名";
    const after = flatten(buildMysteryWorkspaceResourceTree(index));
    expect(after.map(({ id }) => id)).toEqual(before.map(({ id }) => id));
    const body = after.find(
      ({ mysteryTarget }) =>
        mysteryTarget?.kind === "player_act" &&
        mysteryTarget.roleId === "role_one" &&
        mysteryTarget.actId === "act_one" &&
        mysteryTarget.document === "body"
    );
    expect(body).toBeDefined();
    expect(body?.badge).toBeUndefined();
    expect(
      after.find(({ mysteryItem }) => mysteryItem?.kind === "role")?.mysteryItem
        ?.tag
    ).toBe("医生");
  });

  it("shares movement boundaries between the tree and structure manager", () => {
    const index = fixture();
    const { role, act, clue_round } = mysteryStructureItems(index);
    expect(role[0]).toMatchObject({
      moveUpDisabled: true,
      moveDownDisabled: false
    });
    expect(role[1]).toMatchObject({
      moveUpDisabled: false,
      moveDownDisabled: true
    });
    expect(clue_round[0]).toMatchObject({
      moveUpDisabled: true,
      moveDownDisabled: true
    });
    const lastActs = flatten(buildMysteryWorkspaceResourceTree(index)).flatMap(
      ({ mysteryItem }) => (mysteryItem?.id === act[1]?.id ? [mysteryItem] : [])
    );
    expect(lastActs).toEqual(index.roles.map(() => act[1]));
  });

  it("keeps built-in truth documents immutable and protects the last role and act", () => {
    const index = fixture();
    index.roles = index.roles.slice(0, 1);
    index.acts = index.acts.slice(0, 1);
    const nodes = flatten(buildMysteryWorkspaceResourceTree(index));
    expect(
      nodes
        .filter(({ mysteryTarget }) => mysteryTarget?.kind === "truth_doc")
        .every(({ mysteryItem }) => !mysteryItem)
    ).toBe(true);
    const items = nodes.flatMap(({ mysteryItem }) =>
      mysteryItem ? [mysteryItem] : []
    );
    expect(
      items
        .filter(({ kind }) => kind === "role" || kind === "act")
        .every(({ deleteDisabled }) => deleteDisabled)
    ).toBe(true);
  });
});
