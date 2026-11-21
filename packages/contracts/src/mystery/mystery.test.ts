import { describe, expect, it } from "vitest";
import {
  CommandEnvelopeSchema,
  DEFAULT_MYSTERY_AGENT_SETTINGS,
  DEFAULT_MYSTERY_AGENT_TEAM_SETTINGS,
  MysteryBookManifestSchema,
  MysteryWorkspaceOperationError,
  buildEmptyMysteryWorkspaceIndex,
  createDefaultMysteryTruthDocuments,
  createEnvelope,
  isMysteryPlayerVisibleTarget,
  mysteryDocumentRelativePath,
  mysteryDocumentTargetKey,
  previewMysteryWorkspaceOperations
} from "../index";

function sampleManifest() {
  const now = "2026-11-17T00:00:00.000Z";
  return MysteryBookManifestSchema.parse({
    kind: "deepwrite.mystery-book",
    schemaVersion: 1,
    id: "mys_01",
    title: "雾夜钟声",
    genre: "硬核推理",
    status: "editing",
    boardSpec: {
      playerCount: 6,
      actCountTarget: 3,
      narrativePerson: "second",
      summary: "4男2女，不可反串"
    },
    linkedMaterialIds: ["mat_1"],
    linkedSkillIds: ["sk_1"],
    truthDocuments: createDefaultMysteryTruthDocuments(),
    roles: [
      { id: "role_1", name: "顾沉", tag: "管家", order: 1 },
      { id: "role_2", name: "林晚", tag: "医生", order: 2 }
    ],
    acts: [
      { id: "act_1", title: "第一幕", order: 1 },
      { id: "act_2", title: "第二幕", order: 2 }
    ],
    clueRounds: [{ id: "round_1", title: "第一轮搜证", order: 1 }],
    revision: 0,
    createdAt: now,
    updatedAt: now
  });
}

describe("mystery contracts", () => {
  it("validates manifests, player visibility and paths", () => {
    const manifest = sampleManifest();
    expect(manifest.roles).toHaveLength(2);

    expect(
      isMysteryPlayerVisibleTarget({
        kind: "player_act",
        roleId: "role_1",
        actId: "act_1",
        document: "body"
      })
    ).toBe(true);
    expect(
      isMysteryPlayerVisibleTarget({
        kind: "player_act",
        roleId: "role_1",
        actId: "act_1",
        document: "brief"
      })
    ).toBe(false);
    expect(
      isMysteryPlayerVisibleTarget({
        kind: "role",
        roleId: "role_1",
        document: "pitch"
      })
    ).toBe(true);
    expect(
      isMysteryPlayerVisibleTarget({
        kind: "role",
        roleId: "role_1",
        document: "profile"
      })
    ).toBe(false);
    expect(
      isMysteryPlayerVisibleTarget({ kind: "truth_doc", docId: "core_truth" })
    ).toBe(false);
    expect(isMysteryPlayerVisibleTarget({ kind: "dm_manual" })).toBe(false);

    expect(
      mysteryDocumentRelativePath({
        kind: "player_act",
        roleId: "role_1",
        actId: "act_1",
        document: "brief"
      })
    ).toBe("scripts/role_1/act_1.brief.md");
    expect(
      mysteryDocumentTargetKey({
        kind: "role",
        roleId: "role_1",
        document: "profile"
      })
    ).toBe("role:role_1:profile");
  });

  it("rejects invalid manifests with zero roles, duplicate orders or missing builtin docs", () => {
    const valid = sampleManifest();
    expect(
      MysteryBookManifestSchema.safeParse({ ...valid, roles: [] }).success
    ).toBe(false);
    expect(
      MysteryBookManifestSchema.safeParse({
        ...valid,
        acts: [
          { id: "a1", title: "1", order: 1 },
          { id: "a2", title: "2", order: 1 }
        ]
      }).success
    ).toBe(false);
    expect(
      MysteryBookManifestSchema.safeParse({
        ...valid,
        truthDocuments: valid.truthDocuments.slice(0, 2)
      }).success
    ).toBe(false);
    expect(
      MysteryBookManifestSchema.safeParse({
        ...valid,
        linkedMaterialIds: ["m1", "m1"]
      }).success
    ).toBe(false);
  });

  it("previews structural mutations and enforces invariants", () => {
    const manifest = sampleManifest();
    const index = buildEmptyMysteryWorkspaceIndex(manifest);

    const preview = previewMysteryWorkspaceOperations(manifest, index, {
      operations: [
        {
          type: "role.create",
          role: { id: "role_3", name: "周明", tag: "侦探" }
        },
        { type: "act.create", act: { id: "act_3", title: "第三幕" } },
        { type: "boardSpec.update", boardSpec: { narrativePerson: "first" } }
      ],
      documentWrites: [
        {
          target: {
            kind: "player_act",
            roleId: "role_3",
            actId: "act_3",
            document: "brief"
          },
          content: "只知道钟声响起。"
        }
      ]
    });

    expect(preview.manifest.roles).toHaveLength(3);
    expect(preview.manifest.acts).toHaveLength(3);
    expect(preview.manifest.boardSpec.narrativePerson).toBe("first");
    expect(preview.workspaceIndex.actMatrix).toHaveLength(9);
    const cell = preview.workspaceIndex.actMatrix.find(
      (item) => item.roleId === "role_3" && item.actId === "act_3"
    );
    expect(cell?.briefChars).toBe(8);

    expect(() =>
      previewMysteryWorkspaceOperations(manifest, index, {
        operations: [{ type: "truthDoc.delete", docId: "core_truth" }],
        documentWrites: []
      })
    ).toThrow(MysteryWorkspaceOperationError);

    const oneRole = {
      ...manifest,
      roles: [manifest.roles[0]!]
    };
    expect(() =>
      previewMysteryWorkspaceOperations(
        oneRole,
        buildEmptyMysteryWorkspaceIndex(oneRole),
        {
          operations: [{ type: "role.delete", roleId: "role_1" }],
          documentWrites: []
        }
      )
    ).toThrow(MysteryWorkspaceOperationError);
  });

  it("ships disabled default team members and valid command envelopes", () => {
    expect(DEFAULT_MYSTERY_AGENT_SETTINGS.agents[0]?.id).toBe("mystery");
    expect(DEFAULT_MYSTERY_AGENT_TEAM_SETTINGS.parallelSubagents).toBe(false);
    expect(
      DEFAULT_MYSTERY_AGENT_TEAM_SETTINGS.teams[0]?.subagents.every(
        (member) => !member.enabled && member.webSearchMode === "off"
      )
    ).toBe(true);

    const cmd = CommandEnvelopeSchema.parse(
      createEnvelope(
        "mystery.createBook",
        {
          title: "新本",
          genre: "情感沉浸",
          boardSpec: {
            playerCount: 6,
            actCountTarget: 3,
            narrativePerson: "second"
          },
          linkedMaterialIds: ["m1"],
          linkedSkillIds: ["s1"]
        },
        { id: "cmd_1", context: { correlationId: "corr_1" } }
      )
    );
    expect(cmd.type).toBe("mystery.createBook");
  });

  it("reorders truth docs, roles, acts, and clue rounds by anchor while protecting builtins", () => {
    const manifest = sampleManifest();
    const withMore = previewMysteryWorkspaceOperations(
      manifest,
      buildEmptyMysteryWorkspaceIndex(manifest),
      {
        operations: [
          { type: "truthDoc.create", doc: { id: "td_a", title: "补充A" } },
          { type: "truthDoc.create", doc: { id: "td_b", title: "补充B" } },
          {
            type: "role.create",
            role: { id: "role_3", name: "沈星", tag: "" }
          },
          { type: "act.create", act: { id: "act_3", title: "第三幕" } },
          {
            type: "clueRound.create",
            round: { id: "round_2", title: "第二轮搜证" }
          }
        ],
        documentWrites: []
      }
    );

    const reordered = previewMysteryWorkspaceOperations(
      withMore.manifest,
      withMore.workspaceIndex,
      {
        operations: [
          {
            type: "truthDoc.updateMeta",
            docId: "td_b",
            reorder: { anchorId: "td_a", position: "before" }
          },
          {
            type: "role.updateMeta",
            roleId: "role_3",
            reorder: { anchorId: "role_1", position: "after" }
          },
          {
            type: "act.updateMeta",
            actId: "act_1",
            reorder: { anchorId: "act_3", position: "after" }
          },
          {
            type: "clueRound.updateMeta",
            roundId: "round_2",
            reorder: { anchorId: "round_1", position: "before" }
          }
        ],
        documentWrites: []
      }
    );

    expect(
      reordered.manifest.truthDocuments
        .filter((d) => d.id.startsWith("td_"))
        .map((d) => d.id)
    ).toEqual(["td_b", "td_a"]);
    expect(reordered.manifest.roles.map((r) => r.id)).toEqual([
      "role_1",
      "role_3",
      "role_2"
    ]);
    expect(reordered.manifest.acts.map((a) => a.id)).toEqual([
      "act_2",
      "act_3",
      "act_1"
    ]);
    expect(reordered.manifest.clueRounds.map((c) => c.id)).toEqual([
      "round_2",
      "round_1"
    ]);

    expect(() =>
      previewMysteryWorkspaceOperations(
        withMore.manifest,
        withMore.workspaceIndex,
        {
          operations: [
            {
              type: "truthDoc.updateMeta",
              docId: "core_truth",
              reorder: { anchorId: "td_a", position: "before" }
            }
          ],
          documentWrites: []
        }
      )
    ).toThrow(MysteryWorkspaceOperationError);

    expect(() =>
      previewMysteryWorkspaceOperations(
        withMore.manifest,
        withMore.workspaceIndex,
        {
          operations: [
            {
              type: "truthDoc.updateMeta",
              docId: "td_a",
              reorder: { anchorId: "core_truth", position: "after" }
            }
          ],
          documentWrites: []
        }
      )
    ).toThrow(MysteryWorkspaceOperationError);

    expect(() =>
      previewMysteryWorkspaceOperations(
        withMore.manifest,
        withMore.workspaceIndex,
        {
          operations: [
            {
              type: "role.updateMeta",
              roleId: "role_1",
              move: "down",
              reorder: { anchorId: "role_2", position: "after" }
            }
          ],
          documentWrites: []
        }
      )
    ).toThrow(MysteryWorkspaceOperationError);
  });
});
