import { describe, expect, it } from "vitest";
import source from "./ExternalSkillImportDialog.vue?raw";
import treeSource from "./TreeNodeItem.vue?raw";
import importCoordinatorSource from "../composables/useExternalLibraryImportCoordinator.ts?raw";

describe("external library import UI", () => {
  it("offers multi-file and recursive directory choices", () => {
    expect(source).toContain("选择文件夹");
    expect(source).toContain("选择文件");
    expect(source).toContain("递归扫描其子目录");
    expect(source).toContain("emit('choose', 'directory')");
    expect(source).toContain("emit('choose', 'file')");
  });

  it("shows the action only for writable skill libraries", () => {
    expect(treeSource).toContain("从其他 skills 加载");
    expect(treeSource).toContain(
      "libraryDomain === 'skill' && !node.readOnly && !node.unavailable"
    );
    expect(treeSource).toContain(
      "activateResourceNodeAction('import-external-skills')"
    );
  });

  it("previews titles only and submits selected candidate ids", () => {
    expect(source).toContain("candidate.title");
    expect(source).not.toContain("candidate.content");
    expect(source).toContain("selectedCandidateIds");
    expect(source).toContain("无法读取或提取");
    expect(importCoordinatorSource).toContain(
      "api.chooseExternalLibraryEntries(sourceKind)"
    );
    expect(importCoordinatorSource).toContain("api.importLibraryEntries({");
  });
});
