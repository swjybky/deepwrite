import { describe, expect, it } from "vitest";
import { renderMarkdown, renderMarkdownBlocks } from "./renderMarkdown";

describe("renderMarkdown", () => {
  it("renders common answer formatting", () => {
    const output = renderMarkdown("## 结果\n\n- 第一项\n- `main`\n\n**完成**");

    expect(output).toContain("<h2>结果</h2>");
    expect(output).toContain(
      "<ul><li>第一项</li><li><code>main</code></li></ul>"
    );
    expect(output).toContain("<strong>完成</strong>");
  });

  it("only annotates headings for editor preview navigation when requested", () => {
    const source = "# 第一章\n\n## 第一节";
    const ordinary = renderMarkdown(source);
    const annotated = renderMarkdown(source, { annotateHeadings: true });

    expect(ordinary).toBe("<h1>第一章</h1><h2>第一节</h2>");
    expect(ordinary).not.toContain("data-markdown-heading-index");
    expect(annotated).toBe(
      '<h1 data-markdown-heading-index="0" tabindex="-1">第一章</h1>' +
        '<h2 data-markdown-heading-index="1" tabindex="-1">第一节</h2>'
    );
  });

  it("escapes arbitrary html while keeping safe links", () => {
    const output = renderMarkdown(
      "<img src=x onerror=alert(1)> [文档](https://example.com)"
    );

    expect(output).not.toContain("<img");
    expect(output).toContain("&lt;img");
    expect(output).toContain('href="https://example.com"');
  });

  it("renders Markdown thematic breaks", () => {
    expect(renderMarkdown("上文\n\n---\n\n下文")).toBe(
      "<p>上文</p><hr><p>下文</p>"
    );
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
    expect(output).toContain(
      '<td class="align-center"><strong>手腕针孔</strong></td>'
    );
    expect(output).toContain(
      '<td class="align-center"><code>鞋底|异物</code></td>'
    );
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

describe("Markdown blocks and book image rendering", () => {
  it("reports exact source ranges for every top-level block, including CRLF", () => {
    const source =
      "# 标题\r\n\r\n段落一\r\n段落二\r\n\r\n> 引文\r\n\r\n- 列表\r\n\r\n```ts\r\ncode\r\n```\r\n\r\n---";
    const blocks = renderMarkdownBlocks(source);
    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "quote",
      "list",
      "code",
      "separator"
    ]);
    expect(blocks.map(({ start, end }) => source.slice(start, end))).toEqual([
      "# 标题",
      "段落一\r\n段落二",
      "> 引文",
      "- 列表",
      "```ts\r\ncode\r\n```",
      "---"
    ]);
    expect(blocks.map(({ html }) => html).join("")).toBe(
      renderMarkdown(source)
    );
  });
  it("keeps ordinary message rendering unchanged without a book image resolver", () => {
    const source = "![地图](images/map-12345678.png)";
    expect(renderMarkdown(source)).toBe(`<p>${source}</p>`);
    expect(renderMarkdownBlocks(source)[0]?.kind).toBe("paragraph");
  });
  it("renders only standalone book-relative references and escapes all image attributes", () => {
    const resolveImage = (path: string) =>
      `deepwrite-book-image://asset/short/book/${path.slice(7)}`;
    const html = renderMarkdown('![<说明 "&>](images/map-12345678.png)', {
      resolveImage
    });
    expect(html).toContain('<figure class="markdown-image"');
    expect(html).toContain('alt="&lt;说明 &quot;&amp;&gt;"');
    expect(html).not.toContain("figcaption");
    expect(html).not.toMatch(/>[^<]+</u);
    expect(
      renderMarkdown("![](images/map-12345678.jpg)", { resolveImage })
    ).not.toContain("figcaption");
    for (const source of [
      "![外链](https://example.test/map.png)",
      "![越界](images/../map.png)",
      "正文![行内](images/map.png)"
    ]) {
      expect(renderMarkdown(source, { resolveImage })).not.toContain("<img");
    }
  });
  it("reuses unchanged block HTML and drops stale cache entries", () => {
    const cache = new Map<string, string>();
    renderMarkdownBlocks("第一段\n\n第二段", { blockHtmlCache: cache });
    const unchanged = Array.from(cache.entries()).find(([key]) =>
      key.endsWith("第二段")
    )!;
    renderMarkdownBlocks("修改第一段\n\n第二段", { blockHtmlCache: cache });
    expect(cache.get(unchanged[0])).toBe(unchanged[1]);
    expect(cache.size).toBe(2);
    expect(
      Array.from(cache.keys()).some((key) => key.endsWith("\0第一段"))
    ).toBe(false);
  });
});
