import { describe, expect, it } from "vitest";
import appSource from "./App.vue?raw";
import sidebarSource from "./components/LeftSidebar.vue?raw";
import sectionSource from "./components/TreeSection.vue?raw";

describe("short manuscript export UI wiring", () => {
  it("forwards the book export action from the tree to the live-manuscript exporter", () => {
    expect(sectionSource).toContain("@export-book");
    expect(sidebarSource).toContain("@export-book");
    expect(appSource).toContain('@export-book="openBookExportDialog"');
    expect(appSource).toContain("<ExportShortManuscriptDialog");
    expect(appSource).toContain('@export="exportBookManuscript"');
    expect(appSource).toContain("createShortManuscriptExportInput(");
    expect(appSource).toContain("window.deepwrite.manuscript.exportShort(");
  });
});
