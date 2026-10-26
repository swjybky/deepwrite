import { expect, it } from "vitest";
import { sameSyncContent, syncContent, syncEqual } from "./value";
import type { SyncItem } from "./schemas";

const base: SyncItem = {
  kind: "book",
  id: "book_fixture",
  title: "合成作品",
  files: {
    "deepwrite.json": JSON.stringify({
      revision: 1,
      updatedAt: "2026-10-01",
      nested: { projectRevision: 1, title: "内容" }
    }),
    "draft.md": "正文 updatedAt: 保留原文"
  }
};
it("只忽略 JSON 中派生的版本和时间字段，保留正文与身份比较语义", () => {
  const variants = [
    structuredClone(base),
    {
      ...base,
      files: {
        ...base.files,
        "deepwrite.json": JSON.stringify({
          nested: { title: "内容", projectRevision: 99 },
          updatedAt: "2026-10-22",
          revision: 2
        })
      }
    },
    { ...base, title: "另一部作品" },
    { ...base, files: { ...base.files, "draft.md": "新的正文" } },
    { ...base, files: { "deepwrite.json": base.files["deepwrite.json"]! } },
    { ...base, files: { ...base.files, "extra.md": "新增" } },
    {
      ...base,
      files: {
        ...base.files,
        "deepwrite.json": JSON.stringify({ nested: { title: "修改" } })
      }
    },
    null
  ];
  for (const value of variants)
    expect(sameSyncContent(base, value)).toBe(
      syncEqual(syncContent(base), syncContent(value))
    );
  expect(sameSyncContent(null, null)).toBe(true);
});
it("即使两份内容相同，也拒绝无法解析的 JSON", () => {
  const malformed = {
    ...base,
    files: { ...base.files, "deepwrite.json": "malformed" }
  };
  expect(() => sameSyncContent(malformed, malformed)).toThrow();
  expect(() => sameSyncContent(null, malformed)).toThrow();
  expect(() =>
    sameSyncContent(malformed, { ...base, id: "other_book" })
  ).toThrow();
});
