import { describe, expect, it } from "vitest";
import dialogSource from "./LongContinuationImportDialog.vue?raw";
import transferSource from "./BookTransferDialog.vue?raw";
import appSource from "../WorkspaceShell.vue?raw";
import longBookLifecycleSource from "../composables/useLongBookLifecycleCoordinator.ts?raw";
import resourceTreeSource from "../utils/longWorkspaceContinuityTree.ts?raw";

describe("LongContinuationImportDialog", () => {
  it("adds the continuation import entry and uses the protected preview API", () => {
    expect(transferSource).toContain("续写导入（TXT 章节）");
    expect(transferSource).toContain('action: "import-continuation-long-book"');
    expect(transferSource).not.toContain("旧版本长篇");
    expect(transferSource).not.toContain("旧版本短篇/剧本");
    expect(appSource).toContain("await chooseContinuationImportSource();");
    expect(appSource).toContain(
      '@confirm-continuation-import="confirmContinuationImport"'
    );
    expect(longBookLifecycleSource).toContain(
      "api.chooseContinuationImportSource()"
    );
    expect(longBookLifecycleSource).toContain("api.importContinuation(input)");
    expect(resourceTreeSource).toContain("createLongContinuitySelection(");
    expect(resourceTreeSource).toContain('commit.mode === "import_checkpoint"');
  });

  it("previews order, encoding and the non-authoritative checkpoint policy", () => {
    expect(dialogSource).toContain("核对 TXT 章节顺序");
    expect(dialogSource).toContain("preview.volumes");
    expect(dialogSource).toContain("chapter.encoding !== 'utf-8'");
    expect(dialogSource).toContain("不会生成或推断人物事实");
    expect(dialogSource).toContain("最后一章导入后会成为唯一待处理章节");
  });

  it("uses theme variables, PopupSelect, toast validation and a neutral primary action", () => {
    expect(dialogSource).toContain("<PopupSelect");
    expect(dialogSource).toContain('uiMessage.warning("请输入书名")');
    expect(dialogSource).toContain('class="dialog-primary-button"');
    expect(dialogSource).toContain("var(--surface-main)");
    expect(dialogSource).toContain("var(--theme-line)");
    expect(dialogSource).toContain("var(--text-primary)");
    expect(dialogSource).toContain("@media (max-width: 620px)");
  });
});
