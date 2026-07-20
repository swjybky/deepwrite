import { describe, expect, it } from "vitest";
import source from "./LibraryProjectDialog.vue?raw";

describe("LibraryProjectDialog create-library form", () => {
  it("selects and submits the material or skill classification", () => {
    expect(source).toContain("materialKind: libraryKind.value");
    expect(source).toContain("skillKind: libraryKind.value");
    expect(source).toContain("通用技能库");
    expect(source).not.toContain('{ value: "mixed", label: "综合素材库" }');
  });

  it("uses the configured workspace directory without offering another location step", () => {
    expect(source).toContain("新资料库会自动保存在当前工作目录中，无需再次选择目录。");
    expect(source).not.toContain("下一步会选择保存位置");
    expect(source).not.toContain("选择位置并创建");
  });
});
