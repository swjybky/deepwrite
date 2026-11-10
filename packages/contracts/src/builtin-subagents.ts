import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";

export const LIBRARY_MANAGEMENT_INVOCATION_POLICY =
  "仅当用户主动要求或明确确认在当前作品绑定的技能库或素材库中创建、记录、优化、编辑内容时，才可调用对应管理工具。普通创作、查询、引用和使用技能不得触发；历史中已完成的管理请求不构成本次授权。用户已经明确要求时无需重复确认。目标库或创建内容不明确时先用 ask_user_question 询问；跳过且关键信息仍不足时停止依赖该信息的操作。不得自动创建库或修改绑定。";
export const BuiltinSubagentSettingSchema = z
  .object({
    description: z.string().trim().min(1).max(1000),
    enabled: z.boolean()
  })
  .strict();
const oldTeamDescriptions = [
  "仅在用户要求查看、管理或优化当前作品绑定团队的成员提示词时调用。先读取原提示词，修改逐项审阅，明确接受后保存。",
  "仅在用户要求查看、管理或优化当前作品实际生效团队的成员提示词时调用。有绑定时使用绑定团队，无绑定时使用当前类型启用的团队。先读取原提示词，修改逐项审阅，明确接受后保存。"
];
function defaultSetting(domain: "skill" | "material" | "team") {
  return {
    enabled: false,
    description:
      domain === "team"
        ? "仅在用户要求查看、管理或优化当前作品实际生效团队的成员提示词时调用这些工具。先列出生效团队并读取原提示词，修改逐项审阅，明确接受后保存。"
        : `仅当用户主动要求或明确确认在当前作品绑定的${domain === "skill" ? "技能库" : "素材库"}中创建、记录、优化或编辑内容时调用这些工具。普通创作、查询、引用和使用技能不触发。`
  };
}
function migratedSetting(domain: "skill" | "material" | "team") {
  const oldDescriptions =
    domain === "team"
      ? oldTeamDescriptions
      : [
          `仅当用户主动要求或明确确认在当前作品绑定的${domain === "skill" ? "技能库" : "素材库"}中创建、记录、优化或编辑内容时调用。普通创作、查询、引用和使用技能不触发。`
        ];
  return BuiltinSubagentSettingSchema.transform((setting) =>
    oldDescriptions.includes(setting.description)
      ? defaultSetting(domain)
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
