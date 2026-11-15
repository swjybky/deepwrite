import { describe, expect, it } from "vitest";
import {
  CatalogCommandEnvelopeSchema,
  CommandEnvelopeSchema,
  DEFAULT_SCRIPT_WRITING_CONTEXT,
  DEFAULT_SHORT_WRITING_CONTEXT,
  ReadWritingContextResultSchema,
  WRITING_CONTEXT_MAX_CHARACTERS,
  WriteWritingContextInputSchema,
  createEnvelope,
  writingContextCharacterCount
} from "./index";

describe("short and screenplay writing context contracts", () => {
  it("ships distinct workspace contexts within the shared limit", () => {
    expect(DEFAULT_SHORT_WRITING_CONTEXT).toContain("# 短篇上下文");
    expect(DEFAULT_SHORT_WRITING_CONTEXT).toContain("以当前作品目录为准");
    expect(DEFAULT_SHORT_WRITING_CONTEXT).toContain(
      "作者自由定义，可以从人物开始，也可以从剧情某个阶段开始"
    );
    expect(DEFAULT_SHORT_WRITING_CONTEXT).toContain(
      "文本样式可维护一份整体人设"
    );
    expect(DEFAULT_SHORT_WRITING_CONTEXT).toContain("将已有导语写入导语小节");
    expect(DEFAULT_SCRIPT_WRITING_CONTEXT).toContain("# 剧本上下文");
    expect(DEFAULT_SCRIPT_WRITING_CONTEXT).toContain(
      "阶段及依赖关系由用户定义"
    );
    expect(DEFAULT_SCRIPT_WRITING_CONTEXT).toContain(
      "按剧情设计初始化剧集目录"
    );
    expect(
      writingContextCharacterCount(DEFAULT_SHORT_WRITING_CONTEXT)
    ).toBeLessThanOrEqual(WRITING_CONTEXT_MAX_CHARACTERS);
    expect(
      writingContextCharacterCount(DEFAULT_SCRIPT_WRITING_CONTEXT)
    ).toBeLessThanOrEqual(WRITING_CONTEXT_MAX_CHARACTERS);
  });

  it("counts Unicode code points and rejects oversized writes", () => {
    const content = "雨".repeat(WRITING_CONTEXT_MAX_CHARACTERS - 1) + "🌧️";
    expect(writingContextCharacterCount(content)).toBe(
      WRITING_CONTEXT_MAX_CHARACTERS + 1
    );
    expect(
      WriteWritingContextInputSchema.safeParse({ bookId: "book_1", content })
        .success
    ).toBe(false);
  });

  it("validates catalog read/write envelopes and typed results", () => {
    const read = createEnvelope(
      "catalog.readWritingContext",
      { bookId: "book_1" },
      { id: "read_context", timestamp: "2026-08-24T12:00:00.000Z" }
    );
    const write = createEnvelope(
      "catalog.writeWritingContext",
      { bookId: "book_1", content: "# 当前方法" },
      { id: "write_context", timestamp: "2026-08-24T12:00:00.000Z" }
    );
    expect(CatalogCommandEnvelopeSchema.parse(read).type).toBe(
      "catalog.readWritingContext"
    );
    expect(CommandEnvelopeSchema.parse(write).type).toBe(
      "catalog.writeWritingContext"
    );
    expect(
      ReadWritingContextResultSchema.parse({
        bookId: "book_1",
        workspaceType: "short",
        content: "# 当前方法",
        truncated: false
      })
    ).toMatchObject({ workspaceType: "short" });
  });
});
