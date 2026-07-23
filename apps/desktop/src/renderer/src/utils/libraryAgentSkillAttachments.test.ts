import { describe, expect, it } from "vitest";
import {
  DEFAULT_MATERIAL_LIBRARY_AGENT_SKILLS,
  DEFAULT_SKILL_LIBRARY_AGENT_SKILLS,
  type LibraryAgentSkill
} from "@deepwrite/contracts";
import { buildLibraryAgentSkillAttachments } from "./libraryAgentSkillAttachments";

function skills(
  entries: Array<{ id: string; name: string; description?: string; content: string }>
): LibraryAgentSkill[] {
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: entry.description ?? "",
    content: entry.content
  }));
}

describe("buildLibraryAgentSkillAttachments", () => {
  it("maps configured skills to attached skills by name", () => {
    const result = buildLibraryAgentSkillAttachments(
      skills([
        { id: "a", name: "初始化库介绍", content: "介绍步骤" },
        { id: "b", name: "创建一个素材", content: "创建步骤" }
      ])
    );

    expect(result.complete).toBe(true);
    expect(result.attachedSkills.map((item) => item.title)).toEqual([
      "初始化库介绍",
      "创建一个素材"
    ]);
    expect(result.attachedSkills.map((item) => item.content)).toEqual([
      "介绍步骤",
      "创建步骤"
    ]);
    expect(result.attachedSkills.every((item) => item.source === "attached-skill")).toBe(true);
  });

  it("uses default builtin skill sets for both library domains", () => {
    expect(DEFAULT_SKILL_LIBRARY_AGENT_SKILLS.map((skill) => skill.name)).toEqual([
      "初始化库介绍",
      "创建一个技能",
      "整理一个技能"
    ]);
    expect(DEFAULT_MATERIAL_LIBRARY_AGENT_SKILLS.map((skill) => skill.name)).toEqual([
      "初始化库介绍",
      "创建一个素材",
      "整理一个素材"
    ]);
  });
});
