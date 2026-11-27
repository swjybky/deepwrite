import { describe, expect, it } from "vitest";
import type {
  DecompositionContentRef,
  LongBookDecompositionJob
} from "@deepwrite/contracts";
import {
  assertDecompositionDocumentWritable,
  assertDecompositionObjectWritable,
  currentDecompositionRefs
} from "./content-guard";
import { sha256Hex } from "@deepwrite/shared/node";

const ref = (
  revision: number,
  content: string,
  extra: Partial<DecompositionContentRef> = {}
): DecompositionContentRef => ({
  projectId: "book",
  resourceId: "card",
  fileId: "card",
  revision,
  sha256: sha256Hex(content),
  ...extra
});
const job = (...refs: DecompositionContentRef[][]) =>
  ({
    units: Object.fromEntries(
      refs.map((outputRefs, index) => [`reading:c:${index}`, { outputRefs }])
    )
  }) as unknown as LongBookDecompositionJob;

describe("生成文档的冲突判断", () => {
  it("只认本任务最后写入的版本，较早的引用被后写覆盖", () => {
    const shared = job([ref(1, "第一段")], [ref(2, "第一段\n\n第二段")]);
    expect(() =>
      assertDecompositionDocumentWritable(
        shared,
        "card",
        "第一段\n\n第二段",
        "新"
      )
    ).not.toThrow();
    expect(() =>
      assertDecompositionDocumentWritable(shared, "card", "第一段", "新")
    ).toThrow("decomposition.conflict");
    expect(
      currentDecompositionRefs(
        Object.values(shared.units).flatMap(({ outputRefs }) => outputRefs)
      ).map(({ revision }) => revision)
    ).toEqual([2]);
  });

  it("空文档可写；没有记录的非空文档只接受相同内容的重放", () => {
    const empty = job();
    expect(() =>
      assertDecompositionDocumentWritable(empty, "card", " \n", "内容")
    ).not.toThrow();
    expect(() =>
      assertDecompositionDocumentWritable(empty, "card", "内容", "内容")
    ).not.toThrow();
    expect(() =>
      assertDecompositionDocumentWritable(empty, "card", "用户内容", "内容")
    ).toThrow("decomposition.conflict");
  });

  it("保留过的用户修改必须再次询问，明确重新生成时才覆盖", () => {
    const kept = job([ref(3, "用户版本", { userOwned: true })]);
    expect(() =>
      assertDecompositionDocumentWritable(kept, "card", "用户版本", "新")
    ).toThrow("decomposition.conflict");
    expect(() =>
      assertDecompositionDocumentWritable(kept, "card", "用户版本", "新", true)
    ).not.toThrow();
  });

  it("目标准备时建立的索引对象没有引用，可直接更新", () => {
    expect(() =>
      assertDecompositionObjectWritable(job(), "volume", "any")
    ).not.toThrow();
    const { fileId: _file, ...object } = ref(1, "{}");
    const owned = job([{ ...object, resourceId: "volume" }]);
    expect(() =>
      assertDecompositionObjectWritable(owned, "volume", sha256Hex("{}"))
    ).not.toThrow();
    expect(() =>
      assertDecompositionObjectWritable(owned, "volume", sha256Hex("x"))
    ).toThrow("decomposition.conflict");
  });

  it("历史引用保留用户所有权，后续明确生成的新版本可以接替它", () => {
    const current = job([]);
    const unit = current.units["reading:c:0"]!;
    unit.previousOutputRefs = [ref(3, "用户版本", { userOwned: true })];
    expect(() =>
      assertDecompositionDocumentWritable(
        current,
        "card",
        "用户版本",
        "用户版本"
      )
    ).toThrow("decomposition.conflict");

    unit.outputRefs = [ref(4, "重新生成版本")];
    expect(() =>
      assertDecompositionDocumentWritable(
        current,
        "card",
        "重新生成版本",
        "继续更新"
      )
    ).not.toThrow();
  });
});
