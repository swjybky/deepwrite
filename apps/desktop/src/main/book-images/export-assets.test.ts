import { describe, expect, it, vi, beforeEach } from "vitest";
import { createBookImageExportLoader } from "./export-assets";
const { readBookImage, createFromBuffer } = vi.hoisted(() => ({
  readBookImage: vi.fn(),
  createFromBuffer: vi.fn()
}));
vi.mock("./read", () => ({ readBookImage }));
vi.mock("electron", () => ({ nativeImage: { createFromBuffer } }));
const book = { projectType: "short" as const, projectId: "book_test" };
beforeEach(() => {
  vi.clearAllMocks();
  readBookImage.mockResolvedValue(Buffer.from("image"));
  createFromBuffer.mockReturnValue({
    isEmpty: () => false,
    getSize: () => ({ width: 640, height: 480 })
  });
});
const core = vi.fn(async (command) => ({
  status: "accepted" as const,
  requestId: command.id,
  payload: { path: "/invalid/image.png", mimeType: "image/png", byteSize: 5 }
}));
describe("book image export assets", () => {
  it("deduplicates valid references and ignores external or inline syntax", async () => {
    const loader = createBookImageExportLoader(core);
    const result = await loader(book, [
      "![a](images/a.png)\r![b](images/a.png)\r\n![outside](https://example.test/a.png)\ninline ![a](images/b.png)"
    ]);
    expect(result.assets.size).toBe(1);
    expect(result.missingImages).toBe(0);
    expect(core).toHaveBeenCalledTimes(1);
    expect(result.assets.get("images/a.png")).toMatchObject({
      ext: "png",
      width: 640,
      height: 480,
      bytes: Buffer.from("image")
    });
  });
  it("counts every unavailable reference without aborting the export", async () => {
    core.mockRejectedValueOnce(new Error("missing"));
    createFromBuffer.mockReturnValueOnce({
      isEmpty: () => true,
      getSize: () => ({ width: 0, height: 0 })
    });
    const result = await createBookImageExportLoader(core)(book, [
      "![a](images/a.png)\n![a](images/a.png)\n![b](images/b.png)"
    ]);
    expect(result.assets.size).toBe(0);
    expect(result.missingImages).toBe(3);
  });
  it("aborts before producing a package when unique image bytes exceed 512 MB", async () => {
    const bytes = Buffer.alloc(20 * 1024 * 1024);
    readBookImage.mockResolvedValue(bytes);
    await expect(
      createBookImageExportLoader(core)(book, [
        Array.from(
          { length: 26 },
          (_, i) => `![image](images/image-${i}.png)`
        ).join("\n")
      ])
    ).rejects.toMatchObject({ code: "book_image.export_too_large" });
  });
});
