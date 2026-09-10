import {
  LIBRARY_AGENT_ENTRY_MAX_CHARACTERS,
  createShortWorkspaceContentRevision,
  parseMaterialMarkdown,
  parseSkillMarkdown,
  type LibraryAgentDomain
} from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import { buildLibraryAgentTools } from "../library-agent-tools";
import {
  materialWorkspace,
  profile,
  resultText,
  skillWorkspace,
  toolByName
} from "./test-fixtures";
import type { LibraryAgentToolDetails } from "./types";

function setup(domain: LibraryAgentDomain) {
  const tools = buildLibraryAgentTools({
    workspace: domain === "skill" ? skillWorkspace() : materialWorkspace(),
    profile: profile(domain)
  });
  const params = {
    stage_id: domain === "skill" ? "draft" : "pacing",
    title: "目录中的标题",
    name: "新的名称",
    description: "何时使用与适用边界",
    body: "# 正式正文\n\n  保留缩进与尾随空格  \n"
  };
  return { tools, create: toolByName(tools, `create_${domain}_entry`), params };
}

function createdText(details: unknown): string {
  const value = details as LibraryAgentToolDetails;
  expect(value).toMatchObject({
    kind: "library-entry-mutation",
    operation: "create"
  });
  if (value.kind !== "library-entry-mutation")
    throw new Error("Missing mutation");
  return value.text;
}

describe.each(["skill", "material"] as const)(
  "%s create metadata",
  (domain) => {
    it("requires name and description in the provider tool schema", () => {
      const { create } = setup(domain);
      expect(create.parameters).toMatchObject({
        required: expect.arrayContaining([
          "stage_id",
          "title",
          "name",
          "description"
        ]),
        properties: {
          name: { type: "string" },
          description: { type: "string" }
        }
      });
    });

    it.each([
      ["plain body", ""],
      [
        "complete header",
        "---\nname: 旧名称\ndescription: 旧说明\ncategory: 保留\n---\n"
      ],
      ["partial header", "---\nname: 旧名称\ncategory: 保留\n---\n"],
      ["unrelated header", "---\ncategory: 保留\n---\n"]
    ])("upserts a %s and keeps the exact body", async (_label, header) => {
      const { create, tools, params } = setup(domain);
      const result = await create.execute("create-test", {
        ...params,
        body: header + params.body
      });
      const text = createdText(result.details);
      const parsed =
        domain === "skill"
          ? parseSkillMarkdown(text)
          : parseMaterialMarkdown(text);
      expect(parsed).toMatchObject({
        name: params.name,
        description: params.description
      });
      expect(text.endsWith(params.body)).toBe(true);
      expect(text.match(/^name:/gm)).toHaveLength(1);
      expect(text.match(/^description:/gm)).toHaveLength(1);
      expect(text).not.toContain("旧名称");
      expect(text).not.toContain("旧说明");
      if (header.includes("category:"))
        expect(text).toContain("category: 保留");
      expect(result.details).toMatchObject({
        title: params.title,
        baseRevision: createShortWorkspaceContentRevision("")
      });
      // Only the Markdown text carries metadata through the proposal/persistence flow.
      expect(result.details).not.toHaveProperty("name");
      expect(result.details).not.toHaveProperty("description");
      const read = await toolByName(tools, `read_${domain}_entry`).execute(
        "read-created",
        { name: params.title }
      );
      expect(resultText(read)).toContain(text);
      expect(resultText(read)).toContain(
        createShortWorkspaceContentRevision(text)
      );
      const repeated = await create.execute("create-duplicate", params);
      expect(repeated.details).toEqual({ kind: "none" });
      expect(resultText(repeated)).toContain("同名条目");
    });

    it("normalizes metadata to single lines and preserves CRLF content", async () => {
      const { create, params } = setup(domain);
      const body =
        "---\r\nname: 旧名\r\ndescription: 旧说明\r\nextra:\r\n  value: 保留\r\n---\r\n\r\n  正文  \r\n";
      const result = await create.execute("special-values", {
        ...params,
        body,
        name: '名称: "人物" #设定',
        description: " 第一行\n  第二行\t用途 "
      });
      const text = createdText(result.details);
      const parsed =
        domain === "skill"
          ? parseSkillMarkdown(text)
          : parseMaterialMarkdown(text);
      expect(parsed).toMatchObject({
        name: '名称: "人物" #设定',
        description: "第一行 第二行 用途"
      });
      expect(text).toContain("extra:\r\n  value: 保留\r\n");
      expect(text.endsWith("\r\n\r\n  正文  \r\n")).toBe(true);
      expect(text.replaceAll("\r\n", "")).not.toContain("\n");
    });

    it.each([
      { name: undefined },
      { description: undefined },
      { name: "  \n " },
      { description: "\t " },
      { name: "名".repeat(257) },
      { description: "说".repeat(1_001) }
    ])(
      "rejects invalid metadata before changing run state: %o",
      async (invalid) => {
        const { create, tools, params } = setup(domain);
        const result = await create.execute("invalid", {
          ...params,
          ...invalid
        });
        expect(result.details).toEqual({ kind: "none" });
        expect(resultText(result)).toContain("未创建");
        const listed = await toolByName(
          tools,
          `list_${domain}_entries`
        ).execute("list", {});
        expect(resultText(listed)).not.toContain(params.title);
        expect(
          createShortWorkspaceContentRevision(
            createdText((await create.execute("retry", params)).details)
          )
        ).toMatch(/^v1:/);
      }
    );

    it.each([
      "---\nname: 旧名\n未闭合",
      "---\nname: 重复\nname: 字段\n---\n正文",
      "---\nname: 旧名\ndescription: |\n  多行说明\n---\n正文"
    ])("does not submit an ambiguous header: %s", async (body) => {
      const { create, params } = setup(domain);
      const result = await create.execute("bad-header", { ...params, body });
      expect(result.details).toEqual({ kind: "none" });
      expect(resultText(result)).toContain("未创建");
      expect(
        createdText((await create.execute("fixed-header", params)).details)
      ).toContain(params.name);
    });

    it("checks the final content budget after adding metadata", async () => {
      const { create, params } = setup(domain);
      const overhead =
        createdText((await create.execute("measure", params)).details).length -
        params.body.length;
      const second = setup(domain);
      const body = "字".repeat(LIBRARY_AGENT_ENTRY_MAX_CHARACTERS - overhead);
      const rejected = await second.create.execute("oversize", {
        ...params,
        body: body + "字"
      });
      expect(rejected.details).toEqual({ kind: "none" });
      expect(resultText(rejected)).toContain("超过");
      const accepted = await second.create.execute("limit", {
        ...params,
        body
      });
      expect(createdText(accepted.details)).toHaveLength(
        LIBRARY_AGENT_ENTRY_MAX_CHARACTERS
      );
    });
  }
);

it("does not create a skill with only metadata and no method body", async () => {
  const { create, params } = setup("skill");
  for (const body of [
    undefined,
    "  ",
    "---\nname: 旧名\ndescription: 旧说明\n---\n"
  ]) {
    const result = await create.execute("empty", { ...params, body });
    expect(result.details).toEqual({ kind: "none" });
    expect(resultText(result)).toContain("正文不能为空");
  }
});
