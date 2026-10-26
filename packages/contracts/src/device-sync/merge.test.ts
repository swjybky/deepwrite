import { expect, it } from "vitest";
import { mergeSyncItems } from "./merge";
import type { SyncItem } from "./schemas";

function snapshot(entries: { id: string; content: string }[]): SyncItem {
  return {
    kind: "long-book",
    id: "longbook_fixture",
    title: "合成整书",
    files: { "deepwrite.json": JSON.stringify({ entries }) }
  };
}
const entry = (id: string, content = id) => ({ id, content });
it("大名册合并独立修改和删除时保留身份、顺序及未改动内容", () => {
  const entries = Array.from({ length: 10_000 }, (_, i) => entry(`entry_${i}`));
  const left = structuredClone(entries);
  left[0]!.content = "左端修改";
  const right = structuredClone(entries);
  right.at(-1)!.content = "右端修改";
  right.splice(10, 1);
  const result = mergeSyncItems(
    snapshot(entries),
    snapshot(left),
    snapshot(right)
  );
  expect(result.conflicts).toEqual([]);
  const merged = JSON.parse(result.item!.files["deepwrite.json"]!).entries;
  expect(merged).toHaveLength(9999);
  expect(merged[0]).toEqual(entry("entry_0", "左端修改"));
  expect(merged.at(-1)).toEqual(entry("entry_9999", "右端修改"));
  expect(merged.some(({ id }: { id: string }) => id === "entry_10")).toBe(
    false
  );
  expect(merged[10]).toEqual(entry("entry_11"));
});
it("并发排序冲突仍要求确认，采用一端顺序时保留另一端独立修改", () => {
  const base = snapshot([entry("a"), entry("b"), entry("c")]);
  const left = snapshot([entry("b"), entry("a"), entry("c", "左端内容")]);
  const right = snapshot([entry("a"), entry("c"), entry("b")]);
  expect(mergeSyncItems(base, left, right).conflicts).toEqual([
    "deepwrite.json"
  ]);
  const resolved = mergeSyncItems(base, left, right, { preferred: right });
  expect(resolved.conflicts).toEqual([]);
  expect(JSON.parse(resolved.item!.files["deepwrite.json"]!).entries).toEqual([
    entry("a"),
    entry("c", "左端内容"),
    entry("b")
  ]);
});
