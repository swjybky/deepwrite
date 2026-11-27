import { describe, expect, it, vi } from "vitest";
import { decodeImage, downloadImage, identifyImage } from "./image-download";
import { IMAGE_PNG, testImageDecoder } from "./image.test-support";
import type { NativeImage } from "electron";

vi.mock("electron", () => ({ nativeImage: { createFromBuffer: vi.fn() } }));

const signal = () => new AbortController().signal;

describe("image download validation", () => {
  it("recognizes only supported file headers", () => {
    expect(identifyImage(IMAGE_PNG)).toBe("image/png");
    expect(identifyImage(Buffer.from([255, 216, 255, 217]))).toBe("image/jpeg");
    expect(identifyImage(Buffer.from("RIFF0000WEBP"))).toBe("image/webp");
    expect(() => identifyImage(Buffer.from("<svg>"))).toThrow("不支持");
    expect(() => identifyImage(Buffer.alloc(20 * 1024 * 1024 + 1))).toThrow(
      "20 MB"
    );
  });

  it("rejects HTTP and credential URLs before downloading", async () => {
    const fetcher = vi.fn();
    await expect(
      downloadImage(
        { url: "http://image.example.test/p.png" },
        fetcher,
        signal()
      )
    ).rejects.toThrow("HTTPS");
    await expect(
      downloadImage(
        { url: "https://invalid-test-key@image.example.test/p.png" },
        fetcher,
        signal()
      )
    ).rejects.toThrow("HTTPS");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("allows relative HTTPS redirects and rejects HTTP redirects", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "/asset.png" } })
      )
      .mockResolvedValueOnce(new Response(IMAGE_PNG));
    expect(
      await downloadImage(
        { url: "https://image.example.test/start" },
        fetcher,
        signal()
      )
    ).toEqual(IMAGE_PNG);
    expect(fetcher.mock.calls[1]![0]).toBe(
      "https://image.example.test/asset.png"
    );
    await expect(
      downloadImage(
        { url: "https://image.example.test/start" },
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "http://image.example.test/asset.png" }
          }),
        signal()
      )
    ).rejects.toThrow("HTTPS");
  });

  it("enforces both content-length and streamed size, independent of MIME claims", async () => {
    await expect(
      downloadImage(
        { url: "https://image.example.test/p.png" },
        async () =>
          new Response(IMAGE_PNG, {
            headers: { "content-length": String(21 * 1024 * 1024) }
          }),
        signal()
      )
    ).rejects.toThrow("大小限制");
    await expect(
      downloadImage(
        { url: "https://image.example.test/p.png" },
        async () => new Response(Buffer.alloc(21 * 1024 * 1024)),
        signal()
      )
    ).rejects.toThrow("大小限制");
    await expect(
      downloadImage(
        { url: "https://image.example.test/p.png" },
        async () =>
          new Response("invalid", { headers: { "content-type": "image/png" } }),
        signal()
      )
    ).rejects.toThrow("不支持");
  });

  it("validates decoding and dimensions, then generates a 480px thumbnail", () => {
    expect(decodeImage(IMAGE_PNG, testImageDecoder)).toMatchObject({
      width: 600,
      height: 800,
      png: IMAGE_PNG
    });
    const resize = vi.fn(() => ({
      toJPEG: () => Buffer.from([255, 216, 255])
    }));
    const decoder = () =>
      ({
        isEmpty: () => false,
        getSize: () => ({ width: 1200, height: 1600 }),
        toPNG: () => IMAGE_PNG,
        resize
      }) as unknown as NativeImage;
    decodeImage(IMAGE_PNG, decoder);
    expect(resize).toHaveBeenCalledWith({
      width: 360,
      height: 480,
      quality: "good"
    });
    expect(() =>
      decodeImage(IMAGE_PNG, () => ({ isEmpty: () => true }) as NativeImage)
    ).toThrow("无法解码");
    expect(() =>
      decodeImage(
        IMAGE_PNG,
        () =>
          ({
            isEmpty: () => false,
            getSize: () => ({ width: 4097, height: 2000 })
          }) as NativeImage
      )
    ).toThrow("4096");
  });

  it("rejects an oversized PNG header before invoking the native decoder", () => {
    const png = Buffer.from(IMAGE_PNG);
    png.writeUInt32BE(4097, 16);
    const decoder = vi.fn(testImageDecoder);
    expect(() => decodeImage(png, decoder)).toThrow("4096");
    expect(decoder).not.toHaveBeenCalled();
  });
});
