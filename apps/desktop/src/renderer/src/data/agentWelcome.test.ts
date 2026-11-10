import { describe, expect, it } from "vitest";
import {
  LIBRARY_AGENT_DOMAINS,
  LONG_AGENT_IDS,
  SHORT_WORKSPACE_AGENT_IDS
} from "@deepwrite/contracts";
import {
  DEFAULT_AGENT_WELCOME,
  LIBRARY_AGENT_WELCOME_CONTENT,
  LONG_AGENT_WELCOME_CONTENT,
  SHORT_AGENT_WELCOME_CONTENT,
  resolveAgentWelcome
} from "./agentWelcome";

describe("agent welcome content", () => {
  it("provides an independent welcome and three common questions for every short agent", () => {
    expect(Object.keys(SHORT_AGENT_WELCOME_CONTENT)).toEqual([
      ...SHORT_WORKSPACE_AGENT_IDS
    ]);

    for (const agentId of SHORT_WORKSPACE_AGENT_IDS) {
      const welcome = resolveAgentWelcome(agentId);
      expect(welcome.title).toBeTruthy();
      expect(welcome.description).toContain("智能体");
      expect(welcome.questions).toHaveLength(3);
    }

    expect(
      new Set(
        SHORT_WORKSPACE_AGENT_IDS.map(
          (agentId) => resolveAgentWelcome(agentId).title
        )
      ).size
    ).toBe(SHORT_WORKSPACE_AGENT_IDS.length);
  });

  it("falls back to the general welcome outside a short workspace", () => {
    expect(resolveAgentWelcome(undefined)).toBe(DEFAULT_AGENT_WELCOME);
  });

  it("provides default-profile shortcuts for every long agent", () => {
    expect(Object.keys(LONG_AGENT_WELCOME_CONTENT).sort()).toEqual(
      [...LONG_AGENT_IDS].sort()
    );
    for (const agentId of LONG_AGENT_IDS) {
      const welcome = resolveAgentWelcome(
        agentId,
        undefined,
        undefined,
        undefined,
        "long"
      );
      expect(welcome.title).toBeTruthy();
      expect(welcome.description).toBeTruthy();
      expect(welcome.questions).toHaveLength(3);
    }
  });

  it("provides an independent welcome and three common questions for every library agent", () => {
    expect(Object.keys(LIBRARY_AGENT_WELCOME_CONTENT).sort()).toEqual(
      [...LIBRARY_AGENT_DOMAINS].sort()
    );

    for (const domain of LIBRARY_AGENT_DOMAINS) {
      const welcome = resolveAgentWelcome(undefined, domain);
      expect(welcome.title).toBeTruthy();
      expect(welcome.description).toContain(
        `全部${domain === "skill" ? "技能" : "素材"}库`
      );
      expect(welcome.questions).toHaveLength(3);
    }

    expect(
      new Set(
        LIBRARY_AGENT_DOMAINS.map(
          (domain) => resolveAgentWelcome(undefined, domain).title
        )
      ).size
    ).toBe(LIBRARY_AGENT_DOMAINS.length);
  });

  it("derives library welcome questions from configured skills", () => {
    expect(
      resolveAgentWelcome(undefined, "skill", [
        { name: "初始化库介绍" },
        { name: "创建一个技能" },
        { name: "整理一个技能" }
      ]).questions
    ).toEqual(["初始化库介绍", "创建一个技能", "整理一个技能"]);
  });

  it("prefers configured short-agent welcome shortcuts over builtin defaults", () => {
    expect(
      resolveAgentWelcome("short", undefined, undefined, [
        "自定义按钮一",
        "自定义按钮二",
        "自定义按钮三"
      ]).questions
    ).toEqual(["自定义按钮一", "自定义按钮二", "自定义按钮三"]);
  });
});
