import { describe, expect, it } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { setAppLanguage } from "../i18n";
import BookActionMenu from "./BookActionMenu.vue";

function bookMenu(props: { unavailable?: boolean; pinned?: boolean } = {}) {
  return renderToString(createSSRApp(BookActionMenu, props));
}

function labels(html: string) {
  return Array.from(
    html.matchAll(/<span[^>]*>([^<]+)<\/span>/gu),
    ([, label]) => label
  );
}

describe("TreeNodeItem actions", () => {
  it("renders the shared book menu in order with a neutral Remove and a danger Delete", async () => {
    const html = await bookMenu();
    expect(labels(html)).toEqual([
      "置顶",
      "管理",
      "复制",
      "绑定",
      "导出",
      "移除",
      "删除"
    ]);
    expect(html.match(/role="separator"/gu)).toHaveLength(1);
    const dangerButtons = [
      ...html.matchAll(/<button[^>]*is-danger[^>]*>[\s\S]*?<\/button>/gu)
    ];
    expect(dangerButtons.flatMap(([button]) => labels(button))).toEqual([
      "删除"
    ]);
    expect(labels(await bookMenu({ pinned: true }))[0]).toBe("取消置顶");
  });

  it("keeps only Remove for unavailable books in both locales", async () => {
    expect(labels(await bookMenu({ unavailable: true, pinned: true }))).toEqual(
      ["移除"]
    );
    try {
      setAppLanguage("en-US", "en-US");
      expect(labels(await bookMenu())).toEqual([
        "Pin",
        "Manage",
        "Duplicate",
        "Bindings",
        "Export",
        "Remove",
        "Delete"
      ]);
      expect(labels(await bookMenu({ unavailable: true }))).toEqual(["Remove"]);
    } finally {
      setAppLanguage("zh-CN", "zh-CN");
    }
  });
});
