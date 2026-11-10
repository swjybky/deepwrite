import { describe, expect, it } from "vitest";
import {
  BUILTIN_AGENT_PROMPT_KEYS,
  BUILTIN_AGENT_SYSTEM_PROMPTS,
  DEFAULT_LIBRARY_AGENT_PROFILES,
  DEFAULT_LONG_AGENT_PROFILES,
  DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES,
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  builtinAgentSystemPrompt
} from "../index";

const headings = (text: string) => text.match(/^## .+$/gm) ?? [];
const CJK = /[㐀-鿿]/;

describe("built-in agent role prompts", () => {
  it("ships every main agent in Chinese and English with matching sections", () => {
    for (const key of BUILTIN_AGENT_PROMPT_KEYS) {
      const zh = builtinAgentSystemPrompt(key, "zh-CN");
      const en = builtinAgentSystemPrompt(key, "en-US");
      expect(zh).toMatch(/^你是 DeepWrite 的/);
      expect(en).toMatch(/^You are DeepWrite's /);
      expect(CJK.test(en)).toBe(false);
      expect(headings(zh).length).toBeGreaterThan(2);
      expect(headings(en)).toHaveLength(headings(zh).length);
      expect(zh).toBe(zh.trim());
      expect(en).toBe(en.trim());
    }
  });

  it("leaves tool addressing to the non-editable runtime rules", () => {
    for (const prompts of Object.values(BUILTIN_AGENT_SYSTEM_PROMPTS)) {
      for (const text of Object.values(prompts)) {
        for (const rule of [
          "allow_overwrite_existing",
          "replace_fragments",
          "include_all_sections",
          "scope_id",
          "【写入审批方式】"
        ]) {
          expect(text).not.toContain(rule);
        }
      }
    }
  });

  it("uses the Chinese variants as the stored defaults", () => {
    expect(DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES[0]!.systemPrompt).toBe(
      BUILTIN_AGENT_SYSTEM_PROMPTS.short["zh-CN"]
    );
    expect(DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0]!.systemPrompt).toBe(
      BUILTIN_AGENT_SYSTEM_PROMPTS.script["zh-CN"]
    );
    expect(DEFAULT_LONG_AGENT_PROFILES[0]!.systemPrompt).toBe(
      BUILTIN_AGENT_SYSTEM_PROMPTS.long["zh-CN"]
    );
    expect(
      Object.fromEntries(
        DEFAULT_LIBRARY_AGENT_PROFILES.map((profile) => [
          profile.domain,
          profile.systemPrompt
        ])
      )
    ).toEqual({
      material: BUILTIN_AGENT_SYSTEM_PROMPTS.material["zh-CN"],
      skill: BUILTIN_AGENT_SYSTEM_PROMPTS.skill["zh-CN"]
    });
  });
});
