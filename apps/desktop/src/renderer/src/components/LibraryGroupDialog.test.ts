import { describe, expect, it } from "vitest";
import source from "./LibraryGroupDialog.vue?raw";

describe("LibraryGroupDialog default library option", () => {
  it("offers creating a default library when existing ones are unavailable", () => {
    expect(source).toContain('label: "＋ 新建默认库"');
    expect(source).toContain("CREATE_DEFAULT_LIBRARY_VALUE");
    expect(source).toContain("catalog.createLibrary");
    expect(source).toContain("也可以选择「新建默认库」当场创建");
  });

  it("supports both material and skill kind labels for default names", () => {
    expect(source).toContain("人设素材库");
    expect(source).toContain("通用技能库");
    expect(source).toContain("defaultLibraryName");
  });
});
