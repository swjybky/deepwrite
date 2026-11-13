import { describe, expect, it } from "vitest";
import {
  CATALOG_INTERACTIVE_COMMAND_TIMEOUT_MS,
  catalogCommandTimeoutMessage,
  catalogCommandTimeoutMs
} from "./catalog-command-timeout";

describe("catalog command timeout", () => {
  it("bounds editor reads and approval writes at 60 seconds", () => {
    expect(CATALOG_INTERACTIVE_COMMAND_TIMEOUT_MS).toBe(60_000);
    expect(catalogCommandTimeoutMs("catalog.saveDocument")).toBe(60_000);
    expect(catalogCommandTimeoutMs("versions.restore")).toBe(60_000);
    expect(catalogCommandTimeoutMs("versions.list")).toBe(60_000);
    expect(catalogCommandTimeoutMs("versions.read")).toBe(60_000);
    expect(catalogCommandTimeoutMs("catalog.snapshot")).toBe(60_000);
    expect(catalogCommandTimeoutMs("catalog.index")).toBe(60_000);
    expect(catalogCommandTimeoutMs("catalog.readDocument")).toBe(60_000);
    expect(catalogCommandTimeoutMs("catalog.readWritingContext")).toBe(60_000);
    expect(catalogCommandTimeoutMs("catalog.writeWritingContext")).toBe(60_000);
    expect(catalogCommandTimeoutMs("catalog.createDraftSection")).toBe(60_000);
    expect(catalogCommandTimeoutMs("catalog.createDraftSections")).toBe(60_000);
    expect(catalogCommandTimeoutMs("catalog.deleteDraftSection")).toBe(60_000);
    expect(catalogCommandTimeoutMs("catalog.moveDraftSection")).toBe(60_000);
    expect(catalogCommandTimeoutMs("catalog.mutatePlotStructure")).toBe(60_000);
    expect(catalogCommandTimeoutMs("catalog.mutateCharacterStructure")).toBe(
      60_000
    );
    expect(catalogCommandTimeoutMs("catalog.createLibraryEntry")).toBe(60_000);
    expect(catalogCommandTimeoutMs("catalog.saveLibraryEntry")).toBe(60_000);
    expect(catalogCommandTimeoutMs("catalog.updateLibrary")).toBe(60_000);
  });

  it("leaves potentially long catalog operations on their existing policy", () => {
    expect(catalogCommandTimeoutMs("catalog.duplicateProject")).toBe(0);
    expect(catalogCommandTimeoutMs("catalog.deleteProject")).toBe(0);
  });

  it("warns that a timed-out save can have an ambiguous disk result", () => {
    expect(catalogCommandTimeoutMessage("catalog.saveDocument")).toContain(
      "保存结果尚未确认"
    );
    expect(
      catalogCommandTimeoutMessage("catalog.writeWritingContext")
    ).toContain("保存结果尚未确认");
    expect(
      catalogCommandTimeoutMessage("catalog.createDraftSections")
    ).toContain("保存结果尚未确认");
    expect(
      catalogCommandTimeoutMessage("catalog.mutateCharacterStructure")
    ).toContain("保存结果尚未确认");
    expect(catalogCommandTimeoutMessage("catalog.snapshot")).toContain(
      "检查项目所在磁盘"
    );
    expect(catalogCommandTimeoutMessage("catalog.index")).toContain(
      "检查项目所在磁盘"
    );
    expect(catalogCommandTimeoutMessage("catalog.readDocument")).toContain(
      "检查项目所在磁盘"
    );
    expect(
      catalogCommandTimeoutMessage("catalog.readWritingContext")
    ).toContain("检查项目所在磁盘");
  });
});
