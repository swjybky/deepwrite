import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";

export const LIBRARY_MANAGEMENT_INVOCATION_POLICY =
  "仅当用户本次要求查看或管理当前作品绑定的素材库或技能库时调用管理工具。普通创作中引用素材或使用技能，沿用原有查询与加载工具。用户已经明确要求时无需重复确认；目标库或要记录的内容不明确时，用 ask_user_question 询问，仍缺关键信息时停止相关操作。复制、移动、删除和恢复都须由用户接受整理卡后执行。不得自动创建库或修改绑定。";
export const BuiltinSubagentSettingSchema = z
  .object({
    description: z.string().trim().min(1).max(1000),
    enabled: z.boolean()
  })
  .strict();
/** Defaults from the subagent era, when the managers were on by default. */
const oldTeamDescriptions = [
  "仅在用户要求查看、管理或优化当前作品绑定团队的成员提示词时调用。先读取原提示词，修改逐项审阅，明确接受后保存。",
  "仅在用户要求查看、管理或优化当前作品实际生效团队的成员提示词时调用。有绑定时使用绑定团队，无绑定时使用当前类型启用的团队。先读取原提示词，修改逐项审阅，明确接受后保存。"
];
function libraryNoun(domain: "skill" | "material") {
  return domain === "skill" ? "技能库" : "素材库";
}
/** Earlier tool-era defaults: refresh the text, keep the user's switch. */
function previousToolDescription(domain: "skill" | "material" | "team") {
  return domain === "team"
    ? "仅在用户要求查看、管理或优化当前作品实际生效团队的成员提示词时调用这些工具。先列出生效团队并读取原提示词，修改逐项审阅，明确接受后保存。"
    : `仅当用户主动要求或明确确认在当前作品绑定的${libraryNoun(domain)}中创建、记录、优化或编辑内容时调用这些工具。普通创作、查询、引用和使用技能不触发。`;
}
function defaultSetting(domain: "skill" | "material" | "team") {
  return {
    enabled: false,
    description:
      domain === "team"
        ? "仅在用户要求查看、管理或调整当前作品实际生效团队的成员时调用这些工具。先列出生效团队并读取要改的成员，修改逐项审阅，明确接受后保存。"
        : `查看或搜索绑定的${libraryNoun(domain)}，批量记录、修改内容，或整理条目（复制、移动、删除和恢复）。`
  };
}
function migratedSetting(domain: "skill" | "material" | "team") {
  const oldDescriptions =
    domain === "team"
      ? oldTeamDescriptions
      : [
          `仅当用户主动要求或明确确认在当前作品绑定的${libraryNoun(domain)}中创建、记录、优化或编辑内容时调用。普通创作、查询、引用和使用技能不触发。`
        ];
  return BuiltinSubagentSettingSchema.transform((setting) =>
    oldDescriptions.includes(setting.description)
      ? defaultSetting(domain)
      : setting.description === previousToolDescription(domain)
        ? { ...defaultSetting(domain), enabled: setting.enabled }
        : setting
  );
}
export const BuiltinSubagentSettingsSchema = z
  .object({
    skill: migratedSetting("skill"),
    material: migratedSetting("material"),
    team: migratedSetting("team").default(() => defaultSetting("team"))
  })
  .strict();
export type BuiltinSubagentSettings = z.infer<
  typeof BuiltinSubagentSettingsSchema
>;
export function defaultBuiltinSubagentSettings(): BuiltinSubagentSettings {
  return {
    skill: defaultSetting("skill"),
    material: defaultSetting("material"),
    team: defaultSetting("team")
  };
}
export const AgentTeamsSaveBuiltinsCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("agentTeams.saveBuiltins"),
    payload: BuiltinSubagentSettingsSchema
  });
