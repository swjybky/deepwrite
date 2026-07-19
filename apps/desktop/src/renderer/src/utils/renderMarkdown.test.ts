import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./renderMarkdown";

describe("renderMarkdown", () => {
  it("renders common answer formatting", () => {
    const output = renderMarkdown("## 结果\n\n- 第一项\n- `main`\n\n**完成**");

    expect(output).toContain("<h2>结果</h2>");
    expect(output).toContain("<ul><li>第一项</li><li><code>main</code></li></ul>");
    expect(output).toContain("<strong>完成</strong>");
  });

  it("escapes arbitrary html while keeping safe links", () => {
    const output = renderMarkdown('<img src=x onerror=alert(1)> [文档](https://example.com)');

    expect(output).not.toContain("<img");
    expect(output).toContain("&lt;img");
    expect(output).toContain('href="https://example.com"');
  });

  it("renders Markdown thematic breaks", () => {
    expect(renderMarkdown("上文\n\n---\n\n下文")).toBe("<p>上文</p><hr><p>下文</p>");
    expect(renderMarkdown("* * *\n___")).toBe("<hr><hr>");
  });

  it("does not treat short or mixed markers as thematic breaks", () => {
    expect(renderMarkdown("--\n-*-")).toBe("<p>--<br>-*-</p>");
  });

  it("renders GFM-style tables with alignment and inline formatting", () => {
    const output = renderMarkdown(
      "| 编号 | 伏笔 | 铺设细节 |\n| :--- | :---: | ---: |\n| V1 | **手腕针孔** | 按压疼痛 |\n| V6 | `鞋底|异物` | 未确认 |"
    );

    expect(output).toContain('<div class="markdown-table-wrap"><table>');
    expect(output).toContain('<th class="align-left">编号</th>');
    expect(output).toContain('<th class="align-center">伏笔</th>');
    expect(output).toContain('<th class="align-right">铺设细节</th>');
    expect(output).toContain('<td class="align-center"><strong>手腕针孔</strong></td>');
    expect(output).toContain('<td class="align-center"><code>鞋底|异物</code></td>');
  });

  it("keeps escaped pipes inside table cells and escapes arbitrary html", () => {
    const output = renderMarkdown(
      "| 名称 | 内容 |\n| --- | --- |\n| A \\| B | <img src=x onerror=alert(1)> |"
    );

    expect(output).toContain("<td>A | B</td>");
    expect(output).not.toContain("<img");
    expect(output).toContain("&lt;img");
  });

  it("does not render malformed table delimiters as a table", () => {
    expect(renderMarkdown("| A | B |\n| -- | --- |\n| 1 | 2 |")).toBe(
      "<p>| A | B |<br>| -- | --- |<br>| 1 | 2 |</p>"
    );
  });
});
