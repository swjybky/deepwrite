import { describe, expect, it } from "vitest";
import {
  BOOK_IMAGE_MAX_BYTES,
  BookImagePathSchema,
  BookImagesPickInputSchema,
  BookImagesWriteInputSchema,
  parseBookImageLine
} from "./book-images";
import { CommandEnvelopeSchema } from "./system";
import { createEnvelope } from "./envelope";

const book = { projectType: "short", projectId: "book_test" };
describe("book image contracts", () => {
  it.each([
    "![外链](https://example.test/image.png)",
    "![越界](images/../image.png)",
    "![绝对路径](/images/image.png)",
    "![反斜杠](images/part\\image.png)",
    "前文 ![行内](images/image.png)",
    "![动图](images/image.gif)",
    "![空格](images/my image.png)",
    `![${"字".repeat(201)}](images/image.png)`
  ])("does not recognize unsupported reference %s", (line) => {
    expect(parseBookImageLine(line)).toBeUndefined();
  });
  it("recognizes root relative image blocks including empty and escaped captions", () => {
    expect(
      parseBookImageLine('  ![海边"<>](images/海边-12345678.png)  ')
    ).toEqual({ path: "images/海边-12345678.png", alt: '海边"<>' });
    expect(parseBookImageLine("![](images/map.jpg)")).toEqual({
      path: "images/map.jpg",
      alt: ""
    });
    expect(parseBookImageLine("![地图](images/map.jpeg)")).toEqual({
      path: "images/map.jpeg",
      alt: "地图"
    });
  });
  it("rejects non-book contexts, traversal, excess selections and malformed bytes", () => {
    expect(
      BookImagesPickInputSchema.safeParse({
        book: { projectType: "material", projectId: "library_test" }
      }).success
    ).toBe(false);
    expect(
      BookImagesPickInputSchema.safeParse({ book, path: "/local/path" }).success
    ).toBe(false);
    for (const path of [
      "../image.png",
      "images/a/b.png",
      "images/..png",
      "images/a\u0000.png"
    ])
      expect(BookImagePathSchema.safeParse(path).success).toBe(false);
    const image = { bytes: "aW52YWxpZA==", ext: "png", baseName: "image" };
    expect(
      BookImagesWriteInputSchema.safeParse({ book, images: [] }).success
    ).toBe(false);
    expect(
      BookImagesWriteInputSchema.safeParse({
        book,
        images: Array.from({ length: 11 }, () => image)
      }).success
    ).toBe(false);
    expect(
      BookImagesWriteInputSchema.safeParse({
        book,
        images: [{ ...image, bytes: "!!" }]
      }).success
    ).toBe(false);
    expect(
      BookImagesWriteInputSchema.safeParse({
        book,
        images: [
          {
            ...image,
            bytes: "A".repeat(Math.ceil(BOOK_IMAGE_MAX_BYTES / 3) * 4 + 4)
          }
        ]
      }).success
    ).toBe(false);
  });
  it("registers public pick and Core-only write/resolve in the Envelope union", () => {
    expect(
      CommandEnvelopeSchema.parse(
        createEnvelope("bookImages.pick", { book }, { id: "cmd_test" })
      ).type
    ).toBe("bookImages.pick");
    expect(
      CommandEnvelopeSchema.parse(
        createEnvelope(
          "bookImages.resolve",
          { book, path: "images/test.png" },
          { id: "cmd_test" }
        )
      ).type
    ).toBe("bookImages.resolve");
  });
});
