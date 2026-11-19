export {
  MysteryProjectRegistrationSchema,
  MysteryProjectRegistrySchema,
  type MysteryProjectRegistration,
  type MysteryProjectRegistry
} from "@deepwrite/contracts";
import type {
  MysteryBookManifest,
  MysteryDocumentTarget
} from "@deepwrite/contracts";

export const MYSTERY_MANIFEST_FILE = "deepwrite.json" as const;
export const MYSTERY_REGISTRY_FILE = "mystery-projects.json" as const;
export const MYSTERY_RESTORE_DIR = ".deepwrite/mystery-restore" as const;
export const MYSTERY_MAX_FILE_BYTES = 16 * 1024 * 1024;
export const MYSTERY_MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
export const MYSTERY_MAX_AGENTS_MD_BYTES = 256 * 1024;

export const DEFAULT_MYSTERY_AGENTS_MD = [
  "# 剧本杀上下文",
  "",
  "- 保持上帝视角（truth/、角色底牌、视角任务卡、DM 手册）与玩家视角（选角页、人物本正文、搜证卡面、公共序幕）严格隔离。",
  "- 撰写任意人物本正文前，必须先核对对应角色的公开人设腔调与该幕视角任务卡（brief）。",
  "- 如修改核心时间点、凶器、证词或道具归属，同步检查全局时间线与信息分流表。"
].join("\n");

export class MysteryDocumentConflictError extends Error {
  constructor(message = "文档自上次读取后已在磁盘或编辑器中发生修改。") {
    super(message);
    this.name = "MysteryDocumentConflictError";
  }
}

export function listMysteryManifestTargets(
  manifest: Pick<
    MysteryBookManifest,
    "truthDocuments" | "roles" | "acts" | "clueRounds"
  >
): MysteryDocumentTarget[] {
  const targets: MysteryDocumentTarget[] = [
    { kind: "agents_md" },
    ...manifest.truthDocuments.map((doc): MysteryDocumentTarget => ({
      kind: "truth_doc",
      docId: doc.id
    })),
    { kind: "character_relations" },
    ...manifest.roles.flatMap((role): MysteryDocumentTarget[] => [
      { kind: "role", roleId: role.id, document: "profile" },
      { kind: "role", roleId: role.id, document: "pitch" }
    ]),
    ...manifest.roles.flatMap((role) =>
      manifest.acts.flatMap((act): MysteryDocumentTarget[] => [
        {
          kind: "player_act",
          roleId: role.id,
          actId: act.id,
          document: "brief"
        },
        {
          kind: "player_act",
          roleId: role.id,
          actId: act.id,
          document: "body"
        }
      ])
    ),
    { kind: "public_doc", docId: "public_openings" },
    { kind: "public_doc", docId: "endings" },
    ...manifest.clueRounds.map((round): MysteryDocumentTarget => ({
      kind: "clue_round",
      roundId: round.id
    })),
    { kind: "dm_manual" }
  ];
  return targets;
}
