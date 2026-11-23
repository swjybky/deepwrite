import { registerFeatureMessages } from "../i18n";

export const bindingsT = registerFeatureMessages("components.bookBindings", {
  "zh-CN": {
    currentBindings: "当前绑定",
    groups: "分组",
    individualSkills: "单个技能",
    individualSkillHint: "将技能移入技能库后，即可绑定该库。",
    noIndividualSkills: "暂无未入库的技能",
    noMatches: "没有匹配项",
    searchSkills: "搜索分组、技能库或单个技能",
    searchMaterials: "搜索分组或素材库",
    notBound: "未绑定",
    usesEnabledTeam: "未绑定，使用启用的团队：{name}",
    noEnabledTeam: "未绑定，当前没有启用的团队",
    materialHint: "已绑定的素材库可在创作时查阅与引用。",
    enabled: "已启用",
    noTeams: "暂无这类作品可用的团队",
    unavailable: "已失效",
    loading: "加载中…"
  },
  "en-US": {
    currentBindings: "Current bindings",
    groups: "Groups",
    individualSkills: "Individual skills",
    individualSkillHint: "Move a skill into a library to bind that library.",
    noIndividualSkills: "No skills outside a library",
    noMatches: "No matches",
    searchSkills: "Search groups, libraries, or individual skills",
    searchMaterials: "Search groups or material libraries",
    notBound: "None",
    usesEnabledTeam: "None. Uses the enabled team: {name}",
    noEnabledTeam: "None. No team is enabled",
    materialHint: "Linked material libraries can be consulted while writing.",
    enabled: "Enabled",
    noTeams: "No teams are available for this kind of book",
    unavailable: "Unavailable",
    loading: "Loading…"
  }
});
