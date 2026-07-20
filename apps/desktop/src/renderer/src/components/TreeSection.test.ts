import { describe, expect, it } from "vitest";
import source from "./TreeSection.vue?raw";

describe("TreeSection resource actions", () => {
  it("offers legacy library import from the skill and material add menus", () => {
    expect(source).toContain('id: "import-legacy-library"');
    expect(source).toContain('label: `导入旧版${resourceName}`');
    expect(source).toContain('icon: "archive"');
  });
});
